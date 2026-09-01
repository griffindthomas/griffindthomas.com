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

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
