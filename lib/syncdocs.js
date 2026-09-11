/*
  lib/syncdocs.js
  --------------------------------------------------------------------------
  The pure half of sync: turning a workspace into documents, turning documents
  back into a workspace, deciding what changed, and merging.

  Split out from lib/sync.js on purpose. The engine is timers, network and
  browser events — the part that can only be tested in a real browser, which
  is where every bug that has reached a user in this codebase has lived. This
  file is where the decisions are, and it is testable to the assertion.

  ONE SHAPE FOR FOUR THINGS

  A notebook, a folder, an imported workbook and a template are all the same
  thing to Postgres: an id, a kind, a name and a JSON document. That is why
  migration 0003 collapsed four tables into one `docs` table — four tables
  meant four sets of RLS policies, and 0002 exists because the first attempt
  got column privileges wrong on two tables out of five.

  CHANGE DETECTION IS BY REFERENCE, NOT BY CONTENT

  `dirtyIds` compares object IDENTITY against the last set we saw. Every
  mutator in this app is immutable — lib/undo.js is built on exactly that
  property, capturing the previous `notebooks` array as a free snapshot — so
  an unchanged notebook is literally the same object, and a pointer compare
  answers the question.

  Hashing the documents instead would mean serialising the entire workspace on
  every keystroke to find out that nothing changed. That is the 527ms per save
  this codebase already removed once from persistence.js. The cost of the
  reference approach is a rare false POSITIVE — undo can hand back a
  structurally identical but newly allocated object — and a false positive is
  one redundant push of bytes that were going to match anyway. A false
  negative would be a lost edit. The asymmetry decides it.
  -------------------------------------------------------------------------- */

export const KIND_NOTEBOOK = 'notebook'
export const KIND_FOLDER = 'folder'
export const KIND_SHEETFILE = 'sheetfile'
export const KIND_TEMPLATE = 'template'

/** Pull order. Containers before their contents — see `sortForApply`. */
export const KINDS = [KIND_FOLDER, KIND_NOTEBOOK, KIND_SHEETFILE, KIND_TEMPLATE]

/**
 * Workspace -> the flat list of documents that sync knows how to push.
 *
 * The whole object goes into `doc`, including its own id. Redundant against
 * the primary key, and deliberately so: a document that arrives on another
 * machine is dropped straight back into React state, and a doc payload that
 * had to be reassembled with its id grafted on is a shape that can be
 * assembled wrong. Round-tripping the object unchanged is the property worth
 * having.
 */
export function docsFromWorkspace(state) {
  const out = []
  for (const nb of state?.notebooks || []) {
    if (nb?.id) out.push({ id: nb.id, kind: KIND_NOTEBOOK, name: nb.name || 'Untitled', doc: nb })
  }
  for (const f of state?.folders || []) {
    if (f?.id) out.push({ id: f.id, kind: KIND_FOLDER, name: f.name || 'Folder', doc: f })
  }
  for (const f of state?.files || []) {
    if (f?.id) out.push({ id: f.id, kind: KIND_SHEETFILE, name: f.name || 'Workbook', doc: f })
  }
  return out
}

/** The inverse. Kinds that aren't part of the workspace (templates) are ignored. */
export function workspaceFromDocs(rows) {
  const notebooks = []
  const folders = []
  const files = []
  for (const r of rows || []) {
    if (!r || r.deleted_at) continue
    const doc = r.doc && typeof r.doc === 'object' ? r.doc : null
    if (!doc) continue
    /* The id comes from the ROW, not from the doc. They agree in every case
       this code produces, but the row's id is the one the primary key
       enforces — if they ever disagree, believing the doc would give two rows
       the same local id and silently merge two notebooks into one. */
    const withId = doc.id === r.id ? doc : { ...doc, id: r.id }
    if (r.kind === KIND_NOTEBOOK) notebooks.push(withId)
    else if (r.kind === KIND_FOLDER) folders.push(withId)
    else if (r.kind === KIND_SHEETFILE) files.push(withId)
  }
  return { notebooks, folders, files }
}

/**
 * Which ids changed, appeared or vanished since `previous`.
 *
 * @param {Map<string, object>} previous  id -> the doc object last seen
 * @param {Array} current                 docsFromWorkspace() output
 */
export function dirtyIds(previous, current) {
  const changed = []
  const removed = []
  const seen = new Set()
  for (const d of current || []) {
    seen.add(d.id)
    const was = previous?.get(d.id)
    if (was !== d.doc) changed.push(d)
  }
  for (const id of previous?.keys() || []) {
    if (!seen.has(id)) removed.push(id)
  }
  return { changed, removed }
}

/** The Map to hand back to the next dirtyIds call. */
export function snapshotDocs(current) {
  const m = new Map()
  for (const d of current || []) m.set(d.id, d.doc)
  return m
}

/* ── assets a document keeps alive ───────────────────────────────────────── */

/**
 * Every image / PDF / attachment id referenced by a document.
 *
 * Walks defensively — `sheets` or `blocks` can be absent on a document written
 * by a build that did not have them, and a sync layer that throws on an
 * unfamiliar shape takes the whole push down with it. Anything it does not
 * recognise simply contributes no asset ids, which fails toward "upload
 * nothing extra" rather than toward "crash".
 */
export function assetIdsOf(doc) {
  const ids = new Set()
  const sheets = Array.isArray(doc?.sheets) ? doc.sheets : []
  for (const s of sheets) {
    const blocks = Array.isArray(s?.blocks) ? s.blocks : []
    for (const b of blocks) {
      if (b?.imageId) ids.add(b.imageId)
      if (b?.pdfId) ids.add(b.pdfId)
      if (b?.fileId) ids.add(b.fileId)
    }
  }
  return [...ids]
}

/* ── conflicts ───────────────────────────────────────────────────────────── */

/**
 * The name a conflict copy gets.
 *
 * Numbered from the second one on, because two devices out of sync for a week
 * produce more than one, and four notebooks all called
 * "Thesis (conflict copy)" is a worse outcome than the conflict was.
 */
export function conflictName(name, existingNames = []) {
  const base = `${name || 'Untitled'} (conflict copy)`
  const taken = new Set(existingNames)
  if (!taken.has(base)) return base
  for (let n = 2; n < 500; n++) {
    const tryName = `${name || 'Untitled'} (conflict copy ${n})`
    if (!taken.has(tryName)) return tryName
  }
  return `${base} ${Date.now()}`
}

/**
 * FOLDERS MERGE INSTEAD OF FORKING.
 *
 * The rule for a notebook is: never discard work silently, so a lost race
 * becomes a conflict copy. Applying that to folders would be obedient and
 * stupid — a duplicated folder called "Research (conflict copy)" holding the
 * same notebooks is not a rescued afternoon, it is clutter produced by a
 * mechanism that was meant to prevent loss.
 *
 * A folder is {name, collapsed, itemIds}. itemIds is the only field that can
 * hold work, and it is a set with an order. Union preserves every membership
 * from both sides, which is the whole content, so nothing is discarded and
 * there is nothing to rescue. Ours leads because ours is the one being looked
 * at right now; theirs appends in its own order.
 *
 * `collapsed` is a per-device view preference that happens to live in a synced
 * object. Ours wins — being told your folders collapsed themselves because
 * another machine synced is a small, constant, real annoyance.
 */
export function mergeFolder(ours, theirs) {
  const ourItems = Array.isArray(ours?.itemIds) ? ours.itemIds : []
  const theirItems = Array.isArray(theirs?.itemIds) ? theirs.itemIds : []
  const seen = new Set(ourItems)
  const itemIds = [...ourItems]
  for (const id of theirItems) if (!seen.has(id)) { seen.add(id); itemIds.push(id) }
  return {
    ...theirs,
    ...ours,
    itemIds,
    collapsed: ours?.collapsed ?? theirs?.collapsed ?? false,
  }
}

/**
 * Ordered so a container is applied before the things it contains.
 *
 * A notebook that arrives before the folder holding it renders at the root
 * for a moment and then jumps. That reads as the app moving someone's work on
 * its own, which is the exact anxiety a first sync has to avoid.
 */
export function sortForApply(rows) {
  const order = new Map(KINDS.map((k, i) => [k, i]))
  return [...(rows || [])].sort((a, b) => {
    const ka = order.has(a.kind) ? order.get(a.kind) : 99
    const kb = order.has(b.kind) ? order.get(b.kind) : 99
    if (ka !== kb) return ka - kb
    return String(a.updated_at || '').localeCompare(String(b.updated_at || ''))
  })
}

/**
 * Fold pulled rows into the workspace we have in front of us.
 *
 * @param {object} local     {notebooks, folders, files}
 * @param {Array}  rows      pulled `docs` rows
 * @param {Set}    pendingIds ids this device still owes a push for
 *
 * `pendingIds` is the important argument. A row we have local unsynced changes
 * for must NOT be overwritten by the pulled copy — the push has not run yet,
 * so the remote is simply older, and applying it would undo the user's last
 * few seconds of typing in front of them. The push path resolves that case
 * properly (compare-and-set, then a conflict copy if it really did lose).
 */
export function applyPulled(local, rows, pendingIds = new Set()) {
  const notebooks = [...(local?.notebooks || [])]
  const folders = [...(local?.folders || [])]
  const files = [...(local?.files || [])]
  const lists = {
    [KIND_NOTEBOOK]: notebooks,
    [KIND_FOLDER]: folders,
    [KIND_SHEETFILE]: files,
  }
  const applied = []
  const skipped = []

  for (const r of sortForApply(rows)) {
    const list = lists[r.kind]
    if (!list) continue
    if (pendingIds.has(r.id)) { skipped.push(r.id); continue }

    const at = list.findIndex(x => x?.id === r.id)
    if (r.deleted_at) {
      if (at >= 0) { list.splice(at, 1); applied.push(r.id) }
      continue
    }
    const doc = r.doc && typeof r.doc === 'object'
      ? (r.doc.id === r.id ? r.doc : { ...r.doc, id: r.id })
      : null
    if (!doc) continue

    if (at < 0) { list.push(doc); applied.push(r.id); continue }
    /* A folder that exists on both sides is merged rather than replaced, for
       the reason mergeFolder explains. Everything else is last-write-wins,
       and "wins" is decided by the server's rev, not by either clock. */
    list[at] = r.kind === KIND_FOLDER ? mergeFolder(list[at], doc) : doc
    applied.push(r.id)
  }

  return { notebooks, folders, files, applied, skipped }
}

/**
 * Folders can end up naming things that are not here — a notebook deleted on
 * another machine, or one whose row has not arrived yet.
 *
 * DANGLING IDS ARE LEFT ALONE. This function only REPORTS them. It is very
 * tempting to have the sync layer tidy them up, and that is precisely how a
 * pull that arrives mid-flight (folders before notebooks) empties every folder
 * on the machine: the notebook rows are seconds behind, the folder looks
 * broken for that moment, and a tidy-up makes the moment permanent. The
 * sidebar already renders a folder by intersecting itemIds with what exists,
 * so a dangling id is invisible rather than wrong.
 */
export function danglingItemIds({ folders = [], notebooks = [], files = [] } = {}) {
  const live = new Set([...notebooks, ...files].map(x => x?.id).filter(Boolean))
  const out = []
  for (const f of folders) {
    for (const id of f?.itemIds || []) if (!live.has(id)) out.push({ folderId: f.id, itemId: id })
  }
  return out
}
