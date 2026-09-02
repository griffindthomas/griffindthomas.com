import type { APIRoute } from 'astro';

/**
 * Current observation for one field, decoded group by group.
 *
 * Source is NOAA's Aviation Weather Center, which is public, keyless and the
 * same feed the FAA publishes to. No account, no attribution requirement, and
 * no rate limit worth worrying about at this site's traffic.
 *
 * The decode happens here rather than in the browser for three reasons: the
 * parser is the bulk of the code and never has to be downloaded, the strip
 * stays a few lines of DOM, and a station that answers with something this
 * route cannot read fails on the server where it can be seen.
 *
 * Runs on demand. Everything else on the site is prerendered.
 */
export const prerender = false;

/** METARs are issued hourly near :53, with specials in between. */
const CACHE_SECONDS = 180;

interface Field {
  icao: string;
  lat: number;
  lon: number;
}

/**
 * The busiest twenty fields in the United States, by passengers.
 *
 * Twenty is enough that everyone in the country is within a few hundred miles
 * of one, and small enough that the answer is always somewhere a reader has
 * heard of. Indianapolis gets Chicago rather than Cincinnati because
 * Cincinnati is not on this list, which is the point of keeping it to hubs.
 */
const US_FIELDS: Field[] = [
  { icao: 'KATL', lat: 33.6367, lon: -84.4281 },
  { icao: 'KDFW', lat: 32.8968, lon: -97.038 },
  { icao: 'KDEN', lat: 39.8617, lon: -104.6732 },
  { icao: 'KORD', lat: 41.9786, lon: -87.9048 },
  { icao: 'KLAX', lat: 33.9425, lon: -118.4081 },
  { icao: 'KCLT', lat: 35.214, lon: -80.9431 },
  { icao: 'KMCO', lat: 28.4294, lon: -81.3089 },
  { icao: 'KLAS', lat: 36.084, lon: -115.1537 },
  { icao: 'KPHX', lat: 33.4343, lon: -112.0116 },
  { icao: 'KMIA', lat: 25.7932, lon: -80.2906 },
  { icao: 'KSEA', lat: 47.4502, lon: -122.3088 },
  { icao: 'KIAH', lat: 29.9844, lon: -95.3414 },
  { icao: 'KJFK', lat: 40.6398, lon: -73.7789 },
  { icao: 'KEWR', lat: 40.6925, lon: -74.1687 },
  { icao: 'KSFO', lat: 37.6189, lon: -122.375 },
  { icao: 'KFLL', lat: 26.0726, lon: -80.1527 },
  { icao: 'KMSP', lat: 44.882, lon: -93.2218 },
  { icao: 'KDTW', lat: 42.2124, lon: -83.3534 },
  { icao: 'KBOS', lat: 42.3643, lon: -71.0052 },
  { icao: 'KPHL', lat: 39.8721, lon: -75.2411 },
];

/** Canada gets whichever of the two is closer, east or west. */
const CANADA_FIELDS: Field[] = [
  { icao: 'CYYZ', lat: 43.6772, lon: -79.6306 },
  { icao: 'CYVR', lat: 49.1939, lon: -123.1844 },
];

/**
 * Everywhere else gets the busiest field on its continent. A reader in Lisbon
 * does not need the nearest airfield to Lisbon, they need something the strip
 * can be about, and Heathrow is a place they have heard of.
 */
const CONTINENT_FIELDS: Record<string, Field> = {
  EU: { icao: 'EGLL', lat: 51.4706, lon: -0.4619 },
  AS: { icao: 'OMDB', lat: 25.2528, lon: 55.3644 },
  SA: { icao: 'SBGR', lat: -23.4356, lon: -46.4731 },
  AF: { icao: 'FAOR', lat: -26.1337, lon: 28.242 },
  OC: { icao: 'YSSY', lat: -33.9461, lon: 151.1772 },
  // North America, for the part of it that is neither the US nor Canada.
  NA: { icao: 'MMMX', lat: 19.4363, lon: -99.0721 },
};

/**
 * Coarse fallback for when there is no position at all, which is local
 * development and not much else. Deliberately short: it only has to be less
 * wrong than picking Phoenix for everyone.
 */
const ZONE_FIELDS: Record<string, string> = {
  'America/New_York': 'KJFK',
  'America/Detroit': 'KDTW',
  'America/Toronto': 'CYYZ',
  'America/Vancouver': 'CYVR',
  'America/Chicago': 'KORD',
  'America/Denver': 'KDEN',
  'America/Phoenix': 'KPHX',
  'America/Los_Angeles': 'KLAX',
  'Europe/London': 'EGLL',
  'Australia/Sydney': 'YSSY',
};

/**
 * Every field this route will fetch, plus Boeing Field, which is not a hub and
 * is never chosen automatically but is worth being able to ask for by name.
 *
 * An open passthrough would let anyone use the site as a general weather
 * proxy, so nothing outside this list is fetched whatever the query says.
 */
const STATIONS: string[] = [
  ...US_FIELDS.map((f) => f.icao),
  ...CANADA_FIELDS.map((f) => f.icao),
  ...Object.values(CONTINENT_FIELDS).map((f) => f.icao),
  'KBFI',
];

/** Sky Harbor: his own field, and the answer when nothing else is known. */
const DEFAULT_STATION = 'KPHX';

/** Great circle distance, kilometres. Only ever used to rank, never shown. */
function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const nearest = (fields: Field[], lat: number, lon: number): string =>
  fields.reduce((best, f) =>
    distance(lat, lon, f.lat, f.lon) < distance(lat, lon, best.lat, best.lon) ? f : best,
  ).icao;

interface Geo {
  lat: number | null;
  lon: number | null;
  country: string | null;
  continent: string | null;
  timezone: string | null;
  /** Where the numbers came from, for `?debug=1`. */
  source: string;
}

/**
 * Position of the reader, from Cloudflare rather than from the browser.
 *
 * The edge already knows roughly where the request came from, so there is no
 * permission prompt, nothing to consent to and nothing for the client to get
 * wrong. The paths are tried in order and each one is wrapped, because the
 * adapter has moved these between releases and at least one old path is a
 * getter that throws rather than returning undefined.
 */
function readGeo(locals: unknown, request: Request): Geo {
  const empty: Geo = { lat: null, lon: null, country: null, continent: null, timezone: null, source: 'none' };
  const candidates: Array<[string, () => unknown]> = [
    ['locals.runtime.cf', () => (locals as { runtime?: { cf?: unknown } })?.runtime?.cf],
    ['locals.cf', () => (locals as { cf?: unknown })?.cf],
    ['request.cf', () => (request as unknown as { cf?: unknown })?.cf],
  ];

  for (const [source, get] of candidates) {
    let cf: Record<string, unknown> | undefined;
    try {
      cf = get() as Record<string, unknown> | undefined;
    } catch {
      continue;
    }
    if (!cf || typeof cf !== 'object') continue;

    const num = (v: unknown) => {
      const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

    const geo: Geo = {
      lat: num(cf.latitude),
      lon: num(cf.longitude),
      country: str(cf.country),
      continent: str(cf.continent),
      timezone: str(cf.timezone),
      source,
    };
    if (geo.lat !== null || geo.country || geo.timezone) return geo;
  }

  return empty;
}

/**
 * Which field this reader gets.
 *
 * The country decides the rule and the position decides the answer within it,
 * which is what makes New Hampshire land on Boston and Spokane on Sea-Tac
 * rather than both landing on whatever is biggest.
 *
 * Exported so the choice can be checked against known places without needing
 * a request from each of them.
 */
export function chooseStation(geo: Geo, tzHint: string | null): string {
  const { lat, lon, country, continent } = geo;

  if (lat !== null && lon !== null) {
    if (country === 'US') return nearest(US_FIELDS, lat, lon);
    if (country === 'CA') return nearest(CANADA_FIELDS, lat, lon);
    if (country && continent && CONTINENT_FIELDS[continent]) {
      return CONTINENT_FIELDS[continent].icao;
    }
    // Position but no country worth trusting: nearest of everything.
    return nearest([...US_FIELDS, ...CANADA_FIELDS, ...Object.values(CONTINENT_FIELDS)], lat, lon);
  }

  if (country && country !== 'US' && country !== 'CA' && continent && CONTINENT_FIELDS[continent]) {
    return CONTINENT_FIELDS[continent].icao;
  }

  const zone = geo.timezone ?? tzHint;
  if (zone && ZONE_FIELDS[zone]) return ZONE_FIELDS[zone];

  return DEFAULT_STATION;
}

const USER_AGENT = 'griffindthomas.com (personal aviation site)';

export interface MetarToken {
  /** The group as it appears in the report. */
  t: string;
  /** Plain English, or an empty string for a group this parser cannot read. */
  d: string;
}

export interface MetarPayload {
  status: 'ok' | 'unavailable';
  station: string;
  /** Field name, short form. */
  name: string;
  raw: string;
  /** ISO timestamp of the observation, for a relative age in the UI. */
  observed: string | null;
  /** VFR, MVFR, IFR or LIFR. Empty when the feed does not say. */
  category: string;
  tokens: MetarToken[];
}

// --- decoding ---------------------------------------------------------------

const SKY: Record<string, string> = {
  SKC: 'Sky clear',
  CLR: 'No cloud below 12,000 ft',
  NCD: 'No cloud detected',
  NSC: 'No significant cloud',
  FEW: 'Few',
  SCT: 'Scattered',
  BKN: 'Broken',
  OVC: 'Overcast',
};

const INTENSITY: Record<string, string> = {
  '-': 'Light ',
  '+': 'Heavy ',
  VC: 'In the vicinity, ',
};

const DESCRIPTOR: Record<string, string> = {
  MI: 'shallow ',
  PR: 'partial ',
  BC: 'patches of ',
  DR: 'low drifting ',
  BL: 'blowing ',
  SH: 'showers of ',
  TS: 'thunderstorm with ',
  FZ: 'freezing ',
};

const PHENOMENA: Record<string, string> = {
  DZ: 'drizzle',
  RA: 'rain',
  SN: 'snow',
  SG: 'snow grains',
  IC: 'ice crystals',
  PL: 'ice pellets',
  GR: 'hail',
  GS: 'small hail',
  UP: 'unknown precipitation',
  BR: 'mist',
  FG: 'fog',
  FU: 'smoke',
  VA: 'volcanic ash',
  DU: 'widespread dust',
  SA: 'sand',
  HZ: 'haze',
  PY: 'spray',
  PO: 'dust whirls',
  SQ: 'squalls',
  FC: 'funnel cloud',
  SS: 'sandstorm',
  DS: 'duststorm',
};

const PLAIN: Record<string, string> = {
  METAR: 'Routine hourly observation',
  SPECI: 'Special observation, issued because something changed',
  AUTO: 'Automated report, no human observer',
  COR: 'Corrected report',
  NOSIG: 'No significant change expected',
  CAVOK: 'Nothing below 5,000 ft, 10 km or more, and no weather worth reporting',
  '//': 'Not reported',
  NDV: 'No directional variation given',
  RMK: 'Remarks follow',
  AO1: 'Automated station without a precipitation discriminator',
  AO2: 'Automated station that can tell rain from snow',
  $: 'The station is flagging itself for maintenance',
  PNO: 'Rain gauge not working',
  RVRNO: 'Runway visual range not available',
  TSNO: 'Thunderstorm detector not working',
  FZRANO: 'Freezing rain sensor not working',
  WSHFT: 'Wind shift',
};

const ordinal = (n: number): string => {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

const feet = (hundreds: string): string => (Number(hundreds) * 100).toLocaleString('en-US');

/** METAR writes a leading M for negative, so -5 is M05. */
const signed = (v: string): number => (v.startsWith('M') ? -Number(v.slice(1)) : Number(v));

const toF = (c: number): number => Math.round((c * 9) / 5 + 32);

/** Remarks carry temperatures to a tenth, with 1 as the minus sign. */
const signedTenths = (sign: string, digits: string): string =>
  ((sign === '1' ? -1 : 1) * (Number(digits) / 10)).toFixed(1);

/**
 * One group, decoded.
 *
 * Order matters: the patterns overlap, and a temperature group would be read
 * as a fraction of visibility if visibility were tried first.
 */
function decodeToken(token: string, station: string, inRemarks: boolean): string {
  if (!inRemarks && token === station) return 'Station identifier';
  if (PLAIN[token]) return PLAIN[token];

  let m: RegExpExecArray | null;

  // Day and time of the observation, always Zulu.
  if ((m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(token))) {
    return `Taken on the ${ordinal(Number(m[1]))} at ${m[2]}:${m[3]} Zulu`;
  }

  // Wind. Calm is written as five zeros rather than as a direction.
  if ((m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(token))) {
    const unit = m[4] === 'KT' ? 'knots' : 'metres per second';
    const speed = Number(m[2]);
    if (speed === 0) return 'Wind calm';
    const from = m[1] === 'VRB' ? 'Wind variable' : `Wind from ${Number(m[1])} degrees`;
    const gust = m[3] ? `, gusting ${Number(m[3])}` : '';
    return `${from} at ${speed} ${unit}${gust}`;
  }

  // Direction is reported as a range when it will not sit still.
  if ((m = /^(\d{3})V(\d{3})$/.exec(token))) {
    return `Wind varying between ${Number(m[1])} and ${Number(m[2])} degrees`;
  }

  // Visibility in statute miles, with M for "less than". A value above one
  // mile with a fraction is transmitted with a space in it, which `tokenise`
  // has already put back together into one group.
  if ((m = /^(M)?(\d{1,2})?\s?(\d\/\d)?SM$/.exec(token)) && (m[2] || m[3])) {
    const whole = m[2] ?? '';
    const fraction = m[3] ? `${whole ? ' ' : ''}${m[3]}` : '';
    const less = m[1] ? 'less than ' : '';
    // Anything of a mile or under is one mile, not miles.
    const plural = Number(whole || 0) > 1 || (whole === '1' && m[3]) ? 'miles' : 'mile';
    return `Visibility ${less}${whole}${fraction} statute ${plural}`;
  }

  // Visibility in metres, which is how everywhere outside the US reports it.
  // 9999 is the code for ten kilometres or more rather than a measurement.
  if (!inRemarks && (m = /^(\d{4})(NDV)?$/.exec(token))) {
    const metres = Number(m[1]);
    if (metres === 9999) return 'Visibility 10 km or more';
    return `Visibility ${metres.toLocaleString('en-US')} metres`;
  }

  // Runway visual range, only reported when it is low enough to matter.
  if ((m = /^R(\d{2}[LCR]?)\/([MP]?\d{4})(?:V([MP]?\d{4}))?FT$/.exec(token))) {
    const range = m[3] ? `${m[2]} to ${m[3]}` : m[2];
    return `Runway ${m[1]} visual range ${range.replace(/[MP]/g, '')} ft`;
  }

  // Cloud layer, height in hundreds of feet above the field.
  if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(token))) {
    const kind = m[3] === 'CB' ? ', cumulonimbus' : m[3] === 'TCU' ? ', towering cumulus' : '';
    return `${SKY[m[1]]} cloud at ${feet(m[2])} ft${kind}`;
  }
  if (SKY[token]) return SKY[token];
  if ((m = /^VV(\d{3})$/.exec(token))) {
    return `Sky obscured, vertical visibility ${feet(m[1])} ft`;
  }

  // Present weather. Several phenomena can be strung into one group.
  if (
    (m =
      /^(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$/.exec(
        token,
      ))
  ) {
    const parts = m[3].match(/.{2}/g) ?? [];
    const words = parts.map((p) => PHENOMENA[p] ?? p).join(' and ');
    const phrase = `${INTENSITY[m[1] ?? ''] ?? ''}${DESCRIPTOR[m[2] ?? ''] ?? ''}${words}`;
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }

  // Temperature and dew point, in whole degrees C.
  if (!inRemarks && (m = /^(M?\d{2})\/(M?\d{2})?$/.exec(token))) {
    const t = signed(m[1]);
    const parts = [`Temperature ${t}C (${toF(t)}F)`];
    if (m[2]) {
      const d = signed(m[2]);
      parts.push(`dew point ${d}C (${toF(d)}F)`);
    }
    return parts.join(', ');
  }

  // Altimeter setting. Inches of mercury in the US, hectopascals elsewhere.
  if ((m = /^A(\d{4})$/.exec(token))) {
    return `Altimeter ${m[1].slice(0, 2)}.${m[1].slice(2)} inHg`;
  }
  if ((m = /^Q(\d{4})$/.exec(token))) return `Altimeter ${Number(m[1])} hPa`;

  // Remarks. Only the groups worth reading are decoded; the rest are for
  // forecasters and automated systems, and saying so is better than guessing.
  if (inRemarks) {
    if ((m = /^SLP(\d{3})$/.exec(token))) {
      const raw = Number(m[1]);
      const hpa = (raw >= 500 ? 900 + raw / 10 : 1000 + raw / 10).toFixed(1);
      return `Sea level pressure ${hpa} hPa`;
    }
    if ((m = /^T([01])(\d{3})([01])(\d{3})$/.exec(token))) {
      const t = (m[1] === '1' ? -1 : 1) * (Number(m[2]) / 10);
      const d = (m[3] === '1' ? -1 : 1) * (Number(m[4]) / 10);
      return `Temperature ${t.toFixed(1)}C and dew point ${d.toFixed(1)}C, to a tenth`;
    }
    if ((m = /^P(\d{4})$/.exec(token))) {
      return `${(Number(m[1]) / 100).toFixed(2)} in of rain in the last hour`;
    }
    if ((m = /^1([01])(\d{3})$/.exec(token))) {
      return `Six hour maximum temperature ${signedTenths(m[1], m[2])}C`;
    }
    if ((m = /^2([01])(\d{3})$/.exec(token))) {
      return `Six hour minimum temperature ${signedTenths(m[1], m[2])}C`;
    }
    if ((m = /^4([01])(\d{3})([01])(\d{3})$/.exec(token))) {
      return `Day's high ${signedTenths(m[1], m[2])}C, low ${signedTenths(m[3], m[4])}C`;
    }
    if ((m = /^5([0-8])(\d{3})$/.exec(token))) {
      const dir = Number(m[1]) < 4 ? 'rising' : Number(m[1]) === 4 ? 'steady' : 'falling';
      return `Pressure ${dir}, ${(Number(m[2]) / 10).toFixed(1)} hPa over three hours`;
    }
    return '';
  }

  return '';
}

export function tokenise(raw: string, station: string): MetarToken[] {
  const groups: string[] = [];
  let inRemarks = false;

  // Visibility of more than a mile with a fraction is the one group in a
  // METAR that contains a space, so "2 1/2SM" arrives as two groups. Split
  // apart it decodes as half a mile, which is the difference between a normal
  // day and a diversion, so it is put back together before anything reads it.
  const split = raw.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < split.length; i += 1) {
    const next = split[i + 1];
    if (/^\d{1,2}$/.test(split[i]) && next && /^\d\/\dSM$/.test(next)) {
      groups.push(`${split[i]} ${next}`);
      i += 1;
    } else {
      groups.push(split[i]);
    }
  }

  return groups.map((t) => {
    const decoded = decodeToken(t, station, inRemarks);
    if (t === 'RMK') inRemarks = true;
    return { t, d: decoded };
  });
}

// --- route ------------------------------------------------------------------

interface Observation {
  icaoId?: string;
  name?: string;
  rawOb?: string;
  reportTime?: string;
  fltCat?: string;
}

/** An explicit `?station=` wins, if it is one this route will fetch. */
function askedFor(url: URL): string | null {
  const asked = (url.searchParams.get('station') ?? '').toUpperCase();
  return STATIONS.includes(asked) ? asked : null;
}

/**
 * "Seattle/Boeing Fld, WA, US" is how the feed writes a field name. The strip
 * has room for the field, not for the state and the country.
 */
const shortName = (name: string): string => name.split(',')[0]?.trim() ?? '';

export const GET: APIRoute = async ({ url, locals, request }) => {
  const debug = url.searchParams.get('debug') === '1';

  const explicit = askedFor(url);
  const geo = readGeo(locals, request);
  const id = explicit ?? chooseStation(geo, url.searchParams.get('tz'));

  const cacheStore =
    typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  // Astro v6 moved the Workers ExecutionContext to `locals.cfContext`. The old
  // `locals.runtime.ctx` path still exists as a getter that throws, so it must
  // not be probed with optional chaining.
  const cfContext = (locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } })
    ?.cfContext;

  const cacheKey = new Request(`https://metar-cache.internal/v1?station=${id}`, { method: 'GET' });

  /**
   * Two different sets of headers for the same report.
   *
   * The strip asks for `/api/metar.json` with no station on it, and the answer
   * depends on where the reader is, so a shared cache holding that URL would
   * hand one reader's field to the next one. The copy sent back is `private`:
   * browsers may keep it, shared caches may not.
   *
   * The copy stored below is keyed by station rather than by URL, so it is
   * safe to share and is marked `public`. One upstream fetch still serves
   * everyone asking for that field, which is the point of caching it, and
   * nobody in Seattle is told about Phoenix.
   */
  const headers = (shared: boolean, cacheable = true) => ({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheable
      ? `${shared || explicit ? 'public' : 'private'}, max-age=${CACHE_SECONDS}, stale-while-revalidate=600`
      : 'no-store',
  });

  if (cacheStore && !debug) {
    const hit = await cacheStore.match(cacheKey);
    // Re-wrapped rather than returned as it stands: what is stored is the
    // shareable copy, and this request may not be allowed to share it.
    if (hit) return new Response(await hit.text(), { status: 200, headers: headers(false) });
  }

  let payload: MetarPayload = {
    status: 'unavailable',
    station: id,
    name: '',
    raw: '',
    observed: null,
    category: '',
    tokens: [],
  };
  let failure: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://aviationweather.gov/api/data/metar?ids=${id}&format=json`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      },
    );
    if (!res.ok) {
      failure = `HTTP ${res.status}`;
    } else {
      const list = (await res.json()) as Observation[];
      const ob = Array.isArray(list) ? list.find((o) => o?.rawOb) : undefined;
      if (!ob?.rawOb) {
        failure = 'no observation in response';
      } else {
        // The feed prefixes some reports with METAR and some not. Keeping it
        // as sent is the honest thing: it is the actual report.
        const raw = ob.rawOb.trim();
        payload = {
          status: 'ok',
          station: ob.icaoId ?? id,
          name: shortName(ob.name ?? ''),
          raw,
          observed: ob.reportTime ? new Date(ob.reportTime).toISOString() : null,
          category: ob.fltCat ?? '',
          tokens: tokenise(raw, ob.icaoId ?? id),
        };
      }
    }
  } catch (err) {
    failure = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  } finally {
    clearTimeout(timer);
  }

  const body = debug ? { ...payload, debug: { failure, geo, chose: id, explicit } } : payload;
  const json = JSON.stringify(body);
  const cacheable = payload.status === 'ok' && !debug;

  if (cacheStore && cacheable) {
    const put = cacheStore.put(cacheKey, new Response(json, { status: 200, headers: headers(true) }));
    if (cfContext?.waitUntil) cfContext.waitUntil(put);
    else await put;
  }

  return new Response(json, { status: 200, headers: headers(false, cacheable) });
};
