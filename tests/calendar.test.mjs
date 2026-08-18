/*
  tests/calendar.test.mjs
  --------------------------------------------------------------------------
  Grid boundaries and date arithmetic.

  Two traps get most of the attention here, because both are silent, both are
  seasonal, and both produce a calendar that is simply wrong about dates:

  · DST. Adding 86_400_000ms for "tomorrow" drifts an hour on the days clocks
    change, and a week built that way eventually lands on the wrong DAY.
  · MONTH OVERFLOW. `setMonth(+1)` on 31 January gives 3 March, because the
    runtime overflows 31 February forwards. Five months of the year end in a
    day the next month doesn't have.

  Neither throws. Both just quietly show the wrong date.
  -------------------------------------------------------------------------- */

import {
  VIEWS, WEEK_START_MONDAY, WEEK_START_SUNDAY,
  startOfDay, addDays, addMonths, daysInMonth, isSameDay, startOfWeek, dayKey,
  monthGrid, weekGrid, weekdayLabels, msUntilNextLocalMidnight,
  eventsFromTasks, eventsFromTable, eventsFromManual, resolveEvents,
  bucketByDay, agendaGroups, monthTitle, weekTitle,
} from '../lib/calendar.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }

const task = (id, p = {}) => ({ id, type: 'task', title: id, status: 'todo', priority: 'med', ...p })

/* ── day arithmetic ──────────────────────────────────────────────────── */
console.log('\n addDays — DST safety')
{
  ok(isSameDay(addDays(new Date(2026, 7, 12), 1), new Date(2026, 7, 13)), 'plain +1 day')
  ok(isSameDay(addDays(new Date(2026, 7, 12), -1), new Date(2026, 7, 11)), 'plain -1 day')
  ok(isSameDay(addDays(new Date(2026, 11, 31), 1), new Date(2027, 0, 1)), 'crosses a year boundary')
  ok(isSameDay(addDays(new Date(2028, 1, 28), 1), new Date(2028, 1, 29)), 'leap day exists in 2028')
  ok(isSameDay(addDays(new Date(2026, 1, 28), 1), new Date(2026, 2, 1)), 'and does not in 2026')

  /* The real test: step through every day across both European DST switches
     and assert the date advances by exactly one each time. Adding
     86_400_000ms fails this in the hour the clocks move. */
  for (const [label, start] of [['spring', new Date(2026, 2, 27)], ['autumn', new Date(2026, 9, 23)]]) {
    let d = start
    let broke = null
    for (let i = 0; i < 10; i++) {
      const next = addDays(d, 1)
      const expected = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      if (!isSameDay(next, expected)) { broke = `${d.toDateString()} → ${next.toDateString()}` }
      d = next
    }
    ok(!broke, `${label} DST: ten consecutive days each advance exactly one date`, broke || '')
  }
}

console.log('\n addMonths — the overflow trap')
{
  const jan31 = new Date(2026, 0, 31)
  const feb = addMonths(jan31, 1)
  ok(feb.getMonth() === 1, '31 Jan + 1 month lands in FEBRUARY, not March')
  ok(feb.getDate() === 28, '…on the 28th, the last day February has')

  const may31 = new Date(2026, 4, 31)
  ok(addMonths(may31, 1).getMonth() === 5 && addMonths(may31, 1).getDate() === 30, '31 May + 1 month is 30 June')

  ok(addMonths(new Date(2026, 0, 15), 12).getFullYear() === 2027, '+12 months is +1 year')
  ok(addMonths(new Date(2026, 0, 15), -1).getMonth() === 11, '-1 month from January is December')
  ok(addMonths(new Date(2026, 0, 15), -1).getFullYear() === 2025, '…of the previous year')
  ok(addMonths(new Date(2028, 0, 31), 1).getDate() === 29, 'leap February gets the 29th')
}

console.log('\n daysInMonth / startOfDay / dayKey')
ok(daysInMonth(2026, 1) === 28 && daysInMonth(2028, 1) === 29, 'February, both kinds')
ok(daysInMonth(2026, 0) === 31 && daysInMonth(2026, 3) === 30, 'January and April')
{
  const d = startOfDay(new Date(2026, 7, 12, 15, 30))
  ok(d.getHours() === 0 && d.getMinutes() === 0, 'startOfDay clears the time')
  ok(d.getDate() === 12, '…without moving the date')
  ok(dayKey(new Date(2026, 7, 5)) === '2026-08-05', 'dayKey pads to two digits')
  ok(dayKey(new Date(2026, 11, 31)) === '2026-12-31', 'and handles December')
}

/* ── week boundaries ─────────────────────────────────────────────────── */
console.log('\n startOfWeek')
{
  // 12 Aug 2026 is a Wednesday.
  const wed = new Date(2026, 7, 12)
  ok(wed.getDay() === 3, 'the fixture really is a Wednesday')

  const mon = startOfWeek(wed, WEEK_START_MONDAY)
  ok(mon.getDay() === 1 && mon.getDate() === 10, 'Monday start gives the 10th')

  const sun = startOfWeek(wed, WEEK_START_SUNDAY)
  ok(sun.getDay() === 0 && sun.getDate() === 9, 'Sunday start gives the 9th')

  /* The wrap-around case: on a Sunday with a Monday week-start, the week
     began SIX days ago, not today. A naive `day - weekStart` gives -1. */
  const sunday = new Date(2026, 7, 16)
  ok(sunday.getDay() === 0, 'fixture is a Sunday')
  ok(startOfWeek(sunday, WEEK_START_MONDAY).getDate() === 10,
     'a Sunday with a Monday start belongs to the week that began six days earlier')
}

/* ── month grid ──────────────────────────────────────────────────────── */
console.log('\n monthGrid')
{
  const weeks = monthGrid(2026, 7, WEEK_START_MONDAY)   // August 2026
  ok(weeks.every(w => w.length === 7), 'every row has seven days')
  ok(weeks.length >= 4 && weeks.length <= 6, `${weeks.length} rows — as many as the month spans, no fixed 6`)

  ok(weeks[0][0].date.getDay() === 1, 'the grid starts on a Monday')
  ok(weeks[weeks.length - 1][6].date.getDay() === 0, 'and ends on a Sunday')

  const inMonth = weeks.flat().filter(d => d.inMonth)
  ok(inMonth.length === 31, 'exactly 31 days marked as August')
  ok(inMonth[0].date.getDate() === 1 && inMonth[30].date.getDate() === 31, 'from the 1st to the 31st')

  const leading = weeks[0].filter(d => !d.inMonth)
  ok(leading.length > 0 && leading.every(d => d.date.getMonth() === 6),
     'leading days come from July and are flagged as outside the month')

  // Consecutive throughout, with no gaps or repeats.
  const flat = weeks.flat()
  let contiguous = true
  for (let i = 1; i < flat.length; i++) {
    if (!isSameDay(flat[i].date, addDays(flat[i - 1].date, 1))) contiguous = false
  }
  ok(contiguous, 'every cell is exactly one day after the previous — no skips, no repeats')

  const keys = new Set(flat.map(d => d.key))
  ok(keys.size === flat.length, 'every day key is unique')
}

console.log('\n monthGrid — awkward months')
{
  /* February 2027 starts on a Monday and has 28 days, so with a Monday week
     start it fits in exactly four rows. A fixed 6-row grid wastes two. */
  const feb27 = monthGrid(2027, 1, WEEK_START_MONDAY)
  ok(new Date(2027, 1, 1).getDay() === 1, 'Feb 2027 starts on a Monday')
  ok(feb27.length === 4, 'a 28-day month starting on the week start needs exactly four rows')
  ok(feb27.flat().every(d => d.inMonth), '…and every cell is inside the month')

  // A 31-day month starting on a Sunday needs six rows with a Monday start.
  const aug27 = monthGrid(2027, 7, WEEK_START_MONDAY)
  ok(new Date(2027, 7, 1).getDay() === 0, 'Aug 2027 starts on a Sunday')
  ok(aug27.length === 6, '…which needs six rows')

  ok(monthGrid(2028, 1, WEEK_START_MONDAY).flat().filter(d => d.inMonth).length === 29,
     'leap February has 29 in-month cells')

  // Every month of a year produces a valid grid.
  let allGood = true
  for (let m = 0; m < 12; m++) {
    const g = monthGrid(2026, m, WEEK_START_MONDAY)
    if (g.flat().filter(d => d.inMonth).length !== daysInMonth(2026, m)) allGood = false
  }
  ok(allGood, 'all twelve months of 2026 contain exactly their own days')
}

console.log('\n weekGrid / labels')
{
  const g = weekGrid(new Date(2026, 7, 12), WEEK_START_MONDAY)
  ok(g.length === 7, 'seven days')
  ok(g[0].date.getDate() === 10 && g[6].date.getDate() === 16, 'Mon 10th to Sun 16th')
  ok(weekdayLabels(WEEK_START_MONDAY)[0] === 'Mon', 'Monday-first labels start with Mon')
  ok(weekdayLabels(WEEK_START_SUNDAY)[0] === 'Sun', 'Sunday-first labels start with Sun')
  ok(weekdayLabels().length === 7, 'seven labels')
}

/* ── events ──────────────────────────────────────────────────────────── */
console.log('\n eventsFromTasks')
{
  const blocks = [
    task('a', { title: 'Call Acme', deadline: '2026-08-20' }),
    task('b', { title: 'No deadline' }),
    task('c', { title: 'Late', deadline: '2020-01-01' }),
    { id: 'note', type: 'text' },
  ]
  const evs = eventsFromTasks(blocks, { notebookId: 'nb', sheetId: 'sh' })
  ok(evs.length === 2, 'only tasks that have a deadline')
  ok(evs.every(e => e.link?.blockId), 'EVERY event carries a link — that is the whole point')
  ok(evs.every(e => e.link.notebookId === 'nb' && e.link.sheetId === 'sh'), 'the full address travels with it')
  ok(evs.find(e => e.title === 'Late').overdue === true, 'an overdue task is flagged')
  ok(evs.find(e => e.title === 'Late').color === 'var(--ds-red)', '…and coloured red')
  ok(evs.find(e => e.title === 'Call Acme').kind === 'task', 'kind recorded')
  ok(eventsFromTasks(null).length === 0, 'null does not throw')
}

console.log('\n eventsFromTable — the source from the original note')
{
  const table = {
    id: 'tbl', type: 'table', name: 'Customers',
    headers: ['Client', 'Renewal'],
    rows: [
      ['Acme', '2026-09-01'],
      ['Globex', '2026-10-15'],
      ['NoDate', ''],
      ['', '2026-11-02'],
    ],
  }
  const evs = eventsFromTable(table, { dateCol: 'Renewal', titleCol: 'Client' }, { notebookId: 'nb', sheetId: 'sh' })
  ok(evs.length === 3, 'one event per row that has a date')
  ok(evs[0].title === 'Acme', 'title comes from the chosen column')
  ok(evs.every(e => e.link.blockId === 'tbl'), 'the link points at the TABLE — where the client info is')
  ok(evs.find(e => e.meta.row === 3).title.includes('Customers'),
     'a dated row with no title still appears, named after its table')

  ok(eventsFromTable(table, { dateCol: 1, titleCol: 0 }).length === 3, 'columns can be given by index')
  ok(eventsFromTable(table, { dateCol: 'Missing' }).length === 0, 'an unknown date column yields nothing')
  ok(eventsFromTable({ type: 'text' }, { dateCol: 0 }).length === 0, 'a non-table yields nothing')
  ok(eventsFromTable(null, {}).length === 0, 'null does not throw')
}

console.log('\n eventsFromManual')
{
  const evs = eventsFromManual([
    { id: 'e1', title: 'Standup', start: '2026-08-13' },
    { id: 'e2', title: 'No date' },
    { id: 'e3', title: 'Linked', start: '2026-08-14', link: { blockId: 'b9' } },
  ], { notebookId: 'nb', sheetId: 'sh' })
  ok(evs.length === 2, 'only events with a date')
  ok(evs.find(e => e.id === 'e3').link.blockId === 'b9', 'an explicit link is kept')
  ok(evs.find(e => e.id === 'e3').link.notebookId === 'nb', '…and completed with the address')
  ok(evs.find(e => e.id === 'e1').link === null, 'an event with no target has a null link, not a broken one')
}

console.log('\n resolveEvents')
{
  const table = { id: 'tbl', type: 'table', name: 'T', headers: ['A', 'D'], rows: [['x', '2026-08-15']] }
  const blocks = [task('t1', { deadline: '2026-08-20' }), table]

  const def = resolveEvents({ type: 'calendar' }, blocks)
  ok(def.length === 1 && def[0].kind === 'task', 'with no sources declared it reads tasks')

  const both = resolveEvents({
    type: 'calendar',
    sources: [{ kind: 'tasks' }, { kind: 'table', blockId: 'tbl', dateCol: 'D', titleCol: 'A' }],
  }, blocks)
  ok(both.length === 2, 'two sources combine')
  ok(both[0].at < both[1].at, 'and the result is sorted by time')

  /* A manual event must never vanish because no 'events' source was declared
     — typing something in and watching it disappear reads as data loss. */
  const manual = resolveEvents({
    type: 'calendar', sources: [{ kind: 'tasks' }],
    events: [{ id: 'e1', title: 'Typed', start: '2026-08-11' }],
  }, blocks)
  ok(manual.some(e => e.title === 'Typed'), 'manual events appear even without an explicit source')
  ok(manual.filter(e => e.title === 'Typed').length === 1, '…exactly once, not duplicated')

  const bothDeclared = resolveEvents({
    type: 'calendar', sources: [{ kind: 'events' }],
    events: [{ id: 'e1', title: 'Typed', start: '2026-08-11' }],
  }, blocks)
  ok(bothDeclared.filter(e => e.title === 'Typed').length === 1, 'and not duplicated when declared either')

  ok(resolveEvents({ type: 'calendar', sources: [{ kind: 'table', blockId: 'gone', dateCol: 'D' }] }, blocks).length === 0,
     'a source pointing at a deleted table yields nothing rather than throwing')
  ok(resolveEvents(null, null).length === 0, 'null does not throw')
}

/* ── layout helpers ──────────────────────────────────────────────────── */
console.log('\n bucketByDay / agendaGroups')
{
  const evs = resolveEvents({ type: 'calendar', events: [
    { id: 'a', title: 'A', start: '2026-08-13' },
    { id: 'b', title: 'B', start: '2026-08-13' },
    { id: 'c', title: 'C', start: '2026-08-14' },
  ], sources: [{ kind: 'events' }] }, [])

  const buckets = bucketByDay(evs)
  ok(buckets.get('2026-08-13').length === 2, 'two events on the same day share a bucket')
  ok(buckets.get('2026-08-14').length === 1, 'and a different day has its own')
  ok(buckets.get('2026-08-15') === undefined, 'an empty day has no bucket')
  ok(bucketByDay(null).size === 0, 'null does not throw')

  const now = new Date(2026, 7, 12).getTime()
  const groups = agendaGroups(evs, { now })
  ok(groups.length === 2, 'grouped into two days')
  ok(groups[0].events.length === 2, 'first group holds both same-day events')

  const past = agendaGroups(resolveEvents({ type: 'calendar', sources: [{ kind: 'events' }], events: [
    { id: 'old', title: 'Old', start: '2020-01-01' },
  ] }, []), { now })
  ok(past.length === 0, 'past events are excluded from the agenda')

  const overdue = agendaGroups(eventsFromTasks([task('x', { deadline: '2020-01-01' })]), { now })
  ok(overdue.length === 1, '…but an OVERDUE TASK is kept, because that is the one you still need to see')
}

/* ── the midnight tick ───────────────────────────────────────────────────
   Blocks schedule a re-render off this so "today" and the overdue set stop
   being whatever they were when the tab was opened. The delay has to land ON
   the rollover: fire early and the highlight moves before the date does, fire
   late and it lingers — and on the two days a year the clocks move, a
   24-hour assumption does exactly one of those. */
console.log('\n msUntilNextLocalMidnight')
{
  const landsOnMidnight = at => {
    const d = new Date(at + msUntilNextLocalMidnight(at))
    return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
  }
  ok(landsOnMidnight(new Date(2026, 7, 12, 9, 30).getTime()), 'mid-morning lands exactly on midnight')
  ok(landsOnMidnight(new Date(2026, 7, 12, 23, 59, 59, 999).getTime()), 'one millisecond before lands on it too')
  ok(landsOnMidnight(new Date(2026, 7, 12, 0, 0, 0, 0).getTime()), 'at midnight, the NEXT one — never a zero delay')

  ok(msUntilNextLocalMidnight(new Date(2026, 7, 12, 0, 0, 0, 0).getTime()) === 86_400_000,
    'an ordinary day is 24 hours away')
  ok(landsOnMidnight(new Date(2026, 11, 31, 18, 0).getTime()), 'crosses a year boundary')

  /* The whole reason this is calendar arithmetic. Both European switches, from
     the start of the day the clocks move: the answer must be the real distance
     to the next local midnight, which is 23 or 25 hours, not 24. */
  for (const [label, at] of [
    ['spring forward', new Date(2026, 2, 29, 0, 0, 0, 0)],
    ['autumn back', new Date(2026, 9, 25, 0, 0, 0, 0)],
  ]) {
    const ms = msUntilNextLocalMidnight(at.getTime())
    const expected = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime() - at.getTime()
    ok(ms === expected && landsOnMidnight(at.getTime()),
      `${label}: the delay is the real gap to midnight, whatever the runtime says it is`)
  }

  ok(msUntilNextLocalMidnight() > 0, 'the no-argument form never returns a zero delay')
}

console.log('\n titles')
ok(monthTitle(new Date(2026, 7, 12)) === 'August 2026', 'month title')
ok(weekTitle(new Date(2026, 7, 12), WEEK_START_MONDAY).includes('August'), 'week title within one month')
ok(weekTitle(new Date(2026, 7, 31), WEEK_START_MONDAY).includes('–'), 'week spanning two months shows both')
ok(VIEWS.length === 3, 'three views')

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
