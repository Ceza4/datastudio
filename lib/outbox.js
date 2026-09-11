/*
  lib/outbox.js
  --------------------------------------------------------------------------
  The answer to "what if they just quit?"

  The local write is authoritative and lands in IndexedDB ~600ms after you
  stop typing. The cloud push is debounced 2s behind that. There is therefore
  ALWAYS a window in which an edit exists on this disk and not in Postgres,
  and no amount of tuning removes it — it can only be made short and made
  recoverable.

  An in-memory queue makes it short and not recoverable: kill the tab and the
  queue is gone, so that edit is stranded on one machine until something else
  happens to touch the same notebook. A row in IndexedDB makes it both. The
  outbox is written in the same beat as the local save, survives a crash, a
  reboot and a month offline, and drains on the next launch.

  WHAT IT STORES: AN INTENT, NEVER A COPY

  A row says "notebook nb_… is dirty as of local time T". It does not hold the
  document. Holding a copy would double the write cost of every keystroke, and
  — much worse — that copy could go stale against the real row in `state`, at
  which point the queue would faithfully push an older version over a newer
  one. The document is always read fresh at push time.

  WHAT IT IS NOT

  It is not a log and it is not ordered. One entry per object, coalescing:
  editing a notebook forty times leaves one row, because the fortieth push
  sends the same bytes the first thirty-nine would have converged on. Sync is
  last-write-wins per document (backend plan §3), so replaying intermediate
  states would be work that changes nothing.
  -------------------------------------------------------------------------- */

import {
  STORE_OUTBOX, STORE_SYNCMETA,
  idbGet, idbSet, idbDelete, idbEntries, idbClear, idbAvailable,
} from './idb.js'

/* ── the store, behind one indirection ────────────────────────────────────

   Every function below goes through `db` rather than calling idbGet/idbSet
   directly, so a test can substitute an in-memory map. This is the same seam
   lib/auth.js uses for the Supabase client, and for the same reason: the
   logic that matters here — coalescing, the changed-in-flight check, backoff
   — is exactly the logic that cannot be exercised in Node otherwise, and it
   is also the logic that loses somebody's afternoon if it is wrong.

   The alternative was to test only the pure helpers and take the rest on
   faith. `clearIfUnchanged` is not something to take on faith. */
let db = {
  available: idbAvailable,
  get: idbGet,
  set: idbSet,
  del: idbDelete,
  entries: idbEntries,
  clear: idbClear,
}

/** Test seam. Pass nothing to restore the real IndexedDB. */
export function _setStore(fake) {
  db = fake || {
    available: idbAvailable, get: idbGet, set: idbSet,
    del: idbDelete, entries: idbEntries, clear: idbClear,
  }
}

/** Tables the outbox knows how to push. Kept as a set so a typo fails here. */
export const TABLE_DOCS = 'docs'
export const TABLE_ASSETS = 'assets'
export const TABLE_PREFS = 'prefs'
const TABLES = new Set([TABLE_DOCS, TABLE_ASSETS, TABLE_PREFS])

export const OP_UPSERT = 'upsert'
export const OP_DELETE = 'delete'

/* Keyed `${table}:${id}` rather than by id alone. Notebooks, folders,
   workbooks and templates all mint their own ids into one `docs` table, and
   assets mint theirs separately — a bare id would let an asset collide with a
   document the first time someone reuses a uuid, and the collision would
   silently push one over the other. */
export const outboxKey = (table, id) => `${table}:${id}`

/** Split a key back apart. `id` may itself contain ':' — only the first splits. */
export function parseKey(key) {
  const at = String(key).indexOf(':')
  if (at < 0) return { table: null, id: String(key) }
  return { table: key.slice(0, at), id: key.slice(at + 1) }
}

/* Retry backoff. Doubling from 2s, capped at five minutes.

   The cap matters more than the curve. Uncapped exponential backoff reaches
   hours, and a laptop that was offline over a weekend would then sit there
   with the network back and refuse to try for another four hours — which
   presents to the user as "sync is broken" and to us as a bug report with no
   error in it. Five minutes is short enough that the worst case is invisible.

   Jitter is ±25%. Without it, twenty documents queued during one outage all
   retry on exactly the same millisecond, which is how a recovering backend
   gets knocked over by its own clients. */
export const RETRY_BASE_MS = 2000
export const RETRY_MAX_MS = 5 * 60 * 1000

export function backoffMs(attempts, rand = Math.random) {
  const raw = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS)
  const jitter = raw * 0.25 * (rand() * 2 - 1)
  return Math.max(500, Math.round(raw + jitter))
}

/**
 * Record that something needs pushing. Idempotent and coalescing.
 *
 * `localAt` is the caller's timestamp for the change, and it is the whole
 * concurrency story of this file — see `clearIfUnchanged`. Defaulting it to
 * Date.now() here rather than requiring it would let a caller accidentally
 * stamp the entry AFTER the change it describes, which is the one ordering
 * that loses data.
 */
export async function markDirty(table, id, { kind = null, docId = null, op = OP_UPSERT, localAt = Date.now(), orphanPath = null } = {}) {
  if (!db.available()) return { ok: false, reason: 'no-idb' }
  if (!TABLES.has(table)) throw new Error(`outbox: unknown table "${table}"`)
  if (!id) throw new Error('outbox: id is required')
  const key = outboxKey(table, id)
  try {
    const prev = await db.get(STORE_OUTBOX, key)
    /* A pending DELETE is not downgraded by a later UPSERT of the same id.

       That sounds backwards until you look at how it happens: a notebook is
       deleted (op=delete queued), then an undo restores it, then it is edited.
       The restore is itself an upsert, so the delete must yield — but only
       because a NEWER localAt says so, never because upsert is "stronger".
       Comparing timestamps rather than op precedence is what makes the
       delete-then-undo and the undo-then-delete cases both come out right. */
    const next = {
      table,
      id,
      kind: kind ?? prev?.kind ?? null,
      /* Assets only: which document keeps this blob alive, so the manifest row
         can point back at it. Never overwritten with null by a later mark — a
         second reference from a doc we happen not to know about must not erase
         the one we do. */
      docId: docId ?? prev?.docId ?? null,
      /* Assets only: an object that reached Storage while its manifest row did
         not. Kept here rather than in memory because it is precisely the
         crash-and-quit case that loses it, and once lost the bytes cannot be
         named by anything — no code in this app enumerates the bucket, so an
         object with no row is invisible to every sweeper there is. Sticky for
         the same reason docId is: a later mark that does not know about the
         orphan must not erase the one that does. */
      orphanPath: orphanPath ?? prev?.orphanPath ?? null,
      op: !prev || localAt >= (prev.localAt || 0) ? op : prev.op,
      localAt: Math.max(localAt, prev?.localAt || 0),
      attempts: prev?.attempts || 0,
      /* A fresh edit clears the backoff. Someone who just typed something is
         watching, and making them wait out a five-minute penalty earned by an
         earlier failure is the wrong side of the trade. */
      nextAttemptAt: 0,
      lastError: prev?.lastError || null,
    }
    await db.set(STORE_OUTBOX, key, next)
    return { ok: true, entry: next }
  } catch (err) {
    /* The local save already succeeded; failing to record the intent means
       this change syncs late (on the next full reconcile), not that it is
       lost. Never throw from here into a save path. */
    return { ok: false, reason: 'write-failed', error: err?.message }
  }
}

/** Everything owed, oldest change first. */
export async function listPending() {
  if (!db.available()) return []
  try {
    const rows = await db.entries(STORE_OUTBOX)
    return rows
      .map(([key, v]) => ({ key, ...v }))
      .filter(v => v && v.table && v.id)
      .sort((a, b) => (a.localAt || 0) - (b.localAt || 0))
  } catch { return [] }
}

/** Everything owed that is not still inside its backoff window. */
export async function listDue(now = Date.now()) {
  const all = await listPending()
  return all.filter(e => (e.nextAttemptAt || 0) <= now)
}

export async function pendingCount() {
  if (!db.available()) return 0
  try { return (await db.entries(STORE_OUTBOX)).length } catch { return 0 }
}

/**
 * A push succeeded. Remove the entry — UNLESS the object changed again while
 * the request was in flight.
 *
 * THIS IS THE ONE FUNCTION IN THE FILE THAT CAN LOSE WORK IF IT IS WRONG.
 * Sequence: push starts at T1 carrying the document as it was; the user types
 * at T2; the push returns 200. Deleting the entry unconditionally at that
 * point discards the T2 edit from the queue, and since the outbox is the only
 * record that anything is owed, that edit never reaches the cloud at all —
 * silently, and looking exactly like success.
 *
 * So the caller passes the localAt it actually pushed, and the entry survives
 * if the stored one has moved on.
 */
export async function clearIfUnchanged(table, id, pushedLocalAt) {
  if (!db.available()) return { cleared: false }
  const key = outboxKey(table, id)
  try {
    const cur = await db.get(STORE_OUTBOX, key)
    if (!cur) return { cleared: true }
    if ((cur.localAt || 0) > pushedLocalAt) {
      /* Still dirty, but no longer failing — reset the attempt counter so the
         next drain treats it as new work rather than as a retry. */
      await db.set(STORE_OUTBOX, key, { ...cur, attempts: 0, nextAttemptAt: 0, lastError: null })
      return { cleared: false, reason: 'changed-in-flight' }
    }
    await db.del(STORE_OUTBOX, key)
    return { cleared: true }
  } catch (err) {
    return { cleared: false, error: err?.message }
  }
}

/** A push failed. Count it, schedule the retry, keep the reason. */
export async function recordFailure(table, id, error, now = Date.now(), rand = Math.random) {
  if (!db.available()) return null
  const key = outboxKey(table, id)
  try {
    const cur = await db.get(STORE_OUTBOX, key)
    if (!cur) return null
    const attempts = (cur.attempts || 0) + 1
    const next = {
      ...cur,
      attempts,
      nextAttemptAt: now + backoffMs(attempts, rand),
      /* The message is kept VERBATIM. lib/auth.js learned this one already:
         an unmapped error hidden behind "sync failed" is a gap in the
         translation list that survives to the next release. */
      lastError: String(error?.message || error || 'unknown'),
    }
    await db.set(STORE_OUTBOX, key, next)
    return next
  } catch { return null }
}

/* ── what we know about the remote ────────────────────────────────────────

   Kept in its own store because it has the opposite lifetime to an outbox
   entry: an outbox row exists only while something is owed, a syncmeta row
   lives as long as the document does. Merging them would mean losing the rev
   the instant a push succeeded — and the rev is exactly what the NEXT
   compare-and-set needs. */

/** `{ rev, pushedAt, pulledAt, remoteDeleted }` or null if never synced. */
export async function getMeta(table, id) {
  if (!db.available()) return null
  try { return (await db.get(STORE_SYNCMETA, outboxKey(table, id))) || null } catch { return null }
}

export async function setMeta(table, id, patch) {
  if (!db.available()) return null
  const key = outboxKey(table, id)
  try {
    const cur = (await db.get(STORE_SYNCMETA, key)) || {}
    const next = { ...cur, ...patch }
    await db.set(STORE_SYNCMETA, key, next)
    return next
  } catch { return null }
}

export async function allMeta() {
  if (!db.available()) return new Map()
  try { return new Map(await db.entries(STORE_SYNCMETA)) } catch { return new Map() }
}

export async function dropMeta(table, id) {
  if (!db.available()) return
  try { await db.del(STORE_SYNCMETA, outboxKey(table, id)) } catch { /* already gone */ }
}

/* ── the account boundary ─────────────────────────────────────────────────

   Signing out, or signing in as someone else, must leave nothing behind.
   Both stores describe one account's relationship to one remote: a rev from
   account A is meaningless against account B's rows, and an outbox entry from
   A would push A's notebook into B's cloud on the first drain after the
   switch. That is a data leak between accounts on a shared machine, which is
   the same failure app/app/page.js already guards against for local assets.

   The LOCAL WORKSPACE IS NOT TOUCHED. Sign-out removes the sync bookkeeping,
   never the work — the app keeps opening to exactly what was on screen. */
export async function clearSyncState() {
  if (!db.available()) return
  try { await db.clear(STORE_OUTBOX) } catch { /* nothing to clear */ }
  try { await db.clear(STORE_SYNCMETA) } catch { /* nothing to clear */ }
}

/* Where the last pull got to, so the next one asks for "changed since" rather
   than dragging every document down on every focus. Stored under a reserved
   key in the meta store — reserved because ':' cannot appear before the first
   colon of a real key, and `__cursor` has no table prefix. */
const CURSOR_KEY = '__cursor'

export async function getCursor() {
  if (!db.available()) return null
  try { return (await db.get(STORE_SYNCMETA, CURSOR_KEY)) || null } catch { return null }
}

export async function setCursor(value) {
  if (!db.available()) return
  try { await db.set(STORE_SYNCMETA, CURSOR_KEY, value) } catch { /* next pull re-reads everything */ }
}

export { CURSOR_KEY }
