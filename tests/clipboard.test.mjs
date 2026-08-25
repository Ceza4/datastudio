/*
  tests/clipboard.test.mjs
  --------------------------------------------------------------------------
  Copying blocks and shapes (lib/clipboard.js).

  The two rules that matter are both about identity and both easy to get wrong
  in a way that only shows up later: ids must be reminted on every paste, and a
  parentSectionId pointing at a section that did not travel must be dropped
  rather than carried. Either mistake produces a block that looks fine and
  behaves strangely a week afterwards.
  -------------------------------------------------------------------------- */

import {
  serializeSelection, parseClipboard, materialise, splitCopyable, CLIP_MAGIC,
} from '../lib/clipboard.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

const B = (id, x, y, extra = {}) => ({ id, type: 'text', x, y, content: 'hi', ...extra })

console.log('\n  round trip')
{
  const txt = serializeSelection({ blocks: [B('b1', 100, 200), B('b2', 140, 260)] })
  ok(txt.startsWith(CLIP_MAGIC), 'the payload is tagged so a foreign paste is recognisable')
  const back = parseClipboard(txt)
  ok(back.blocks.length === 2, 'both blocks come back')
  eq(back.blocks[0].content, 'hi', 'content survives')
}

console.log('\n  positions are relative to the selection')
{
  const txt = serializeSelection({ blocks: [B('b1', 5000, 9000), B('b2', 5040, 9060)] })
  const p = parseClipboard(txt)
  eq([p.blocks[0].x, p.blocks[0].y], [0, 0], 'the top-left of the selection becomes the origin')
  eq([p.blocks[1].x, p.blocks[1].y], [40, 60], 'and the rest keep their offsets')

  const out = materialise(p, { x: 10, y: 20 })
  eq([out.blocks[0].x, out.blocks[0].y], [10, 20], 'a paste lands where it is dropped')
  eq([out.blocks[1].x, out.blocks[1].y], [50, 80],
    'as a group — not at the thousand-pixel coordinates it was copied from')
}

console.log('\n  ids are always reminted')
{
  const p = parseClipboard(serializeSelection({ blocks: [B('b1', 0, 0)] }))
  const a = materialise(p)
  const b = materialise(p)
  ok(a.blocks[0].id !== 'b1', 'the pasted block does not keep the original id')
  ok(a.blocks[0].id !== b.blocks[0].id, 'and two pastes of the same clipboard differ from each other')
  ok(/^block_/.test(a.blocks[0].id), 'the id keeps the house prefix')
}

console.log('\n  section membership')
{
  /* Both travel: the child should still be inside the section. */
  const withSection = parseClipboard(serializeSelection({
    blocks: [B('sec', 0, 0, { type: 'section' }), B('kid', 10, 10, { parentSectionId: 'sec' })],
  }))
  const out = materialise(withSection)
  const sec = out.blocks.find(b => b.type === 'section')
  const kid = out.blocks.find(b => b.type !== 'section')
  ok(kid.parentSectionId === sec.id, 'the child is remapped to the NEW section id')
  ok(kid.parentSectionId !== 'sec', 'and not left pointing at the old one')

  /* Only the child travels: membership must be dropped. */
  const orphan = parseClipboard(serializeSelection({
    blocks: [B('kid', 10, 10, { parentSectionId: 'sec' })],
  }))
  const out2 = materialise(orphan)
  ok(out2.blocks[0].parentSectionId === null,
    'a child pasted without its section is not left claiming to be inside one')
}

console.log('\n  foreign and damaged input')
{
  ok(parseClipboard('just some text') === null, 'ordinary text is not ours')
  ok(parseClipboard('') === null, 'empty is not ours')
  ok(parseClipboard(null) === null, 'null does not throw')
  ok(parseClipboard(undefined) === null, 'undefined does not throw')
  ok(parseClipboard(CLIP_MAGIC + '\n{not json') === null,
    'our own tag with damaged JSON is refused — a half-parsed paste is worse than none')
  ok(parseClipboard(CLIP_MAGIC + '\n{"v":2,"blocks":[{}]}') === null,
    'a future version is refused rather than half-read')
  ok(parseClipboard(CLIP_MAGIC + '\n{"v":1,"blocks":[],"shapes":[]}') === null,
    'an empty payload is nothing to paste')
  eq(materialise(null), { blocks: [], shapes: [] }, 'materialising null is empty, not a crash')
}

console.log('\n  nothing to copy')
{
  ok(serializeSelection({ blocks: [], shapes: [] }) === null, 'an empty selection produces no clipboard write')
  ok(serializeSelection({}) === null, 'and neither does an empty call')
}

console.log('\n  shapes travel too')
{
  const txt = serializeSelection({ blocks: [], shapes: [{ id: 's1', kind: 'rect', x: 90, y: 90, w: 10, h: 10 }] })
  const out = materialise(parseClipboard(txt), { x: 5, y: 5 })
  ok(out.shapes.length === 1, 'a shape-only selection round-trips')
  ok(out.shapes[0].id !== 's1', 'with a reminted id')
  eq([out.shapes[0].x, out.shapes[0].y], [5, 5], 'and repositioned like a block')
}

console.log('\n  asset blocks are held back')
{
  const { copyable, skipped } = splitCopyable([
    B('t', 0, 0),
    { id: 'i', type: 'image', imageId: 'img_1', x: 0, y: 0 },
    { id: 'p', type: 'pdf', pdfId: 'pdf_1', x: 0, y: 0 },
    { id: 'f', type: 'file', fileId: 'file_1', x: 0, y: 0 },
  ])
  eq(copyable.length, 1, 'ordinary blocks are copyable')
  eq(skipped.length, 3,
    'image, PDF and attachment blocks are not — their bytes live in a separate store, so a copy would paste a "file is missing" box')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
