/*
  tests/pagesetup.test.mjs
  --------------------------------------------------------------------------
  Page geometry, page guides and the word count for the Document block.

  This is the arithmetic three separate surfaces read — the Layout tab, the
  ruler's draggable markers and the dashed guide overlay — so it is exactly the
  code where being quietly wrong shows up as a ruler whose markers do not line
  up with the text they control. Pure, so it gets asserted.

  Run: node tests/pagesetup.test.mjs
  -------------------------------------------------------------------------- */

import {
  PX_PER_IN, PAGE_SIZES, MARGIN_PRESETS,
  pageInches, pageMetrics, contentHeightPx, pageGuides, pageCount,
  marginPresetFor, normalizeMargin, normalizeSize, normalizeOrientation,
  wordCount, charCount, plainTextOf, fontStack, DOC_FONTS, DEFAULT_DOC_FONT,
} from '../lib/pagesetup.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => {
  if (c) { pass++; console.log('  ok   ' + m) }
  else { fail++; console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`) }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol

/* ── units ────────────────────────────────────────────────────────────── */
console.log('\n units')
ok(PX_PER_IN === 96, '96 CSS px to the inch — the spec’s own definition of 1in, not an approximation')

/* ── page size and orientation ────────────────────────────────────────── */
console.log('\n pageInches')
{
  const p = pageInches('a4', 'portrait')
  ok(near(p.w, 8.27) && near(p.h, 11.69), 'A4 portrait is 8.27in × 11.69in')

  const l = pageInches('a4', 'landscape')
  ok(near(l.w, 11.69) && near(l.h, 8.27), 'landscape swaps them rather than being a second table entry')

  ok(pageInches('nonsense').label === PAGE_SIZES.a4.label, 'an unknown size falls back to A4')
  ok(pageInches('a4', 'sideways').w === PAGE_SIZES.a4.w, 'an unknown orientation falls back to portrait')
  ok(normalizeSize('letter') === 'letter' && normalizeSize(null) === 'a4', 'normalizeSize')
  ok(normalizeOrientation('landscape') === 'landscape' && normalizeOrientation(7) === 'portrait', 'normalizeOrientation')
}

/* ── margins ──────────────────────────────────────────────────────────── */
console.log('\n normalizeMargin')
ok(normalizeMargin(1.5) === 1.5, 'a plain value passes through')
ok(normalizeMargin('0.75') === 0.75, 'a typed string is coerced — the dialog’s inputs are strings')
ok(normalizeMargin(1.23456) === 1.23, 'rounded to two decimals, matching the dialog’s precision')
ok(normalizeMargin(-3, 1) === 1, 'a negative margin is refused, not clamped to zero silently on the way in')
ok(normalizeMargin('abc', 0.5) === 0.5, 'nonsense falls back')

console.log('\n pageMetrics — the clamp')
{
  const m = pageMetrics({ pageSize: 'a4', margins: { top: 1, bottom: 1, left: 1, right: 1 } })
  ok(near(m.inches.contentW, 8.27 - 2, 1e-9), 'content width is the page less both side margins')
  ok(near(m.px.contentW, (8.27 - 2) * 96, 1e-6), '…and in px it is that times 96')
  ok(near(m.px.left, 96), 'a 1in left margin is 96px')

  /* THE CASE THAT MATTERS: two margins that together exceed the page. A ruler
     drag can produce this in a way the dialog cannot, and an unclamped result
     is a negative content width — which renders as a page with no text area at
     all rather than as an obviously wrong number. */
  const squeezed = pageMetrics({ pageSize: 'a5', margins: { top: 1, bottom: 1, left: 4, right: 4 } })
  ok(squeezed.inches.contentW >= 0.5, 'impossible side margins still leave a usable content width')
  ok(squeezed.margins.left < 4 && squeezed.margins.right < 4, '…by shrinking BOTH of them')
  ok(near(squeezed.margins.left, squeezed.margins.right, 0.02),
     '…proportionally, so neither is arbitrarily blamed for the overflow')

  const zoomed = pageMetrics({ pageSize: 'a4', margins: { top: 1, bottom: 1, left: 1, right: 1 } }, 2)
  ok(near(zoomed.px.left, 192), 'zoom scales the px values and not the inches')
  ok(near(zoomed.margins.left, 1), '…the inch values are unchanged by zoom')
}

console.log('\n marginPresetFor')
for (const p of MARGIN_PRESETS) {
  ok(marginPresetFor(p.margins) === p.id, `${p.label}’s exact values are recognised as ${p.label}`)
}
ok(marginPresetFor({ top: 1.3, bottom: 1, left: 1, right: 1 }) === 'custom', 'anything else is Custom')
/* DERIVED, NOT STORED — the whole reason this function exists. Typing Normal's
   values into the Custom dialog must read as Normal again rather than staying
   stuck on "Custom" because a flag was set once. */
ok(marginPresetFor({ top: '1', bottom: '1', left: '1', right: '1' }) === 'normal',
   'typed strings equal to a preset resolve back to that preset')

/* ── guides ───────────────────────────────────────────────────────────── */
console.log('\n pageGuides')
{
  const block = { pageSize: 'a4', margins: { top: 1, bottom: 1, left: 1, right: 1 } }
  const step = contentHeightPx(block)
  ok(near(step, (11.69 - 2) * 96, 1e-6), 'one page of content height is the page less both vertical margins')

  ok(pageGuides(block, step * 0.5).length === 0, 'half a page needs no guide at all')

  /* THE ONE THAT IS EASY TO GET WRONG: a line at offset 0 is not a page
     boundary, it is the top of page one, and drawing it there is the single
     most common way this reads as broken. */
  const g = pageGuides(block, step * 3.5)
  ok(g.length === 3, 'three and a half pages of content draws three boundaries')
  ok(g.every(x => x.top > 0), 'no guide is drawn at offset 0')
  ok(g[0].page === 2, 'the first guide is labelled as the start of PAGE 2, not page 1')
  ok(near(g[1].top, step * 2, 1e-6), 'guides land at exact multiples of the step')

  ok(pageGuides(block, step * 5000, 1, { max: 10 }).length === 10,
     'capped — a very long document must not produce thousands of absolute divs for decoration')
  ok(pageGuides(block, 0).length === 0 && pageGuides(block, -5).length === 0, 'no height, no guides')
}

console.log('\n pageCount')
{
  const block = { pageSize: 'a4', margins: { top: 1, bottom: 1, left: 1, right: 1 } }
  const step = contentHeightPx(block)
  ok(pageCount(block, 0) === 1, 'an empty document is one page, never zero')
  ok(pageCount(block, step * 0.2) === 1, 'a partial page is one page')
  ok(pageCount(block, step * 2.01) === 3, 'spilling one pixel onto a third page counts as three')
}

/* ── word count ───────────────────────────────────────────────────────── */
console.log('\n wordCount')
ok(wordCount('') === 0 && wordCount(null) === 0, 'empty and null are zero, not NaN')
ok(wordCount('<p>one two three</p>') === 3, 'counts words inside markup')
/* THE BUG EVERY NAIVE STRIPPER HAS: adjacent block tags with no whitespace
   between them run their words together. */
ok(wordCount('<p>one</p><p>two</p>') === 2, 'adjacent paragraphs are two words, not the one word "onetwo"')
ok(wordCount('<div>a</div><div>b</div><div>c</div>') === 3, '…same for divs')
ok(wordCount('a<br>b') === 2, '…and across a <br>')
ok(wordCount('<ul><li>one</li><li>two</li></ul>') === 2, '…and across list items')
ok(wordCount('<p>hello&nbsp;world</p>') === 2, 'a non-breaking space separates words')
ok(wordCount('<p>  spaced   out  </p>') === 2, 'runs of whitespace collapse')
ok(plainTextOf('<p>a &amp; b</p>') === 'a & b', 'entities are decoded')
ok(charCount('<p>abc</p>') === 3, 'charCount counts text, not markup')

/* ── fonts ────────────────────────────────────────────────────────────── */
console.log('\n fonts')
ok(DEFAULT_DOC_FONT === 'Inter', 'Inter is the default — not a second typographic identity for the app')
ok(DOC_FONTS[0].name === DEFAULT_DOC_FONT, '…and it is first in the list')
ok(DOC_FONTS.every(f => f.stack.includes(',') || f.stack.startsWith('var(')),
   'every font has a real fallback stack, so a missing face cannot drop to the browser default silently')
ok(fontStack('Georgia').includes('serif'), 'a serif font falls back within its family')
ok(fontStack('Not A Font') === DOC_FONTS[0].stack, 'an unknown font falls back to the default')
ok(new Set(DOC_FONTS.map(f => f.name)).size === DOC_FONTS.length, 'no duplicate font names')

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
