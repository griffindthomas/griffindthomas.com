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

`wrangler.jsonc` in the repo root is the *source* config. The build generates
`dist/server/wrangler.json` with the real entrypoint (`main: entry.mjs`,
`assets.directory: ../client`) - that generated file is what actually runs.
Pointing `wrangler dev` at the root config instead produces a 500 on every
on-demand route.

The preview server binds to IPv6 only, so use `http://localhost:PORT`;
`127.0.0.1` will not connect.

### Cloudflare runtime API (Astro v6+)

`Astro.locals.runtime.*` was removed. The old properties are getters that
**throw**, so they cannot be probed with optional chaining:

- `locals.runtime.ctx` -> `locals.cfContext` (for `waitUntil`)
- `locals.runtime.env` -> `import { env } from 'cloudflare:workers'`
- `locals.runtime.cf` -> `Astro.request.cf`
- `locals.runtime.caches` -> the global `caches`

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
