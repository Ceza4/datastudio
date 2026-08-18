/*
  tests/database.test.mjs
  --------------------------------------------------------------------------
  §9.2 Builder — the database block's model.

  THREE FAILURE MODES, and none of them throws:

  1. A VALUE IN THE WRONG SHAPE. "12abc" in a number column, or NaN, which
     survives JSON, compares false to itself and sorts at random. The column
     looks fine and every sort that touches it is wrong.

  2. A DANGLING REFERENCE. Deleting a property is a graph operation — values,
     view groupBy, sortBy and filters all name it by id. A one-line filter
     leaves a board grouped by a column that no longer exists.

  3. A COMPARATOR CHOSEN BY DEFAULT. Sorting numbers as strings puts 10 before
     9, and dates alphabetically. Nothing errors; the order is just wrong.

  So most assertions here are about what happens AFTER a destructive edit, and
  about the exact ordering of mixed data.
  -------------------------------------------------------------------------- */

import {
  createDatabase, createProperty, createOption, createRow,
  coerceValue, coerceValues, rowTitle,
  addProperty, removeProperty, changePropertyType, addOption, removeOption,
  addRow, removeRow, setCell,
  applyFilters, sortRows, groupRows, resolveView, activeView,
  createView, addView, removeView, updateView,
  isGroupable, describeDatabase, PROPERTY_TYPE_IDS, OPTION_COLORS,
} from '../lib/database.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

let n = 0
const newId = p => `${p}${++n}`
const reset = () => { n = 0 }

/* A CRM, which is the example Matas actually wrote. */
function crm() {
  reset()
  let db = createDatabase({ name: 'Companies', newId })
  const status = createProperty({ name: 'Status', type: 'select', newId })
  const revenue = createProperty({ name: 'Revenue', type: 'number', newId })
  const closed = createProperty({ name: 'Closed', type: 'date', newId })
  const active = createProperty({ name: 'Active', type: 'checkbox', newId })
  const tags = createProperty({ name: 'Tags', type: 'multi', newId })
  db = [status, revenue, closed, active, tags].reduce(addProperty, db)

  const lead = createOption({ name: 'Lead', color: 'amber', newId })
  const won = createOption({ name: 'Won', color: 'green', newId })
  db = addOption(addOption(db, status.id, lead), status.id, won)
  const eu = createOption({ name: 'EU', newId })
  db = addOption(db, tags.id, eu)

  return { db, ids: { title: db.titlePropId, status: status.id, revenue: revenue.id, closed: closed.id, active: active.id, tags: tags.id }, opts: { lead: lead.id, won: won.id, eu: eu.id } }
}

console.log('\n createDatabase')
{
  reset()
  const db = createDatabase({ name: 'X', newId })
  ok(db.properties.length === 1 && db.properties[0].type === 'title', 'is born with a title property')
  ok(db.titlePropId === db.properties[0].id, 'and knows which one it is')
  ok(db.views.length === 1 && db.views[0].kind === 'table', 'and one table view — nothing to render is not a state worth supporting')
  ok(db.rows.length === 0, 'and no rows')
  ok(PROPERTY_TYPE_IDS.includes('select') && PROPERTY_TYPE_IDS.includes('date'), 'the type set covers the Notion basics')
  ok(OPTION_COLORS.every(c => !c.startsWith('#')), 'option colours are token names, never hex — a hex is invisible in one theme')
}

console.log('\n coerceValue — the value is owned by the type')
{
  const num = createProperty({ type: 'number', newId })
  ok(coerceValue(num, '1200') === 1200, 'a numeric string becomes a number')
  ok(coerceValue(num, '1,200') === 1200, 'thousands separators are tolerated')
  ok(coerceValue(num, 'abc') === null, '"abc" is null, NOT NaN — NaN survives JSON and sorts at random')
  ok(coerceValue(num, '') === null, 'empty is null, NOT 0 — 0 is a real value nobody entered')
  ok(!Number.isNaN(coerceValue(num, 'abc')), 'and never NaN')

  const chk = createProperty({ type: 'checkbox', newId })
  ok(coerceValue(chk, true) === true && coerceValue(chk, 'true') === true, 'checkbox accepts both shapes')
  ok(coerceValue(chk, '') === false && coerceValue(chk, null) === false, 'and is false when absent, never null')

  const date = createProperty({ type: 'date', newId })
  ok(typeof coerceValue(date, '2026-09-01') === 'number', 'a date stores a timestamp')
  ok(coerceValue(date, '2026-02-30') === null, 'and an impossible date is refused — parseDate already knows this')
  ok(coerceValue(date, 46266) !== null && new Date(coerceValue(date, 46266)).getFullYear() === 2026,
     'an Excel serial is 2026, not the year 46266 — delegated to lib/tasks.js rather than reimplemented')

  const { db, ids, opts } = crm()
  const sel = db.properties.find(p => p.id === ids.status)
  ok(coerceValue(sel, opts.won) === opts.won, 'a select takes an option that exists')
  ok(coerceValue(sel, 'made_up') === null, 'and refuses one that does not — a dangling id renders a blank chip')

  const multi = db.properties.find(p => p.id === ids.tags)
  ok(JSON.stringify(coerceValue(multi, [opts.eu, opts.eu])) === JSON.stringify([opts.eu]),
     'multi-select dedupes — two identical chips, and the second is unremovable')
  ok(coerceValue(multi, 'nope').length === 0, 'and drops unknown ids')
  ok(Array.isArray(coerceValue(multi, null)), 'an empty multi is [], not null')

  ok(coerceValue(null, 'x') === null, 'a missing property does not throw')
}

console.log('\n rows and cells')
{
  const { db, ids, opts } = crm()
  let d = addRow(db, createRow(db, { values: { [ids.title]: 'Acme', [ids.revenue]: '5000' }, newId }))
  ok(d.rows.length === 1, 'a row is added')
  ok(d.rows[0].values[ids.revenue] === 5000, 'and its values are coerced on the way in')
  ok(rowTitle(d, d.rows[0]) === 'Acme', 'the title reads back')
  ok(rowTitle(d, { values: {} }) === 'Untitled', 'and an empty one has a name anyway')

  d = setCell(d, d.rows[0].id, ids.revenue, 'not a number')
  ok(d.rows[0].values[ids.revenue] === null, 'setCell coerces too — every write goes through one door')
  d = setCell(d, d.rows[0].id, 'ghost_prop', 'x')
  ok(!Object.hasOwn(d.rows[0].values, 'ghost_prop'), 'writing to a property that does not exist is ignored')
  ok(removeRow(d, d.rows[0].id).rows.length === 0, 'a row can be removed')
  ok(coerceValues(db, { made_up: 1 }).made_up === undefined, 'unknown keys never enter a row')
}

console.log('\n removeProperty — this is a GRAPH operation, not a filter')
{
  const { db, ids, opts } = crm()
  let d = addRow(db, createRow(db, { values: { [ids.title]: 'Acme', [ids.status]: opts.won }, newId }))
  d = updateView(d, d.views[0].id, {
    groupBy: ids.status,
    sortBy: { propId: ids.status, desc: false },
    filters: [{ propId: ids.status, op: 'is', value: opts.won }],
    hidden: [ids.status],
  })

  const after = removeProperty(d, ids.status)
  ok(!after.properties.some(p => p.id === ids.status), 'the property is gone')
  ok(!Object.hasOwn(after.rows[0].values, ids.status), 'and its value is gone from every row')
  ok(after.views[0].groupBy === null, 'and the board is no longer grouped by a column that does not exist')
  ok(after.views[0].sortBy === null, 'and the sort is cleared')
  ok(after.views[0].filters.length === 0, 'and the filter is dropped')
  ok(after.views[0].hidden.length === 0, 'and it leaves the hidden list')

  ok(removeProperty(d, d.titlePropId).properties.length === d.properties.length,
     'the title property is refused — a row with no title has no name')
}

console.log('\n removeOption — the same problem one level down')
{
  const { db, ids, opts } = crm()
  let d = addRow(db, createRow(db, { values: { [ids.title]: 'A', [ids.status]: opts.won, [ids.tags]: [opts.eu] }, newId }))
  d = addRow(d, createRow(d, { values: { [ids.title]: 'B', [ids.status]: opts.lead }, newId }))
  d = updateView(d, d.views[0].id, { filters: [{ propId: ids.status, op: 'is', value: opts.won }] })

  const after = removeOption(d, ids.status, opts.won)
  ok(!after.properties.find(p => p.id === ids.status).options.some(o => o.id === opts.won), 'the option is gone')
  ok(after.rows[0].values[ids.status] === null, 'the row that held it is cleared, not left dangling')
  ok(after.rows[1].values[ids.status] === opts.lead, 'other rows are untouched')
  ok(after.views[0].filters.length === 0, 'and a filter matching it is dropped')

  const multiGone = removeOption(d, ids.tags, opts.eu)
  ok(multiGone.rows[0].values[ids.tags].length === 0, 'a multi-select loses just that chip')
}

console.log('\n changePropertyType — values are re-coerced, not kept in the old shape')
{
  const { db, ids } = crm()
  let d = addRow(db, createRow(db, { values: { [ids.title]: 'A' }, newId }))
  d = setCell(d, d.rows[0].id, ids.title, '42')

  const toNumber = changePropertyType(d, ids.revenue, 'text')
  ok(toNumber.properties.find(p => p.id === ids.revenue).type === 'text', 'the type changes')

  let e = addProperty(db, createProperty({ name: 'Note', type: 'text', newId }))
  const noteId = e.properties[e.properties.length - 1].id
  e = addRow(e, createRow(e, { values: { [noteId]: 'high' }, newId }))
  e = changePropertyType(e, noteId, 'number')
  ok(e.rows[0].values[noteId] === null,
     '"high" becomes null when the column becomes a number — keeping it would poison every later sort')

  let f = updateView(db, db.views[0].id, { groupBy: ids.status })
  f = changePropertyType(f, ids.status, 'text')
  ok(f.views[0].groupBy === null, 'a board grouped by a column that stopped being groupable lets go')
  ok(!isGroupable('text') && isGroupable('select') && isGroupable('checkbox'), 'only closed-set types are groupable')
}

console.log('\n sortRows — the comparator comes from the TYPE')
{
  const { db, ids, opts } = crm()
  let d = db
  for (const [name, rev] of [['A', 9], ['B', 10], ['C', 1000]]) {
    d = addRow(d, createRow(d, { values: { [ids.title]: name, [ids.revenue]: rev }, newId }))
  }
  const asc = sortRows(d, d.rows, { propId: ids.revenue })
  ok(asc.map(r => r.values[ids.revenue]).join() === '9,10,1000',
     'numbers sort numerically — as strings, 10 would come before 9')
  const desc = sortRows(d, d.rows, { propId: ids.revenue, desc: true })
  ok(desc[0].values[ids.revenue] === 1000, 'and descending reverses it')

  /* Empty sinks, in BOTH directions. A blank cell is absent, not smallest. */
  let e = addRow(d, createRow(d, { values: { [ids.title]: 'D' }, newId }))
  ok(sortRows(e, e.rows, { propId: ids.revenue }).at(-1).values[ids.title] === 'D', 'empty sinks ascending')
  ok(sortRows(e, e.rows, { propId: ids.revenue, desc: true }).at(-1).values[ids.title] === 'D', 'and descending too')

  /* Select sorts by the order someone arranged the options in, not the name.
     Lead was created before Won, so Lead comes first — alphabetically it also
     would, so the test uses the option ids to be sure. */
  let s = db
  s = addRow(s, createRow(s, { values: { [ids.title]: 'won', [ids.status]: opts.won }, newId }))
  s = addRow(s, createRow(s, { values: { [ids.title]: 'lead', [ids.status]: opts.lead }, newId }))
  ok(sortRows(s, s.rows, { propId: ids.status })[0].values[ids.status] === opts.lead,
     'a select sorts by option ORDER — a status column reads Todo, Doing, Done, not alphabetically')

  ok(sortRows(d, d.rows, null) === d.rows, 'no sort returns the rows untouched')
  ok(sortRows(d, d.rows, { propId: 'ghost' }).length === d.rows.length, 'sorting by a missing property does not lose rows')
  const original = [...d.rows]
  sortRows(d, d.rows, { propId: ids.revenue })
  ok(d.rows.every((r, i) => r === original[i]), 'and sorting never mutates the input array')
}

console.log('\n applyFilters')
{
  const { db, ids, opts } = crm()
  let d = db
  d = addRow(d, createRow(d, { values: { [ids.title]: 'A', [ids.status]: opts.won, [ids.revenue]: 100 }, newId }))
  d = addRow(d, createRow(d, { values: { [ids.title]: 'B', [ids.status]: opts.lead, [ids.revenue]: 5 }, newId }))
  d = addRow(d, createRow(d, { values: { [ids.title]: 'C' }, newId }))

  ok(applyFilters(d, d.rows, [{ propId: ids.status, op: 'is', value: opts.won }]).length === 1, 'is')
  ok(applyFilters(d, d.rows, [{ propId: ids.status, op: 'isNot', value: opts.won }]).length === 2, 'isNot')
  ok(applyFilters(d, d.rows, [{ propId: ids.status, op: 'isEmpty' }]).length === 1, 'isEmpty')
  ok(applyFilters(d, d.rows, [{ propId: ids.status, op: 'isNotEmpty' }]).length === 2, 'isNotEmpty')
  ok(applyFilters(d, d.rows, [{ propId: ids.revenue, op: 'gt', value: 50 }]).length === 1, 'gt')
  ok(applyFilters(d, d.rows, [{ propId: ids.title, op: 'contains', value: 'a' }]).length === 1, 'contains is case-insensitive')
  ok(applyFilters(d, d.rows, []).length === 3 && applyFilters(d, d.rows, null).length === 3, 'no filters shows everything')
  ok(applyFilters(d, d.rows, [{ propId: ids.status, op: 'made_up' }]).length === 3,
     'an unknown operator shows EVERYTHING — hiding rows because of a bad filter looks like data loss')
  ok(applyFilters(d, d.rows, [
    { propId: ids.status, op: 'isNotEmpty' }, { propId: ids.revenue, op: 'gt', value: 50 },
  ]).length === 1, 'filters are ANDed')
}

console.log('\n groupRows — a board never loses a card')
{
  const { db, ids, opts } = crm()
  let d = db
  d = addRow(d, createRow(d, { values: { [ids.title]: 'A', [ids.status]: opts.won }, newId }))
  d = addRow(d, createRow(d, { values: { [ids.title]: 'B', [ids.status]: opts.lead }, newId }))
  d = addRow(d, createRow(d, { values: { [ids.title]: 'C' }, newId }))

  const g = groupRows(d, d.rows, ids.status)
  ok(g.length === 3, 'one column per option, plus one more')
  ok(g.at(-1).key === '__none__' && g.at(-1).rows.length === 1,
     'the ungrouped column always exists and comes last — a card with no status is exactly why boards exist')
  ok(g.reduce((n2, x) => n2 + x.rows.length, 0) === 3, 'every row lands in exactly one column')
  ok(g[0].color === 'amber' && !g[0].color.startsWith('#'), 'columns carry a token name, not a hex')

  const chk = groupRows(d, d.rows, ids.active)
  ok(chk.length === 2 && chk[1].rows.length === 3, 'a checkbox groups into two, with unset counting as false')
  ok(groupRows(d, d.rows, ids.title) === null, 'grouping by free text is refused — that is a very wide table, not a board')
  ok(groupRows(d, d.rows, 'ghost') === null, 'and by a missing property')
}

console.log('\n views')
{
  const { db, ids, opts } = crm()
  let d = addView(db, createView(db, { kind: 'board', newId }))
  const board = d.views[1]
  ok(board.groupBy === ids.status, 'a new board picks a groupable property rather than opening empty')

  d = addView(d, createView(d, { kind: 'calendar', newId }))
  ok(d.views[2].dateProp === ids.closed, 'and a calendar picks a date property')

  ok(activeView(d).id === d.views[0].id, 'with no active id set, the first view is active')
  d = { ...d, activeViewId: board.id }
  ok(activeView(d).id === board.id, 'and otherwise the one named')

  const gone = removeView(d, board.id)
  ok(gone.views.length === 2, 'a view can be removed')
  ok(gone.activeViewId === gone.views[0].id, 'and the active id follows if it was the one removed')
  const one = createDatabase({ newId })
  ok(removeView(one, one.views[0].id).views.length === 1, 'the last view is refused — something must render')
}

console.log('\n resolveView — filter, then sort, then group')
{
  const { db, ids, opts } = crm()
  let d = db
  d = addRow(d, createRow(d, { values: { [ids.title]: 'A', [ids.status]: opts.won, [ids.revenue]: 10 }, newId }))
  d = addRow(d, createRow(d, { values: { [ids.title]: 'B', [ids.status]: opts.won, [ids.revenue]: 900 }, newId }))
  d = addRow(d, createRow(d, { values: { [ids.title]: 'C', [ids.status]: opts.lead, [ids.revenue]: 5 }, newId }))

  const view = { ...createView(d, { kind: 'board', newId }), groupBy: ids.status,
    filters: [{ propId: ids.status, op: 'is', value: opts.won }],
    sortBy: { propId: ids.revenue, desc: true } }

  const r = resolveView(d, view)
  ok(r.rows.length === 2, 'the filter runs first')
  ok(r.rows[0].values[ids.revenue] === 900, 'then the sort')
  ok(r.groups.find(g => g.key === opts.won).rows.length === 2, 'then the grouping, over the filtered set')
  ok(r.groups.find(g => g.key === opts.lead).rows.length === 0, 'a filtered-out option keeps its column, empty')

  ok(resolveView(d, null).rows.length === 3, 'no view falls back to the first, unfiltered')
  ok(resolveView({ views: [] }, null).rows.length === 0, 'a database with no views does not throw')
  ok(resolveView(d, { ...view, kind: 'table' }).groups === null, 'a table view is not grouped')
}

console.log('\n describeDatabase')
{
  const { db, ids } = crm()
  ok(describeDatabase(db) === '0 rows · 5 fields', 'summarises, and the title is not counted as a field')
  ok(describeDatabase(addRow(db, createRow(db, { newId }))) === '1 row · 5 fields', 'and singularises')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
export default { pass, fail }
