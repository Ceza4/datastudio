/*
  lib/templatestore.js
  --------------------------------------------------------------------------
  §9.1 Builder — the async half that lib/templates.js deliberately does not
  contain.

  templates.js is pure: it reads a notebook and writes a notebook, with no
  IndexedDB and no bytes. That is what makes it testable in a plain Node
  process. This file is the other side of that line — it owns the store, it
  owns the asset bytes, and it is the only thing in Builder that can fail for
  reasons that have nothing to do with the user's input.

  ── WHY EVERY FUNCTION RETURNS A RESULT ─────────────────────────────────

  Same reason lib/persistence.js does, and it is not a style preference. v2
  persistence threw on a full quota, the catch logged a console.warn nobody
  has open, and people kept working for hours on a workspace that had stopped
  saving. A thrown error in a UI callback is a silent failure with extra
  steps. So: `{ status, error }`, the caller branches, and the panel says what
  happened.

  ── WHY THE BYTES ARE COPIED, TWICE ─────────────────────────────────────

  A block carries an image id, not an image. So a template built by pointing
  at the notebook's ids is not a template at all — it is a set of references
  into a workspace the user is free to edit and delete. Delete the source
  notebook's image and every template built from it renders a missing-asset
  box, with nothing to say what went wrong.

  So saveTemplate copies the bytes of every asset in collectAssetIds() under
  fresh ids and rewrites the template's blocks to point at those. The template
  then owns its own pixels and cannot be gutted from outside.

  instantiate copies them AGAIN, for the same reason one step further out: two
  workspaces made from one template must not share bytes, or cropping the
  image in one silently crops it in the other — lib/images.js writes crops and
  rotations back to the same record.

  ── WHY templateAssetIds() EXISTS ───────────────────────────────────────

  AppPage prunes image and PDF bytes after every save, keeping only what a
  notebook block still references. A template's copies are referenced by no
  notebook, so the first autosave after saving a template would delete exactly
  the bytes this file just went to the trouble of copying. The keep-set has to
  include them, and this is what hands them over.

  Assets belonging to a JUST-deleted template are held in a short grace window
  as well, because a delete offers UNDO for seven seconds and the autosave
  fires after 600ms. Without it, undoing a template delete brings the template
  back with its pictures already collected.
  -------------------------------------------------------------------------- */

import {
  idbGet, idbSet, idbDelete, idbKeys, idbAvailable,
  STORE_TEMPLATES, STORE_IMAGES, STORE_PDFS,
} from './idb.js'
import {
  templateFromNotebook, instantiateTemplate, validateTemplate, collectAssetIds,
} from './templates.js'

/* Outcomes. Callers branch on these rather than on exception types, exactly as
   they do with SAVE_OK / SAVE_QUOTA / SAVE_FAILED. */
export const TPL_OK = 'ok'
export const TPL_MISSING = 'missing'
export const TPL_INVALID = 'invalid'
export const TPL_QUOTA = 'quota'
export const TPL_FAILED = 'failed'

const NO_IDB = 'This browser has no IndexedDB (private mode?), so templates cannot be saved.'

/* Asset ids for the copies. Deliberately the same SHAPE lib/images.js and
   lib/pdfs.js produce, so nothing downstream can tell a template's copy from a
   notebook's original — that indistinguishability is the point. Injectable so
   tests can name an exact value instead of pattern-matching and hoping. */
export const defaultAssetId = prefix =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

/* Assets whose template was deleted in this session, and when. They stay in
   the keep-set until the undo window has certainly closed; after that the next
   autosave collects them. Memory-only on purpose — a reload takes the undo
   with it, so there is nothing left to protect. 30s rather than the toast's 7
   so a slow machine cannot lose the race. */
const UNDO_GRACE_MS = 30_000
const graceAssets = []

/* Assets that have JUST been written and are not yet referenced by anything.

   saveTemplate copies bytes into the images and pdfs stores and only writes
   the template record that points at them afterwards. Between those two
   moments the copies are reachable from nothing: templateAssetIds() reports
   ids found in STORED template records, so a concurrent autosave prune saw
   them as garbage and deleted them. Copying a 25MB PDF takes hundreds of
   milliseconds — comfortably longer than the 600ms autosave a user's previous
   edit already has pending — so this was not a narrow race.

   The existing comment in saveTemplate reasoned about a crash halfway leaving
   orphans, which is true and harmless. It did not reason about a prune running
   DURING the copy, which is neither.

   Same shape as graceAssets above: memory-only, time-bounded, and read by
   templateAssetIds so both live in the keep-set. */
const NEW_ASSET_GRACE_MS = 60_000
const freshAssets = []

/** Protect an id from the collector until it is certainly referenced. */
function holdFresh(store, id) {
  freshAssets.push({ store, id, at: Date.now() })
}

function fail(err) {
  const quota = err?.name === 'QuotaExceededError' || /quota/i.test(err?.message || '')
  return quota
    ? { status: TPL_QUOTA, error: 'Out of browser storage. The template was not saved — delete some images or a PDF to free space.' }
    : { status: TPL_FAILED, error: `Templates are unavailable: ${err?.message || 'unknown error'}` }
}

/* ── copying bytes ───────────────────────────────────────────────────── */

/**
 * Copy every asset record named by `ids` under a fresh id.
 *
 * Returns `{ map, missing }`. `missing` counts ids whose bytes were already
 * gone — that block was ALREADY showing a missing-asset box, so refusing the
 * whole save over it would block someone from templating a workspace they are
 * happily using. It is reported instead, because producing a quietly
 * incomplete template is the failure this whole file exists to prevent.
 */
async function copyAssets(store, prefix, ids, newId) {
  const map = Object.create(null)
  let missing = 0
  for (const id of ids || []) {
    const rec = await idbGet(store, id)
    /* A fresh id is allocated even when the bytes are gone. Leaving the
       ORIGINAL id in place would look harmless and is worse: the template
       would then share an id with the source notebook, and pruning that
       notebook's block would be pruning the template's asset. */
    const next = newId(prefix)
    map[id] = next
    if (!rec) { missing++; continue }
    /* Held BEFORE the write, not after: a prune that lands between the write
       and the hold would still collect it. */
    holdFresh(store, next)
    await idbSet(store, next, rec)
  }
  return { map, missing }
}

/** Rewrite every block's imageId/pdfId through the two maps, in place. */
function remapAssetIds(sheets, images, pdfs) {
  for (const sheet of sheets || []) {
    for (const b of sheet.blocks || []) {
      if (b?.imageId && images[b.imageId]) b.imageId = images[b.imageId]
      if (b?.pdfId && pdfs[b.pdfId]) b.pdfId = pdfs[b.pdfId]
    }
  }
}

/* ── writing ─────────────────────────────────────────────────────────── */

/**
 * Snapshot the notebook as a template, copy its assets, and store it.
 *
 * @param {object} notebook
 * @param {{name?:string, description?:string, newAssetId?:Function}} opts
 * @returns {Promise<{status:string, template?:object, missingAssets?:number, error?:string}>}
 */
export async function saveTemplate(notebook, { name, description = '', newAssetId = defaultAssetId } = {}) {
  if (!idbAvailable()) return { status: TPL_FAILED, error: NO_IDB }
  if (!notebook || !Array.isArray(notebook.sheets)) {
    return { status: TPL_INVALID, error: 'There is no workspace open to save.' }
  }

  let template
  try {
    template = templateFromNotebook(notebook, { name, description })
  } catch (err) {
    return { status: TPL_INVALID, error: err?.message || 'That workspace could not be saved as a template.' }
  }

  try {
    const want = collectAssetIds(template)
    const images = await copyAssets(STORE_IMAGES, 'img', want.images, newAssetId)
    const pdfs = await copyAssets(STORE_PDFS, 'pdf', want.pdfs, newAssetId)

    remapAssetIds(template.sheets, images.map, pdfs.map)
    template.assets = collectAssetIds(template)

    /* The record is written LAST, after every byte it depends on is already
       down. A failure halfway leaves orphaned copies that no template claims,
       and the next prune collects them — whereas a record written first and
       then abandoned would be a template permanently pointing at nothing. */
    await idbSet(STORE_TEMPLATES, template.id, template)
    return { status: TPL_OK, template, missingAssets: images.missing + pdfs.missing }
  } catch (err) {
    return fail(err)
  }
}

/** Put a deleted template back exactly as it was. The UNDO half of a delete. */
export async function restoreTemplate(template) {
  if (!idbAvailable()) return { status: TPL_FAILED, error: NO_IDB }
  if (!template?.id) return { status: TPL_INVALID, error: 'There is nothing to restore.' }
  try {
    await idbSet(STORE_TEMPLATES, template.id, template)
    // Back under a real template's ownership, so the grace entry is spent.
    for (let i = graceAssets.length - 1; i >= 0; i--) {
      if (graceAssets[i].templateId === template.id) graceAssets.splice(i, 1)
    }
    return { status: TPL_OK, template }
  } catch (err) {
    return fail(err)
  }
}

/* ── reading ─────────────────────────────────────────────────────────── */

/**
 * Every stored template, newest first.
 * @returns {Promise<{status:string, templates:Array, error?:string}>}
 */
export async function listTemplates() {
  if (!idbAvailable()) return { status: TPL_FAILED, error: NO_IDB, templates: [] }
  try {
    const keys = await idbKeys(STORE_TEMPLATES)
    const out = []
    for (const k of keys) {
      const t = await idbGet(STORE_TEMPLATES, k)
      if (t) out.push(t)
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return { status: TPL_OK, templates: out }
  } catch (err) {
    return { ...fail(err), templates: [] }
  }
}

/** One template by id. A missing id is a result, not an exception. */
export async function getTemplate(id) {
  if (!idbAvailable()) return { status: TPL_FAILED, error: NO_IDB }
  try {
    const t = await idbGet(STORE_TEMPLATES, id)
    if (!t) return { status: TPL_MISSING, error: 'That template is no longer here.' }
    return { status: TPL_OK, template: t }
  } catch (err) {
    return fail(err)
  }
}

/**
 * Every asset id the stored templates depend on, plus the ones a delete is
 * still holding open for UNDO. AppPage adds these to its prune keep-set.
 *
 * A caller must SKIP pruning entirely if this reports anything but TPL_OK:
 * an incomplete keep-set is not a smaller prune, it is a delete.
 */
export async function templateAssetIds() {
  const cutoff = Date.now() - UNDO_GRACE_MS
  const images = new Set()
  const pdfs = new Set()
  for (let i = graceAssets.length - 1; i >= 0; i--) {
    if (graceAssets[i].at < cutoff) { graceAssets.splice(i, 1); continue }
    graceAssets[i].images.forEach(x => images.add(x))
    graceAssets[i].pdfs.forEach(x => pdfs.add(x))
  }

  /* Bytes written in the last minute that nothing references yet. Expired
     entries are dropped on the way past — by then the template record that
     points at them has certainly been written, or the save failed and they are
     genuinely garbage. */
  const freshCutoff = Date.now() - NEW_ASSET_GRACE_MS
  for (let i = freshAssets.length - 1; i >= 0; i--) {
    const f = freshAssets[i]
    if (f.at < freshCutoff) { freshAssets.splice(i, 1); continue }
    if (f.store === STORE_IMAGES) images.add(f.id)
    else if (f.store === STORE_PDFS) pdfs.add(f.id)
  }

  if (!idbAvailable()) return { status: TPL_FAILED, error: NO_IDB, images: [], pdfs: [] }
  const res = await listTemplates()
  if (res.status !== TPL_OK) return { ...res, images: [], pdfs: [] }
  for (const t of res.templates) {
    const a = collectAssetIds(t)
    a.images.forEach(x => images.add(x))
    a.pdfs.forEach(x => pdfs.add(x))
  }
  return { status: TPL_OK, images: [...images], pdfs: [...pdfs] }
}

/* ── editing ─────────────────────────────────────────────────────────── */

/** Rename in place. Read-modify-write, so nothing else in the record is lost. */
export async function renameTemplate(id, name) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return { status: TPL_INVALID, error: 'A template needs a name.' }

  const found = await getTemplate(id)
  if (found.status !== TPL_OK) return found
  try {
    const next = { ...found.template, name: trimmed }
    await idbSet(STORE_TEMPLATES, id, next)
    return { status: TPL_OK, template: next }
  } catch (err) {
    return fail(err)
  }
}

/**
 * Delete a template, and hand its record back so UNDO can put it back.
 *
 * The asset bytes are NOT deleted here. They go on the grace list instead:
 * collecting them immediately would make UNDO restore a template whose
 * pictures are gone, which is a worse outcome than some bytes surviving half
 * a minute longer than they had to.
 */
export async function deleteTemplate(id) {
  const found = await getTemplate(id)
  if (found.status !== TPL_OK) return found
  try {
    await idbDelete(STORE_TEMPLATES, id)
    const a = collectAssetIds(found.template)
    graceAssets.push({ templateId: id, images: a.images, pdfs: a.pdfs, at: Date.now() })
    return { status: TPL_OK, template: found.template }
  } catch (err) {
    return fail(err)
  }
}

/* ── instantiating ───────────────────────────────────────────────────── */

/**
 * Build a fresh notebook from a stored template, with its own copy of every
 * asset. The template is left untouched.
 *
 * @param {string} id
 * @param {{name?:string, newAssetId?:Function}} opts
 * @returns {Promise<{status:string, notebook?:object, droppedLinks?:number, missingAssets?:number, error?:string}>}
 */
export async function instantiate(id, { name, newAssetId = defaultAssetId } = {}) {
  const found = await getTemplate(id)
  if (found.status !== TPL_OK) return found

  /* Validated on the way OUT, not only on the way in. Templates are meant to
     be shareable, so a record can outlive the build that wrote it — and a
     half-imported workspace is harder to explain than a refusal with a
     reason. */
  const check = validateTemplate(found.template)
  if (!check.ok) return { status: TPL_INVALID, error: check.reason }

  try {
    const want = collectAssetIds(found.template)
    const images = await copyAssets(STORE_IMAGES, 'img', want.images, newAssetId)
    const pdfs = await copyAssets(STORE_PDFS, 'pdf', want.pdfs, newAssetId)

    /* instantiateTemplate deliberately leaves asset ids alone — it is pure and
       cannot copy bytes, so it hands that decision here. Remapping AFTER it
       runs also means the new notebook's blocks are already fresh clones, so
       writing to them cannot reach the stored template. */
    const { notebook, droppedLinks } = instantiateTemplate(found.template, { name })
    remapAssetIds(notebook.sheets, images.map, pdfs.map)

    return { status: TPL_OK, notebook, droppedLinks, missingAssets: images.missing + pdfs.missing }
  } catch (err) {
    return fail(err)
  }
}
