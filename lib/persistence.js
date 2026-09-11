/*
  lib/persistence.js
  --------------------------------------------------------------------------
  Workspace persistence, backed by IndexedDB.

  WHAT GETS PERSISTED
  - notebooks (blocks, sheets, connections, drawings, content)
  - folders (sidebar structure)
  Image bytes live in a separate IndexedDB store (see lib/idb.js); blocks only
  carry an image id.

  WHAT IS NOT PERSISTED
  - files (raw imported workbooks — re-import instead; anything worth keeping
    should be dragged onto the canvas as a table block, which IS persisted)
  - ephemeral UI state (drag, modals, selection)

  WHY THIS WAS REWRITTEN (v3)
  v2 used localStorage. Three problems, in increasing order of severity:

  1. Synchronous. Every autosave ran JSON.stringify over the entire workspace
     on the main thread, on a 600ms debounce.
  2. ~5MB for everything, strings only. Images were impossible: base64 costs
     4:3, so a 5MB photo needs 6.7MB — more than the whole budget.
  3. It lost data silently. When the quota was exceeded, setItem threw, the
     catch logged a console.warn nobody sees, and the user kept working on a
     workspace that had stopped saving. That is the bug this rewrite exists
     to kill.

  Saves now report their outcome. AppPage surfaces a persistent banner on
  failure instead of a warning in a console nobody has open.

  MIGRATION
  On first load the old `datastudio-state-v2` localStorage key is read, copied
  into IndexedDB, and left in place (not deleted) so a downgrade doesn't lose
  anything. Once IndexedDB holds a snapshot, the old key is never read again.
  -------------------------------------------------------------------------- */

import { idbGet, idbSet, idbSetIf, idbDelete, STORE_STATE, idbAvailable, storageEstimate, workspaceByteSize } from './idb.js'

const LEGACY_KEY = 'datastudio-state-v2'
const STATE_KEY = 'workspace'

/* v3 → v4 adds `prefs`. There is no migration step: a v3 payload simply has no
   prefs key, and migratePrefs() falls back to the standalone theme mirror that
   every existing workspace already has. Bumping the number is what makes that
   silence deliberate rather than accidental. */
/* v4 → v5 adds `files`: the imported workbooks that appear in the sidebar.

   They were never persisted at all. `saveState` wrote {notebooks, folders,
   prefs} and nothing else, so importing an .xlsx put it in the sidebar, in
   React state, and nowhere on disk — reload and it was gone. Worse, folders
   store an ORDERED itemIds array that mixes notebook ids and file ids, so
   every workbook filed into a folder left a dangling reference behind that
   nothing ever cleaned up.

   There is no migration step for the same reason v4 had none: a v4 payload
   simply has no `files` key and loadState defaults it to []. Bumping the
   number is what makes the silence deliberate. */
export const STATE_VERSION = 5

/* Save outcomes. Callers branch on these rather than on exception types. */
export const SAVE_OK = 'ok'
export const SAVE_QUOTA = 'quota'
export const SAVE_FAILED = 'failed'
/* Another tab wrote this workspace after we last read it, so we did NOT save.
   Distinct from SAVE_FAILED on purpose: nothing is broken, someone else is
   editing, and the user needs to be told to reload rather than to free space. */
export const SAVE_STALE = 'stale'

/* THE LAST savedAt THIS TAB KNOWS ABOUT.

   Set by loadState, and by every save this tab makes. saveState refuses to
   write over a row whose savedAt is newer than this — which is precisely the
   two-tab case: tab B loaded at T0, tab A saved at T1, and tab B's autosave
   would otherwise land at T2 and erase everything A did.

   Module-level rather than passed in, because there is exactly one workspace
   per tab and threading it through every call site would make every caller
   responsible for a rule that is not theirs to get wrong. */
let observedSavedAt = null

/** Test seam, and the reset the "delete everything" path needs. */
export function _resetObservedClock(v = null) { observedSavedAt = v }

/* Top-level keys this build does not model, kept so a save preserves them.
   Deliberately shallow: guessing at the shape of a nested field we do not
   understand is how you corrupt it. */
const KNOWN_KEYS = new Set(['version', 'notebooks', 'folders', 'files', 'prefs', 'savedAt', 'migrated', 'status', 'error'])
let unknownKeys = {}

/**
 * May we overwrite `current`, given the newest savedAt this tab has seen?
 *
 * Exported so tests exercise the REAL rule rather than a copy of it. A test
 * that re-implements the predicate it is checking passes forever, including
 * after someone changes the original — which is the failure mode that let the
 * two-tab bug ship in the first place.
 */
export function mayOverwrite(current, observed) {
  if (!current) return true                       // nothing there to lose
  if (observed == null) return true               // we never read a row, so we cannot be stale against one
  return !(current.savedAt > observed)            // refuse anything newer than what we last saw
}

/** Is this stored payload from a build newer than ours? Exported for the same reason. */
export function isFutureVersion(payload) {
  return typeof payload?.version === 'number' && payload.version > STATE_VERSION
}

export function collectUnknown(payload) {
  const out = {}
  for (const k of Object.keys(payload || {})) if (!KNOWN_KEYS.has(k)) out[k] = payload[k]
  return out
}

/** Test seam. */
export function _resetUnknownKeys() { unknownKeys = {} }

/**
 * Persist the workspace.
 * @returns {Promise<{status:string, error?:string, bytes?:number}>}
 *          Never throws — the caller decides what a failure means for the UI.
 */
export async function saveState(state) {
  const savedAt = Date.now()
  const payload = {
    /* CARRY FORWARD WHATEVER WE DID NOT UNDERSTAND.

       This object used to be built from a fixed whitelist, so a workspace
       written by a newer build lost every top-level key this build had never
       heard of — permanently, on the first autosave. `unknownKeys` is
       captured by loadState and spread back in here, which turns a downgrade
       from destructive into merely read-only-ish. It is spread FIRST so a real
       value below always wins. */
    ...unknownKeys,
    version: STATE_VERSION,
    notebooks: state.notebooks || [],
    folders: state.folders || [],
    /* v5. Written unconditionally rather than omitted-when-empty like `prefs`
       below, because [] and absent mean different things here: absent is "a v4
       build wrote this and never knew about files", [] is "there are none".
       Conflating them would make a v4 downgrade look like a deliberate delete
       on the next upgrade. */
    files: state.files || [],
    /* v4. Omitted rather than written as null when absent, so a downgrade to a
       v3 build reads the workspace unchanged instead of tripping over a key it
       doesn't know. loadState defaults it on the way back in. */
    ...(state.prefs ? { prefs: state.prefs } : {}),
    savedAt,
  }

  /* This used to be `JSON.parse(JSON.stringify(payload, setReplacer))`, and
     the reason given was that structured clone would throw on a Set. It
     wouldn't — Set is structured-cloneable — so the round trip bought nothing
     and cost three full passes over the workspace on top of the clone
     IndexedDB was going to do anyway. Measured on one 200k-row table: 738ms to
     stringify, 313ms to parse back, 527ms more to size it. 1.58 SECONDS of
     frozen main thread, 600ms after you stop typing, on a tool whose whole
     claim is that it is faster than Excel.

     idbSet structured-clones on the way in. Hand it the payload. */
  if (!idbAvailable()) {
    return { status: SAVE_FAILED, error: 'This browser has no IndexedDB (private mode?). Changes are not being saved.' }
  }

  try {
    /* Refuse to overwrite a row another tab wrote after we last looked.

       `current.savedAt <= observedSavedAt` is the whole rule. A first save in
       a session where nothing was stored (observedSavedAt null, no row) passes
       because there is nothing to clobber. */
    const res = await idbSetIf(STORE_STATE, STATE_KEY, payload,
      current => mayOverwrite(current, observedSavedAt))
    if (!res.written) {
      return {
        status: SAVE_STALE,
        error: 'This workspace was changed in another tab. Reload to see the newer version — nothing here has been saved, so copy anything you need first.',
        bytes: null,
      }
    }
    observedSavedAt = savedAt
    /* NO QUOTA CHECK HERE ANY MORE, AND THAT IS THE POINT.

       This used to be `const bytes = ENFORCE ? roughBytes(payload) : null`
       followed by checkQuota('cloudBytes', bytes). It was harmless only
       because ENFORCE was false. The moment enforcement went on, every single
       autosave would have serialised the entire workspace to measure it —
       reintroducing, exactly, the 527ms measured on one 200k-row table that
       this file already removed once and has a long comment about above.

       Metering moved to where the document is being serialised ANYWAY: the
       cloud push in lib/sync.js, which has to turn the doc into JSON to send
       it. The size is then free rather than paid for twice, and the number is
       per-document instead of per-workspace, which is what the `docs` table
       actually meters. The authoritative figure is computed in Postgres by
       docs_before_write() regardless — a client-asserted size is a
       client-chosen quota.

       The local write is never gated by a quota. That is rule 1 in
       lib/limits.js, and it is now true by construction here rather than by
       remembering to keep it true. */
    return { status: SAVE_OK, bytes: null }
  } catch (err) {
    const quota = err?.name === 'QuotaExceededError' ||
      /quota/i.test(err?.message || '')
    /* A DataCloneError here means something genuinely unserialisable reached
       the workspace — a function, a DOM node, a class instance. The old JSON
       round trip would have silently dropped it; failing loudly is better. */
    return {
      status: quota ? SAVE_QUOTA : SAVE_FAILED,
      error: quota
        ? 'Out of browser storage. Recent changes have not been saved — export a notebook or delete some images to free space.'
        : `Could not save: ${err?.message || 'unknown error'}`,
      bytes: null,
    }
  }
}

/** The read failed. NOT the same as "there was nothing saved" — see below. */
export const LOAD_FAILED = 'load-failed'

/**
 * Load the workspace, migrating from localStorage v2 on first run.
 * @returns {Promise<{notebooks:Array, folders:Array, migrated:boolean}|null>}
 */
export async function loadState() {
  if (typeof window === 'undefined') return null

  if (idbAvailable()) {
    try {
      const found = await idbGet(STORE_STATE, STATE_KEY)
      if (found) {
        /* REFUSE A WORKSPACE FROM THE FUTURE.

           STATE_VERSION was written on every save and read on none, so an
           older build opening a newer workspace loaded it blind and then
           rewrote it as its own version, dropping every field it did not
           recognise. lib/templates.js has guarded this correctly since it was
           written — the SHAREABLE, reproducible artifact was protected while
           the irreplaceable one was not.

           This routes into the same refusal the read-failure path uses, which
           is exactly right: the workspace stays visible and nothing is
           overwritten. */
        if (isFutureVersion(found)) {
          console.warn('[DataStudio] workspace is v' + found.version + ', this build understands v' + STATE_VERSION)
          return {
            status: LOAD_FAILED,
            error: 'This workspace was saved by a newer version of DataStudio. Nothing has been changed — update the app, or open it in the tab that wrote it.',
            futureVersion: found.version,
          }
        }
        observedSavedAt = typeof found.savedAt === 'number' ? found.savedAt : null
        unknownKeys = collectUnknown(found)
        return { ...found, migrated: false }
      }
    } catch (err) {
      /* A FAILED READ IS NOT AN EMPTY STORE, and conflating the two is the
         most destructive bug this file can have.

         Both used to return null, and the caller reads null as "first run" —
         so it builds a fresh empty notebook, arms the autosave, and 600ms
         later writes that empty workspace over the real one. The row is then
         genuinely gone, and the prune that follows deletes the image and
         attachment bytes too. Silent, total, and indistinguishable from
         having never used the app.

         So the failure gets its own shape. The caller must refuse to enable
         saving when it sees this. */
      console.warn('[DataStudio] IndexedDB read failed:', err?.message)
      return { status: LOAD_FAILED, error: err?.message || 'unknown error' }
    }
  }

  // Nothing in IndexedDB — look for a v2 localStorage snapshot to migrate.
  const legacy = readLegacy()
  if (!legacy) return null

  try {
    await idbSet(STORE_STATE, STATE_KEY, { version: STATE_VERSION, ...legacy, savedAt: Date.now() })
    return { ...legacy, migrated: true }
  } catch {
    // Migration failed but we still have the data in memory — hand it back so
    // the user's work appears, even if this session can't persist.
    return { ...legacy, migrated: false }
  }
}

function readLegacy() {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || (!parsed.notebooks && !parsed.folders)) return null
    return { notebooks: parsed.notebooks || [], folders: parsed.folders || [] }
  } catch {
    return null
  }
}

/** Clear the workspace. Images are pruned separately by AppPage. */
export async function clearState() {
  try { await idbDelete(STORE_STATE, STATE_KEY) } catch { /* nothing to do */ }
  try { window.localStorage.removeItem(LEGACY_KEY) } catch { /* nothing to do */ }
  /* Forget what we had observed, or the next save in this tab would compare
     against a row that no longer exists and refuse itself. */
  observedSavedAt = null
  unknownKeys = {}
}

/** Re-exported so AppPage doesn't need to import from two modules. */
export { storageEstimate, workspaceByteSize }

/** Human-readable byte count. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * Debounce with a ceiling and a manual flush.
 *
 * THE PLAIN TRAILING DEBOUNCE THIS REPLACES LOST WORK TWO WAYS.
 *
 * 1. NO WAY TO FORCE IT. Nothing in the app called pagehide or
 *    visibilitychange, so closing the tab inside the 600ms window simply
 *    dropped the pending save. `flush()` is what those listeners need.
 *
 * 2. NO CEILING. Every call cleared the timer, so a stream of changes closer
 *    together than the delay postponed the write FOREVER. Renaming a block
 *    writes per keystroke; hold a key down and the workspace never saved at
 *    all. `maxWait` bounds it: however continuous the typing, a save happens
 *    at least every maxWait ms.
 *
 * `pending()` lets the caller arm a beforeunload prompt only when there is
 * genuinely something unwritten — the old handler was gated on a save having
 * already FAILED, i.e. on the case where the data was lost regardless.
 */
export function debounce(fn, ms = 500, { maxWait = 5000 } = {}) {
  let timer = null
  let firstCallAt = 0
  let lastArgs = null

  function run() {
    if (timer) { clearTimeout(timer); timer = null }
    firstCallAt = 0
    const args = lastArgs
    lastArgs = null
    if (args) fn(...args)
  }

  function wrapped(...args) {
    lastArgs = args
    const now = Date.now()
    if (!firstCallAt) firstCallAt = now
    if (timer) clearTimeout(timer)
    /* Never sit on a change for longer than maxWait, no matter how fast they
       keep arriving. */
    const wait = Math.max(0, Math.min(ms, firstCallAt + maxWait - now))
    timer = setTimeout(run, wait)
  }

  /** Run the pending call now, if there is one. Safe to call when idle. */
  wrapped.flush = () => { if (lastArgs) run() }
  /** True when a change has been recorded but not yet written. */
  wrapped.pending = () => lastArgs !== null
  /** Drop the pending call without running it. For unmount. */
  wrapped.cancel = () => { if (timer) clearTimeout(timer); timer = null; firstCallAt = 0; lastArgs = null }
  return wrapped
}
