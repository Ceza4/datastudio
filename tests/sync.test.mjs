/*
  tests/sync.test.mjs
  --------------------------------------------------------------------------
  The push path, against a fake PostgREST (tests/fake-postgrest.mjs).

  The engine's timers, listeners and realtime subscription are NOT covered
  here — they are browser behaviour and belong in tests/browser/. What is
  covered is the part that decides whether somebody keeps their work:

    · the compare-and-set, and what happens when it loses
    · the equality check that stops a clean quit manufacturing a conflict copy
    · folders merging instead of forking
    · a delete being a soft delete, never a destroy
    · first-sign-in adoption, and its refusal to merge two accounts
    · delete-then-undo, which used to leave the row tombstoned and let the
      next pull destroy the restored notebook
    · a second tab's outbox entry, which used to become a tombstone
  -------------------------------------------------------------------------- */

import { createSyncEngine } from '../lib/sync.js'
import { _setStore, getMeta, setMeta, dropMeta, markDirty, listPending, TABLE_DOCS, TABLE_ASSETS, OP_DELETE, OP_UPSERT } from '../lib/outbox.js'
import { fakeClient } from './fake-postgrest.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

function memStore() {
  const data = new Map()
  return {
    available: () => true,
    get: async (s, k) => data.get(`${s}|${k}`),
    set: async (s, k, v) => { data.set(`${s}|${k}`, v) },
    del: async (s, k) => { data.delete(`${s}|${k}`) },
    entries: async s => [...data.entries()].filter(([k]) => k.startsWith(`${s}|`)).map(([k, v]) => [k.slice(s.length + 1), v]),
    clear: async s => { for (const k of [...data.keys()]) if (k.startsWith(`${s}|`)) data.delete(k) },
  }
}

const nb = (id, name = id, blocks = []) =>
  ({ id, name, sheets: [{ id: `s_${id}`, name: 'Sheet 1', blocks }], activeSheetId: `s_${id}` })
const folder = (id, itemIds = [], extra = {}) => ({ id, name: id, collapsed: false, itemIds, ...extra })

/** An engine wired to a workspace object the test can mutate in place. */
function harness(workspace, client = fakeClient()) {
  const applied = []
  const added = []
  const statuses = []
  const engine = createSyncEngine({
    readWorkspace: () => workspace,
    applyRemote: rows => applied.push(...rows),
    addLocalDoc: (kind, doc) => added.push({ kind, doc }),
    onStatus: s => statuses.push(s),
  })
  engine._internals.setClient(client, 'user-a')
  return { engine, client, applied, added, statuses }
}

console.log('\n  first push of a document')
{
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1', 'Thesis')], folders: [], files: [] }
  const { engine, client } = harness(ws)

  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 1 })
  ok(res.ok, 'the insert succeeds')
  const row = client._table('docs').rows.get('nb1')
  eq(row.owner_id, 'user-a', 'owned by the signed-in user')
  eq(row.kind, 'notebook', 'with its kind recorded')
  eq(row.name, 'Thesis', 'and its name')
  ok(row.device_id, 'and the device that wrote it, so "why is my laptop older" is answerable')
  eq((await getMeta(TABLE_DOCS, 'nb1')).rev, 1, 'the revision is remembered for the next compare-and-set')
}

console.log('\n  the compare-and-set')
{
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1', 'Thesis')], folders: [], files: [] }
  const { engine, client } = harness(ws)
  await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 1 })

  ws.notebooks = [nb('nb1', 'Thesis v2')]
  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 2 })
  ok(res.ok && !res.conflicted, 'an uncontested second push just updates')
  eq(client._table('docs').rows.get('nb1').name, 'Thesis v2', 'and the server has the new version')
  eq((await getMeta(TABLE_DOCS, 'nb1')).rev, 2, 'the rev advanced')
}

console.log('\n  losing the race: a conflict copy, never a discard')
{
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1', 'Thesis')], folders: [], files: [] }
  const { engine, client, applied, added } = harness(ws)
  await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 1 })

  /* The other machine writes. Our stored rev is now behind. */
  await client.from('docs').update({ name: 'Thesis (desktop)', doc: nb('nb1', 'Thesis (desktop)') }).eq('id', 'nb1')

  ws.notebooks = [nb('nb1', 'Thesis (laptop)', [{ id: 'b1', type: 'text' }])]
  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 2 })

  ok(res.conflicted, 'the push reports a conflict rather than succeeding quietly')
  eq(client._table('docs').rows.get('nb1').name, 'Thesis (desktop)', 'their version keeps the original id')
  eq(added.length, 1, 'and ours is kept as a new local document')
  ok(added[0].doc.name.startsWith('Thesis (laptop) (conflict copy)'), 'named so it is obvious which is which')
  ok(added[0].doc.id !== 'nb1', 'under a new id')
  eq(added[0].doc.sheets[0].blocks.length, 1, 'carrying our blocks — nothing of ours is discarded')
  ok(client._table('docs').rows.has(added[0].doc.id), 'the copy is pushed too, so the other machine sees it as well')
  eq(applied.map(r => r.id), ['nb1'], 'and their version is handed back to be shown')
}

console.log('\n  the clean-quit case: identical bytes are not a conflict')
{
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1', 'Thesis')], folders: [], files: [] }
  const { engine, client, added } = harness(ws)
  await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 1 })

  /* Exactly what the pagehide keepalive push does: it lands, the server moves
     to the next rev, and the response is never read so our bookkeeping stays
     behind. Without the equality check in resolveConflict, EVERY clean quit
     would manufacture a duplicate of a document nobody else touched. */
  await client.from('docs').update({ doc: ws.notebooks[0], name: 'Thesis' }).eq('id', 'nb1')

  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 2 })
  ok(res.adopted, 'the revision is simply adopted')
  eq(added.length, 0, 'no conflict copy is invented')
  eq((await getMeta(TABLE_DOCS, 'nb1')).rev, client._table('docs').rows.get('nb1').rev, 'and our bookkeeping catches up')
}

console.log('\n  a row already up there, with no local bookkeeping')
{
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1', 'Thesis')], folders: [], files: [] }
  const { engine, client, added } = harness(ws)
  /* Signing out clears syncmeta; signing back in leaves rows on the server we
     have no rev for. The insert hits a duplicate key, which is a bookkeeping
     gap rather than an error. */
  await client.from('docs').insert({ id: 'nb1', owner_id: 'user-a', kind: 'notebook', name: 'Thesis', doc: nb('nb1', 'Thesis') })

  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 1 })
  ok(res.ok, 'the duplicate key is handled')
  eq(added.length, 0, 'and identical content does not fork')
}

console.log('\n  folders merge')
{
  _setStore(memStore())
  const ws = { notebooks: [], folders: [folder('f1', ['nb1'])], files: [] }
  const { engine, client, added, applied } = harness(ws)
  await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'f1', localAt: 1 })

  await client.from('docs').update({ doc: folder('f1', ['nb9']) }).eq('id', 'f1')
  ws.folders = [folder('f1', ['nb1', 'nb2'])]
  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'f1', localAt: 2 })

  ok(res.merged, 'a contested folder merges')
  eq(added.length, 0, 'with no "(conflict copy)" folder — a duplicate folder rescues nothing, it is just clutter')
  eq(client._table('docs').rows.get('f1').doc.itemIds, ['nb1', 'nb2', 'nb9'], 'and every membership from both sides survives')
  eq(applied.length, 1, 'the merged version is shown locally too')
}

console.log('\n  delete is a soft delete')
{
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1')], folders: [], files: [] }
  const { engine, client } = harness(ws)
  await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 1 })

  ws.notebooks = []
  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', op: OP_DELETE, localAt: 2 })
  ok(res.ok, 'the delete pushes')
  const row = client._table('docs').rows.get('nb1')
  ok(row, 'THE ROW IS STILL THERE — the client is not granted a destroy, only a stamp')
  ok(row.deleted_at, 'carrying a deleted_at')
  ok(row.doc, 'and its document, recoverable for 30 days')
  eq(await getMeta(TABLE_DOCS, 'nb1'), null, 'local bookkeeping for it is dropped')

  _setStore(memStore())
  const r2 = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'never-pushed', op: OP_DELETE, localAt: 1 })
  ok(r2.noop, 'deleting something that was never synced is a no-op, not a request')
}

console.log('\n  first sign-in adoption')
{
  _setStore(memStore())
  const ws = {
    notebooks: [nb('nb1', 'Thesis', [{ id: 'b1', type: 'text' }])],
    folders: [folder('f1', ['nb1'])],
    files: [],
  }
  const { engine, client } = harness(ws)
  const res = await engine.adoptLocalWorkspace()
  ok(res.ok, 'adoption runs')
  ok(client._table('docs').rows.has('nb1'), 'the local notebook is uploaded without being asked about — an empty workspace after signing in looks exactly like the app losing your work')
  ok(client._table('docs').rows.has('f1'), 'and its folder')

  /* A shared machine: someone else signs in on a computer that already has a
     workspace on it. Merging two people's work is the failure this guards. */
  _setStore(memStore())   // a fresh machine, no bookkeeping from the run above
  const other = fakeClient()
  await other.from('docs').insert({ id: 'theirs', owner_id: 'user-a', kind: 'notebook', name: 'Theirs', doc: nb('theirs') })
  const h2 = harness(ws, other)
  const res2 = await h2.engine.adoptLocalWorkspace()
  eq(res2.reason, 'account-not-empty', 'an account that already has documents is never adopted into')
  ok(!other._table('docs').rows.has('nb1'), 'and nothing local is uploaded to it')
}

console.log('\n  a first-run empty notebook is not "work"')
{
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1', 'My Project')], folders: [], files: [] }
  const { engine, client } = harness(ws)
  const res = await engine.adoptLocalWorkspace()
  eq(res.reason, 'nothing-to-adopt', 'a single blank notebook is what a first run creates on its own, not something the user made')
  eq(client._table('docs').rows.size, 0, 'so nothing is uploaded')
}

console.log('\n  the drain reports honestly')
{
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1')], folders: [], files: [] }
  const { engine, statuses } = harness(ws)
  await markDirty(TABLE_DOCS, 'nb1', { kind: 'notebook', localAt: 1 })
  await engine._internals.drain()
  const last = statuses[statuses.length - 1]
  eq(last.state, 'synced', 'an empty queue reports synced')
  eq(last.pending, 0, 'with nothing pending')
  eq((await listPending()).length, 0, 'and the outbox is empty')
}

console.log('\n  delete, then undo')
{
  /* THE BUG THIS LOCKS DOWN.

     A soft delete does not clear `doc`, so a tombstoned row still holds the
     bytes it had when it died. resolveConflict compared documents and could
     not tell "the server already has ours" from "the server has ours under a
     headstone" — it answered `adopted` to both, cleared the outbox entry and
     reported success. The row stayed tombstoned; the next pull read it as a
     deletion from another device and removed the notebook locally; the
     autosave wrote that away. Thirty days later the collector made it
     permanent.

     Four keystrokes: Delete, Ctrl+Z. */
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1', 'Thesis')], folders: [], files: [] }
  const { engine, client } = harness(ws)

  await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 1 })

  // 1. delete it
  await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 2, op: OP_DELETE })
  ok(client._table('docs').rows.get('nb1').deleted_at, 'the delete writes a tombstone rather than destroying the row')
  ok(!(await getMeta(TABLE_DOCS, 'nb1'))?.rev, 'and forgets the revision, so a restore arrives as an insert')

  // 2. undo — the same object comes back, byte-identical
  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'nb1', localAt: 3 })
  ok(res.ok, 'the restore push reports success')
  const row = client._table('docs').rows.get('nb1')
  ok(!row.deleted_at,
     'AND THE ROW IS ALIVE AGAIN. This is the assertion: `ok: true` was never the problem, a cheerful ok on a still-tombstoned row was')
  eq(row.doc.name, 'Thesis', 'with the document intact')
  ok((await getMeta(TABLE_DOCS, 'nb1')).rev >= 2, 'and a revision recorded, so the next edit compare-and-sets against the live row')
}

console.log('\n  a document this tab has never heard of')
{
  /* Two tabs share one IndexedDB outbox and each runs its own engine over its
     own workspace. Tab 2 creates a notebook; Tab 1 goes hidden, flushes, and
     finds an entry naming an id its workspace does not contain.

     `!local` used to mean "deleted". So Tab 1 either threw away the push
     intent for a document that then existed only in IndexedDB — with the chip
     reading Synced — or, if the id had synced before, wrote a tombstone for a
     notebook somebody was typing into next door. */
  _setStore(memStore())
  const ws = { notebooks: [nb('mine')], folders: [], files: [] }
  const { engine, client } = harness(ws)

  const res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'theirs', localAt: 1, op: OP_UPSERT })
  ok(!res.ok && res.retry, 'an upsert this tab cannot see is retried, not resolved')
  eq(res.reason, 'not-in-this-tab', 'and says why')
  eq(client._table('docs').rows.size, 0, 'nothing is written')

  /* The same id, once it HAS been synced, must not be tombstoned either. */
  client._table('docs').rows.set('theirs', {
    id: 'theirs', owner_id: 'user-a', kind: 'notebook', name: 'Theirs',
    doc: nb('theirs'), rev: 4, deleted_at: null, updated_at: client._table('docs').stamp(),
  })
  await setMeta(TABLE_DOCS, 'theirs', { rev: 4 })
  const res2 = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'theirs', localAt: 2, op: OP_UPSERT })
  ok(!res2.ok && res2.retry, 'and a synced document is left alone too')
  ok(!client._table('docs').rows.get('theirs').deleted_at,
     'THE ROW IS NOT TOMBSTONED — this is the one that deleted another tab\'s live notebook')

  /* An explicit delete still deletes. The guard must not have disarmed it. */
  const res3 = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'theirs', localAt: 3, op: OP_DELETE })
  ok(res3.ok, 'an explicit OP_DELETE still succeeds')
  ok(client._table('docs').rows.get('theirs').deleted_at, 'and still writes the tombstone')
}

console.log('\n  ...and it gives up eventually, without deleting anything')
{
  /* THE FIRST VERSION OF THAT GUARD NEVER TERMINATED, and that is its own
     bug: an entry naming a document no tab has — deleted before its debounce
     drained, a stale entry from an older session — retried forever, and the
     chip sat on "1 waiting" with nothing the user could do about it.

     The resolution has to be non-destructive in BOTH directions. The original
     code resolved this case by writing a tombstone, which is how it could
     destroy a notebook open in another tab. Abandoning drops the local intent
     and leaves the server row exactly as it is. */
  _setStore(memStore())
  const ws = { notebooks: [nb('mine')], folders: [], files: [] }
  const { engine, client } = harness(ws)

  client._table('docs').rows.set('ghost', {
    id: 'ghost', owner_id: 'user-a', kind: 'notebook', name: 'Still on the server',
    doc: nb('ghost'), rev: 7, deleted_at: null, updated_at: client._table('docs').stamp(),
  })
  await setMeta(TABLE_DOCS, 'ghost', { rev: 7 })

  let res = null
  for (let attempts = 0; attempts < 6; attempts++) {
    res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'ghost', localAt: 1, op: OP_UPSERT, attempts })
    if (attempts < 6) ok(!res.ok && res.retry, `attempt ${attempts} still waits for the tab that has it`)
  }
  res = await engine._internals.pushDoc({ table: TABLE_DOCS, id: 'ghost', localAt: 1, op: OP_UPSERT, attempts: 6 })
  ok(res.ok, 'by the seventh attempt the intent is abandoned so the queue can drain')
  eq(res.reason, 'abandoned', 'and says so, rather than reporting a push that did not happen')

  const row = client._table('docs').rows.get('ghost')
  ok(row && !row.deleted_at,
     'THE SERVER ROW IS UNTOUCHED — abandoning a push we cannot perform must never delete a document we never had')
  eq(row.rev, 7, 'not even a revision bump')
}

console.log('\n  retiring an asset goes through the queue')
{
  /* It used to be a bare network call fired from the autosave, with a
     `.catch(() => {})` and a comment calling failure "a billing annoyance:
     bytes linger until the next delete of the same id". There is no next
     delete of the same id — the local blob is already gone, so that id can
     never be in a keep-set again. One offline moment leaked the object
     permanently and left the row billing forever. */
  _setStore(memStore())
  const ws = { notebooks: [nb('nb1')], folders: [], files: [] }
  const { engine } = harness(ws)

  engine.retireAssets(['img_a', 'pdf_b'])
  await new Promise(r => setTimeout(r, 10))

  const queued = (await listPending()).filter(e => e.table === TABLE_ASSETS)
  eq(queued.length, 2, 'both ids are queued')
  eq(queued.every(e => e.op === OP_DELETE), true, 'as deletions')
  ok(queued.every(e => e.localAt > 0), 'with a timestamp, so a later edit of the same id can outrank them')
}

_setStore(null)
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
