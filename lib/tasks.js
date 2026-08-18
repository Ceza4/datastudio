/*
  lib/tasks.js
  --------------------------------------------------------------------------
  Priority, deadlines and dependencies.

  WHY THIS ISN'T A TASK APP
  A task here is a block on a canvas, next to the table it came from and the
  PDF it was decided in. That's the whole point — the value isn't the todo
  list, it's that the todo sits beside its evidence.

  So this file stays small and does the three things a task actually needs:
  say when something is due, say what's blocking it, and roll a group up.

  DEPENDENCIES REUSE CONNECTIONS
  The canvas already stores connections between blocks, renders them as bezier
  curves and persists them. A dependency is one of those with a `kind`. No
  second graph, no second renderer, and a dependency you drew is visible as a
  line rather than hidden in a panel.

  EVERYTHING HERE IS PURE
  Blocks in, plain values out. Which means the rules that decide whether
  something is overdue or blocked — the parts most likely to be quietly wrong
  — are the parts that can be checked exactly.
  -------------------------------------------------------------------------- */

/* ── vocabulary ──────────────────────────────────────────────────────── */

export const PRIORITIES = ['low', 'med', 'high', 'urgent']
export const STATUSES = ['todo', 'doing', 'done', 'blocked']

/** Sort weight. Urgent first, so a plain sort puts what matters at the top. */
export const PRIORITY_RANK = { urgent: 0, high: 1, med: 2, low: 3 }

export const PRIORITY_LABEL = { low: 'Low', med: 'Medium', high: 'High', urgent: 'Urgent' }
export const STATUS_LABEL = { todo: 'To do', doing: 'Doing', done: 'Done', blocked: 'Blocked' }

/* Priority colours reuse the existing status tokens rather than introducing a
   fifth palette — amber already means "attention" everywhere else in the app. */
export const PRIORITY_COLOR = {
  urgent: 'var(--ds-red)',
  high: 'var(--ds-amber)',
  med: 'var(--ds-accent)',
  low: 'var(--ds-text-3)',
}

/**
 * How one task relates to another, along a connection.
 *
 *   blocks     from must finish before to can start
 *   depends    the same edge stated the other way round
 *   follows    ordering only, no gating
 *   related    the plain link that already existed
 *
 * `blocks` and `depends` are deliberately BOTH here rather than normalising to
 * one. People draw the arrow in whichever direction they're thinking, and
 * silently flipping it would make the diagram disagree with what they drew.
 */
export const LINK_KINDS = ['related', 'blocks', 'depends', 'follows']

export const LINK_LABEL = {
  related: 'Related to',
  blocks: 'Blocks',
  depends: 'Depends on',
  follows: 'Follows',
}

export const LINK_COLOR = {
  related: 'var(--ds-accent)',
  blocks: 'var(--ds-red)',
  depends: 'var(--ds-amber)',
  follows: 'var(--ds-text-3)',
}

export const isTask = b => b?.type === 'task'

/* ── deadlines ───────────────────────────────────────────────────────── */

/* Today and tomorrow. Long enough to act on, short enough that the chip means
   something when it appears.

   This used to be `SOON_MS = 48 * 60 * 60 * 1000` compared against a raw
   millisecond delta, which is rule 7 in the handover violated inside the file
   the rule was written for. Two calendar days is not always 48 hours: in Kiev,
   27 March 2026 is 23 hours long, so a deadline two days out crossed the
   threshold an hour early and turned amber on the wrong day. Counting days
   makes the window mean what it says. */
export const SOON_DAYS = 1

/* Kept so nothing that imported the old constant breaks at once.
   @deprecated the window is measured in calendar days now — use SOON_DAYS. */
export const SOON_MS = 48 * 60 * 60 * 1000

/* Local midnight. Not exported: lib/calendar.js already exports startOfDay and
   imports from this file, so importing it back would be a cycle. */
const localMidnight = t => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Whole calendar days from `fromTs` to `toTs`, in local time.
 *
 * Both operands are snapped to local midnight FIRST, so the division is
 * between two real calendar boundaries. DST makes some of those gaps 23 or 25
 * hours, which is exactly why the rounding is safe here and is not safe on a
 * raw delta: an error of one hour in 24 can never round to the wrong day,
 * whereas `Math.round((deadline - now) / 86_400_000)` on unsnapped timestamps
 * is really asking "how many 24-hour blocks fit", which is a different and
 * usually wrong question.
 */
export function daysBetween(fromTs, toTs) {
  return Math.round((localMidnight(toTs) - localMidnight(fromTs)) / 86_400_000)
}

/**
 * What a deadline currently means.
 * @returns {{state:'none'|'overdue'|'soon'|'later'|'done', days:number|null, label:string}}
 */
export function deadlineState(task, now = Date.now()) {
  if (task?.status === 'done') return { state: 'done', days: null, label: 'Done' }
  const at = parseDate(task?.deadline)
  if (at === null) return { state: 'none', days: null, label: '' }

  /* Calendar distance, so "3d overdue" counts days on a calendar rather than
     24-hour blocks since a moment. The old version measured milliseconds and
     rounded, which put "Due today" on the overdue branch — unreachable on the
     day a task was due, and displayed until noon the day AFTER. */
  const days = daysBetween(now, at)

  if (days < 0) {
    const over = -days
    return { state: 'overdue', days, label: `${over}d overdue` }
  }
  if (days === 0) {
    /* Hours are a genuine duration, so milliseconds are the right unit here.
       Escalate to a countdown only near the end of the day — "Due in 23h" at
       breakfast is less useful than "Due today", but "Due in 3h" is more. */
    const hours = Math.ceil((at - now) / 3_600_000)
    return { state: 'soon', days, label: hours <= 8 ? `Due in ${Math.max(1, hours)}h` : 'Due today' }
  }
  if (days === 1) return { state: 'soon', days, label: 'Due tomorrow' }
  if (days <= SOON_DAYS) return { state: 'soon', days, label: `${days}d` }
  return { state: 'later', days, label: `${days}d` }
}

export const DEADLINE_COLOR = {
  overdue: 'var(--ds-red)',
  soon: 'var(--ds-amber)',
  later: 'var(--ds-text-3)',
  done: 'var(--ds-text-3)',
  none: 'var(--ds-text-3)',
}

/**
 * Parse a date to a timestamp, or null.
 *
 * A bare 'YYYY-MM-DD' is treated as END of that day in LOCAL time. Two
 * separate traps otherwise: `new Date('2026-08-12')` parses as UTC midnight,
 * so anyone west of Greenwich sees a task go overdue while it's still due;
 * and midnight means a task due today is already late at 00:01.
 */
/* End of a local calendar day, rejecting anything that isn't a real date.
   `new Date(2026, 1, 30)` silently rolls to 2 March, and toDateInput would then
   write that back — laundering a typo into a plausible wrong answer. Round-trip
   and compare instead: if the fields don't survive, the date didn't exist. */
function endOfDay(y, m, d) {
  if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return dt.getTime()
}

/* Excel stores a date as days since 1899-12-30 (the 1900 leap-year bug is why
   it's the 30th and not the 31st). sheet_to_json hands these over as bare
   numbers unless cellDates is set, and String()-ing one produces "46266",
   which new Date() reads as the YEAR 46266. Anything in serial range is
   nonsense as an epoch timestamp — 46266 ms is January 1970 — so the two
   ranges can't collide. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const MAX_EXCEL_SERIAL = 2_958_465          // 9999-12-31
const looksLikeExcelSerial = n => Number.isFinite(n) && n >= 1 && n <= MAX_EXCEL_SERIAL
function fromExcelSerial(n) {
  const utc = new Date(EXCEL_EPOCH_MS + Math.floor(n) * 86_400_000)
  return endOfDay(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

/**
 * Parse a date to a timestamp, or null.
 *
 * A bare 'YYYY-MM-DD' is treated as END of that day in LOCAL time. Two
 * separate traps otherwise: `new Date('2026-08-12')` parses as UTC midnight,
 * so anyone west of Greenwich sees a task go overdue while it's still due;
 * and midnight means a task due today is already late at 00:01.
 *
 * `dayFirst` decides 03/04/2026. There is no correct default — it is 3 April
 * in Europe and 4 March in the US — so anything with a component above 12
 * disambiguates itself and is trusted over the flag. Callers that can see a
 * whole column (dateColumns) should infer the flag from it rather than guess
 * per cell.
 */
export function parseDate(value, { dayFirst = true } = {}) {
  if (value === null || value === undefined || value === '') return null

  /* A real Date, e.g. from XLSX.read(..., { cellDates: true }). Take its
     calendar fields, not its clock — a date cell means a day, not an instant. */
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isFinite(t) ? endOfDay(value.getFullYear(), value.getMonth() + 1, value.getDate()) : null
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return looksLikeExcelSerial(value) ? fromExcelSerial(value) : value
  }

  const s = String(value).trim()
  if (!s) return null

  /* ISO-ish, day only. */
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return endOfDay(+m[1], +m[2], +m[3])

  /* 12/08/2026 · 12.08.2026 · 12-08-2026 */
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s)
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3]
    if (a > 12) return endOfDay(y, b, a)        // first field can only be a day
    if (b > 12) return endOfDay(y, a, b)        // second field can only be a day
    return dayFirst ? endOfDay(y, b, a) : endOfDay(y, a, b)
  }

  /* 2026/08/12 */
  m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(s)
  if (m) return endOfDay(+m[1], +m[2], +m[3])

  /* A bare integer that reached us as text — same Excel serial case. */
  if (/^\d+$/.test(s) && looksLikeExcelSerial(+s)) return fromExcelSerial(+s)

  /* Anything else — 'August 12, 2026', a full ISO timestamp — goes to the
     engine, but the result is range-checked. Without this, an unparsed serial
     or a stray number lands in the year 46266 and the calendar renders empty
     with no error, which is worse than refusing the value. */
  const t = new Date(s).getTime()
  if (!Number.isFinite(t)) return null
  const year = new Date(t).getFullYear()
  return year >= 1900 && year <= 2200 ? t : null
}

/** A timestamp back to the 'YYYY-MM-DD' a date input wants. */
export function toDateInput(value) {
  const t = parseDate(value)
  if (t === null) return ''
  const d = new Date(t)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ── dependencies ────────────────────────────────────────────────────── */

/**
 * Which tasks stand in this one's way.
 *
 * A connection means "blocked" when it says so in either direction:
 *   { from: X, to: ME, kind: 'blocks' }   — X blocks me
 *   { from: ME, to: X, kind: 'depends' }  — I depend on X
 *
 * Only tasks that aren't done count. A blocker that's finished isn't a
 * blocker, and leaving it in the list means the state never clears.
 */
export function blockersOf(blockId, blocks, connections) {
  const byId = new Map((blocks || []).map(b => [b.id, b]))
  const out = []
  for (const c of connections || []) {
    let otherId = null
    if (c.kind === 'blocks' && c.toBlockId === blockId) otherId = c.fromBlockId
    else if (c.kind === 'depends' && c.fromBlockId === blockId) otherId = c.toBlockId
    if (!otherId) continue
    const other = byId.get(otherId)
    if (isTask(other) && other.status !== 'done') out.push(other)
  }
  return out
}

/**
 * The status to SHOW, which isn't always the one stored.
 *
 * Blocked is derived, never typed. A task is blocked because something else
 * isn't finished, and that fact changes when the other task changes — storing
 * it would mean every edit had to remember to update its dependents, and it
 * would drift the first time one didn't.
 *
 * `done` still wins over everything: finishing something despite an
 * outstanding blocker is a legitimate thing to do, and the app shouldn't argue.
 */
export function effectiveStatus(task, blocks, connections) {
  if (!isTask(task)) return null
  if (task.status === 'done') return 'done'
  return blockersOf(task.id, blocks, connections).length > 0 ? 'blocked' : (task.status || 'todo')
}

/**
 * Does adding this connection create a cycle?
 *
 * A → B → C → A means three tasks each waiting for each other, none of which
 * can ever start. The graph is small, so a plain depth-first walk is plenty,
 * and it's guarded against cycles that ALREADY exist in stored data — which
 * matters, because a previous version could have written one.
 */
export function wouldCycle(fromId, toId, connections) {
  if (!fromId || !toId) return false
  if (fromId === toId) return true

  const edges = new Map()
  for (const c of connections || []) {
    if (c.kind !== 'blocks' && c.kind !== 'depends') continue
    // Normalise to "waits for": depends is blocks with the ends swapped.
    const [a, b] = c.kind === 'blocks' ? [c.fromBlockId, c.toBlockId] : [c.toBlockId, c.fromBlockId]
    if (!edges.has(a)) edges.set(a, [])
    edges.get(a).push(b)
  }
  if (!edges.has(fromId)) edges.set(fromId, [])
  edges.get(fromId).push(toId)

  const seen = new Set()
  const stack = [toId]
  while (stack.length) {
    const cur = stack.pop()
    if (cur === fromId) return true
    if (seen.has(cur)) continue          // already-cyclic data must not hang
    seen.add(cur)
    for (const next of edges.get(cur) || []) stack.push(next)
  }
  return false
}

/* ── grouping ────────────────────────────────────────────────────────── */

/**
 * Counts by effective status, for a section header.
 * Returns null when there are no tasks, so a section of tables shows nothing
 * rather than "0 done".
 */
export function rollup(taskBlocks, allBlocks, connections) {
  const tasks = (taskBlocks || []).filter(isTask)
  if (!tasks.length) return null

  const counts = { todo: 0, doing: 0, done: 0, blocked: 0 }
  let overdue = 0
  for (const t of tasks) {
    counts[effectiveStatus(t, allBlocks, connections)]++
    if (deadlineState(t).state === 'overdue') overdue++
  }
  return {
    total: tasks.length,
    ...counts,
    overdue,
    pct: Math.round((counts.done / tasks.length) * 100),
  }
}

/**
 * Sort for any list of tasks.
 * Overdue first, then priority, then the nearest deadline, then the title —
 * so the order is stable and the top of the list is always what to do next.
 */
export function sortTasks(tasks, now = Date.now()) {
  return [...(tasks || [])].sort((a, b) => {
    const da = deadlineState(a, now), db = deadlineState(b, now)
    const oa = da.state === 'overdue' ? 0 : 1
    const ob = db.state === 'overdue' ? 0 : 1
    if (oa !== ob) return oa - ob

    const pa = PRIORITY_RANK[a.priority] ?? 9
    const pb = PRIORITY_RANK[b.priority] ?? 9
    if (pa !== pb) return pa - pb

    // A task with no deadline sorts after one that has any.
    const ta = parseDate(a.deadline) ?? Infinity
    const tb = parseDate(b.deadline) ?? Infinity
    if (ta !== tb) return ta - tb

    return String(a.title || '').localeCompare(String(b.title || ''))
  })
}

/** Everything with a deadline, for the calendar to read. */
export function tasksWithDeadlines(blocks) {
  return (blocks || []).filter(b => isTask(b) && parseDate(b.deadline) !== null)
}
