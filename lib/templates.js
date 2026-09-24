/*
  lib/templates.js
  --------------------------------------------------------------------------
  §9.1 Builder — turning a workspace into a template, and a template back into
  a workspace.

  MATAS'S SCOPE, VERBATIM, BECAUSE IT IS EASY TO OVERBUILD THIS

    "Initially, keep Builder simple and focus on the foundation: allowing users
     to structure a workspace, customize its components, save it as a template
     and duplicate it."

  So: save, list, duplicate. Databases, relationships and automations come
  later and are explicitly "eventually" in the same note. Nothing here should
  anticipate them beyond leaving the door open.

  And the governing constraint, also verbatim:

    "Users who never click Builder should continue using DataStudio exactly as
     they do now."

  This file is therefore additive. It reads a notebook and writes a notebook.
  It changes no existing shape, and nothing in the normal canvas path imports
  it.

  ── THE ONE HARD PROBLEM: IDENTITY ──────────────────────────────────────

  "Duplicate it, and the original stays unchanged" sounds like a deep copy. It
  is not, because a notebook is a GRAPH, not a tree, and the edges are stored
  as ids in four different places:

    · connections           fromBlockId / toBlockId
    · sections              a child block's parentSectionId
    · calendar blocks       sources referencing other blocks
    · teleporter links      "notebookId/sheetId/blockId" INSIDE text HTML

  A naive deep clone copies the ids too. The copy then renders correctly on
  screen — every block is there, in the right place — while its connections
  and links quietly point at the ORIGINAL notebook's blocks. Edit the copy and
  the original moves. Delete the original and the copy's links dangle. It looks
  right, which is what makes it dangerous.

  So instantiate() builds a complete old-id → new-id map FIRST, then rewrites
  every reference through it in one pass. Anything that cannot be remapped —
  a link that pointed outside the template — is dropped rather than left
  pointing at a stranger's workspace.

  ── ASSETS ──────────────────────────────────────────────────────────────

  Image and PDF bytes live in their own IndexedDB stores; blocks carry only an
  id. A template records WHICH asset ids it needs (`assets`) and leaves copying
  the bytes to the caller, because this module is pure and the byte stores are
  async. `collectAssetIds()` is what the caller iterates. Getting this wrong
  produces a template that looks complete and renders a missing-image box on
  someone else's machine.
  -------------------------------------------------------------------------- */

import { LINK_ATTR, serializeAddress, parseAddress } from './teleport.js'

/** Bumped when the stored shape changes in a way a reader must know about. */
export const TEMPLATE_VERSION = 1

/* Nothing is copied off the source notebook wholesale. Fields are listed
   explicitly below, because the two that exist are not equivalent: `name` is
   content and is overridable, while `activeSheetId` is a UI position — where
   the author happened to be looking — and carrying it into a template would
   make every copy open on that sheet.

   There WAS a `NOTEBOOK_FIELDS = ['name']` spread here, applied after the
   explicit `name:` line, so it silently overwrote the name the caller asked
   for with the source notebook's. Saving "CRM" as "CRM starter" produced a
   template called "CRM". Caught by the first assertion in
   tests/templates.test.mjs. */

let seq = 0
/* Injectable so tests are deterministic. The default matches the id shape used
   everywhere else in the app. */
export const defaultNewId = prefix => `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)))

/* ── building a template ─────────────────────────────────────────────── */

/**
 * Snapshot a notebook as a template.
 *
 * The snapshot is deep-cloned on the way in, so later edits to the live
 * notebook cannot reach back into a saved template. That is half of "the
 * original stays unchanged"; instantiate() is the other half.
 *
 * @param {object} notebook
 * @param {{name?:string, description?:string, newId?:Function, now?:number}} opts
 */
export function templateFromNotebook(notebook, { name, description = '', newId = defaultNewId, now = Date.now() } = {}) {
  if (!notebook || !Array.isArray(notebook.sheets)) {
    throw new Error('templateFromNotebook needs a notebook with sheets')
  }
  const sheets = notebook.sheets.map(s => ({
    id: s.id,
    name: s.name,
    blocks: clone(s.blocks || []),
    connections: clone(s.connections || []),
    drawings: clone(s.drawings || []),
  }))

  return {
    id: newId('tpl'),
    version: TEMPLATE_VERSION,
    name: (name ?? notebook.name ?? 'Untitled template').trim() || 'Untitled template',
    description,
    createdAt: now,
    /* The notebook's OWN id is kept so links that pointed inside it can be
       recognised at instantiate time. Links that referenced a different
       notebook are, by definition, outside the template. */
    sourceNotebookId: notebook.id,
    sheets,
    assets: collectAssetIds({ sheets }),
    blockCount: sheets.reduce((n, s) => n + s.blocks.length, 0),
  }
}

/**
 * Every image and PDF id a template depends on. The caller copies these bytes
 * so the template is self-contained; without that step a shared template
 * renders missing-asset boxes on any machine but the author's.
 */
export function collectAssetIds(source) {
  const images = new Set()
  const pdfs = new Set()
  for (const sheet of source?.sheets || []) {
    for (const b of sheet.blocks || []) {
      if (b?.imageId) images.add(b.imageId)
      if (b?.pdfId) pdfs.add(b.pdfId)
    }
  }
  return { images: [...images], pdfs: [...pdfs] }
}

/* ── link rewriting ──────────────────────────────────────────────────── */

/* Matches a stored teleporter span and captures its address. Deliberately the
   same shape lib/teleport.js writes; if that changes, this must too, and
   tests/templates.test.mjs asserts a real round trip rather than trusting the
   pattern. */
const LINK_RE = new RegExp(`(${LINK_ATTR}=")([^"]*)(")`, 'g')

/**
 * Rewrite teleporter addresses embedded in a block's HTML.
 *
 * `map(addr)` returns a new address, or null to drop the link. Dropping means
 * unwrapping to plain text: a link into a notebook the copy has no relationship
 * with is worse than no link, because it silently navigates someone into
 * unrelated content.
 */
export function remapLinksInHtml(html, map) {
  const s = String(html ?? '')
  if (!s || !s.includes(LINK_ATTR)) return s

  const dead = []
  const out = s.replace(LINK_RE, (whole, pre, raw, post) => {
    const addr = parseAddress(raw)
    const next = addr ? map(addr) : null
    if (!next) { dead.push(raw); return `${pre}${raw}${post}` }
    return `${pre}${serializeAddress(next)}${post}`
  })
  if (!dead.length) return out

  /* Unwrap the spans whose addresses could not be remapped, keeping their
     label text. A regex is enough here because the only thing being removed is
     a span this module's own writer produced. */
  return dead.reduce((acc, raw) => {
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`<span[^>]*${LINK_ATTR}="${esc}"[^>]*>([\\s\\S]*?)</span>`, 'g')
    return acc.replace(re, '$1')
  }, out)
}

/* ── instantiating ───────────────────────────────────────────────────── */

/**
 * Build a fresh notebook from a template. The template is not modified.
 *
 * @param {object} template
 * @param {{name?:string, newId?:Function}} opts
 * @returns {{notebook:object, idMap:{sheets:object, blocks:object}, droppedLinks:number}}
 */
export function instantiateTemplate(template, { name, newId = defaultNewId } = {}) {
  if (!template || !Array.isArray(template.sheets)) {
    throw new Error('instantiateTemplate needs a template with sheets')
  }

  const notebookId = newId('nb')
  const sheetMap = Object.create(null)
  const blockMap = Object.create(null)

  /* PASS 1 — allocate every new id before anything is rewritten. A connection
     can reference a block that appears later in the array, and a teleporter
     link can point at another sheet entirely, so no reference can be resolved
     until the whole map exists. Doing this in one pass is the bug. */
  for (const sheet of template.sheets) {
    sheetMap[sheet.id] = newId('sheet')
    for (const b of sheet.blocks || []) blockMap[b.id] = newId('blk')
  }

  /* Which sheet each ORIGINAL block lived on, so a remapped link can name the
     new sheet as well as the new block. */
  const sheetOfBlock = Object.create(null)
  for (const sheet of template.sheets) {
    for (const b of sheet.blocks || []) sheetOfBlock[b.id] = sheet.id
  }

  let droppedLinks = 0
  const mapAddress = addr => {
    /* Sheet links follow their sheet into the copy, or are dropped if the
       template does not include it. Notebook links point at a whole other
       notebook by choice, so they are kept as written. */
    if (!addr.blockId) {
      if (!addr.sheetId) return addr
      const nextSheet = sheetMap[addr.sheetId]
      if (!nextSheet) { droppedLinks++; return null }
      return { notebookId, sheetId: nextSheet }
    }
    /* A link is inside the template only if its target block is in the map.
       Comparing notebook ids is not enough — the source notebook may have had
       sheets the template does not include. */
    const nextBlock = blockMap[addr.blockId]
    if (!nextBlock) { droppedLinks++; return null }
    const originSheet = sheetOfBlock[addr.blockId]
    return { notebookId, sheetId: sheetMap[originSheet], blockId: nextBlock }
  }

  // PASS 2 — rewrite.
  const sheets = template.sheets.map(sheet => {
    const blocks = (sheet.blocks || []).map(src => {
      const b = clone(src)
      b.id = blockMap[src.id]

      /* A child whose section was not included becomes a free block rather
         than a child of nothing — an unresolvable parent id makes it invisible
         on the canvas, which reads as data loss. */
      if (b.parentSectionId) b.parentSectionId = blockMap[b.parentSectionId] || undefined

      if (typeof b.content === 'string') b.content = remapLinksInHtml(b.content, mapAddress)

      /* Calendar blocks name other blocks as event sources. */
      if (Array.isArray(b.sources)) {
        b.sources = b.sources
          .map(s => (typeof s === 'string'
            ? blockMap[s] || null
            : (s && s.blockId ? { ...s, blockId: blockMap[s.blockId] || null } : s)))
          .filter(s => s && (typeof s === 'string' || s.blockId !== null))
      }
      return b
    })

    /* A connection whose endpoints did not both survive is dropped. Keeping a
       half-connection draws a bezier curve to coordinates that do not exist. */
    const connections = (sheet.connections || [])
      .map(c => {
        const from = blockMap[c.fromBlockId]
        const to = blockMap[c.toBlockId]
        if (!from || !to) return null
        return { ...clone(c), id: newId('conn'), fromBlockId: from, toBlockId: to }
      })
      .filter(Boolean)

    return {
      id: sheetMap[sheet.id],
      name: sheet.name,
      blocks,
      connections,
      drawings: clone(sheet.drawings || []),
    }
  })

  const notebook = {
    id: notebookId,
    name: (name ?? `${template.name} copy`).trim() || 'Untitled',
    sheets,
    activeSheetId: sheets[0]?.id,
    /* Provenance. Cheap to store, and it is what makes "update all workspaces
       built from this template" possible later without a migration. */
    fromTemplateId: template.id,
  }

  return { notebook, idMap: { sheets: sheetMap, blocks: blockMap }, droppedLinks }
}

/* ── validation ──────────────────────────────────────────────────────── */

/**
 * Is this object a template this build can instantiate?
 * Templates will arrive from other people eventually — Matas's note says
 * "shareable or reusable by other users" — so this refuses malformed input
 * rather than half-importing it.
 */
export function validateTemplate(t) {
  if (!t || typeof t !== 'object') return { ok: false, reason: 'Not a template file.' }
  if (typeof t.version !== 'number') return { ok: false, reason: 'Missing template version.' }
  if (t.version > TEMPLATE_VERSION) {
    return { ok: false, reason: `Made with a newer version of DataStudio (template v${t.version}, this build reads v${TEMPLATE_VERSION}).` }
  }
  if (!Array.isArray(t.sheets) || t.sheets.length === 0) return { ok: false, reason: 'Template contains no sheets.' }
  for (const s of t.sheets) {
    if (!s || typeof s.id !== 'string' || !Array.isArray(s.blocks)) {
      return { ok: false, reason: 'Template contains a malformed sheet.' }
    }
  }
  return { ok: true }
}

/** One-line summary for a template card. */
export function describeTemplate(t) {
  const sheets = t?.sheets?.length || 0
  const blocks = t?.blockCount ?? (t?.sheets || []).reduce((n, s) => n + (s.blocks?.length || 0), 0)
  const part = n => (u, p = u + 's') => `${n} ${n === 1 ? u : p}`
  return `${part(sheets)('sheet')} · ${part(blocks)('block')}`
}
