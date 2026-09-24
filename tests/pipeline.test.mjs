/* Builder Phase 1 model: pipeline stages, moves, activity, relations. */
import { createRow, addRow, stageSummary as pipelineStages, pipelineOrder, moveRow, addActivity, setCell, removeRow, createProperty, addProperty, coerceValue } from '../lib/database.js'
import { starterPipelineDb, relTime } from '../lib/builder.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
let { db, stageId, valueId } = starterPipelineDb({ sample: false })
const [lead, contacted] = db.properties.find(p => p.id === stageId).options.map(o => o.id)
const mk = (name, stage, value) => { const r = createRow(db, { values: { [db.titlePropId]: name, [stageId]: stage, [valueId]: value } }); db = addRow(db, r); return r.id }
const a = mk('Ann', lead, 100), b = mk('Ben', lead, 50), c = mk('Cy', contacted, 200), d = mk('Dee', null, 10)

console.log('\n stages')
let st = pipelineStages(db, stageId, valueId)
ok(st.length === 5 && st[4].key === '__none__', 'four stages + No stage last')
ok(st[0].count === 2 && st[0].sum === 150, 'count and value roll-up per stage')
ok(st[4].rows[0].id === d, 'unstaged rows land in No stage')
ok(pipelineStages(db, valueId, null) === null, 'grouping by a non-select is refused')

console.log('\n moves')
db = moveRow(db, c, stageId, lead, a, { at: 1 })
st = pipelineStages(db, stageId, valueId)
ok(st[0].rows.map(r => r.id).join() === [c, a, b].join(), 'dropped before Ann: order Cy, Ann, Ben')
ok(st[0].sum === 350 && st[1].count === 0, 'roll-ups follow the move')
ok(db.rows.find(r => r.id === c).activity[0].text === 'Moved to New lead', 'stage change logs activity')
db = moveRow(db, c, stageId, lead, null)
ok(pipelineStages(db, stageId).at(0).rows.at(-1).id === c, 'reorder within a stage, to the end')
ok(db.rows.find(r => r.id === c).activity.length === 1, 'a reorder in the same stage logs nothing')
db = moveRow(db, a, stageId, '__none__')
ok(db.rows.find(r => r.id === a).values[stageId] === null, 'moving to No stage clears the value')
ok(relTime(Date.now() - 3 * 3600e3) === '3h ago', 'relative time')
ok(pipelineOrder(db, stageId)[0] === b, 'pipeline order walks stage by stage')

console.log('\n activity')
db = addActivity(db, b, { text: '  Called, keen on mornings ' })
ok(db.rows.find(r => r.id === b).activity[0].text === 'Called, keen on mornings', 'comment trimmed and prepended')
ok(addActivity(db, b, { text: '   ' }) === db, 'an empty comment is ignored')

console.log('\n relation')
const rel = createProperty({ name: 'Referred by', type: 'relation' })
ok(rel.target === null, 'relation defaults to this database')
db = addProperty(db, rel)
db = setCell(db, b, rel.id, [a, a, c, 5, ''])
ok(JSON.stringify(db.rows.find(r => r.id === b).values[rel.id]) === JSON.stringify([a, c]), 'ids deduped, junk dropped')
ok(JSON.stringify(coerceValue(rel, '')) === '[]', 'empty relation is an empty list')
db = removeRow(db, a)
ok(JSON.stringify(db.rows.find(r => r.id === b).values[rel.id]) === JSON.stringify([c]), 'deleting a row removes it from relations')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
