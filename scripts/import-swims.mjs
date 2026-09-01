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
 * 50 tops out at 36.33 and the 100 starts at 58.99, so there is a wide,
 * unambiguous gap. Splitting on a row index would silently mis-assign
 * everything after any future edit to the paste.
 */
const SPLIT_SECONDS = 45;

/** "1:01.15" or "27.62" -> seconds as a number. */
function toSeconds(text) {
  const parts = text.split(':');
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number(text);
}

/** Seconds -> the canonical swimming format ("58.99", "1:01.15"). */
function toTimeText(seconds) {
  if (seconds < 60) return seconds.toFixed(2);
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/**
 * Which swimming region the meet belongs to. Griffin swam in the Pacific
 * Northwest before moving to New Hampshire, so this is what lets the chart
 * show the move rather than just a line going down.
 *
 * Anything unmatched stays null - better an unlabelled point than a wrong one.
 */
const PNW = /\bPN\b|Pacific Northwest|Sea-King|Seattle|SMAC|KING|VAST|BBST|Washington|Western Zone/i;
const NE = /\bNE\b|NHIAA|New England|EHS|ORHS|Garrison|Bishop Guertin|BG,|Exeter|Ithaca|Providence|CRIM|NSSC/i;

function regionOf(meet) {
  // Check PNW first: "2022 PN Washington Age Group" matches both otherwise.
  if (PNW.test(meet)) return 'pnw';
  if (NE.test(meet)) return 'ne';
  return null;
}

const raw = fs.readFileSync(IN, 'utf8');

const rows = raw
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => {
    const [time, flag, meet, date] = line.split('\t');
    const seconds = toSeconds(time.trim());
    return {
      event: seconds < SPLIT_SECONDS ? '50 Breast' : '100 Breast',
      time: time.trim(),
      seconds: Number(seconds.toFixed(2)),
      // Raw SwimCloud marker (X / D1 / U). Meaning unconfirmed, so it is
      // carried through verbatim rather than interpreted.
      flag: flag?.trim() || null,
      meet: meet.trim(),
      date: new Date(`${date.trim()} UTC`).toISOString().slice(0, 10),
      region: regionOf(meet),
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

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, swims: rows }, null, 2) + '\n');

console.log(`${rows.length} swims -> ${OUT}\n`);
for (const [event, s] of Object.entries(summary)) {
  console.log(`${event}`);
  console.log(`  swims    ${s.count}`);
  console.log(`  first    ${s.first.time}  (${s.first.date})`);
  console.log(`  best     ${s.best.time}  (${s.best.date}) — ${s.best.meet}`);
  console.log(`  dropped  ${s.dropped}s`);
  console.log(`  PBs      ${rows.filter((r) => r.event === event && r.isPB).length}`);
}

const unknown = rows.filter((r) => !r.region);
console.log(`\nregion: pnw ${rows.filter((r) => r.region === 'pnw').length}` +
  `, ne ${rows.filter((r) => r.region === 'ne').length}` +
  `, unclassified ${unknown.length}`);
for (const u of [...new Set(unknown.map((r) => r.meet))]) console.log(`  ? ${u}`);
