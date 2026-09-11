/*
  lib/sync.js
  --------------------------------------------------------------------------
  The sync engine. Push, pull, conflicts, assets, prefs, status.

  THE ONE ARCHITECTURAL RULE (backend plan §1, unchanged)

      IndexedDB stays the source of truth. Supabase is a replica.

  This is a SYNC layer, not a storage layer. Nothing in this file is ever on
  the path between a keystroke and the screen, and nothing here can make an
  edit wait. A failed sync is a banner; a failed local save is an emergency,
  and that is persistence.js's problem, not this file's.

  THE DURABILITY STORY, WRITTEN OUT, BECAUSE IT IS THE WHOLE POINT

  edit -> React state -> IndexedDB (600ms, authoritative)
                            |
                            +-> outbox row written in the same beat
                            |
                            +-> cloud push (2s after the last edit, 10s max
                                under continuous typing, IMMEDIATELY when the
                                tab is hidden)

  "What if they just quit?" There is always a window in which an edit is on
  this disk and not in Postgres. It cannot be removed, only made short and
  made recoverable:

    · short — 2s normally, and the flush on `visibilitychange -> hidden`
      catches the realistic case, because people switch away or minimise
      before they quit. A `pagehide` last gasp with fetch(keepalive) covers
      the rest, for documents small enough for the browser's 64KB limit.
    · recoverable — the outbox is a row in IndexedDB, not an array in memory.
      A crash, a reboot, a month offline: the entry is still there and drains
      on the next launch.

  What is NOT promised, said plainly: edit, kill the browser one second later,
  and never open that machine again, and those two seconds exist only on that
  disk. No local-first system solves that one. Dropbox has this window too.

  CONFLICTS: LAST-WRITE-WINS PER DOCUMENT, WITH A COPY. NOT CRDTs.

  CRDTs are the right answer for SIMULTANEOUS multi-user editing. That is not
  the situation — it is one person on a laptop and a desktop, editing at
  different times. LWW plus a safety net is this file; a CRDT is a rewrite of
  how every block mutates. The rule that matters is that no branch here throws
  away work without saying so. A duplicated notebook is annoying. A silently
  lost afternoon is fatal.
  -------------------------------------------------------------------------- */

import { getSupabase, supabaseConfig } from './supabaseClient.js'
import { getSession, onAuthChange } from './auth.js'
import { newId, deviceId } from './ids.js'
import {
  docsFromWorkspace, dirtyIds, snapshotDocs, assetIdsOf, conflictName,
  mergeFolder, KIND_FOLDER, KIND_NOTEBOOK,
} from './syncdocs.js'
import {
  markDirty, listDue, listPending, pendingCount, clearIfUnchanged, recordFailure,
  getMeta, setMeta, dropMeta, clearSyncState, getCursor, setCursor,
  TABLE_DOCS, TABLE_ASSETS, TABLE_PREFS, OP_UPSERT, OP_DELETE,
} from './outbox.js'
import { uploadAsset, downloadAsset, localAsset, collectRemote, collectRemoteDocs, reclaimOrphan, tombstoneAssets, UP_OK, UP_ALREADY, UP_DEDUPED, UP_MISSING, UP_QUOTA, UP_UNCONFIGURED, DOWN_FAILED } from './cloudassets.js'
import { refreshAccount, setAccount, accountSnapshot } from './limits.js'
import { fetchAttribution } from './blocks.js'
import { clearAttribution } from './attribution.js'
import { fetchIncoming } from './shares.js'
import { setSharedBlocks } from './sharing.js'
import { clearShares } from './sharing.js'

/* ── status ───────────────────────────────────────────────────────────────

   Four states, from the backend plan §3, plus "off". Silence is deliberately
   not one of them: the storage bug this codebase already shipped taught that
   a save which quietly stops saving is the worst possible failure mode, and a
   sync that quietly stops syncing is the same bug one layer out. */
export const SYNC_OFF = 'off'          // no project configured, or signed out
export const SYNC_SYNCED = 'synced'
export const SYNC_SYNCING = 'syncing'
export const SYNC_QUEUED = 'queued'    // offline or over quota — work is waiting, not lost
export const SYNC_ERROR = 'error'

export const PUSH_DEBOUNCE_MS = 2000
export const PUSH_MAX_WAIT_MS = 10_000
/* Browsers cap the total body of all in-flight keepalive requests at 64KB.
   Sized under it with room for headers; a document bigger than this simply
   does not get the last gasp and relies on the outbox instead. */
export const KEEPALIVE_MAX_BYTES = 60_000
const PULL_PAGE = 200

const isOffline = err => {
  const m = String(err?.message || err || '').toLowerCase()
  return m.includes('fetch') || m.includes('network') || m.includes('offline') || m.includes('timeout')
}

/**
 * @param {object} hooks
 * @param {() => object} hooks.readWorkspace   current {notebooks, folders, files, prefs}
 * @param {(rows:Array) => void} hooks.applyRemote   pulled `docs` rows to fold in
 * @param {(kind:string, doc:object) => void} hooks.addLocalDoc  a conflict copy to keep
 * @param {(prefs:object) => void} hooks.applyPrefs
 * @param {(status:object) => void} hooks.onStatus
 */
export function createSyncEngine(hooks = {}) {
  const {
    readWorkspace = () => ({}),
    applyRemote = () => {},
    addLocalDoc = () => {},
    applyPrefs = () => {},
    onStatus = () => {},
  } = hooks

  let client = null
  let userId = null
  let accessToken = null
  let running = false
  let lastSeen = new Map()
  let lastPrefs = undefined
  /* How many drains an outbox entry may spend waiting for a document no tab
     in this browser can see, before the intent is abandoned. Six attempts is
     several minutes of exponential backoff — long past the point where a
     second tab would have supplied it. See pushDoc. */
  const ABANDON_AFTER = 6
  /* Ids this session has actually seen come down from the server. Used only to
     tell "local-only" apart from "already in the account" when the adoption
     guard refuses — see adoptLocalWorkspace. */
  let lastPulledIds = new Set()
  let pushTimer = null
  let maxWaitTimer = null
  let draining = false
  let drainAgain = false
  let realtime = null
  let status = { state: SYNC_OFF, pending: 0, message: null, at: 0 }
  const detach = []

  /* Assets download in the background, two at a time. Serial would make a
     notebook full of images take minutes to appear on a new machine; parallel
     with no limit opens forty connections and starves the pull that is trying
     to finish. Two is enough to hide latency and few enough to stay polite. */
  const downloadQueue = []
  let downloading = 0

  function emit(patch) {
    status = { ...status, ...patch, at: Date.now() }
    try { onStatus(status) } catch { /* a broken listener must not stop sync */ }
  }

  async function refreshPending() {
    const n = await pendingCount()
    if (n !== status.pending) emit({ pending: n })
    return n
  }

  /* ── the local-change signal ──────────────────────────────────────────── */

  /**
   * Called by the app after every workspace change. Cheap by design: a pointer
   * compare per document, no serialisation.
   */
  function changed(state) {
    if (!running || !userId) {
      /* Still track what we have seen. Otherwise the first push after a
         sign-in would diff against an empty map and mark every document
         dirty — which is right on a genuinely first sign-in and wrong on a
         reconnect, and this function cannot tell those apart. */
      lastSeen = snapshotDocs(docsFromWorkspace(state))
      lastPrefs = state?.prefs
      return
    }
    const current = docsFromWorkspace(state)
    const { changed: dirty, removed } = dirtyIds(lastSeen, current)
    lastSeen = snapshotDocs(current)

    const now = Date.now()
    const work = []
    for (const d of dirty) work.push(markDirty(TABLE_DOCS, d.id, { kind: d.kind, op: OP_UPSERT, localAt: now }))
    for (const id of removed) work.push(markDirty(TABLE_DOCS, id, { op: OP_DELETE, localAt: now }))

    if (state?.prefs !== lastPrefs) {
      lastPrefs = state?.prefs
      work.push(markDirty(TABLE_PREFS, userId, { op: OP_UPSERT, localAt: now }))
    }

    if (!work.length) return
    Promise.all(work).then(() => { refreshPending(); schedulePush() })
  }

  function schedulePush() {
    if (!running) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => { pushTimer = null; drain() }, PUSH_DEBOUNCE_MS)
    /* maxWait, for the same reason persistence.js's debounce grew one: a plain
       trailing debounce postpones forever under input closer together than the
       delay. Renaming a block writes per keystroke, so holding a key down
       meant the local save never happened at all — and it would mean the cloud
       push never happened either. */
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(() => { maxWaitTimer = null; drain() }, PUSH_MAX_WAIT_MS)
    }
  }

  function clearTimers() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
    if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null }
  }

  /* ── push ─────────────────────────────────────────────────────────────── */

  function docById(id) {
    const state = readWorkspace() || {}
    return docsFromWorkspace(state).find(d => d.id === id) || null
  }

  /** JSON equality, used ONLY on the rare conflict path. See pushDoc. */
  const sameDoc = (a, b) => {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }

  async function fetchRemote(id) {
    const { data, error } = await client
      .from('docs').select('id, kind, name, doc, rev, updated_at, deleted_at, device_id')
      .eq('id', id).maybeSingle()
    if (error) throw error
    return data || null
  }

  async function pushDoc(entry) {
    const id = entry.id
    const meta = await getMeta(TABLE_DOCS, id)
    const local = docById(id)

    /* A DELETE IS AN UPDATE. The client is not granted a hard delete except
       against rows soft-deleted more than 30 days ago (migration 0003, the
       "docs purge" policy). Nothing the app calls "delete" can destroy cloud
       data — which means an accidental prune, a bad refactor or a stolen
       token cannot either. */
    /* A MISSING LOCAL DOCUMENT IS NOT A DELETE — IT MAY BE ANOTHER TAB'S.

       The outbox lives in IndexedDB and is shared across tabs; each tab runs
       its own engine over its own copy of the workspace. Tab 2 creates a
       notebook and writes an outbox entry; before its debounce elapses, Tab 1
       goes hidden and flushes, picks up Tab 2's entry, and asks its OWN
       workspace for that id. It is not there.

       Conflating that with "the user deleted this" meant Tab 1 either threw
       away a push intent for a document that then existed only in IndexedDB
       (status: Synced), or — if the document had synced before, so a rev
       exists — wrote a tombstone for a notebook somebody was actively typing
       into in the other tab.

       persistence.js has a whole SAVE_STALE mechanism because two tabs are
       expected here. The outbox had no equivalent. Now only an explicit
       OP_DELETE deletes; an upsert whose target this tab cannot see is left
       alone for the tab that can see it.

       ── AND IT HAS TO GIVE UP EVENTUALLY. ────────────────────────────────

       The first version of this guard just returned `retry: true` forever,
       which turned one bug into another: an entry naming a document that
       exists in NO tab — deleted before its debounce drained, a stale entry
       from an older session, an id that never reached the workspace — was
       retried for eternity. The chip sat on "1 waiting" and nothing the user
       could do would clear it, because the thing it was waiting for did not
       exist anywhere.

       So the guard is now a WAIT, not a refusal. `attempts` and the
       exponential backoff already measure "how long has nobody produced
       this": by the sixth attempt the queue has been trying for minutes, and
       another tab that was going to supply the document has had every chance.

       What happens then is the part that matters. The OLD code resolved this
       case by writing a TOMBSTONE — it treated "no tab has it" as "the user
       deleted it", which is how it could destroy a notebook somebody was
       typing into next door. This drops the local INTENT and touches the
       server not at all. A push we cannot perform is abandoned; a document we
       never had is not deleted. Non-destructive in both directions, and it
       terminates. */
    if (entry.op !== OP_DELETE && !local) {
      if ((entry.attempts || 0) < ABANDON_AFTER) {
        return { ok: false, retry: true, reason: 'not-in-this-tab' }
      }
      await dropMeta(TABLE_DOCS, id)
      return { ok: true, noop: true, reason: 'abandoned' }
    }

    if (entry.op === OP_DELETE) {
      if (!meta?.rev) { await dropMeta(TABLE_DOCS, id); return { ok: true, noop: true } }
      const { error } = await client
        .from('docs').update({ deleted_at: new Date().toISOString(), device_id: deviceId() })
        .eq('id', id)
      if (error) throw error
      await dropMeta(TABLE_DOCS, id)
      return { ok: true }
    }

    const payload = {
      id,
      owner_id: userId,
      kind: local.kind,
      name: local.name,
      doc: local.doc,
      device_id: deviceId(),
      deleted_at: null,
    }

    if (!meta?.rev) {
      const { data, error } = await client
        .from('docs').insert(payload).select('rev, updated_at').single()
      if (!error) {
        await setMeta(TABLE_DOCS, id, { rev: data.rev, pushedAt: Date.now() })
        queueAssetsFor(local)
        return { ok: true }
      }
      /* Duplicate key: the row is already up there. Either another device
         created it, or this device pushed it and then lost its syncmeta
         (sign-out clears it). Not an error — it is a bookkeeping gap, and the
         conflict path below closes it correctly. */
      if (!/duplicate key|23505/i.test(error.message || '')) throw error
      return resolveConflict(id, local, null)
    }

    /* THE COMPARE-AND-SET. `eq('rev', meta.rev)` is the entire concurrency
       control: if anyone moved the row on since we pulled it, this matches
       zero rows and returns an empty array rather than an error. The new rev
       is computed by the docs_before_write trigger, never sent from here — a
       client that picks its own revision number can pick a large one and win
       every future conflict by default. */
    const { data, error } = await client
      .from('docs')
      .update({ name: payload.name, doc: payload.doc, device_id: payload.device_id, deleted_at: null })
      .eq('id', id).eq('rev', meta.rev)
      .select('rev, updated_at')
    if (error) throw error

    if (data && data.length === 1) {
      await setMeta(TABLE_DOCS, id, { rev: data[0].rev, pushedAt: Date.now() })
      queueAssetsFor(local)
      return { ok: true }
    }
    return resolveConflict(id, local, meta.rev)
  }

  /**
   * We lost the race — or we only think we did.
   *
   * THE FIRST CHECK IS NOT AN OPTIMISATION, IT IS WHAT MAKES THE LAST-GASP
   * PUSH SAFE. The `pagehide` keepalive request cannot be awaited, so its
   * result is never recorded: if it succeeded, the server is at rev N+1 while
   * our syncmeta still says N, and the next launch's compare-and-set fails
   * against a row holding OUR OWN bytes. Without the equality check, every
   * clean quit would manufacture a conflict copy of a document nobody else
   * touched.
   */
  async function resolveConflict(id, local, hadRev) {
    const remote = await fetchRemote(id)
    if (!remote) {
      /* It vanished between the failed update and this read — a delete from
         another device. Re-insert: our copy is newer than a tombstone we
         never saw, and the alternative is discarding it. */
      await dropMeta(TABLE_DOCS, id)
      return { ok: false, retry: true }
    }

    /* A TOMBSTONE IS NOT AGREEMENT, AND THIS IS WHERE UNDO USED TO LOSE.
       
       A soft delete does not clear `doc`, so a tombstoned row still holds the
       bytes it had when it died. The equality check below could therefore not
       tell "the server already has our document" from "the server has our
       document under a headstone", and it answered `adopted` to both.

       The sequence, which is four ordinary keystrokes:
         1. delete a notebook  → pushDoc writes deleted_at, drops the syncmeta
         2. Ctrl+Z             → undo hands back the SAME object, so the
                                 restored doc is byte-identical
         3. push                → no rev, so INSERT → duplicate key → here
         4. sameDoc is true     → adopt the rev, clear the outbox, report OK
       and the row is still tombstoned. The next pull sees it as a deletion
       from "another device", removes the notebook, and the autosave writes
       that away. Thirty days later the collector makes it permanent.

       The insert payload already carried `deleted_at: null` — the intent was
       right and was discarded when the insert lost the race. So: restore
       first, and only then ask whether the contents agree. */
    if (remote.deleted_at) {
      const { data, error } = await client
        .from('docs')
        .update({ deleted_at: null, name: local.name, doc: local.doc, device_id: deviceId() })
        .eq('id', id).eq('rev', remote.rev)
        .select('rev')
      if (error) throw error
      if (!data?.length) return { ok: false, retry: true }   // moved again under us
      await setMeta(TABLE_DOCS, id, { rev: data[0].rev, pushedAt: Date.now() })
      queueAssetsFor(local)
      return { ok: true, restored: true }
    }

    if (sameDoc(remote.doc, local.doc)) {
      await setMeta(TABLE_DOCS, id, { rev: remote.rev, pushedAt: Date.now() })
      /* THE BYTES ARE NOT PART OF `sameDoc`. This branch is the designed path
         for the last gasp — the tab closed, fetch(keepalive) landed the
         document, the result was never recorded — and the last gasp sends the
         DOCUMENT ONLY. Assets were never queued, so a 12MB image dropped in
         seconds before the tab closed existed on that one machine, with the
         status reading Synced and a permanent broken image everywhere else.

         The same applies to the merge and conflict-copy paths below: a
         conflict copy shares its asset ids with the original. */
      queueAssetsFor(local)
      return { ok: true, adopted: true }
    }

    /* Folders merge instead of forking — see mergeFolder in syncdocs.js. The
       union of two membership lists loses nothing, so there is nothing to
       rescue and a duplicate folder would be pure clutter. */
    if (local.kind === KIND_FOLDER) {
      const merged = mergeFolder(local.doc, remote.doc)
      const { data, error } = await client
        .from('docs').update({ name: merged.name || local.name, doc: merged, device_id: deviceId() })
        .eq('id', id).eq('rev', remote.rev)
        .select('rev')
      if (error) throw error
      if (!data?.length) return { ok: false, retry: true }   // moved again; try once more later
      await setMeta(TABLE_DOCS, id, { rev: data[0].rev, pushedAt: Date.now() })
      applyRemote([{ ...remote, doc: merged, rev: data[0].rev }])
      queueAssetsFor(local)
      return { ok: true, merged: true }
    }

    /* The real thing. Their version stays at this id; ours becomes a new
       document with a new id, pushed as an insert, and appears in the sidebar
       next to the original. Both are visible, neither is chosen for the user,
       and nothing is deleted. */
    const state = readWorkspace() || {}
    const names = [...(state.notebooks || []), ...(state.files || [])].map(x => x?.name).filter(Boolean)
    const copyId = newId(String(id).split('_')[0] || 'nb')
    const copy = { ...local.doc, id: copyId, name: conflictName(local.name, names) }

    const { data, error } = await client.from('docs').insert({
      id: copyId, owner_id: userId, kind: local.kind,
      name: copy.name, doc: copy, device_id: deviceId(),
    }).select('rev').single()
    if (error) throw error

    await setMeta(TABLE_DOCS, copyId, { rev: data.rev, pushedAt: Date.now() })
    await setMeta(TABLE_DOCS, id, { rev: remote.rev, pulledAt: Date.now() })
    addLocalDoc(local.kind, copy)
    applyRemote([remote])
    queueAssetsFor(local)
    queueAssetsFor({ ...local, id: copyId, doc: copy })

    emit({
      state: SYNC_SYNCED,
      message: `"${local.name}" was edited on another device. Both versions are here — yours is now "${copy.name}".`,
    })
    return { ok: true, conflicted: true, copyId, hadRev }
  }

  /* ── assets ───────────────────────────────────────────────────────────── */

  function queueAssetsFor(local) {
    const ids = assetIdsOf(local.doc)
    if (!ids.length) return
    const now = Date.now()
    /* Not awaited. The document is already safely up; its bytes follow, and
       making the doc push wait on a 25MB upload would make every save feel as
       slow as the slowest attachment in it. */
    Promise.all(ids.map(a => markDirty(TABLE_ASSETS, a, { docId: local.id, op: OP_UPSERT, localAt: now })))
      .then(() => { refreshPending(); schedulePush() })
      .catch(() => {})
  }

  async function pushAsset(entry) {
    /* RETIRING AN ASSET IS A QUEUED OPERATION LIKE ANY OTHER.

       It used to be a bare `tombstoneAssets(ids).catch(() => {})` fired from
       the autosave in app/app/page.js — no retry, no backoff, no record. The
       comment there called a failure "a billing annoyance: bytes linger until
       the next delete of the same id". There is no next delete of the same id.
       The prune has already removed the local blob, so that id can never
       appear in a keep-set again. A single offline moment — which is ordinary
       usage in a local-first app — leaked the object permanently AND left the
       manifest row counting against quota forever, because collectRemote only
       ever sweeps rows that carry a tombstone.

       Through the outbox it gets crash-safety, backoff and the retry loop for
       free, which is what the outbox is for. */
    if (entry.op === OP_DELETE) {
      const res = await tombstoneAssets([entry.id], { client })
      if (res.status === UP_OK) return { ok: true }
      if (res.status === UP_UNCONFIGURED) return { ok: true, noop: true }
      throw new Error(res.error || 'could not retire the asset')
    }

    const orgId = accountSnapshot().orgId
    const res = await uploadAsset(entry.id, {
      ownerId: userId, orgId, docId: entry.docId || null, client,
    })
    if (res.status === UP_OK || res.status === UP_ALREADY || res.status === UP_DEDUPED) return { ok: true }

    /* The bytes are gone locally. Not a failure: the prune in app/app/page.js
       collects assets no block references any more, and an outbox entry can
       outlive what it names. Retrying forever would light up the error state
       for something already correctly resolved.

       BUT: if a previous attempt uploaded the object and then failed to write
       the manifest row, this is the last moment anything will ever know that
       object's path. Nothing enumerates the bucket. Clearing the entry without
       reclaiming it is how bytes become permanent, unreferenced and billable —
       and they survive account deletion too, because that route also lists
       paths from the manifest. */
    if (res.status === UP_MISSING) {
      if (entry.orphanPath) await reclaimOrphan(entry.orphanPath, { client }).catch(() => {})
      return { ok: true, noop: true }
    }

    if (res.status === UP_QUOTA) {
      /* Remember the orphan across the retry, so the reclaim above can still
         find it if the block is deleted while this sits queued. */
      if (res.orphanPath) await markDirty(TABLE_ASSETS, entry.id, {
        docId: entry.docId || null, op: OP_UPSERT, localAt: entry.localAt, orphanPath: res.orphanPath,
      })
      return { ok: false, quota: true, message: res.message }
    }

    if (res.orphanPath) await markDirty(TABLE_ASSETS, entry.id, {
      docId: entry.docId || null, op: OP_UPSERT, localAt: entry.localAt, orphanPath: res.orphanPath,
    })
    throw new Error(res.error || 'upload failed')
  }

  /* Assets whose bytes could not be fetched after three tries. Surfaced in the
     status object so the UI can say "3 files could not be downloaded" instead
     of rendering three broken frames and no explanation. */
  const failedDownloads = new Set()

  function queueDownload(assetId, row, tries = 0) {
    downloadQueue.push({ assetId, row, tries })
    pumpDownloads()
  }

  function pumpDownloads() {
    while (downloading < 2 && downloadQueue.length) {
      const job = downloadQueue.shift()
      downloading++
      downloadAsset(job.assetId, { client, row: job.row })
        /* THE STATUS WAS NEVER INSPECTED. downloadAsset does not throw — it
           returns { status: DOWN_FAILED } — so the `.catch()` here was
           decorative and a failed download was indistinguishable from a
           successful one. One transient blip while fetching an image meant no
           retry, no error state, no record: a permanently broken image on that
           device, re-queued only if that document happened to appear in a
           later pull, which it never will once the cursor moves past it.

           Bounded retries with a widening delay. DOWN_GONE is not retried —
           the asset is deleted and asking again will not undelete it. */
        .then(res => {
          if (res?.status !== DOWN_FAILED) return
          const tries = (job.tries || 0) + 1
          if (tries > 3) {
            failedDownloads.add(job.assetId)
            return
          }
          setTimeout(() => queueDownload(job.assetId, job.row, tries), 2000 * tries)
        })
        .catch(() => {})
        .then(() => { downloading--; pumpDownloads() })
    }
  }

  /* ── prefs ────────────────────────────────────────────────────────────── */

  async function pushPrefs() {
    const state = readWorkspace() || {}
    const prefs = state.prefs || {}
    /* `.select('id')` so a match of ZERO rows is distinguishable from success.
       Without it, an account whose `profiles` row was never created — a signup
       where handle_new_user did not fire, a row deleted by hand — updated
       nothing, returned no error, reported ok, and had its outbox entry
       cleared. Preferences then silently never saved, forever, with the sync
       chip showing green. */
    const { data, error } = await client.from('profiles').update({ prefs }).eq('id', userId).select('id')
    if (error) throw error
    if (!data?.length) throw new Error('No profile row for this account — preferences were not saved.')
    return { ok: true }
  }

/* The quota triggers raise with errcode `check_violation` (23514) and a
   message beginning `QUOTA:`. Matching either is enough; matching both is
   deliberate, because supabase-js does not reliably surface `code` for an
   exception raised inside a trigger. Kept alongside the identical pair in
   lib/cloudassets.js rather than shared, because a sync engine that imports
   its error taxonomy from the asset uploader is the wrong dependency. */
const isQuotaMessage = err =>
  err?.code === '23514' || /(^|\W)QUOTA:/.test(err?.message || '')
const quotaSentence = err =>
  String(err?.message || '').replace(/^.*?QUOTA:\s*/s, '').trim() || 'Storage is full.'

  /* ── the drain ────────────────────────────────────────────────────────── */

  async function drain() {
    if (!running || !userId || !client) return
    if (draining) { drainAgain = true; return }
    draining = true
    clearTimers()
    emit({ state: SYNC_SYNCING, message: null })

    let sawOffline = false
    let sawQuota = null
    let sawError = null

    try {
      const due = await listDue()
      for (const entry of due) {
        if (!running) break
        try {
          let res
          if (entry.table === TABLE_DOCS) res = await pushDoc(entry)
          else if (entry.table === TABLE_ASSETS) res = await pushAsset(entry)
          else if (entry.table === TABLE_PREFS) res = await pushPrefs()
          else res = { ok: true, noop: true }

          if (res.ok) await clearIfUnchanged(entry.table, entry.id, entry.localAt)
          else if (res.quota) {
            sawQuota = res.message
            await recordFailure(entry.table, entry.id, new Error('over quota'))
          } else {
            await recordFailure(entry.table, entry.id, new Error('retry'))
          }
        } catch (err) {
          /* A QUOTA REFUSAL IS NOT AN OUTAGE, ON EITHER TABLE.

             pushAsset mapped UP_QUOTA to the calm "queued, and here is why"
             banner; pushDoc had no equivalent, so a free account — for which
             the server refuses EVERY document write by design — lit up the red
             error state with a raw Postgres string in it, on every save. The
             tier working as intended looked like the product being broken.

             lib/limits.js rule 2: over quota means new work waits. It never
             means anything is lost, and it never means something went wrong. */
          if (isQuotaMessage(err)) { sawQuota = quotaSentence(err) }
          else if (isOffline(err)) { sawOffline = true }
          else sawError = err
          await recordFailure(entry.table, entry.id, err)
          /* One offline error means every remaining push in this pass will
             also fail. Stopping keeps the backoff counters honest — otherwise
             a queue of forty documents burns forty attempts on one outage and
             comes back with all of them deep in exponential backoff. */
          if (sawOffline) break
        }
      }
    } finally {
      draining = false
    }

    const pending = await refreshPending()
    if (sawQuota) emit({ state: SYNC_QUEUED, message: sawQuota })
    else if (sawOffline) emit({ state: SYNC_QUEUED, message: 'Offline — your work is saved here and will sync when you reconnect.' })
    else if (sawError) emit({ state: SYNC_ERROR, message: sawError?.message || 'Sync failed.' })
    else if (pending === 0) emit({ state: SYNC_SYNCED, message: null })
    else emit({ state: SYNC_QUEUED })

    if (drainAgain) { drainAgain = false; schedulePush() }
    else if (pending > 0 && !sawOffline) schedulePush()
  }

  /**
   * Re-point `lastSeen` at whatever is currently on screen.
   *
   * `dirtyIds` is a reference comparison against this map — no serialisation,
   * nothing that scales with document size, which is what makes it safe to
   * call on every keystroke. The cost of that cheapness is that the map has to
   * be re-seeded any time the workspace changes for a reason that is not a
   * user edit. There are exactly two: attaching a session, and applying a
   * pull. The second one was missing, which is the whole of the ping-pong bug.
   */
  function seedFromWorkspace() {
    const state = readWorkspace() || {}
    lastSeen = snapshotDocs(docsFromWorkspace(state))
    lastPrefs = state.prefs
  }

  /* ── pull ─────────────────────────────────────────────────────────────── */

  async function pull({ full = false } = {}) {
    if (!running || !userId || !client) return { ok: false }
    try {
      emit({ state: SYNC_SYNCING })
      const cursor = full ? null : await getCursor()
      /* BY ORGANISATION, NOT BY OWNER.

         RLS already restricts this to organisations the caller belongs to, so
         the filter is about WHICH of them rather than about safety. Keying it
         on owner_id meant that in a shared workspace you could never see a
         document a colleague wrote — the policy allowed it and the query
         excluded it — and, worse, `adoptLocalWorkspace` counted the same way,
         so it would conclude a busy shared account was "empty" and upload a
         personal workspace into it where every member could read it.

         Falls back to owner_id only while the account snapshot has not
         arrived; that is the first moments after sign-in, when every row in
         the personal org is the caller's anyway. */
      const orgId = accountSnapshot().orgId
      let query = client
        .from('docs')
        .select('id, kind, name, doc, rev, updated_at, deleted_at, device_id')
        .order('updated_at', { ascending: true })
        .limit(PULL_PAGE)
      query = orgId ? query.eq('org_id', orgId) : query.eq('owner_id', userId)
      /* gte, not gt. Two rows written inside the same millisecond share an
         updated_at, and `gt` would step past the second one forever. The cost
         is re-reading one row per pull; the cost of the alternative is a
         document that never arrives and cannot be explained. */
      if (cursor) query = query.gte('updated_at', cursor)

      const { data, error } = await query
      if (error) throw error

      const rows = data || []
      if (rows.length) {
        const pendingIds = new Set((await listPending()).filter(e => e.table === TABLE_DOCS).map(e => e.id))
        let fresh = rows.filter(r => !pendingIds.has(r.id))

        for (const r of fresh) {
          await setMeta(TABLE_DOCS, r.id, { rev: r.rev, pulledAt: Date.now() })
        }

        /* RE-READ WHAT IS PENDING, IMMEDIATELY BEFORE APPLYING.

           `pendingIds` is the only thing standing between a pull and the
           user's live buffer, and it was measured at the START of a long
           asynchronous section — up to 200 sequential IndexedDB transactions,
           tens to hundreds of milliseconds. Anything typed during that window
           wrote an outbox entry that landed after the snapshot, so applyPulled
           replaced the document wholesale with the older remote copy and the
           next push sent the reverted version upstream.

           applyPulled performs no version comparison of its own (by design —
           see syncdocs.js), so this list is the entire defence. It has to be
           read at the moment it is used. */
        if (fresh.length) {
          const nowPending = new Set((await listPending()).filter(e => e.table === TABLE_DOCS).map(e => e.id))
          fresh = fresh.filter(r => !nowPending.has(r.id))
        }
        for (const r of rows) lastPulledIds.add(r.id)
        if (fresh.length) applyRemote(fresh)

        /* FOLD WHAT WE JUST APPLIED INTO `lastSeen`, or the next `changed()`
           marks every one of them dirty and pushes them straight back.

           `dirtyIds` compares by object reference. applyPulled builds new
           objects from the network payload, so a pulled document is a
           different reference from the one in lastSeen — guaranteed dirty,
           every time, with no user input at all. Device A pushes what it just
           received, which bumps rev and stamps device_id=A, which wakes
           device B's realtime subscription, which pulls and pushes back.
           Two machines taking turns, forever.

           app/app/page.js has a comment describing exactly this hazard and
           fixes `workspaceRef` — but `changed()` does not diff against
           workspaceRef, it diffs against this map, which lives in here and
           which the pull never touched. */
        seedFromWorkspace()

        /* Assets are fetched LAZILY — the manifest rows are a few hundred
           bytes, the objects are not. A new machine that eagerly downloaded
           every asset would sit on a spinner pulling gigabytes before showing
           a single notebook, and most of those bytes belong to notebooks
           nobody is opening today. */
        for (const r of fresh) {
          if (r.deleted_at) continue
          for (const assetId of assetIdsOf(r.doc)) {
            /* No row passed here, so downloadAsset re-read the manifest row
               the pull had already fetched — one wasted round trip per asset.
               It cannot pass `r`: `r` is the DOCUMENT row, not the asset's.
               Left as a lookup, but now an explicit one rather than an
               accidental `undefined` filling a second parameter. */
            localAsset(assetId).then(have => { if (!have) queueDownload(assetId, null) })
          }
        }

        const last = rows[rows.length - 1]?.updated_at
        if (last) await setCursor(last)
        /* A full page means there is probably more. Keep going rather than
           waiting for the next focus event — a machine that has been off for a
           month should catch up now, not over the next fortnight of tab
           switches. */
        if (rows.length === PULL_PAGE) return pull({ full: false })
      }

      await pullPrefs()
      await refreshAccount(client, userId)

      /* WHO CHANGED WHAT, fetched after the documents rather than with them.

         Attribution is decoration: the notebooks must be on screen whether or
         not this succeeds, so it is a separate request that cannot fail the
         pull. It runs after refreshAccount because attributionFor() needs to
         know who YOU are to suppress flags on your own edits — without that it
         would briefly flag every block you have ever touched.

         Scoped to what this pull actually saw. A full sweep of every document
         in the workspace would be a bigger query on every focus event for
         information about notebooks nobody has open. */
      if (rows.length) {
        fetchAttribution(rows.map(r => r.id), { client }).catch(() => {})
      }

      /* What other people have shared with me. NOT scoped to `rows`, unlike
         attribution: a sheet-level grant deliberately does not carry the
         `docs` row (0008 §9 — handing it over would hand over every other
         sheet), so the document it belongs to never appears in a pull at all.
         Scoping this the same way would mean the one case the feature exists
         for is the one case that never loads.

         Unawaited and swallowed for the same reason as attribution: this is a
         local-first app, and a workspace must finish syncing whether or not
         anybody has shared anything with you. */
      /* The BLOCKS come back with the grants and are now kept, not discarded.
         A chat reference card previews the real contents of a shared block and
         builds a genuine copy when dragged onto the canvas; both need the data
         this call already fetches. Still unawaited and still swallowed — a
         local-first workspace must finish syncing whether or not anyone has
         shared anything. */
      fetchIncoming({ client })
        .then(res => { if (res?.ok) setSharedBlocks(res.blocks) })
        .catch(() => {})

      collectOnce()
      const pending = await refreshPending()
      emit({ state: pending ? SYNC_QUEUED : SYNC_SYNCED, message: null })
      return { ok: true, count: rows.length }
    } catch (err) {
      if (isOffline(err)) emit({ state: SYNC_QUEUED, message: 'Offline — showing the copy saved on this device.' })
      else emit({ state: SYNC_ERROR, message: err?.message || 'Could not read from the server.' })
      return { ok: false, error: err?.message }
    }
  }

  /* THE COLLECTOR WAS WRITTEN AND NEVER CALLED.

     collectRemote() hard-deletes manifest rows soft-deleted more than 30 days
     ago and removes the objects nothing points at any more. It existed in
     lib/cloudassets.js from the day assets shipped and nothing invoked it —
     so the 30-day recovery window worked perfectly at the "recover" end and
     never at the "expire" end. Nothing was ever actually freed, and a bucket
     that only grows is a bill that only grows.

     ONCE PER SESSION, not once per pull. Pulls happen on every focus event and
     every realtime notification; a sweep on each of those would be a query
     storm to delete, almost always, nothing. The 30-day window means there is
     no urgency whatsoever about when this runs.

     Fire-and-forget, and failures are swallowed on purpose: a collection that
     cannot run is bytes left lying around, which is a cost problem. Letting it
     reject into the pull would turn that into a sync error the user sees,
     which is a trust problem. Those are not the same size. */
  let collected = false
  function collectOnce() {
    if (collected || !client) return
    collected = true
    /* Both sweeps, independently. Documents and assets expire on the same
       30-day clock but through different machinery, and a Storage outage that
       stops one must not stop the other — which is why these are two promises
       rather than one chain. */
    collectRemote({ client }).catch(() => {})
    collectRemoteDocs({ client }).catch(() => {})
  }

  async function pullPrefs() {
    try {
      const { data } = await client.from('profiles').select('prefs, prefs_rev').eq('id', userId).maybeSingle()
      if (!data?.prefs || !Object.keys(data.prefs).length) return
      const seen = await getMeta(TABLE_PREFS, userId)
      if ((seen?.rev || 0) >= (data.prefs_rev || 0)) return
      await setMeta(TABLE_PREFS, userId, { rev: data.prefs_rev, pulledAt: Date.now() })
      applyPrefs(data.prefs)
    } catch { /* prefs are a convenience; never fail a pull over them */ }
  }

  /* ── first sign-in: adopt what is already here ────────────────────────── */

  /**
   * The highest-risk moment for trust in the whole product (backend plan §4).
   *
   * Someone has been using DataStudio locally, signs in for the first time,
   * and has notebooks on this machine. Upload them. Do not ask. An empty
   * workspace after signing in looks exactly like the app losing their work,
   * and no amount of explanatory copy undoes that first impression.
   *
   * ONLY when the account has nothing of its own. Adopting into an account
   * that already has notebooks would silently merge two people's workspaces on
   * a shared machine — the same failure app/app/page.js already guards
   * against for local assets on a library computer.
   */
  async function adoptLocalWorkspace() {
    if (!client || !userId) return { ok: false }
    try {
      const orgId = accountSnapshot().orgId
      let probe = client.from('docs').select('id', { count: 'exact', head: true }).is('deleted_at', null)
      probe = orgId ? probe.eq('org_id', orgId) : probe.eq('owner_id', userId)
      const { count, error } = await probe
      if (error) throw error
      if (count && count > 0) {
        /* NOT SILENTLY. This used to return a value nobody read.

           The guard is written for "someone else's account on a shared
           machine", but the far more common case is "my own second machine",
           and the two look identical from here. Picking the safe answer is
           right; picking it without telling anyone is not — `lastSeen` was
           seeded from the pre-pull workspace, so those local-only notebooks
           are not dirty either, and they are never pushed, never mentioned,
           and gone the day that browser profile is cleared. The status reads
           Synced the whole time.

           So: count what is local-only and say so. The decision still belongs
           to the user; this just stops the app answering it for them in
           silence. */
        const localDocs = docsFromWorkspace(readWorkspace() || {})
        const strays = localDocs.filter(d => !lastPulledIds.has(d.id))
        if (strays.length) {
          emit({
            state: SYNC_QUEUED,
            message: `${strays.length} item${strays.length === 1 ? '' : 's'} on this device ${strays.length === 1 ? 'is' : 'are'} not in your account yet. Open Account to upload ${strays.length === 1 ? 'it' : 'them'}.`,
          })
        }
        return { ok: true, adopted: 0, reason: 'account-not-empty', strays: strays.map(d => d.id) }
      }

      const state = readWorkspace() || {}
      const docs = docsFromWorkspace(state)
      /* A single empty notebook is what a first run creates on its own. It is
         not work, and adopting it would put "My Project" with no blocks into
         an account whose owner never made it. */
      const worth = docs.filter(d => d.kind !== KIND_NOTEBOOK ||
        (d.doc?.sheets || []).some(s => (s.blocks || []).length > 0))
      if (!worth.length && docs.length <= 1) return { ok: true, adopted: 0, reason: 'nothing-to-adopt' }

      const now = Date.now()
      for (const d of docs) await markDirty(TABLE_DOCS, d.id, { kind: d.kind, op: OP_UPSERT, localAt: now })
      await markDirty(TABLE_PREFS, userId, { op: OP_UPSERT, localAt: now })
      await refreshPending()
      await drain()
      return { ok: true, adopted: docs.length }
    } catch (err) {
      return { ok: false, error: err?.message }
    }
  }

  /* ── the last gasp ────────────────────────────────────────────────────── */

  /**
   * Fired from `pagehide`, where nothing may be awaited — the page is going
   * away and any promise still in flight dies with it. `fetch(keepalive)` is
   * the only request the browser guarantees to finish.
   *
   * It is best-effort by construction: the response is never read, so the
   * outbox entry is NOT cleared and the revision is NOT recorded. That is
   * fine, and safe, only because of the equality check at the top of
   * resolveConflict — on the next launch the compare-and-set fails against a
   * row holding our own bytes, sees they match, and adopts the rev instead of
   * manufacturing a conflict copy. Without that check every clean quit would
   * produce a spurious duplicate.
   */
  function lastGasp() {
    if (!running || !userId || !accessToken) return
    const { url, anonKey } = supabaseConfig()
    if (!url || !anonKey || typeof fetch !== 'function') return

    const state = readWorkspace() || {}
    const docs = docsFromWorkspace(state)
    const byId = new Map(docs.map(d => [d.id, d]))

    listPending().then(entries => {
      for (const e of entries) {
        if (e.table !== TABLE_DOCS || e.op === OP_DELETE) continue
        const local = byId.get(e.id)
        if (!local) continue
        let body
        try {
          body = JSON.stringify({ name: local.name, doc: local.doc, device_id: deviceId(), deleted_at: null })
        } catch { continue }
        if (body.length > KEEPALIVE_MAX_BYTES) continue
        try {
          fetch(`${url}/rest/v1/docs?id=eq.${encodeURIComponent(e.id)}`, {
            method: 'PATCH',
            keepalive: true,
            headers: {
              'apikey': anonKey,
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body,
          }).catch(() => {})
        } catch { /* the page is leaving; there is nowhere to report this */ }
      }
    }).catch(() => {})
  }

  /** Push everything owed right now, without waiting out the debounce. */
  function flush() {
    clearTimers()
    return drain()
  }

  /* ── lifecycle ────────────────────────────────────────────────────────── */

  async function attachSession(session) {
    const nextUser = session?.user?.id || null
    accessToken = session?.access_token || null

    if (nextUser === userId) return
    if (userId && nextUser !== userId) {
      /* ACCOUNT BOUNDARY — BUT SIGNING OUT IS NOT ONE.

         Clearing the outbox when the account CHANGES is right and necessary:
         an entry from A would push A's notebook into B's cloud on the first
         drain. Clearing it when A signs out of A is not. The entries are still
         valid, still A's, and still the only record that those edits have not
         reached the server.

         What made it a data-loss bug rather than a slow re-sync: the syncmeta
         cursor went with it, so the next sign-in ran a FULL pull with an empty
         pending set, and applyPulled — which compares no versions at all — put
         the older remote row straight over the newer local one. The work was
         gone before anything could push it. A token refresh failing counts as
         a sign-out here, so this needed no user action to happen.

         Now: drain first, and only hard-clear when the next user is a
         different person. Signing out keeps the queue for when they return. */
      const sameAccount = nextUser === null
      if (sameAccount) {
        try { await drain() } catch { /* offline; the queue survives for next time */ }
      } else {
        await clearSyncState()
        lastPulledIds = new Set()
      }
      lastSeen = new Map()
      lastPrefs = undefined
      /* Attribution names people in ONE organisation. Carrying it across an
         account switch would put a colleague's name on a stranger's block. */
      clearAttribution()
      /* And grants belong to ONE person. Left behind, the next account to sign
         in on this machine sees a "Shared with me" list of things it cannot
         open — which reads as a bug and is, briefly, a disclosure of who the
         previous user was working with. */
      clearShares()
      setAccount({ signedIn: false })
    }
    userId = nextUser

    if (!userId) {
      teardownRealtime()
      emit({ state: SYNC_OFF, pending: 0, message: null })
      return
    }

    await refreshAccount(client, userId)
    /* Seed the reference map from what is on screen BEFORE adopting, so the
       first `changed()` after this does not mark the whole workspace dirty a
       second time. */
    seedFromWorkspace()

    await pull({ full: true })
    await adoptLocalWorkspace()
    setupRealtime()
    await drain()
  }

  function setupRealtime() {
    if (!client || !userId || realtime) return
    try {
      /* Subscribed to as a NOTIFY, not as a stream of edits: the payload is
         ignored and the only reaction is "go pull". Streaming edits is what a
         CRDT is for, and there is no simultaneous multi-user editing here —
         there is one person on two machines. */
      realtime = client
        .channel(`docs:${userId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'docs', filter: `owner_id=eq.${userId}` },
          payload => {
            /* Our own write, echoed back. Pulling on it would be a round trip
               per keystroke-batch for no information. */
            if (payload?.new?.device_id === deviceId()) return
            pull()
          })
        .subscribe()
    } catch { realtime = null }
  }

  function teardownRealtime() {
    if (!realtime || !client) return
    try { client.removeChannel(realtime) } catch { /* already gone */ }
    realtime = null
  }

  async function start() {
    if (running) return
    running = true
    client = await getSupabase()
    if (!client) { emit({ state: SYNC_OFF, message: null }); return }

    const s = await getSession(client)
    await attachSession(s.session)

    const stopAuth = onAuthChange(({ session }) => { attachSession(session).catch(() => {}) }, client)
    detach.push(stopAuth)

    if (typeof document !== 'undefined') {
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') flush()
        else pull()
      }
      document.addEventListener('visibilitychange', onVisibility)
      detach.push(() => document.removeEventListener('visibilitychange', onVisibility))
    }
    if (typeof window !== 'undefined') {
      const onHide = () => lastGasp()
      const onOnline = () => { emit({ state: SYNC_SYNCING }); drain(); pull() }
      const onFocus = () => pull()
      window.addEventListener('pagehide', onHide)
      window.addEventListener('online', onOnline)
      window.addEventListener('focus', onFocus)
      detach.push(() => window.removeEventListener('pagehide', onHide))
      detach.push(() => window.removeEventListener('online', onOnline))
      detach.push(() => window.removeEventListener('focus', onFocus))
    }
  }

  function stop() {
    running = false
    clearTimers()
    teardownRealtime()
    while (detach.length) { try { detach.pop()() } catch { /* nothing to do */ } }
  }

  /**
   * Queue the retirement of assets whose local bytes have just been pruned.
   *
   * Called by the autosave in app/app/page.js with the ids the prune actually
   * deleted. Deliberately fire-and-forget from the caller's point of view and
   * deliberately NOT a network call: it writes intent to the outbox, which is
   * what survives a crash, a closed tab and an aeroplane.
   */
  function retireAssets(ids) {
    if (!running || !userId || !Array.isArray(ids) || !ids.length) return
    const now = Date.now()
    Promise.all(ids.map(id => markDirty(TABLE_ASSETS, id, { op: OP_DELETE, localAt: now })))
      .then(() => { refreshPending(); schedulePush() })
      .catch(() => {})
  }

  return {
    start, stop, changed, flush, pull,
    adoptLocalWorkspace,
    retireAssets,
    getStatus: () => status,
    /* Test seams. Nothing in the app calls these. */
    _internals: { pushDoc, resolveConflict, drain, setClient: (c, u) => { client = c; userId = u; running = true } },
  }
}

/** A one-line description of a status, for the UI. */
export function describeSync(status) {
  switch (status?.state) {
    case SYNC_SYNCED: return status.pending ? `Synced — ${status.pending} waiting` : 'Synced'
    case SYNC_SYNCING: return 'Syncing…'
    case SYNC_QUEUED: return status.pending ? `Waiting to sync (${status.pending})` : 'Waiting to sync'
    case SYNC_ERROR: return 'Sync error'
    default: return 'Not syncing'
  }
}
