/*
  lib/files.js
  --------------------------------------------------------------------------
  §8 — a generic attachment. The last resort in the import chain.

  WHAT THIS IS FOR
  Spreadsheets, PDFs, images and markdown all have live blocks of their own.
  Everything else — .docx, .zip, .mp4, .pptx, .key, .sql — had nowhere to go
  and was refused with a message listing the formats that were not it. A file
  block holds those: icon, name, size, and a download.

  WHAT A BROWSER CANNOT DO, SAID PLAINLY
  OneNote can hand a file to the operating system and let the right app open
  it. A web page cannot. It can download the file, or preview it if it happens
  to know the format. That is roughly 90% of the OneNote experience and the
  missing 10% is not a matter of effort — it is the sandbox. The UI should say
  "Download" and mean it, rather than say "Open" and produce a download.

  BYTES NEVER ENTER THE STATE SNAPSHOT
  Same rule as images and pdfs, and the same reason: the workspace autosaves
  600ms after you stop typing, and a 40MB attachment rewritten on every one of
  those is a frozen main thread. The block carries an id; the blob lives in
  STORE_FILES.

  VALIDATION IS BY SIZE AND NOTHING ELSE
  Deliberately. This store's whole job is the formats we do NOT understand, so
  sniffing content would be pretending to a knowledge the feature is defined
  by not having. Anything that comes back out goes back out as the exact bytes
  that came in, with a download attribute and a generic MIME type — never
  rendered, never executed, never handed to an <iframe>.
  -------------------------------------------------------------------------- */

import { STORE_FILES, idbGet, idbSet, idbDelete, idbKeys } from './idb.js'

/* 50MB. Twice the PDF limit, because nothing here is rendered — the cost is
   one structured clone in and one blob URL out, not a render loop. Past this
   the clone into IndexedDB is a visible freeze on a mid-range laptop. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024

/* Extensions that have a real block of their own. A file arriving with one of
   these should never reach this module — if it does, the router upstream has
   a gap, and silently burying it as a generic attachment would hide that. */
export const HANDLED_ELSEWHERE = new Set([
  '.xlsx', '.xlsm', '.xlsb', '.xls', '.csv', '.tsv', '.txt', '.ods',
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
  '.md', '.markdown', '.mdown', '.mkd',
])

export const extOf = name => {
  const m = /\.[^./\\]+$/.exec(String(name || ''))
  return m ? m[0].toLowerCase() : ''
}

/** A short, human label for the kind of thing this is. Used on the chip. */
export function fileKind(name) {
  const e = extOf(name).slice(1)
  if (!e) return 'File'
  return e.length <= 4 ? e.toUpperCase() : e[0].toUpperCase() + e.slice(1)
}

/* Icon per family. Falls back to a generic document rather than to nothing:
   a chip with no icon reads as a broken chip, not as an unknown format. */
const ICON_BY_EXT = {
  '.doc': 'format-word', '.docx': 'format-word', '.dotx': 'format-word', '.rtf': 'format-word', '.odt': 'format-word',
  '.ppt': 'block-image', '.pptx': 'block-image', '.key': 'block-image', '.odp': 'block-image',
  '.zip': 'nav-folder', '.rar': 'nav-folder', '.7z': 'nav-folder', '.tar': 'nav-folder', '.gz': 'nav-folder',
}
export const fileIcon = name => ICON_BY_EXT[extOf(name)] || 'block-text'

let seq = 0
export function newFileId() {
  /* Date.now() alone is not unique — a multi-file drop imports several inside
     the same millisecond, and this id is the only key the bytes have. The
     workbook importer learned this the hard way. */
  seq = (seq + 1) % 1e6
  return `file_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Validate and normalise one File for storage.
 * @returns {Promise<{blob:Blob,name:string,size:number,type:string,ext:string}>}
 * @throws  with a message written for a person, not a log
 */
export async function processFile(file) {
  if (!file) throw new Error('No file was given.')
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`)
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    throw new Error(`"${file.name}" is ${mb}MB. Attachments are capped at 50MB so the workspace stays quick to save.`)
  }
  return {
    /* Copied into a plain Blob rather than kept as the File. A File carries a
       live handle to something on disk; once that path changes the reference
       is stale, and a workspace that quietly loses an attachment because a
       folder was renamed is worse than one that never took it. */
    blob: file.slice(0, file.size, file.type || 'application/octet-stream'),
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    ext: extOf(file.name),
  }
}

export async function putFile(id, record) {
  await idbSet(STORE_FILES, id, { ...record, addedAt: Date.now() })
  return id
}

export async function getFile(id) {
  if (!id) return null
  try { return await idbGet(STORE_FILES, id) } catch { return null }
}

export async function deleteFile(id) {
  if (!id) return
  try { await idbDelete(STORE_FILES, id) } catch { /* already gone is fine */ }
}

/**
 * Drop stored bytes no block references any more.
 *
 * Takes the set of ids STILL IN USE and deletes everything else — the
 * inverse, "delete the ids of blocks that were removed", cannot be written
 * correctly, because a duplicated block shares its attachment id with the
 * original and deleting one would empty both.
 */
export async function pruneFiles(idsInUse) {
  const keep = idsInUse instanceof Set ? idsInUse : new Set(idsInUse || [])
  /* An empty keep-set REFUSES rather than deleting everything — the same
     guard prunePdfs has always had and pruneImages was missing. Arriving here
     with nothing to keep almost always means something upstream failed, not
     that every attachment was deliberately removed, and these are the bytes
     the user is least able to reproduce. */
  if (keep.size === 0) return 0
  let removed = 0
  try {
    const keys = await idbKeys(STORE_FILES)
    for (const k of keys) {
      if (!keep.has(k)) { await idbDelete(STORE_FILES, k); removed++ }
    }
  } catch { /* pruning is housekeeping — never let it break a save */ }
  return removed
}

/** Bytes as something a person can read. */
export function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * Hand the file to the browser's download machinery.
 *
 * The object URL is revoked on a timer rather than immediately: revoking in
 * the same tick races the download starting, and the failure mode is a
 * download that silently does nothing in Safari. A few hundred ms is
 * imperceptible and removes the race entirely.
 */
export function downloadFile(record) {
  if (!record?.blob) return false
  const url = URL.createObjectURL(record.blob)
  const a = document.createElement('a')
  a.href = url
  /* `download` is what stops the browser NAVIGATING to the blob. Without it a
     .html or .svg attachment would render in this origin, which is the one
     thing a store of unexamined files must never allow. */
  a.download = record.name || 'download'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 800)
  return true
}
