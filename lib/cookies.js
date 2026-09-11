/*
  lib/cookies.js
  --------------------------------------------------------------------------
  ONE definition of how a session cookie is written, shared by all three
  clients that write one.

  WHY THIS FILE EXISTS AS ITS OWN THING.

  lib/supabaseClient.js set these carefully and explained each choice. Neither
  server client passed cookieOptions at all — and @supabase/ssr's
  DEFAULT_COOKIE_OPTIONS is `{ path, sameSite: 'lax', httpOnly: false, maxAge }`
  with NO `secure` key. So the browser set a Secure cookie, and the first
  server-side refresh re-issued the same cookie without it. The comment in
  supabaseClient.js promising "SameSite=Lax and Secure" stopped being true
  after one token refresh, and nothing anywhere would have said so.

  That is the failure mode a shared constant prevents: not a wrong value, but
  three copies of a value where two of them are silently absent.
  -------------------------------------------------------------------------- */

export const COOKIE_OPTIONS = {
  /* Lax, not Strict. Strict would break the email-confirmation link: arriving
     from the inbox is a cross-site navigation, and a Strict cookie is withheld
     on it — so the user lands signed out on the page that exists to sign them
     in. Lax withholds the cookie on cross-site POSTs, which is the CSRF case
     that matters.

     Lax is NOT sufficient on its own for the destructive routes, because
     SameSite is site-scoped rather than origin-scoped: anything on a sibling
     subdomain counts as same-site. See the Sec-Fetch-Site / Origin check in
     app/api/_guard.js. */
  sameSite: 'lax',
  /* localhost has no TLS, and a Secure cookie is simply dropped there — which
     presents as "login does nothing" with no error anywhere. */
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}
