/**
 * Takes the passphrase, sets the cookie, sends you back where you were going.
 *
 * POST only. A GET that set a cookie could be triggered by an image tag on
 * somebody else's page, and there is no reason for this to answer one.
 */
import type { APIRoute } from 'astro';

import {
  GATE_COOKIE,
  GATE_MAX_AGE,
  GATE_PATH,
  issuedToken,
  passphrase,
  passphraseMatches,
  safeReturnPath,
} from '../../lib/trips-gate';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const secret = passphrase();
  if (!secret) return redirect(GATE_PATH, 303);

  const form = await request.formData();
  const submitted = String(form.get('passphrase') ?? '');
  const next = safeReturnPath(String(form.get('next') ?? ''));

  if (!(await passphraseMatches(submitted, secret))) {
    // Back to the form with a flag, and never with the attempt echoed into the
    // URL: a wrong guess is still somebody's password and does not belong in
    // a browser history or a server log.
    return redirect(`/trips/locked?wrong=1&next=${encodeURIComponent(next)}`, 303);
  }

  cookies.set(GATE_COOKIE, await issuedToken(secret), {
    path: GATE_PATH,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: GATE_MAX_AGE,
  });

  // 303, so the browser follows with a GET and a refresh does not re-post.
  return redirect(next, 303);
};
