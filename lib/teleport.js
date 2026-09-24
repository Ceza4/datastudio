/*
  lib/teleport.js
  --------------------------------------------------------------------------
  Links between blocks. Click a name in a note, land on the table it came from.

  This is the connective tissue the calendar, tasks, PDF provenance, query
  results and the watchlist all need, which is why it's worth building
  carefully now rather than three times later.

  THE ADDRESS IS ALWAYS COMPLETE
  A target is { notebookId, sheetId, blockId } — never a bare block id, even
  though only same-sheet links are reachable by the picker today. Block ids are
  unique in practice (`block_${Date.now()}_${random}`), so a bare id would
  work right up until you want to link across sheets — at which point every
  link already saved in someone's workspace needs migrating, and migrations of
  user-authored rich text are the ones you don't want to write. The two extra
  fields cost nothing today and remove that problem entirely.

  THE LINK LIVES IN THE TEXT, AS A SPAN
  Stored inline in the block's HTML rather than in a side table:

      <span data-ds-link="nb/sheet/block" class="ds-teleport">Acme — Q3</span>

  A side table would need reconciling every time someone edits, cuts, pastes
  or undoes — the link would outlive the text that anchored it. Inline, the
  browser's own editing model keeps them together for free: delete the
  sentence and the link goes with it, undo and it comes back.

  Deliberately NOT an <a href>. An anchor invites the browser to navigate, has
  its own focus and context-menu behaviour, and would be indistinguishable
  from a real web link — which matters, because these two things do very
  different things when clicked.

  SEGMENTS ARE PERCENT-ENCODED
  The three ids are joined with "/". Today's id generators can't produce a
  slash, but "today's generator can't" is a poor invariant to hang parsing on,
  so each segment is encoded on write and decoded on read.

  BACKLINKS ARE SCANNED, NOT INDEXED
  A stored reverse index has to be updated on every edit to every text block,
  and it will drift — the failure mode is a "linked from 3" that lists two.
  Scanning one workspace is a few milliseconds over a few hundred blocks, and
  it cannot be wrong.
  -------------------------------------------------------------------------- */

export const LINK_ATTR = 'data-ds-link'
export const LINK_CLASS = 'ds-teleport'
/** Set on the rendered node when the target is gone. Never written to storage. */
export const DANGLING_ATTR = 'data-ds-dangling'

/* ── addresses ───────────────────────────────────────────────────────── */

/* THREE KINDS OF TARGET (24 Sep 2026): a block, a sheet, or a whole notebook.
   The address is the path down to the target and stops where the target is:

       nb/sheet/block   → a block        (the original, and still the default)
       nb/sheet         → a sheet
       nb               → a notebook

   makeAddress stays strict (all three parts), so no existing caller can build
   a sheet link by forgetting a block id. Sheet and notebook links have their
   own constructors. addressKind() says which one you have. */
export function makeAddress(notebookId, sheetId, blockId) {
  if (!notebookId || !sheetId || !blockId) return null
  return { notebookId, sheetId, blockId }
}

export function makeSheetAddress(notebookId, sheetId) {
  if (!notebookId || !sheetId) return null
  return { notebookId, sheetId }
}

export function makeNotebookAddress(notebookId) {
  if (!notebookId) return null
  return { notebookId }
}

/** 'block' | 'sheet' | 'notebook' | null */
export function addressKind(addr) {
  if (!addr?.notebookId) return null
  if (addr.blockId) return addr.sheetId ? 'block' : null
  return addr.sheetId ? 'sheet' : 'notebook'
}

export function serializeAddress(addr) {
  const kind = addressKind(addr)
  if (!kind) return ''
  const parts = kind === 'block' ? [addr.notebookId, addr.sheetId, addr.blockId]
    : kind === 'sheet' ? [addr.notebookId, addr.sheetId]
    : [addr.notebookId]
  return parts.map(encodeURIComponent).join('/')
}

export function parseAddress(str) {
  if (typeof str !== 'string' || !str) return null
  const parts = str.split('/')
  if (parts.length < 1 || parts.length > 3) return null
  try {
    const [notebookId, sheetId, blockId] = parts.map(decodeURIComponent)
    if (parts.length === 3) return notebookId && sheetId && blockId ? { notebookId, sheetId, blockId } : null
    if (parts.length === 2) return notebookId && sheetId ? { notebookId, sheetId } : null
    return notebookId ? { notebookId } : null
  } catch {
    // Malformed percent-encoding. Treat as no link rather than throwing —
    // this runs while rendering someone's document.
    return null
  }
}

export const sameAddress = (a, b) =>
  !!a && !!b && a.notebookId === b.notebookId && a.sheetId === b.sheetId && a.blockId === b.blockId

/* ── HTML ────────────────────────────────────────────────────────────── */

const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * The span to insert at the caret. The trailing &nbsp; matters: without it the
 * caret stays inside the span and everything typed next silently becomes part
 * of the link text.
 */
export function linkHtml(addr, label) {
  const a = serializeAddress(addr)
  if (!a) return escapeHtml(label || '')
  const text = escapeHtml(label || 'Untitled block')
  return `<span ${LINK_ATTR}="${escapeHtml(a)}" class="${LINK_CLASS}">${text}</span>&nbsp;`
}

/* Attribute order isn't guaranteed — browsers reorder attributes when
   contenteditable normalises markup — so the class is not part of the match. */
const LINK_RE = new RegExp(`<span[^>]*\\s${LINK_ATTR}="([^"]*)"[^>]*>([\\s\\S]*?)</span>`, 'gi')

/** Every link in a block's HTML, in document order. */
export function extractLinks(html) {
  if (!html || typeof html !== 'string') return []
  const out = []
  for (const m of html.matchAll(LINK_RE)) {
    const addr = parseAddress(decodeEntities(m[1]))
    if (addr) out.push({ addr, label: stripTags(m[2]) })
  }
  return out
}

const decodeEntities = s => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")

const stripTags = s => String(s).replace(/<[^>]*>/g, '').trim()

/* ── resolution ──────────────────────────────────────────────────────── */

/**
 * Find what an address points at.
 * Returns { ok: false, reason } rather than null so the UI can say WHICH part
 * went missing — "that notebook was deleted" is a different message from
 * "that block was deleted".
 */
export function resolveTarget(notebooks, addr) {
  if (!addr) return { ok: false, reason: 'invalid' }
  const notebook = (notebooks || []).find(n => n.id === addr.notebookId)
  if (!notebook) return { ok: false, reason: 'notebook' }
  if (!addr.sheetId) return { ok: true, notebook }
  const sheet = (notebook.sheets || []).find(s => s.id === addr.sheetId)
  if (!sheet) return { ok: false, reason: 'sheet' }
  if (!addr.blockId) return { ok: true, notebook, sheet }
  const block = (sheet.blocks || []).find(b => b.id === addr.blockId)
  if (!block) return { ok: false, reason: 'block' }
  return { ok: true, notebook, sheet, block }
}

export const isDangling = (notebooks, addr) => !resolveTarget(notebooks, addr).ok

export const DANGLING_MESSAGE = {
  invalid: 'This link is malformed.',
  notebook: 'The notebook this pointed to was deleted.',
  sheet: 'The sheet this pointed to was deleted.',
  block: 'The block this pointed to was deleted.',
}

/* ── labels ──────────────────────────────────────────────────────────── */

/**
 * A human name for a block. Falls back through name → first words of content
 * → type, because most blocks are never explicitly named and "Untitled" nine
 * times in a picker is useless.
 */
export function blockLabel(block, typeLabel) {
  if (!block) return 'Untitled'
  if (block.name) return block.name
  if (block.type === 'text') {
    const t = stripTags(block.content || '').replace(/\s+/g, ' ').trim()
    if (t) return t.length > 42 ? t.slice(0, 42) + '…' : t
  }
  if (block.type === 'table') {
    const h = (block.headers || []).filter(Boolean)
    if (h.length) return h.slice(0, 3).join(', ')
  }
  return typeLabel || block.type || 'Block'
}

/* ── backlinks ───────────────────────────────────────────────────────── */

/**
 * Every text block anywhere in the workspace that links to `blockId`.
 * Matches on block id alone, deliberately: a link written before a block was
 * moved to another sheet still points at that block, and reporting it as a
 * backlink is more useful than pretending it doesn't exist.
 */
export function findBacklinks(notebooks, blockId) {
  if (!blockId) return []
  const out = []
  for (const n of notebooks || []) {
    for (const s of n.sheets || []) {
      for (const b of s.blocks || []) {
        if (b.id === blockId) continue          // a block linking to itself isn't a backlink
        for (const { addr, label } of extractLinks(b.content)) {
          if (addr.blockId !== blockId) continue
          out.push({
            from: { notebookId: n.id, sheetId: s.id, blockId: b.id },
            label,
            sourceName: blockLabel(b),
            sheetName: s.name,
            notebookName: n.name,
            /* True when the link's stored address no longer matches where the
               target actually lives — i.e. the block moved after the link was
               written. Following it still works; it's just worth knowing. */
            stale: addr.sheetId !== undefined && !resolveTarget(notebooks, addr).ok,
          })
        }
      }
    }
  }
  return out
}

export const backlinkCount = (notebooks, blockId) => findBacklinks(notebooks, blockId).length

/* ── search ──────────────────────────────────────────────────────────── */

/**
 * Subsequence match with positional scoring — the same shape of algorithm as
 * an editor's go-to-file. Lower score is better.
 * Returns null when the query doesn't match at all.
 */
export function fuzzyScore(query, text) {
  if (!query) return 0
  const q = query.toLowerCase(), t = String(text || '').toLowerCase()
  if (!t) return null

  const direct = t.indexOf(q)
  // A contiguous run always beats a scattered subsequence.
  if (direct === 0) return -1000
  if (direct > 0) return -500 + direct
  // Word-boundary hit ("q3 d" matching "Q3 Deal") ranks above a loose match.
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return -400

  let ti = 0, score = 0, prev = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    score += found - prev - 1          // gaps cost
    if (found === 0 || /\s|[-_/]/.test(t[found - 1])) score -= 8   // boundary bonus
    prev = found
    ti = found + 1
  }
  return score + t.length * 0.05       // mild preference for shorter labels
}

/**
 * Rank every block in the workspace against a query.
 * Searches the block label, its sheet name and its notebook name, so "q3" and
 * "budget sheet" both find things.
 */
export function searchBlocks(notebooks, query, { exclude, limit = 40, typeLabels = {} } = {}) {
  const results = []
  for (const n of notebooks || []) {
    for (const s of n.sheets || []) {
      for (const b of s.blocks || []) {
        if (exclude && b.id === exclude) continue
        const label = blockLabel(b, typeLabels[b.type])
        const scores = [
          fuzzyScore(query, label),
          nudge(fuzzyScore(query, s.name), 60),
          nudge(fuzzyScore(query, n.name), 90),
        ].filter(v => v !== null)
        if (query && !scores.length) continue
        results.push({
          addr: makeAddress(n.id, s.id, b.id),
          block: b,
          label,
          sheetName: s.name,
          notebookName: n.name,
          score: scores.length ? Math.min(...scores) : 0,
        })
      }
    }
  }
  /* Stable tie-break on label, so an unfiltered list doesn't reshuffle between
     keystrokes — a picker whose rows move under the cursor is unusable. */
  results.sort((a, b) => (a.score - b.score) || a.label.localeCompare(b.label))
  return results.slice(0, limit)
}

/**
 * Every linkable target, grouped the way the link picker shows them:
 * Blocks, then Sheets, then Notebooks (decided 24 Sep 2026). Each group is
 * ranked on its own, so a strong notebook match never pushes blocks off the
 * list and vice versa.
 */
export function searchTargets(notebooks, query, { exclude, typeLabels = {}, limits = { blocks: 30, sheets: 12, notebooks: 8 } } = {}) {
  const blocks = searchBlocks(notebooks, query, { exclude, typeLabels, limit: limits.blocks })
    .map(r => ({ ...r, kind: 'block' }))
  const sheets = [], nbs = []
  for (const n of notebooks || []) {
    const ns = fuzzyScore(query, n.name || '')
    if (!query || ns !== null) {
      nbs.push({ kind: 'notebook', addr: makeNotebookAddress(n.id), label: n.name || 'Untitled notebook', path: `${(n.sheets || []).length} sheet${(n.sheets || []).length === 1 ? '' : 's'}`, score: ns ?? 0 })
    }
    for (const s of n.sheets || []) {
      const scores = [fuzzyScore(query, s.name || ''), nudge(fuzzyScore(query, n.name || ''), 60)].filter(v => v !== null)
      if (query && !scores.length) continue
      sheets.push({ kind: 'sheet', addr: makeSheetAddress(n.id, s.id), label: s.name || 'Untitled sheet', path: n.name || 'Untitled notebook', score: scores.length ? Math.min(...scores) : 0 })
    }
  }
  const order = (a, b) => (a.score - b.score) || a.label.localeCompare(b.label)
  return {
    blocks,
    sheets: sheets.sort(order).slice(0, limits.sheets),
    notebooks: nbs.sort(order).slice(0, limits.notebooks),
  }
}

/** Matching on a container (sheet/notebook name) is weaker than on the block itself. */
const nudge = (v, penalty) => (v === null ? null : v + penalty)
