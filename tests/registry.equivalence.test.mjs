/*
  tests/registry.equivalence.test.mjs
  --------------------------------------------------------------------------
  The safety gate for the block registry.

  A block object is persisted verbatim into the workspace. If the registry
  produces even a slightly different shape from the code it replaces — a
  missing key, `null` where there was `undefined`, a different default width —
  every workspace already saved renders wrong, and nobody finds out until
  someone reopens an old notebook.

  So the old constructors are reproduced here VERBATIM, copied from
  app/app/page.js and NotebookCanvas.js as they stood at b39e05b, and every
  registry output is compared against them. This file is the reason it's safe
  to delete the original code paths.

  Run: node tests/registry.equivalence.test.mjs
  -------------------------------------------------------------------------- */

import {
  BLOCK_TYPES, BLOCK_TYPE_IDS, ADD_ITEMS, TYPE_BY_KEY,
  createBlock, blockDims, blockHasContent, clonepatch, cloneArgs, getType, isKnownType,
} from '../components/notebook/blockRegistry.js'

/* The five types that existed at b39e05b. This file's ONLY job is proving the
   refactor didn't change them — so it is deliberately pinned to this list and
   must NOT grow when a type is added. A new type has nothing to be equivalent
   to; its correctness belongs in its own suite (see tests/pdfs.test.mjs).

   Getting this wrong in the other direction is the real hazard: if this list
   were derived from the registry, adding a type would silently widen the
   comparison to a type the old code never knew about, every dims assertion
   would compare against the wrong fallback, and the failures would look like
   a broken refactor instead of a broken test. */
const LEGACY_TYPES = ['text', 'table', 'kanban', 'section', 'image']

let pass = 0, fail = 0
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + msg) }
  else { fail++; console.log(`  FAIL ${msg}${extra ? '\n        ' + extra : ''}`) }
}

/* Deep equality that treats a missing key and an explicit undefined as
   DIFFERENT, because JSON.stringify silently drops both and that's exactly
   the class of difference this file exists to catch. */
function deepEq(a, b, path = '') {
  if (a === b) return null
  if (typeof a !== typeof b) return `${path || 'root'}: ${typeof a} vs ${typeof b}`
  if (a === null || b === null) return `${path || 'root'}: ${a} vs ${b}`
  if (typeof a !== 'object') return `${path || 'root'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`
  const ka = Object.keys(a), kb = Object.keys(b)
  const only = k => `${path}: keys differ — only in A: [${ka.filter(x => !kb.includes(x))}], only in B: [${kb.filter(x => !ka.includes(x))}]`
  if (ka.length !== kb.length || ka.some(k => !kb.includes(k))) return only()
  for (const k of ka) {
    const r = deepEq(a[k], b[k], path ? `${path}.${k}` : k)
    if (r) return r
  }
  return null
}

/* ══════════════════════════════════════════════════════════════════════
   THE ORIGINAL CODE, copied verbatim from b39e05b. Do not "clean up".
   ══════════════════════════════════════════════════════════════════════ */

// app/app/page.js:441 — addNotebookBlock, block-construction half only.
function OLD_createBlock(type, x, y, customHeaders, customRows, customW, customH, patch, id, now) {
  let block = type === 'text'
    ? { id, type: 'text', x, y, w: customW || 280, name: '', content: '' }
    : type === 'kanban'
    ? { id, type: 'kanban', x, y, name: '', lanes: [
        { id: `lane_${now}_1`, name: 'Lane 1', cards: [] },
        { id: `lane_${now}_2`, name: 'Lane 2', cards: [] },
        { id: `lane_${now}_3`, name: 'Lane 3', cards: [] },
      ]}
    : type === 'section'
    ? { id, type: 'section', x, y, w: customW || 500, h: customH || 350, name: 'Section', sectionColor: '#5B5FE8' }
    : type === 'image'
    /* DELIBERATE DIVERGENCE, 21 Aug 2026: name was 'Image', now ''.
       This file pins the PRE-REFACTOR constructors so the registry can be
       proved to reproduce them, and this line no longer does — on purpose.
       A block created with its own type as its name puts real text in the
       title field, so renaming meant deleting the word "Image" first, every
       time. Blocks are born untitled and the header shows "Untitled" as a
       placeholder instead.
       Changing a pinned value is a decision, not a fix. Anything else that
       fails against this file should be treated as a regression until proven
       otherwise. */
    ? { id, type: 'image', x, y, w: customW || 360, h: customH || 260, name: '', imageId: null, alt: '', fit: 'contain', rev: 0 }
    : { id, type: 'table', x, y, w: customW || undefined, name: '',
        headers: customHeaders || [''],
        rows: customRows || Array(8).fill(null).map(() => ['']) }
  if (patch) block = { ...block, ...patch, id }
  return block
}

// NotebookCanvas.js:504 — blockDims
function OLD_blockDims(b) {
  const w = b.w || (b.type === 'kanban' ? 720 : b.type === 'table' ? 520 : b.type === 'section' ? 500 : 320)
  const h = b.h || (b.type === 'kanban' ? 280 : b.type === 'table' ? 260 : b.type === 'section' ? 350 : 150)
  return { w, h }
}

// NotebookCanvas.js:348 — blockHasContent
function OLD_blockHasContent(b, blocks) {
  if (!b) return false
  if (b.type === 'text') return (b.content || '').replace(/<[^>]*>/g, '').trim().length > 0
  if (b.type === 'table') return !!b.rows?.some(row => row.some(c => c && String(c).trim()))
  if (b.type === 'kanban') return !!b.lanes?.some(l => l.cards?.length > 0)
  if (b.type === 'section') return blocks.some(x => x.parentSectionId === b.id)
  return false
}

/* ══════════════════════════════════════════════════════════════════════
   1 · createBlock must be identical for all five types
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n createBlock — registry vs the code it replaces')

const NOW = 1723372800000   // frozen: kanban lane ids embed Date.now()
const ID = 'block_test_abc'

const cases = [
  ['text',    { x: 10, y: 20 }],
  ['text',    { x: 10, y: 20, w: 999 }],
  ['table',   { x: 1, y: 2 }],
  ['table',   { x: 1, y: 2, headers: ['A', 'B'], rows: [['1', '2']] }],
  ['table',   { x: 1, y: 2, w: 640 }],
  ['kanban',  { x: 5, y: 6 }],
  ['section', { x: 7, y: 8 }],
  ['section', { x: 7, y: 8, w: 800, h: 600 }],
  ['image',   { x: 9, y: 9 }],
  ['image',   { x: 9, y: 9, w: 400, h: 300 }],
]

for (const [type, args] of cases) {
  const mine = createBlock(type, { id: ID, now: NOW, ...args })
  const theirs = OLD_createBlock(type, args.x, args.y, args.headers, args.rows, args.w, args.h, undefined, ID, NOW)
  const diff = deepEq(mine, theirs)
  const label = `${type}${args.w ? ` w=${args.w}` : ''}${args.h ? ` h=${args.h}` : ''}${args.headers ? ' +data' : ''}`
  ok(!diff, `${label} identical`, diff)
}

// The `w: undefined` case is the sharpest: a table is created with an
// EXPLICIT undefined width so it can size to content. JSON.stringify drops
// that key; deepEq above does not.
const t = createBlock('table', { id: ID, x: 0, y: 0, now: NOW })
ok('w' in t, 'table keeps an explicit `w: undefined` key (not merely absent)')
ok(t.w === undefined, 'table width is undefined, so it sizes to content')

/* patch handling — patch wins over everything, id survives */
console.log('\n createBlock — patch semantics')
const patched = createBlock('text', { id: ID, x: 0, y: 0, now: NOW, patch: { name: 'X', content: '<p>hi</p>', id: 'SHOULD_BE_IGNORED' } })
const patchedOld = OLD_createBlock('text', 0, 0, null, null, null, null, { name: 'X', content: '<p>hi</p>', id: 'SHOULD_BE_IGNORED' }, ID, NOW)
ok(!deepEq(patched, patchedOld), 'patched block identical', deepEq(patched, patchedOld))
ok(patched.id === ID, 'patch cannot overwrite the id')
ok(patched.name === 'X', 'patch overrides a default')

/* ══════════════════════════════════════════════════════════════════════
   2 · blockDims — the two-defaults trap
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n blockDims — fallbacks, which are NOT the create defaults')
for (const type of [...LEGACY_TYPES, 'bogus']) {
  for (const b of [{ type }, { type, w: 111 }, { type, h: 222 }, { type, w: 111, h: 222 }]) {
    const diff = deepEq(blockDims(b), OLD_blockDims(b))
    ok(!diff, `dims ${type}${b.w ? ' w' : ''}${b.h ? ' h' : ''}`, diff)
  }
}
ok(createBlock('text', { id: ID, x: 0, y: 0, now: NOW }).w === 280, 'new text block is 280 wide')
ok(blockDims({ type: 'text' }).w === 320, 'text with no stored width measures 320 — deliberately different from 280')

/* ══════════════════════════════════════════════════════════════════════
   3 · blockHasContent — parity, then the two documented fixes
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n blockHasContent — parity with the old chain')
const sectionId = 'sec_1'
const siblings = [{ id: 'x', parentSectionId: sectionId }]
const contentCases = [
  [{ type: 'text', content: '' }, []],
  [{ type: 'text', content: '<p></p>' }, []],
  [{ type: 'text', content: '<p>  </p>' }, []],
  [{ type: 'text', content: '<p>real</p>' }, []],
  [{ type: 'table', rows: [['', '']] }, []],
  [{ type: 'table', rows: [['', 'x']] }, []],
  [{ type: 'table' }, []],
  [{ type: 'kanban', lanes: [{ cards: [] }] }, []],
  [{ type: 'kanban', lanes: [{ cards: [1] }] }, []],
  [{ type: 'kanban' }, []],
  [{ id: sectionId, type: 'section' }, siblings],
  [{ id: 'sec_2', type: 'section' }, siblings],
  [null, []],
]
for (const [b, all] of contentCases) {
  const mine = blockHasContent(b, all)
  const theirs = OLD_blockHasContent(b, all)
  ok(mine === theirs, `hasContent ${b ? b.type : 'null'} ${JSON.stringify(b?.content ?? b?.rows ?? b?.lanes ?? '')}`.slice(0, 68) + ` → ${mine}`)
}

console.log('\n blockHasContent — intentional behaviour CHANGES (bugs 3 and 4)')
ok(blockHasContent({ type: 'image', imageId: 'img_1' }) === true,
   'FIX: an image with bytes now counts as content (old path: always false, so deleting never warned)')
ok(OLD_blockHasContent({ type: 'image', imageId: 'img_1' }, []) === false,
   '     …confirming the old path really did return false')
ok(blockHasContent({ type: 'image' }) === false, 'an empty image block still deletes without a prompt')

/* ══════════════════════════════════════════════════════════════════════
   4 · clonepatch — bugs 1 and 2
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n clonepatch — duplication')

// The old duplicateSelected, verbatim (NotebookCanvas.js:367).
function OLD_clonepatch(b) {
  const patch = {}
  if (b.w) patch.w = b.w
  if (b.h) patch.h = b.h
  if (b.name) patch.name = b.name + ' (copy)'
  if (b.type === 'text' && b.content) patch.content = b.content
  if (b.type === 'kanban' && b.lanes) patch.lanes = JSON.parse(JSON.stringify(b.lanes))
  return patch
}

const textBlock = { type: 'text', w: 300, h: 200, name: 'Notes', content: '<p>hi</p>' }
ok(!deepEq(clonepatch(textBlock), OLD_clonepatch(textBlock)), 'text duplication unchanged',
   deepEq(clonepatch(textBlock), OLD_clonepatch(textBlock)))

const kanbanBlock = { type: 'kanban', name: 'Board', lanes: [{ id: 'l1', cards: [{ t: 'a' }] }] }
ok(!deepEq(clonepatch(kanbanBlock), OLD_clonepatch(kanbanBlock)), 'kanban duplication unchanged',
   deepEq(clonepatch(kanbanBlock), OLD_clonepatch(kanbanBlock)))
const kp = clonepatch(kanbanBlock)
kp.lanes[0].cards.push({ t: 'b' })
ok(kanbanBlock.lanes[0].cards.length === 1, 'kanban lanes are DEEP copied — editing the copy leaves the original alone')

const img = { type: 'image', w: 360, h: 260, name: 'Chart', imageId: 'img_7', alt: 'A chart', fit: 'cover', natW: 800, natH: 600, rev: 3 }
const ip = clonepatch(img)
ok(ip.imageId === 'img_7', 'FIX bug 1: duplicating an image carries imageId (old path produced an EMPTY image)')
ok(OLD_clonepatch(img).imageId === undefined, '     …confirming the old path really did drop it')
for (const f of ['alt', 'fit', 'natW', 'natH', 'rev']) {
  ok(ip[f] === img[f], `image duplication carries ${f}`)
}

const sec = { type: 'section', w: 500, h: 350, name: 'Q3', sectionColor: '#f87171' }
ok(clonepatch(sec).sectionColor === '#f87171', 'FIX bug 2: duplicating a section keeps its colour')
ok(OLD_clonepatch(sec).sectionColor === undefined, '     …confirming the old path reset it to indigo')

console.log('\n cloneArgs — positional table data')
const tbl = { type: 'table', headers: ['A'], rows: [['1'], ['2']] }
const ca = cloneArgs(tbl)
ca.rows[0][0] = 'MUTATED'
ok(tbl.rows[0][0] === '1', 'cloned rows are a fresh copy per row')
ok(cloneArgs({ type: 'text' }).headers === null, 'non-tables get null headers, as addNotebookBlock expects')

/* ══════════════════════════════════════════════════════════════════════
   5 · registry integrity
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n registry integrity')
ok(LEGACY_TYPES.every(t => BLOCK_TYPE_IDS.includes(t)), 'all five original types still registered')
ok(deepEq(ADD_ITEMS.map(i => i.type).slice(0, 5), LEGACY_TYPES) === null,
   'the original five keep their exact menu order — a new type appends, it does not reshuffle')
/* The ORIGINAL five bindings must not move. A new type may add a key — that's
   the point of the registry — but it must never rebind one people already use.
   Asserting the whole map instead means this file fails every time a type is
   added, which trains you to update it without reading it. */
for (const [key, type] of Object.entries({ n: 'text', t: 'table', k: 'kanban', s: 'section', i: 'image' })) {
  ok(TYPE_BY_KEY[key] === type, `"${key}" still creates a ${type} block`)
}

const orders = BLOCK_TYPE_IDS.map(t => BLOCK_TYPES[t].order)
ok(new Set(orders).size === orders.length, 'no two types claim the same menu position')
const keys = Object.values(BLOCK_TYPES).map(d => d.key).filter(Boolean)
ok(new Set(keys).size === keys.length, 'no two types claim the same shortcut key')

for (const id of LEGACY_TYPES) {
  const d = BLOCK_TYPES[id]
  ok(typeof d.create === 'function' && typeof d.hasContent === 'function' && Array.isArray(d.cloneFields)
     && d.dims && typeof d.dims.w === 'number' && typeof d.dims.h === 'number'
     && typeof d.label === 'string' && typeof d.icon === 'string',
     `${id} declares a complete entry`)
  ok(createBlock(id, { id: ID, x: 0, y: 0, now: NOW }).type === id, `${id}.create stamps the right type`)
}

ok(getType('nonexistent') === BLOCK_TYPES.text, 'an unknown type falls back rather than throwing')
/* 'pdf' used to be the example of a type that doesn't exist. It exists now —
   which is exactly the kind of quiet rot that turns an assertion into a
   tautology, so the example moved to something that genuinely isn't real. */
ok(isKnownType('chart') === false, 'isKnownType is honest about types that do not exist yet')
ok(blockHasContent({ type: 'chart' }) === false, 'an unknown type reports no content instead of crashing')
ok(blockDims({ type: 'chart' }).w === 320, 'an unknown type still gets usable dimensions')
ok(isKnownType('pdf') === true, 'pdf, by contrast, is now a real registered type')

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
