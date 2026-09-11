/*
  tests/urls.next.test.mjs
  --------------------------------------------------------------------------
  The open-redirect guard (safeNextPath in lib/urls.js).

  middleware.js appends `?next=/app/…` when it bounces a signed-out request, so
  that signing in lands you where you were going. That value is
  attacker-controllable — it travels in a URL somebody can be emailed — and
  handing it to location.href unchecked is the textbook open redirect: a link
  that genuinely starts on your domain, shows your real login form, and then
  forwards to a copy of it somewhere else. The user does everything right.

  Every case below is a real technique, not a hypothetical.
  -------------------------------------------------------------------------- */

import { safeNextPath } from '../lib/urls.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(a === b, `${m}  (got ${JSON.stringify(a)})`)

console.log('\n  what it lets through')
{
  eq(safeNextPath('/app'), '/app', 'a plain path')
  eq(safeNextPath('/app/notebook/nb_1?sheet=2'), '/app/notebook/nb_1?sheet=2', 'with a query string')
  eq(safeNextPath('/app#block'), '/app#block', 'and a fragment')
}

console.log('\n  what it refuses')
{
  eq(safeNextPath('https://evil.example'), '/app', 'an absolute URL')
  eq(safeNextPath('http://evil.example'), '/app', 'including plain http')
  /* THE ONE THAT CATCHES PEOPLE OUT. No scheme, passes a naive
     startsWith('/') check, and browsers read it as protocol-relative — i.e. a
     different site entirely. */
  eq(safeNextPath('//evil.example'), '/app', 'a protocol-relative URL')
  eq(safeNextPath('///evil.example'), '/app', 'and its three-slash variant')
  eq(safeNextPath('javascript:alert(1)'), '/app', 'a javascript: URL')
  eq(safeNextPath('/javascript:alert(1)'), '/app', 'and one disguised behind a leading slash')
  eq(safeNextPath('data:text/html,<script>x</script>'), '/app', 'a data: URL')
  eq(safeNextPath('app'), '/app', 'a relative path with no leading slash')
  eq(safeNextPath(''), '/app', 'an empty value')
  eq(safeNextPath(null), '/app', 'and no value at all')
}

console.log('\n  the parser-confusion cases')
{
  /* Backslash is a slash to some URL parsers, so /\evil.example can be read
     as //evil.example — the protocol-relative case wearing a hat. */
  eq(safeNextPath('/' + String.fromCharCode(92) + 'evil.example'), '/app', 'a backslash instead of the second slash')
  eq(safeNextPath(String.fromCharCode(92) + String.fromCharCode(92) + 'evil.example'), '/app', 'two backslashes')

  /* Browsers STRIP control characters before parsing, so a check that runs
     against the raw string is checking something the browser will never see.
     lib/urls.js strips first for the same reason. */
  eq(safeNextPath('/' + String.fromCharCode(9) + '/evil.example'), '/app', 'a tab hiding a protocol-relative URL')
  eq(safeNextPath('/' + String.fromCharCode(10) + '/evil.example'), '/app', 'a newline doing the same')
  eq(safeNextPath('j' + String.fromCharCode(0) + 'avascript:alert(1)'), '/app', 'a NUL inside a scheme')
}

console.log('\n  the fallback is caller-supplied')
{
  eq(safeNextPath('https://evil.example', '/login'), '/login', 'so a refusal can land somewhere sensible')
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
