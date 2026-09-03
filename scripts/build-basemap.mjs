/**
 * Projects state and province boundaries into SVG path data.
 *
 * Run by hand: `node scripts/build-basemap.mjs`. Writes two files, both
 * committed, and neither the source geometry nor a projection library ever
 * reaches the browser.
 *
 *   src/data/map-drive.json    the lower 48 plus southern Canada, on one cone,
 *                              because a crossing that goes to Banff needs
 *                              ground under it north of the border
 *   src/data/map-states.json   the standard composite, with Alaska and Hawaii
 *                              moved into the corner, because the states map
 *                              has to be able to show Alaska empty
 *
 * Source is Natural Earth 1:50m admin-1, cached in .cache/ on first run. It is
 * public domain, which is why it is used here rather than TIGER: same
 * boundaries, one file, no shapefile conversion step.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { albers, albersUsa, bounds, ringsOf, simplify, toPath } from './lib/geo.mjs';

const SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';
const CACHE = new URL('../.cache/ne_50m_admin_1_states_provinces.geojson', import.meta.url);

/** Projected units. About four tenths of a pixel at the size these draw. */
const TOLERANCE = 0.35;
/** Rings smaller than this in both directions are below a pixel: dropped. */
const MIN_RING = 1.2;

/** Provinces the driving map needs. The rest of Canada is off the top. */
const PROVINCES = new Set([
  'British Columbia',
  'Alberta',
  'Saskatchewan',
  'Manitoba',
  'Ontario',
  'Quebec',
  'New Brunswick',
  'Nova Scotia',
  'Prince Edward Island',
]);

async function source() {
  if (!existsSync(CACHE)) {
    mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true });
    process.stdout.write('downloading Natural Earth 1:50m admin-1 ... ');
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE}`);
    await writeFile(CACHE, Buffer.from(await res.arrayBuffer()));
    console.log('done');
  }
  return JSON.parse(await readFile(CACHE, 'utf8'));
}

/**
 * One feature's rings, projected and thinned.
 *
 * Simplification runs AFTER projection on purpose. A tolerance in degrees means
 * something different in Florida from what it means in Alberta, and thinning to
 * a tolerance measured in the units the thing is actually drawn in is the only
 * way to say "half a pixel" and have it be true everywhere.
 */
function projectFeature(geometry, project) {
  const out = [];
  for (const ring of ringsOf(geometry)) {
    const projected = ring.map(([lon, lat]) => project(lon, lat));
    const b = bounds(projected);
    if (b.maxX - b.minX < MIN_RING && b.maxY - b.minY < MIN_RING) continue;
    const thinned = simplify(projected, TOLERANCE);
    if (thinned.length >= 3) out.push(thinned);
  }
  return out;
}

const collect = (groups) => groups.flat();

const box = (b, pad = 0) =>
  [b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2]
    .map((v) => Number(v.toFixed(2)))
    .join(' ');

async function main() {
  const geo = await source();
  const features = geo.features;

  const usFeatures = features.filter((f) => f.properties.iso_a2 === 'US');
  const caFeatures = features.filter(
    (f) => f.properties.iso_a2 === 'CA' && PROVINCES.has(f.properties.name),
  );

  // --- Driving map: one cone, no insets. ---------------------------------
  const drive = albers();
  const lower48 = usFeatures.filter(
    (f) => f.properties.postal !== 'AK' && f.properties.postal !== 'HI',
  );

  const driveStates = lower48
    .map((f) => ({
      code: f.properties.postal,
      name: f.properties.name,
      rings: projectFeature(f.geometry, drive),
    }))
    .filter((s) => s.rings.length > 0);

  const driveCanada = caFeatures.flatMap((f) => projectFeature(f.geometry, drive));

  /**
   * The bounds of the lower 48 only. The frame is worked out on the page, by
   * taking these together with how far the routes actually reach, so a drive
   * to Banff pulls the top edge up and nothing else does. Framing to a lat/lon
   * rectangle instead left a third of the drawing as empty Pacific, because a
   * cone spreads the far corners of a rectangle a long way apart.
   */
  const driveBounds = bounds(collect(driveStates.map((s) => collect(s.rings))));

  writeFileSync(
    new URL('../src/data/map-drive.json', import.meta.url),
    `${JSON.stringify(
      {
        source: 'Natural Earth 1:50m admin-1 (public domain)',
        projection: 'Albers equal area conic, standard parallels 29.5 and 45.5',
        bounds: {
          minX: Number(driveBounds.minX.toFixed(1)),
          minY: Number(driveBounds.minY.toFixed(1)),
          maxX: Number(driveBounds.maxX.toFixed(1)),
          maxY: Number(driveBounds.maxY.toFixed(1)),
        },
        states: driveStates.map((s) => ({ code: s.code, name: s.name, d: toPath(s.rings) })),
        canada: toPath(driveCanada),
      },
      null,
      1,
    )}\n`,
  );

  // --- States map: the composite, so Alaska and Hawaii can be drawn. ------
  const usa = albersUsa();
  const pick = (postal) =>
    postal === 'AK' ? usa.alaska : postal === 'HI' ? usa.hawaii : usa.lower48;

  const stateShapes = usFeatures
    .map((f) => ({
      code: f.properties.postal,
      name: f.properties.name,
      rings: projectFeature(f.geometry, pick(f.properties.postal)),
    }))
    .filter((s) => s.rings.length > 0);

  const statesBox = bounds(collect(stateShapes.map((s) => collect(s.rings))));

  writeFileSync(
    new URL('../src/data/map-states.json', import.meta.url),
    `${JSON.stringify(
      {
        source: 'Natural Earth 1:50m admin-1 (public domain)',
        projection:
          'Albers USA composite. Alaska is drawn at about a third scale and moved, which is the convention on a printed US map and is not its real size.',
        viewBox: box(statesBox, 4),
        states: stateShapes.map((s) => ({ code: s.code, name: s.name, d: toPath(s.rings) })),
      },
      null,
      1,
    )}\n`,
  );

  const kb = (name) =>
    `${(statSync(new URL(`../src/data/${name}`, import.meta.url)).size / 1024).toFixed(0)} kB`;
  console.log(
    `map-drive.json   ${driveStates.length} states, ${driveCanada.length} Canadian rings, ${kb('map-drive.json')}`,
  );
  console.log(`map-states.json  ${stateShapes.length} states, ${kb('map-states.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
