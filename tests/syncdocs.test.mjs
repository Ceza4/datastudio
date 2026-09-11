/*
  tests/syncdocs.test.mjs
  --------------------------------------------------------------------------
  The decisions inside sync (lib/syncdocs.js).

  lib/sync.js itself is timers, network and browser events — the part that can
  only be checked in a real browser, and the part every bug that has reached a
  user in this codebase has lived in. This file covers the half where the
  reasoning is, and it leans on the sequences that lose data if they are wrong:
  a change that arrives while a push is in flight, a folder edited on two
  machines, a document deleted on one of them.
  -------------------------------------------------------------------------- */

import {
  docsFromWorkspace, workspaceFromDocs, dirtyIds, snapshotDocs, assetIdsOf,
  conflictName, mergeFolder, sortForApply, applyPulled, danglingItemIds,
  KIND_NOTEBOOK, KIND_FOLDER, KIND_SHEETFILE,
} from '../lib/syncdocs.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

const nb = (id, name = id, blocks = []) =>
  ({ id, name, sheets: [{ id: `s_${id}`, name: 'Sheet 1', blocks }], activeSheetId: `s_${id}` })
const folder = (id, itemIds = [], extra = {}) =>
  ({ id, name: id, collapsed: false, itemIds, ...extra })

console.log('\n  workspace <-> documents')
{
  const state = { notebooks: [nb('nb1')], folders: [folder('f1', ['nb1'])], files: [{ id: 'file1', name: 'Book.xlsx', sheets: [] }] }
  const docs = docsFromWorkspace(state)
  eq(docs.map(d => d.kind), [KIND_NOTEBOOK, KIND_FOLDER, KIND_SHEETFILE], 'all three lists become documents')
  ok(docs[0].doc === state.notebooks[0], 'the doc is the SAME object, not a copy — a copy would break reference-based change detection')

  const back = workspaceFromDocs(docs.map(d => ({ id: d.id, kind: d.kind, doc: d.doc })))
  eq(back.notebooks.map(n => n.id), ['nb1'], 'notebooks round-trip')
  eq(back.folders.map(f => f.id), ['f1'], 'folders round-trip')
  eq(back.files.map(f => f.id), ['file1'], 'workbooks round-trip')

  /* A row whose primary key disagrees with the id inside its own document is
     a corrupted write. Believing the DOC would give two rows the same local id
     and silently merge two notebooks into one. */
  const odd = workspaceFromDocs([{ id: 'real', kind: KIND_NOTEBOOK, doc: nb('stale') }])
  eq(odd.notebooks[0].id, 'real', 'the ROW id wins over the id inside the document')

  eq(workspaceFromDocs([{ id: 'x', kind: KIND_NOTEBOOK, doc: nb('x'), deleted_at: '2026-01-01' }]).notebooks,
     [], 'a soft-deleted row contributes nothing')
  eq(workspaceFromDocs([{ id: 'x', kind: KIND_NOTEBOOK, doc: null }]).notebooks,
     [], 'a row with no document is skipped rather than crashing the pull')
}

console.log('\n  change detection is by reference')
{
  const a = nb('nb1'), b = nb('nb2')
  const state = { notebooks: [a, b], folders: [], files: [] }
  const first = docsFromWorkspace(state)
  const seen = snapshotDocs(first)

  const unchanged = dirtyIds(seen, docsFromWorkspace({ notebooks: [a, b], folders: [], files: [] }))
  eq(unchanged.changed.length, 0, 'the same objects are not dirty — a pointer compare, no serialisation')

  const edited = { ...a, name: 'renamed' }
  const after = dirtyIds(seen, docsFromWorkspace({ notebooks: [edited, b], folders: [], files: [] }))
  eq(after.changed.map(d => d.id), ['nb1'], 'a replaced object is dirty')
  eq(after.removed, [], 'and nothing is reported as removed')

  const gone = dirtyIds(seen, docsFromWorkspace({ notebooks: [a], folders: [], files: [] }))
  eq(gone.removed, ['nb2'], 'an id that vanished is reported as removed')

  /* The one false positive the design accepts: undo can hand back a
     structurally identical but newly allocated object. One redundant push of
     bytes that match. The inverse error would be a lost edit. */
  const clone = JSON.parse(JSON.stringify(a))
  const same = dirtyIds(seen, docsFromWorkspace({ notebooks: [clone, b], folders: [], files: [] }))
  eq(same.changed.map(d => d.id), ['nb1'], 'an identical-but-new object is treated as dirty — a redundant push, never a lost one')

  eq(dirtyIds(new Map(), first).changed.length, 2, 'an empty baseline marks everything dirty (first sign-in)')
}

console.log('\n  assets a document keeps alive')
{
  const doc = nb('nb1', 'nb1', [
    { id: 'b1', type: 'image', imageId: 'img_a' },
    { id: 'b2', type: 'pdf', pdfId: 'pdf_a' },
    { id: 'b3', type: 'file', fileId: 'file_a' },
    { id: 'b4', type: 'text' },
    { id: 'b5', type: 'image', imageId: 'img_a' },
  ])
  eq(assetIdsOf(doc).sort(), ['file_a', 'img_a', 'pdf_a'], 'every family is found, and a duplicate counts once')
  eq(assetIdsOf({}), [], 'a document with no sheets contributes nothing rather than throwing')
  eq(assetIdsOf({ sheets: [{ blocks: null }] }), [], 'a sheet with no blocks is survivable')
  eq(assetIdsOf(null), [], 'and so is no document at all')
}

console.log('\n  conflict names')
{
  eq(conflictName('Thesis', []), 'Thesis (conflict copy)', 'the first copy is unnumbered')
  eq(conflictName('Thesis', ['Thesis (conflict copy)']), 'Thesis (conflict copy 2)', 'the second is numbered')
  eq(conflictName('Thesis', ['Thesis (conflict copy)', 'Thesis (conflict copy 2)']),
     'Thesis (conflict copy 3)', 'and it keeps counting — two devices apart for a week make more than one')
  eq(conflictName('', []), 'Untitled (conflict copy)', 'an unnamed document still gets a usable name')
}

console.log('\n  folders merge instead of forking')
{
  const ours = folder('f1', ['nb1', 'nb2'], { name: 'Research', collapsed: true })
  const theirs = folder('f1', ['nb2', 'nb3'], { name: 'Reading', collapsed: false })
  const m = mergeFolder(ours, theirs)
  eq(m.itemIds, ['nb1', 'nb2', 'nb3'], 'union, ours first — no membership from either side is lost')
  eq(m.name, 'Research', 'our name wins')
  ok(m.collapsed === true, 'and our collapsed state wins — folders collapsing themselves on a sync is a real, constant annoyance')

  const empty = mergeFolder({ id: 'f1' }, { id: 'f1', itemIds: ['a'] })
  eq(empty.itemIds, ['a'], 'a side with no itemIds contributes none rather than erasing the other')
}

console.log('\n  apply order and the pending guard')
{
  const rows = [
    { id: 'nb1', kind: KIND_NOTEBOOK, doc: nb('nb1'), updated_at: '2026-01-01T00:00:00Z' },
    { id: 'f1', kind: KIND_FOLDER, doc: folder('f1', ['nb1']), updated_at: '2026-01-01T00:00:01Z' },
  ]
  eq(sortForApply(rows).map(r => r.kind), [KIND_FOLDER, KIND_NOTEBOOK],
     'containers are applied before their contents, even though the folder is newer')

  const local = { notebooks: [], folders: [], files: [] }
  const out = applyPulled(local, rows)
  eq(out.notebooks.map(n => n.id), ['nb1'], 'a new notebook arrives')
  eq(out.folders.map(f => f.id), ['f1'], 'and so does its folder')

  /* THE ONE THAT LOSES WORK IF IT IS WRONG. A row we still owe a push for is
     older on the server by definition; applying it would undo the user's last
     few seconds of typing in front of them. */
  const mine = nb('nb1', 'my newer name')
  const guarded = applyPulled({ notebooks: [mine], folders: [], files: [] }, rows, new Set(['nb1']))
  eq(guarded.notebooks[0].name, 'my newer name', 'a document with an unpushed local change is NOT overwritten by the pull')
  eq(guarded.skipped, ['nb1'], 'and it is reported as skipped rather than silently ignored')

  const del = applyPulled({ notebooks: [nb('nb1')], folders: [], files: [] },
    [{ id: 'nb1', kind: KIND_NOTEBOOK, doc: nb('nb1'), deleted_at: '2026-02-02T00:00:00Z' }])
  eq(del.notebooks, [], 'a tombstone removes the local copy')

  const merged = applyPulled(
    { notebooks: [], folders: [folder('f1', ['nb1'], { collapsed: true })], files: [] },
    [{ id: 'f1', kind: KIND_FOLDER, doc: folder('f1', ['nb9']), updated_at: 'z' }])
  eq(merged.folders[0].itemIds, ['nb1', 'nb9'], 'a folder present on both sides merges rather than being replaced')

  const unknown = applyPulled(local, [{ id: 'x', kind: 'template', doc: {}, updated_at: 'z' }])
  eq(unknown.applied, [], 'a kind this workspace does not hold is ignored, not crashed on')
}

console.log('\n  dangling folder members are reported, never repaired')
{
  const d = danglingItemIds({
    folders: [folder('f1', ['nb1', 'ghost'])],
    notebooks: [nb('nb1')],
    files: [],
  })
  eq(d, [{ folderId: 'f1', itemId: 'ghost' }], 'the missing member is found')
  /* Repairing it here is the tempting bug: a pull that arrives folders-first
     would empty every folder on the machine for the second before the
     notebooks land, and a tidy-up would make that second permanent. */
  eq(danglingItemIds({ folders: [folder('f1', ['nb1'])], notebooks: [nb('nb1')], files: [] }), [],
     'nothing dangling, nothing reported')
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
