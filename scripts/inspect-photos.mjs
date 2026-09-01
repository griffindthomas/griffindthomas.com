// One-off inspection: pick the max-resolution copy of each photo, read EXIF,
// and emit a downscaled preview so the aircraft can be identified visually.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';

const SRC = 'C:/Users/gmons/OneDrive/Pictures/Edited Plane Pictures';
const OUT = process.argv[2];

fs.mkdirSync(OUT, { recursive: true });

/**
 * Group by base name so `_MG_1141` and `_MG_1141_1` are recognised as the
 * same photo. The numeric suffix does NOT indicate resolution - it is
 * inverted for several of these - so selection is strictly by pixel count.
 *
 * The export-variant suffix is a SINGLE digit (`_1`, `_2`); the base itself
 * ends in the camera's 3-4 digit frame number. Matching `_\d+$` instead of
 * `_\d$` strips the frame number too, collapsing `_MG_1080`, `_MG_1141`,
 * `_MG_1250` ... into one bogus `_MG` group and silently dropping photos.
 */
const baseOf = (f) => f.replace(/\.[^.]+$/, '').replace(/_\d$/, '');

const files = fs.readdirSync(SRC).filter((f) => /\.(jpe?g|png)$/i.test(f));

const measured = [];
for (const f of files) {
  const p = path.join(SRC, f);
  const meta = await sharp(p).metadata();
  measured.push({
    file: f,
    base: baseOf(f),
    px: meta.width * meta.height,
    width: meta.width,
    height: meta.height,
    bytes: fs.statSync(p).size,
  });
}

const groups = new Map();
for (const m of measured) {
  const cur = groups.get(m.base);
  // Highest pixel count wins; ties broken by larger file (less compression).
  if (!cur || m.px > cur.px || (m.px === cur.px && m.bytes > cur.bytes)) {
    groups.set(m.base, m);
  }
}

const chosen = [...groups.values()].sort((a, b) => a.base.localeCompare(b.base));

console.log(`${files.length} files -> ${chosen.length} unique photos\n`);

let i = 0;
for (const c of chosen) {
  i += 1;
  const src = path.join(SRC, c.file);

  let ex = {};
  try {
    ex = (await exifr.parse(src, { tiff: true, exif: true, gps: true })) ?? {};
  } catch {
    ex = {};
  }

  const shot = ex.DateTimeOriginal ?? ex.CreateDate ?? null;
  const parts = [
    `${String(i).padStart(2, '0')}. ${c.base}`,
    `    source     ${c.file}  (${c.width}x${c.height}, ${(c.px / 1e6).toFixed(1)} MP)`,
    `    camera     ${[ex.Make, ex.Model].filter(Boolean).join(' ') || '-'}`,
    `    lens       ${ex.LensModel ?? '-'}`,
    `    shot       ${shot ? new Date(shot).toISOString().slice(0, 19).replace('T', ' ') : '-'}`,
    `    exposure   ${ex.FocalLength ? Math.round(ex.FocalLength) + 'mm' : '-'}  ` +
      `f/${ex.FNumber ?? '-'}  ` +
      `${ex.ExposureTime ? '1/' + Math.round(1 / ex.ExposureTime) + 's' : '-'}  ` +
      `ISO ${ex.ISO ?? '-'}`,
    `    gps        ${ex.latitude && ex.longitude ? `${ex.latitude.toFixed(4)}, ${ex.longitude.toFixed(4)}` : 'none'}`,
  ];
  console.log(parts.join('\n'));

  // Preview for visual identification. Wide enough that a registration on
  // the fuselage stays legible.
  await sharp(src)
    .resize({ width: 2000, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(path.join(OUT, `${String(i).padStart(2, '0')}_${c.base}.jpg`));
}

console.log(`\npreviews written to ${OUT}`);
