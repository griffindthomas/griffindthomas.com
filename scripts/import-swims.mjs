// Parse the raw SwimCloud paste into structured JSON.
//
// Kept as an importer rather than hand-written JSON so refreshing the data is
// paste-and-run. Input columns are: time, flag, meet, date.
//
// Usage: node scripts/import-swims.mjs
import fs from 'node:fs';
import path from 'node:path';

const IN = 'data/swims-raw.tsv';
const OUT = 'src/data/swims.json';

/**
 * Events are separated by time magnitude, not by position in the file: the
 * 50 tops out at 36.33 and the 100 starts at 58.99, so the gap is wide and
 * unambiguous. Splitting on a row index would silently mis-assign everything
 * after any future edit to the paste.
 */
const SPLIT_SECONDS = 45;

/**
 * Griffin swam in the Pacific Northwest, then moved to New Hampshire for high
 * school. Era is derived from the DATE, not from meet names: he travelled to
 * meets outside whichever region he was living in (Four Corners 2026 was in
 * Carmel, Indiana; THSC 2022 was in Oregon), so name matching mislabels those.
 *
 * The boundary is clean in the data - last PNW meet 2023-08-01, first New
 * England meet 2023-12-02 - so any date in between works.
 */
const MOVE_DATE = '2023-09-01';

/** "1:01.15" or "27.62" -> seconds as a number. */
function toSeconds(text) {
  const parts = text.split(':');
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number(text);
}

const raw = fs.readFileSync(IN, 'utf8');

const rows = raw
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => {
    // Column 2 is a SwimCloud marker (relay split / cut / user-submitted).
    // Deliberately discarded: it says nothing about the swim itself.
    const [time, , meet, date] = line.split('\t');
    const seconds = toSeconds(time.trim());
    const iso = new Date(`${date.trim()} UTC`).toISOString().slice(0, 10);
    return {
      event: seconds < SPLIT_SECONDS ? '50 Breast' : '100 Breast',
      time: time.trim(),
      seconds: Number(seconds.toFixed(2)),
      meet: meet.trim(),
      date: iso,
      era: iso < MOVE_DATE ? 'pnw' : 'ne',
    };
  });

// Oldest first, so a running best gives the actual PB progression.
rows.sort((a, b) => a.date.localeCompare(b.date));

const summary = {};
for (const event of ['50 Breast', '100 Breast']) {
  const swims = rows.filter((r) => r.event === event);
  let best = Infinity;
  for (const s of swims) {
    // A PB is a swim that beat everything before it.
    s.isPB = s.seconds < best;
    if (s.isPB) best = s.seconds;
  }
  const first = swims[0];
  const fastest = swims.reduce((a, b) => (b.seconds < a.seconds ? b : a));
  summary[event] = {
    count: swims.length,
    first: { time: first.time, date: first.date },
    best: { time: fastest.time, date: fastest.date, meet: fastest.meet },
    dropped: Number((first.seconds - fastest.seconds).toFixed(2)),
    span: [first.date, swims[swims.length - 1].date],
  };
}

summary.moveDate = MOVE_DATE;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, swims: rows }, null, 2) + '\n');

console.log(`${rows.length} swims -> ${OUT}\n`);
for (const event of ['50 Breast', '100 Breast']) {
  const s = summary[event];
  console.log(event);
  console.log(`  swims    ${s.count}`);
  console.log(`  first    ${s.first.time}  (${s.first.date})`);
  console.log(`  best     ${s.best.time}  (${s.best.date}) - ${s.best.meet}`);
  console.log(`  dropped  ${s.dropped}s`);
  console.log(`  PBs      ${rows.filter((r) => r.event === event && r.isPB).length}`);
}
console.log(
  `\nera: pnw ${rows.filter((r) => r.era === 'pnw').length}` +
    `, ne ${rows.filter((r) => r.era === 'ne').length}`,
);
