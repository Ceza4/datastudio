/*
  tests/pdfextract.test.mjs
  --------------------------------------------------------------------------
  Turning a page's text runs into lines and paragraphs.

  This is the most heuristic code in the PDF feature — a PDF has no concept of
  a paragraph, so every bit of structure is inferred from geometry. It's also
  the code that can be tested best, because it takes plain objects and returns
  plain objects.

  So the tests build synthetic pages with KNOWN structure and assert the
  inference recovers it. Given how much of this feature can only be checked in
  a browser, doing this thoroughly is deliberate compensation.

  Coordinates are PDF space throughout: y increases UPWARD, so the next line
  down is a SMALLER y.
  -------------------------------------------------------------------------- */

import {
  groupIntoLines, groupIntoParagraphs,
  extractText, paragraphsToHtml, summarisePage,
} from '../lib/pdfextract.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }

/** A text run shaped like pdf.js's output. */
const run = (str, x, y, { size = 12, w, font = 'Helvetica' } = {}) => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width: w ?? str.length * size * 0.5,
  height: size,
  fontName: font,
})

/* ── lines ───────────────────────────────────────────────────────────── */
console.log('\n groupIntoLines')
{
  const lines = groupIntoLines([
    run('World', 140, 700), run('Hello', 72, 700),      // same baseline, wrong order
    run('Second line', 72, 680),
    run('Third line', 72, 660),
  ])
  ok(lines.length === 3, 'three baselines become three lines')
  ok(lines[0].text === 'Hello World', 'runs on one baseline are ordered left to right, not source order')
  ok(lines[0].baseline === 700, 'top line first — higher y is higher on the page')
  ok(lines[2].text === 'Third line', 'and the lowest y comes last')
}

console.log('\n groupIntoLines — spacing inference')
{
  /* PDFs routinely emit a word as several runs with no spaces, positioned
     absolutely. Both failure modes are wrong: "HelloWorld" and "H e l l o". */
  const tight = groupIntoLines([
    run('Hel', 72, 700, { w: 18 }), run('lo', 90, 700, { w: 12 }),
  ])
  ok(tight[0].text === 'Hello', 'adjacent fragments join with no space')

  const spaced = groupIntoLines([
    run('Hello', 72, 700, { w: 30 }), run('World', 110, 700, { w: 30 }),
  ])
  ok(spaced[0].text === 'Hello World', 'a real gap becomes a space')

  const already = groupIntoLines([
    run('Hello ', 72, 700, { w: 34 }), run('World', 110, 700, { w: 30 }),
  ])
  ok(already[0].text === 'Hello World', 'an existing space is not doubled')
}

console.log('\n groupIntoLines — tolerance scales with size')
{
  // A superscript sits above the baseline but belongs to the same line.
  const withSup = groupIntoLines([
    run('Revenue', 72, 700, { size: 12 }),
    run('1', 130, 704, { size: 7 }),
  ])
  ok(withSup.length === 1, 'a superscript stays on its line rather than becoming its own')

  // A 32pt heading's runs can sit a couple of points apart from kerning.
  const heading = groupIntoLines([
    run('Big', 72, 700, { size: 32 }),
    run('Title', 130, 702, { size: 32 }),
  ])
  ok(heading.length === 1, 'a large heading tolerates a larger baseline wobble')

  // But genuinely separate lines must not merge.
  const separate = groupIntoLines([
    run('Line one', 72, 700, { size: 10 }),
    run('Line two', 72, 688, { size: 10 }),
  ])
  ok(separate.length === 2, 'genuinely separate lines stay separate')
}

/* ── paragraphs ──────────────────────────────────────────────────────── */
console.log('\n groupIntoParagraphs')
{
  const lines = groupIntoLines([
    run('First paragraph line one', 72, 700),
    run('and line two of it', 72, 686),
    run('and line three', 72, 672),
    // a bigger gap — new paragraph
    run('Second paragraph starts', 72, 640),
    run('and continues here', 72, 626),
  ])
  const paras = groupIntoParagraphs(lines)
  ok(paras.length === 2, 'a larger vertical gap starts a new paragraph')
  ok(paras[0].lines.length === 3 && paras[1].lines.length === 2, 'lines land in the right paragraphs')
  ok(paras[0].text === 'First paragraph line one and line two of it and line three',
     'lines join with spaces — a line break inside a paragraph is typesetting, not structure')
}

console.log('\n groupIntoParagraphs — the modal-gap decision')
{
  /* One big section break must not drag the average far enough that every
     later paragraph break is missed. This is why the modal gap is used
     rather than the mean. */
  const lines = groupIntoLines([
    run('Heading', 72, 760, { size: 20 }),
    run('Body line one', 72, 700),
    run('body line two', 72, 686),
    run('New para here', 72, 654),
    run('continuing on', 72, 640),
  ])
  const paras = groupIntoParagraphs(lines)
  ok(paras.length === 3, 'the heading and both paragraphs are separated despite one huge gap')
}

console.log('\n groupIntoParagraphs — indents and hyphens')
{
  const indented = groupIntoParagraphs(groupIntoLines([
    run('First paragraph text', 72, 700),
    run('Indented new para', 90, 686),      // same spacing, but indented
  ]))
  ok(indented.length === 2, 'an indent starts a paragraph even when the spacing does not change')

  const hyphenated = groupIntoParagraphs(groupIntoLines([
    run('This is manage-', 72, 700),
    run('ment speak', 72, 686),
  ]))
  ok(hyphenated[0].text === 'This is management speak',
     'a word hyphenated across a line break is rejoined')
}

/* ── tables ──────────────────────────────────────────────────────────────
   detectTable and extractTable were removed: geometry-based column clustering
   was the "sloppy extraction" people actually experienced, and a plausible-but-
   wrong table is precisely the error a preview does not catch. Their tests went
   with them rather than being left asserting behaviour that no longer exists.
   See the note at the top of lib/pdfextract.js. */


/* ── extractText ─────────────────────────────────────────────────────── */
console.log('\n extractText')
{
  const r = extractText([
    run('Title of the document', 72, 760, { size: 20 }),
    run('First body line', 72, 700),
    run('second body line', 72, 686),
  ])
  ok(r.text.includes('Title of the document'), 'title present')
  ok(r.text.includes('\n\n'), 'paragraphs separated by a blank line')
  ok(r.empty === false, 'not flagged empty')
  ok(r.bbox && r.bbox.h > 0, 'bounding box reported')

  const scan = extractText([])
  ok(scan.empty === true, 'a page with no text runs is flagged empty — that means a scan, and a different fix')
  ok(scan.text === '', 'and yields no text')
}

console.log('\n paragraphsToHtml')
{
  const html = paragraphsToHtml(groupIntoParagraphs(groupIntoLines([
    run('Hello <world> & friends', 72, 700),
  ])))
  ok(html.startsWith('<p>') && html.endsWith('</p>'), 'wrapped in paragraph tags')
  ok(html.includes('&lt;world&gt;'), 'angle brackets escaped — extracted text is untrusted input')
  ok(html.includes('&amp;'), 'ampersand escaped')
  ok(!/<world>/.test(html), 'no raw markup survives into a text block')
  ok(paragraphsToHtml([]) === '', 'empty input')
  ok(paragraphsToHtml(null) === '', 'null input does not throw')
}

/* ── summarisePage ───────────────────────────────────────────────────── */
console.log('\n summarisePage')
{
  const empty = summarisePage([])
  ok(empty.empty === true, 'empty page flagged')
  ok(/scan/i.test(empty.label), 'and the label names the likely cause')

  const prose = summarisePage([run('Some words here on a page', 72, 700)])
  ok(prose.empty === false && prose.words === 6, 'counts words ("Some words here on a page" is six)')

  /* The summary NEVER claims a table any more, on any input. It used to report
     detectTable's guess in the panel header — "a 4×3 table looks extractable" —
     which made an inference sound like a finding before the user had seen a
     single cell. The tabular input below is the exact shape that used to
     trigger it. */
  const tabular = summarisePage([
    run('A', 72, 700, { font: 'Helvetica-Bold' }), run('B', 220, 700, { font: 'Helvetica-Bold' }),
    run('1', 72, 680), run('2', 220, 680),
    run('3', 72, 660), run('4', 220, 660),
    run('5', 72, 640), run('6', 220, 640),
  ])
  ok(tabular.table === undefined, 'no table field is reported at all, even for tabular-looking runs')
  ok(!/table/i.test(tabular.label), 'and the label never promises one')
  ok(/lines/.test(tabular.label) && /words/.test(tabular.label), 'the label reports lines and words instead')
}

/* ── defensive ───────────────────────────────────────────────────────── */

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
