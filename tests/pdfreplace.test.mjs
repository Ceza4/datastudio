/*
  tests/pdfreplace.test.mjs
  --------------------------------------------------------------------------
  Editing text that is already in the document.

  THREE THINGS THIS HAS TO GET RIGHT, in order of how badly they fail:

  1. THE ORIGINAL BYTES ARE NEVER TOUCHED. A replacement is one row in the
     edits array like every other annotation. Asserted end-to-end below against
     a real pdf-lib document, not just at the unit level.

  2. TEXT THAT DOES NOT FIT IS REFUSED, NOT DRAWN. Overlapping the line beneath
     produces a document that looks plausible on screen and is wrong on paper —
     the failure mode a user does not find until after they have sent it.

  3. A CLICK LANDS ON THE LINE A HUMAN SEES. pdf.js splits a visual line at
     every kerning and font change, so "Invoice #4021 — due 12 August" can
     arrive as six runs. Editing a three-character fragment of a sentence is
     the thing that makes a tool feel broken.

  The baseline trap is the same one lib/pdfspace.js documents: transform[4],[5]
  is the text ORIGIN — baseline left — not a top-left corner. Every cover
  rectangle here is built upward from the baseline, and a descender allowance
  below it, or the tail of a 'g' survives the whiteout.
  -------------------------------------------------------------------------- */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  editableRuns, mergeRunsIntoLines, runAtPoint, fitSize,
  makeReplaceEdit, changesText, MIN_FIT_RATIO,
} from '../lib/pdfreplace.js'
import { applyEdits } from '../lib/pdfexport.js'
import { EDIT_KINDS, makeEdit, editsForPage } from '../lib/pdfs.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

/* A pdf.js text item. `transform` is [a,b,c,d,e,f]; d carries the font size and
   e,f the baseline origin. */
const item = (str, x, baseline, w, size = 10, font = 'g_d0_f1', skew = 0) => ({
  str, transform: [size, skew, skew, size, x, baseline], width: w, height: size, fontName: font,
})

console.log('\n editableRuns')
{
  const runs = editableRuns([
    item('Hello', 72, 700, 30),
    item('   ', 102, 700, 5),
    item('world', 107, 700, 32),
  ])
  ok(runs.length === 2, 'whitespace-only runs are dropped — they carry line breaks, not text')
  ok(runs[0].str === 'Hello' && runs[0].x === 72, 'the origin x is kept')
  ok(runs[0].baselineY === 700, 'and the baseline y, unrounded')

  /* The box runs UP from the baseline, with room below it for descenders. */
  const r = runs[0].rect
  ok(r.y < 700, 'the cover rect starts below the baseline, so descenders are covered')
  ok(r.y + r.h > 700 + 10 * 0.9, 'and extends above it by roughly the font height')
  ok(r.x === 72 && Math.abs(r.w - 30) < 0.001, 'and spans the run horizontally')

  ok(editableRuns([]).length === 0 && editableRuns(null).length === 0, 'empty and null are safe')
  ok(editableRuns([{ str: 'x' }]).length === 0, 'an item with no transform is dropped, not placed at the origin')
  ok(editableRuns([item('turned', 72, 700, 30, 10, 'f1', 0.6)])[0].upright === false,
     'a skewed run is flagged, so the UI can refuse it rather than draw it wrong')
}

console.log('\n mergeRunsIntoLines')
{
  /* One sentence as pdf.js really delivers it. */
  const lines = mergeRunsIntoLines(editableRuns([
    item('Invoice ', 72, 700, 40),
    item('#4021', 112, 700, 28),
    item(' due ', 140, 700, 22),
    item('12 August', 162, 700, 48),
  ]))
  ok(lines.length === 1, 'four runs on one baseline become one editable line')
  ok(lines[0].str === 'Invoice #4021 due 12 August', 'and read as the sentence a human sees')
  ok(Math.abs(lines[0].rect.w - (162 + 48 - 72)) < 0.001, 'the box spans all of it')
  ok(lines[0].parts.length === 4, 'the original runs are kept, for anything that needs them')

  /* A kerning split inside one word must NOT gain a space. */
  const kerned = mergeRunsIntoLines(editableRuns([
    item('Wa', 72, 700, 12), item('ter', 84, 700, 14),
  ]))
  ok(kerned[0].str === 'Water', 'runs that abut are one word, not two')

  const twoLines = mergeRunsIntoLines(editableRuns([
    item('first', 72, 700, 24), item('second', 72, 680, 30),
  ]))
  ok(twoLines.length === 2, 'different baselines stay separate')
  ok(twoLines[0].str === 'first', 'and come back in reading order, top first')

  const columns = mergeRunsIntoLines(editableRuns([
    item('left', 72, 700, 20), item('right', 300, 700, 24),
  ]))
  ok(columns.length === 2, 'a wide gap is a column boundary, not a continuation')

  const mixed = mergeRunsIntoLines(editableRuns([
    item('normal ', 72, 700, 34, 10, 'f1'), item('bold', 106, 700, 22, 10, 'f2'),
  ]))
  ok(mixed.length === 2, 'a different font is a separate run — merging would redraw it in the wrong weight')

  const sizes = mergeRunsIntoLines(editableRuns([
    item('big', 72, 700, 30, 18), item('small', 102, 700, 20, 9),
  ]))
  ok(sizes.length === 2, 'and so is a different size')
}

console.log('\n runAtPoint')
{
  const runs = mergeRunsIntoLines(editableRuns([
    item('target', 72, 700, 40), item('other', 72, 660, 30),
  ]))
  ok(runAtPoint(runs, { x: 90, y: 703 })?.str === 'target', 'a point inside the box hits')
  ok(runAtPoint(runs, { x: 90, y: 663 })?.str === 'other', 'the other line hits too')
  ok(runAtPoint(runs, { x: 400, y: 700 }) === null, 'a point past the end hits nothing')
  ok(runAtPoint(runs, { x: 90, y: 500 }) === null, 'and so does one below everything')
  ok(runAtPoint(runs, { x: 71, y: 703 })?.str === 'target',
     'the box is padded outward — a 9pt target with no margin is not clickable')
  ok(runAtPoint([], { x: 0, y: 0 }) === null, 'no runs is null, not a throw')
  ok(runAtPoint(runs, null) === null && runAtPoint(runs, { x: NaN, y: 1 }) === null,
     'a missing or non-finite point is null, not a throw')
}

console.log('\n fitSize')
{
  const run = { rect: { x: 0, y: 0, w: 100, h: 12 }, size: 10 }
  /* A deliberately exact measure, so the assertions are about the algorithm
     rather than about a font's metrics. */
  const measure = (s, at) => s.length * at * 0.5

  ok(fitSize(run, 'short', { measure }) === 10, 'text that fits keeps the original size')
  ok(fitSize(run, '', { measure }) === 10, 'empty text is a deletion, not a fit failure')

  const long = 'x'.repeat(30)                     // 30 * 10 * 0.5 = 150pt at size 10
  const got = fitSize(run, long, { measure })
  ok(got !== null && got < 10, 'text that overflows is scaled down')
  ok(measure(long, got) <= 100 + 1e-9, 'and the result actually fits, not approximately')
  ok(got >= 10 * MIN_FIT_RATIO, 'but never below the legibility floor')

  const absurd = 'x'.repeat(200)
  ok(fitSize(run, absurd, { measure }) === null,
     'text that cannot fit even at the floor returns null — the caller must refuse, not overlap')

  ok(fitSize({ rect: { w: 0 }, size: 10 }, 'anything', { measure }) === 10,
     'a zero-width box cannot constrain anything, so the original size stands')
}

console.log('\n makeReplaceEdit')
{
  const [run] = mergeRunsIntoLines(editableRuns([item('Original sentence', 72, 700, 90, 14)]))
  const edit = makeReplaceEdit(run, 'Replaced sentence', 0, { cover: '#f5f3ee', color: '#1a1917' })

  ok(EDIT_KINDS.includes('replace'), 'replace is a registered edit kind')
  ok(edit.kind === 'replace' && edit.page === 0, 'it is one edit, on the right page')
  ok(edit.x === 72 && edit.y === 700, 'anchored to the original baseline, so it lands where the text was')
  ok(edit.size === 14, 'at the original size')
  ok(edit.original === 'Original sentence', 'the replaced text is kept, so revert is exact')
  ok(edit.cover === '#f5f3ee', 'the cover colour is sampled, not assumed white')
  ok(!!edit.id && !!edit.createdAt, 'and it carries the usual identity')

  /* One edit, not two. A whiteout plus a text edit would undo separately, and
     undoing half a replacement leaves blank paper or two overlapping lines. */
  ok(editsForPage([edit], 0).length === 1, 'a replacement is a single undo step')

  ok(changesText(edit) === true, 'an edit that changes the words reports so')
  ok(changesText(makeReplaceEdit(run, 'Original sentence', 0)) === false, 'and one that does not, does not')
  ok(changesText(makeEdit('text', 0, { text: 'x' })) === false, 'other kinds are not replacements')

  let threw = false
  try { makeReplaceEdit(null, 'x', 0) } catch { threw = true }
  ok(threw, 'building one without a run throws rather than producing a placeless edit')
}

console.log('\n export round trip — a real document')
{
  const src = await PDFDocument.create()
  const font = await src.embedFont(StandardFonts.Helvetica)
  const page = src.addPage([595.28, 841.89])
  page.drawText('Original sentence', { x: 72, y: 700, size: 14, font })
  const ORIGINAL = await src.save()
  const snapshot = ORIGINAL.slice()

  const [run] = mergeRunsIntoLines(editableRuns([item('Original sentence', 72, 700, 110, 14)]))
  const edits = [makeReplaceEdit(run, 'Replaced sentence', 0, { cover: '#ffffff' })]

  const out = await applyEdits(ORIGINAL, edits)
  ok(out?.length > 0, `produces bytes (${out.length})`)
  ok(new TextDecoder().decode(out.slice(0, 5)) === '%PDF-', 'with a valid PDF header')

  /* THE promise the whole overlay model rests on. */
  ok(snapshot.length === ORIGINAL.length && snapshot.every((b, i) => b === ORIGINAL[i]),
     'the ORIGINAL bytes are byte-identical after a text replacement')

  const reopened = await PDFDocument.load(out)
  ok(reopened.getPageCount() === 1, 'the exported file re-parses')

  /* Deleting the text is a legitimate edit: the cover still has to be painted,
     otherwise "delete this line" leaves the line there. */
  const deleted = await applyEdits(ORIGINAL, [makeReplaceEdit(run, '', 0, { cover: '#ffffff' })])
  ok(deleted.length > ORIGINAL.length, 'an empty replacement still paints the cover')

  /* Text far too long for the box: the cover is painted, the text is dropped.
     Visibly blank beats quietly overlapping the line below. */
  const huge = await applyEdits(ORIGINAL, [makeReplaceEdit(run, 'x'.repeat(400), 0, { cover: '#ffffff' })])
  ok(huge.length > 0 && new TextDecoder().decode(huge.slice(0, 5)) === '%PDF-',
     'text that cannot be made to fit exports cleanly rather than throwing')

  /* An edit on a page that no longer exists must be skipped, not thrown on. */
  const offPage = await applyEdits(ORIGINAL, [makeReplaceEdit(run, 'x', 9)])
  ok(offPage.length > 0, 'a replacement on a missing page is skipped, not fatal')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
export default { pass, fail }
