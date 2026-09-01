/**
 * Build the social preview card.
 *
 *   node scripts/make-og.mjs
 *
 * This is the image that appears when the site is pasted into LinkedIn, a
 * message, or Slack. Without one, the link renders as a bare text row, which
 * is the first impression for everyone a recruiter forwards it to.
 *
 * Composed as an SVG and rasterised with sharp. The griffin is traced from
 * the artwork so it is real geometry at any size rather than an upscaled PNG.
 *
 * TYPEFACE NOTE: the card is set in a system serif, not in Newsreader.
 * Newsreader ships from fontsource as woff2 only, and the SVG rasteriser can
 * only reach fonts installed on the machine, so embedding the real face would
 * mean pulling in a whole separate rendering stack. Constantia and Georgia are
 * old-style text serifs of the same temperament, and at card size the
 * difference is invisible to everyone who has not spent a week staring at the
 * site. Revisit only if the card ever needs to sit beside the real wordmark.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Potrace } from 'potrace';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const SRC = path.join(ROOT, 'brand', 'griffin.png');

const W = 1200;
const H = 630;

const PAPER = '#faf8f4';
const INK = '#141414';
const GRAPHITE = '#5a5a57';
const RULE = '#d8d2c6';
const NAVY = '#16283f';
const SIGNAL = '#7e3d23';

const SERIF = "Constantia, Georgia, 'Times New Roman', serif";
const MONO = "Consolas, 'Courier New', monospace";

function tracePath(buffer) {
  return new Promise((resolve, reject) => {
    const tracer = new Potrace({ threshold: 128, turdSize: 2, optCurve: true, optTolerance: 0.2 });
    tracer.loadImage(buffer, (err) => {
      if (err) return reject(err);
      const svg = tracer.getSVG();
      const d = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
      const size = svg.match(/width="(\d+)" height="(\d+)"/);
      if (!d.length || !size) return reject(new Error('trace produced no geometry'));
      resolve({ d, width: Number(size[1]), height: Number(size[2]) });
    });
  });
}

// The full logo including the swoosh: unlike the favicon there is plenty of
// room here, and the sweep is what makes it read as flight rather than as a
// heraldic badge.
const trimmed = await sharp(SRC).trim().toBuffer();
const flat = await sharp(trimmed).flatten({ background: '#ffffff' }).png().toBuffer();
const art = await tracePath(flat);

const CREST_W = 330;
const crestScale = CREST_W / art.width;
const crestH = art.height * crestScale;

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const NAME = 'Griffin Thomas';
const LINE = 'Aerospace engineering student at Arizona State';
const DETAIL = 'RC aircraft, and airliners at Sea-Tac, Boeing Field and Sky Harbor';
const FOOT_LEFT = 'griffindthomas.com';
const FOOT_RIGHT = 'BSE AEROSPACE ENGINEERING / AERONAUTICS';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>

  <!-- Inset hairline, the way a printed card is trimmed. -->
  <rect x="40.5" y="40.5" width="${W - 81}" height="${H - 81}" fill="none"
        stroke="${RULE}" stroke-width="1"/>

  <g transform="translate(96 92) scale(${crestScale.toFixed(5)})">
${art.d.map((d) => `    <path d="${d}" fill="${NAVY}"/>`).join('\n')}
  </g>

  <text x="96" y="${92 + crestH + 96}" font-family="${SERIF}" font-size="86" fill="${INK}">${escape(NAME)}</text>

  <text x="96" y="${92 + crestH + 150}" font-family="${SERIF}" font-size="31" fill="${GRAPHITE}">${escape(LINE)}</text>
  <text x="96" y="${92 + crestH + 192}" font-family="${SERIF}" font-size="26" fill="${GRAPHITE}">${escape(DETAIL)}</text>

  <line x1="96" y1="${H - 104}" x2="${W - 96}" y2="${H - 104}" stroke="${RULE}" stroke-width="1"/>

  <text x="96" y="${H - 68}" font-family="${MONO}" font-size="23" fill="${SIGNAL}"
        letter-spacing="2">${escape(FOOT_LEFT)}</text>
  <text x="${W - 96}" y="${H - 68}" text-anchor="end" font-family="${MONO}" font-size="19"
        fill="${GRAPHITE}" letter-spacing="2">${escape(FOOT_RIGHT)}</text>
</svg>
`;

const out = path.join(PUBLIC, 'og.png');
await sharp(Buffer.from(svg), { density: 144 })
  .resize(W, H)
  .png({ compressionLevel: 9 })
  .toFile(out);

const { size } = fs.statSync(out);
console.log(`og.png  ${W}x${H}  ${(size / 1024).toFixed(0)} KB`);
