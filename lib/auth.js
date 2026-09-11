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
  /** A second factor is required before the session becomes usable. */
  MFA_REQUIRED: 'mfa-required',
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
  /* THE SAME SENTENCE FOR BOTH, AND THAT IS THE POINT.

     `email not confirmed` used to have its own message. Enormous care went
     into making signup (below) and password reset non-enumerable — and then
     the login form answered the same question directly: submit any password
     against an address, and two distinct responses told you whether that
     address was registered. Same oracle, different door, on the form an
     attacker reaches first.

     Supabase returns `email_not_confirmed` only when the credentials are
     otherwise VALID, which is precisely why it leaks: it is a positive
     identification. So the guidance about checking the inbox moves to
     signIn(), which can surface it once the password has already proved the
     caller owns the account. Someone who cannot supply the password learns
     nothing either way. */
  if (raw.includes('invalid login credentials') || raw.includes('email not confirmed')) {
    return 'That email and password do not match an account.'
  }
  /* NOT "there is already an account with that email".
     ------------------------------------------------------------------------
     That message is an account-enumeration oracle: it turns the signup form
     into a free API for asking "does this person use DataStudio?", which for a
     tool holding unpublished research is a question with real consequences for
     the people being asked about. Anyone can run a list of addresses through
     it.

     Supabase's own default already avoids this when email confirmation is ON —
     signUp for an existing address returns a user with an EMPTY identities
     array and no error, deliberately indistinguishable from a real signup.
     signUp() below detects that and reports CONFIRM_EMAIL, so the two paths
     look identical to the browser as well as to the server.

     This branch is the fallback for a project with confirmation switched off,
     where Supabase does surface the error. The wording stays uniform with the
     success case; the person who genuinely owns that address finds out from
     the email, which only they can read. */
  if (raw.includes('user already registered') || raw.includes('already been registered')) {
    return 'Check your inbox to finish setting up your account.'
  }
  if (raw.includes('password should be at least')) return `Use at least ${MIN_PASSWORD} characters.`
  if (raw.includes('rate limit') || raw.includes('too many')) return 'Too many attempts. Wait a minute and try again.'
  if (raw.includes('failed to fetch') || raw.includes('network')) {
    return 'Could not reach the server. Your work is saved on this device either way.'
  }
  /* AN UNMAPPED ERROR IS LOGGED, NOT RENDERED.

     This used to return `err.message` on the grounds that hiding a gap is how
     the gap survives to the next release. The instinct is right and the
     mechanism was wrong: GoTrue's unmapped prose includes things like "For
     security purposes, you can only request this after 47 seconds", which
     hands the caller the state of a per-address rate limiter — i.e. another
     enumeration oracle, arriving through the branch that exists to catch the
     ones we forgot.

     The gap still gets found; it gets found in the console and the server log,
     where the person who can fix it is looking, rather than on the screen of
     the person probing for it. */
  if (err?.message && typeof console !== 'undefined') {
    console.warn('[auth] unmapped error:', err.message)
  }
  return 'Something went wrong. Try again.'
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
    /* An EXISTING address comes back here too, with a user object whose
       `identities` array is empty — Supabase's deliberate anti-enumeration
       behaviour. Treating it as anything other than an ordinary "check your
       inbox" would undo that at the last step. The real owner gets an email
       telling them someone tried to sign up; nobody else learns anything. */
    if (!data?.session) {
      return {
        status: AUTH.CONFIRM_EMAIL,
        message: `Check ${e.email} for a confirmation link.`,
        user: data?.user || null,
        /* Never rendered. Present so a future maintainer reading a log can
           tell the two cases apart, which is legitimate — the disclosure
           problem is telling the BROWSER, not knowing it server-side. */
        existing: Array.isArray(data?.user?.identities) && data.user.identities.length === 0,
      }
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
    if (error) {
      /* SAFE HERE, unlike in describeAuthError: reaching this branch with
         `email_not_confirmed` means the password was correct, so the caller
         has already demonstrated they own the account and the message tells
         them nothing they could not learn by reading their own inbox. The
         generic string stays for everything else. */
      const raw = String(error?.message || '').toLowerCase()
      if (raw.includes('email not confirmed') || error?.code === 'email_not_confirmed') {
        return {
          status: AUTH.REJECTED,
          message: 'Almost there — confirm your email address first. Check your inbox for the link.',
          field: 'email',
        }
      }
      return { status: AUTH.REJECTED, message: describeAuthError(error) }
    }
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

/* ── password reset ───────────────────────────────────────────────────────

   Missing entirely until now, which meant a forgotten password was an account
   lost. The checklist asks for "secure, expiring, single-use links" and that
   is exactly what Supabase issues — the important part is what this code does
   NOT do around them.

   requestPasswordReset ALWAYS REPORTS SUCCESS. Reporting "no account with that
   email" would be the same enumeration oracle the signup form used to be, and
   password reset is the form an attacker reaches for first because it usually
   accepts an address with no other input at all. The person who owns the
   address finds out from the inbox. Nobody else learns whether it exists.

   The redirect target is built from the CURRENT ORIGIN rather than from
   anything the caller passes in. A reset link is the single most valuable
   thing to point somewhere else — it arrives in email, it looks official, and
   following it hands over an account. There is no parameter here to poison. */
export async function requestPasswordReset(emailInput, client) {
  const c = client === undefined ? await getSupabase() : client
  const e = validateEmail(emailInput)
  if (!e.ok) return { status: AUTH.INVALID, message: e.message, field: 'email' }

  /* Same shape whether or not Supabase is configured, for the same reason: the
     answer must not depend on anything about the address. */
  const uniform = {
    status: AUTH.OK,
    message: `If ${e.email} has an account, a reset link is on its way. The link works once and expires in an hour.`,
  }
  if (!c) return uniform

  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    await c.auth.resetPasswordForEmail(e.email, { redirectTo: `${origin}/reset` })
  } catch {
    /* Swallowed on purpose. A network failure here would otherwise be
       distinguishable from a nonexistent account by timing or by message, and
       the difference is the leak. The user retries; the log records it. */
  }
  return uniform
}

/**
 * Set a new password. Called from /reset, where the link has already
 * established a session, and from account settings for a signed-in user.
 */
export async function updatePassword(next, client) {
  const c = client === undefined ? await getSupabase() : client
  const p = validatePassword(next, { signup: true })
  if (!p.ok) return { status: AUTH.INVALID, message: p.message, field: 'password' }
  if (!c) return { status: AUTH.UNCONFIGURED, message: unconfiguredMessage() }

  try {
    const { error } = await c.auth.updateUser({ password: p.password })
    if (error) return { status: AUTH.REJECTED, message: describeAuthError(error) }
    return { status: AUTH.OK, message: 'Password changed.' }
  } catch (err) {
    return { status: offline(err) ? AUTH.OFFLINE : AUTH.REJECTED, message: describeAuthError(err) }
  }
}

/* ── multi-factor ─────────────────────────────────────────────────────────

   TOTP, because it is the factor that costs nothing to run and cannot be SIM
   swapped. SMS is deliberately not offered: it is the weakest common second
   factor, it costs per message, and offering it invites the support burden of
   people who changed numbers.

   THE ENROLMENT DANCE, and why it is three calls rather than one: enroll()
   creates an unverified factor and returns a QR code; the user types a code
   from their authenticator; challenge()+verify() proves they can actually
   produce codes BEFORE the factor starts guarding anything. Skipping that
   proof is how people lock themselves out of their own accounts within about
   thirty seconds of turning MFA on. */
export async function listFactors(client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: AUTH.UNCONFIGURED, factors: [] }
  try {
    const { data, error } = await c.auth.mfa.listFactors()
    if (error) return { status: AUTH.REJECTED, factors: [], message: describeAuthError(error) }
    return { status: AUTH.OK, factors: (data?.totp || []).filter(f => f.status === 'verified') }
  } catch (err) {
    return { status: AUTH.OFFLINE, factors: [], message: describeAuthError(err) }
  }
}

export async function beginMfaEnrolment(client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: AUTH.UNCONFIGURED, message: unconfiguredMessage() }
  try {
    const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' })
    if (error) return { status: AUTH.REJECTED, message: describeAuthError(error) }
    return {
      status: AUTH.OK,
      factorId: data.id,
      qr: data.totp?.qr_code || null,
      /* The secret in text, for people whose authenticator is on the same
         device as the browser and who therefore cannot photograph the screen.
         An MFA flow that only offers a QR code excludes desktop password
         managers, which is most of the people who will actually turn this on. */
      secret: data.totp?.secret || null,
    }
  } catch (err) {
    return { status: AUTH.OFFLINE, message: describeAuthError(err) }
  }
}

export async function confirmMfaEnrolment(factorId, code, client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: AUTH.UNCONFIGURED, message: unconfiguredMessage() }
  if (!/^\d{6}$/.test(String(code || '').trim())) {
    return { status: AUTH.INVALID, message: 'Enter the six digits from your authenticator app.' }
  }
  try {
    const { data: ch, error: chErr } = await c.auth.mfa.challenge({ factorId })
    if (chErr) return { status: AUTH.REJECTED, message: describeAuthError(chErr) }
    const { error } = await c.auth.mfa.verify({ factorId, challengeId: ch.id, code: String(code).trim() })
    if (error) return { status: AUTH.REJECTED, message: 'That code did not match. Codes expire after 30 seconds — try the next one.' }
    return { status: AUTH.OK, message: 'Two-factor authentication is on.' }
  } catch (err) {
    return { status: AUTH.OFFLINE, message: describeAuthError(err) }
  }
}

/** Turning it off requires a currently valid session, not a code — the session is the proof. */
export async function disableMfa(factorId, client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: AUTH.UNCONFIGURED, message: unconfiguredMessage() }
  try {
    const { error } = await c.auth.mfa.unenroll({ factorId })
    if (error) return { status: AUTH.REJECTED, message: describeAuthError(error) }
    return { status: AUTH.OK, message: 'Two-factor authentication is off.' }
  } catch (err) {
    return { status: AUTH.OFFLINE, message: describeAuthError(err) }
  }
}

/**
 * Satisfy a pending TOTP challenge at sign-in.
 *
 * Supabase signs you in at assurance level 1 and leaves the second factor as a
 * separate step, so a session can exist while still being insufficient. RLS
 * policies could require aal2; today none do, which is a deliberate choice —
 * requiring it would lock out every existing account the moment MFA shipped.
 */
export async function completeMfa(code, client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: AUTH.UNCONFIGURED, message: unconfiguredMessage() }
  try {
    const { data, error: listErr } = await c.auth.mfa.listFactors()
    if (listErr) return { status: AUTH.REJECTED, message: describeAuthError(listErr) }
    const factor = (data?.totp || []).find(f => f.status === 'verified')
    if (!factor) return { status: AUTH.OK }
    const { data: ch, error: chErr } = await c.auth.mfa.challenge({ factorId: factor.id })
    if (chErr) return { status: AUTH.REJECTED, message: describeAuthError(chErr) }
    const { error } = await c.auth.mfa.verify({ factorId: factor.id, challengeId: ch.id, code: String(code || '').trim() })
    if (error) return { status: AUTH.REJECTED, message: 'That code did not match. Codes expire after 30 seconds — try the next one.' }
    return { status: AUTH.OK }
  } catch (err) {
    return { status: AUTH.OFFLINE, message: describeAuthError(err) }
  }
}

/** Does this session still owe a second factor? */
export async function mfaPending(client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return false
  try {
    const { data } = await c.auth.mfa.getAuthenticatorAssuranceLevel()
    return Boolean(data && data.nextLevel === 'aal2' && data.nextLevel !== data.currentLevel)
  } catch { return false }
}

/**
 * Sign out everywhere, not just here.
 *
 * `scope: 'global'` revokes every refresh token for the account, which is what
 * "I think someone else is in my account" needs and what a per-tab sign-out
 * cannot provide. Offered alongside the ordinary sign-out rather than instead
 * of it, because signing out of a shared computer should not also sign you out
 * of your phone.
 */
export async function signOutEverywhere(client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: AUTH.OK }
  try {
    const { error } = await c.auth.signOut({ scope: 'global' })
    if (error) return { status: AUTH.REJECTED, message: describeAuthError(error) }
    return { status: AUTH.OK, message: 'Signed out on every device.' }
  } catch (err) {
    /* Same reasoning as signOut: the local token is already cleared, and a
       flaky connection must not trap someone in an account they are trying to
       leave. The difference is that here the OTHER sessions may survive, so
       the message says so rather than claiming success. */
    return { status: AUTH.OK, message: 'Signed out here. Other devices may still be signed in — try again when you have a connection.' }
  }
}
