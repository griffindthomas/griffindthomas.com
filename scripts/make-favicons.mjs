/**
 * Rasterise the monogram in public/favicon.svg into the bitmap sizes browsers
 * and phones still ask for.
 *
 *   node scripts/make-favicons.mjs
 *
 * Run this whenever favicon.svg changes. The PNGs are committed, so this is
 * not part of the build.
 *
 * Rasterising matters for more than old browsers: the SVG sets the monogram in
 * a font, and a browser rendering an SVG favicon does not reliably have the
 * same serif available. Baking the letterforms into pixels here makes the tab
 * icon look the same everywhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const SVG = path.join(PUBLIC, 'favicon.svg');

const png = (size) =>
  sharp(fs.readFileSync(SVG), { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toBuffer();

/**
 * Minimal ICO container wrapping a single PNG.
 *
 * Every browser that still requests `/favicon.ico` accepts PNG-in-ICO, so
 * there is no need for a BMP encoder. Header is 6 bytes, then one 16-byte
 * directory entry, then the image itself.
 */
function ico(pngBuffer, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width, 0 means 256
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette colours
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12); // offset to data

  return Buffer.concat([header, entry, pngBuffer]);
}

const targets = [
  ['favicon-32.png', 32],
  ['favicon-192.png', 192],
  ['apple-touch-icon.png', 180],
];

for (const [name, size] of targets) {
  fs.writeFileSync(path.join(PUBLIC, name), await png(size));
  console.log(`${name.padEnd(22)} ${size}x${size}`);
}

const icoPng = await png(32);
fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico(icoPng, 32));
console.log(`${'favicon.ico'.padEnd(22)} 32x32 (PNG in ICO)`);
