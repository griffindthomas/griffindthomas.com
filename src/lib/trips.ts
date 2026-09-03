import { z } from 'zod';


import driveData from '../data/drives.json';
import driveRoutes from '../data/drive-routes.json';
import hikeData from '../data/hikes.json';
import peakData from '../data/peaks.json';
import stateData from '../data/states.json';

/**
 * The trips data, checked on the way in.
 *
 * These four files are hand-maintained, which is the whole reason for the
 * schemas: AllTrails will not export on the free tier and the drive log lives
 * in nobody's database, so every number here was typed by a person and a typo
 * would otherwise show up as a silently wrong headline. Parsing at module load
 * means a bad row fails the build rather than shipping.
 *
 * Nothing here is fetched. The peak profiles and the routed roads are sampled
 * once by the scripts in `scripts/` and committed, so a build is reproducible
 * and the site does not depend on a third party being up.
 */

// --- Hikes ------------------------------------------------------------------

const Hike = z.object({
  id: z.string(),
  /** As printed. Some are only known to the month. */
  date: z.string(),
  /** Sortable. For a hike known only to the month, the best guess. */
  sort: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trail: z.string(),
  /** Which peak on the ladder this hike belongs to, if any. */
  peak: z.string().nullable(),
  distanceMi: z.number().positive(),
  gainFt: z.number().nonnegative(),
  /** Elapsed, as recorded. Null where it was never taken. */
  time: z.string().nullable(),
  /** Came off a watch rather than out of memory. */
  recorded: z.boolean(),
  gainEstimated: z.boolean().default(false),
  dateApproximate: z.boolean().default(false),
});

export type Hike = z.infer<typeof Hike>;

const hikeFile = z.object({ note: z.string(), hikes: z.array(Hike).min(1) }).parse(hikeData);

/**
 * The de-duplication rule, enforced rather than remembered.
 *
 * AllTrails sometimes records one walk twice on the same day, and the two
 * copies disagree on distance. The rule is that those collapse to a single
 * row keeping the larger figures, while the same trail walked on a different
 * date is a separate hike that counts again. Both Gothic Basin entries are
 * real and both count; a second Gothic Basin row on 29 June would not.
 */
for (const hike of hikeFile.hikes) {
  const clash = hikeFile.hikes.find(
    (other) => other !== hike && other.sort === hike.sort && other.trail === hike.trail,
  );
  if (clash) {
    throw new Error(
      `${hike.trail} appears twice on ${hike.date}. Same-day duplicates collapse to one row, ` +
        'keeping the larger distance and gain.',
    );
  }
}

export const HIKES: Hike[] = [...hikeFile.hikes].sort((a, b) => b.sort.localeCompare(a.sort));
export const HIKE_NOTE = hikeFile.note;

export const hikeStats = {
  count: HIKES.length,
  /** Feet climbed, added up. The headline number on the page. */
  gainFt: HIKES.reduce((sum, h) => sum + h.gainFt, 0),
  distanceMi: Number(HIKES.reduce((sum, h) => sum + h.distanceMi, 0).toFixed(1)),
};

// --- Peaks ------------------------------------------------------------------

const Peak = z.object({
  id: z.string(),
  name: z.string(),
  elevationFt: z.number().positive(),
  summited: z.boolean(),
  lat: z.number(),
  lon: z.number(),
  sampledSummitM: z.number(),
  /**
   * How much of the profile gets an ink line, [westX, eastX] in metres.
   *
   * Normally the whole of it. It is short of the frame edge only where the
   * transect crosses a saddle and runs up something taller than this peak,
   * which at six miles happens to Hannegan and to nothing else. The reasoning
   * lives in scripts/build-peaks.mjs; this is only the answer it reached.
   */
  drawnSpan: z.tuple([z.number(), z.number()]),
  /** [metres east of the summit, metres above sea level], west to east. */
  profile: z.array(z.tuple([z.number(), z.number()])).min(2),
});

export type Peak = z.infer<typeof Peak>;

const peakFile = z
  .object({
    source: z.string(),
    sampledAt: z.string(),
    halfWidthM: z.number().positive(),
    stepM: z.number().positive(),
    peaks: z.array(Peak).min(1),
  })
  .parse(peakData);

/** Tallest first, which is what makes the row of them read as a ladder. */
export const PEAKS: Peak[] = [...peakFile.peaks].sort((a, b) => b.elevationFt - a.elevationFt);
export const PEAK_SOURCE = peakFile.source;
export const PROFILE_HALF_WIDTH_M = peakFile.halfWidthM;

/**
 * The ceiling every profile is drawn against, metres.
 *
 * One number for the whole set, taken from the tallest, is what makes the
 * drawings comparable: Rainier nearly fills its box and Kilauea is a line near
 * the bottom of an otherwise empty one, and that emptiness is the information.
 */
export const CEILING_M = Math.ceil((Math.max(...PEAKS.map((p) => p.sampledSummitM)) * 1.06) / 100) * 100;

/** Every peak on the ladder is drawn to this width, metres. */
export const PROFILE_WIDTH_M = PROFILE_HALF_WIDTH_M * 2;

// --- Drives -----------------------------------------------------------------

const Vehicle = z.object({
  id: z.string(),
  name: z.string(),
  short: z.string(),
  /** Drawn in the outlines row. False for the rental, which has no model. */
  silhouette: z.boolean(),
});

const Drive = z.object({
  id: z.number().int().positive(),
  date: z.string(),
  sort: z.string().regex(/^\d{4}-\d{2}$/),
  from: z.string(),
  to: z.string(),
  /** Coast to coast. The other rows are drives that were not one. */
  crossing: z.boolean(),
  route: z.string(),
  /** Empty where it was never recorded which car went. */
  vehicles: z.array(z.string()),
  waypoints: z.array(z.tuple([z.string(), z.number(), z.number()])).min(2),
});

export type Drive = z.infer<typeof Drive>;
export type Vehicle = z.infer<typeof Vehicle>;

const driveFile = z
  .object({
    note: z.string(),
    drives: z.array(Drive).min(1),
    vehicles: z.array(Vehicle).min(1),
  })
  .parse(driveData);

export const VEHICLES: Vehicle[] = driveFile.vehicles;

const vehicleIds = new Set(VEHICLES.map((v) => v.id));
for (const drive of driveFile.drives) {
  for (const id of drive.vehicles) {
    if (!vehicleIds.has(id)) throw new Error(`drive ${drive.id} names an unknown vehicle: ${id}`);
  }
}

/**
 * Distances come from the router, never from the ledger.
 *
 * scripts/build-drives.mjs snaps the waypoints to real roads and writes what
 * those roads add up to. That figure wins over anything remembered afterwards,
 * so there is only one distance in play and nothing to keep in sync: change a
 * waypoint, re-run the script, and every total on the page follows.
 */
const roadMiles = new Map<number, number>(
  driveRoutes.drives.map((d) => [d.id, d.miles] as const),
);

export interface RoutedDrive extends Drive {
  /** What the roads add up to for this trip, however many cars ran it. */
  roadMiles: number;
}

export const DRIVES: RoutedDrive[] = [...driveFile.drives]
  .map((drive) => {
    const road = roadMiles.get(drive.id);
    if (road === undefined) {
      throw new Error(
        `drive ${drive.id} has no routed distance. Run: node scripts/build-drives.mjs`,
      );
    }
    return { ...drive, roadMiles: road };
  })
  .sort((a, b) => b.sort.localeCompare(a.sort));

export const driveStats = {
  count: DRIVES.length,
  /** Coast to coast only. Not every drive worth logging was one. */
  crossings: DRIVES.filter((d) => d.crossing).length,
  /** Trip miles: each route counted once, whatever ran it. */
  roadMiles: DRIVES.reduce((sum, d) => sum + d.roadMiles, 0),
};

// --- States -----------------------------------------------------------------

const stateFile = z
  .object({ note: z.string(), visited: z.array(z.string().length(2)) })
  .parse(stateData);

export const VISITED_STATES = new Set(stateFile.visited);

if (VISITED_STATES.size !== stateFile.visited.length) {
  throw new Error('a state is listed twice in states.json');
}

export const stateStats = {
  visited: VISITED_STATES.size,
  total: 50,
};

// --- The index at /trips ----------------------------------------------------

export interface TripRow {
  href: string;
  title: string;
  summary: string;
  /** As printed. */
  date: string;
  /** Sortable, YYYY-MM. */
  sort: string;
  status: 'Complete' | 'Planned' | 'Ongoing';
  where: string;
}

/**
 * The three standing logs, as rows for the ledger at /trips.
 *
 * They are pages rather than content entries, because each one is a drawing
 * and a table rather than prose, so their index rows have to be written
 * somewhere. Here, next to the data they summarise, and with the sort key
 * taken from the most recent entry rather than typed: a log that has not been
 * added to in a year should sink down the ledger on its own.
 */
export const STANDING_LOGS: TripRow[] = [
  {
    href: '/trips/hiking',
    title: 'Hiking',
    summary: 'Cascade volcanoes mostly, drawn from real elevation data',
    date: 'Since 2024',
    sort: HIKES[0].sort.slice(0, 7),
    status: 'Ongoing',
    where: 'Washington, Oregon, Hawaii, Arizona',
  },
  {
    href: '/trips/driving',
    title: 'Driving',
    summary: `${driveStats.count} long drives, ${driveStats.crossings} of them coast to coast, weighted by how often each road was used`,
    date: 'Since 2022',
    sort: DRIVES[0].sort,
    status: 'Ongoing',
    where: 'Coast to coast',
  },
  {
    href: '/trips/states',
    title: 'States',
    summary: `${stateStats.visited} of ${stateStats.total}, and the missing one is the point`,
    date: 'Since 2022',
    // Kept level with the newest of the other two: a state gets added by
    // whatever trip happened last, not on a schedule of its own.
    sort: [HIKES[0].sort.slice(0, 7), DRIVES[0].sort].sort().at(-1) as string,
    status: 'Ongoing',
    where: 'Everywhere except Alaska',
  },
];
