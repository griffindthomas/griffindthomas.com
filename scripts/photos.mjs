/**
 * Photo import pipeline.
 *
 *   npm run photos              import everything in ./photos-inbox
 *   npm run photos -- --from "C:/path/to/folder"
 *   npm run photos -- --force   re-encode even if the JPEG is already current
 *
 * For each photo it picks the best copy, downscales it into the content
 * folder, reads the EXIF, builds an inline placeholder, and writes a JSON
 * sidecar next to the image.
 *
 * THE RULE THAT MATTERS: re-running this is always safe. Hand-entered fields
 * (aircraft, operator, registration, airport, caption, ...) are read back and
 * preserved; only `exif`, `source`, `image` and `lqip` are overwritten. That
 * is what lets the studio editor and the importer share one set of files
 * without either one stepping on the other.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import exifr from 'exifr';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const INBOX = path.join(ROOT, 'photos-inbox');
export const LIBRARY = path.join(ROOT, 'src', 'content', 'photos');

/**
 * Long edge of the stored copy. The originals are up to 22 MP; committing
 * those would bloat the repo for no visible gain, since Astro generates the
 * responsive variants from whatever it finds here. 2800px still gives a
 * sharp full-screen lightbox on a high-DPI laptop.
 *
 * The originals stay in Lightroom / OneDrive. This folder is a derivative.
 */
const MAX_EDGE = 2800;
const JPEG_QUALITY = 88;

/**
 * Zone the camera clock is set to. Overridden per photo by `timezone`.
 *
 * EXIF carries no timezone at all, and this camera writes LOCAL wall-clock
 * time. Verified against the frames themselves: `_MG_1080` reads 12:08 for a
 * midday Boeing Field shot and the Blue Angels demo reads 15:33, which is
 * when Seafair actually flies. Reading these as UTC and shifting them would
 * put an afternoon airshow at 08:33 in the morning.
 *
 * So this field records which zone the stored wall clock belongs to; it is
 * not an offset to apply. Photos shot in Arizona need `America/Phoenix`,
 * which sits on MST year round and does not observe DST.
 */
const DEFAULT_TZ = 'America/Los_Angeles';

/**
 * Group by base name so `_MG_1141` and `_MG_1141_1` are recognised as the
 * same photo. The suffix does NOT indicate resolution - it is inverted for
 * several of these files - so selection is strictly by pixel count.
 *
 * The export-variant suffix is a SINGLE digit (`_1`, `_2`); the base itself
 * ends in the camera's 3-4 digit frame number. Matching `_\d+$` instead of
 * `_\d$` strips the frame number too, collapsing `_MG_1080`, `_MG_1141`,
 * `_MG_1250` ... into one bogus `_MG` group and silently dropping photos.
 */
export const baseOf = (f) => f.replace(/\.[^.]+$/, '').replace(/_\d$/, '');

/** Filenames are the stable identity, so the slug must be a pure function. */
export const slugOf = (base) =>
  base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * EXIF dates look like `2026:08:02 12:08:24` and carry no zone. The value is
 * already the local wall clock, so this only reshapes the punctuation into
 * something ISO-ish. Deliberately no `Z` and no offset: appending one would
 * invite `new Date()` to reinterpret it somewhere else in the world.
 */
export function exifDateToLocalIso(raw) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(raw ?? ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/**
 * Canon writes Make "Canon" and Model "Canon EOS Rebel T7", so joining the two
 * gives "Canon Canon EOS Rebel T7". Most makers repeat the brand in the model
 * this way, so prefer the model whenever it already carries the make.
 */
function cameraName(make, model) {
  const mk = String(make ?? '').trim();
  const md = String(model ?? '').trim();
  if (!md) return mk;
  if (!mk || md.toLowerCase().startsWith(mk.toLowerCase())) return md;
  return `${mk} ${md}`;
}

function shutterString(exposureTime) {
  if (!exposureTime) return '';
  if (exposureTime >= 1) return `${exposureTime}s`;
  return `1/${Math.round(1 / exposureTime)}`;
}

/** Highest pixel count wins; ties broken by larger file (less compression). */
export async function pickBestCopies(dir) {
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|tiff?|webp)$/i.test(f));
  const groups = new Map();

  for (const file of files) {
    const full = path.join(dir, file);
    const meta = await sharp(full).metadata();
    const candidate = {
      file,
      full,
      base: baseOf(file),
      width: meta.width,
      height: meta.height,
      px: meta.width * meta.height,
      bytes: fs.statSync(full).size,
    };
    const cur = groups.get(candidate.base);
    if (!cur || candidate.px > cur.px || (candidate.px === cur.px && candidate.bytes > cur.bytes)) {
      groups.set(candidate.base, candidate);
    }
  }

  return [...groups.values()].sort((a, b) => a.base.localeCompare(b.base));
}

/** Blank scaffold. Every unknown is empty on purpose: a guess in a metadata
 *  plate reads as fact, and nobody ever goes back to check it. */
function emptySidecar() {
  return {
    aircraft: '',
    typeCode: '',
    operator: '',
    registration: '',
    airport: '',
    location: '',
    caption: '',
    tags: [],
    featured: false,
    order: 0,
    draft: false,
    timezone: DEFAULT_TZ,
  };
}

/** Fields the importer owns outright and rewrites on every run. */
const DERIVED_KEYS = ['image', 'lqip', 'exif', 'source'];

export async function importOne(candidate, { force = false } = {}) {
  const slug = slugOf(candidate.base);
  const jpegName = `${slug}.jpg`;
  const jpegPath = path.join(LIBRARY, jpegName);
  const jsonPath = path.join(LIBRARY, `${slug}.json`);

  const existing = fs.existsSync(jsonPath)
    ? JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    : null;

  // Cheap identity check: same original file, same byte count. Re-encoding a
  // 22 MP JPEG is the slow part, and skipping it keeps repeat runs instant
  // and keeps git from seeing a churned binary on every import.
  const unchanged =
    existing?.source?.file === candidate.file &&
    existing?.source?.bytes === candidate.bytes &&
    fs.existsSync(jpegPath);

  const [full, raw] = await Promise.all([
    exifr.parse(candidate.full, { tiff: true, exif: true, gps: true }).catch(() => ({})),
    exifr
      .parse(candidate.full, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false })
      .catch(() => ({})),
  ]);
  const ex = full ?? {};

  let lqip = existing?.lqip ?? '';

  if (!unchanged || force) {
    await sharp(candidate.full)
      .rotate() // honour the EXIF orientation flag before it gets stripped
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toFile(jpegPath);

    const blur = await sharp(candidate.full)
      .rotate()
      .resize({ width: 24 })
      .webp({ quality: 40 })
      .toBuffer();
    lqip = `data:image/webp;base64,${blur.toString('base64')}`;
  }

  const stored = await sharp(jpegPath).metadata();

  const rawDate = raw?.DateTimeOriginal ?? raw?.CreateDate ?? '';
  const timezone = existing?.timezone ?? DEFAULT_TZ;

  const derived = {
    image: `./${jpegName}`,
    lqip,
    exif: {
      camera: cameraName(ex.Make, ex.Model),
      lens: ex.LensModel ?? '',
      focalLength: ex.FocalLength ? Math.round(ex.FocalLength) : null,
      aperture: ex.FNumber ?? null,
      shutter: shutterString(ex.ExposureTime),
      iso: ex.ISO ?? null,
      rawDate: String(rawDate ?? ''),
    },
    source: {
      file: candidate.file,
      width: stored.width,
      height: stored.height,
      bytes: candidate.bytes,
      originalLongEdge: Math.max(candidate.width, candidate.height),
    },
  };

  // `shotAt` is derived ONCE then left alone. Re-deriving would silently undo
  // any correction made in the studio for a photo whose EXIF is wrong.
  const shotAt =
    existing?.shotAt ?? exifDateToLocalIso(rawDate) ?? '1970-01-01T00:00:00';

  const merged = { ...emptySidecar(), ...(existing ?? {}), ...derived, shotAt, timezone };

  // Key order is stable so a metadata edit produces a one-line git diff
  // instead of a reshuffled file.
  const ordered = {};
  const ORDER = [
    'aircraft',
    'typeCode',
    'operator',
    'registration',
    'airport',
    'location',
    'caption',
    'tags',
    'featured',
    'order',
    'draft',
    'shotAt',
    'timezone',
    ...DERIVED_KEYS,
  ];
  for (const k of ORDER) if (k in merged) ordered[k] = merged[k];
  for (const k of Object.keys(merged)) if (!(k in ordered)) ordered[k] = merged[k];

  fs.writeFileSync(jsonPath, `${JSON.stringify(ordered, null, 2)}\n`);

  return { slug, jsonPath, reencoded: !unchanged || force, entry: ordered };
}

export async function runImport({ from = INBOX, force = false, log = () => {} } = {}) {
  if (!fs.existsSync(from)) {
    fs.mkdirSync(from, { recursive: true });
    log(`created ${path.relative(ROOT, from)} - drop photos in there and run again`);
    return { imported: [], skipped: 0 };
  }

  fs.mkdirSync(LIBRARY, { recursive: true });

  const candidates = await pickBestCopies(from);
  if (candidates.length === 0) {
    log(`no images found in ${from}`);
    return { imported: [], skipped: 0 };
  }

  const imported = [];
  for (const c of candidates) {
    const result = await importOne(c, { force });
    imported.push(result);
    const mp = ((c.width * c.height) / 1e6).toFixed(1);
    log(
      `${result.reencoded ? 'import' : '  skip'}  ${result.slug.padEnd(14)} ` +
        `${c.file} (${c.width}x${c.height}, ${mp} MP)`,
    );
  }

  return { imported, skipped: imported.filter((i) => !i.reencoded).length };
}

/** Which photos are still missing the fields the gallery plate needs. */
export function findGaps() {
  if (!fs.existsSync(LIBRARY)) return [];
  return fs
    .readdirSync(LIBRARY)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const entry = JSON.parse(fs.readFileSync(path.join(LIBRARY, f), 'utf8'));
      const missing = ['aircraft', 'operator'].filter((k) => !entry[k]);
      if (!entry.airport && !entry.location) missing.push('airport or location');
      return { slug: f.replace(/\.json$/, ''), missing };
    })
    .filter((r) => r.missing.length > 0);
}

// --- CLI ------------------------------------------------------------------
// Compare via pathToFileURL, not string concatenation: on Windows a file URL
// is `file:///C:/...` with three slashes, so the naive form never matches and
// the CLI block silently never runs.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const from = fromIdx >= 0 ? path.resolve(args[fromIdx + 1]) : INBOX;
  const force = args.includes('--force');

  const { imported, skipped } = await runImport({ from, force, log: console.log });

  if (imported.length) {
    console.log(
      `\n${imported.length} photo${imported.length === 1 ? '' : 's'} in the library` +
        (skipped ? `, ${skipped} already current` : ''),
    );
  }

  const gaps = findGaps();
  if (gaps.length) {
    console.log('\nStill needs filling in (run `npm run studio`):');
    for (const g of gaps) console.log(`  ${g.slug.padEnd(14)} ${g.missing.join(', ')}`);
  } else if (imported.length) {
    console.log('\nEvery photo has aircraft, operator and a place. Nothing to fill in.');
  }
}
