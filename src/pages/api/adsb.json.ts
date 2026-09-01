import type { APIRoute } from 'astro';

/**
 * Live ADS-B proxy.
 *
 * This is the only route on the site that runs on demand; everything else is
 * prerendered at build time.
 *
 * Why proxy at all instead of calling the feed from the browser:
 *   1. adsb.lol's rate limits are dynamic and undocumented. Edge-caching the
 *      response for CACHE_SECONDS means N simultaneous visitors cost one
 *      upstream request, not N.
 *   2. It lets us fail over between providers without shipping that logic
 *      (or a second origin) to the client.
 *   3. The upstream payload carries ~40 fields per aircraft; we forward ~12.
 *
 * Data: adsb.lol, licensed ODbL 1.0 - attribution is rendered in the UI.
 */
export const prerender = false;

const CACHE_SECONDS = 15;

interface Provider {
  id: string;
  /** Build the query URL. Radius is in nautical miles. */
  url: (lat: number, lon: number, dist: number) => string;
}

/**
 * Providers are tried in order until one succeeds.
 *
 * All of these speak the ADSBExchange v2 response shape, which is what makes
 * a single normaliser sufficient. To add Griffin's own receiver later, append
 * an entry here (or unshift it to make it primary) and implement its
 * response shape in `normalise` if it differs - the radar component consumes
 * this route's normalised output and never learns where the data came from.
 *
 * PRODUCTION STATUS: all three currently fail from Cloudflare Workers, even
 * though adsb.lol and adsb.fi both return 200 for the identical request from
 * an ordinary machine:
 *
 *   adsb.lol       429 (rate limited)
 *   adsb.fi        403
 *   airplanes.live 403
 *
 * Workers egress from IPs shared with other Cloudflare customers, and these
 * feeds throttle or block that range. Edge caching cannot help - there is no
 * successful response to cache - and adding a fourth similar provider will
 * not either.
 *
 * So this route currently and correctly serves `status: "unavailable"` in
 * production. That is a known limitation, not a bug to re-fix here. The real
 * fix is a data source that does not depend on Cloudflare egress reputation;
 * see CLAUDE.md for the ranked options (Griffin's own receiver via Cloudflare
 * Tunnel is first). This list stays because it costs nothing, still works in
 * local dev, and is the seam those options plug into.
 */
const PROVIDERS: Provider[] = [
  {
    id: 'adsb.lol',
    url: (lat, lon, dist) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
  {
    id: 'adsb.fi',
    url: (lat, lon, dist) =>
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
  {
    id: 'airplanes.live',
    url: (lat, lon, dist) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
  },
];

const USER_AGENT = 'griffindthomas.com (personal planespotting site)';

/**
 * ODbL 1.0 requires attributing the actual source, so this follows whichever
 * provider answered rather than naming a fixed one.
 */
const attributionFor = (source: string | null): string =>
  source && source !== 'cache'
    ? `Live traffic via ${source} - ODbL 1.0`
    : 'Live traffic via community ADS-B feeders - ODbL 1.0';

/** Sky Harbor - the default scope centre. */
const DEFAULT_LAT = 33.4342;
const DEFAULT_LON = -112.0116;
const DEFAULT_DIST = 25;

export interface Aircraft {
  hex: string;
  flight: string | null;
  reg: string | null;
  type: string | null;
  /** Barometric altitude in feet, or null when on the ground / unknown. */
  alt: number | null;
  onGround: boolean;
  /** Ground speed, knots. */
  speed: number | null;
  /** True track over ground, degrees. */
  track: number | null;
  lat: number | null;
  lon: number | null;
  /** Distance from scope centre, nautical miles. */
  dst: number | null;
  /** Bearing from scope centre, degrees. */
  dir: number | null;
  squawk: string | null;
}

export interface AdsbPayload {
  status: 'ok' | 'unavailable';
  /** Provider id that answered, `'cache'` when serving stale, else null. */
  source: string | null;
  now: number;
  center: { lat: number; lon: number; dist: number };
  count: number;
  aircraft: Aircraft[];
  attribution: string;
}

/** Clamp a query param to a sane range, falling back when absent or NaN. */
function num(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (raw === null || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Round to `places` decimals - also narrows the cache key space. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function toFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toTrimmedOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Both providers speak the ADSBExchange v2 shape, so one normaliser covers
 * them. Aircraft without a hex are dropped; every other field degrades to null.
 */
function normalise(raw: unknown): Aircraft[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { ac?: unknown }).ac;
  if (!Array.isArray(list)) return [];

  const out: Aircraft[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const a = entry as Record<string, unknown>;
    if (typeof a.hex !== 'string') continue;

    // alt_baro is a number in feet, or the literal string "ground".
    const onGround = a.alt_baro === 'ground';

    out.push({
      hex: a.hex,
      flight: toTrimmedOrNull(a.flight),
      reg: toTrimmedOrNull(a.r),
      type: toTrimmedOrNull(a.t),
      alt: onGround ? null : toFiniteOrNull(a.alt_baro),
      onGround,
      speed: toFiniteOrNull(a.gs),
      track: toFiniteOrNull(a.track),
      lat: toFiniteOrNull(a.lat),
      lon: toFiniteOrNull(a.lon),
      dst: toFiniteOrNull(a.dst),
      dir: toFiniteOrNull(a.dir),
      squawk: toTrimmedOrNull(a.squawk),
    });
  }

  // Nearest first, so the client can cheaply cap how many it renders.
  out.sort((x, y) => (x.dst ?? Number.POSITIVE_INFINITY) - (y.dst ?? Number.POSITIVE_INFINITY));
  return out;
}

interface FetchOutcome {
  ok: boolean;
  status: number | null;
  data: unknown | null;
  error: string | null;
}

/**
 * Fetch with a hard timeout so one slow provider cannot hang the request.
 *
 * Returns the failure reason rather than swallowing it: an upstream that
 * works locally but not on the edge is otherwise impossible to diagnose,
 * since the only symptom is a generic "unavailable".
 */
async function fetchJson(url: string, timeoutMs = 6000): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, data: await res.json(), error: null };
  } catch (err) {
    return {
      ok: false,
      status: null,
      data: null,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Last known good payload, kept per isolate. Workers reuses isolates across
 * requests, so this often survives and lets us serve slightly stale data
 * rather than an empty scope when both providers are down.
 */
let lastGood: { payload: AdsbPayload; at: number } | null = null;

const STALE_LIMIT_MS = 5 * 60_000;

export const GET: APIRoute = async ({ url, locals }) => {
  const lat = round(num(url.searchParams.get('lat'), DEFAULT_LAT, -90, 90), 4);
  const lon = round(num(url.searchParams.get('lon'), DEFAULT_LON, -180, 180), 4);
  const dist = Math.round(num(url.searchParams.get('dist'), DEFAULT_DIST, 1, 250));

  // `caches` and `ctx` only exist in the Workers runtime, not in `astro dev`.
  const cacheStore =
    typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  // Astro v6 moved the Workers ExecutionContext from `locals.runtime.ctx` to
  // `locals.cfContext`. The old path still exists as a getter that *throws*,
  // so it cannot be probed with optional chaining - it must not be touched.
  const cfContext = (locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } })
    ?.cfContext;

  // `?debug=1` surfaces why the providers failed. It bypasses the cache in
  // both directions so a diagnostic response can never be served to a
  // real visitor, and it exposes nothing secret - only upstream status codes.
  const debug = url.searchParams.get('debug') === '1';

  const cacheKey = new Request(
    `https://adsb-cache.internal/v1?lat=${lat}&lon=${lon}&dist=${dist}`,
    { method: 'GET' },
  );

  if (cacheStore && !debug) {
    const hit = await cacheStore.match(cacheKey);
    if (hit) return hit;
  }

  let aircraft: Aircraft[] = [];
  let source: AdsbPayload['source'] = null;
  const attempts: Array<{ provider: string; status: number | null; error: string | null }> = [];

  for (const provider of PROVIDERS) {
    const outcome = await fetchJson(provider.url(lat, lon, dist));
    attempts.push({
      provider: provider.id,
      status: outcome.status,
      error: outcome.error,
    });

    if (outcome.ok) {
      const parsed = normalise(outcome.data);
      // A provider that answers 200 with an unparseable or empty body is
      // treated as a failure so the next one still gets a turn.
      if (parsed.length > 0) {
        aircraft = parsed;
        source = provider.id;
        break;
      }
    }
  }

  let payload: AdsbPayload;

  if (source) {
    payload = {
      status: 'ok',
      source,
      now: Date.now(),
      center: { lat, lon, dist },
      count: aircraft.length,
      aircraft,
      attribution: attributionFor(source),
    };
    lastGood = { payload, at: Date.now() };
  } else if (lastGood && Date.now() - lastGood.at < STALE_LIMIT_MS) {
    // Both providers failed but we have recent data: serve it, flagged as cache.
    payload = { ...lastGood.payload, source: 'cache' };
  } else {
    // Explicit failure state. The client renders an empty scope with a
    // "feed unavailable" notice rather than pretending the sky is empty.
    payload = {
      status: 'unavailable',
      source: null,
      now: Date.now(),
      center: { lat, lon, dist },
      count: 0,
      aircraft: [],
      attribution: attributionFor(null),
    };
  }

  const body = debug ? { ...payload, debug: { attempts } } : payload;

  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Only cache successful lookups, and let the edge serve slightly stale
      // data while it revalidates rather than stalling the client.
      'Cache-Control':
        payload.status === 'ok' && !debug
          ? `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=60`
          : 'no-store',
    },
  });

  if (cacheStore && payload.status === 'ok' && !debug) {
    const put = cacheStore.put(cacheKey, response.clone());
    if (cfContext?.waitUntil) cfContext.waitUntil(put);
    else await put;
  }

  return response;
};
