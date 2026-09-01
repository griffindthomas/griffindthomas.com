## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

`astro preview` runs the real Cloudflare Workers runtime (workerd) and also
daemonizes. Use `npm run preview` / `npm run preview:stop`.

### Windows: `EPERM` on `dist/` during build

`astro build` empties `dist/` first. If a preview/wrangler process is still
alive it holds `dist/client` open and the build dies with
`EPERM, Permission denied: dist\client`, often followed by a libuv
`Assertion failed` crash. The build is fine - a process is squatting on the
directory.

Never start the server with a bare `npx wrangler dev`: it spawns a
supervisor tree (npx -> wrangler -> cli -> workerd) that survives killing the
port listener and silently respawns `workerd`, which keeps the lock. Always
use `npm run preview`. To recover:

```
npm run preview:stop
powershell "Get-CimInstance Win32_Process -Filter \"Name='workerd.exe'\" | ForEach-Object { taskkill /PID $_.ProcessId /T /F }"
npm run clean
```

### Running the Worker locally

`wrangler.jsonc` in the repo root is the *source* config. The build also
generates `dist/server/wrangler.json` (`main: entry.mjs`,
`assets.directory: ../client`), which is what `astro preview` runs.

Both work. `npm run preview` and a bare `npx wrangler dev` from the root each
serve static routes and on-demand routes correctly - verified with a 200 and
live data on `/api/adsb.json`.

`astro preview` binds to IPv6 only, so use `http://localhost:PORT` with it;
`127.0.0.1` will not connect. `wrangler dev` binds to both.

**The Worker name in the Cloudflare dashboard must exactly match `name` in
`wrangler.jsonc` (`griffindthomas`) or the deploy fails.** Note this differs
from the GitHub repo name (`griffindthomas.com`) - Worker names cannot
contain dots.

### Cloudflare runtime API (Astro v6+)

`Astro.locals.runtime.*` was removed. The old properties are getters that
**throw**, so they cannot be probed with optional chaining:

- `locals.runtime.ctx` -> `locals.cfContext` (for `waitUntil`)
- `locals.runtime.env` -> `import { env } from 'cloudflare:workers'`
- `locals.runtime.cf` -> `Astro.request.cf`
- `locals.runtime.caches` -> the global `caches`

### Outbound fetch from Workers: shared egress IPs

Workers make outbound requests from IP addresses **shared with other
Cloudflare customers**. A third-party API's per-IP rate limit can therefore
be exhausted by traffic that has nothing to do with this site.

Observed in production on `/api/adsb.json` while local dev worked perfectly.
**All three community feeds fail from the Worker**, including one that
returns 200 from a laptop on the same request:

```
                 from laptop      from Worker
adsb.lol         200              429  (rate limited)
adsb.fi          200              403  (forbidden)
airplanes.live   403 (no UA)      403  (forbidden)
```

Edge caching does not rescue this - there is no successful response to cache,
and adding more providers of the same kind does not either. **The Worker-proxy
approach does not work for free community ADS-B APIs.** Treat this as settled;
do not re-litigate it by adding a fourth similar provider.

Viable paths for the live radar (Phase 4), best first:

1. **Griffin's own receiver** (Pi + RTL-SDR, West Seattle). Expose `dump1090`'s
   `aircraft.json` through a free Cloudflare Tunnel and have the Worker read
   that. No third-party limits, and "fed by my own antenna" is a better story
   than proxying someone else's feed.
2. **OpenSky Network** with registered OAuth2 credentials - actual auth rather
   than anonymous per-IP limits.
3. **Scheduled fetch from non-Cloudflare egress** (e.g. a GitHub Actions cron)
   writing into KV, which the Worker then serves.

Browser-side fetch sidesteps shared egress entirely but needs CORS, and
**adsb.lol sends no `Access-Control-Allow-Origin`**. Re-check per provider
before relying on it.

`?debug=1` on `/api/adsb.json` reports per-provider status codes. It bypasses
the cache in both directions and exposes nothing secret.

A direct browser-side fetch would sidestep shared egress entirely (each
visitor spends their own IP's quota), but **adsb.lol sends no
`Access-Control-Allow-Origin` header**, so that is not available for it.
Re-check CORS per provider before relying on that approach.

## Photo pipeline

`scripts/photos.mjs` imports; `scripts/studio.mjs` is a local editor on
127.0.0.1 that edits the same files. Photos live as a JPEG plus a JSON sidecar
side by side in `src/content/photos/`.

**The invariant: `exif`, `source`, `image` and `lqip` are DERIVED and rewritten
on every import. Everything else is hand-entered and must never be clobbered.**
The studio enforces the same split with an `EDITABLE` allowlist, which is why
the two tools can share files without fighting.

### EXIF timestamps are LOCAL time, not UTC

An earlier note in the plan file claimed the camera clock was set to UTC and
that timestamps needed shifting to PDT. **That was wrong**, and the conversion
it produced moved an afternoon airshow to 08:33 in the morning.

Verified against the frames: `_MG_1080` reads `12:08` for a midday Boeing Field
shot, and the Blue Angels Seafair demo reads `15:33`, which is when Seafair
actually flies.

EXIF carries no timezone at all. `shotAt` therefore stores a naive wall clock
with no offset and no trailing `Z`, and `timezone` records which zone that
clock belongs to. Do not append an offset and do not feed `shotAt` to
`new Date()` for formatting: that reinterprets it in the build machine's zone
and can slide the date across midnight. Format it by string slicing.

Photos shot in Arizona need `America/Phoenix`, which is MST year round.

### Variant suffixes are one digit

`baseOf()` strips `_\d$`, not `_\d+$`. The base name ends in the camera's
3-4 digit frame number, so the greedy form collapses `_MG_1080`, `_MG_1141`
and `_MG_1250` into a single bogus `_MG` group and silently drops photos.

Selection among variants is strictly by pixel count, ties broken by file size.
The `_1` suffix does not indicate resolution and is inverted on several files.

## Zod 4: `.default({})` on an object does not typecheck

Astro 7 ships Zod 4, where `.default()` types its argument as the schema's
**output**, so `z.object({...}).default({})` fails even when every inner field
has its own default. Use `.prefault({})`, which applies the value as **input**
and lets the inner defaults fill it in.

Also: `z` is still re-exported from `astro:content` but deprecated there.
Import from `zod` directly.

## `startViewTransition` makes filters lag one click behind

It runs its callback asynchronously. Calling it again before the previous
transition settles leaves the DOM showing the earlier result, so every click
appears to apply the *previous* filter. Observed on the gallery: clicking
Clear rendered the filter set from the click before it.

Filtering is now synchronous. A crossfade is not worth a control that lies
about its own state.

## Node CLI detection on Windows

`import.meta.url === \`file://${process.argv[1]}\`` never matches: a Windows
file URL is `file:///C:/...` with three slashes. Use
`pathToFileURL(process.argv[1]).href`. The naive form fails silently, so the
CLI block simply never runs.

## The accent colour is small text, so it has a contrast floor

`--color-signal` is used for nav active state, filter chips and data plates,
all of which are 11px mono. That makes it SMALL TEXT under WCAG, so it needs
4.5:1 against `--color-paper` (#faf8f4).

The original international orange (#d6451f) was 4.19:1 and failed. It is now
chestnut #7e3d23 at 7.68:1, with deep navy #16283f at 14.05:1 as the second
series and the colour of the crest. Measure before changing either; do not
pick an accent by eye.

The two accents are close in lightness (1.83:1 between them), which is where
colour-blind readers lose a warm brown against a navy. The swim chart therefore
distinguishes its series by marker shape as well as hue, and every series is
labelled in text. Keep that if a third series ever appears.

## Brand assets are generated, not hand-edited

`brand/griffin.png` is the source of truth, committed so this works on any
machine. After changing it or either accent colour, run:

```
node scripts/make-favicons.mjs
```

which rewrites every icon size plus `public/crest.png`. Outputs are committed,
so this is not part of the build.

Three things about the artwork worth knowing:

**The shape lives entirely in the alpha channel** (RGB is pure black). That is
why recolouring is exact rather than a chroma-key guess, and why the same file
can be handed to CSS `mask-image` and tinted at runtime.

**The tab icon is cropped to the griffin, dropping the swoosh.** The full logo
is about 1.8:1, so squaring it leaves the bird at half the frame with a thin
streak eating the rest, which resolves to an unreadable smudge at 16px. The
crop point was measured: column coverage holds above 110px of vertical extent
across the body and collapses to 19px immediately after 56% of the width.

**The nav crest is masked, not a coloured PNG**, so it follows the palette
tokens and recolours on hover from one file. It is wrapped in `@supports`:
without that, a browser ignoring `mask` paints the fallback background across
the whole box and the crest becomes a navy rectangle beside the name.

The `.ico` is a PNG wrapped in a minimal ICO container, which every browser
still requesting `/favicon.ico` accepts.

There is no `favicon.svg`: the griffin is raster only, so shipping one would
mean inventing a vector that is not the real artwork.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
