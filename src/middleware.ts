/**
 * Runs in front of every request the Worker handles.
 *
 * Its only job is the lock on /trips. Everything else on the site is meant to
 * be found, indexed and answered about, so it passes straight through.
 *
 * Note the order this has to happen in: the trips routes are `prerender =
 * false` so that they are rendered by the Worker and therefore reach this
 * file. Left prerendered they would be served as static files by Cloudflare's
 * asset handler, which runs before any of this and would hand out the pages
 * without ever asking. A gate that the content can be served around is not a
 * gate, so if a trips route ever goes back to being prerendered, this stops
 * protecting it silently.
 */
import { defineMiddleware } from 'astro:middleware';

import { GATE_COOKIE, cookieIsValid, isGated, passphrase } from './lib/trips-gate';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (!isGated(pathname)) return next();

  const secret = passphrase();

  // Carried explicitly rather than read back off the rewritten request, so
  // that unlocking returns to the page that was asked for.
  const locked = `/trips/locked?next=${encodeURIComponent(pathname + context.url.search)}`;

  /**
   * No passphrase configured.
   *
   * In development that is normal and the section is simply open, because
   * requiring a secret to work on the pages would mean putting one in the
   * repo. In production it is a mistake, and the safe reading of a mistake in
   * a lock is that it is locked: better Griffin finds /trips asking for a
   * passphrase nobody can supply than that it quietly serves to everyone.
   */
  if (!secret) {
    if (import.meta.env.DEV) return next();
    return context.rewrite(locked);
  }

  if (await cookieIsValid(context.cookies.get(GATE_COOKIE)?.value, secret)) return next();

  // Rewrite rather than redirect, so the address bar still reads /trips/hiking
  // and unlocking lands on the page that was actually asked for.
  return context.rewrite(locked);
});
