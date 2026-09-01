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

  integrations: [react(), mdx(), sitemap()],

  vite: {
    plugins: [tailwindcss()],
  },

  // No `output` set: every route is prerendered to static by default.
  // The adapter exists so individual routes can opt in to running in the
  // Worker at request time via `export const prerender = false`.
  adapter: cloudflare(),
});
