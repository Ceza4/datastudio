/*
  tests/docexport.test.mjs
  --------------------------------------------------------------------------
  The Document block's .docx and .pdf export.

  Both of these produce a file somebody else opens, which is the one place a
  quiet bug is discovered by a colleague rather than by the author. So the two
  halves most likely to be wrong get asserted directly: the HTML→paragraph
  parser (marks, nesting, lists, page breaks) and the strings that carry page
  setup into the output.

  The .docx path is checked by parsing the XML out of the ZIP — not by trusting
  that it was written — because an OOXML file that is subtly malformed opens as
  "Word found unreadable content", which tells you nothing about which part.

  Run: node tests/docexport.test.mjs
  -------------------------------------------------------------------------- */

import { parseDocHtml, documentToDocx, documentPrintHtml } from '../lib/docexport.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => {
  if (c) { pass++; console.log('  ok   ' + m) }
  else { fail++; console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`) }
}

const text = p => p.runs.map(r => r.text).join('')

/* ── the parser ───────────────────────────────────────────────────────── */
console.log('\n parseDocHtml — structure')
{
  const p = parseDocHtml('<h1>Title</h1><p>Body text</p><h3>Sub</h3>')
  ok(p.length === 3, 'three paragraphs')
  ok(p[0].kind === 'h' && p[0].level === 1, 'h1 becomes a heading at level 1')
  ok(p[2].kind === 'h' && p[2].level === 3, '…and h3 at level 3')
  ok(p[1].kind === 'p' && text(p[1]) === 'Body text', 'a paragraph keeps its text')
}

console.log('\n parseDocHtml — inline marks')
{
  const p = parseDocHtml('<p>plain <b>bold</b> <i>ital</i> <u>und</u> <s>str</s> x<sup>2</sup>y<sub>1</sub></p>')
  const marked = name => p[0].runs.filter(r => r.marks[name]).map(r => r.text).join('')
  ok(marked('bold') === 'bold', 'bold survives')
  ok(marked('italic') === 'ital', 'italic survives')
  ok(marked('underline') === 'und', 'underline survives')
  ok(marked('strike') === 'str', 'strikethrough survives')
  ok(marked('sup') === '2', 'superscript survives — REAL markup, which is the whole point of not pasting Unicode')
  ok(marked('sub') === '1', 'subscript survives')
  ok(p[0].runs[0].text === 'plain ' && Object.keys(p[0].runs[0].marks).length === 0,
     'unmarked text carries no marks')
}

console.log('\n parseDocHtml — nesting and aliases')
{
  const p = parseDocHtml('<p><strong>a<em>b</em></strong>c</p>')
  const r = p[0].runs
  ok(r[0].marks.bold && !r[0].marks.italic, 'strong is bold')
  ok(r[1].marks.bold && r[1].marks.italic, 'em nested inside it is both')
  ok(!r[2].marks.bold, 'and the text after the close is neither')

  /* The case a naive open/close flag gets wrong: an inner tag of the same name
     closing the outer one early. */
  const q = parseDocHtml('<p><b>a<b>b</b>c</b>d</p>')
  ok(q[0].runs.filter(x => x.marks.bold).map(x => x.text).join('') === 'abc',
     'a repeated tag is counted, so the inner close does not end the outer one')
  ok(q[0].runs.some(x => x.text === 'd' && !x.marks.bold), '…and text after the real close is plain')
}

console.log('\n parseDocHtml — lists')
{
  const p = parseDocHtml('<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>')
  ok(p.length === 3, 'three list items')
  ok(p.every(x => x.kind === 'li'), 'all are list items')
  ok(p[0].ordered === false && p[2].ordered === true, 'bullets and numbers are distinguished')
  ok(p[0].indent === 0, 'a top-level item is at indent 0')

  const nested = parseDocHtml('<ul><li>a</li><ul><li>b</li></ul></ul>')
  ok(nested.some(x => x.indent === 1), 'a nested list produces an item at indent 1 — flat, like Word’s own model')
}

console.log('\n parseDocHtml — page breaks')
{
  const p = parseDocHtml('<p>before</p><div data-ds-pagebreak="1" contenteditable="false"></div><p>after</p>')
  ok(p.length === 3, 'the break is its own entry')
  ok(p[1].kind === 'break', '…of kind "break"')
  ok(text(p[0]) === 'before' && text(p[2]) === 'after', '…and does not swallow the text either side')
}

console.log('\n parseDocHtml — defensive')
ok(parseDocHtml('').length === 0, 'empty input')
ok(parseDocHtml(null).length === 0, 'null input does not throw')
ok(parseDocHtml('<p>   </p><p>real</p>').length === 1, 'whitespace-only paragraphs are dropped')
ok(parseDocHtml('bare text').length === 1, 'text with no tags at all is still a paragraph')
ok(parseDocHtml('<p>a<br>b</p>')[0].runs.some(r => r.text.includes('\n')),
   'a <br> becomes a newline inside the run, for the writer to turn into a real w:br')
ok(parseDocHtml('<p>unclosed').length === 1, 'an unclosed tag does not lose its content')

/* ── .docx ────────────────────────────────────────────────────────────── */
console.log('\n documentToDocx')
{
  const block = {
    name: 'Report', content: '<h1>Head</h1><p>Body <b>bold</b></p><ul><li>item</li></ul>',
    pageSize: 'a4', orientation: 'portrait',
    margins: { top: 1, bottom: 1, left: 1.5, right: 0.75 },
    font: 'Georgia', fontSize: 12,
  }
  const res = documentToDocx(block)
  ok(res.blob && typeof res.blob.size === 'number' && res.blob.size > 0, 'a non-empty blob comes out')
  ok(/^Report-\d{4}-\d{2}-\d{2}\.docx$/.test(res.filename), `filename is dated and safe (${res.filename})`)
  ok(res.warnings.length === 0, 'plain prose exports with no warnings')
}

console.log('\n documentToDocx — the XML inside')
{
  /* Read the parts back out of the archive. lib/zip.js writes entries STORED
     (method 0), which is what makes this readable without an inflater — and is
     also why the assertion is possible at all. */
  const block = {
    name: 'Geometry', content: '<h2>H</h2><p>t</p><div data-ds-pagebreak="1"></div><ul><li>b</li></ul><ol><li>n</li></ol>',
    pageSize: 'letter', orientation: 'landscape',
    margins: { top: 0.5, bottom: 0.5, left: 1, right: 1 },
    font: 'Cambria', fontSize: 11,
  }
  const { blob } = documentToDocx(block)
  const buf = Buffer.from(await blob.arrayBuffer())
  const all = buf.toString('latin1')

  ok(all.indexOf('[Content_Types].xml') < 200,
     '[Content_Types].xml is the FIRST entry — OOXML requires it and Word refuses the file otherwise')
  for (const part of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', '_rels/.rels', 'word/_rels/document.xml.rels']) {
    ok(all.includes(part), `the archive carries ${part}`)
  }

  /* Letter landscape is 11in × 8.5in → 15840 × 12240 twips. Getting this wrong
     is how a document looks right on screen and wrong on paper. */
  ok(all.includes('w:w="15840"') && all.includes('w:h="12240"'),
     'landscape Letter is written as 15840×12240 twips, swapped for orientation')
  ok(all.includes('w:orient="landscape"'), 'and the orientation flag is set as well as the dimensions')
  ok(all.includes('w:top="720"') && all.includes('w:left="1440"'),
     'margins convert to twips (0.5in = 720, 1in = 1440)')

  ok(all.includes('<w:br w:type="page"/>'), 'a deliberate page break becomes a REAL Word page break')
  ok(all.includes('w:numId w:val="1"') && all.includes('w:numId w:val="2"'),
     'bullets and numbers reference different numbering definitions')
  ok(all.includes('w:numFmt w:val="bullet"') && all.includes('w:numFmt w:val="decimal"'),
     '…and both definitions actually exist, so a list renders with a marker')
  ok(all.includes('w:ascii="Cambria"'), 'the chosen font is the document default via docDefaults')
  ok(all.includes('w:val="22"'), '11pt is written as 22 half-points')
  ok(all.includes('<w:pStyle w:val="Heading2"/>'), 'an h2 maps to the Heading2 style')
}

console.log('\n documentToDocx — honest about gaps')
{
  const withTable = documentToDocx({ name: 'T', content: '<table><tr><td>a</td></tr></table>' })
  ok(withTable.warnings.some(w => /table/i.test(w)),
     'a table warns rather than exporting silently as run-together prose — the worst kind of export bug')
  const withImg = documentToDocx({ name: 'I', content: '<p><img src="x.png"></p>' })
  ok(withImg.warnings.some(w => /image/i.test(w)), 'an image warns too')
  const empty = documentToDocx({ name: 'E', content: '' })
  ok(empty.blob.size > 0, 'an empty document still produces a valid file rather than throwing')
}

console.log('\n documentToDocx — escaping')
{
  const { blob } = documentToDocx({ name: 'X', content: '<p>a &amp; b &lt;tag&gt; "q"</p>' })
  const all = Buffer.from(await blob.arrayBuffer()).toString('latin1')
  ok(all.includes('a &amp; b &lt;tag&gt;'),
     'text is XML-escaped in the output — an unescaped & makes the whole part unreadable to Word')
  ok(!/<w:t[^>]*>[^<]*<tag>/.test(all), 'a decoded angle bracket cannot re-enter as markup')
}

/* ── .pdf ─────────────────────────────────────────────────────────────── */
console.log('\n documentPrintHtml')
{
  const html = documentPrintHtml({
    name: 'Printed', content: '<h1>H</h1><p>t</p><div data-ds-pagebreak="1"></div>',
    pageSize: 'a4', orientation: 'portrait',
    margins: { top: 1, bottom: 1.25, left: 0.75, right: 0.75 },
    font: 'Georgia', fontSize: 12, lineSpacing: 2,
  })
  ok(html.startsWith('<!doctype html>'), 'a complete document, not a fragment')
  ok(/@page\s*\{[^}]*size: 8\.27in 11\.69in/.test(html), '@page carries the real page size')
  ok(/margin: 1in 0\.75in 1\.25in 0\.75in/.test(html), '…and the real margins, in CSS order')
  ok(html.includes('font-size: 12pt'), 'the document font size is written in pt, not px')
  ok(html.includes('line-height: 2'), 'line spacing is carried')
  ok(/\[data-ds-pagebreak\][^}]*break-before: page/.test(html),
     'a deliberate break is honoured EXACTLY — unlike the automatic guides, which are estimates')
  ok(html.includes('page-break-before: always'),
     '…with the legacy property too, for print engines that only read that one')
  ok(/orphans: 2/.test(html) && /widows: 2/.test(html), 'orphan and widow control — a printed document, not a printed web page')
  ok(/break-after: avoid-page/.test(html), 'a heading does not get stranded at the foot of a page')

  const landscape = documentPrintHtml({ pageSize: 'a4', orientation: 'landscape', margins: { top: 1, bottom: 1, left: 1, right: 1 } })
  ok(/size: 11\.69in 8\.27in/.test(landscape), 'landscape swaps the @page dimensions')
}

console.log('\n documentPrintHtml — sanitising')
{
  /* The EXPORT profile, not the editor one: this HTML is written into another
     window, and an editor-profile allowance has no business crossing that
     boundary. */
  const html = documentPrintHtml({ name: 'S', content: '<p onclick="steal()">x</p><script>bad()</script><p>ok</p>' })
  ok(!html.includes('<script'), 'a script tag never reaches the print window')
  ok(!/onclick/i.test(html), 'an event handler is stripped')
  ok(html.includes('ok'), 'the legitimate content survives')
  ok(documentPrintHtml({}).includes('<body>'), 'an empty block still produces a valid page')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
