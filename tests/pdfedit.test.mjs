/*
  tests/pdfedit.test.mjs
  --------------------------------------------------------------------------
  Stage 2: the overlay history, and the export that turns it into a real file.

  The export half is the valuable part, and unusually for this feature it can
  be verified properly: pdf-lib runs in Node, so a document is generated,
  annotated, exported and RE-PARSED here. That covers the promise everything
  else rests on — the imported bytes are never modified — end to end rather
  than by inspection.
  -------------------------------------------------------------------------- */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  createHistory, current, commit, undo, redo, canUndo, canRedo,
  addEdit, updateEdit, removeEdit, removeEditsOnPage, bringToFront,
  hitTest, describeEdits, HISTORY_LIMIT,
} from '../lib/pdfedits.js'
import { applyEdits, parseColor, hasEdits, editedFilename } from '../lib/pdfexport.js'
import { makeEdit } from '../lib/pdfs.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }

const rect = (x, y, w, h) => ({ x, y, w, h })

/* ── history ─────────────────────────────────────────────────────────── */
console.log('\n history')
{
  let h = createHistory([])
  ok(current(h).length === 0, 'starts empty')
  ok(!canUndo(h), 'nothing to undo at the start')
  ok(!canRedo(h), 'nothing to redo at the start')

  const a = makeEdit('whiteout', 0, { rect: rect(1, 2, 3, 4) })
  h = commit(h, addEdit(current(h), a))
  ok(current(h).length === 1, 'one edit after a commit')
  ok(canUndo(h), 'undo becomes available')

  const b = makeEdit('highlight', 0, { rect: rect(5, 6, 7, 8) })
  h = commit(h, addEdit(current(h), b))
  ok(current(h).length === 2, 'two edits')

  h = undo(h)
  ok(current(h).length === 1, 'undo steps back one')
  ok(canRedo(h), 'redo becomes available')
  h = undo(h)
  ok(current(h).length === 0, 'undo again reaches the start')
  ok(!canUndo(h), 'and stops there')

  h = undo(h)
  ok(current(h).length === 0, 'undoing past the start is a no-op, not a crash')

  h = redo(h); h = redo(h)
  ok(current(h).length === 2, 'redo returns to the front')
  h = redo(h)
  ok(current(h).length === 2, 'redoing past the end is a no-op')
}

console.log('\n history — branch pruning')
{
  let h = createHistory([])
  h = commit(h, [makeEdit('text', 0, { text: 'a' })])
  h = commit(h, [makeEdit('text', 0, { text: 'a' }), makeEdit('text', 0, { text: 'b' })])
  h = undo(h)
  ok(canRedo(h), 'redo is available after an undo')

  h = commit(h, [makeEdit('text', 0, { text: 'c' })])
  ok(!canRedo(h), 'editing after undo discards the redo branch')
  ok(current(h).length === 1, 'and the new state is what was committed')
}

console.log('\n history — isolation')
{
  const initial = [makeEdit('text', 0, { text: 'x' })]
  const h = createHistory(initial)
  /* The stack must not alias the caller's array. If it did, mutating the live
     overlay would silently rewrite history and undo would return the state it
     was supposed to be undoing. */
  initial.push(makeEdit('text', 0, { text: 'y' }))
  ok(current(h).length === 1, 'the history does not alias the array it was created from')

  const got = current(h)
  got.push(makeEdit('text', 0, { text: 'z' }))
  ok(current(h).length === 1, 'current() hands back a copy, so callers cannot corrupt the stack')

  const one = current(h)[0]
  one.text = 'MUTATED'
  ok(current(h)[0].text === 'x', 'entries are copied too, not shared by reference')
}

console.log('\n history — bounded')
{
  let h = createHistory([])
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) h = commit(h, [makeEdit('text', 0, { text: `${i}` })])
  ok(h.stack.length <= HISTORY_LIMIT, `stack capped at ${HISTORY_LIMIT} (is ${h.stack.length})`)
  ok(current(h)[0].text === `${HISTORY_LIMIT + 24}`, 'the newest state is still the current one')
  ok(canUndo(h), 'and there is still history to walk back through')
}

/* ── operations ──────────────────────────────────────────────────────── */
console.log('\n operations — all non-mutating')
{
  const base = [makeEdit('text', 0, { text: 'a' }), makeEdit('text', 1, { text: 'b' })]
  const frozen = JSON.stringify(base)

  ok(addEdit(base, makeEdit('text', 0, {})).length === 3, 'addEdit appends')
  ok(removeEdit(base, base[0].id).length === 1, 'removeEdit drops by id')
  ok(removeEdit(base, 'nope').length === 2, 'removing an unknown id changes nothing')
  ok(updateEdit(base, base[0].id, { text: 'z' })[0].text === 'z', 'updateEdit patches')
  ok(updateEdit(base, base[0].id, { id: 'HIJACK' })[0].id === base[0].id, 'updateEdit cannot change an id')
  ok(removeEditsOnPage(base, 1).length === 1, 'removeEditsOnPage clears one page')

  ok(JSON.stringify(base) === frozen, 'NONE of them mutated the input — the history stack depends on this')
}

console.log('\n bringToFront')
{
  const a = makeEdit('text', 0, { text: 'a' })
  const b = makeEdit('text', 0, { text: 'b' })
  const c = makeEdit('text', 0, { text: 'c' })
  const out = bringToFront([a, b, c], a.id)
  ok(out[out.length - 1].id === a.id, 'moves the entry to the end, so it paints last')
  ok(out.length === 3, 'without losing anything')
  ok(bringToFront([a, b], 'missing').length === 2, 'an unknown id is a no-op')
}

console.log('\n hitTest')
{
  const under = makeEdit('whiteout', 0, { rect: rect(10, 10, 100, 20) })
  const over = makeEdit('highlight', 0, { rect: rect(50, 15, 100, 20) })
  const other = makeEdit('whiteout', 1, { rect: rect(10, 10, 100, 20) })
  const all = [under, over, other]

  ok(hitTest(all, 0, { x: 20, y: 15 })?.id === under.id, 'finds the entry under a point')
  ok(hitTest(all, 0, { x: 60, y: 20 })?.id === over.id, 'topmost wins where two overlap')
  ok(hitTest(all, 0, { x: 500, y: 500 }) === null, 'a miss returns null')
  ok(hitTest(all, 0, { x: 10, y: 10 })?.id === under.id, 'the exact corner counts as a hit')
  ok(hitTest(all, 5, { x: 20, y: 15 }) === null, 'entries on other pages are ignored')
  ok(hitTest([], 0, { x: 0, y: 0 }) === null, 'empty list')
  ok(hitTest(null, 0, { x: 0, y: 0 }) === null, 'null list does not throw')
}

console.log('\n describeEdits')
ok(describeEdits([]) === 'No edits', 'empty')
ok(describeEdits(null) === 'No edits', 'null')
ok(describeEdits([makeEdit('whiteout', 0, {})]) === '1 white-out', 'singular')
ok(describeEdits([makeEdit('ink', 0, {}), makeEdit('ink', 0, {})]) === '2 drawings', 'plural')

/* ── colour ──────────────────────────────────────────────────────────── */
console.log('\n parseColor')
{
  const rgb = (r, g, b) => ({ r, g, b })
  ok(parseColor('#ffffff', rgb).r === 1, 'white')
  ok(parseColor('#000000', rgb).r === 0, 'black')
  ok(parseColor('ff0000', rgb).r === 1 && parseColor('ff0000', rgb).g === 0, 'a missing # is tolerated')
  ok(parseColor('#f00', rgb).r === 1, 'three-digit shorthand expands')
  ok(parseColor('nonsense', rgb).r === 0, 'junk falls back to black rather than NaN')
  ok(parseColor(null, rgb).r === 0, 'null falls back')
  ok(parseColor(undefined, rgb).r === 0, 'undefined falls back')
}

/* ── export, against a real document ─────────────────────────────────── */
console.log('\n export — round trip through a real PDF')
{
  const src = await PDFDocument.create()
  const font = await src.embedFont(StandardFonts.Helvetica)
  const p1 = src.addPage([595.28, 841.89])
  p1.drawText('Original sentence', { x: 72, y: 700, size: 14, font })
  src.addPage([842, 595])
  const ORIGINAL = await src.save()
  const snapshot = ORIGINAL.slice()

  const edits = [
    makeEdit('whiteout', 0, { rect: rect(70, 694, 200, 20), color: '#ffffff' }),
    makeEdit('text', 0, { x: 72, y: 700, text: 'Replaced sentence', size: 14, color: '#000000' }),
    makeEdit('highlight', 0, { rect: rect(70, 660, 180, 16), color: '#ffe066', opacity: 0.35 }),
    makeEdit('ink', 1, { points: [{ x: 50, y: 50 }, { x: 150, y: 120 }, { x: 250, y: 60 }], color: '#5B5FE8', width: 3 }),
  ]

  const out = await applyEdits(ORIGINAL, edits)
  ok(out?.length > 0, `produces bytes (${out.length})`)
  ok(new TextDecoder().decode(out.slice(0, 5)) === '%PDF-', 'with a valid PDF header')

  /* THE promise the whole feature rests on. */
  ok(snapshot.length === ORIGINAL.length && snapshot.every((b, i) => b === ORIGINAL[i]),
     'the ORIGINAL bytes are byte-identical after export')

  const reopened = await PDFDocument.load(out)
  ok(reopened.getPageCount() === 2, 'the exported file re-parses, with both pages')
  ok(out.length > ORIGINAL.length, 'and is larger, because the annotations are really in it')

  const twice = await applyEdits(ORIGINAL, edits)
  ok(Math.abs(twice.length - out.length) < 200, 'exporting twice gives the same result')

  const clean = await applyEdits(ORIGINAL, [])
  ok((await PDFDocument.load(clean)).getPageCount() === 2, 'an empty overlay still exports a valid document')
}

console.log('\n export — malformed entries must not break the file')
{
  const src = await PDFDocument.create()
  src.addPage([400, 400])
  const ORIGINAL = await src.save()

  const nasty = [
    { id: '1', kind: 'stamp', page: 0, rect: rect(0, 0, 1, 1) },   // kind from a newer build
    { id: '2', kind: 'text', page: 99, x: 1, y: 1, text: 'off the end' },
    { id: '3', kind: 'whiteout', page: 0 },                         // no rect
    { id: '4', kind: 'text', page: 0, x: 10, y: 10 },               // no text
    { id: '5', kind: 'ink', page: 0, points: [{ x: 1, y: 1 }] },    // single point
    { id: '6', kind: 'ink', page: 0, points: [] },                  // no points
    { id: '7', kind: 'highlight', page: 0, rect: rect(10, 10, 50, 10), color: 'not-a-colour' },
  ]

  const out = await applyEdits(ORIGINAL, nasty)
  ok(out?.length > 0, 'exports without throwing')
  ok((await PDFDocument.load(out)).getPageCount() === 1, 'and the result is still a valid PDF')

  let threw = false
  try { await applyEdits(null, []) } catch { threw = true }
  ok(threw, 'exporting with no document throws a clear error rather than writing a broken file')
}

console.log('\n helpers')
ok(hasEdits([]) === false && hasEdits(null) === false, 'hasEdits is false for empty and null')
ok(hasEdits([makeEdit('text', 0, {})]) === true, 'and true when there is something')
ok(editedFilename('Report.pdf') === 'Report (edited).pdf', 'names the copy distinctly')
ok(editedFilename('Report') === 'Report (edited).pdf', 'adds the extension when missing')
ok(editedFilename('') === 'document (edited).pdf', 'falls back for an empty name')
ok(editedFilename(null) === 'document (edited).pdf', 'and for null')

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
