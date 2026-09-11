/*
  lib/calendar.js
  --------------------------------------------------------------------------
  Turning three different things into one list of dated events, and laying
  them out on a grid.

  WHAT THE CALENDAR IS FOR
  Not scheduling. The requirement was: "if I have a meeting with a client I
  can click on that calendar's meeting note and it jumps to the page where
  there is actual info about the client."

  So every event carries a LINK. The calendar is a dated index of the
  workspace — a way in, not a place things live. That's why nothing here owns
  any data except manually-typed events: tasks stay tasks, table rows stay
  table rows, and the calendar is a lens over both.

  DATE ARITHMETIC IS DONE IN CALENDAR UNITS, NEVER IN MILLISECONDS
  Adding 86_400_000 to get "tomorrow" is wrong twice a year. On the days
  clocks change, a local day is 23 or 25 hours long, so a week built by adding
  fixed milliseconds drifts an hour and eventually lands on the wrong DAY —
  which shows up as a calendar that silently skips or repeats a date, in one
  week of the year, in some timezones. Everything below goes through
  `new Date(y, m, d + n)`, which the runtime resolves correctly.

  All of this is pure, so the parts most likely to be quietly wrong — grid
  boundaries and DST — are the parts that get asserted.
  -------------------------------------------------------------------------- */

import { parseDate, isTask, deadlineState, PRIORITY_COLOR } from './tasks.js'
import { stablePick } from './theme.js'
import { HUES } from './attribution.js'

export const VIEWS = ['month', 'week', 'agenda']
export const VIEW_LABEL = { month: 'Month', week: 'Week', agenda: 'Agenda' }

/* Monday. The ISO default, and the right one for most of Europe — but it's a
   parameter everywhere rather than a constant, because a US user wants Sunday
   and hardcoding it would mean rewriting the grid maths to change it. */
export const WEEK_START_MONDAY = 1
export const WEEK_START_SUNDAY = 0

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* ── date helpers ────────────────────────────────────────────────────── */

/** Midnight local on the same day. */
export const startOfDay = d => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Calendar-unit day arithmetic. Safe across DST; adding ms is not. */
export const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export const addMonths = (d, n) => {
  const x = new Date(d)
  /* Set the day to 1 first. Otherwise 31 Jan + 1 month gives 3 March, because
     the runtime overflows 31 February forwards — a classic off-by-a-month
     that only shows up in five months of the year. */
  const day = x.getDate()
  x.setDate(1)
  x.setMonth(x.getMonth() + n)
  x.setDate(Math.min(day, daysInMonth(x.getFullYear(), x.getMonth())))
  return x
}

export const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()

export const isSameDay = (a, b) =>
  a && b &&
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

export const isToday = (d, now = new Date()) => isSameDay(d, now)

/**
 * Milliseconds from `now` to the next local midnight.
 *
 * Exists because `isToday` and `deadlineState` are evaluated at render and
 * nothing re-renders a block at midnight: a tab left open overnight keeps
 * yesterday's "today" circle, and yesterday's overdue set, until some
 * unrelated interaction happens to re-render. Components schedule one timer
 * off this and re-render when it fires.
 *
 * Calendar units, not `now + 86_400_000 - offset`. On the two days a year the
 * clocks move, the gap to tomorrow's midnight is 23 or 25 hours; a fixed
 * 24-hour assumption fires an hour early (the highlight moves before the date
 * does) or an hour late (it lingers). `new Date(y, m, d + 1)` asks the runtime
 * for the instant the local date actually rolls over, which is the only
 * source that knows about the transition.
 *
 * Floors at 1ms so a caller passing this straight to setTimeout can never
 * spin on a zero delay.
 */
export function msUntilNextLocalMidnight(now = Date.now()) {
  const d = new Date(now)
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  return Math.max(1, next.getTime() - d.getTime())
}

/** The start of the week containing `d`. */
export function startOfWeek(d, weekStart = WEEK_START_MONDAY) {
  const x = startOfDay(d)
  const diff = (x.getDay() - weekStart + 7) % 7
  return addDays(x, -diff)
}

/** 'YYYY-MM-DD' in LOCAL time — the key events are bucketed by. */
export function dayKey(d) {
  const x = new Date(d)
  const p = n => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

/* ── grids ───────────────────────────────────────────────────────────── */

/**
 * The weeks a month view needs.
 *
 * Exactly as many rows as the month actually spans — 4, 5 or 6 — rather than
 * a fixed 6. A fixed grid leaves a blank trailing row most months, and on a
 * canvas where the block is only as tall as you made it, that's real space
 * spent on nothing.
 *
 * Leading and trailing days from the neighbouring months are included and
 * flagged, because a week that stops halfway is worse than one that shows
 * where it came from.
 */
export function monthGrid(year, month, weekStart = WEEK_START_MONDAY) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month, daysInMonth(year, month))

  const gridStart = startOfWeek(first, weekStart)
  const gridEnd = addDays(startOfWeek(last, weekStart), 6)

  const weeks = []
  let cursor = gridStart
  while (cursor <= gridEnd) {
    const days = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i)
      days.push({
        date: d,
        key: dayKey(d),
        inMonth: d.getMonth() === month && d.getFullYear() === year,
        weekday: d.getDay(),
      })
    }
    weeks.push(days)
    cursor = addDays(cursor, 7)
  }
  return weeks
}

/** Seven consecutive days from the start of the week containing `d`. */
export function weekGrid(d, weekStart = WEEK_START_MONDAY) {
  const s = startOfWeek(d, weekStart)
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(s, i)
    return { date: day, key: dayKey(day), inMonth: true, weekday: day.getDay() }
  })
}

/** Weekday headers in the order the grid uses them. */
export const weekdayLabels = (weekStart = WEEK_START_MONDAY) =>
  Array.from({ length: 7 }, (_, i) => DAY_NAMES_SHORT[(weekStart + i) % 7])

/* ── events ──────────────────────────────────────────────────────────── */

export const SOURCE_KINDS = ['tasks', 'table', 'events']

/* ── A STABLE COLOUR PER SOURCE CALENDAR ──────────────────────────────────
   The per-source `color` field has existed in the data model since sources
   did, and eventsFromTable has always READ it (`color || 'var(--ds-accent)'`)
   — but nothing ever WROTE it. So every table source fell through to the same
   flat accent, and two different tables feeding one calendar rendered visually
   identical pills. That is a present gap, not something this introduces.

   Hashed from the source's own key, exactly like personHue in
   lib/attribution.js: stable across reloads and devices, nothing new to store,
   and no arrival-order assignment that would reshuffle every colour the moment
   a source is removed from the middle of the list.

   THE SAME HASH AND THE SAME EIGHT HUES as personHue, deliberately. One
   "stable identity colour" system app-wide — a second palette invented for
   calendars would mean the app had two answers to "what colour is this thing",
   and the two would drift the first time either list was edited. */
export function sourceHue(key) {
  return stablePick(key, HUES)
}

/**
 * The identity of a source, for colouring and for the sidebar's React key.
 *
 * 'tasks' and 'events' are singletons — there is only ever one of each on a
 * calendar — so their kind IS their key. A table source is identified by the
 * block it reads, not by its position in `sources`: reordering the list must
 * not repaint every calendar.
 */
export function sourceKey(src) {
  if (!src) return ''
  if (src.kind === 'table') return src.blockId || 'table'
  return src.kind
}

/** Is this source currently switched off in the sidebar? */
export const isSourceHidden = src => src?.hidden === true

/**
 * One event. Always carries `link`, which is the whole point.
 * @typedef {{id, title, at, dayKey, color, kind, link, meta}} CalEvent
 */

/**
 * Every task with a deadline, as an event.
 * Coloured by priority and marked overdue, so the calendar says the same
 * thing the task card does rather than inventing a second vocabulary.
 */
export function eventsFromTasks(blocks, address = {}) {
  const out = []
  for (const b of blocks || []) {
    if (!isTask(b)) continue
    const at = parseDate(b.deadline)
    if (at === null) continue
    const dl = deadlineState(b)
    out.push({
      id: `task_${b.id}`,
      title: b.title || 'Untitled task',
      at,
      dayKey: dayKey(new Date(at)),
      color: dl.state === 'overdue' ? 'var(--ds-red)' : PRIORITY_COLOR[b.priority || 'med'],
      kind: 'task',
      done: b.status === 'done',
      overdue: dl.state === 'overdue',
      link: { ...address, blockId: b.id },
      meta: { priority: b.priority || 'med', status: b.status || 'todo' },
    })
  }
  return out
}

/**
 * A table's rows, as events, by pointing at a date column.
 *
 * This is the source the original note actually described: a Customers table
 * with a renewal date becomes a calendar with no data entry at all. The link
 * points at the TABLE, because that's where the client's information is —
 * which is the "jumps to the page where there is actual info" requirement.
 */
export function eventsFromTable(block, { dateCol, titleCol, color } = {}, address = {}) {
  if (!block || block.type !== 'table') return []
  const headers = block.headers || []
  const di = typeof dateCol === 'number' ? dateCol : headers.indexOf(dateCol)
  if (di < 0) return []
  const ti = typeof titleCol === 'number' ? titleCol : headers.indexOf(titleCol)

  const out = []
  const rows = block.rows || []
  for (let r = 0; r < rows.length; r++) {
    const at = parseDate(rows[r]?.[di])
    if (at === null) continue
    /* A row with a date but no title still belongs on the calendar — the date
       is the fact you're looking for. Falling back to the row number keeps it
       findable rather than dropping it. */
    const title = (ti >= 0 ? rows[r]?.[ti] : '') || `${block.name || 'Row'} ${r + 1}`
    out.push({
      id: `row_${block.id}_${r}`,
      title: String(title),
      at,
      dayKey: dayKey(new Date(at)),
      color: color || 'var(--ds-accent)',
      kind: 'row',
      link: { ...address, blockId: block.id },
      meta: { row: r, sourceName: block.name || 'Table' },
    })
  }
  return out
}

/** Events typed into the calendar itself. */
export function eventsFromManual(events, address = {}) {
  const out = []
  for (const e of events || []) {
    const at = parseDate(e?.start ?? e?.at)
    if (at === null) continue
    out.push({
      id: e.id || `ev_${at}`,
      title: e.title || 'Event',
      at,
      dayKey: dayKey(new Date(at)),
      color: e.color || 'var(--ds-green)',
      kind: 'event',
      /* A manual event may point anywhere the user chose, or nowhere. */
      link: e.link ? { ...address, ...e.link } : null,
      meta: { manual: true },
    })
  }
  return out
}

/**
 * Resolve a calendar block's declared sources into one list.
 * Sorted by time, so every view can render in order without re-sorting.
 */
export function resolveEvents(block, blocks, address = {}) {
  const sources = block?.sources?.length ? block.sources : [{ kind: 'tasks' }]
  const byId = new Map((blocks || []).map(b => [b.id, b]))
  const out = []

  for (const src of sources) {
    /* HIDDEN IS NOT MEMBERSHIP.

       The sidebar's checkboxes flip `hidden` on a source that stays in the
       list, keeping its dateCol/titleCol configuration — which is the whole
       point of the flag: the rail's old behaviour of REMOVING a source to turn
       it off threw that configuration away, so switching a table back on meant
       picking its date column again.

       Filtered HERE rather than by dimming the sidebar row, because a source
       that is switched off must stop producing events. A calendar whose
       sidebar says a source is off while its grid still shows those events is
       lying about its own state. */
    if (isSourceHidden(src)) continue
    if (src.kind === 'tasks') {
      out.push(...eventsFromTasks(blocks, address))
    } else if (src.kind === 'table') {
      out.push(...eventsFromTable(byId.get(src.blockId), src, address))
    } else if (src.kind === 'events') {
      out.push(...eventsFromManual(block.events, address))
    }
  }

  /* Manual events are always available, even without an explicit source —
     otherwise typing one into the calendar makes it vanish, which reads as
     data loss. */
  if (!sources.some(s => s.kind === 'events') && block?.events?.length) {
    out.push(...eventsFromManual(block.events, address))
  }

  return out.sort((a, b) => a.at - b.at || String(a.title).localeCompare(String(b.title)))
}

/** Events grouped by day key, for a grid to look up in constant time. */
export function bucketByDay(events) {
  const map = new Map()
  for (const e of events || []) {
    if (!map.has(e.dayKey)) map.set(e.dayKey, [])
    map.get(e.dayKey).push(e)
  }
  return map
}

/**
 * The agenda list: upcoming events, grouped by day, from today forward.
 * Past events are excluded except overdue tasks — those are precisely the
 * ones you still need to see.
 */
export function agendaGroups(events, { now = Date.now(), days = 60 } = {}) {
  const from = startOfDay(new Date(now)).getTime()
  const to = addDays(new Date(now), days).getTime()

  const keep = (events || []).filter(e => (e.at >= from && e.at <= to) || e.overdue)
  const groups = []
  let cur = null
  for (const e of keep) {
    if (!cur || cur.key !== e.dayKey) {
      cur = { key: e.dayKey, date: new Date(e.at), events: [] }
      groups.push(cur)
    }
    cur.events.push(e)
  }
  return groups
}

/** "August 2026" and friends. */
export const monthTitle = d => `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`

export function weekTitle(d, weekStart = WEEK_START_MONDAY) {
  const s = startOfWeek(d, weekStart)
  const e = addDays(s, 6)
  const sameMonth = s.getMonth() === e.getMonth()
  return sameMonth
    ? `${s.getDate()}–${e.getDate()} ${MONTH_NAMES[s.getMonth()]} ${s.getFullYear()}`
    : `${s.getDate()} ${MONTH_NAMES[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MONTH_NAMES[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`
}
