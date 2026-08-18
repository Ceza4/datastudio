/*
  tests/lib.test.mjs
  --------------------------------------------------------------------------
  The pure functions in lib/ — the ones with no DOM, no IndexedDB and no
  network, which is exactly the set that can be tested cheaply and is exactly
  the set where a silent regression is most expensive.

  Covers: zip (the hand-rolled writer that .docx and .pptx depend on),
  exporters (CSV escaping, markdown, HTML stripping), curvefit (does it
  recover known parameters), shortcuts (do any two bindings collide),
  persistence helpers.

  Anything touching IndexedDB or canvas is deliberately absent. Faking those
  well enough to be meaningful costs more than it returns; they're covered by
  the manual test scripts instead.
  -------------------------------------------------------------------------- */

import { createZip, xmlEscape } from '../lib/zip.js'
import { tableToCsv, htmlToText, FORMATS, formatsFor, blocksToMarkdown, blocksToHtml } from '../lib/exporters.js'
import { fit, MODELS, curvePoints } from '../lib/curvefit.js'
import { SHORTCUT_GROUPS, RESERVED_COMBOS } from '../lib/shortcuts.js'
import { formatBytes, debounce, STATE_VERSION } from '../lib/persistence.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }
const near = (a, b, tol = 1e-4) => Math.abs(a - b) < tol

/* ── zip ──────────────────────────────────────────────────────────────
   .docx and .pptx are ZIP archives. If this writer is wrong, Word shows
   "the file is corrupt" and there is no partial-credit failure mode. */
console.log('\n zip')
{
  const z = createZip()
  z.addFile('a.txt', 'hello')
  z.addFile('dir/b.xml', '<x/>')
  const blob = z.toBlob()
  ok(blob && typeof blob.size === 'number' && blob.size > 0, 'produces a non-empty blob')
  ok(blob.type === 'application/zip', 'default mime is application/zip')
  ok(createZip().addFile('x', 'y') !== undefined, 'addFile is chainable')

  const withMime = createZip().addFile('a', 'b').toBlob('application/vnd.x')
  ok(withMime.type === 'application/vnd.x', 'mime is overridable (docx/pptx need their own)')

  // Empty archive must still be a structurally valid zip (EOCD only = 22 bytes).
  ok(createZip().toBlob().size >= 22, 'an empty archive is still a valid zip')
}

console.log('\n xmlEscape')
ok(xmlEscape('a & b') === 'a &amp; b', 'ampersand')
ok(xmlEscape('<tag>') === '&lt;tag&gt;', 'angle brackets')
ok(xmlEscape(null) === '', 'null → empty string, not "null"')
ok(xmlEscape(undefined) === '', 'undefined → empty string')
ok(xmlEscape(0) === '0', 'zero survives (falsy but meaningful)')
ok(!/[\x00-\x08]/.test(xmlEscape('a\x00b\x07c')), 'control characters stripped — they make OOXML unopenable')
ok(xmlEscape('a\nb').includes('\n'), 'newlines kept')

/* ── CSV ─────────────────────────────────────────────────────────────
   The escaping rules here are the difference between a clean import into
   Excel and a mangled one. */
console.log('\n tableToCsv')
{
  const csv = tableToCsv({ headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] })
  ok(csv.includes('A,B'), 'header row present')
  ok(csv.includes('\r\n'), 'CRLF line endings (what Excel expects)')

  const tricky = tableToCsv({ headers: ['x'], rows: [['has,comma'], ['has"quote'], ['has\nnewline']] })
  ok(tricky.includes('"has,comma"'), 'a comma forces quoting')
  ok(tricky.includes('"has""quote"'), 'a quote is doubled, not escaped with a backslash')
  ok(/"has\nnewline"/.test(tricky), 'an embedded newline forces quoting')

  const blanks = tableToCsv({ headers: ['a'], rows: [['1'], ['', ''], ['2']] })
  ok(!/\r\n\r\n/.test(blanks.replace(/\r\n$/, '')), 'fully blank rows are skipped, not emitted as empty lines')
  ok(tableToCsv({ headers: [], rows: [] }) !== undefined, 'an empty table does not throw')
}

console.log('\n htmlToText')
ok(htmlToText('<p>hello</p>').trim() === 'hello', 'tags stripped')
ok(htmlToText('<p>a</p><p>b</p>').includes('\n'), 'block elements become line breaks')
ok(htmlToText('') === '', 'empty input')
ok(htmlToText(null) === '', 'null input does not throw')
/* htmlToText strips TAGS, not tag CONTENTS — a <script> body survives as
   plain text. That's correct for its job (it produces a string for CSV and
   markdown, which never execute anything). The security-relevant path is
   blocksToHtml, which writes a real .html file, and that one is asserted
   separately below. */
ok(htmlToText('<b>a</b>c') === 'ac', 'inline tags removed, text kept')
ok(!htmlToText('<script>bad()</script>').includes('<'), 'no markup survives into plain text')

/* ── export format gating ─────────────────────────────────────────── */
console.log('\n export formats')
ok(FORMATS.length === 9, 'nine formats declared')
ok(FORMATS.every(f => f.id && f.label && f.ext && f.group), 'every format is fully declared')
ok(new Set(FORMATS.map(f => f.id)).size === FORMATS.length, 'no duplicate format ids')
{
  const forText = formatsFor([{ type: 'text', content: '<p>x</p>' }])
  const csv = forText.find(f => f.id === 'csv')
  ok(csv && !csv.enabled, 'CSV is disabled when nothing in the selection is a table')
  const forTable = formatsFor([{ type: 'table', headers: ['a'], rows: [['1']] }])
  ok(forTable.find(f => f.id === 'csv')?.enabled, 'CSV enabled once a table is present')
  ok(forTable.find(f => f.id === 'pdf')?.enabled, 'PDF accepts anything')
  ok(formatsFor([]).length === FORMATS.length, 'an empty selection still lists every format')
}

console.log('\n blocksToMarkdown')
{
  const md = blocksToMarkdown([
    { type: 'text', name: 'Note', content: '<p>hello</p>' },
    { type: 'table', name: 'Data', headers: ['A', 'B'], rows: [['1', '2']] },
  ])
  ok(md.includes('|'), 'tables render as pipe tables')
  ok(md.includes('hello'), 'text content included')
  ok(blocksToMarkdown([]) !== undefined, 'empty input does not throw')
}

/* ── curve fitting ────────────────────────────────────────────────────
   Generate data from known parameters, fit it, and check the parameters
   come back. A fit that returns plausible-looking wrong numbers is the
   worst possible failure for a research tool. */
console.log('\n blocksToHtml — sanitisation of exported files')
{
  const evil = [{ type: 'text', name: 'x', content: '<p>ok</p><script>steal()</script><img src=x onerror="steal()">' }]
  const html = blocksToHtml(evil, 'Test')
  ok(!/<script/i.test(html), 'script tags removed from the exported file')
  ok(!/onerror\s*=/i.test(html), 'inline event handlers removed')
  ok(html.includes('ok'), 'legitimate content survives')
  const tbl = [{ type: 'table', name: '<b>t</b>', headers: ['<i>h</i>'], rows: [['<u>c</u>']] }]
  const th = blocksToHtml(tbl, 'T')
  ok(th.includes('&lt;i&gt;'), 'table headers are entity-escaped')
  ok(th.includes('&lt;u&gt;'), 'table cells are entity-escaped')
}

console.log('\n curvefit — parameter recovery from synthetic data')
{
  const xs = Array.from({ length: 40 }, (_, i) => i * 0.25)

  /* MODELS.linear declares params as ['intercept', 'slope'] — a and b in
     `y = a + b·x`, matching the formula string shown in the UI. Getting this
     order backwards is the obvious mistake and would put the wrong number
     next to the wrong label in the results panel. */
  const linear = fit(xs, xs.map(x => 3 * x + 7), 'linear')
  ok(near(linear.params[0], 7, 1e-6), 'linear recovers intercept 7 as params[0]')
  ok(near(linear.params[1], 3, 1e-6), 'linear recovers slope 3 as params[1]')
  ok(MODELS.linear.params[0] === 'intercept' && MODELS.linear.params[1] === 'slope',
     'the declared param NAMES match that order, so labels line up with values')
  ok(near(linear.r2, 1, 1e-9), 'noise-free data gives R² = 1')

  const quad = fit(xs, xs.map(x => 2 * x * x - 3 * x + 1), 'poly2')
  ok(quad.params.every(Number.isFinite), 'poly2 returns finite parameters')
  ok(near(quad.r2, 1, 1e-9), 'poly2 fits a quadratic exactly')

  const expo = fit(xs, xs.map(x => 5 * Math.exp(0.4 * x)), 'exponential')
  ok(near(expo.r2, 1, 1e-6), 'exponential fits an exponential')

  const modelIds = Object.keys(MODELS)
  ok(modelIds.length >= 8, `at least eight models offered (${modelIds.length})`)
  ok(Object.values(MODELS).every(m => m.label && Array.isArray(m.params) && m.formula),
     'every model declares a label, named params and a formula')
  ok(Object.values(MODELS).every(m => m.params.length > 0), 'every model has at least one parameter')

  // Degenerate input must fail honestly rather than return nonsense.
  const tooFew = fit([1], [1], 'poly2')
  ok(!tooFew || tooFew.error || !tooFew.params?.every(Number.isFinite),
     'fitting 1 point to a 3-parameter model does not return confident nonsense')
  const flat = fit([1, 2, 3], [5, 5, 5], 'linear')
  ok(flat.params.every(Number.isFinite), 'a flat line still fits (slope 0)')
  ok(near(flat.params[1], 0, 1e-9), 'flat line has zero SLOPE (params[1]), not zero intercept')
  ok(near(flat.params[0], 5, 1e-9), 'flat line intercept is the constant value, 5')

  const pts = curvePoints(linear, 24)
  ok(Array.isArray(pts) && pts.length === 25, 'curvePoints returns steps+1 points (both endpoints included)')
  /* curvePoints emits [x, y] PAIRS, not {x, y} objects — it feeds straight
     into an SVG polyline, where an array is what's wanted. */
  ok(pts.every(pt => Array.isArray(pt) && pt.length === 2), 'points are [x, y] pairs')
  ok(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), 'every plotted point is finite')
  ok(pts[0][0] <= pts[pts.length - 1][0], 'points are emitted left to right')
  ok(curvePoints({ ok: false }, 10).length === 0, 'a failed fit plots nothing rather than a flat line at zero')
}

/* ── shortcuts ───────────────────────────────────────────────────────
   This is the file both the ? overlay and Settings read, so a collision
   here ships as two features silently fighting over one key. */
console.log('\n shortcuts')
{
  ok(SHORTCUT_GROUPS.length > 0, 'groups declared')
  ok(SHORTCUT_GROUPS.every(g => g.title && Array.isArray(g.rows)), 'every group has a title and rows')
  ok(SHORTCUT_GROUPS.every(g => g.rows.every(r => Array.isArray(r) && r.length === 2 && r[0] && r[1])),
     'every row is a [key, description] pair with both halves filled in')

  const all = SHORTCUT_GROUPS.flatMap(g => g.rows.map(r => `${g.title}::${r[0]}`))
  ok(new Set(all).size === all.length, 'no key is documented twice within the same group')

  ok(Array.isArray(RESERVED_COMBOS) && RESERVED_COMBOS.length > 0, 'reserved browser combos listed')
  const flatKeys = SHORTCUT_GROUPS.flatMap(g => g.rows.map(r => r[0].toLowerCase()))
  const clashes = RESERVED_COMBOS.filter(rc => flatKeys.includes(String(rc.combo || rc).toLowerCase()))
  ok(clashes.length === 0, 'no documented shortcut collides with a reserved browser combo',
     clashes.length ? JSON.stringify(clashes) : '')
}

/* ── persistence helpers ─────────────────────────────────────────── */
console.log('\n persistence helpers')
ok(STATE_VERSION === 4, 'payload version is 4 (prefs added)')
/* The smallest unit is KB, deliberately — a storage meter reading "847 B"
   is noise when the quota is measured in gigabytes. */
ok(formatBytes(0) === '0 KB', 'zero formats as 0 KB, not 0 B')
ok(formatBytes(-5) === '0 KB', 'a negative size clamps rather than printing a minus')
ok(formatBytes(1) === '1 KB', 'sub-KB rounds up to 1 KB rather than showing 0')
ok(/KB/.test(formatBytes(2048)), '2048 → KB')
ok(/MB/.test(formatBytes(5 * 1024 * 1024)), '5MB → MB')
ok(formatBytes(undefined) !== undefined, 'undefined does not throw')
{
  let calls = 0
  const d = debounce(() => calls++, 5)
  d(); d(); d()
  ok(calls === 0, 'debounce does not fire synchronously')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
