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

   The house rule is "large dependencies -> dynamic import, never static", and
   this one earns it twice over. A static import puts the whole auth SDK in
   the FIRST bundle of an app whose entire pitch is that it opens instantly
   and works with no account — so every user pays for a feature most of them
   never touch, and a build with no Supabase project configured pays for one
   that cannot even run.

   The cost is that getSupabase() is async. That is fine here and was checked
   before doing it: lib/auth.js is the only consumer and every one of its
   operations was already async. onAuthChange keeps a synchronous signature by
   returning its unsubscribe immediately and attaching once the module lands.

   Both the module and the client are cached, so the import happens at most
   once per session. */

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
      if (!sdkPromise) sdkPromise = import('@supabase/supabase-js')
      const { createClient } = await sdkPromise
      cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
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
