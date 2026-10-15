/*
  lib/sheettabs.js
  --------------------------------------------------------------------------
  SHEETS INSIDE ONE TABLE BLOCK — the Excel tab bar, as data.

  THE STORAGE SHAPE, AND WHY
  The active sheet stays exactly where a table's data has always lived:
  block.headers / rows / colWidths / rowHeights. The other sheets sit in
  block.tabs, each carrying its own copy of those four fields. The active
  tab's entry in block.tabs holds only its id, name and colour — its data is
  the top level.

    { type: 'table', headers, rows, colWidths, rowHeights,   ← active sheet
      activeTab: 't2',
      tabs: [ { id: 't1', name: 'Readings', data: { headers, rows, … } },
              { id: 't2', name: 'Summary', color: '#1F5FBF' } ] }

  So every existing reader of a table — the grid, CSV and clipboard, the
  sidebar's column drag, search, sync, the size limits — keeps working with
  no change and always sees the sheet on screen. Switching tabs is a swap:
  the top level is parked in the old tab's `data`, the new tab's `data` is
  lifted to the top level. A table that never had a second sheet has no
  `tabs` at all and is byte-for-byte what it was.

  Readers that want EVERY sheet (export, "does this block have content")
  call allSheets(), which resolves the active one from the top level.
  -------------------------------------------------------------------------- */

export const DATA_KEYS = ['headers', 'rows', 'colWidths', 'rowHeights']
export const MAX_NAME = 31
export const TAB_COLORS = ['#C0392B', '#B45309', '#2A8331', '#0F766E', '#1F5FBF', '#6D4AC7', '#BE185D']

const blankData = () => ({ headers: [''], rows: Array.from({ length: 8 }, () => ['']) })

let seq = 0
export function newTabId() {
  seq += 1
  return 't' + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 6)
}

/** The block's tab list, always at least one entry. A table with no `tabs`
 *  reads as a single tab called "Sheet1" whose data is the top level. */
export function tabsOf(block) {
  const t = Array.isArray(block?.tabs) ? block.tabs.filter(x => x && typeof x.id === 'string') : []
  if (t.length) return t
  return [{ id: block?.activeTab || 'sheet1', name: 'Sheet1' }]
}

export function activeTabId(block) {
  const tabs = tabsOf(block)
  return tabs.some(t => t.id === block?.activeTab) ? block.activeTab : tabs[0].id
}

const topData = block => {
  const d = {}
  for (const k of DATA_KEYS) if (block?.[k] !== undefined) d[k] = block[k]
  return d
}

/** Every sheet with its data resolved: [{ id, name, color, headers, rows, colWidths, rowHeights, active }]. */
export function allSheets(block) {
  const act = activeTabId(block)
  return tabsOf(block).map(t => {
    const data = t.id === act ? topData(block) : (t.data || blankData())
    return { id: t.id, name: t.name, color: t.color || '', ...data, active: t.id === act }
  })
}

/* ── names ─────────────────────────────────────────────────────────────── */

/** Excel's rules, so a workbook exported from here opens in Excel unchanged.
 *  Returns '' when fine, otherwise the sentence to show. */
export function nameError(name, tabs, skipId = null) {
  const n = String(name ?? '').trim()
  if (!n) return 'A sheet needs a name.'
  if (n.length > MAX_NAME) return `Keep it to ${MAX_NAME} characters.`
  if (/[\\/?*[\]:]/.test(n)) return 'Names cannot use \\ / ? * [ ] :'
  if (/^'|'$/.test(n)) return 'Names cannot start or end with an apostrophe.'
  if (n.toLowerCase() === 'history') return '“History” is reserved by Excel.'
  if ((tabs || []).some(t => t.id !== skipId && String(t.name).trim().toLowerCase() === n.toLowerCase())) return 'Another sheet already has this name.'
  return ''
}

/** The first free "base", "base2", "base3"… (Excel's Sheet1, Sheet2 pattern). */
export function uniqueName(base, tabs) {
  const taken = new Set((tabs || []).map(t => String(t.name).toLowerCase()))
  const stem = String(base || 'Sheet').slice(0, MAX_NAME - 3)
  if (!taken.has(stem.toLowerCase()) && !/\d$/.test(stem) && stem !== 'Sheet') return stem
  let i = 1
  while (taken.has(`${stem}${i}`.toLowerCase())) i++
  return `${stem}${i}`
}

function copyName(name, tabs) {
  const taken = new Set((tabs || []).map(t => String(t.name).toLowerCase()))
  const stem = String(name).slice(0, MAX_NAME - 4)
  for (let i = 2; ; i++) {
    const n = `${stem} (${i})`
    if (!taken.has(n.toLowerCase())) return n
  }
}

/* ── operations: each returns the PATCH to hand to onUpdateBlock ────────── */

/** Materialise the implicit single tab so the list can grow. */
function explicit(block) {
  return tabsOf(block).map(t => ({ ...t }))
}

/** Switch to another sheet: park the top level in the old tab, lift the new one. */
export function switchTab(block, toId) {
  const tabs = explicit(block)
  const from = activeTabId(block)
  if (from === toId || !tabs.some(t => t.id === toId)) return null
  let lifted = null
  const next = tabs.map(t => {
    if (t.id === from) return { ...stripData(t), data: topData(block) }
    if (t.id === toId) { lifted = t.data || blankData(); return stripData(t) }
    return t
  })
  const patch = { tabs: next, activeTab: toId }
  for (const k of DATA_KEYS) patch[k] = lifted[k] !== undefined ? lifted[k] : (k === 'headers' ? [''] : k === 'rows' ? [['']] : undefined)
  return patch
}

const stripData = t => { const { data, ...rest } = t; return rest }

/** A new, blank sheet after `afterId` (or at the end), and switch to it. */
export function addTab(block, { afterId = null, name = null } = {}) {
  const tabs = explicit(block)
  const id = newTabId()
  const tab = { id, name: name && !nameError(name, tabs) ? name.trim() : uniqueName('Sheet', tabs), data: blankData() }
  const at = afterId ? tabs.findIndex(t => t.id === afterId) + 1 : tabs.length
  tabs.splice(at < 1 ? tabs.length : at, 0, tab)
  return { ...switchTab({ ...block, tabs, activeTab: activeTabId(block) }, id), _newId: id }
}

export function renameTab(block, id, name) {
  const tabs = explicit(block)
  const err = nameError(name, tabs, id)
  if (err) return { error: err }
  return { tabs: tabs.map(t => (t.id === id ? { ...t, name: String(name).trim() } : t)), activeTab: activeTabId(block) }
}

export function setTabColor(block, id, color) {
  return { tabs: explicit(block).map(t => (t.id === id ? { ...t, color: color || undefined } : t)), activeTab: activeTabId(block) }
}

/** Move a tab so it ends up at index `to` (0-based, in the final order). */
export function moveTab(block, id, to) {
  const tabs = explicit(block)
  const from = tabs.findIndex(t => t.id === id)
  if (from < 0) return null
  const j = Math.max(0, Math.min(tabs.length - 1, to))
  if (j === from) return null
  const [t] = tabs.splice(from, 1)
  tabs.splice(j, 0, t)
  return { tabs, activeTab: activeTabId(block) }
}

/** A copy right after the original, switched to. */
export function duplicateTab(block, id) {
  const tabs = explicit(block)
  const src = allSheets(block).find(s => s.id === id)
  if (!src) return null
  const data = {}
  for (const k of DATA_KEYS) if (src[k] !== undefined) data[k] = JSON.parse(JSON.stringify(src[k]))
  const nid = newTabId()
  const at = tabs.findIndex(t => t.id === id) + 1
  tabs.splice(at, 0, { id: nid, name: copyName(src.name, tabs), color: src.color || undefined, data })
  return { ...switchTab({ ...block, tabs, activeTab: activeTabId(block) }, nid), _newId: nid }
}

/** Remove a sheet. The last one cannot go. Deleting the active sheet moves
 *  to its neighbour (the one before it, like Excel, or the next if first).
 *  Returns { patch, undo } — undo is the patch that puts everything back. */
export function removeTab(block, id) {
  const tabs = explicit(block)
  if (tabs.length < 2) return null
  const idx = tabs.findIndex(t => t.id === id)
  if (idx < 0) return null
  const undo = { tabs: block.tabs, activeTab: block.activeTab }
  for (const k of DATA_KEYS) undo[k] = block[k]
  let base = block
  if (activeTabId(block) === id) {
    const neighbour = tabs[idx > 0 ? idx - 1 : 1].id
    const sw = switchTab(block, neighbour)
    base = { ...block, ...sw }
  }
  const remaining = tabsOf(base).filter(t => t.id !== id)
  const patch = { tabs: remaining, activeTab: activeTabId({ ...base, tabs: remaining }) }
  for (const k of DATA_KEYS) patch[k] = base[k]
  return { patch, undo }
}

/** Does this sheet have anything worth confirming before deleting it? */
export function sheetHasData(sheet) {
  return !!sheet?.rows?.some(r => Array.isArray(r) && r.some(c => c != null && String(c).trim() !== ''))
    || !!sheet?.headers?.some(h => h != null && String(h).trim() !== '')
}
