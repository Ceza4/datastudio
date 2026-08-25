/*
  lib/idb.js
  --------------------------------------------------------------------------
  Minimal IndexedDB wrapper. No dependencies.

  WHY NOT localStorage
  localStorage gives roughly 5MB per origin for the whole app, is synchronous
  (so every save blocks the main thread while JSON.stringify walks the entire
  notebook), and stores strings only — a binary image has to be base64'd,
  inflating it 4:3. One 5MB photo is therefore ~6.7MB, i.e. more than the
  entire budget, and the write fails.

  IndexedDB fixes all three: tens to hundreds of MB depending on free disk,
  asynchronous, and it stores Blobs natively so image bytes are kept as-is
  with no base64 tax.

  WHY NOT idb-keyval
  It's excellent and tiny, but this is ~120 lines and the app currently has
  four runtime dependencies. Not worth a fifth.

  TWO STORES, ON PURPOSE
    'state'  — one row, the whole workspace snapshot (notebooks + folders)
    'images' — one row per image, holding a Blob

  Keeping images out of the state row is the point. If image bytes lived
  inside the notebook JSON, every 600ms autosave would rewrite every image,
  and loading a workspace would deserialise megabytes of pixels to render a
  text block. Blocks store an image id; the bytes are fetched separately and
  cached as object URLs.
  -------------------------------------------------------------------------- */

const DB_NAME = 'datastudio'
/* Bumped to 4 to add the `files` store (was 3, for `templates`).
   onupgradeneeded creates only what's MISSING, so an existing workspace gains
   the new store without touching a byte of state, images, pdfs or templates.
   That guard is the whole safety story: an upgrade that dropped and recreated
   a store would take a user's workspace with it, and there is no second copy
   of it anywhere. */
const DB_VERSION = 4
export const STORE_STATE = 'state'
export const STORE_IMAGES = 'images'
/* PDFs live in their own store rather than alongside images. Same reason
   images aren't in the state snapshot: a 20MB document must never be rewritten
   by the 600ms autosave, and keeping it out of `images` means pruneImages()
   can't reach it by accident. */
export const STORE_PDFS = 'pdfs'
/* §9.1 Builder. One row per saved template, keyed by template id — NOT one row
   holding them all, because a template carries a whole workspace's blocks and
   a single row would make saving the tenth template rewrite the other nine.
   Asset BYTES stay in `images`/`pdfs`; a template stores its own copied ids,
   the same way a notebook does. See lib/templatestore.js. */
export const STORE_TEMPLATES = 'templates'
/* §8 Files. Any attachment with no live renderer of its own — .docx, .zip,
   .mp4, .pptx — as an opaque blob keyed by file id. Its own store for the
   same reason pdfs has one: bytes must never reach the state snapshot, and a
   separate store means pruneImages() cannot reach these by accident.

   KNOWN LIMIT, and it is not a small one: this is one browser profile on one
   machine. A file attached here is invisible on another device and gone if
   the profile is cleared. Notes you would retype; a client's contract you
   would not. The UI has to say so until §11 gives these somewhere real to
   live. */
export const STORE_FILES = 'files'

let dbPromise = null

export function idbAvailable() {
  return typeof indexedDB !== 'undefined'
}

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!idbAvailable()) return reject(new Error('IndexedDB is unavailable'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE)
      if (!db.objectStoreNames.contains(STORE_IMAGES)) db.createObjectStore(STORE_IMAGES)
      if (!db.objectStoreNames.contains(STORE_PDFS)) db.createObjectStore(STORE_PDFS)
      if (!db.objectStoreNames.contains(STORE_TEMPLATES)) db.createObjectStore(STORE_TEMPLATES)
      if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES)
    }
    req.onsuccess = () => {
      const db = req.result
      // If another tab upgrades the schema, this connection must close or it
      // blocks that upgrade forever.
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    /* dbPromise is CLEARED before rejecting, on both failure paths.

       A rejected promise is still truthy, so caching one means the very first
       transient failure poisons the entire tab: every later idbGet/idbSet
       returns the same stale rejection and never retries. The realistic way
       in is the blocked case below — an old tab holding version 3 open while
       this one opens version 4 — which is a condition that CLEARS on its own
       the moment the other tab closes, and which the user could otherwise
       only escape by reloading. */
    req.onerror = () => { dbPromise = null; reject(req.error || new Error('Could not open IndexedDB')) }
    // Private-browsing Firefox can hang here rather than erroring.
    req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB is blocked by another tab')) }
  })
  return dbPromise
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('Transaction aborted'))
  }))
}

export const idbGet = (store, key) => tx(store, 'readonly', s => s.get(key))
export const idbSet = (store, key, value) => tx(store, 'readwrite', s => s.put(value, key))
export const idbDelete = (store, key) => tx(store, 'readwrite', s => s.delete(key))
export const idbKeys = (store) => tx(store, 'readonly', s => s.getAllKeys())

/**
 * Compare-and-set: read the current value and write only if `accept` says so.
 *
 * WHY A DEDICATED HELPER RATHER THAN idbGet + idbSet
 *
 * Two tabs on the same workspace used to be pure last-write-wins: each one
 * called idbSet unconditionally, so the tab whose autosave landed second
 * overwrote whatever the first had done. A get followed by a separate set
 * does not fix that — they are two transactions, and the other tab's write
 * can land in the gap between them. The check has to happen INSIDE the
 * transaction that does the write, which is what this is for.
 *
 * `accept(current)` returns true to proceed. Resolves
 * `{ written: true }` or `{ written: false, current }` so the caller can tell
 * a refusal from a failure — a refusal is not an error, it is another tab
 * having got there first, and the user needs to be told something different.
 */
export function idbSetIf(store, key, value, accept) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite')
    const os = t.objectStore(store)
    const read = os.get(key)
    let outcome = { written: false, current: undefined }
    read.onsuccess = () => {
      const current = read.result
      if (accept(current)) {
        os.put(typeof value === 'function' ? value(current) : value, key)
        outcome = { written: true }
      } else {
        outcome = { written: false, current }
      }
    }
    read.onerror = () => reject(read.error)
    t.oncomplete = () => resolve(outcome)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('Transaction aborted'))
  }))
}
export const idbClear = (store) => tx(store, 'readwrite', s => s.clear())

/**
 * Ask the browser not to evict this origin's storage.
 *
 * By default IndexedDB is "best-effort": under disk pressure the browser may
 * discard it for origins that haven't asked to be kept. For an app whose only
 * copy of your work is local, that's the difference between a storage layer
 * and a cache. `navigator.storage.persist()` upgrades the origin to
 * "persistent", after which data survives until the user deletes it.
 *
 * The browser decides. Chrome grants it silently once a site looks
 * established (bookmarked, installed, or with enough engagement); Firefox may
 * prompt; Safari grants it but still evicts after ~7 days of no visits.
 * A refusal is not an error — it's information the user should see, which is
 * why the result is returned rather than swallowed.
 *
 * @returns {Promise<{supported:boolean, persisted:boolean}>}
 */
export async function requestPersistence() {
  try {
    if (!navigator?.storage?.persist || !navigator?.storage?.persisted) {
      return { supported: false, persisted: false }
    }
    // Don't re-ask if it's already granted — repeated calls are wasteful and
    // in Firefox can re-prompt.
    if (await navigator.storage.persisted()) return { supported: true, persisted: true }
    const granted = await navigator.storage.persist()
    return { supported: true, persisted: !!granted }
  } catch {
    return { supported: false, persisted: false }
  }
}

/**
 * Real usage numbers from the browser, not a guess.
 * `navigator.storage.estimate()` reports bytes actually used and the quota
 * the browser is currently willing to grant this origin.
 * @returns {Promise<{usage:number, quota:number, pct:number}|null>}
 */
export async function storageEstimate() {
  try {
    if (!navigator?.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota, pct: quota ? usage / quota : 0 }
  } catch {
    return null
  }
}

/** Total bytes held in the images store — shown in the sidebar. */
export async function imagesByteSize() {
  try {
    const keys = await idbKeys(STORE_IMAGES)
    let total = 0
    for (const k of keys) {
      const rec = await idbGet(STORE_IMAGES, k)
      total += rec?.blob?.size || 0
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Delete image records that no notebook block references any more.
 * Called after a save. Without this, deleting an image block would orphan its
 * bytes and the workspace would grow forever.
 */
export async function pruneImages(referencedIds) {
  try {
    /* AN EMPTY KEEP-SET REFUSES, it does not delete everything.

       prunePdfs has had this guard; this function did not, and the asymmetry
       is what decided how much damage a bad keep-set could do. Every way of
       arriving here with an empty list — a failed state read that looked like
       a first run, a prune racing an in-flight save, a bug upstream — means
       "something went wrong", far more often than it means "the user
       genuinely deleted every image they own".

       The cost of being wrong the other way is orphaned bytes until the next
       real prune. The cost of being wrong this way is a canvas full of
       missing-image boxes and no copy anywhere. */
    const ids = Array.isArray(referencedIds) ? referencedIds : [...(referencedIds || [])]
    if (ids.length === 0) return 0
    const keep = new Set(ids)
    const keys = await idbKeys(STORE_IMAGES)
    const doomed = keys.filter(k => !keep.has(k))
    for (const k of doomed) await idbDelete(STORE_IMAGES, k)
    return doomed.length
  } catch {
    return 0
  }
}
