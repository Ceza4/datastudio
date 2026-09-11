/*
  lib/supabaseClient.js
  --------------------------------------------------------------------------
  Single choke point for talking to Supabase. Nothing else in the codebase
  should call `createClient` directly — import `getSupabase()` from here.

  WHY THIS RETURNS null WHEN UNCONFIGURED, RATHER THAN THROWING
  DataStudio's whole position is local-first: the app must keep working with
  no account and no network (see DATASTUDIO-BACKEND-PLAN.md §4, "Anonymous
  use must survive"). That has to hold even before Supabase is *configured*
  at all — a missing env var during dev, a fresh clone, a CI run — none of
  those should crash IndexedDB-only usage. Every call site is expected to
  treat a null client as "sync/auth unavailable, carry on locally," the same
  way it already treats being offline.

  WHAT'S NOT HERE YET (by design — see DATASTUDIO-BACKEND-PLAN.md order of
  work, this file is step 1 only)
    - No auth helpers. login/signup pages are still the setTimeout stubs.
    - No @supabase/ssr / cookie-based server client. That lands with real
      auth + middleware route protection (plan step 2), not with this file.
    - No sync.js. Push/pull/conflict-copy logic (plan step 3) is separate
      and depends on auth existing first.
  This file's only job is: "can we reach Supabase, and with which keys."
  -------------------------------------------------------------------------- */

/* WHY THE SDK IS LOADED WITH A DYNAMIC import()

   The house rule is "large dependencies -> dynamic import, never static". It
   still earns it, though less than it used to: an account is now required, so
   almost everyone who reaches /app will load this. What it still buys is the
   LANDING page — a black wall at `/` that has no business shipping an auth SDK
   to somebody who is not signing in yet.

   The cost is that getSupabase() is async. That was checked before doing it:
   lib/auth.js is the only consumer and every one of its operations was already
   async. onAuthChange keeps a synchronous signature by returning its
   unsubscribe immediately and attaching once the module lands.

   Both the module and the client are cached, so the import happens at most
   once per session.

   WHY createBrowserClient RATHER THAN createClient
   ------------------------------------------------
   The session used to live in localStorage, which is where supabase-js puts it
   by default. The security checklist calls that out directly — "never store
   authentication tokens in insecure locations such as arbitrary localStorage" —
   and the practical consequence is sharper than the principle: a token in
   localStorage is readable by any script that reaches this origin, so a single
   XSS is a full account takeover rather than a defaced page.

   @supabase/ssr's createBrowserClient writes the session to COOKIES instead.
   Three things follow, and only the first is about XSS:

     1. the cookie is set with SameSite=Lax and Secure, so it does not travel
        cross-site and does not travel in the clear;
     2. middleware.js can READ it, which is what makes a server-side gate on
        /app possible at all — a localStorage token is invisible to the edge,
        so the "no access without an account" requirement could never have been
        more than a client-side redirect;
     3. the session refreshes on the server during navigation, so a returning
        user is signed in before the first byte of the app renders rather than
        after a hydration round trip.

   HttpOnly is deliberately NOT set, and that is worth being explicit about
   rather than looking like an oversight: supabase-js is a browser library and
   must read its own access token to attach it to PostgREST requests. An
   HttpOnly session cookie would be invisible to the very code that needs it.
   The mitigation for that is the layer above — a CSP with a per-request nonce
   and no unsafe-inline (see middleware.js), so there is no script in the
   document that can read it. */
import { COOKIE_OPTIONS } from './cookies.js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let cached = null
let sdkPromise = null
let warned = false

/**
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient | null>}
 *   null when the env vars aren't set — callers must handle this, not throw.
 */
export async function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (!warned && typeof window !== 'undefined') {
      // One console warning per session, not per call — this fires on every
      // render otherwise once something calls getSupabase() from a hook.
      console.warn(
        '[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
        'not set — sync and cloud auth are disabled, DataStudio continues ' +
        'local-only. See .env.local.example.'
      )
      warned = true
    }
    return null
  }

  if (!cached) {
    try {
      /* The promise itself is cached, not just the result: two callers racing
         on first use would otherwise each start their own import. */
      if (!sdkPromise) sdkPromise = import('@supabase/ssr')
      const { createBrowserClient } = await sdkPromise
      cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        /* Shared with proxy.js and lib/supabase/server.js — see lib/cookies.js
           for why this is a constant rather than three copies. */
        cookieOptions: COOKIE_OPTIONS,
      })
    } catch (err) {
      /* A chunk that fails to load is a network problem, not a crash. Same
         contract as being unconfigured: no client, app carries on locally.
         The promise is cleared so a later attempt can retry rather than
         being stuck on one bad load forever. */
      sdkPromise = null
      if (typeof console !== 'undefined') console.warn('[supabase] SDK failed to load — continuing local-only.', err)
      return null
    }
  }
  return cached
}

/** True once real env vars are present. Cheap enough to call from render. */
export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

/**
 * The raw URL and anon key, for the ONE caller that cannot use the SDK.
 *
 * lib/sync.js needs to fire a last-gasp push from a `pagehide` handler, where
 * nothing may be awaited: the page is going away and any promise still in
 * flight dies with it. `fetch(..., { keepalive: true })` is the only thing the
 * browser guarantees to finish, it takes no client object, and supabase-js has
 * no way to hand back a request without sending it.
 *
 * Exported deliberately narrowly. Anything that CAN await getSupabase() must —
 * a second code path to PostgREST is a second place for auth headers, error
 * translation and RLS assumptions to drift apart.
 */
export function supabaseConfig() {
  return { url: SUPABASE_URL || null, anonKey: SUPABASE_ANON_KEY || null }
}
