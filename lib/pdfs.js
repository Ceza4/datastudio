/*
  lib/pdfs.js
  --------------------------------------------------------------------------
  PDF storage and validation. Mirrors lib/images.js, with two differences that
  matter.

  ORIGINAL AND EDITS ARE SEPARATE, AND THE ORIGINAL IS NEVER WRITTEN
  A record holds immutable `bytes` plus an `edits` array of overlay entries.
  Nothing ever mutates the source document.

  This is the most important decision in the whole PDF feature, so it's worth
  saying why rather than just doing it. Editing bytes in place means: undo has
  to reverse a binary diff, "revert to original" is impossible, a crash
  mid-write leaves a corrupt file where the user's document used to be, and
  every future tool has to be correct on the first try because there's nothing
  to fall back to. With an overlay, every edit is reversible by construction,
  reverting is deleting a row, and the source bytes are as safe as the moment
  they were imported. Export applies the overlay to a COPY.

  The cost is that exporting is more work than saving. That's the right trade
  for a tool whose pitch is that your document never leaves your machine and
  never gets damaged.

  VALIDATION IS BY CONTENT, NOT BY EXTENSION
  A file called report.pdf can be anything. `%PDF-` at offset 0 is the actual
  test — and because some producers prepend junk, the spec tolerates the
  header appearing slightly later, so a short window is scanned.
  -------------------------------------------------------------------------- */

import { STORE_PDFS, idbGet, idbSet, idbDelete, idbKeys } from './idb.js'
import { checkQuota, quotaMessage } from './limits.js'

/* 25MB. Above this, rendering stalls the main thread on page changes and the
   browser's structured-clone into IndexedDB becomes visible as a freeze. It's
   a limit of comfort, not of correctness — hence the message says so. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024

export const PDF_EXTS = ['.pdf']
export const PDF_MIME = 'application/pdf'

/* The header may legally be preceded by junk; Acrobat itself accepts an
   offset of up to 1024 bytes. Scanning a small window catches files that are
   genuinely valid while still rejecting a renamed .zip. */
const HEADER_SCAN_BYTES = 1024
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]     // %PDF-

/**
 * Is this actually a PDF?
 * @returns {{ok:true, offset:number, version:string}|{ok:false, reason:string}}
 */
export function sniffPdf(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return { ok: false, reason: 'No file data.' }
  if (bytes.length < 8) return { ok: false, reason: 'That file is too small to be a PDF.' }

  const limit = Math.min(bytes.length - PDF_SIGNATURE.length, HEADER_SCAN_BYTES)
  for (let off = 0; off <= limit; off++) {
    let hit = true
    for (let i = 0; i < PDF_SIGNATURE.length; i++) {
      if (bytes[off + i] !== PDF_SIGNATURE[i]) { hit = false; break }
    }
    if (!hit) continue
    // "%PDF-1.7" — the two chars after the dash.
    const version = String.fromCharCode(bytes[off + 5] || 0, bytes[off + 6] || 0, bytes[off + 7] || 0).trim()
    return { ok: true, offset: off, version: /^\d/.test(version) ? version : 'unknown' }
  }
  return { ok: false, reason: 'That file isn’t a PDF — it has no %PDF header.' }
}

/**
 * Encrypted PDFs need a password before pdf.js can read them, and the failure
 * arrives as an unhelpful exception several layers down. Detecting it here
 * lets the import say something true instead.
 *
 * Deliberately a hint, not a verdict: /Encrypt can appear inside a stream in
 * a file that isn't encrypted, so this only ever downgrades to a warning.
 */
export function looksEncrypted(bytes) {
  if (!bytes?.length) return false
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096))
  const text = String.fromCharCode(...tail.subarray(0, Math.min(tail.length, 4096)))
  return /\/Encrypt\s/.test(text)
}

export const newPdfId = () =>
  `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

export function formatPdfSize(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Validate and read a File into a record ready for storage.
 * Throws with a message meant to be shown to the user — every path through
 * here has one, because "import failed" with no reason is the thing that
 * makes people give up on a feature.
 */
export async function processPdfFile(file) {
  if (!file) throw new Error('No file was provided.')

  if (file.size > MAX_PDF_BYTES) {
    throw new Error(
      `That PDF is ${formatPdfSize(file.size)}. The limit is ${formatPdfSize(MAX_PDF_BYTES)} — ` +
      `above that, page rendering stutters badly enough to be unusable.`
    )
  }
  if (file.size === 0) throw new Error('That file is empty.')

  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)

  const sniff = sniffPdf(bytes)
  if (!sniff.ok) {
    throw new Error(
      `${sniff.reason} Renaming a file to .pdf doesn’t convert it — DataStudio checks the contents, not the name.`
    )
  }

  return {
    bytes,
    name: (file.name || 'document.pdf').replace(/\.[^.]*$/, ''),
    size: file.size,
    pdfVersion: sniff.version,
    encrypted: looksEncrypted(bytes),
    importedAt: Date.now(),
  }
}

/* ── store ───────────────────────────────────────────────────────────── */

/**
 * Write a document. `bytes` go in once and are never rewritten; only `edits`
 * changes after this.
 */
export async function putPdf(id, record) {
  /* Metering hook, same contract as images: it never blocks the LOCAL write.
     The free tier limits cloud sync, never your own disk. */
  const quota = await checkQuota('pdfBytes', record?.bytes?.length || 0)
  await idbSet(STORE_PDFS, id, {
    bytes: record.bytes,
    name: record.name,
    size: record.size,
    pdfVersion: record.pdfVersion,
    encrypted: !!record.encrypted,
    importedAt: record.importedAt || Date.now(),
    edits: record.edits || [],
    editsRev: record.editsRev || 0,
  })
  return quota.ok ? id : { id, warning: quotaMessage(quota) }
}

export const getPdf = id => (id ? idbGet(STORE_PDFS, id) : Promise.resolve(null))
export const deletePdf = id => (id ? idbDelete(STORE_PDFS, id) : Promise.resolve())

/**
 * Replace the overlay without touching the source bytes.
 * Read-modify-write rather than a whole-record put, so a caller holding a
 * stale copy of `bytes` can't write it back over the real one.
 */
export async function putPdfEdits(id, edits) {
  const rec = await getPdf(id)
  if (!rec) return null
  const next = { ...rec, edits: Array.isArray(edits) ? edits : [], editsRev: (rec.editsRev || 0) + 1 }
  await idbSet(STORE_PDFS, id, next)
  return next.editsRev
}

/** Discard every overlay entry. The source document is untouched, so this is total. */
export const revertPdf = id => putPdfEdits(id, [])

/** Total bytes held in the pdfs store — for the storage meter. */
export async function pdfsByteSize() {
  try {
    const keys = await idbKeys(STORE_PDFS)
    let total = 0
    for (const k of keys) {
      const rec = await idbGet(STORE_PDFS, k)
      total += rec?.bytes?.length || rec?.size || 0
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Drop documents no block references any more.
 *
 * Guarded against the empty case on purpose. pruneImages has the same shape
 * and the same hazard: if a caller ever computes the referenced set from a
 * half-loaded workspace and passes an empty array, an unguarded prune deletes
 * everything. Nothing referenced means nothing to do, not delete-all — the
 * cost of a stale orphan is some wasted space, the cost of the alternative is
 * someone's documents.
 */
export async function prunePdfs(referencedIds) {
  try {
    const ids = Array.isArray(referencedIds) ? referencedIds : []
    if (ids.length === 0) return 0
    const keep = new Set(ids)
    const keys = await idbKeys(STORE_PDFS)
    const doomed = keys.filter(k => !keep.has(k))
    for (const k of doomed) await idbDelete(STORE_PDFS, k)
    return doomed.length
  } catch {
    return 0
  }
}

/* ── overlay entries ─────────────────────────────────────────────────── */

/**
 * Every edit is one of these. Coordinates are ALWAYS PDF space (see
 * lib/pdfspace.js), never screen — that's what makes an annotation survive
 * zooming, resizing the block and rotating the page.
 */
/* 'replace' is a composite: cover the original run, draw new text on the same
   baseline. One entry rather than a whiteout plus a text edit, because they
   have to undo together — undoing half of a replacement leaves either blank
   paper or two sentences on top of each other. See lib/pdfreplace.js. */
export const EDIT_KINDS = ['text', 'whiteout', 'highlight', 'ink', 'image', 'replace']

export function makeEdit(kind, page, data = {}) {
  if (!EDIT_KINDS.includes(kind)) throw new Error(`Unknown edit kind: ${kind}`)
  return {
    id: `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    page: Math.max(0, Math.floor(Number(page) || 0)),
    createdAt: Date.now(),
    ...data,
  }
}

/** The overlay entries that belong to one page, in creation order. */
export const editsForPage = (edits, page) =>
  (edits || []).filter(e => e && e.page === page)
