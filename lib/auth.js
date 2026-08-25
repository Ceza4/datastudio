/*
  lib/auth.js
  --------------------------------------------------------------------------
  Sign up, sign in, sign out. The only module that touches supabase.auth.

  THE RULE THAT GOVERNS EVERY FUNCTION HERE: AUTH NEVER GATES LOCAL USE.

  DataStudio works with no account, no network and no Supabase project
  configured at all. An account buys sync; it does not buy access. So every
  function below returns a RESULT rather than throwing, and "not configured"
  is a first-class answer with its own reason code — not an error, not a
  crash, not a spinner that never stops. A missing env var during dev, a
  fresh clone, an offline flight: all of those land in the same branch as
  "signed out", which is a state the app already handles perfectly.

  WHY THERE IS NO MIDDLEWARE AND NO @supabase/ssr

  The obvious next step after auth is a Next.js middleware that redirects
  signed-out users away from /app. It is not being built, on purpose:

    · every page in this app renders LOCAL data out of IndexedDB. There is no
      server-rendered private content to protect, so a redirect protects a
      route that contains nothing
    · the real boundary is row-level security in Postgres, which is already
      applied and pen-tested (supabase/rls_pentest.sql). A signed-out client
      holding a stolen URL still sees zero rows
    · redirecting away from /app would BREAK the product's main promise, which
      is that you can open it and work without an account

  A middleware here would be theatre that costs a dependency and removes a
  feature. If server-rendered private data ever exists, revisit — that is the
  condition, not "we should probably have middleware".

  ERROR MESSAGES ARE TRANSLATED, NOT PASSED THROUGH. Supabase returns things
  like "Invalid login credentials" and "User already registered", which are
  accurate and unhelpful. describeAuthError turns them into a sentence that
  says what to do next.
  -------------------------------------------------------------------------- */

import { getSupabase, isSupabaseConfigured } from './supabaseClient.js'

/** Reason codes. Callers should switch on these, never on message text. */
export const AUTH = {
  OK: 'ok',
  /** No Supabase project configured. Local-only, and that is fine. */
  UNCONFIGURED: 'unconfigured',
  /** The input never left the browser — bad email, short password. */
  INVALID: 'invalid',
  /** Supabase said no. */
  REJECTED: 'rejected',
  /** Could not reach Supabase at all. */
  OFFLINE: 'offline',
  /** A confirmation email was sent and the session does not exist yet. */
  CONFIRM_EMAIL: 'confirm-email',
}

/* Supabase's own default is 6. Six is not a password, and raising it here
   costs nothing because the check runs before the request — but it must not
   be raised ABOVE what the project enforces, or the client would refuse
   passwords the server would accept and the two would disagree about who is
   right. */
export const MIN_PASSWORD = 8

/* Deliberately loose. Email validation by regex is a famous tar pit: every
   strict pattern rejects addresses that are legal and deliverable. The only
   real test is whether the confirmation arrives, so this catches typing
   accidents ("no @", trailing space) and lets the server decide the rest. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(value) {
  const email = String(value ?? '').trim()
  if (!email) return { ok: false, message: 'Enter your email address.' }
  if (!EMAIL_RE.test(email)) return { ok: false, message: 'That does not look like an email address.' }
  return { ok: true, email: email.toLowerCase() }
}

export function validatePassword(value, { signup = false } = {}) {
  const password = String(value ?? '')
  if (!password) return { ok: false, message: 'Enter your password.' }
  /* Length is only enforced on the way IN. An existing account may have been
     created under the old six-character rule, and locking someone out of
     their own data because the policy changed is not a security improvement. */
  if (signup && password.length < MIN_PASSWORD) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD} characters.` }
  }
  return { ok: true, password }
}

/**
 * Supabase's message -> something worth reading.
 * Matched on lowercased substrings because the API returns prose, not codes,
 * for most of these.
 */
export function describeAuthError(err) {
  const raw = String(err?.message || err || '').toLowerCase()
  if (!raw) return 'Something went wrong. Try again.'
  if (raw.includes('invalid login credentials')) return 'That email and password do not match an account.'
  if (raw.includes('email not confirmed')) return 'Check your inbox and confirm your email address first.'
  if (raw.includes('user already registered') || raw.includes('already been registered')) {
    return 'There is already an account with that email. Try signing in instead.'
  }
  if (raw.includes('password should be at least')) return `Use at least ${MIN_PASSWORD} characters.`
  if (raw.includes('rate limit') || raw.includes('too many')) return 'Too many attempts. Wait a minute and try again.'
  if (raw.includes('failed to fetch') || raw.includes('network')) {
    return 'Could not reach the server. Your work is saved on this device either way.'
  }
  /* Falls back to the raw message rather than to a generic one. An unmapped
     error is a gap in this list, and hiding it behind "something went wrong"
     is how the gap survives to the next release. */
  return err?.message || 'Something went wrong. Try again.'
}

const offline = err => String(err?.message || '').toLowerCase().includes('fetch')

/* ── the operations ───────────────────────────────────────────────────── */

export async function signUp(emailInput, passwordInput, client) {
  /* `undefined` means "resolve the shared client"; an explicit `null`
     means "there is none" and must NOT be resolved — that distinction is
     what lets the tests exercise the unconfigured branch without a
     network, and it is why this is not a default parameter. */
  const c = client === undefined ? await getSupabase() : client
  const e = validateEmail(emailInput)
  if (!e.ok) return { status: AUTH.INVALID, message: e.message, field: 'email' }
  const p = validatePassword(passwordInput, { signup: true })
  if (!p.ok) return { status: AUTH.INVALID, message: p.message, field: 'password' }
  if (!c) return { status: AUTH.UNCONFIGURED, message: unconfiguredMessage() }

  try {
    const { data, error } = await c.auth.signUp({ email: e.email, password: p.password })
    if (error) return { status: AUTH.REJECTED, message: describeAuthError(error) }
    /* A project with email confirmation ON returns a user and NO session.
       Treating that as success sends someone to a signed-in screen that is
       not signed in; treating it as failure hides the fact that the account
       was created. It is its own outcome. */
    if (!data?.session) {
      return { status: AUTH.CONFIRM_EMAIL, message: `Check ${e.email} for a confirmation link.`, user: data?.user || null }
    }
    return { status: AUTH.OK, session: data.session, user: data.user }
  } catch (err) {
    return { status: offline(err) ? AUTH.OFFLINE : AUTH.REJECTED, message: describeAuthError(err) }
  }
}

export async function signIn(emailInput, passwordInput, client) {
  /* `undefined` means "resolve the shared client"; an explicit `null`
     means "there is none" and must NOT be resolved — that distinction is
     what lets the tests exercise the unconfigured branch without a
     network, and it is why this is not a default parameter. */
  const c = client === undefined ? await getSupabase() : client
  const e = validateEmail(emailInput)
  if (!e.ok) return { status: AUTH.INVALID, message: e.message, field: 'email' }
  const p = validatePassword(passwordInput)
  if (!p.ok) return { status: AUTH.INVALID, message: p.message, field: 'password' }
  if (!c) return { status: AUTH.UNCONFIGURED, message: unconfiguredMessage() }

  try {
    const { data, error } = await c.auth.signInWithPassword({ email: e.email, password: p.password })
    if (error) return { status: AUTH.REJECTED, message: describeAuthError(error) }
    return { status: AUTH.OK, session: data.session, user: data.user }
  } catch (err) {
    return { status: offline(err) ? AUTH.OFFLINE : AUTH.REJECTED, message: describeAuthError(err) }
  }
}

export async function signOut(client) {
  /* `undefined` means "resolve the shared client"; an explicit `null`
     means "there is none" and must NOT be resolved — that distinction is
     what lets the tests exercise the unconfigured branch without a
     network, and it is why this is not a default parameter. */
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: AUTH.OK }
  try {
    const { error } = await c.auth.signOut()
    if (error) return { status: AUTH.REJECTED, message: describeAuthError(error) }
    return { status: AUTH.OK }
  } catch (err) {
    /* Sign-out failing on the network still has to sign you out LOCALLY, or
       a flaky connection leaves someone stuck in an account they are trying
       to leave — on a shared machine that is the worst possible failure. The
       local token is cleared by supabase-js before the request goes out. */
    return { status: AUTH.OK, message: describeAuthError(err) }
  }
}

export async function getSession(client) {
  /* `undefined` means "resolve the shared client"; an explicit `null`
     means "there is none" and must NOT be resolved — that distinction is
     what lets the tests exercise the unconfigured branch without a
     network, and it is why this is not a default parameter. */
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: AUTH.UNCONFIGURED, session: null, user: null }
  try {
    const { data, error } = await c.auth.getSession()
    if (error) return { status: AUTH.REJECTED, session: null, user: null, message: describeAuthError(error) }
    return { status: AUTH.OK, session: data?.session || null, user: data?.session?.user || null }
  } catch (err) {
    return { status: AUTH.OFFLINE, session: null, user: null, message: describeAuthError(err) }
  }
}

/**
 * Subscribe to sign-in / sign-out, including in ANOTHER TAB — supabase-js
 * broadcasts across tabs, and two DataStudio windows disagreeing about who is
 * signed in is exactly the kind of thing nobody reproduces on purpose.
 *
 * @returns {() => void} unsubscribe. Always safe to call.
 */
export function onAuthChange(handler, client) {
  if (typeof handler !== 'function') return () => {}

  let detach = () => {}
  let cancelled = false

  const attach = c => {
    /* Unmounted before the SDK finished loading. Attaching now would leave a
       subscription nobody holds the unsubscribe for — the classic async-effect
       leak, and the one that survives longest because it never throws. */
    if (cancelled || !c) return
    try {
      const { data } = c.auth.onAuthStateChange((event, session) => {
        handler({ event, session: session || null, user: session?.user || null })
      })
      detach = () => { try { data?.subscription?.unsubscribe() } catch { /* already gone */ } }
    } catch { /* a client that cannot subscribe is a client that never fires */ }
  }

  /* Synchronous signature, asynchronous attachment. Callers use this from an
     effect and need the unsubscribe back immediately; making it async would
     push that problem into every one of them. */
  if (client !== undefined) attach(client)
  else getSupabase().then(attach).catch(() => {})

  return () => { cancelled = true; detach() }
}

export function unconfiguredMessage() {
  return 'Accounts are not set up on this build. DataStudio keeps working — everything is saved on this device.'
}

export { isSupabaseConfigured }
