/*
  lib/database.js
  --------------------------------------------------------------------------
  §9.2 Builder — the database block. The thing the whole Builder vision hangs
  off, in Matas's own example:

    "They create a database called Companies, another called Contacts, another
     called Deals, and another called Activities. They then define relationships
     between them. [...] Once those relationships exist, DataStudio can present
     the same information in different ways: as a table, kanban board, calendar,
     dashboard, or cards on an infinite canvas."

  ── WHAT NOTION ACTUALLY IS, MECHANICALLY ───────────────────────────────

  Not "a nicer table". Two ideas, and everything else is consequence:

  1. A COLUMN HAS A TYPE, and the type owns the cell — how it parses input, how
     it renders, how it sorts, what it can be grouped by. A spreadsheet cell
     holds whatever you typed; a database cell holds a Status, and a Status can
     only be one of the options that exist.

  2. THE VIEW IS NOT THE DATA. The same rows are a table, a board, a calendar
     and a gallery at once. Grouping a board by Status does not move any row —
     it reads `Status` and arranges. Which is why deleting the Status property
     has to reach into every view that referenced it, or the board silently
     groups by a column that no longer exists.

  This file is the model for both. It is pure — no React, no IndexedDB — so
  every rule below is testable without a browser, which matters because these
  rules are what automations will later read. A wrong shape here is a
  migration, not a patch.

  ── THE RULES THAT ARE EASY TO GET WRONG ────────────────────────────────

  · A VALUE IS COERCED BY ITS PROPERTY'S TYPE, ALWAYS. Typing "12abc" into a
    number column stores null, not "12abc" and not NaN. NaN is the dangerous
    one: it survives JSON, compares false to itself, and sorts randomly.

  · DELETING A PROPERTY IS A GRAPH OPERATION. Values, view groupBy, sortBy and
    filters all reference it by id. Miss one and a board groups by a ghost.

  · DELETING A SELECT OPTION IS THE SAME PROBLEM ONE LEVEL DOWN. Rows holding
    it, and filters matching it, both have to be cleaned.

  · DATES GO THROUGH lib/tasks.js. `parseDate` there already handles the traps
    this project has already been bitten by — bare YYYY-MM-DD parsing as UTC,
    Excel serials landing in the year 46266, DD/MM vs MM/DD. Reimplementing
    date parsing here would reintroduce every one of them.
  -------------------------------------------------------------------------- */

import { parseDate } from './tasks.js'

export const DB_VERSION = 1

/* ── property types ──────────────────────────────────────────────────── */

/**
 * `groupable` — can a board or gallery group by it? Only types with a small,
 * closed set of values. Grouping by a free-text column produces one column per
 * row, which is not a board, it is a very wide table.
 *
 * `sortable` — everything is, but the COMPARATOR differs, and getting that
 * wrong is silent: sorting numbers as strings puts 10 before 9.
 */
/* The icon names are real ones. `block-calendar` and `block-task` were not —
   there is no calendar or task glyph in the set, and Icon.js answers a name it
   does not know with a same-size blank spacer, so a type menu would have
   rendered two holes and never said why. `npm run check` catches exactly this;
   it was red on the day this file landed. Calendar borrows what the calendar
   BLOCK already uses in blockRegistry.js, and a person is share-people. */
export const PROPERTY_TYPES = {
  title:    { label: 'Title',        groupable: false, icon: 'nav-notebook' },
  text:     { label: 'Text',         groupable: false, icon: 'nav-notebook' },
  number:   { label: 'Number',       groupable: false, icon: 'tool-statistics' },
  select:   { label: 'Select',       groupable: true,  icon: 'action-check' },
  multi:    { label: 'Multi-select', groupable: true,  icon: 'action-check' },
  date:     { label: 'Date',         groupable: false, icon: 'status-info' },
  checkbox: { label: 'Checkbox',     groupable: true,  icon: 'action-check' },
  url:      { label: 'URL',          groupable: false, icon: 'nav-search' },
  email:    { label: 'Email',        groupable: false, icon: 'nav-search' },
  person:   { label: 'Person',       groupable: true,  icon: 'share-people' },
  /* Builder Phase 1 (24 Sep 2026). A link to other rows: in this database
     when `target` is null, or in another Database block (`target` = its block
     id). The value is an array of row ids. Shown as clickable chips on a
     Record; a chip opens the linked row. */
  relation: { label: 'Relation',     groupable: false, icon: 'share-link' },
}

export const PROPERTY_TYPE_IDS = Object.keys(PROPERTY_TYPES)
export const isGroupable = type => !!PROPERTY_TYPES[type]?.groupable

/* Option colours are token NAMES, never hex. A stored '#4ade80' would be
   invisible in whichever theme it was not picked in — and the house rule is
   that no colour is ever hardcoded. */
export const OPTION_COLORS = ['accent', 'green', 'amber', 'red', 'text-2', 'text-3']

export const VIEW_KINDS = {
  table:   { label: 'Table',    icon: 'block-table' },
  board:   { label: 'Board',    icon: 'block-kanban' },
  calendar:{ label: 'Calendar', icon: 'status-info' },
  gallery: { label: 'Gallery',  icon: 'block-image' },
}

let seq = 0
export const newDbId = (prefix = 'p') =>
  `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/* ── construction ────────────────────────────────────────────────────── */

/**
 * A new database. Always has a title property and a table view — a database
 * with no properties has nowhere to put anything, and one with no view has
 * nothing to render, so neither state is worth supporting.
 */
export function createDatabase({ name = 'Untitled', newId = newDbId } = {}) {
  const titleId = newId('prop')
  return {
    dbVersion: DB_VERSION,
    name,
    properties: [{ id: titleId, name: 'Name', type: 'title' }],
    rows: [],
    views: [{ id: newId('view'), name: 'Table', kind: 'table', sortBy: null, filters: [], hidden: [] }],
    activeViewId: null,   // null = the first view
    titlePropId: titleId,
  }
}

export function createProperty({ name = 'Property', type = 'text', newId = newDbId } = {}) {
  const p = { id: newId('prop'), name, type }
  /* Select and multi own their options, so the list must exist from birth —
     `undefined.push` at the moment someone adds the first option is a crash in
     the most-used path. */
  if (type === 'select' || type === 'multi') p.options = []
  if (type === 'number') p.format = 'plain'
  if (type === 'relation') p.target = null
  return p
}

export function createOption({ name = 'Option', color, newId = newDbId } = {}) {
  return { id: newId('opt'), name, color: color || OPTION_COLORS[0] }
}

export function createRow(db, { values = {}, newId = newDbId } = {}) {
  return { id: newId('row'), values: coerceValues(db, values) }
}

/* ── coercion ────────────────────────────────────────────────────────── */

/**
 * Force a raw input into what its property type can legally hold.
 *
 * Every write goes through here. The alternative — trusting the editor to
 * produce the right shape — means one careless input somewhere puts a string
 * in a number column, and then sorting is wrong for reasons nobody can see.
 */
export function coerceValue(prop, raw) {
  if (!prop) return null
  const t = prop.type

  if (raw === null || raw === undefined || raw === '') {
    return (t === 'multi' || t === 'relation') ? [] : t === 'checkbox' ? false : null
  }

  switch (t) {
    case 'checkbox':
      return raw === true || raw === 'true' || raw === 1 || raw === '1'

    case 'number': {
      /* Number('') is 0 and Number('abc') is NaN. Both are worse than null: 0
         is a real value someone did not enter, and NaN sorts unpredictably and
         compares false to itself. */
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[\s,]/g, ''))
      return Number.isFinite(n) ? n : null
    }

    case 'date': {
      /* Delegated on purpose. lib/tasks.js already knows that a bare
         YYYY-MM-DD is end-of-day LOCAL, that 46266 is an Excel serial and not
         the year 46266, and that 12.08.2026 is day-first. Every one of those
         was a real bug here. */
      const t2 = parseDate(raw)
      return t2 === null ? null : t2
    }

    case 'select': {
      /* Only an id that exists. A dangling option id renders as a blank chip
         and groups into a column with no header. */
      const id = typeof raw === 'string' ? raw : raw?.id
      return (prop.options || []).some(o => o.id === id) ? id : null
    }

    case 'multi': {
      const list = Array.isArray(raw) ? raw : [raw]
      const valid = new Set((prop.options || []).map(o => o.id))
      /* Deduped: the same option twice renders two identical chips, and the
         second is unremovable because clicking either removes the first. */
      return [...new Set(list.map(v => (typeof v === 'string' ? v : v?.id)).filter(v => valid.has(v)))]
    }

    case 'relation': {
      /* Row ids, deduped, strings only. Whether each id still exists is
         checked where it is shown: the linked row can live in ANOTHER
         database, which this function cannot see. */
      const list = Array.isArray(raw) ? raw : [raw]
      return [...new Set(list.map(v => (typeof v === 'string' ? v : v?.id)).filter(v => typeof v === 'string' && v))]
    }

    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'person':
    default:
      return String(raw)
  }
}

export function coerceValues(db, values) {
  const out = {}
  for (const p of db?.properties || []) {
    if (Object.hasOwn(values || {}, p.id)) out[p.id] = coerceValue(p, values[p.id])
  }
  return out
}

/** The text shown for a row wherever one line is all there is room for. */
export function rowTitle(db, row) {
  const t = db?.titlePropId && row?.values?.[db.titlePropId]
  return (typeof t === 'string' && t.trim()) ? t : 'Untitled'
}

/* ── schema edits ────────────────────────────────────────────────────── */

export function addProperty(db, prop) {
  return { ...db, properties: [...db.properties, prop] }
}

/** Patch a property's own settings (a relation's `target`, a number's
 *  `format`). Never its id or type: changing type goes through
 *  changePropertyType, which also cleans values and views. */
export function updateProperty(db, propId, patch) {
  const { id, type, ...safe } = patch || {}
  return { ...db, properties: db.properties.map(p => (p.id === propId ? { ...p, ...safe } : p)) }
}

/**
 * Remove a property AND every reference to it.
 *
 * This is the operation most likely to be written as a one-line filter, and a
 * one-line filter leaves a board grouped by a property that no longer exists,
 * a sort keyed on nothing, and filters that match everything or nothing. The
 * title property is refused outright — a database with no title has no way to
 * name a row.
 */
export function removeProperty(db, propId) {
  if (propId === db.titlePropId) return db

  const properties = db.properties.filter(p => p.id !== propId)
  const rows = db.rows.map(r => {
    if (!Object.hasOwn(r.values, propId)) return r
    const values = { ...r.values }
    delete values[propId]
    return { ...r, values }
  })
  const views = db.views.map(v => ({
    ...v,
    groupBy: v.groupBy === propId ? null : v.groupBy,
    dateProp: v.dateProp === propId ? null : v.dateProp,
    sortBy: v.sortBy?.propId === propId ? null : v.sortBy,
    filters: (v.filters || []).filter(f => f.propId !== propId),
    hidden: (v.hidden || []).filter(id => id !== propId),
  }))
  return { ...db, properties, rows, views }
}

/**
 * Change a property's type, re-coercing every existing value through the new
 * one. Values that cannot survive become null rather than being kept in the
 * old shape — a number column holding the string "high" is a landmine for
 * every sort and filter that touches it afterwards.
 */
export function changePropertyType(db, propId, type) {
  const properties = db.properties.map(p => {
    if (p.id !== propId) return p
    const next = { ...p, type }
    if (type === 'select' || type === 'multi') next.options = p.options || []
    else delete next.options
    if (type === 'number') next.format = p.format || 'plain'
    return next
  })
  const prop = properties.find(p => p.id === propId)
  const rows = db.rows.map(r => (Object.hasOwn(r.values, propId)
    ? { ...r, values: { ...r.values, [propId]: coerceValue(prop, r.values[propId]) } }
    : r))
  /* A board grouped by a column that just stopped being groupable has to let
     go, or it renders one column per distinct string. */
  const views = db.views.map(v => (v.groupBy === propId && !isGroupable(type) ? { ...v, groupBy: null } : v))
  return { ...db, properties, rows, views }
}

export function addOption(db, propId, option) {
  return {
    ...db,
    properties: db.properties.map(p => (p.id === propId ? { ...p, options: [...(p.options || []), option] } : p)),
  }
}

/** Remove an option, and clear it from every row and filter that held it. */
export function removeOption(db, propId, optionId) {
  const properties = db.properties.map(p =>
    (p.id === propId ? { ...p, options: (p.options || []).filter(o => o.id !== optionId) } : p))
  const prop = properties.find(p => p.id === propId)

  const rows = db.rows.map(r => {
    const v = r.values[propId]
    if (prop?.type === 'multi' && Array.isArray(v) && v.includes(optionId)) {
      return { ...r, values: { ...r.values, [propId]: v.filter(x => x !== optionId) } }
    }
    if (v === optionId) return { ...r, values: { ...r.values, [propId]: null } }
    return r
  })

  const views = db.views.map(v => ({
    ...v,
    filters: (v.filters || []).filter(f => !(f.propId === propId && f.value === optionId)),
  }))
  return { ...db, properties, rows, views }
}

/* ── rows ────────────────────────────────────────────────────────────── */

export const addRow = (db, row) => ({ ...db, rows: [...db.rows, row] })
/* Removing a row also removes it from every same-database relation that
   pointed at it, so no chip is left linking to nothing. */
export const removeRow = (db, rowId) => {
  const rel = db.properties.filter(p => p.type === 'relation' && !p.target).map(p => p.id)
  return {
    ...db,
    rows: db.rows.filter(r => r.id !== rowId).map(r => {
      if (!rel.length) return r
      let changed = false
      const values = { ...r.values }
      for (const pid of rel) {
        if (Array.isArray(values[pid]) && values[pid].includes(rowId)) { values[pid] = values[pid].filter(id => id !== rowId); changed = true }
      }
      return changed ? { ...r, values } : r
    }),
  }
}

export function setCell(db, rowId, propId, raw) {
  const prop = db.properties.find(p => p.id === propId)
  if (!prop) return db
  return {
    ...db,
    rows: db.rows.map(r => (r.id === rowId ? { ...r, values: { ...r.values, [propId]: coerceValue(prop, raw) } } : r)),
  }
}

/* ── filtering, sorting, grouping — the view layer ───────────────────── */

export const FILTER_OPS = {
  is:          (a, b) => a === b,
  isNot:       (a, b) => a !== b,
  contains:    (a, b) => String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
  notContains: (a, b) => !String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
  isEmpty:     a => a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0),
  isNotEmpty:  a => !FILTER_OPS.isEmpty(a),
  gt:          (a, b) => Number(a) > Number(b),
  lt:          (a, b) => Number(a) < Number(b),
  hasOption:   (a, b) => Array.isArray(a) && a.includes(b),
}

export function applyFilters(db, rows, filters) {
  if (!filters?.length) return rows
  return rows.filter(row => filters.every(f => {
    const op = FILTER_OPS[f.op]
    if (!op) return true          // an unknown op shows everything, never nothing
    return op(row.values[f.propId], f.value)
  }))
}

/**
 * Sort by one property, with a comparator chosen by its TYPE.
 *
 * Comparing everything as strings is the classic bug: "10" sorts before "9",
 * and dates sort alphabetically. Empty always sinks to the bottom regardless
 * of direction — a blank cell is not "smallest", it is absent, and burying the
 * blanks is what people mean by sorting.
 */
export function sortRows(db, rows, sortBy) {
  if (!sortBy?.propId) return rows
  const prop = db.properties.find(p => p.id === sortBy.propId)
  if (!prop) return rows
  const dir = sortBy.desc ? -1 : 1
  const empty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

  const optionOrder = new Map((prop.options || []).map((o, i) => [o.id, i]))

  return [...rows].sort((ra, rb) => {
    const a = ra.values[sortBy.propId]
    const b = rb.values[sortBy.propId]
    if (empty(a) && empty(b)) return 0
    if (empty(a)) return 1
    if (empty(b)) return -1

    switch (prop.type) {
      case 'number':
      case 'date':
        return (Number(a) - Number(b)) * dir
      case 'checkbox':
        return ((a ? 1 : 0) - (b ? 1 : 0)) * dir
      case 'select':
        /* By the option's position in the list, not its name. A status column
           is ordered Todo → Doing → Done because that is the order someone
           arranged them in; alphabetical would give Doing → Done → Todo. */
        return ((optionOrder.get(a) ?? 0) - (optionOrder.get(b) ?? 0)) * dir
      default:
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * dir
    }
  })
}

/**
 * Arrange rows into board columns.
 *
 * The empty group is always present and always last. A board that hides
 * un-statused rows loses them — people put a card on a board precisely because
 * they have not decided yet.
 */
export function groupRows(db, rows, propId) {
  const prop = db.properties.find(p => p.id === propId)
  if (!prop || !isGroupable(prop.type)) return null

  if (prop.type === 'checkbox') {
    return [
      { key: 'true', name: prop.name, color: 'accent', rows: rows.filter(r => r.values[propId] === true) },
      { key: 'false', name: `Not ${prop.name}`, color: 'text-3', rows: rows.filter(r => r.values[propId] !== true) },
    ]
  }

  const groups = (prop.options || []).map(o => ({
    key: o.id,
    name: o.name,
    color: o.color,
    rows: rows.filter(r => (prop.type === 'multi'
      ? Array.isArray(r.values[propId]) && r.values[propId].includes(o.id)
      : r.values[propId] === o.id)),
  }))

  const assigned = new Set()
  for (const g of groups) for (const r of g.rows) assigned.add(r.id)
  groups.push({
    key: '__none__',
    name: 'No ' + prop.name.toLowerCase(),
    color: 'text-3',
    rows: rows.filter(r => !assigned.has(r.id)),
  })
  return groups
}

/** Everything a view needs, in one call: filter, then sort, then group. */
export function resolveView(db, view) {
  const v = view || db.views[0]
  if (!v) return { rows: [], groups: null, view: null }
  const filtered = applyFilters(db, db.rows, v.filters)
  const sorted = sortRows(db, filtered, v.sortBy)
  const groups = v.kind === 'board' && v.groupBy ? groupRows(db, sorted, v.groupBy) : null
  return { rows: sorted, groups, view: v }
}

export const activeView = db =>
  db?.views?.find(v => v.id === db.activeViewId) || db?.views?.[0] || null

/* ── views ───────────────────────────────────────────────────────────── */

export function createView(db, { name, kind = 'table', newId = newDbId } = {}) {
  const view = {
    id: newId('view'),
    name: name || VIEW_KINDS[kind]?.label || 'View',
    kind,
    sortBy: null,
    filters: [],
    hidden: [],
  }
  /* A board needs something to group by and a calendar needs a date, so both
     pick a sensible default rather than opening empty and blaming the user. */
  if (kind === 'board') view.groupBy = db.properties.find(p => isGroupable(p.type))?.id || null
  if (kind === 'calendar') view.dateProp = db.properties.find(p => p.type === 'date')?.id || null
  return view
}

export const addView = (db, view) => ({ ...db, views: [...db.views, view] })

/** Remove a view. The last one is refused — a database must render something. */
export function removeView(db, viewId) {
  if (db.views.length <= 1) return db
  const views = db.views.filter(v => v.id !== viewId)
  return { ...db, views, activeViewId: db.activeViewId === viewId ? views[0].id : db.activeViewId }
}

export function updateView(db, viewId, patch) {
  return { ...db, views: db.views.map(v => (v.id === viewId ? { ...v, ...patch } : v)) }
}

/* ── pipeline, record and activity (Builder Phase 1, 24 Sep 2026) ────────

   A Pipeline is a board of this database grouped by a Select property (the
   stages). Two things a plain board does not need:

   · A MANUAL ORDER inside each stage. `row.rank` is a number; rows without
     one fall back to their position in `db.rows`, so a database that has
     never been on a pipeline needs no migration.
   · An ACTIVITY LOG per row. `row.activity` is newest-first:
     { id, kind: 'system' | 'comment', text, at (ms), by }. Moving a card to a
     new stage writes a system entry, so the timeline tells the story without
     anyone typing it. */

const rankOf = (db, row) => (typeof row.rank === 'number' ? row.rank : db.rows.indexOf(row))

/**
 * The pipeline's columns: one per option of `groupBy` in option order, then
 * "No <stage>" last. Each carries its rows in rank order, a count, and the sum
 * of `valueProp` when one is set.
 */
export function stageSummary(db, groupBy, valueProp) {
  const prop = db?.properties?.find(p => p.id === groupBy)
  if (!prop || prop.type !== 'select') return null
  const inRank = rows => [...rows].sort((a, b) => rankOf(db, a) - rankOf(db, b))
  const sum = rows => {
    if (!valueProp) return null
    return rows.reduce((s, r) => s + (typeof r.values[valueProp] === 'number' ? r.values[valueProp] : 0), 0)
  }
  const cols = (prop.options || []).map(o => {
    const rows = inRank(db.rows.filter(r => r.values[groupBy] === o.id))
    return { key: o.id, name: o.name, color: o.color, rows, count: rows.length, sum: sum(rows) }
  })
  const none = inRank(db.rows.filter(r => !(prop.options || []).some(o => o.id === r.values[groupBy])))
  cols.push({ key: '__none__', name: 'No ' + prop.name.toLowerCase(), color: 'text-3', rows: none, count: none.length, sum: sum(none) })
  return cols
}

/** Every row in pipeline reading order (stage by stage, rank within). */
export function pipelineOrder(db, groupBy) {
  const cols = stageSummary(db, groupBy, null)
  return cols ? cols.flatMap(c => c.rows.map(r => r.id)) : (db?.rows || []).map(r => r.id)
}

let actSeq = 0
const newActId = () => `act_${Date.now().toString(36)}${(++actSeq).toString(36)}`

/** Prepend an activity entry to a row. */
export function addActivity(db, rowId, { kind = 'comment', text, at = Date.now(), by = 'You' } = {}) {
  const t = String(text ?? '').trim()
  if (!t) return db
  return {
    ...db,
    rows: db.rows.map(r => (r.id === rowId
      ? { ...r, activity: [{ id: newActId(), kind, text: t, at, by }, ...(r.activity || [])] }
      : r)),
  }
}

/**
 * Move a row to a stage (an option id, or '__none__'), placed before
 * `beforeRowId` in that stage, or at the end when it is null. Re-ranks the
 * target stage 0..n so ranks never collide. Logs "Moved to <stage>" when
 * the stage actually changed.
 */
export function moveRow(db, rowId, groupBy, stageKey, beforeRowId = null, { at = Date.now(), by = 'You' } = {}) {
  const prop = db.properties.find(p => p.id === groupBy)
  const row = db.rows.find(r => r.id === rowId)
  if (!prop || !row) return db
  const nextVal = stageKey === '__none__' ? null : coerceValue(prop, stageKey)
  const changed = (row.values[groupBy] ?? null) !== nextVal
  const cols = stageSummary(db, groupBy, null)
  const target = (cols.find(c => c.key === (nextVal ?? '__none__')) || { rows: [] }).rows.filter(r => r.id !== rowId)
  let at_ = beforeRowId ? target.findIndex(r => r.id === beforeRowId) : -1
  if (at_ < 0) at_ = target.length
  const ordered = [...target.slice(0, at_), row, ...target.slice(at_)]
  const rank = new Map(ordered.map((r, i) => [r.id, i]))
  let next = {
    ...db,
    rows: db.rows.map(r => {
      if (r.id === rowId) return { ...r, rank: rank.get(r.id), values: { ...r.values, [groupBy]: nextVal } }
      return rank.has(r.id) ? { ...r, rank: rank.get(r.id) } : r
    }),
  }
  if (changed) {
    const name = nextVal ? (prop.options.find(o => o.id === nextVal)?.name || 'a stage') : 'No ' + prop.name.toLowerCase()
    next = addActivity(next, rowId, { kind: 'system', text: `Moved to ${name}`, at, by })
  }
  return next
}

/* ── summary ─────────────────────────────────────────────────────────── */

export function describeDatabase(db) {
  const rows = db?.rows?.length || 0
  const props = (db?.properties?.length || 1) - 1     // the title is not a "field"
  return `${rows} ${rows === 1 ? 'row' : 'rows'} · ${props} ${props === 1 ? 'field' : 'fields'}`
}
