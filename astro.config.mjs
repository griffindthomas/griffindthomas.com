// @ts-check
import { defineConfig, envField } from 'astro/config';

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

  /**
   * The passphrase for /trips. Secret, server only, and optional so that a
   * checkout without it still builds: the middleware treats a missing one as
   * open in development and locked in production.
   *
   * Set it with `wrangler secret put TRIPS_PASSPHRASE`, or in a local .env for
   * dev. It must never be committed, and this repo is public.
   */
  env: {
    schema: {
      TRIPS_PASSPHRASE: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },

  integrations: [
    react(),
    mdx(),
    // /trips is noindex, so it must not be advertised in the sitemap either.
    // Submitting a URL for indexing and then telling the crawler not to index
    // it is a contradiction, and the sitemap is the half that is easy to
    // forget. The noindex tag itself is set per page in the layout.
    sitemap({ filter: (page) => !new URL(page).pathname.startsWith('/trips') }),
  ],

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
