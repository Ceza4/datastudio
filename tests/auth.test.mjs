/*
  tests/auth.test.mjs
  --------------------------------------------------------------------------
  Sign up, sign in, sign out.

  A FAKE CLIENT, NOT A LIVE PROJECT. Every function here takes its client as
  a parameter for exactly this reason: neither agent environment can reach
  supabase.co (the cloud sandbox has no egress, device_bash has no network at
  all), so a test that needed one could not run and would quietly be skipped
  forever. Injecting the client tests the branching, which is where the bugs
  are; the network round trip is Supabase's problem.

  THE ASSERTION THAT MATTERS MOST is that an UNCONFIGURED project is a normal
  outcome and never an exception. DataStudio's whole position is that it works
  with no account, no network and no backend — so a missing env var has to
  land in the same branch as "signed out", not in an error dialog. Every
  function is checked against a null client for that reason.

  Second most important: signUp with email confirmation ON returns a user and
  NO session. Treating that as success sends someone to a signed-in screen
  they are not signed in to; treating it as failure hides that the account was
  created. It is its own status.
  -------------------------------------------------------------------------- */

import {
  AUTH, MIN_PASSWORD, validateEmail, validatePassword, describeAuthError,
  signUp, signIn, signOut, getSession, onAuthChange, unconfiguredMessage,
} from '../lib/auth.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
const eq = (a, b, m) => ok(a === b, `${m}  (got ${JSON.stringify(a)})`)

/** A Supabase client just real enough to branch on. */
const fakeClient = (behaviour = {}) => ({
  auth: {
    signUp: async () => behaviour.signUp ?? { data: { session: { t: 1 }, user: { id: 'u' } }, error: null },
    signInWithPassword: async () => behaviour.signIn ?? { data: { session: { t: 1 }, user: { id: 'u' } }, error: null },
    signOut: async () => behaviour.signOut ?? { error: null },
    getSession: async () => behaviour.getSession ?? { data: { session: { user: { id: 'u' } } }, error: null },
    onAuthStateChange: (cb) => {
      behaviour.captured = cb
      return { data: { subscription: { unsubscribe: () => { behaviour.unsubscribed = true } } } }
    },
  },
})
const throwingClient = message => ({
  auth: {
    signUp: async () => { throw new Error(message) },
    signInWithPassword: async () => { throw new Error(message) },
    signOut: async () => { throw new Error(message) },
    getSession: async () => { throw new Error(message) },
    onAuthStateChange: () => { throw new Error(message) },
  },
})

console.log('\n validateEmail')
{
  ok(validateEmail('a@b.co').ok, 'an ordinary address')
  ok(validateEmail('  A@B.CO  ').email === 'a@b.co', 'trimmed and lowercased, so case cannot fork an account')
  ok(!validateEmail('nope').ok, 'no at-sign')
  ok(!validateEmail('a@b').ok, 'no dot in the domain')
  ok(!validateEmail('a b@c.co').ok, 'a space')
  ok(!validateEmail('').ok && !validateEmail(null).ok, 'empty and null')
  ok(validateEmail('a+tag@b.co').ok, 'plus addressing — strict regexes love rejecting deliverable mail')
}

console.log('\n validatePassword')
{
  ok(validatePassword('x'.repeat(MIN_PASSWORD), { signup: true }).ok, 'long enough to sign up with')
  ok(!validatePassword('short', { signup: true }).ok, 'too short to sign up with')
  ok(validatePassword('short').ok,
     'but long enough to SIGN IN with — an account made under the old rule must not be locked out by a policy change')
  ok(!validatePassword('').ok, 'empty is refused either way')
}

console.log('\n describeAuthError')
{
  ok(describeAuthError({ message: 'Invalid login credentials' }).includes('do not match'),
     'the most common error is rewritten into something actionable')
  /* THE ASSERTION IS NOW THE OPPOSITE OF WHAT IT WAS, and that is the point.
     It used to require the message to say "try signing in instead" — helpful,
     and an account-enumeration oracle: it turns the signup form into a free
     API for asking "does this person use DataStudio?", which for a tool
     holding unpublished research is itself worth protecting. The message is
     now identical to the ordinary success case. */
  ok(!/already|signing in|exists/i.test(describeAuthError({ message: 'User already registered' })),
     'an existing address is NOT disclosed — the message must not differ from a fresh signup')
  ok(describeAuthError({ message: 'User already registered' }).includes('inbox'),
     'it says the same thing a real signup says: check your inbox')
  /* THIS ASSERTION USED TO BE ITS OPPOSITE, and the flip is the fix.

     It required the unconfirmed-email case to say "check your inbox" — helpful
     wording, and an account-enumeration oracle: Supabase returns that error
     ONLY when the credentials are otherwise valid, so a distinct message is a
     positive identification of a registered address. Every other door in this
     file was carefully closed and this one was propped open with good
     intentions.

     The guidance did not disappear; it moved to signIn(), which can say it
     safely because by then the password has already proved the caller owns the
     account. See the next block. */
  eq(describeAuthError({ message: 'Email not confirmed' }),
     describeAuthError({ message: 'Invalid login credentials' }),
     'an unconfirmed address is INDISTINGUISHABLE from a wrong password — the message must be byte-identical')
  ok(describeAuthError({ message: 'Failed to fetch' }).includes('saved on this device'),
     'a network failure reassures rather than alarms — nothing was lost')
  /* ALSO FLIPPED. Passing the raw message through was meant to stop unmapped
     errors from being quietly swallowed — right instinct, wrong channel.
     GoTrue's unmapped prose includes "For security purposes, you can only
     request this after 47 seconds", which renders the state of a per-address
     rate limiter onto the screen: the same oracle again, arriving through the
     branch built to catch the ones we forgot. It now goes to console.warn,
     where the person who can fix it is looking. */
  ok(describeAuthError({ message: 'For security purposes, you can only request this after 47 seconds' })
       === 'Something went wrong. Try again.',
     'an unmapped error does NOT reach the screen — GoTrue prose leaks rate-limiter state per address')
  ok(describeAuthError(null).length > 0, 'null does not produce an empty message')
}

console.log('\n unconfigured is a normal state, never an error')
{
  const r1 = await signUp('a@b.co', 'longenough', null)
  const r2 = await signIn('a@b.co', 'longenough', null)
  const r3 = await signOut(null)
  const r4 = await getSession(null)
  ok(r1.status === AUTH.UNCONFIGURED && r2.status === AUTH.UNCONFIGURED, 'sign up and sign in report it plainly')
  ok(r3.status === AUTH.OK, 'signing OUT with no backend succeeds — you are already as signed out as it is possible to be')
  ok(r4.status === AUTH.UNCONFIGURED && r4.session === null, 'and there is no session to find')
  ok(unconfiguredMessage().includes('saved on this device'),
     'and the message says the app still works, because it does')
  ok(typeof onAuthChange(() => {}, null) === 'function', 'subscribing returns a callable unsubscribe rather than undefined')
}

console.log('\n validation happens BEFORE the network')
{
  let called = false
  const spy = { auth: { signUp: async () => { called = true; return { data: {}, error: null } } } }
  const r = await signUp('not-an-email', 'longenough', spy)
  ok(r.status === AUTH.INVALID && r.field === 'email', 'a bad email is caught locally')
  ok(!called, 'and never reaches Supabase — fast feedback, and one less request against the rate limit')
  const r2 = await signUp('a@b.co', 'x', spy)
  ok(r2.status === AUTH.INVALID && r2.field === 'password', 'so is a short password')
  ok(r2.field === 'password', 'and the result says WHICH field, so the form can point at it')
}

console.log('\n sign up')
{
  const good = await signUp('a@b.co', 'longenough', fakeClient())
  ok(good.status === AUTH.OK && good.session, 'a project with confirmation off returns a session')

  /* Confirmation ON: a user, no session. */
  const pending = await signUp('a@b.co', 'longenough', fakeClient({ signUp: { data: { user: { id: 'u' }, session: null }, error: null } }))
  ok(pending.status === AUTH.CONFIRM_EMAIL,
     'confirmation ON is its OWN status — calling it success shows a signed-in screen nobody is signed in to')
  ok(pending.message.includes('a@b.co'), 'and the message names the address to go and check')

  const dup = await signUp('a@b.co', 'longenough', fakeClient({ signUp: { data: null, error: { message: 'User already registered' } } }))
  ok(dup.message.includes('inbox') && !/already|exists/i.test(dup.message),
     'a duplicate signup is indistinguishable from a new one, by message')

  /* Supabase's own anti-enumeration shape, with email confirmation ON: an
     existing address comes back as a user with an EMPTY identities array and
     no error. Reporting anything other than an ordinary CONFIRM_EMAIL here
     would undo that at the last step, in our own code. */
  const existing = await signUp('a@b.co', 'longenough', fakeClient({
    signUp: { data: { user: { id: 'u1', identities: [] }, session: null }, error: null },
  }))
  ok(existing.status === AUTH.CONFIRM_EMAIL,
     'an address that already exists reports CONFIRM_EMAIL, exactly like a new one')
  ok(existing.existing === true,
     'the fact is still available server-side for logs — the leak is telling the BROWSER, not knowing it')
  ok(pending.status === existing.status && pending.message.replace(/a@b\.co/, '') === existing.message.replace(/a@b\.co/, ''),
     'and the two outcomes are byte-identical apart from the address itself')

  const down = await signUp('a@b.co', 'longenough', throwingClient('Failed to fetch'))
  ok(down.status === AUTH.OFFLINE, 'and an unreachable server is OFFLINE, not REJECTED — the difference is whether to retry')
}

console.log('\n sign in and out')
{
  ok((await signIn('a@b.co', 'pw', fakeClient())).status === AUTH.OK, 'a good sign in')
  const bad = await signIn('a@b.co', 'pw', fakeClient({ signIn: { data: null, error: { message: 'Invalid login credentials' } } }))
  ok(bad.status === AUTH.REJECTED && bad.message.includes('do not match'), 'a bad one')

  const stubborn = await signOut(throwingClient('Failed to fetch'))
  ok(stubborn.status === AUTH.OK,
     'signing out succeeds even when the request fails — a flaky connection must not trap someone in an account on a shared machine')
}

console.log('\n session and subscription')
{
  const s = await getSession(fakeClient())
  ok(s.status === AUTH.OK && s.user?.id === 'u', 'the current session')
  ok((await getSession(throwingClient('Failed to fetch'))).status === AUTH.OFFLINE, 'and offline reports itself')

  const b = {}
  const c = fakeClient(b)
  const seen = []
  const stop = onAuthChange(x => seen.push(x), c)
  b.captured('SIGNED_IN', { user: { id: 'z' } })
  ok(seen.length === 1 && seen[0].user.id === 'z', 'the handler receives sign-in')
  b.captured('SIGNED_OUT', null)
  ok(seen[1].user === null && seen[1].session === null,
     'and sign-out arrives as an explicit null rather than as undefined')
  stop()
  ok(b.unsubscribed === true, 'unsubscribing actually unsubscribes — two tabs disagreeing about who is signed in is a real bug')
  ok(typeof onAuthChange(() => {}, throwingClient('x')) === 'function', 'a client that throws on subscribe still returns a callable')
}

console.log('\n the SDK is loaded lazily, and that has consequences')
{
  /* getSupabase() is async because the SDK is a dynamic import — the app
     opens instantly and works with no account, so paying for the auth
     bundle up front is paying for something most sessions never use. The
     price is this distinction, which every function here has to honour. */
  const spy = { calls: 0, auth: { getSession: async () => { spy.calls++; return { data: { session: null } } } } }
  const withClient = await getSession(spy)
  ok(withClient.status === AUTH.OK && spy.calls === 1, 'an explicit client is used as given')
  const explicitNull = await getSession(null)
  ok(explicitNull.status === AUTH.UNCONFIGURED,
     'an explicit null means THERE IS NONE and is never resolved — which is what lets these tests run with no network at all')

  /* The unmount race. onAuthChange keeps a synchronous signature but attaches
     once the SDK lands; unsubscribing before that must stop the attachment,
     or a subscription exists that nobody holds the handle for. That leak
     never throws, which is why it survives. */
  let attached = false
  const slow = { auth: { onAuthStateChange: () => { attached = true; return { data: { subscription: { unsubscribe() {} } } } } } }
  const stop = onAuthChange(() => {}, slow)
  ok(attached === true, 'a client passed directly attaches synchronously')
  stop()
  ok(typeof stop === 'function', 'and the unsubscribe is returned immediately, so an effect can return it')
}

console.log('\n  the confirm-your-email guidance, moved to where it is safe')
{
  /* signIn only reaches this branch when signInWithPassword returns
     email_not_confirmed, and Supabase returns that ONLY for otherwise-valid
     credentials. So the caller has already proved they own the account, and
     naming the reason tells them nothing a glance at their own inbox would
     not. The oracle needs an answer from someone who does NOT have the
     password; this branch is unreachable for them. */
  const unconfirmed = {
    auth: { signInWithPassword: async () => ({ data: null, error: { message: 'Email not confirmed', code: 'email_not_confirmed' } }) },
  }
  const res = await signIn('someone@example.com', 'correct horse battery', unconfirmed)
  eq(res.status, AUTH.REJECTED, 'still a rejection — no session is issued')
  ok(/confirm/i.test(res.message), 'and it says to confirm the address')

  const wrongPassword = {
    auth: { signInWithPassword: async () => ({ data: null, error: { message: 'Invalid login credentials' } }) },
  }
  const res2 = await signIn('someone@example.com', 'correct horse battery', wrongPassword)
  ok(!/confirm|inbox/i.test(res2.message),
     'while a wrong password says nothing about whether the address exists')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
