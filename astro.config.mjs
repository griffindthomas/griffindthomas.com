// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Required by @astrojs/sitemap and used for canonical/OG absolute URLs.
  site: 'https://griffindthomas.com',

  // Emit `/spotting.html` rather than `/spotting/index.html`, and link without
  // trailing slashes. Without this, every internal link costs a 307 redirect
  // to the trailing-slash form before serving the page.
  trailingSlash: 'never',
  build: { format: 'file' },

  integrations: [react(), mdx(), sitemap()],

  vite: {
    plugins: [tailwindcss()],
  },

  // No `output` set: every route is prerendered to static by default.
  // The adapter exists so individual routes can opt in to running in the
  // Worker at request time via `export const prerender = false`.
  adapter: cloudflare({
    // Transform images at BUILD time, not per request.
    //
    // The adapter defaults to `cloudflare-binding`, which serves every photo
    // through `/_image?href=...` and resizes it in the Worker on each request.
    // Measured on the live site that produced a 204 KB webp from a 60 KB
    // source JPEG, and spent a Worker invocation to do it. The gallery is
    // fully prerendered, so there is nothing to decide at request time.
    //
    // `compile` bakes the variants into `_astro/` as ordinary static files
    // served straight from the CDN.
    imageService: 'compile',
  }),
});
