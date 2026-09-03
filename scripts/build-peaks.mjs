/**
 * Samples real terrain and writes the elevation ladder's profiles.
 *
 * Run by hand, not at build time: `node scripts/build-peaks.mjs`. The output is
 * committed, so the site never depends on a third party being up, and two
 * builds of the same commit draw the same mountains.
 *
 * Source is USGS 3DEP at 10 m (`ned10m`), served by OpenTopoData. One dataset
 * for every peak including Kilauea, so nothing on the ladder is sampled at a
 * different resolution from anything else. Elevations come back in metres.
 *
 * Method, fixed for every peak so the silhouettes can be compared:
 *   - a cross-section 8 miles wide, centred on the summit, running west to
 *     east unless the peak carries a bearing (Kilauea is the one that does)
 *   - sampled every 34 m, which is just over a pixel at the size these draw
 *   - simplified with Douglas-Peucker, then written as plain [x, z] pairs
 *
 * Coordinates are published summit positions. Before sampling, each one is
 * snapped to the highest point within about 700 m, which corrects a coordinate
 * that is a few hundred metres off without letting it wander onto a
 * neighbouring mountain. The snapped height is printed against the official
 * figure as a check: if those two disagree badly, the coordinate is wrong.
 */
import { writeFileSync } from 'node:fs';

const API = 'https://api.opentopodata.org/v1/ned10m';
/** Free tier: one call a second, a hundred locations a call. */
const BATCH = 100;
const PAUSE = 1100;

/**
 * Half width of the cross-section, metres. 4 miles each side, so every profile
 * is 8 miles across and the flanks run out past the frame edges.
 *
 * It started at 15 miles, which was far too wide: at that range a section
 * through a peak inside a ridge system picks up three or four unrelated ridges
 * of much the same height, and those neighbours pull the eye off the mountain
 * the line is about. Narrowing to eight fixed most of that but not all of it,
 * and narrowing further would not have fixed the rest either, because the one
 * summit still in frame is only two and a half miles out. That is what
 * drawnSpan below is for, and with it doing the work eight miles is a width
 * the drawing can carry.
 */
const M_PER_MILE = 1609.344;
const HALF = 4 * M_PER_MILE;
/**
 * Samples across the full 8 miles. 385 puts one every 1/48 of a mile, about
 * 34 m of ground, which is a couple of pixels at the size the ladder draws.
 */
const SAMPLES = 385;
const STEP = (HALF * 2) / (SAMPLES - 1);
/** Douglas-Peucker tolerance, metres. Well under a pixel at drawn size. */
const TOLERANCE = 5;

const M_PER_FT = 0.3048;
const M_PER_DEG_LAT = 111320;

/**
 * `snap: false` for anywhere that is not a summit. Gothic Basin is a bowl, and
 * hunting for the highest point near it would find the wall above it and draw
 * that instead.
 */
const PEAKS = [
  { id: 'rainier', name: 'Mount Rainier', ft: 14411, lat: 46.85287, lon: -121.7604, summited: false },
  { id: 'adams', name: 'Mount Adams', ft: 12281, lat: 46.20241, lon: -121.49059, summited: false },
  { id: 'hood', name: 'Mount Hood', ft: 11249, lat: 45.373505, lon: -121.6958, summited: false },
  { id: 'baker', name: 'Mount Baker', ft: 10781, lat: 48.77673, lon: -121.81311, summited: false },
  { id: 'glacier', name: 'Glacier Peak', ft: 10541, lat: 48.1122, lon: -121.1135, summited: false },
  { id: 'st-helens', name: 'Mount St. Helens', ft: 8363, lat: 46.1912, lon: -122.1944, summited: true },
  { id: 'green', name: 'Green Mountain', ft: 6600, lat: 48.29138, lon: -121.24069, summited: true },
  { id: 'mcneil', name: 'McNeil Peak', ft: 6575, lat: 46.69773, lon: -121.274821, summited: true },
  { id: 'hannegan', name: 'Hannegan Peak', ft: 6187, lat: 48.892222, lon: -121.534298, summited: true },
  { id: 'gothic', name: 'Gothic Basin', ft: 5043, lat: 47.98389, lon: -121.46722, summited: true, snap: false },
  // Due east from Kilauea's summit misses Kilauea Iki by about 800 m, and the
  // hike is both craters, so this section is turned onto the line from the
  // summit through Iki's centre instead. It reads: off the caldera rim, across
  // the caldera floor, over Keanakakoi, down into Iki and up Puu Puai. A
  // section is a section whatever way it is pointed, and everything the
  // drawing compares, height and ground distance, survives the turn.
  {
    id: 'kilauea',
    name: 'Kilauea',
    ft: 4091,
    lat: 19.4211,
    lon: -155.287,
    summited: true,
    bearing: 100.4,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Metres of longitude per degree, which shrinks as you go north. */
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/**
 * One batched lookup. Throws rather than substituting a zero: a hole in a
 * profile would draw as a canyon through the mountain and look deliberate.
 */
async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const slice = points.slice(i, i + BATCH);
    const locations = slice.map(([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join('|');
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations, interpolation: 'bilinear' }),
    });
    if (!res.ok) throw new Error(`${API}: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    if (body.status !== 'OK') throw new Error(`${API}: ${body.status} ${body.error ?? ''}`);
    for (const r of body.results) {
      if (r.elevation === null || !Number.isFinite(r.elevation)) {
        throw new Error(`no data at ${r.location.lat},${r.location.lng}`);
      }
      out.push(r.elevation);
    }
    if (i + BATCH < points.length) await sleep(PAUSE);
  }
  return out;
}

/** Highest point on a small grid around a coordinate. */
async function snapToSummit(peak) {
  const span = 0.006;
  const n = 13;
  const points = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      points.push([
        peak.lat + span * (i / (n - 1) - 0.5) * 2,
        peak.lon + span * (j / (n - 1) - 0.5) * 2,
      ]);
    }
  }
  const z = await elevations(points);
  let best = 0;
  for (let i = 1; i < z.length; i += 1) if (z[i] > z[best]) best = i;
  return { lat: points[best][0], lon: points[best][1], elevation: z[best] };
}

/** Perpendicular distance from p to the line ab, in the units of both. */
function perpendicular(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/**
 * Where the drawn line has to stop, as [westX, eastX] in metres.
 *
 * A transect through a peak that sits inside a ridge system can run clean over
 * something bigger than the peak itself. Hannegan is the case here: not far
 * west of it the ground reaches 7,120 ft, near a thousand feet above
 * Hannegan's own summit, because that is Mount Sefrit and it is a different
 * mountain. Drawn in the same ink it reads as part of the climb, and it is the
 * tallest thing in that half of the picture, so it takes the eye as well.
 *
 * The rule: walking out from the summit, the line stops at the lowest point
 * reached before the ground climbs back above that summit. That low point is
 * the saddle, and past a saddle you are on the next mountain. Only the ink
 * stops. The filled shape still runs the full width, so the occlusion that
 * makes the peaks nest is untouched.
 *
 * The saddle has to be a real one. Two samples either side of a summit are
 * within centimetres of it and one of them is usually the higher, so without
 * SADDLE_DROP every peak here cuts itself off at its own summit. Requiring a
 * five hundred foot descent first is what separates a different mountain from
 * the far side of this one.
 *
 * Every peak is put through this, and the ones it says nothing about are
 * drawn edge to edge exactly as before.
 */
const SADDLE_DROP_M = 150;

function drawnSpan(profile) {
  // The peak he climbed is at x = 0. Not the tallest thing in the profile:
  // for Hannegan the tallest thing in the profile is the whole problem.
  let summitAt = 0;
  for (let i = 1; i < profile.length; i += 1) {
    if (Math.abs(profile[i][0]) < Math.abs(profile[summitAt][0])) summitAt = i;
  }
  const summitZ = profile[summitAt][1];

  const walk = (step) => {
    let lowZ = Infinity;
    let lowX = null;
    for (let i = summitAt; i >= 0 && i < profile.length; i += step) {
      const [x, z] = profile[i];
      if (z < lowZ) {
        lowZ = z;
        lowX = x;
      }
      // Over the top of something taller, and a saddle behind us. Cut back.
      if (lowZ <= summitZ - SADDLE_DROP_M && z > summitZ) return lowX;
    }
    // Nothing out this way beats the summit, so draw to the frame edge.
    return null;
  };

  return [walk(-1) ?? profile[0][0], walk(1) ?? profile[profile.length - 1][0]];
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicular(points[i], points[0], points[points.length - 1]);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

const round = (v, places) => Number(v.toFixed(places));

async function main() {
  const out = [];
  console.log('peak            official   sampled    delta   points');
  console.log('-'.repeat(56));

  for (const peak of PEAKS) {
    const centre =
      peak.snap === false
        ? { lat: peak.lat, lon: peak.lon, elevation: (await elevations([[peak.lat, peak.lon]]))[0] }
        : await snapToSummit(peak);
    await sleep(PAUSE);

    // Constant latitude, so the section runs due west to due east. Over 12 km
    // the difference between that and a great circle is centimetres.
    const perDeg = mPerDegLon(centre.lat);
    // Bearing in degrees from north. 90 is due east, which is every peak but
    // one, and for those this is the same straight line along a parallel that
    // it has always been.
    const heading = ((peak.bearing ?? 90) * Math.PI) / 180;
    const toNorth = Math.cos(heading);
    const toEast = Math.sin(heading);

    const count = SAMPLES;
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const x = -HALF + i * STEP;
      points.push([
        centre.lat + (x * toNorth) / M_PER_DEG_LAT,
        centre.lon + (x * toEast) / perDeg,
      ]);
    }

    const z = await elevations(points);
    await sleep(PAUSE);

    const profile = simplify(
      z.map((elevation, i) => [-HALF + i * STEP, elevation]),
      TOLERANCE,
    ).map(([x, e]) => [round(x, 0), round(e, 1)]);

    const sampledFt = centre.elevation / M_PER_FT;
    const delta = sampledFt - peak.ft;
    console.log(
      `${peak.id.padEnd(14)} ${String(peak.ft).padStart(8)} ${sampledFt.toFixed(0).padStart(9)} ` +
        `${((delta >= 0 ? '+' : '') + delta.toFixed(0)).padStart(7)} ${String(profile.length).padStart(7)}` +
        (Math.abs(delta) > 250 ? '   <-- CHECK' : ''),
    );

    const [west, east] = drawnSpan(profile);
    if (west > profile[0][0] || east < profile[profile.length - 1][0]) {
      console.log(
        `${' '.repeat(14)} line cut to ${(west / M_PER_MILE).toFixed(2)} .. ` +
          `${(east / M_PER_MILE).toFixed(2)} miles: something taller than the summit is in frame`,
      );
    }

    out.push({
      id: peak.id,
      name: peak.name,
      elevationFt: peak.ft,
      summited: peak.summited,
      lat: round(centre.lat, 5),
      lon: round(centre.lon, 5),
      sampledSummitM: round(centre.elevation, 1),
      drawnSpan: drawnSpan(profile),
      profile,
    });
  }

  writeFileSync(
    new URL('../src/data/peaks.json', import.meta.url),
    `${JSON.stringify(
      {
        source: 'USGS 3DEP 10 m (ned10m) via OpenTopoData',
        sampledAt: new Date().toISOString().slice(0, 10),
        halfWidthM: round(HALF, 1),
        halfWidthMiles: 4,
        stepM: round(STEP, 2),
        peaks: out,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote src/data/peaks.json (${out.length} peaks)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
