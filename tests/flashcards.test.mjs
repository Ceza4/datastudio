/* Flashcards: SM-2 scheduling, queue, bulk entry, links, asset ids. */
import {
  createCard, review, nextEase, previewIntervals, buildQueue, deckStats, dueLabel, parseBulk,
  safeUrl, flashcardFileIds, normalizeCard, formatInterval, DAY, MINUTE, RELEARN_MS, MIN_EASE,
} from '../lib/flashcards.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
const T0 = Date.UTC(2026, 8, 25, 9, 0, 0)

console.log('\n SM-2 ease')
ok(nextEase(2.5, 5) === 2.6, 'Easy (q5): EF +0.10')
ok(nextEase(2.5, 4) === 2.5, 'Good (q4): EF unchanged')
ok(nextEase(2.5, 3) === 2.36, 'Hard (q3): EF -0.14')
ok(nextEase(2.5, 1) === 1.96, 'Again (q1): EF -0.54')
ok(nextEase(1.3, 1) === MIN_EASE, 'EF never below 1.3')

console.log('\n SM-2 intervals')
let c = createCard({ front: 'a', back: 'b', now: T0 })
ok(c.due === null && c.reps === 0 && c.ease === 2.5, 'a new card is unscheduled')
c = review(c, 'good', T0)
ok(c.interval === 1 && c.reps === 1 && c.due === T0 + DAY, 'first Good: 1 day')
c = review(c, 'good', T0 + DAY)
ok(c.interval === 6 && c.reps === 2, 'second Good: 6 days')
c = review(c, 'good', T0 + 7 * DAY)
ok(c.interval === 15 && c.reps === 3, 'third Good: round(6 × 2.5) = 15 days')
const hard = review(c, 'hard', T0 + 22 * DAY)
ok(hard.interval === 18 && hard.ease === 2.36, 'Hard: at most 1.2× the last interval, ease -0.14')
const easy = review(c, 'easy', T0 + 22 * DAY)
ok(easy.interval === Math.round(15 * 2.6 * 1.3), 'Easy: I × EF × 1.3 bonus')
const lapse = review(c, 'again', T0 + 22 * DAY)
ok(lapse.reps === 0 && lapse.lapses === 1 && lapse.due === T0 + 22 * DAY + RELEARN_MS, 'Again: back in 10 minutes, reps reset, a lapse counted')
const relearned = review(lapse, 'good', T0 + 22 * DAY + RELEARN_MS)
ok(relearned.interval === 1, 'after a lapse the next Good restarts at 1 day')
ok(review(createCard({ now: T0 }), 'again', T0).lapses === 0, 'failing a NEW card is not a lapse')
ok(review(createCard({ now: T0 }), 'easy', T0).interval === 4, 'Easy on a new card: 4 days')
ok(c.history.length === 3 && c.history[2].grade === 'good' && c.history[2].interval === 15, 'history records every review')
let threw = false
try { review(c, 'meh', T0) } catch { threw = true }
ok(threw, 'an unknown grade throws')

console.log('\n previews + labels')
const p = previewIntervals(createCard({ now: T0 }), T0)
ok(p.again === '10m' && p.hard === '1d' && p.good === '1d' && p.easy === '4d', 'new card buttons: 10m / 1d / 1d / 4d')
const p2 = previewIntervals(review(createCard({ now: T0 }), 'good', T0), T0 + DAY)
ok(p2.hard === '3d' && p2.good === '6d' && p2.easy === '8d', 'second review: Hard, Good and Easy all differ')
ok(formatInterval(45 * MINUTE) === '45m' && formatInterval(3 * 3600e3) === '3h' && formatInterval(40 * DAY) === '1mo', 'interval formatting')
ok(dueLabel(createCard(), T0) === 'new' && dueLabel({ due: T0 - 1 }, T0) === 'due now' && dueLabel({ due: T0 + 2 * DAY }, T0) === 'due in 2d', 'due labels')

console.log('\n queue + stats')
const mk = (i, due) => ({ ...createCard({ front: 'c' + i, now: T0 + i }), due, reps: due == null ? 0 : 1, interval: due == null ? 0 : 1, history: due == null ? [] : [{ at: T0 - 5 * DAY, grade: 'good', interval: 1, ease: 2.5 }] })
const deck = [mk(1, T0 - DAY), mk(2, T0 - 2 * DAY), mk(3, T0 + DAY), mk(4, null), mk(5, null), mk(6, null)]
let q = buildQueue(deck, { now: T0, newPerDay: 2 })
ok(q.join() === [deck[1].id, deck[0].id, deck[3].id, deck[4].id].join(), 'due first (oldest first), then new cards up to the daily limit')
const st = deckStats(deck, { now: T0, newPerDay: 2 })
ok(st.total === 6 && st.due === 2 && st.new === 3 && st.newToday === 2 && st.toStudy === 4, 'stats count due, new and today\'s allowance')
ok(st.nextDue === T0 + DAY, 'next due time for the "all caught up" screen')
const introduced = deck.map((x, i) => (i === 3 ? review(x, 'good', T0) : x))
ok(deckStats(introduced, { now: T0 + 1000, newPerDay: 2 }).newToday === 1, 'new cards studied today use up the allowance')
ok(buildQueue([], {}).length === 0 && deckStats(undefined).total === 0, 'empty deck is fine')

console.log('\n normalize')
const n = normalizeCard({ id: 'x', front: 3, ease: 0.2, reps: -4, history: 'no' })
ok(n.front === '' && n.ease === MIN_EASE && n.reps === 0 && Array.isArray(n.history) && n.due === null, 'damaged cards are made usable')
ok(normalizeCard(null) === null, 'non-objects are dropped')

console.log('\n bulk + links + assets')
const b = parseBulk('mitochondria - powerhouse\nH2O\twater\n\nPi :: 3.14159\njust a front\n')
ok(b.length === 4 && b[0].back === 'powerhouse' && b[1].back === 'water' && b[2].back === '3.14159' && b[3].back === '', 'tab, " - " and " :: " separators; blank lines skipped')
ok(safeUrl('example.com/x') === 'https://example.com/x', 'a bare domain becomes https')
ok(safeUrl('javascript:alert(1)') === null && safeUrl('data:text/html,hi') === null, 'script and data URLs are refused')
ok(safeUrl('http://a.b') === 'http://a.b/', 'http is allowed')
ok(flashcardFileIds({ cards: [{ attachments: [{ fileId: 'file_1' }, {}] }, { attachments: [{ fileId: 'file_2' }] }] }).join() === 'file_1,file_2', 'attachment file ids for the keep-set')

console.log('\n comfortable minimum sizes')
const { clampToMin, growBlocksToMin, blockDims, BLOCK_TYPES, minDimsOf, createBlock } = await import('../components/notebook/blockRegistry.js')
const { kanbanMinDims, LANE_MIN } = await import('../lib/kanban.js')
const lanes3 = [{ id: 'a', cards: [] }, { id: 'b', cards: [] }, { id: 'c', cards: [] }]
const small = { id: 'k', type: 'kanban', x: 0, y: 0, w: 200, h: 100, lanes: lanes3 }
ok(clampToMin(small).w === kanbanMinDims(3).w && clampToMin(small).h === 300, `a 3-lane kanban stored at 200×100 renders at ${kanbanMinDims(3).w}×300`)
ok(kanbanMinDims(5).w - kanbanMinDims(4).w >= LANE_MIN, 'each lane adds at least a lane\'s minimum width to the floor')
ok(kanbanMinDims(0).w === kanbanMinDims(2).w, 'an empty board is still sized for two lanes')
const fine = { id: 'k2', type: 'kanban', x: 0, y: 0, w: 900, h: 400, lanes: lanes3 }
ok(clampToMin(fine) === fine, 'a block above its floor is returned untouched')
ok(blockDims(small).w === kanbanMinDims(3).w, 'blockDims honours the floor too')
const nbs = [{ id: 'n', sheets: [{ id: 's', blocks: [small, fine] }] }, { id: 'm', sheets: [{ id: 't', blocks: [fine] }] }]
const grown = growBlocksToMin(nbs)
ok(grown !== nbs && grown[0].sheets[0].blocks[0].w === kanbanMinDims(3).w && grown[1] === nbs[1], 'growBlocksToMin rewrites only what is under')
ok(growBlocksToMin([nbs[1]])[0] === nbs[1], '…and keeps identity when nothing is')
ok(['table', 'kanban', 'section', 'document', 'calendar', 'database', 'chat', 'flashcards', 'pipeline', 'record'].every(t => BLOCK_TYPES[t].minDims), 'every resizable block with chrome declares a floor')
ok(['table', 'kanban', 'document', 'calendar', 'database', 'chat', 'flashcards'].every(t => {
  const b = createBlock(t, { id: 'x', x: 0, y: 0, now: 1 }); const d = BLOCK_TYPES[t].dims, m = minDimsOf(b)
  return d.w >= m.w && d.h >= m.h
}), 'no type spawns below its own floor')

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
