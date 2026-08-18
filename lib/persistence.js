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

import { idbGet, idbSet, idbDelete, STORE_STATE, idbAvailable, storageEstimate } from './idb.js'
import { checkQuota, quotaMessage, ENFORCE } from './limits.js'

const LEGACY_KEY = 'datastudio-state-v2'
const STATE_KEY = 'workspace'

/* v3 → v4 adds `prefs`. There is no migration step: a v3 payload simply has no
   prefs key, and migratePrefs() falls back to the standalone theme mirror that
   every existing workspace already has. Bumping the number is what makes that
   silence deliberate rather than accidental. */
export const STATE_VERSION = 4

/* Save outcomes. Callers branch on these rather than on exception types. */
export const SAVE_OK = 'ok'
export const SAVE_QUOTA = 'quota'
export const SAVE_FAILED = 'failed'

/**
 * Persist the workspace.
 * @returns {Promise<{status:string, error?:string, bytes?:number}>}
 *          Never throws — the caller decides what a failure means for the UI.
 */
export async function saveState(state) {
  const payload = {
    version: STATE_VERSION,
    notebooks: state.notebooks || [],
    folders: state.folders || [],
    /* v4. Omitted rather than written as null when absent, so a downgrade to a
       v3 build reads the workspace unchanged instead of tripping over a key it
       doesn't know. loadState defaults it on the way back in. */
    ...(state.prefs ? { prefs: state.prefs } : {}),
    savedAt: Date.now(),
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
    await idbSet(STORE_STATE, STATE_KEY, payload)
    /* Metering hook for the future cloud push. The LOCAL write above has
       already happened and is never gated — a quota result only affects
       whether this snapshot is eligible to sync.

       Sizing the payload means serialising it, so it is deferred until
       something actually enforces: lib/limits.js ships with ENFORCE false, and
       the sidebar meter reads storageEstimate() from the browser rather than
       this number. The call site is what mattered, and it is still here. */
    const bytes = ENFORCE ? roughBytes(payload) : null
    const quota = await checkQuota('cloudBytes', bytes ?? 0)
    return quota.ok
      ? { status: SAVE_OK, bytes }
      : { status: SAVE_OK, bytes, syncWarning: quotaMessage(quota) }
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

/**
 * Load the workspace, migrating from localStorage v2 on first run.
 * @returns {Promise<{notebooks:Array, folders:Array, migrated:boolean}|null>}
 */
export async function loadState() {
  if (typeof window === 'undefined') return null

  if (idbAvailable()) {
    try {
      const found = await idbGet(STORE_STATE, STATE_KEY)
      if (found) return { ...found, migrated: false }
    } catch (err) {
      console.warn('[DataStudio] IndexedDB read failed, trying legacy store:', err.message)
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
}

/** Approximate serialised size, for the sidebar meter. */
function roughBytes(obj) {
  try { return new Blob([JSON.stringify(obj)]).size } catch { return 0 }
}

/** Re-exported so AppPage doesn't need to import from two modules. */
export { storageEstimate }

/** Human-readable byte count. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * Debounce helper. Used to wrap saveState so it only fires once the user has
 * stopped making changes for a moment.
 */
export function debounce(fn, ms = 500) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
