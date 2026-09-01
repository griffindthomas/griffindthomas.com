// Parse the raw SwimCloud pastes into structured JSON.
//
// Kept as an importer rather than hand-written JSON so refreshing the data is
// paste-and-run. Input columns are: time, flag, meet, date.
//
// Usage: node scripts/import-swims.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'src/data/swims.json';

/**
 * One file per course, because course CANNOT be inferred from the times.
 *
 * Distance is inferred from magnitude and that is safe: nothing in the 50 is
 * slower than 36.52 and nothing in the 100 is faster than 58.99, so the gap is
 * wide in both courses. But a slow short course 100 and a fast long course 100
 * both sit around 1:10, so any magnitude rule would silently mix the two into
 * one line. Keeping them in separate files makes the course a fact about where
 * the data came from rather than a guess.
 */
const SOURCES = [
  { course: 'SCY', label: 'Short course yards', file: 'data/swims-raw.tsv' },
  { course: 'LCM', label: 'Long course metres', file: 'data/swims-raw-lcm.tsv' },
];

const EVENTS = ['50 Breast', '100 Breast'];

/** Below this is the 50, above it the 100. See the note on SOURCES. */
const SPLIT_SECONDS = 45;

/**
 * Times landing in here would make the distance split a coin flip. Nothing in
 * the data comes close today, so this exists to fail loudly if a future paste
 * introduces something the rule cannot classify, rather than quietly filing a
 * swim under the wrong event.
 */
const AMBIGUOUS = [40, 55];

/**
 * Griffin swam in the Pacific Northwest, then moved to New Hampshire for high
 * school. Era is derived from the DATE, not from meet names: he travelled to
 * meets outside whichever region he was living in (Four Corners 2026 was in
 * Carmel, Indiana; THSC 2022 was in Oregon), so name matching mislabels those.
 *
 * The boundary is clean in the short course data - last PNW meet 2023-08-01,
 * first New England meet 2023-12-02 - so any date in between works.
 *
 * Caveat: long course season is summer, which is when he is back in Seattle,
 * so PN meets appear after this date. `era` therefore means "where he was
 * living", not "where the meet was". Nothing renders it today.
 */
const MOVE_DATE = '2023-09-01';

/** "1:01.15" or "27.62" -> seconds as a number. */
function toSeconds(text) {
  const parts = text.split(':');
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number(text);
}

function parseFile({ course, file }) {
  if (!fs.existsSync(file)) {
    console.warn(`skipping ${course}: ${file} not found`);
    return [];
  }

  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      // Column 2 is a SwimCloud marker (relay split / cut / user-submitted).
      // Deliberately discarded: it says nothing about the swim itself.
      const [time, , meet, date] = line.split('\t');
      const seconds = toSeconds(time.trim());

      if (seconds > AMBIGUOUS[0] && seconds < AMBIGUOUS[1]) {
        throw new Error(
          `${file}: ${time.trim()} falls between the 50 and the 100 ` +
            `(${AMBIGUOUS[0]}-${AMBIGUOUS[1]}s) and cannot be classified. ` +
            `Split this event into its own file.`,
        );
      }

      const iso = new Date(`${date.trim()} UTC`).toISOString().slice(0, 10);
      return {
        event: seconds < SPLIT_SECONDS ? '50 Breast' : '100 Breast',
        course,
        time: time.trim(),
        seconds: Number(seconds.toFixed(2)),
        meet: meet.trim(),
        date: iso,
        era: iso < MOVE_DATE ? 'pnw' : 'ne',
      };
    });
}

const rows = SOURCES.flatMap(parseFile);

// Oldest first, so a running best gives the actual PB progression.
rows.sort((a, b) => a.date.localeCompare(b.date));

const summary = { courses: SOURCES.map(({ course, label }) => ({ course, label })) };

for (const { course } of SOURCES) {
  summary[course] = {};

  for (const event of EVENTS) {
    // A personal best is per course. A 31.12 long course 50 is a lifetime
    // best in its own right and has nothing to prove against a 27.08 yards.
    const swims = rows.filter((r) => r.course === course && r.event === event);
    if (swims.length === 0) continue;

    let best = Infinity;
    for (const s of swims) {
      s.isPB = s.seconds < best;
      if (s.isPB) best = s.seconds;
    }

    const first = swims[0];
    const fastest = swims.reduce((a, b) => (b.seconds < a.seconds ? b : a));
    summary[course][event] = {
      count: swims.length,
      first: { time: first.time, date: first.date },
      best: { time: fastest.time, date: fastest.date, meet: fastest.meet },
      dropped: Number((first.seconds - fastest.seconds).toFixed(2)),
      span: [first.date, swims[swims.length - 1].date],
    };
  }
}

summary.moveDate = MOVE_DATE;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, swims: rows }, null, 2) + '\n');

console.log(`${rows.length} swims -> ${OUT}\n`);

for (const { course, label } of SOURCES) {
  console.log(`${course}  ${label}`);
  for (const event of EVENTS) {
    const s = summary[course][event];
    if (!s) {
      console.log(`  ${event.padEnd(12)} none`);
      continue;
    }
    const pbs = rows.filter((r) => r.course === course && r.event === event && r.isPB).length;
    console.log(
      `  ${event.padEnd(12)} ${String(s.count).padStart(3)} swims  ` +
        `${s.first.time} -> ${s.best.time}  (-${s.dropped}s, ${pbs} PBs)`,
    );
  }
  console.log('');
}

console.log(
  `era: pnw ${rows.filter((r) => r.era === 'pnw').length}` +
    `, ne ${rows.filter((r) => r.era === 'ne').length}`,
);
