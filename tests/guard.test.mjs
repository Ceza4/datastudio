/*
  tests/guard.test.mjs
  --------------------------------------------------------------------------
  app/api/_guard.js — the check that stops another site POSTing to
  /api/account/delete and /api/account/export.

  Both routes authenticated on "a valid session cookie was attached", and a
  browser attaches that cookie to a cross-site form POST. The only thing in the
  way was SameSite=Lax, which is SITE-scoped: any sibling subdomain counts as
  same-site. `request.json()` ignores Content-Type, so a plain form with
  enctype="text/plain" produces a parseable body, and the only secret needed is
  the victim's own email address.

  The cases below are the actual shapes a browser sends, not invented ones.
  -------------------------------------------------------------------------- */

import { crossSiteReason, isSameOrigin } from '../lib/samesite.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }

const req = headers => ({
  headers: {
    get: name => headers[name.toLowerCase()] ?? null,
  },
})

const allowed = r => isSameOrigin(r)

console.log('\n  what the application itself sends')
{
  ok(allowed(req({
    'sec-fetch-site': 'same-origin',
    origin: 'https://app.example',
    host: 'app.example',
    'content-type': 'application/json',
  })), 'a first-party fetch() is allowed')

  ok(allowed(req({
    'sec-fetch-site': 'same-origin',
    host: 'app.example',
    'content-type': 'application/json',
  })), 'and one without an Origin header, which same-origin fetches may omit')

  ok(allowed(req({
    'sec-fetch-site': 'same-origin',
    origin: 'http://localhost:3000',
    host: 'localhost:3000',
    'content-type': 'application/json',
  })), 'localhost, port included in the host comparison')
}

console.log('\n  what an attacker sends')
{
  ok(!allowed(req({
    'sec-fetch-site': 'cross-site',
    origin: 'https://evil.example',
    host: 'app.example',
    'content-type': 'text/plain;charset=UTF-8',
  })), 'THE FORM POST: a cross-site HTML form with enctype="text/plain" is refused')

  ok(!allowed(req({
    'sec-fetch-site': 'same-site',
    origin: 'https://docs.app.example',
    host: 'app.example',
    'content-type': 'application/json',
  })), 'SO IS A SIBLING SUBDOMAIN — this is the case SameSite=Lax lets through, and the reason the guard checks Sec-Fetch-Site rather than trusting the cookie attribute')

  ok(!allowed(req({
    origin: 'https://evil.example',
    host: 'app.example',
    'content-type': 'application/json',
  })), 'a mismatched Origin is refused even with no Sec-Fetch headers at all')

  ok(!allowed(req({
    host: 'app.example',
    'content-type': 'application/json',
  })), 'and so is a request carrying NEITHER — those are exactly the two headers a cross-site form omits, and no first-party call omits both')

  ok(!allowed(req({
    'sec-fetch-site': 'same-origin',
    host: 'app.example',
    'content-type': 'application/x-www-form-urlencoded',
  })), 'a form content-type is refused even same-origin: it is the one a form can set without a preflight')

  ok(!allowed(req({
    'sec-fetch-site': 'same-origin',
    origin: 'not a url',
    host: 'app.example',
    'content-type': 'application/json',
  })), 'an unparseable Origin fails closed rather than being ignored')
}

console.log('\n  the refusal names its reason, for the log only')
{
  ok(crossSiteReason(req({ 'sec-fetch-site': 'cross-site', host: 'a' })) === 'sec-fetch-site',
     'each check is distinguishable in the server log')
  ok(crossSiteReason(req({ origin: 'https://evil.example', host: 'a' })) === 'origin-mismatch',
     'so a refusal can be diagnosed without guessing')
  ok(crossSiteReason(req({ host: 'a' })) === 'no-provenance',
     'including the no-headers-at-all case')
  /* The reason must never reach the caller — app/api/_guard.js returns a fixed
     sentence and logs this. Telling an attacker which check they failed is a
     free tutorial in passing it. */
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
