/*
  tests/outbox.test.mjs
  --------------------------------------------------------------------------
  The crash-proof push queue (lib/outbox.js).

  This is the file that answers "what if they just quit?", so it is tested the
  way undo is: on the awkward sequences rather than the happy path. The one
  that matters most is `clearIfUnchanged` — a push that succeeds while the user
  keeps typing must NOT clear the entry, because the outbox is the only record
  that anything is owed and dropping it loses that edit silently, looking
  exactly like success.
  -------------------------------------------------------------------------- */

import {
  _setStore, markDirty, listPending, listDue, pendingCount, clearIfUnchanged,
  recordFailure, backoffMs, outboxKey, parseKey, getMeta, setMeta, allMeta,
  dropMeta, clearSyncState, getCursor, setCursor,
  TABLE_DOCS, TABLE_ASSETS, OP_UPSERT, OP_DELETE, RETRY_MAX_MS, RETRY_BASE_MS,
} from '../lib/outbox.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

/* An in-memory stand-in for IndexedDB. Deliberately dumb: it is here to let
   the LOGIC be tested, not to model IndexedDB's semantics. */
function memStore({ available = true, failWrites = false } = {}) {
  const data = new Map()
  const s = {
    available: () => available,
    get: async (store, key) => data.get(`${store}|${key}`),
    set: async (store, key, value) => {
      if (failWrites) throw new Error('disk full')
      data.set(`${store}|${key}`, value)
    },
    del: async (store, key) => { data.delete(`${store}|${key}`) },
    entries: async store => [...data.entries()]
      .filter(([k]) => k.startsWith(`${store}|`))
      .map(([k, v]) => [k.slice(store.length + 1), v]),
    clear: async store => {
      for (const k of [...data.keys()]) if (k.startsWith(`${store}|`)) data.delete(k)
    },
    _data: data,
  }
  return s
}

console.log('\n  keys')
{
  eq(outboxKey('docs', 'nb_1'), 'docs:nb_1', 'the table leads')
  eq(parseKey('docs:nb_1'), { table: 'docs', id: 'nb_1' }, 'and splits back off')
  /* Ids can contain colons in principle. Only the FIRST one separates, or an
     id with a colon would be parsed as a table nobody has. */
  eq(parseKey('docs:a:b'), { table: 'docs', id: 'a:b' }, 'only the first colon separates')
  eq(parseKey('bare'), { table: null, id: 'bare' }, 'a key with no table is reported as such rather than guessed at')
}

console.log('\n  backoff')
{
  const half = () => 0.5   // no jitter
  eq(backoffMs(1, half), RETRY_BASE_MS, 'the first retry waits the base delay')
  eq(backoffMs(2, half), 4000, 'and doubles')
  eq(backoffMs(20, half), RETRY_MAX_MS, 'capped at five minutes — an uncapped curve reaches hours, and a laptop back online after a weekend would refuse to try')
  ok(backoffMs(3, () => 0) < backoffMs(3, () => 1), 'jitter spreads retries so twenty queued documents do not all fire on the same millisecond')
  ok(backoffMs(1, () => 0) >= 500, 'and never collapses to zero')
}

console.log('\n  marking dirty')
{
  _setStore(memStore())
  await markDirty(TABLE_DOCS, 'nb1', { kind: 'notebook', localAt: 1000 })
  await markDirty(TABLE_DOCS, 'nb1', { kind: 'notebook', localAt: 2000 })
  await markDirty(TABLE_DOCS, 'nb1', { kind: 'notebook', localAt: 3000 })
  const p = await listPending()
  eq(p.length, 1, 'forty edits to one notebook leave ONE entry — sync is last-write-wins, so replaying the middle states would be work that changes nothing')
  eq(p[0].localAt, 3000, 'and it carries the newest local time')

  await markDirty(TABLE_ASSETS, 'img_1', { docId: 'nb1', localAt: 1500 })
  const all = await listPending()
  eq([...all.map(e => e.key)].sort(), ['assets:img_1', 'docs:nb1'], 'documents and assets are separate entries')
  eq(all.find(e => e.table === TABLE_ASSETS).docId, 'nb1', 'an asset remembers which document keeps it alive')
  eq(await pendingCount(), 2, 'and the count agrees')
}

console.log('\n  delete then undo, and undo then delete')
{
  _setStore(memStore())
  await markDirty(TABLE_DOCS, 'nb1', { op: OP_DELETE, localAt: 1000 })
  await markDirty(TABLE_DOCS, 'nb1', { op: OP_UPSERT, localAt: 2000 })
  eq((await listPending())[0].op, OP_UPSERT, 'a NEWER upsert (an undo of the delete) wins')

  _setStore(memStore())
  await markDirty(TABLE_DOCS, 'nb1', { op: OP_UPSERT, localAt: 2000 })
  await markDirty(TABLE_DOCS, 'nb1', { op: OP_DELETE, localAt: 3000 })
  eq((await listPending())[0].op, OP_DELETE, 'and a newer delete wins too — the rule is the timestamp, never which op is "stronger"')

  _setStore(memStore())
  await markDirty(TABLE_DOCS, 'nb1', { op: OP_DELETE, localAt: 3000 })
  await markDirty(TABLE_DOCS, 'nb1', { op: OP_UPSERT, localAt: 1000 })
  eq((await listPending())[0].op, OP_DELETE, 'an out-of-order older mark does not downgrade it')
  eq((await listPending())[0].localAt, 3000, 'and the timestamp does not go backwards')
}

console.log('\n  clearing after a push — the one that can lose work')
{
  _setStore(memStore())
  await markDirty(TABLE_DOCS, 'nb1', { localAt: 1000 })
  const clean = await clearIfUnchanged(TABLE_DOCS, 'nb1', 1000)
  ok(clean.cleared, 'a push of the current version clears the entry')
  eq(await pendingCount(), 0, 'and the queue empties')

  /* The sequence: push starts at T1 carrying the document as it was, the user
     types at T2, the push returns 200. Clearing unconditionally would drop the
     T2 edit from the only record that it is owed. */
  await markDirty(TABLE_DOCS, 'nb2', { localAt: 1000 })
  await markDirty(TABLE_DOCS, 'nb2', { localAt: 5000 })   // typed while in flight
  const held = await clearIfUnchanged(TABLE_DOCS, 'nb2', 1000)
  ok(!held.cleared, 'a push that landed AFTER a newer edit does not clear it')
  eq(held.reason, 'changed-in-flight', 'and says why')
  eq(await pendingCount(), 1, 'the edit is still owed')
  eq((await listPending())[0].attempts, 0, 'and its attempt counter is reset — it is new work, not a retry')

  eq((await clearIfUnchanged(TABLE_DOCS, 'nothing', 1)).cleared, true,
     'clearing an entry that is already gone is a success, not an error')
}

console.log('\n  failures and the due list')
{
  const store = memStore()
  _setStore(store)
  await markDirty(TABLE_DOCS, 'nb1', { localAt: 1000 })
  const f1 = await recordFailure(TABLE_DOCS, 'nb1', new Error('502 upstream'), 10_000, () => 0.5)
  eq(f1.attempts, 1, 'the attempt is counted')
  eq(f1.lastError, '502 upstream', 'and the message is kept VERBATIM — an unmapped error behind "sync failed" is a gap that survives to the next release')
  eq(f1.nextAttemptAt, 10_000 + RETRY_BASE_MS, 'with a retry scheduled')

  eq((await listDue(10_500)).length, 0, 'it is not due inside the backoff window')
  eq((await listDue(20_000)).length, 1, 'and is due once the window passes')

  /* A fresh edit clears the penalty: someone who just typed is watching, and
     making them wait out a five-minute delay earned earlier is the wrong side
     of the trade. */
  await markDirty(TABLE_DOCS, 'nb1', { localAt: 11_000 })
  eq((await listDue(11_001)).length, 1, 'a new edit makes it due immediately again')

  eq(await recordFailure(TABLE_DOCS, 'ghost', new Error('x')), null,
     'recording a failure for an entry that is gone is a no-op')
}

console.log('\n  remote bookkeeping')
{
  _setStore(memStore())
  eq(await getMeta(TABLE_DOCS, 'nb1'), null, 'nothing known about a document never synced')
  await setMeta(TABLE_DOCS, 'nb1', { rev: 4, pushedAt: 1 })
  await setMeta(TABLE_DOCS, 'nb1', { pulledAt: 2 })
  eq(await getMeta(TABLE_DOCS, 'nb1'), { rev: 4, pushedAt: 1, pulledAt: 2 },
     'setMeta merges rather than replaces — losing the rev on a pull would break the next compare-and-set')

  await setCursor('2026-08-25T10:00:00Z')
  eq(await getCursor(), '2026-08-25T10:00:00Z', 'the pull cursor round-trips')

  await dropMeta(TABLE_DOCS, 'nb1')
  eq(await getMeta(TABLE_DOCS, 'nb1'), null, 'and can be dropped')
}

console.log('\n  the account boundary')
{
  _setStore(memStore())
  await markDirty(TABLE_DOCS, 'nb1', { localAt: 1 })
  await setMeta(TABLE_DOCS, 'nb1', { rev: 9 })
  await setCursor('x')
  await clearSyncState()
  eq(await pendingCount(), 0, 'signing out drops the queue — an entry from account A would push A\'s notebook into B\'s cloud on the first drain')
  eq(await getMeta(TABLE_DOCS, 'nb1'), null, 'and the revisions, which mean nothing against another account')
  eq(await getCursor(), null, 'and the cursor')
}

console.log('\n  degrading without IndexedDB')
{
  _setStore(memStore({ available: false }))
  eq(await markDirty(TABLE_DOCS, 'nb1'), { ok: false, reason: 'no-idb' }, 'private mode reports rather than throws')
  eq(await listPending(), [], 'and everything else answers empty')
  eq(await pendingCount(), 0, 'including the count')
  eq(await getMeta(TABLE_DOCS, 'nb1'), null, 'and the metadata')

  _setStore(memStore({ failWrites: true }))
  const r = await markDirty(TABLE_DOCS, 'nb1')
  eq(r.ok, false, 'a failed write is reported')
  eq(r.reason, 'write-failed', 'with a distinct reason')
  /* The local save already succeeded. Failing to record the intent means this
     change syncs LATE, not that it is lost — so this must never throw into a
     save path. */
  ok(true, 'and never throws into the caller')
}

console.log('\n  unknown tables fail loudly')
{
  _setStore(memStore())
  let threw = false
  try { await markDirty('nonsense', 'x') } catch { threw = true }
  ok(threw, 'a typo in the table name is a programming error, not a runtime state')
}

_setStore(null)
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
