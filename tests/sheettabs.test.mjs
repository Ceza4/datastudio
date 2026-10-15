/* Sheets inside one table block: storage swap, names, add/move/duplicate/delete. */
import {
  tabsOf, activeTabId, allSheets, nameError, uniqueName, switchTab, addTab, renameTab,
  setTabColor, moveTab, duplicateTab, removeTab, sheetHasData,
} from '../lib/sheettabs.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
const apply = (b, p) => ({ ...b, ...p })

const plain = { id: 'b', type: 'table', headers: ['A', 'B'], rows: [['1', '2']], colWidths: { 0: 90 } }

console.log('\n a table that never had tabs')
ok(tabsOf(plain).length === 1 && tabsOf(plain)[0].name === 'Sheet1', 'reads as one tab called Sheet1')
ok(allSheets(plain)[0].rows === plain.rows && allSheets(plain)[0].active, 'its data is the top level')
ok(!('tabs' in plain), 'nothing is written just by reading')

console.log('\n add + switch')
let p = addTab(plain)
let b = apply(plain, p)
ok(b.tabs.length === 2 && b.tabs[1].name === 'Sheet2', 'the new sheet is Sheet2, at the end')
ok(b.activeTab === p._newId && b.headers.length === 1 && b.rows.length === 8, 'switched to it: a blank 8-row sheet on top')
ok(b.tabs[0].data.rows === plain.rows && b.tabs[0].data.colWidths === plain.colWidths, 'Sheet1 parked with its rows and widths')
ok(!b.tabs[1].data, 'the active tab carries no copy of its own data')
b = apply(b, { rows: [['x']] })     // edit Sheet2 through the ordinary top-level path
const s1 = b.tabs[0].id
b = apply(b, switchTab(b, s1))
ok(b.rows === plain.rows && b.headers === plain.headers && b.colWidths === plain.colWidths, 'switching back restores Sheet1 exactly')
ok(b.tabs[1].data.rows[0][0] === 'x', 'and Sheet2 kept its edit')
ok(switchTab(b, s1) === null && switchTab(b, 'nope') === null, 'switching to the current or an unknown tab is a no-op')
ok(allSheets(b).map(s => s.rows[0][0]).join() === '1,x', 'allSheets resolves every sheet')

console.log('\n names (Excel rules)')
const tabs = tabsOf(b)
ok(nameError('Readings', tabs) === '', 'a normal name is fine')
ok(nameError('   ', tabs) !== '' && nameError('a'.repeat(32), tabs) !== '', 'empty and over-31 refused')
ok(['a:b', 'a/b', 'a\\b', 'a?', 'a*', '[a]'].every(n => nameError(n, tabs) !== ''), ': / \\ ? * [ ] refused')
ok(nameError("'quoted", tabs) !== '' && nameError('History', tabs) !== '', 'leading apostrophe and "History" refused')
ok(nameError('sheet2', tabs) !== '' && nameError('Sheet2', tabs, tabs[1].id) === '', 'case-insensitive uniqueness, own name allowed')
ok(uniqueName('Sheet', [{ name: 'Sheet1' }, { name: 'Sheet2' }]) === 'Sheet3', 'next free SheetN')
const r = renameTab(b, tabs[1].id, '  Summary  ')
ok(r.tabs[1].name === 'Summary', 'rename trims')
ok(renameTab(b, tabs[1].id, 'Sheet1').error, 'rename to a taken name returns the error')
b = apply(b, r)

console.log('\n colour, move, duplicate')
b = apply(b, setTabColor(b, tabs[1].id, '#1F5FBF'))
ok(b.tabs[1].color === '#1F5FBF', 'tab colour set')
b = apply(b, setTabColor(b, tabs[1].id, ''))
ok(!b.tabs[1].color, 'and cleared')
b = apply(b, addTab(b, { name: 'Rural' }))
ok(b.tabs.map(t => t.name).join() === 'Sheet1,Summary,Rural', 'three sheets')
b = apply(b, moveTab(b, b.tabs[2].id, 0))
ok(b.tabs.map(t => t.name).join() === 'Rural,Sheet1,Summary', 'Rural moved to the front')
ok(moveTab(b, b.tabs[0].id, 0) === null, 'moving to the same place is a no-op')
const sum = b.tabs.find(t => t.name === 'Summary').id
const dup = duplicateTab(b, sum)
b = apply(b, dup)
ok(b.tabs.map(t => t.name).join() === 'Rural,Sheet1,Summary,Summary (2)', 'duplicate lands right after, named "(2)"')
ok(b.rows[0][0] === 'x' && b.activeTab === dup._newId, 'with the data, and switched to')
b.rows[0][0] = 'changed'
ok(allSheets(b).find(s => s.name === 'Summary').rows[0][0] === 'x', 'the copy is deep: editing it leaves the original alone')

console.log('\n delete')
const one = { ...plain }
ok(removeTab(one, tabsOf(one)[0].id) === null, 'the last sheet cannot be deleted')
const before = b
const act = b.activeTab
const del = removeTab(b, act)
b = apply(b, del.patch)
ok(b.tabs.length === 3 && !b.tabs.some(t => t.id === act), 'active sheet deleted')
ok(b.activeTab === sum && b.rows[0][0] === 'x', 'moved to the neighbour before it, whose data is now on top')
const back = apply(b, del.undo)
ok(back.tabs === before.tabs && back.rows === before.rows && back.activeTab === before.activeTab, 'undo puts everything back')
const rural = b.tabs[0].id
const del2 = removeTab(b, rural)
ok(del2.patch.activeTab === b.activeTab && del2.patch.rows === b.rows, 'deleting an inactive sheet keeps the current one on top')

console.log('\n content')
ok(sheetHasData({ rows: [[''], ['  ']] }) === false && sheetHasData({ rows: [['', 'a']] }) === true, 'blank vs filled')
ok(sheetHasData({ headers: ['Name'], rows: [] }) === true, 'a named header counts')

console.log('\n export')
const { expandSheets } = await import('../lib/exporters.js')
const multi = apply(apply(plain, addTab(plain)), { name: 'Data' })
const lone = expandSheets([multi])
ok(lone.length === 2 && lone.map(t => t.name).join() === 'Sheet1,Sheet2', 'a lone table exports one table per sheet, named as the tabs')
const two = expandSheets([multi, { ...plain, id: 'c', name: 'Other' }])
ok(two.length === 3 && two[0].name === 'Data – Sheet1' && two[2].name === 'Other', 'next to other tables the sheets are prefixed')
ok(lone[0].rows === plain.rows && lone[1].rows.length === 8, 'each sheet carries its own rows')
ok(expandSheets([plain])[0] === plain, 'a single-sheet table passes through untouched')

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
