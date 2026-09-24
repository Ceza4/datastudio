/* Link picker targets: Blocks, then Sheets, then Notebooks (24 Sep 2026). */
import { searchTargets, parseAddress, serializeAddress, resolveTarget, addressKind, makeSheetAddress, makeNotebookAddress } from '../lib/teleport.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
const WS = [
  { id: 'nb1', name: 'Finance', sheets: [{ id: 's1', name: 'Budget', blocks: [{ id: 'b1', type: 'text', name: 'Budget notes' }] }] },
  { id: 'nb2', name: 'Budget 2027', sheets: [{ id: 's2', name: 'Draft', blocks: [] }] },
]
const g = searchTargets(WS, 'budget')
ok(g.blocks.length === 1 && g.blocks[0].kind === 'block', 'block group')
ok(g.sheets.some(s => s.label === 'Budget') && g.sheets.every(s => s.kind === 'sheet'), 'sheet group')
ok(g.notebooks.length === 1 && g.notebooks[0].label === 'Budget 2027', 'notebook group')
ok(searchTargets(WS, '').notebooks.length === 2, 'empty query lists every notebook')
const sa = makeSheetAddress('nb1', 's1'), na = makeNotebookAddress('nb2')
ok(addressKind(sa) === 'sheet' && addressKind(na) === 'notebook', 'kinds')
ok(serializeAddress(sa) === 'nb1/s1' && serializeAddress(na) === 'nb2', 'serialise')
ok(addressKind(parseAddress('nb1/s1')) === 'sheet' && addressKind(parseAddress('nb2')) === 'notebook', 'parse back')
ok(resolveTarget(WS, sa).ok && resolveTarget(WS, na).ok, 'sheet and notebook links resolve')
ok(resolveTarget(WS, makeSheetAddress('nb1', 'gone')).reason === 'sheet', 'a deleted sheet is dangling as "sheet"')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
