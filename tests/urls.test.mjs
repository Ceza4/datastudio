/*
  tests/urls.test.mjs
  --------------------------------------------------------------------------
  The link allowlist.

  WHY THIS FILE EXISTS
  Two paths used to hand an unchecked string to an href: the link prompt in
  TextBlockToolbar, and the ctrl-click handler in TextBlockContent. A
  `javascript:` href in either one is not a link, it is code running in this
  origin — and because block content is persisted, a bad href survives into
  IndexedDB, into every export, and into whatever template §9 builds from that
  notebook. The check has to happen on the way in, and it has to be an
  allowlist, because the blocklist version of this is never finished.

  THE CASES THAT MATTER MOST are the ones with embedded control characters.
  Browsers strip those BEFORE reading the scheme, so `java<TAB>script:` runs.
  Any validator that doesn't strip them first is comparing a different string
  to the one the browser will act on, which is the whole bug class.
  -------------------------------------------------------------------------- */

import { safeLinkUrl, isSafeLinkUrl, SAFE_SCHEMES } from '../lib/urls.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

/* Built rather than typed, so the file itself stays free of control bytes. */
const ch = n => String.fromCharCode(n)
const TAB = ch(9), NL = ch(10), CR = ch(13), NUL = ch(1), VT = ch(11), FF = ch(12)

console.log('\n safeLinkUrl — accepts')
{
  ok(safeLinkUrl('https://example.com') === 'https://example.com/', 'an https URL')
  ok(safeLinkUrl('http://a.b/c?d=1#e') === 'http://a.b/c?d=1#e', 'http with query and fragment, untouched')
  ok(safeLinkUrl('example.com') === 'https://example.com/', 'a bare host is assumed https rather than refused')
  ok(safeLinkUrl('example.com/path') === 'https://example.com/path', 'a bare host with a path')
  ok(safeLinkUrl('//evil.example') === 'https://evil.example/', 'a scheme-relative URL is resolved, then judged')
  ok(safeLinkUrl('mailto:a@b.com') === 'mailto:a@b.com', 'mailto, because a contact column produces them')
  ok(safeLinkUrl('  https://example.com  ') === 'https://example.com/', 'surrounding whitespace is trimmed')
  ok(safeLinkUrl('localhost:3000') === 'https://localhost:3000/', 'localhost, for anyone linking a dev server')
  ok(SAFE_SCHEMES.length === 3, 'exactly three schemes are allowed — adding one is a decision, not a tweak')
}

console.log('\n safeLinkUrl — refuses')
{
  ok(safeLinkUrl('javascript:alert(1)') === null, 'javascript:')
  ok(safeLinkUrl('JaVaScRiPt:alert(1)') === null, 'and in any case')
  ok(safeLinkUrl('  javascript:alert(1)') === null, 'behind leading whitespace')
  ok(safeLinkUrl('data:text/html,<script>alert(1)</script>') === null, 'data:text/html — the one a blocklist forgets')
  ok(safeLinkUrl('vbscript:msgbox(1)') === null, 'vbscript:')
  ok(safeLinkUrl('file:///etc/passwd') === null, 'file:')
  ok(safeLinkUrl('blob:https://example.com/abc') === null, 'blob:')

  /* The control-character family. Every one of these executes if the validator
     reads the raw string while the browser reads the stripped one. */
  ok(safeLinkUrl('java' + TAB + 'script:alert(1)') === null, 'a tab inside the scheme')
  ok(safeLinkUrl('java' + NL + 'script:alert(1)') === null, 'a newline inside the scheme')
  ok(safeLinkUrl('java' + CR + 'script:alert(1)') === null, 'a carriage return inside the scheme')
  ok(safeLinkUrl('java' + VT + 'script:alert(1)') === null, 'a vertical tab inside the scheme')
  ok(safeLinkUrl('java' + FF + 'script:alert(1)') === null, 'a form feed inside the scheme')
  ok(safeLinkUrl(NUL + 'javascript:alert(1)') === null, 'a leading control byte')
  ok(safeLinkUrl('j' + NUL + 'a' + TAB + 'v' + NL + 'a' + CR + 'script:alert(1)') === null, 'all of them at once')

  /* Not links to anywhere real. */
  ok(safeLinkUrl('/admin') === null, 'a bare path — it would have become a link to the host "admin"')
  ok(safeLinkUrl('?q=1') === null, 'a bare query')
  ok(safeLinkUrl('#anchor') === null, 'a bare fragment')
  ok(safeLinkUrl('notahost') === null, 'a stray word does not silently become a URL')
  ok(safeLinkUrl('') === null && safeLinkUrl('   ') === null, 'empty and whitespace')
  ok(safeLinkUrl(null) === null && safeLinkUrl(undefined) === null, 'null and undefined')
  ok(safeLinkUrl(42) === null && safeLinkUrl({}) === null, 'non-strings, without throwing')
}

console.log('\n isSafeLinkUrl')
{
  ok(isSafeLinkUrl('https://example.com') === true, 'true for a safe URL')
  ok(isSafeLinkUrl('javascript:alert(1)') === false, 'false for an unsafe one')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
export default { pass, fail }
