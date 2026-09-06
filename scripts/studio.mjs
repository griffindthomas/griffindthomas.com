/**
 * Studio: a local editor for the parts of the site that are content.
 *
 *   npm run studio        (or double click studio.cmd)
 *
 * Opens a small web page on localhost with five tabs. Photos lists every frame
 * in the library with its fields as form inputs and accepts new ones by drag
 * and drop. Projects and Trips list the write-ups with their frontmatter as
 * fields and their markdown in a box. Airports and Aircraft edit the two
 * reference tables the photos point at, so adding a field or a type is not a
 * job for somebody else. Any of it can be committed and pushed from the same
 * button.
 *
 * It exists so that changing an airport code, or fixing a date in a write-up,
 * is a thing Griffin does in thirty seconds rather than a thing he has to ask
 * someone to do for him.
 *
 * Photos: it edits the SAME JSON sidecars the importer writes, and only ever
 * touches the hand-entered keys, so the two tools cannot fight over a file.
 * Projects: it reads and writes the same markdown files the site builds from,
 * frontmatter through a real YAML parser rather than a guess at the format.
 *
 * Bound to 127.0.0.1 on purpose. This process writes files, runs the importer
 * and can push to git; it must never be reachable from the network.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import sharp from 'sharp';
import YAML from 'yaml';

import { INBOX, LIBRARY, findGaps, runImport } from './photos.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STUDIO_PORT ?? 4322);

/** Keys the studio is allowed to write. Everything else is derived by the
 *  importer, and letting the editor touch it would just get overwritten. */
const EDITABLE = new Set([
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
]);

const AIRPORTS_FILE = path.join(ROOT, 'src', 'data', 'airports.json');
const AIRCRAFT_FILE = path.join(ROOT, 'src', 'data', 'aircraft-types.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}
`);

/**
 * Both catalogues are now editable from the studio, so neither can be read
 * once and held. They are reassigned after every write, because /api/save
 * validates a photo's airport against this object and a stale copy would
 * reject a code that was added a moment earlier.
 */
let airports = readJson(AIRPORTS_FILE);

/**
 * The same catalogue the type board is built from, read straight from the
 * file the site reads. The board counts a photo by its type code, so a code
 * that is not in here means the photo shows in the gallery and never appears
 * on the board, with nothing to say so. The editor offers the real codes and
 * names the family, which is the only place that mistake can be caught.
 */
let aircraftTypes = readJson(AIRCRAFT_FILE);

/** Flat list of every known code, with the family it belongs to. */
const deriveTypeCodes = () =>
  aircraftTypes
    .flatMap((family) => family.codes.map((code) => ({ code, family: family.name })))
    .sort((a, b) => a.code.localeCompare(b.code));

let typeCodes = deriveTypeCodes();

const sidecarPath = (slug) => path.join(LIBRARY, `${slug}.json`);

// --- airports ---------------------------------------------------------------

/**
 * Airports and aircraft types are reference data rather than content, and
 * until now adding either meant editing JSON by hand or asking someone else
 * to. They are edited here instead. Both are validated hard on the way in,
 * because a bad value does not fail here: it fails the site build, minutes
 * later, in a message about a content schema.
 */

const ICAO = /^[A-Z0-9]{3,4}$/;
const IATA = /^[A-Z]{3}$/;

function validateAirport(a, existing) {
  const icao = String(a.icao ?? '').trim().toUpperCase();
  const iata = String(a.iata ?? '').trim().toUpperCase();
  const name = String(a.name ?? '').trim();
  const city = String(a.city ?? '').trim();
  const lat = Number(a.lat);
  const lon = Number(a.lon);

  if (!ICAO.test(icao)) return { error: 'ICAO is three or four letters and digits, like KSEA' };
  if (iata && !IATA.test(iata)) return { error: 'IATA is three letters, or leave it empty' };
  if (!name) return { error: 'The airport needs a name' };
  if (!city) return { error: 'The airport needs a city' };
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: 'Latitude is between -90 and 90' };
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { error: 'Longitude is between -180 and 180' };
  }

  // Renaming onto a code that already exists would swallow the other airport,
  // and its photographs would follow the wrong pin onto the map.
  if (icao !== existing && airports[icao]) return { error: `${icao} is already in the list` };

  return { value: { icao, iata, name, city, lat, lon } };
}

/** Photos pointing at an airport, so it is never deleted out from under one. */
const photosUsingAirport = (icao) =>
  readLibrary()
    .filter((p) => p.airport === icao)
    .map((p) => p.slug);

/**
 * OurAirports, so that adding a field does not mean going and finding its
 * coordinates first. That lookup was the actual reason this was a job for
 * somebody else, and it is the whole point of the button.
 *
 * The file is twelve megabytes and changes about as often as airports get
 * built, so it is fetched once and kept. Delete .cache/ourairports.csv to
 * force a fresh copy.
 */
const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const CACHE_DIR = path.join(ROOT, '.cache');
const AIRPORTS_CSV = path.join(CACHE_DIR, 'ourairports.csv');

/** One CSV line into fields, respecting quotes. Airport names contain commas. */
function csvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

async function airportsCsv() {
  if (!fs.existsSync(AIRPORTS_CSV)) {
    const res = await fetch(OURAIRPORTS);
    if (!res.ok) throw new Error(`OurAirports answered ${res.status}`);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(AIRPORTS_CSV, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(AIRPORTS_CSV, 'utf8');
}

/** One airport by ICAO, in the shape airports.json wants. */
async function lookupAirport(code) {
  const text = await airportsCsv();
  const lines = text.split(/\r?\n/);
  const head = csvLine(lines[0]);
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const wanted = code.toUpperCase();

  for (let i = 1; i < lines.length; i += 1) {
    // Cheap reject before parsing the line at all. This file is eighty
    // thousand rows and the code has to appear somewhere on the right one.
    if (!lines[i] || !lines[i].toUpperCase().includes(wanted)) continue;

    const f = csvLine(lines[i]);
    const ident = (f[col.ident] ?? '').toUpperCase();
    const icao = (f[col.icao_code] ?? '').toUpperCase();
    if (ident !== wanted && icao !== wanted) continue;

    const region = f[col.iso_region] ?? '';
    const country = f[col.iso_country] ?? '';
    const where = country === 'US' ? US_STATES[region.replace('US-', '')] : country;

    return {
      icao: icao || ident,
      iata: (f[col.iata_code] ?? '').toUpperCase(),
      name: f[col.name] ?? '',
      city: [f[col.municipality], where].filter(Boolean).join(', '),
      lat: Number(Number(f[col.latitude_deg]).toFixed(4)),
      lon: Number(Number(f[col.longitude_deg]).toFixed(4)),
      type: f[col.type] ?? '',
    };
  }
  return null;
}

// --- aircraft types ---------------------------------------------------------

const SHAPE_FAMILIES = ['jet', 'fighter'];
const TIPS = ['plain', 'raked'];

/**
 * The same rules src/data/aircraft-types.ts enforces at build time, applied
 * here so that the mistake is visible while the person who made it is still
 * looking at the form. Deliberately kept in step with that file.
 */
function validateFamily(entry, existing) {
  const id = String(entry.id ?? '').trim();
  const name = String(entry.name ?? '').trim();
  const drawn = String(entry.drawn ?? '').trim();
  const span = Number(entry.span);
  const length = Number(entry.length);
  const shape = entry.shape ?? {};

  if (!/^[a-z0-9-]+$/.test(id)) return { error: 'id is lowercase letters, digits and dashes' };
  if (!name) return { error: 'The family needs a name' };
  if (!drawn) return { error: 'Say which variant the drawing is of' };
  if (!(span > 0) || !(length > 0)) return { error: 'Span and length are what size the drawing' };
  if (!SHAPE_FAMILIES.includes(shape.family)) {
    return { error: `family is one of ${SHAPE_FAMILIES.join(', ')}` };
  }
  if (!TIPS.includes(shape.tip)) return { error: `tip is one of ${TIPS.join(', ')}` };
  if (![0, 2, 4].includes(Number(shape.engines))) return { error: 'engines is 0, 2 or 4' };
  if (![1, 2].includes(Number(shape.fins))) return { error: 'fins is 1 or 2' };

  const codes = (Array.isArray(entry.codes) ? entry.codes : [])
    .map((c) => String(c).trim().toUpperCase())
    .filter(Boolean);
  if (!codes.length) return { error: 'A family needs at least one type code' };

  // One code in two families would count a photo twice, and the board would
  // then disagree with itself about how many there are.
  for (const other of aircraftTypes) {
    if (other.id === existing) continue;
    const clash = codes.find((c) => other.codes.includes(c));
    if (clash) return { error: `${clash} is already in ${other.name}` };
  }
  if (id !== existing && aircraftTypes.some((t) => t.id === id)) {
    return { error: `${id} is already a family` };
  }

  const custom = (Array.isArray(shape.custom) ? shape.custom : [])
    .map((d) => String(d).trim())
    .filter(Boolean);

  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const cleanShape = {
    family: shape.family,
    sweep: num(shape.sweep, 25),
    wingAt: num(shape.wingAt, 0.4),
    rootChord: num(shape.rootChord, 0.2),
    taper: num(shape.taper, 0.3),
    waist: num(shape.waist, 0.11),
    engines: Number(shape.engines),
    tip: shape.tip,
    fins: Number(shape.fins),
  };
  // Both are optional in the type and default the other way, so they are only
  // written when they are actually saying something.
  if (shape.strake === false) cleanShape.strake = false;
  if (shape.highWing === true) cleanShape.highWing = true;
  if (custom.length) {
    cleanShape.custom = custom;
    const box = String(shape.customBox ?? '').trim();
    // Only kept when it is four real numbers. A half typed box would scale the
    // art to nothing and look like the paths were wrong.
    const parts = box.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      cleanShape.customBox = parts.join(' ');
    }
  }

  return { value: { id, codes, name, drawn, span, length, shape: cleanShape } };
}

/** Photos on a family, by any of its codes. */
const photosUsingFamily = (codes) =>
  readLibrary()
    .filter((p) => codes.includes(p.typeCode))
    .map((p) => p.slug);

/**
 * The site's own generator, so that the preview in the editor is the drawing
 * the board will produce rather than an approximation of it. A second copy of
 * this geometry in the browser would drift, and the drift would only show up
 * once something was already published.
 *
 * Imported lazily because it is TypeScript and Node strips the types itself:
 * if that ever stops working, only the preview should break rather than the
 * whole studio.
 */
let planformModule = null;
async function drawPlanform(span, length, shape, reference) {
  planformModule ??= import('../src/lib/planform.ts');
  const { planform } = await planformModule;
  return planform(span, length, shape, reference);
}

/** What the board scales against: the largest thing on it. */
const scaleReference = () =>
  Math.max(...aircraftTypes.map((t) => Math.max(t.span, t.length)));

// --- projects ---------------------------------------------------------------

const PROJECTS = path.join(ROOT, 'src', 'content', 'projects');

const projectPath = (slug) => path.join(PROJECTS, `${slug}.md`);

/**
 * Split a markdown file into its frontmatter and its body.
 *
 * Returns null rather than guessing when the file does not open with a
 * frontmatter block, so a file this tool cannot read is shown as unreadable
 * instead of being silently rewritten into something else.
 */
function splitFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return {
    frontmatter: lines.slice(1, end).join('\n'),
    body: lines
      .slice(end + 1)
      .join('\n')
      .replace(/^\n+/, ''),
  };
}

function readProjects() {
  if (!fs.existsSync(PROJECTS)) return [];
  return fs
    .readdirSync(PROJECTS)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(PROJECTS, f), 'utf8');
      const parts = splitFrontmatter(raw);
      if (!parts) return { slug, unreadable: 'No frontmatter block' };
      try {
        return { slug, data: YAML.parse(parts.frontmatter) ?? {}, body: parts.body };
      } catch (err) {
        return { slug, unreadable: String(err?.message ?? err) };
      }
    })
    .sort((a, b) => (a.data?.order ?? 999) - (b.data?.order ?? 999));
}

/**
 * What the content schema insists on. Checking here means a missing title is
 * a message next to the field rather than a failed build ten minutes later,
 * with the site still serving the last good version in the meantime.
 */
function validateProject(data) {
  for (const key of ['title', 'summary', 'period']) {
    if (!String(data[key] ?? '').trim()) return `${key} cannot be empty`;
  }
  if (!Number.isFinite(data.order)) return 'order has to be a number';
  return null;
}

/** Where project photographs live, next to the write-ups that reference them. */
const PROJECT_IMAGES = path.join(PROJECTS, 'images');

/**
 * Store a dropped photograph beside the write-ups and return the path the
 * frontmatter should carry.
 *
 * Resized on the way in for the same reason the gallery does it: a 20 MP
 * original in the repository is bytes nobody ever downloads, since the build
 * generates its own sizes from whatever is here. Big enough that a full width
 * figure still has detail, and no bigger.
 */
async function storeImage(dir, slug, buffer) {
  fs.mkdirSync(dir, { recursive: true });

  // Never overwrite: two photographs of the same thing are the normal case.
  let n = 1;
  let name = `${slug}-${n}.jpg`;
  while (fs.existsSync(path.join(dir, name))) name = `${slug}-${++n}.jpg`;

  await sharp(buffer)
    .rotate() // honour the EXIF orientation flag before it is stripped
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(dir, name));

  return `./images/${name}`;
}

/** Only the keys the form owns, cleaned up, in a stable order. */
function cleanProject(input) {
  const data = {
    title: String(input.title ?? '').trim(),
    summary: String(input.summary ?? '').trim(),
    status: String(input.status ?? '').trim() || 'Active',
    period: String(input.period ?? '').trim(),
    order: Number(input.order ?? 0),
    // Rows with nothing in them are how a spec table ends up with holes.
    specs: (Array.isArray(input.specs) ? input.specs : [])
      .map((row) => ({
        label: String(row?.label ?? '').trim(),
        value: String(row?.value ?? '').trim(),
      }))
      .filter((row) => row.label || row.value),
    stack: (Array.isArray(input.stack) ? input.stack : [])
      .map((tool) => String(tool ?? '').trim())
      .filter(Boolean),
    // Kept in the order they arrive. A photograph with no path is not a
    // photograph, and the build would fail on it.
    photos: (Array.isArray(input.photos) ? input.photos : [])
      .map((photo) => ({
        src: String(photo?.src ?? '').trim(),
        alt: String(photo?.alt ?? '').trim(),
        caption: String(photo?.caption ?? '').trim(),
      }))
      .filter((photo) => photo.src),
    draft: Boolean(input.draft),
  };
  return data;
}

function writeProject(slug, data, body) {
  const frontmatter = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  fs.writeFileSync(projectPath(slug), `---\n${frontmatter}\n---\n\n${String(body).trim()}\n`);
}

/** Filename from the title: lowercase, words joined by hyphens, nothing else. */
function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// --- trips -------------------------------------------------------------------
//
// Same shape as the projects block above, because a trip write-up is the same
// kind of thing: frontmatter the form owns, a markdown body, and photographs
// stored next to it. The differences are the fields.

const TRIPS = path.join(ROOT, 'src', 'content', 'trips');
const TRIP_IMAGES = path.join(TRIPS, 'images');

const tripPath = (slug) => path.join(TRIPS, `${slug}.md`);

/**
 * The only three the content schema will accept.
 *
 * Sent to the page so the form can offer them as a dropdown. A free text box
 * here would let "complete" through, and the build would reject it an hour
 * later with the site still serving the old version.
 */
const TRIP_STATUSES = ['Planned', 'Ongoing', 'Complete'];

function readTrips() {
  if (!fs.existsSync(TRIPS)) return [];
  return fs
    .readdirSync(TRIPS)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(TRIPS, f), 'utf8');
      const parts = splitFrontmatter(raw);
      if (!parts) return { slug, unreadable: 'No frontmatter block' };
      try {
        return { slug, data: YAML.parse(parts.frontmatter) ?? {}, body: parts.body };
      } catch (err) {
        return { slug, unreadable: String(err?.message ?? err) };
      }
    })
    // Newest first, which is the order the index puts them in within a status.
    .sort((a, b) => String(b.data?.sort ?? '').localeCompare(String(a.data?.sort ?? '')));
}

function validateTrip(data) {
  for (const key of ['title', 'summary', 'date']) {
    if (!String(data[key] ?? '').trim()) return `${key} cannot be empty`;
  }
  // The sort key is what orders the index, and a wrong one moves the trip
  // silently rather than breaking anything, so it is checked strictly.
  if (!/^\d{4}-\d{2}$/.test(String(data.sort ?? ''))) {
    return 'Month has to look like 2026-07';
  }
  if (!TRIP_STATUSES.includes(data.status)) {
    return `Status has to be one of ${TRIP_STATUSES.join(', ')}`;
  }
  return null;
}

/** Only the keys the form owns, cleaned up, in a stable order. */
function cleanTrip(input) {
  return {
    title: String(input.title ?? '').trim(),
    summary: String(input.summary ?? '').trim(),
    date: String(input.date ?? '').trim(),
    sort: String(input.sort ?? '').trim(),
    status: String(input.status ?? '').trim(),
    where: String(input.where ?? '').trim(),
    photos: (Array.isArray(input.photos) ? input.photos : [])
      .map((photo) => ({
        src: String(photo?.src ?? '').trim(),
        alt: String(photo?.alt ?? '').trim(),
        caption: String(photo?.caption ?? '').trim(),
      }))
      .filter((photo) => photo.src),
    draft: Boolean(input.draft),
  };
}

function writeTrip(slug, data, body) {
  const frontmatter = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  fs.writeFileSync(tripPath(slug), `---\n${frontmatter}\n---\n\n${String(body).trim()}\n`);
}

function readLibrary() {
  if (!fs.existsSync(LIBRARY)) return [];
  return fs
    .readdirSync(LIBRARY)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const slug = f.replace(/\.json$/, '');
      return { slug, ...JSON.parse(fs.readFileSync(path.join(LIBRARY, f), 'utf8')) };
    })
    .sort((a, b) => String(b.shotAt).localeCompare(String(a.shotAt)));
}

async function git(...args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: ROOT,
      // No terminal is attached to this subprocess. Without this, an expired
      // credential makes `git push` block forever on a prompt nobody can see
      // and the Publish button just spins. Fail fast and show the error.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || String(err) };
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // --- page ------------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/') {
      const html = fs.readFileSync(path.join(HERE, 'studio.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // --- thumbnails: served straight from the library --------------------
    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      // basename() so a crafted path cannot climb out of the library folder.
      const file = path.join(LIBRARY, path.basename(url.pathname.slice(5)));
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }

    // --- a project photograph, for the thumbnails in the editor -----------
    if (req.method === 'GET' && url.pathname.startsWith('/project-img/')) {
      // basename() so a crafted path cannot climb out of the images folder.
      const file = path.join(PROJECT_IMAGES, path.basename(url.pathname.slice(13)));
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }

    // --- a trip photograph, for the thumbnails in the editor --------------
    if (req.method === 'GET' && url.pathname.startsWith('/trip-img/')) {
      // basename() so a crafted path cannot climb out of the images folder.
      const file = path.join(TRIP_IMAGES, path.basename(url.pathname.slice(10)));
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }

    // --- current state ---------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const status = await git('status', '--porcelain');
      const changed = status.ok ? status.out.split('\n').filter(Boolean) : [];
      return json(res, 200, {
        photos: readLibrary(),
        projects: readProjects(),
        trips: readTrips(),
        tripStatuses: TRIP_STATUSES,
        gaps: findGaps(),
        airports,
        typeCodes,
        aircraftTypes,
        // The board draws everything against its largest aeroplane, so the
        // editor's preview has to know the same number or a new type would be
        // previewed at one size and published at another.
        reference: scaleReference(),
        inbox: fs.existsSync(INBOX)
          ? fs.readdirSync(INBOX).filter((f) => /\.(jpe?g|png|tiff?|webp)$/i.test(f))
          : [],
        git: { available: status.ok, changed },
      });
    }

    // --- git status only -------------------------------------------------
    // Separate from /api/state so a save can refresh the Publish button
    // without re-sending every photo and re-rendering the cards underneath
    // whatever field is being edited.
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const status = await git('status', '--porcelain');
      return json(res, 200, {
        changed: status.ok ? status.out.split('\n').filter(Boolean) : [],
        gaps: findGaps(),
        photoCount: readLibrary().length,
      });
    }

    // --- save one photo --------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/save') {
      const { slug, patch } = JSON.parse((await readBody(req)).toString('utf8'));
      const file = sidecarPath(slug);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'no such photo' });

      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(patch)) {
        if (EDITABLE.has(k)) entry[k] = v;
      }

      // Guard the one field with a closed vocabulary. The content schema
      // rejects an unknown code at build time; failing here instead means the
      // mistake is visible while the person who made it is still looking.
      if (entry.airport && !airports[entry.airport]) {
        return json(res, 400, { error: `Unknown airport code: ${entry.airport}` });
      }

      fs.writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
      return json(res, 200, { ok: true, entry });
    }

    // --- save one project ------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/project') {
      const { slug, data, body } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!/^[a-z0-9-]+$/.test(String(slug))) return json(res, 400, { error: 'bad slug' });
      if (!fs.existsSync(projectPath(slug))) return json(res, 404, { error: 'no such project' });

      const clean = cleanProject(data);
      const problem = validateProject(clean);
      if (problem) return json(res, 400, { error: problem });

      // Anything in the file that this form does not know about is kept. The
      // schema can grow a key, or Griffin can add one by hand, and saving a
      // title from here must not quietly delete it. Same rule as the photo
      // sidecars: the editor owns its fields and nothing else.
      const existing = readProjects().find((p) => p.slug === slug);
      if (existing?.unreadable) return json(res, 400, { error: existing.unreadable });
      const merged = { ...(existing?.data ?? {}), ...clean };

      writeProject(slug, merged, body ?? '');
      return json(res, 200, { ok: true, data: merged });
    }

    // --- start a new project ----------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/project/new') {
      const { title } = JSON.parse((await readBody(req)).toString('utf8'));
      const base = slugify(title || 'new-project') || 'new-project';

      // Never overwrite an existing write-up because two of them happen to
      // start with the same word.
      let slug = base;
      let n = 2;
      while (fs.existsSync(projectPath(slug))) slug = `${base}-${n++}`;

      const order = Math.max(0, ...readProjects().map((p) => Number(p.data?.order ?? 0))) + 1;
      const data = cleanProject({
        title: String(title || '').trim() || 'Untitled project',
        // Placeholders the schema will accept, so the site keeps building
        // while this is half written. It is a draft until it is not.
        summary: 'One line about what this is',
        status: 'Active',
        period: String(new Date().getFullYear()),
        order,
        specs: [],
        stack: [],
        draft: true,
      });
      writeProject(slug, data, 'Write-up goes here.');
      return json(res, 200, { ok: true, slug });
    }

    // --- add a photograph to a project ------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/project/photo') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!/^[a-z0-9-]+$/.test(slug)) return json(res, 400, { error: 'bad slug' });

      const project = readProjects().find((p) => p.slug === slug);
      if (!project) return json(res, 404, { error: 'no such project' });
      if (project.unreadable) return json(res, 400, { error: project.unreadable });

      const name = path.basename(url.searchParams.get('name') ?? '');
      if (!/\.(jpe?g|png|tiff?|webp|heic)$/i.test(name)) {
        return json(res, 400, { error: `Not an image: ${name}` });
      }

      const src = await storeImage(PROJECT_IMAGES, slug, await readBody(req));
      const data = cleanProject({
        ...project.data,
        photos: [...(project.data.photos ?? []), { src, alt: '', caption: '' }],
      });
      writeProject(slug, { ...project.data, ...data }, project.body);
      return json(res, 200, { ok: true, src });
    }

    // --- save one trip ----------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/trip') {
      const { slug, data, body } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!/^[a-z0-9-]+$/.test(String(slug))) return json(res, 400, { error: 'bad slug' });
      if (!fs.existsSync(tripPath(slug))) return json(res, 404, { error: 'no such trip' });

      const clean = cleanTrip(data);
      const problem = validateTrip(clean);
      if (problem) return json(res, 400, { error: problem });

      // Anything in the file this form does not know about is kept, the same
      // rule the projects editor follows.
      const existing = readTrips().find((t) => t.slug === slug);
      if (existing?.unreadable) return json(res, 400, { error: existing.unreadable });

      writeTrip(slug, { ...(existing?.data ?? {}), ...clean }, body ?? '');
      return json(res, 200, { ok: true });
    }

    // --- start a new trip -------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/trip/new') {
      const { title } = JSON.parse((await readBody(req)).toString('utf8'));
      const base = slugify(title || 'new-trip') || 'new-trip';

      let slug = base;
      let n = 2;
      while (fs.existsSync(tripPath(slug))) slug = `${base}-${n++}`;

      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const data = cleanTrip({
        title: String(title || '').trim() || 'Untitled trip',
        // Placeholders the schema accepts, so the site keeps building while
        // this is half written. It is a draft until it is not.
        summary: 'One line about where this was',
        date: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        sort: month,
        status: 'Planned',
        where: '',
        photos: [],
        draft: true,
      });
      fs.mkdirSync(TRIPS, { recursive: true });
      writeTrip(slug, data, 'Write-up goes here.');
      return json(res, 200, { ok: true, slug });
    }

    // --- add a photograph to a trip ---------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/trip/photo') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!/^[a-z0-9-]+$/.test(slug)) return json(res, 400, { error: 'bad slug' });

      const trip = readTrips().find((t) => t.slug === slug);
      if (!trip) return json(res, 404, { error: 'no such trip' });
      if (trip.unreadable) return json(res, 400, { error: trip.unreadable });

      const name = path.basename(url.searchParams.get('name') ?? '');
      if (!/\.(jpe?g|png|tiff?|webp|heic)$/i.test(name)) {
        return json(res, 400, { error: `Not an image: ${name}` });
      }

      const src = await storeImage(TRIP_IMAGES, slug, await readBody(req));
      const clean = cleanTrip({
        ...trip.data,
        photos: [...(trip.data.photos ?? []), { src, alt: '', caption: '' }],
      });
      writeTrip(slug, { ...trip.data, ...clean }, trip.body);
      return json(res, 200, { ok: true, src });
    }

    // --- accept a dropped file ------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const name = path.basename(url.searchParams.get('name') ?? '');
      if (!/\.(jpe?g|png|tiff?|webp)$/i.test(name)) {
        return json(res, 400, { error: `Not an image: ${name}` });
      }
      fs.mkdirSync(INBOX, { recursive: true });
      fs.writeFileSync(path.join(INBOX, name), await readBody(req));
      return json(res, 200, { ok: true, name });
    }

    // --- run the importer over the inbox ---------------------------------
    if (req.method === 'POST' && url.pathname === '/api/import') {
      const lines = [];
      const { imported } = await runImport({ log: (l) => lines.push(l) });
      return json(res, 200, { ok: true, log: lines, count: imported.length });
    }

    // --- commit and push -------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/publish') {
      const { message } = JSON.parse((await readBody(req)).toString('utf8'));
      const status = await git('status', '--porcelain');
      if (!status.ok) return json(res, 400, { error: 'Not a git repository' });
      if (!status.out) return json(res, 200, { ok: true, log: ['Nothing to publish'] });

      /**
       * Publish stages ONLY what the studio itself writes.
       *
       * It used to run `git add -A`, and that is a trap. This button sits next
       * to a text field, so it reads like "save my edit", but it was
       * committing and pushing the whole working tree: changing one word on a
       * project page shipped every unfinished thing in the repository, live,
       * with nobody having looked at it. Anything outside these folders is now
       * left alone and named in the log instead.
       */
      const OWNED_DIRS = ['src/content/photos', 'src/content/projects', 'src/content/trips'];

      /**
       * Named one file at a time rather than as `src/data`, on purpose. The
       * studio writes exactly these two files in that folder and nothing else
       * in it; staging the directory would sweep up drives.json, peaks.json
       * and the rest, which is the same trap as `git add -A` in a smaller
       * shape.
       */
      const OWNED_FILES = ['src/data/airports.json', 'src/data/aircraft-types.json'];
      const OWNED = [...OWNED_DIRS, ...OWNED_FILES];
      const owns = (f) => OWNED_DIRS.some((d) => f.startsWith(`${d}/`)) || OWNED_FILES.includes(f);

      const changed = status.out
        .split('\n')
        .filter(Boolean)
        // Porcelain is one or two status characters, whitespace, then the
        // path. Matched rather than sliced at a fixed offset, because the git
        // helper trims its output and that eats the leading space on the very
        // first line, which was quietly cutting a character off that path. A
        // rename reads "old -> new", and the new name is the one to stage.
        .map((line) =>
          line
            .trim()
            .replace(/^[A-Z?!]{1,2}\s+/, '')
            .split(' -> ')
            .pop()
            .replace(/^"|"$/g, ''),
        );

      const mine = changed.filter(owns);
      const others = changed.filter((f) => !owns(f));

      const note = others.length
        ? [
            `Left alone, because the studio did not write ${others.length === 1 ? 'it' : 'them'}:`,
            ...others.map((f) => `  ${f}`),
          ]
        : [];

      if (mine.length === 0) {
        return json(res, 200, { ok: true, log: ['Nothing of yours to publish.', ...note] });
      }

      const log = [];
      for (const step of [
        ['add', '--', ...OWNED],
        ['commit', '-m', message || 'Update photos'],
        ['push'],
      ]) {
        const r = await git(...step);
        log.push(`$ git ${step[0]} ${step[0] === 'add' ? '(content only)' : ''}\n${r.out}`);
        if (!r.ok) return json(res, 500, { error: `git ${step[0]} failed`, log });
      }
      return json(res, 200, { ok: true, log: [...log, ...note] });
    }

    // --- airports --------------------------------------------------------

    if (req.method === 'GET' && url.pathname === '/api/airport/lookup') {
      const code = String(url.searchParams.get('icao') ?? '').trim().toUpperCase();
      if (!ICAO.test(code)) return json(res, 400, { error: 'Give a three or four character code' });
      try {
        const found = await lookupAirport(code);
        if (!found) return json(res, 404, { error: `OurAirports has nothing under ${code}` });
        return json(res, 200, { ok: true, airport: found });
      } catch (err) {
        return json(res, 502, { error: `Lookup failed: ${err?.message ?? err}` });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/airport') {
      const { existing, airport } = JSON.parse((await readBody(req)).toString('utf8'));
      const { error, value } = validateAirport(airport, existing ?? null);
      if (error) return json(res, 400, { error });

      const next = { ...airports };

      // Changing the code is a delete and an add. The photo sidecars store the
      // old one, so it has to be off every photo first or they would point at
      // a code that no longer exists and fail the content schema at build.
      if (existing && existing !== value.icao) {
        const inUse = photosUsingAirport(existing);
        if (inUse.length) {
          return json(res, 400, {
            error:
              `${existing} is on ${inUse.length} photo${inUse.length === 1 ? '' : 's'}. ` +
              'Move those to another airport first, or the build will fail on them.',
            photos: inUse,
          });
        }
        delete next[existing];
      }

      next[value.icao] = value;
      writeJson(AIRPORTS_FILE, next);
      airports = readJson(AIRPORTS_FILE);
      return json(res, 200, { ok: true, airports });
    }

    if (req.method === 'POST' && url.pathname === '/api/airport/delete') {
      const { icao } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!airports[icao]) return json(res, 404, { error: 'No such airport' });

      const inUse = photosUsingAirport(icao);
      if (inUse.length) {
        return json(res, 400, {
          error:
            `${icao} is on ${inUse.length} photo${inUse.length === 1 ? '' : 's'} and cannot go yet.`,
          photos: inUse,
        });
      }

      const next = { ...airports };
      delete next[icao];
      writeJson(AIRPORTS_FILE, next);
      airports = readJson(AIRPORTS_FILE);
      return json(res, 200, { ok: true, airports });
    }

    // --- aircraft types --------------------------------------------------

    /**
     * Draws a shape without saving it, so the sliders have something to move.
     * Runs the site's own generator rather than anything written for this
     * page: what comes back is what the board will draw.
     */
    if (req.method === 'POST' && url.pathname === '/api/aircraft/preview') {
      const { span, length, shape, reference } = JSON.parse((await readBody(req)).toString('utf8'));
      const s = Number(span);
      const l = Number(length);
      if (!(s > 0) || !(l > 0)) return json(res, 400, { error: 'Span and length size the drawing' });
      try {
        const ref = Number(reference) > 0 ? Number(reference) : Math.max(s, l);
        return json(res, 200, { ok: true, drawing: await drawPlanform(s, l, shape, ref) });
      } catch (err) {
        return json(res, 400, { error: `Could not draw that: ${err?.message ?? err}` });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/aircraft') {
      const { existing, family } = JSON.parse((await readBody(req)).toString('utf8'));
      const { error, value } = validateFamily(family, existing ?? null);
      if (error) return json(res, 400, { error });

      const next = [...aircraftTypes];
      const at = existing ? next.findIndex((t) => t.id === existing) : -1;
      if (at >= 0) next[at] = value;
      else next.push(value);

      writeJson(AIRCRAFT_FILE, next);
      aircraftTypes = readJson(AIRCRAFT_FILE);
      typeCodes = deriveTypeCodes();
      return json(res, 200, {
        ok: true,
        aircraftTypes,
        typeCodes,
        reference: scaleReference(),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/aircraft/delete') {
      const { id } = JSON.parse((await readBody(req)).toString('utf8'));
      const family = aircraftTypes.find((t) => t.id === id);
      if (!family) return json(res, 404, { error: 'No such family' });

      // Not a build failure the way a missing airport is: the photo keeps
      // showing in the gallery and quietly stops reaching the board. Silent is
      // the reason to refuse rather than a reason not to.
      const inUse = photosUsingFamily(family.codes);
      if (inUse.length) {
        return json(res, 400, {
          error:
            `${family.name} is on ${inUse.length} photo${inUse.length === 1 ? '' : 's'}. ` +
            'Deleting it would drop them off the board without saying so.',
          photos: inUse,
        });
      }

      writeJson(AIRCRAFT_FILE, aircraftTypes.filter((t) => t.id !== id));
      aircraftTypes = readJson(AIRCRAFT_FILE);
      typeCodes = deriveTypeCodes();
      return json(res, 200, {
        ok: true,
        aircraftTypes,
        typeCodes,
        reference: scaleReference(),
      });
    }

    res.writeHead(404);
    res.end('not found');
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

const address = `http://localhost:${PORT}`;

/** Best effort. If it fails the URL is printed in the console anyway. */
function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', address], () => {});
  else if (process.platform === 'darwin') execFile('open', [address], () => {});
  else execFile('xdg-open', [address], () => {});
}

/**
 * A second copy is not an error worth a stack trace.
 *
 * Double clicking the launcher twice is the most likely way to get here, and
 * the first copy is already serving the page. Open that instead of printing
 * an EADDRINUSE trace at someone who only wanted to edit a caption.
 */
server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.log(`\n  Studio is already open at ${address}\n`);
    openBrowser();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Studio  ${address}\n`);
  console.log(`  Photos    ${path.relative(ROOT, LIBRARY)}`);
  console.log(`  Inbox     ${path.relative(ROOT, INBOX)}`);
  console.log(`  Projects  ${path.relative(ROOT, PROJECTS)}`);
  console.log('\n  Close this window to stop.\n');

  openBrowser();
});
