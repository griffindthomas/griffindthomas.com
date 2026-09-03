/**
 * Snaps the drive waypoints to real roads and works out the overlap.
 *
 * Run by hand: `node scripts/build-drives.mjs`. Reads the waypoints out of
 * src/data/drives.json, routes them through OSRM against OpenStreetMap, and
 * writes src/data/drive-routes.json. Both files are committed and the site
 * never routes anything at request time.
 *
 * Why routed rather than drawn: a curve between two cities is a lie that looks
 * like a map. The Snake River plain, the way I-90 bends north around the Big
 * Horns, the Trans-Canada threading the Fraser Canyon: none of that survives a
 * bezier, and all of it is the reason the drawing is worth having.
 *
 * THE OVERLAP IS THE POINT. Eight crossings mostly share one road, and what
 * the map is really about is which stretches have been driven five times and
 * which once. So the routes are broken onto a common grid, each cell is
 * counted for how many DISTINCT drives pass through it, and the line is
 * weighted by that count. I-90 across Montana ends up nearly black.
 *
 * Each cell is then drawn from exactly one drive's geometry, chosen as the
 * lowest id passing through it. That keeps real road shape on the page: the
 * grid decides the weight, it never decides the line.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { albers, bounds, simplify, toPath } from './lib/geo.mjs';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
/** Waypoints per request, with one shared as the joint between chunks. */
const CHUNK = 12;
const PAUSE = 900;
const RETRIES = 4;

/**
 * Projected units. The lower 48 comes out about 900 wide, so one unit is
 * roughly 6 km and a cell is a little over 5 km across. Small enough that two
 * roads parting company land in different cells quickly, and still far coarser
 * than the gap between two carriageways of one interstate.
 */
const CELL = 0.9;
/** Distance between resampled points along a route, projected units. */
const STEP = 0.5;
/** Simplification for the drawn lines. Under half a pixel at drawn size. */
const TOLERANCE = 0.4;

const M_PER_MILE = 1609.344;
/**
 * The raw projection works in Earth radii, so one projected unit at the scale
 * used here is this many kilometres. Only used for the checks printed below.
 */
const KM_PER_UNIT = 6371 / 1070;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Routed geometry, cached between runs.
 *
 * The router is a free public server. Re-running this to re-tune the drawing
 * should not re-ask it for eight transcontinental routes, so the answers are
 * kept and only a changed waypoint list (or `--refresh`) asks again.
 */
const CACHE = new URL('../.cache/drive-lines.json', import.meta.url);

function loadCache() {
  if (process.argv.includes('--refresh') || !existsSync(CACHE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

/** Changes when a waypoint does, so stale geometry is never silently reused. */
const fingerprint = (drive) => JSON.stringify(drive.waypoints);

async function osrm(points) {
  const path = points.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const url = `${OSRM}/${path}?overview=full&geometries=geojson`;

  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      if (body.code !== 'Ok') throw new Error(`OSRM said ${body.code}: ${body.message ?? ''}`);
      return body.routes[0];
    } catch (err) {
      if (attempt === RETRIES - 1) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error('unreachable');
}

/**
 * One drive, routed in chunks and stitched.
 *
 * Chunks overlap by a waypoint so the joint is a point both legs actually
 * pass through, which is what keeps the seam from showing as a jump.
 */
async function routeDrive(drive) {
  const points = drive.waypoints.map(([, lon, lat]) => [lon, lat]);
  const line = [];
  let metres = 0;

  for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
    const chunk = points.slice(i, i + CHUNK);
    if (chunk.length < 2) break;
    const route = await osrm(chunk);
    metres += route.distance;
    const coords = route.geometry.coordinates;
    // Drop the joint: the previous chunk already ended on it.
    line.push(...(line.length > 0 ? coords.slice(1) : coords));
    await sleep(PAUSE);
  }

  return { line, miles: metres / M_PER_MILE };
}

/**
 * Points exactly `step` apart along a polyline, so no cell it crosses is
 * missed and no cell is entered twice by a cluster of near-identical points.
 *
 * Even spacing is what makes the counting trustworthy. Walking the line and
 * emitting a point every step, rather than emitting the source vertices too,
 * keeps a stretch with dense OSRM geometry from outweighing a straight one.
 */
function resample(line, step) {
  const out = [line[0]];
  let [x0, y0] = line[0];

  for (let i = 1; i < line.length; i += 1) {
    const [x1, y1] = line[i];
    let d = Math.hypot(x1 - x0, y1 - y0);
    while (d >= step) {
      const t = step / d;
      x0 += (x1 - x0) * t;
      y0 += (y1 - y0) * t;
      out.push([x0, y0]);
      d = Math.hypot(x1 - x0, y1 - y0);
    }
  }
  return out;
}

/** Length of a projected polyline, in kilometres. */
function lengthKm(points) {
  let units = 0;
  for (let i = 1; i < points.length; i += 1) {
    units += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return units * KM_PER_UNIT;
}

const cellKey = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;

async function main() {
  const data = JSON.parse(readFileSync(new URL('../src/data/drives.json', import.meta.url), 'utf8'));
  const project = albers();

  {
    const cache = loadCache();
    const fresh = {};
    const routed = [];
    let totalMiles = 0;
    console.log('drive               road   cars   vehicle mi   source');
    console.log('-'.repeat(58));

    for (const drive of data.drives) {
      const key = String(drive.id);
      const hit = cache[key] && cache[key].fingerprint === fingerprint(drive) ? cache[key] : null;
      const { line, miles } = hit ?? (await routeDrive(drive));
      fresh[key] = { fingerprint: fingerprint(drive), line, miles };

      const projected = line.map(([lon, lat]) => project(lon, lat));
      // Rounded to the nearest mile. The road is known to about that.
      routed.push({ id: drive.id, projected, miles: Math.round(miles) });
      totalMiles += miles;

      console.log(
        `${`${drive.id} ${drive.date}`.padEnd(16)} ${miles.toFixed(0).padStart(8)} ` +
          `${String(drive.vehicles.length).padStart(6)} ` +
          `${(miles * drive.vehicles.length).toFixed(0).padStart(9)}   ${hit ? 'cached' : 'routed'}`,
      );
    }

    mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(fresh));

    // --- Count the overlap. -------------------------------------------------
    const dense = routed.map((r) => ({ id: r.id, points: resample(r.projected, STEP) }));

    /** Cell -> the set of drives that pass through it. */
    const visitors = new Map();
    for (const { id, points } of dense) {
      for (const [x, y] of points) {
        const key = cellKey(x, y);
        let set = visitors.get(key);
        if (!set) visitors.set(key, (set = new Set()));
        set.add(id);
      }
    }

    /**
     * Walk each drive and cut its line wherever the count changes, so every
     * run sits at exactly one weight.
     *
     * Nothing is skipped. An earlier version let only one drive draw each
     * cell, to stop coincident strokes darkening one another, and that put
     * holes in the map: a cell is kilometres across and two routes can cross
     * the same one heading different ways, so whichever route did not own the
     * cell lost that piece of itself. Illinois had a visible gap in it where
     * the Chicago routes part company.
     *
     * Overlap is handled in the drawing instead. All the runs at one weight go
     * out as a single path, and a stroke is painted once per element however
     * often it doubles back over itself, so roads that coincide stack without
     * going darker.
     */
    const runs = new Map();
    for (const { points } of dense) {
      let current = null;
      let level = null;

      const flush = () => {
        if (current && current.length > 1) {
          if (!runs.has(level)) runs.set(level, []);
          runs.get(level).push(current);
        }
        current = null;
        level = null;
      };

      for (const point of points) {
        const count = visitors.get(cellKey(point[0], point[1])).size;
        if (current === null || count !== level) {
          // Carry the previous point into the new run, so a change of weight
          // is a join rather than a gap in the line.
          const bridge = current !== null ? current[current.length - 1] : null;
          flush();
          current = bridge ? [bridge, point] : [point];
          level = count;
          continue;
        }
        current.push(point);
      }
      flush();
    }

    const levels = [...runs.keys()]
      .sort((a, b) => a - b)
      .map((count) => ({
        count,
        d: toPath(
          runs.get(count).map((run) => simplify(run, TOLERANCE)),
          1,
          false,
        ),
      }));

    const drivePaths = routed.map((r) => ({
      id: r.id,
      /**
       * Road miles for this drive, one car. This is what the site prints:
       * the distance the roads actually add up to, rather than a figure
       * remembered afterwards.
       */
      miles: r.miles,
      d: toPath([simplify(r.projected, TOLERANCE)], 1, false),
    }));

    const all = routed.flatMap((r) => r.projected);
    const b = bounds(all);

    writeFileSync(
      new URL('../src/data/drive-routes.json', import.meta.url),
      `${JSON.stringify(
        {
          source: 'OSRM against OpenStreetMap, routed once and committed',
          builtAt: new Date().toISOString().slice(0, 10),
          cellUnits: CELL,
          maxCount: Math.max(...levels.map((l) => l.count)),
          routeBounds: {
            minX: Number(b.minX.toFixed(1)),
            minY: Number(b.minY.toFixed(1)),
            maxX: Number(b.maxX.toFixed(1)),
            maxY: Number(b.maxY.toFixed(1)),
          },
          levels,
          drives: drivePaths,
        },
        null,
        1,
      )}\n`,
    );

    console.log('\noverlap              drawn        unique road');
    let drawnKm = 0;
    let uniqueKm = 0;
    for (const level of levels) {
      const km = runs.get(level.count).reduce((sum, run) => sum + lengthKm(run), 0);
      drawnKm += km;
      uniqueKm += km / level.count;
      console.log(
        `  driven ${String(level.count).padStart(2)}x     ${km.toFixed(0).padStart(8)} km ` +
          `${(km / level.count).toFixed(0).padStart(12)} km`,
      );
    }

    /**
     * The check that says nothing is being dropped. Every drive now draws the
     * whole of itself, so the total drawn has to come back to the distance
     * actually driven.
     */
    const drivenKm = totalMiles * 1.609344;
    const error = (drawnKm / drivenKm - 1) * 100;
    console.log(`  ${'-'.repeat(44)}`);
    console.log(`  drawn            ${drawnKm.toFixed(0).padStart(11)} km`);
    console.log(`  unique road      ${uniqueKm.toFixed(0).padStart(11)} km`);
    console.log(`  actually driven  ${drivenKm.toFixed(0).padStart(11)} km   (${error >= 0 ? '+' : ''}${error.toFixed(1)}%)`);

    console.log(`\nwrote src/data/drive-routes.json`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
