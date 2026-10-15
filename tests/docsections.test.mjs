/*
  tests/docsections.test.mjs
  --------------------------------------------------------------------------
  Sections (orientation, page numbering), tab stops and the .docx add-on:
  the pure parts of lib/docsections.js, lib/doctabs.js and lib/docxextras.js.
  Run: node tests/docsections.test.mjs
  -------------------------------------------------------------------------- */
import { toRoman, toAlpha, formatNumber, pageLabels, sectionGeometry, leftMarginOf, sectionBreakHtml } from '../lib/docsections.js'
import { parseStops, formatStops, nextStop } from '../lib/doctabs.js'
import { documentToDocx } from '../lib/docexport.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok  ', name) } else { fail++; console.log('  FAIL', name) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n page numbers')
ok('roman', toRoman(4) === 'iv' && toRoman(1994) === 'mcmxciv')
ok('alpha', toAlpha(1) === 'a' && toAlpha(27) === 'aa')
ok('upper roman', formatNumber(9, 'upper-roman') === 'IX')
{
  const secs = [{ restart: true, start: 1, numfmt: 'lower-roman' }, { restart: true, start: 1, numfmt: 'decimal' }, { restart: false, numfmt: 'decimal' }]
  const pages = [{ sec: 0 }, { sec: 0 }, { sec: 1 }, { sec: 1 }, { sec: 2 }]
  const L = pageLabels(pages, secs)
  ok('front matter i, ii then 1, 2, 3', eq(L.map(l => l.label), ['i', 'ii', '1', '2', '3']))
  ok('{pages} counts the numbering run', L[0].total === 'ii' && L[2].total === '3')
}
ok('first section may start at 5', pageLabels([{ sec: 0 }, { sec: 0 }], [{ restart: true, start: 5, numfmt: 'decimal' }]).map(l => l.label).join() === '5,6')

console.log('\n geometry')
{
  const b = { pageSize: 'a4', margins: { top: 1, bottom: 1, left: 1, right: 1.5 }, gutter: 0.5, mirror: true }
  const g = sectionGeometry(b, 'portrait'), l = sectionGeometry(b, 'landscape')
  ok('landscape swaps the page', Math.round(l.w) === Math.round(g.h))
  ok('gutter adds to the inside margin', g.left === 1.5 * 96)
  ok('mirror: even page has the outside margin on the left', leftMarginOf(g, 1) === g.right && leftMarginOf(g, 0) === g.left)
  ok('content width excludes the gutter', Math.round(g.contentW) === Math.round(8.27 * 96 - 1.5 * 96 - 1.5 * 96))
}
ok('break html carries its settings', /data-orient="landscape"/.test(sectionBreakHtml({ orient: 'landscape', restart: true, start: 3 })) && /data-start="3"/.test(sectionBreakHtml({ restart: true, start: 3 })))

console.log('\n tab stops')
ok('parse sorts and defaults kind', eq(parseStops('3:r, 1.5:x'), [{ at: 1.5, kind: 'l' }, { at: 3, kind: 'r' }]))
ok('format dedupes', formatStops([{ at: 1, kind: 'l' }, { at: 1, kind: 'c' }, { at: 2, kind: 'r' }]) === '1:l,2:r')
ok('past the last stop: every 0.5 in', eq(nextStop(3.1, parseStops('1:l')), { at: 3.5, kind: 'l', dflt: true }))

console.log('\n .docx add-on')
{
  const { blob } = documentToDocx({
    name: 'T',
    content: '<p data-ds-tabs="2:c">A<span data-ds-tab="1" contenteditable="false">\t</span>B<sup data-ds-fn="n1" contenteditable="false">1</sup> <span data-ds-comment="c1">x</span> <del data-ds-by="Ann" data-ds-uid="u" data-ds-at="2026-01-01T00:00:00Z">old</del></p><div data-ds-sectionbreak="1" data-orient="landscape" data-numfmt="lower-roman" data-restart="1" data-start="1" contenteditable="false"></div><p>W</p>',
    footnotes: { n1: 'Note' }, comments: [{ id: 'c1', text: 'Hi', by: 'Bob', at: '2026-01-02T00:00:00Z' }],
    hf: { footer: { c: 'Page {page} of {pages}' } }, mirror: true, gutter: 0.25,
  })
  const buf = Buffer.from(await blob.arrayBuffer())
  const files = {}; let o = 0
  while (buf.readUInt32LE(o) === 0x04034b50) { const n = buf.readUInt16LE(o + 26), sz = buf.readUInt32LE(o + 18); files[buf.slice(o + 30, o + 30 + n).toString()] = buf.slice(o + 30 + n, o + 30 + n + sz).toString(); o += 30 + n + sz }
  const d = files['word/document.xml'] || ''
  ok('tab run and tab stop', d.includes('<w:tab/>') && d.includes('<w:tab w:val="center" w:pos="2880"/>'))
  ok('footnote reference + part', d.includes('w:footnoteReference w:id="1"') && /Note/.test(files['word/footnotes.xml'] || ''))
  ok('comment range + part', d.includes('commentRangeStart') && d.includes('commentReference') && /Bob/.test(files['word/comments.xml'] || ''))
  ok('tracked deletion as w:del/delText', /<w:del [^>]*w:author="Ann"/.test(d) && d.includes('<w:delText'))
  ok('two sections, second landscape roman', (d.match(/<w:sectPr>/g) || []).length === 2 && /w:orient="landscape"[^]*lowerRoman/.test(d))
  ok('footer with PAGE and NUMPAGES fields', Object.keys(files).some(k => /footer\d\.xml/.test(k) && files[k].includes(' PAGE ') && files[k].includes(' NUMPAGES ')))
  ok('mirror margins in settings, gutter in pgMar', (files['word/settings.xml'] || '').includes('mirrorMargins') && d.includes('w:gutter="360"'))
  ok('every part is in the content types', ['word/footnotes.xml', 'word/comments.xml', 'word/settings.xml'].every(p => files['[Content_Types].xml'].includes('/' + p)))
}

console.log(`\n ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
