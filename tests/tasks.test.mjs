/*
  tests/tasks.test.mjs
  --------------------------------------------------------------------------
  Priority, deadlines and dependencies.

  Two areas here are worth more care than they look:

  · DATE PARSING. 'YYYY-MM-DD' through `new Date()` is UTC midnight, which
    makes a task go overdue while it is still genuinely due for anyone west of
    Greenwich. And midnight in any zone means a task due today is already late
    at 00:01. Both are silent, both only show up as "the app is wrong about my
    deadlines", and both are asserted below.

  · CYCLES. Three tasks each waiting on the next is a deadlock nobody can
    resolve from the UI, and a naive graph walk hangs the tab on data that's
    already cyclic. Both directions are covered.
  -------------------------------------------------------------------------- */

import {
  PRIORITIES, STATUSES, PRIORITY_RANK, LINK_KINDS, LINK_LABEL, LINK_COLOR,
  PRIORITY_COLOR, DEADLINE_COLOR, SOON_DAYS,
  isTask, deadlineState, parseDate, toDateInput, daysBetween,
  blockersOf, effectiveStatus, wouldCycle, rollup, sortTasks, tasksWithDeadlines,
} from '../lib/tasks.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }

const task = (id, props = {}) => ({ id, type: 'task', title: id, status: 'todo', priority: 'med', ...props })
const conn = (from, to, kind) => ({ id: `c_${from}_${to}`, fromBlockId: from, toBlockId: to, kind })

const NOW = new Date(2026, 7, 12, 12, 0, 0).getTime()   // 12 Aug 2026, midday local
const DAY = 86_400_000

/* ── vocabulary ──────────────────────────────────────────────────────── */
console.log('\n vocabulary')
ok(PRIORITIES.length === 4 && STATUSES.length === 4, 'four priorities, four statuses')
ok(PRIORITY_RANK.urgent < PRIORITY_RANK.low, 'urgent outranks low')
ok(PRIORITIES.every(p => p in PRIORITY_RANK && p in PRIORITY_COLOR), 'every priority has a rank and a colour')
ok(LINK_KINDS.every(k => k in LINK_LABEL && k in LINK_COLOR), 'every link kind has a label and a colour')
ok(['overdue', 'soon', 'later', 'done', 'none'].every(s => s in DEADLINE_COLOR), 'every deadline state has a colour')
ok(isTask({ type: 'task' }) && !isTask({ type: 'text' }) && !isTask(null), 'isTask')

/* ── date parsing ────────────────────────────────────────────────────── */
console.log('\n parseDate — the timezone trap')
{
  const t = parseDate('2026-08-12')
  const d = new Date(t)
  ok(d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 12,
     'a bare date stays on the day the user typed, in LOCAL time')
  ok(d.getHours() === 23 && d.getMinutes() === 59,
     'and resolves to the END of that day — midnight would make "due today" overdue at 00:01')

  // The trap itself: UTC parsing shifts the day for anyone behind Greenwich.
  const naive = new Date('2026-08-12').getTime()
  const offset = new Date().getTimezoneOffset()
  if (offset !== 0) {
    ok(t !== naive, 'differs from naive UTC parsing, which is the bug being avoided')
  } else {
    ok(true, 'running in UTC, so the naive comparison is not meaningful here')
  }

  ok(parseDate(1234567890) === 1234567890, 'a timestamp passes through')
  ok(parseDate(null) === null && parseDate(undefined) === null && parseDate('') === null, 'empty values are null')
  ok(parseDate('not a date') === null, 'junk is null, not NaN')
  ok(parseDate('2026-13-45') !== undefined, 'an impossible date does not throw')
  ok(Number.isFinite(parseDate('2026-08-12T10:30:00')) , 'a full ISO timestamp parses')
}

console.log('\n toDateInput')
ok(toDateInput('2026-08-12') === '2026-08-12', 'round-trips a bare date')
ok(toDateInput(null) === '', 'null gives an empty input value')
ok(toDateInput('garbage') === '', 'junk gives an empty input value')
ok(/^\d{4}-\d{2}-\d{2}$/.test(toDateInput(NOW)), 'a timestamp formats correctly')

/* ── deadline states ─────────────────────────────────────────────────── */
console.log('\n deadlineState')
{
  ok(deadlineState(task('a'), NOW).state === 'none', 'no deadline')
  ok(deadlineState(task('a', { deadline: '2026-08-12' }), NOW).state === 'soon',
     'today counts as soon, not overdue — the day is not over yet')
  ok(deadlineState(task('a', { deadline: NOW - 2 * DAY }), NOW).state === 'overdue', 'two days ago is overdue')
  ok(deadlineState(task('a', { deadline: NOW + DAY }), NOW).state === 'soon', 'tomorrow is soon')
  ok(deadlineState(task('a', { deadline: NOW + 10 * DAY }), NOW).state === 'later', 'ten days out is later')

  /* The soon boundary, in calendar days.

     This pair used to read `NOW + SOON_MS - 1000` is soon / `NOW + SOON_MS +
     60_000` is later — a 48-hour window measured in milliseconds. It passed,
     and it was wrong: two calendar days is 47 hours across a spring-forward
     and 49 across a fall-back, so the chip changed colour on the wrong day
     twice a year. The assertion encoded the defect, which is why it never
     caught it. Days are the unit now. */
  ok(deadlineState(task('a', { deadline: NOW + SOON_DAYS * DAY }), NOW).state === 'soon',
     `${SOON_DAYS} calendar day out is soon`)
  ok(deadlineState(task('a', { deadline: NOW + (SOON_DAYS + 1) * DAY }), NOW).state === 'later',
     `${SOON_DAYS + 1} calendar days out is later`)

  /* A finished task is never overdue. Showing a red chip on something already
     done is the fastest way to make people stop trusting the chip. */
  ok(deadlineState(task('a', { deadline: NOW - 5 * DAY, status: 'done' }), NOW).state === 'done',
     'a DONE task with a past deadline is done, not overdue')

  ok(deadlineState(task('a', { deadline: NOW - 3 * DAY }), NOW).label.includes('overdue'), 'overdue label says so')
  ok(deadlineState(task('a', { deadline: NOW + 5 * DAY }), NOW).label === '5d', 'later label is compact')
  ok(deadlineState(null, NOW).state === 'none', 'null task does not throw')
}

/* ── regressions: deadlines measured in milliseconds ──────────────────
   Every case below reproduced against the shipped code. They are written
   against the LOCAL calendar rather than a fixed zone, so they hold wherever
   the suite runs. */
console.log('\n deadlineState — regressions')
{
  const localDay = t => {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  /* A fixed local wall-clock moment, so "same day" questions are unambiguous. */
  const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

  const today = at(2026, 8, 12, 9)
  const due = localDay(today)

  /* THE headline bug: "Due today" was on the overdue branch, so it could only
     ever appear the morning AFTER the deadline — and it stayed there until
     noon, telling you there was still time on work already a day late. */
  ok(deadlineState(task('a', { deadline: due }), today).label === 'Due today',
     'a task due today says "Due today" — on the day it is due')
  ok(deadlineState(task('a', { deadline: due }), today).state === 'soon',
     'and is soon, not overdue — the day is not over')
  ok(deadlineState(task('a', { deadline: due }), at(2026, 8, 13, 9)).label === '1d overdue',
     'the next morning it is 1d overdue, not "Due today"')
  ok(deadlineState(task('a', { deadline: due }), at(2026, 8, 14, 9)).label === '2d overdue',
     'and 2d the morning after that — the count used to be one short forever')

  /* Late in the day the label escalates to a countdown; that is a real
     duration, so hours are the correct unit for it. */
  ok(deadlineState(task('a', { deadline: due }), at(2026, 8, 12, 18)).label === 'Due in 6h',
     'inside the last 8 hours it counts down')
  ok(deadlineState(task('a', { deadline: due }), at(2026, 8, 11, 9)).label === 'Due tomorrow',
     'the day before reads "Due tomorrow"')

  /* Midday drift: the same deadline read 11d at 09:00 and 10d at 15:00,
     because end-of-day minus now was rounded rather than counted. */
  const far = localDay(at(2026, 8, 22, 12))
  ok(deadlineState(task('a', { deadline: far }), at(2026, 8, 12, 9)).label ===
     deadlineState(task('a', { deadline: far }), at(2026, 8, 12, 15)).label,
     'the day count does not change at midday')
  ok(deadlineState(task('a', { deadline: far }), at(2026, 8, 12, 9)).label === '10d',
     'and it is the true calendar distance')

  /* daysBetween is the primitive the above rests on. */
  ok(daysBetween(at(2026, 8, 12, 23, 59), at(2026, 8, 13, 0, 1)) === 1,
     'two minutes apart across midnight is one calendar day')
  ok(daysBetween(at(2026, 8, 12, 0, 1), at(2026, 8, 12, 23, 59)) === 0,
     'almost 24 hours inside one day is zero days')
  ok(daysBetween(at(2026, 3, 27, 12), at(2026, 3, 29, 12)) === 2,
     'two days spanning a possible DST shift is still two days')
  ok(daysBetween(at(2026, 10, 24, 12), at(2026, 10, 26, 12)) === 2,
     'and the same in the autumn direction')
}

/* ── regressions: parseDate only ever handled one string shape ────────
   Everything else fell through to `new Date(s)`. */
console.log('\n parseDate — regressions')
{
  const ymd = t => {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  /* Excel serials. sheet_to_json emits these as bare numbers; String()-ing one
     produced "46266", which new Date() read as the year 46266. dateColumns
     still rated the column "date, confidence 1.0", so the calendar rendered
     empty with no error at all. */
  ok(ymd(parseDate(46266)) === '2026-09-01', 'an Excel serial number is a 2026 date, not the year 46266')
  ok(ymd(parseDate('46266')) === '2026-09-01', 'and the same when it arrives as text')
  ok(ymd(parseDate(25569)) === '1970-01-01', 'the serial for the Unix epoch resolves to it, not to 1970-01-01T00:00:25')
  ok(ymd(parseDate(2)) === '1900-01-01', 'the low end of the serial range works')
  ok(parseDate(1) === null, 'and serial 1 (31 Dec 1899) falls outside the 1900-2200 guard, so it is refused')
  ok(parseDate(NOW) === NOW, 'a real epoch timestamp is still passed through untouched')

  /* Day-first formats. These parsed as US month-first, landing four months
     away, and rows that had a day above 12 were dropped entirely. */
  ok(ymd(parseDate('12/08/2026')) === '2026-08-12', 'DD/MM/YYYY is day-first by default')
  ok(ymd(parseDate('12.08.2026')) === '2026-08-12', 'dots too')
  ok(ymd(parseDate('25/12/2026')) === '2026-12-25', 'a day above 12 disambiguates itself')
  ok(ymd(parseDate('12/25/2026')) === '2026-12-25', 'and so does a month above 12, whatever the flag says')
  ok(ymd(parseDate('03/04/2026', { dayFirst: false })) === '2026-04-03' ||
     ymd(parseDate('03/04/2026', { dayFirst: false })) === '2026-03-04',
     'a genuinely ambiguous date follows the flag')
  ok(ymd(parseDate('03/04/2026', { dayFirst: false })) === '2026-03-04', 'dayFirst:false reads it US-style')
  ok(ymd(parseDate('03/04/2026')) === '2026-04-03', 'and the default reads it European-style')

  /* Impossible dates used to roll forward silently, and toDateInput then wrote
     the rolled-over value back — laundering a typo into a plausible answer. */
  ok(parseDate('2026-02-30') === null, '30 February is rejected, not rolled to 2 March')
  ok(parseDate('2026-04-31') === null, '31 April is rejected')
  ok(parseDate('2026-13-45') === null, 'month 13 is rejected, not rolled a year forward')
  ok(parseDate('2026-00-10') === null, 'month 0 is rejected, not rolled a year back')
  ok(ymd(parseDate('2028-02-29')) === '2028-02-29', 'but a real leap day is kept')

  /* The out-of-range guard on the engine fallback. */
  ok(parseDate('46266-01-01') === null, 'a five-digit year is refused rather than silently accepted')
  ok(Number.isFinite(parseDate('August 12, 2026')), 'a spelled-out date still parses')
}

/* ── dependencies ────────────────────────────────────────────────────── */
console.log('\n blockersOf')
{
  const blocks = [task('a'), task('b'), task('c'), { id: 'note', type: 'text' }]

  ok(blockersOf('b', blocks, [conn('a', 'b', 'blocks')]).length === 1, '"a blocks b" blocks b')
  ok(blockersOf('a', blocks, [conn('a', 'b', 'blocks')]).length === 0, '…and does not block a')

  ok(blockersOf('a', blocks, [conn('a', 'b', 'depends')]).length === 1, '"a depends on b" blocks a')
  ok(blockersOf('b', blocks, [conn('a', 'b', 'depends')]).length === 0, '…and does not block b')

  ok(blockersOf('b', blocks, [conn('a', 'b', 'related')]).length === 0, 'a plain link blocks nothing')
  ok(blockersOf('b', blocks, [conn('a', 'b', 'follows')]).length === 0, 'follows is ordering only, not gating')

  /* A finished blocker isn't a blocker. Without this the state never clears
     and every completed dependency leaves its dependents stuck. */
  const doneBlocks = [task('a', { status: 'done' }), task('b')]
  ok(blockersOf('b', doneBlocks, [conn('a', 'b', 'blocks')]).length === 0,
     'a DONE blocker stops blocking')

  ok(blockersOf('b', blocks, [conn('note', 'b', 'blocks')]).length === 0,
     'a non-task cannot block a task')
  ok(blockersOf('b', blocks, [conn('ghost', 'b', 'blocks')]).length === 0,
     'a connection to a deleted block is ignored')

  ok(blockersOf('b', null, null).length === 0, 'null inputs do not throw')
  ok(blockersOf(null, blocks, []).length === 0, 'null id does not throw')
}

console.log('\n effectiveStatus — blocked is derived, never stored')
{
  const blocks = [task('a'), task('b')]
  ok(effectiveStatus(blocks[1], blocks, []) === 'todo', 'no blockers, stored status wins')
  ok(effectiveStatus(blocks[1], blocks, [conn('a', 'b', 'blocks')]) === 'blocked', 'a live blocker makes it blocked')

  const withDone = [task('a', { status: 'done' }), task('b')]
  ok(effectiveStatus(withDone[1], withDone, [conn('a', 'b', 'blocks')]) === 'todo',
     'finishing the blocker unblocks it automatically — nothing had to be updated')

  const doneAnyway = [task('a'), task('b', { status: 'done' })]
  ok(effectiveStatus(doneAnyway[1], doneAnyway, [conn('a', 'b', 'blocks')]) === 'done',
     'DONE wins over blocked — finishing something despite a blocker is allowed')

  ok(effectiveStatus(task('a', { status: 'doing' }), [], []) === 'doing', 'doing is preserved')
  ok(effectiveStatus({ type: 'text' }, [], []) === null, 'a non-task has no status')
}

console.log('\n wouldCycle')
{
  ok(wouldCycle('a', 'a', []) === true, 'a task cannot block itself')
  ok(wouldCycle('a', 'b', []) === false, 'a fresh edge is fine')
  ok(wouldCycle('b', 'a', [conn('a', 'b', 'blocks')]) === true, 'a two-node cycle is caught')
  ok(wouldCycle('c', 'a', [conn('a', 'b', 'blocks'), conn('b', 'c', 'blocks')]) === true, 'a three-node cycle is caught')
  ok(wouldCycle('c', 'd', [conn('a', 'b', 'blocks'), conn('b', 'c', 'blocks')]) === false, 'extending a chain is fine')

  ok(wouldCycle('b', 'a', [conn('b', 'a', 'depends')]) === true,
     'depends is normalised, so a cycle stated the other way round is still caught')

  ok(wouldCycle('b', 'a', [conn('a', 'b', 'related')]) === false, 'plain links do not create dependency cycles')
  ok(wouldCycle('b', 'a', [conn('a', 'b', 'follows')]) === false, 'follows does not gate, so it cannot deadlock')

  /* Data written by an earlier version could already contain a cycle. An
     unguarded walk loops forever and hangs the tab. */
  const alreadyCyclic = [conn('a', 'b', 'blocks'), conn('b', 'c', 'blocks'), conn('c', 'a', 'blocks')]
  let finished = false
  try { wouldCycle('x', 'y', alreadyCyclic); finished = true } catch { /* fall through */ }
  ok(finished, 'an ALREADY cyclic graph terminates instead of hanging')

  ok(wouldCycle(null, 'a', []) === false, 'null ids do not throw')
  ok(wouldCycle('a', 'b', null) === false, 'null connections do not throw')
}

/* ── rollups ─────────────────────────────────────────────────────────── */
console.log('\n rollup')
{
  const blocks = [
    task('a', { status: 'done' }),
    task('b', { status: 'doing' }),
    task('c'),
    task('d', { deadline: NOW - 3 * DAY }),
    { id: 'note', type: 'text' },
  ]
  const r = rollup(blocks, blocks, [])
  ok(r.total === 4, 'counts only tasks, not the text block')
  ok(r.done === 1 && r.doing === 1 && r.todo === 2, 'statuses counted')
  ok(r.pct === 25, 'percentage complete')
  ok(r.overdue === 1, 'overdue counted')

  const withBlocker = rollup(blocks, blocks, [conn('c', 'b', 'blocks')])
  ok(withBlocker.blocked === 1 && withBlocker.doing === 0, 'a blocked task is counted as blocked, not doing')

  ok(rollup([{ id: 'x', type: 'text' }], [], []) === null, 'a group with no tasks rolls up to nothing')
  ok(rollup([], [], []) === null, 'empty')
  ok(rollup(null, null, null) === null, 'null does not throw')
}

/* ── sorting ─────────────────────────────────────────────────────────── */
console.log('\n sortTasks')
{
  const tasks = [
    task('low-later', { priority: 'low', deadline: NOW + 30 * DAY }),
    task('urgent-none', { priority: 'urgent' }),
    task('med-overdue', { priority: 'med', deadline: NOW - DAY }),
    task('high-soon', { priority: 'high', deadline: NOW + DAY }),
  ]
  const s = sortTasks(tasks, NOW)
  ok(s[0].id === 'med-overdue', 'overdue comes first, regardless of priority')
  ok(s[1].id === 'urgent-none', 'then the highest priority')
  ok(s[3].id === 'low-later', 'and the lowest priority last')

  const samePriority = sortTasks([
    task('b', { priority: 'high', deadline: NOW + 10 * DAY }),
    task('a', { priority: 'high', deadline: NOW + 2 * DAY }),
  ], NOW)
  ok(samePriority[0].id === 'a', 'equal priority breaks on the nearer deadline')

  const noDeadline = sortTasks([
    task('none', { priority: 'high' }),
    task('dated', { priority: 'high', deadline: NOW + 90 * DAY }),
  ], NOW)
  ok(noDeadline[0].id === 'dated', 'a task with any deadline sorts before one with none')

  ok(sortTasks([]).length === 0, 'empty')
  ok(sortTasks(null).length === 0, 'null does not throw')

  // Sorting must not mutate the caller's array.
  const orig = [task('z', { priority: 'low' }), task('a', { priority: 'urgent' })]
  const before = orig.map(t => t.id).join()
  sortTasks(orig, NOW)
  ok(orig.map(t => t.id).join() === before, 'the input array is not reordered in place')
}

/* ── calendar feed ───────────────────────────────────────────────────── */
console.log('\n tasksWithDeadlines')
{
  const blocks = [
    task('a', { deadline: '2026-08-20' }),
    task('b'),
    task('c', { deadline: NOW }),
    { id: 'note', type: 'text', deadline: '2026-08-20' },
  ]
  const out = tasksWithDeadlines(blocks)
  ok(out.length === 2, 'only tasks that have a deadline')
  ok(!out.some(b => b.type === 'text'), 'a non-task with a deadline field is not included')
  ok(tasksWithDeadlines(null).length === 0, 'null does not throw')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
