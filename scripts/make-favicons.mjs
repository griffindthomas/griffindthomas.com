/**
 * Build the brand assets from the griffin artwork.
 *
 *   node scripts/make-favicons.mjs
 *
 * Source of truth is `brand/griffin.png`, which is committed so this works on
 * any machine rather than depending on a file in someone's Pictures folder.
 * Outputs are committed too, so this is not part of the build. Re-run it after
 * changing the artwork or either accent colour.
 *
 * The artwork is pure black with the entire shape carried in the ALPHA
 * channel, which is what makes all of this clean: the alpha is a ready-made
 * mask, so recolouring is exact rather than a chroma-key guess, and the same
 * file can be handed to CSS `mask-image` to be tinted at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const SRC = path.join(ROOT, 'brand', 'griffin.png');

/** Must match --color-chart and --color-paper in src/styles/global.css. */
const NAVY = { r: 0x16, g: 0x28, b: 0x3f };
const PAPER = { r: 0xfa, g: 0xf8, b: 0xf4 };

/** Share of the icon's width left as margin on each side. */
const INSET = 0.08;

/**
 * Where the griffin ends and the trailing swoosh begins, as a fraction of the
 * trimmed artwork's width.
 *
 * The tab icon is cropped here. The full logo is about 1.8:1, so fitting all
 * of it into a square leaves the griffin at barely half the frame with a thin
 * streak eating the rest, and at 16px that resolves to an unreadable smudge.
 * Cropping to the bird roughly doubles it and the silhouette survives.
 *
 * Measured, not guessed: column coverage holds above 110px of vertical extent
 * across the body and collapses to 19px right after this point.
 */
const GRIFFIN_WIDTH = 0.56;

/** Trim the transparent border so the artwork fills the frame it is given. */
async function trimmedAlpha({ cropToGriffin = false } = {}) {
  const { data, info } = await sharp(SRC).trim().toBuffer({ resolveWithObject: true });
  if (!cropToGriffin) return { buffer: data, width: info.width, height: info.height };

  const width = Math.round(info.width * GRIFFIN_WIDTH);
  const cropped = await sharp(data)
    .extract({ left: 0, top: 0, width, height: info.height })
    .trim()
    .toBuffer({ resolveWithObject: true });
  return { buffer: cropped.data, width: cropped.info.width, height: cropped.info.height };
}

/**
 * The griffin recoloured, on a paper square.
 *
 * Paper rather than transparent on purpose: a navy silhouette on a
 * transparent ground disappears completely against a dark browser theme, and
 * a tab icon that is invisible for half the world's users is not an icon.
 * A paper field is also what the whole site is.
 */
async function icon(size) {
  const art = await trimmedAlpha({ cropToGriffin: true });

  // Fit the artwork inside the inset box, preserving its aspect. The griffin
  // is wide (about 1.8:1), so width is the binding constraint.
  const box = Math.round(size * (1 - INSET * 2));
  const scale = Math.min(box / art.width, box / art.height);
  const w = Math.max(1, Math.round(art.width * scale));
  const h = Math.max(1, Math.round(art.height * scale));

  const resized = await sharp(art.buffer).resize(w, h).toBuffer();
  // The alpha of the resized artwork becomes the stencil for a flat navy fill.
  const alpha = await sharp(resized).extractChannel('alpha').toBuffer();
  const navy = await sharp({
    create: { width: w, height: h, channels: 3, background: NAVY },
  })
    .joinChannel(alpha, { raw: undefined })
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: PAPER },
  })
    .composite([{ input: navy, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

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

// --- tab and home-screen icons --------------------------------------------
for (const [name, size] of [
  ['favicon-32.png', 32],
  ['favicon-192.png', 192],
  ['apple-touch-icon.png', 180],
  ['icon-512.png', 512],
]) {
  fs.writeFileSync(path.join(PUBLIC, name), await icon(size));
  console.log(`${name.padEnd(22)} ${size}x${size}`);
}

fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico(await icon(32), 32));
console.log(`${'favicon.ico'.padEnd(22)} 32x32 (PNG in ICO)`);

// --- the crest used on the page -------------------------------------------
// Shipped as a bare silhouette, NOT pre-coloured, because the nav applies it
// with CSS `mask-image` and paints it with a colour token. That way the mark
// follows the palette and can change on hover without a second file.
const art = await trimmedAlpha();
fs.writeFileSync(
  path.join(PUBLIC, 'crest.png'),
  await sharp(art.buffer)
    .resize({ width: 360 })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
console.log(`${'crest.png'.padEnd(22)} 360px wide silhouette for CSS masking`);

// The GT monogram this replaces was a vector; the griffin is raster only, so
// there is no honest favicon.svg to ship any more.
const oldSvg = path.join(PUBLIC, 'favicon.svg');
if (fs.existsSync(oldSvg)) {
  fs.rmSync(oldSvg);
  console.log(`${'favicon.svg'.padEnd(22)} removed (no vector source for the griffin)`);
}
