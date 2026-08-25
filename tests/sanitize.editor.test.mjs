/*
  tests/sanitize.editor.test.mjs
  --------------------------------------------------------------------------
  sanitizeEditorHtml — the profile that runs on text-block content going into
  the DOM and on anything arriving from the clipboard.

  This suite has to prove TWO things, and the second is the one that nearly
  went wrong. Obviously it must block execution. Less obviously it must not
  destroy the app's own content: the first version of this fix reused the
  EXPORT profile, which drops `input`, all `data-*` except data-ds-link, and
  every inline style — i.e. it would have deleted the checkbox from every
  checklist in every note, silently, on load.

  So the "preserves" half below is not padding. It is the half that decides
  whether this change is safe to ship.
  -------------------------------------------------------------------------- */

import { sanitizeHtml, sanitizeEditorHtml } from '../lib/sanitize.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const has = (h, s, m) => ok(h.includes(s), `${m}\n         in: ${h}`)
const hasnt = (h, s, m) => ok(!h.includes(s), `${m}\n         in: ${h}`)

/* Exactly what TextBlockContent writes for a checklist item. */
const CHECKLIST =
  '<div data-type="checklist">' +
  '<input type="checkbox" style="margin-top:5px;cursor:pointer;accent-color:#5B5FE8;width:15px;height:15px;flex-shrink:0;" contenteditable="false">' +
  '<span style="flex:1;min-height:1em;outline:none;">buy milk</span></div>'

console.log('\n  it preserves the app\'s own content')
{
  const out = sanitizeEditorHtml(CHECKLIST)
  has(out, '<input', 'the checkbox survives')
  has(out, 'type="checkbox"', 'and is still a checkbox')
  has(out, 'data-type="checklist"', 'the wrapper attribute the layout hangs off survives')
  has(out, 'buy milk', 'the text survives')
  has(out, 'accent-color', 'inline styling survives')
  ok(out.includes('flex-shrink') || out.includes('flex'), 'flex layout survives')

  /* And the proof that this profile was necessary at all. */
  const exported = sanitizeHtml(CHECKLIST)
  hasnt(exported, '<input', 'the EXPORT profile deletes the checkbox — which is why it must not run on stored content')
  hasnt(exported, 'data-type', 'and drops the checklist attribute')
}

console.log('\n  coloured and formatted text survives')
{
  const out = sanitizeEditorHtml('<span style="color:#CD4037">red</span> and <strong>bold</strong>')
  has(out, 'color:#CD4037', 'a colour swatch survives')
  has(out, '<strong>', 'bold survives')
  const h = sanitizeEditorHtml('<h2 style="text-align:center">Title</h2><ul><li>one</li></ul>')
  has(h, '<h2', 'headings survive')
  has(h, 'text-align:center', 'alignment survives')
  has(h, '<li>one</li>', 'lists survive')
  has(sanitizeEditorHtml('<span data-ds-link="nb1/sh1/b2">Go</span>'), 'data-ds-link',
    'teleport links survive')
}

console.log('\n  it still blocks execution')
{
  const cases = [
    ['<script>alert(1)</script>hi', 'alert', 'script contents are dropped whole'],
    ['<img src=x onerror=alert(1)>', 'onerror', 'the classic img handler'],
    ['<div onclick="alert(1)">x</div>', 'onclick', 'a handler on an allowed element'],
    ['<div OnClick="alert(1)">x</div>', 'nClick', 'a mixed-case handler'],
    ['<svg onload=alert(1)></svg>', 'onload', 'svg is dropped with its contents'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript', 'a javascript: href'],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', 'aVaScR', 'a mixed-case javascript: href'],
    ['<img src="javascript:alert(1)">', 'javascript', 'a javascript: src'],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', 'data:text/html', 'a data: html href'],
    ['<style>body{background:url(javascript:alert(1))}</style>', 'javascript', 'style blocks are dropped'],
    ['<iframe src="evil"></iframe>', '<iframe', 'iframes are dropped'],
    ['<object data="evil"></object>', '<object', 'objects are dropped'],
    ['<form action="/x"><input type="text" name="p"></form>', '<form', 'forms are dropped'],
  ]
  for (const [input, forbidden, msg] of cases) {
    hasnt(sanitizeEditorHtml(input), forbidden, msg)
  }
  // A text input is not a checkbox.
  hasnt(sanitizeEditorHtml('<input type="text" value="x">'), 'type="text"',
    'only checkboxes are allowed through — a text input in a note is a credential-harvesting shape')
}

console.log('\n  the style filter')
{
  const bad = [
    ['<span style="background:url(javascript:alert(1))">x</span>', 'url(', 'url() in a value'],
    ['<span style="width:expression(alert(1))">x</span>', 'expression', 'IE expression()'],
    ['<span style="behavior:url(#x)">x</span>', 'behavior', 'behavior:'],
    ['<span style="color:red;-moz-binding:url(evil)">x</span>', 'binding', 'XBL binding'],
    ['<span style="background-image:url(//evil/track.png)">x</span>', 'url(', 'a tracking pixel via CSS'],
    ['<span style="position:fixed;top:0;left:0;width:100vw;height:100vh">x</span>', 'vw', 'a full-viewport overlay value'],
  ]
  for (const [input, forbidden, msg] of bad) hasnt(sanitizeEditorHtml(input), forbidden, msg)

  // Declarations outside the allowlist are dropped, the rest kept.
  const mixed = sanitizeEditorHtml('<span style="color:red;-moz-binding:url(x);font-weight:600">x</span>')
  has(mixed, 'color:red', 'an allowed declaration survives alongside a dropped one')
  has(mixed, 'font-weight:600', 'and so does the one after it — the filter is per-declaration')
  hasnt(mixed, 'binding', 'the dangerous one in the middle is gone')

  // A bare <input> with no type renders as a TEXT FIELD.
  hasnt(sanitizeEditorHtml('<input>'), '<input',
    'an input with no type is dropped entirely — the default is a text field, not nothing')
  hasnt(sanitizeEditorHtml('<input type="password">'), '<input',
    'a password field in a note is dropped')
  ok(sanitizeEditorHtml('<input type="checkbox">').includes('<input'),
    'but the checkbox the app actually uses still comes through')

  // Viewport units size to the SCREEN, which is how an overlay is built.
  hasnt(sanitizeEditorHtml('<span style="height:50vh">x</span>'), 'vh', 'vh is refused')
  hasnt(sanitizeEditorHtml('<span style="width:100dvw">x</span>'), 'dvw', 'dvw is refused')
  ok(sanitizeEditorHtml('<span style="width:100px">x</span>').includes('100px'),
    'ordinary px sizing still works')

  // An absurdly long value is a payload, not a style.
  hasnt(sanitizeEditorHtml(`<span style="color:${'a'.repeat(300)}">x</span>`), 'aaaa',
    'an over-long declaration value is dropped')
}

console.log('\n  idempotence')
{
  /* Content is sanitised on load AND on save, so running it twice must not
     change anything the first pass produced. A non-idempotent sanitiser
     double-escapes, which is the bug that used to corrupt every export
     containing an ampersand. */
  const samples = [CHECKLIST, '<span style="color:#CD4037">red &amp; blue</span>',
    '<p>a &lt; b</p>', '<a href="https://x.test">link</a>', '<pre><code>a &amp;&amp; b</code></pre>']
  for (const s of samples) {
    const once = sanitizeEditorHtml(s)
    const twice = sanitizeEditorHtml(once)
    ok(once === twice, `stable across two passes: ${s.slice(0, 42)}…`)
  }
}

console.log('\n  links')
{
  const out = sanitizeEditorHtml('<a href="https://example.test/x">e</a>')
  has(out, 'rel="noopener', 'an external link still gets rel=noopener')
  has(out, 'target="_blank"', 'and opens in a new tab')
  has(out, 'https://example.test/x', 'with its href intact')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
