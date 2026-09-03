/**
 * The lock on /trips.
 *
 * One shared passphrase. Griffin hands it out to whoever he shows the site to,
 * and everyone else, which in practice means Google, the AI crawlers and
 * anything scraping, gets a form and no content. That is the whole threat
 * model: it is not trying to stop somebody the passphrase was given to, and it
 * would be dishonest to describe it as if it were.
 *
 * The passphrase itself is a Cloudflare secret and is never in this repo,
 * which matters more than usual here because the repo is public. Nothing
 * derived from it is committed either: the cookie carries an HMAC of a fixed
 * string keyed by the passphrase, so the cookie cannot be worked backwards
 * into the passphrase, and changing the secret invalidates every cookie
 * already issued.
 *
 * Everything here runs on Web Crypto, which the Worker has natively.
 */
import { TRIPS_PASSPHRASE } from 'astro:env/server';

const encoder = new TextEncoder();

/** Cookie name. Scoped to /trips, so it is not sent with any other request. */
export const GATE_COOKIE = 'trips_pass';
export const GATE_PATH = '/trips';
/** Ninety days: long enough that nobody is asked twice on the same laptop. */
export const GATE_MAX_AGE = 60 * 60 * 24 * 90;

/** The two routes the gate has to let past, or there is no way to unlock it. */
export const GATE_OPEN_PATHS = new Set(['/trips/locked', '/trips/unlock']);

/** Does this path belong to the section? `/tripsomething` does not. */
export const isGated = (pathname: string) =>
  (pathname === '/trips' || pathname.startsWith('/trips/')) && !GATE_OPEN_PATHS.has(pathname);

export const passphrase = () => TRIPS_PASSPHRASE;

const base64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Compares two strings without letting the time taken say how much of them
 * matched. Only safe on equal-length inputs, which is why both callers below
 * hash first: a digest is always the same length, so nothing leaks about the
 * length of what was typed either.
 */
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const digest = async (value: string) =>
  base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

/** What a correct passphrase is worth: the value the cookie has to carry. */
export async function issuedToken(secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode('trips-gate-v1')));
}

export async function passphraseMatches(submitted: string, secret: string) {
  return constantTimeEqual(await digest(submitted), await digest(secret));
}

export async function cookieIsValid(cookieValue: string | undefined, secret: string) {
  if (!cookieValue) return false;
  return constantTimeEqual(cookieValue, await issuedToken(secret));
}

/**
 * Where to send someone once they are through.
 *
 * Only ever a path inside this site's own trips section. Taking the raw value
 * would turn the unlock form into an open redirect: a link could carry
 * `?next=https://somewhere.else` and the site would send people there itself,
 * which is exactly the shape used to make a phishing link look legitimate.
 */
export function safeReturnPath(raw: string | null) {
  if (!raw) return GATE_PATH;
  // Reject anything with a scheme or host, and `//host` which browsers read
  // as protocol-relative and follow off-site.
  if (!raw.startsWith('/') || raw.startsWith('//')) return GATE_PATH;
  return isGated(new URL(raw, 'https://x.invalid').pathname) ? raw : GATE_PATH;
}
