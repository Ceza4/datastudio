/*
  lib/supabase/server.js
  --------------------------------------------------------------------------
  The two server-side clients. Neither of these may ever be imported from a
  file that ships to the browser.

  TWO CLIENTS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS

  serverClient(cookies)  — acts AS THE SIGNED-IN USER. Reads the session from
    the request's cookies and sends the anon key, so every query it makes is
    still filtered by RLS. This is what a route handler should use for
    anything the user could have done themselves. Using it means a bug in the
    route cannot read another tenant's data, because Postgres will not let it.

  adminClient()          — acts as the SERVICE ROLE and bypasses RLS entirely.
    Reserved for the three things that genuinely cannot be done as the user:
    deleting an auth user, revoking sessions, and writing billing state from a
    webhook where there is no user session at all.

  THE RULE FOR adminClient: every call site must do its own authorization
  check first, because Postgres will not do one for it. It is the one place in
  this codebase where "is this allowed?" is a question the application has to
  answer rather than the database. Treat each use as a small security review.
  -------------------------------------------------------------------------- */

import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { COOKIE_OPTIONS } from '../cookies.js'

/* Named SUPABASE_URL, not URL. `const URL = …` at module scope shadows the
   global URL constructor for the whole file — harmless today because nothing
   here parses a URL, and a landmine for whoever next writes `new URL(...)`. */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
/* NOT prefixed NEXT_PUBLIC_, and that prefix is the whole safety mechanism:
   Next inlines NEXT_PUBLIC_* into the client bundle at build time. A service
   role key with that prefix would be shipped to every visitor, and it bypasses
   every RLS policy in supabase/migrations. */
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * A client scoped to the signed-in user, for route handlers and server
 * components.
 *
 * @param {object} cookieStore  the result of `await cookies()` from next/headers
 */
export function serverClient(cookieStore) {
  if (!SUPABASE_URL || !ANON) return null
  return createServerClient(SUPABASE_URL, ANON, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options)
        } catch {
          /* Called from a Server Component, where cookies are read-only. That
             is not an error: middleware.js refreshes the session on every
             request, so the write this call could not make has already
             happened one layer up. Swallowing it here is what the Supabase
             docs prescribe, and the reason is worth keeping written down —
             otherwise it looks like a silenced failure. */
        }
      },
    },
    /* Same options the browser client uses. Without them @supabase/ssr falls
       back to DEFAULT_COOKIE_OPTIONS, which has no `secure` key — so a
       server-side refresh re-issued the session cookie without it and quietly
       undid the browser's care. See lib/cookies.js. */
    cookieOptions: COOKIE_OPTIONS,
  })
}

/**
 * Service role. Bypasses RLS. Server-only, and only for operations that have
 * no user-scoped equivalent.
 *
 * Throws rather than returning null when the key is missing, because every
 * caller is a privileged operation and "quietly did nothing" is the worst
 * possible outcome for a deletion request.
 */
export function adminClient() {
  if (!SERVICE) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. This is a server-only secret — ' +
      'set it in the deployment environment, never in a NEXT_PUBLIC_ variable.'
    )
  }
  /* PLAIN createClient, NOT createServerClient.

     The SSR factory forces its own auth options AFTER spreading the caller's:
     `persistSession: false` was silently overridden to true and the cookie
     storage adapter installed regardless. It worked only because the cookie
     stub returns an empty list — so the day somebody "fixes" that stub to
     forward the request's cookies, which is an entirely natural-looking
     change, this client starts sending the user's access token as
     Authorization while still sending the service key as apikey, and every
     privileged operation quietly degrades to a user-scoped one.

     A service-role client has no session to persist and no cookies to read.
     Using the factory that says so removes the trap rather than commenting on
     it. */
  return createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

/** True when the deployment has what it needs for privileged routes. */
export const hasServiceRole = () => Boolean(SERVICE)
