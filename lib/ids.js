/*
  lib/ids.js
  --------------------------------------------------------------------------
  One place that mints identifiers, and one place that says what a device is.

  WHY THIS FILE EXISTS AT ALL

  Every id in this app used to be `${prefix}_${Date.now()}_${random}`, minted
  inline wherever it was needed. That was fine while the app was local-only:
  the only way two ids could collide was two things created in the same
  millisecond in the same tab, and page.js has a comment on nearly every one
  explaining the random salt that prevents it.

  Sync breaks that assumption. Ids now have to be unique across MACHINES, and
  `notebook_${Date.now()}` — which is what freshNotebook() minted, with no
  salt at all — is not. Two people (or one person on a laptop and a desktop)
  creating a notebook in the same millisecond produce the same id, and the
  first push wins while the second silently overwrites it. That is a lost
  afternoon with no error message anywhere.

  WHY THE IDS ARE NOT PLAIN UUIDs

  They are prefixed: `nb_<uuid>`, `fld_<uuid>`. The prefix is load-bearing in
  two places that already exist. lib/templatestore.js prunes assets per store
  and relies on `img_` / `pdf_` / `file_` prefixes to make an id from the wrong
  family inert rather than wrong; and a prefixed id is greppable in a jsonb
  column, which is the difference between a five-minute and a five-hour
  incident when something does go wrong in production.

  This is also why migration 0003 changes the Postgres primary keys from uuid
  to text rather than migrating existing ids. Every notebook already on
  someone's disk keeps the id it has — including the teleport link addresses
  (`nb/sheet/block`) stored INLINE inside text blocks, which a real id
  migration would have to find and rewrite in the same pass. Rewriting user
  content to satisfy a column type is the wrong trade.
  -------------------------------------------------------------------------- */

/* crypto.randomUUID needs a secure context (https or localhost). That covers
   dev and production, but not an http:// LAN address — which is exactly how
   someone tests on a phone against their laptop's dev server, so this is not
   a theoretical branch. The fallback uses getRandomValues, which has no such
   requirement, and only degrades to Math.random on a browser old enough that
   nothing else here works either. */
export function uuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = crypto.getRandomValues(new Uint8Array(16))
      b[6] = (b[6] & 0x0f) | 0x40
      b[8] = (b[8] & 0x3f) | 0x80
      const h = [...b].map(x => x.toString(16).padStart(2, '0'))
      return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
    }
  } catch { /* fall through */ }
  /* Last resort. Two Math.random() draws is ~104 bits, which is not a UUID's
     122 but is far past the point where collision is the thing to worry
     about. */
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** `nb_3f2a…`. The prefix is for humans and for prune-by-family; the uuid does the work. */
export const newId = (prefix) => `${prefix}_${uuid()}`

export const newNotebookId = () => newId('nb')
export const newFolderId = () => newId('fld')
export const newSheetFileId = () => newId('file')
export const newSheetId = () => newId('sheet')

/* ── device identity ──────────────────────────────────────────────────────

   `notebooks.device_id` records which machine wrote a revision. It is not
   security and it is not identity — it is the answer to "why is my laptop
   showing an older version", which the backend plan §7 correctly names as a
   whole new class of support ticket. Without it, a conflict copy says two
   versions exist and cannot say where either came from.

   localStorage, not IndexedDB, deliberately: this is read synchronously
   during a push, it is tiny, and it must NOT be part of the workspace
   snapshot — a workspace exported from one machine and imported on another
   would otherwise carry the first machine's identity with it and both would
   then claim to be the same device. */
const DEVICE_KEY = 'datastudio-device-id'
let cachedDevice = null

export function deviceId() {
  if (cachedDevice) return cachedDevice
  if (typeof localStorage === 'undefined') return 'unknown'
  try {
    let v = localStorage.getItem(DEVICE_KEY)
    if (!v) {
      v = newId('dev')
      localStorage.setItem(DEVICE_KEY, v)
    }
    cachedDevice = v
    return v
  } catch {
    /* Private mode with storage disabled. A per-session id is still more
       useful than none: conflicts within one session are attributed
       correctly, and the app has bigger problems than device naming if
       localStorage is gone. */
    cachedDevice = newId('dev')
    return cachedDevice
  }
}

/** Test seam. */
export function _resetDeviceId() { cachedDevice = null }
