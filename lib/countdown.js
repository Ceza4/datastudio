/*
  lib/countdown.js
  --------------------------------------------------------------------------
  The date arithmetic behind the countdown block, with no React in it.

  SPLIT OUT SO IT CAN BE TESTED IN BARE NODE. tests/run.mjs only loads the JSX
  transform for suites named smoke.*, and the interesting part of a countdown
  is not the markup — it is whether "1 month" means the right thing on 31
  January. Living here, it gets a normal unit suite (tests/countdown.test.mjs)
  instead of one bolted onto a render test, which is the same reasoning that
  put deadlineState in lib/tasks.js rather than in TaskBlock.

  CALENDAR UNITS, NOT MILLISECONDS
  Years, months and days are counted by stepping the calendar with the same
  addMonths/addDays every other dated feature in this app uses, not by dividing
  the gap by 86_400_000. The obvious version is wrong twice: it drifts an hour
  on the two days a year the clocks move, and it has no honest answer for "a
  month" at all. addMonths already clamps the 31 Jan + 1 month case, which is
  the reason to reuse it rather than write a second, worse copy here.

  Hours, minutes and seconds DO come off the millisecond remainder, and there
  they are right by definition — an hour is 3,600,000ms whatever the calendar
  is doing. One consequence, deliberate and left visible: on a DST fall-back
  day the remainder after the last whole day can run to 25 hours, so a block
  can read "24 HR" for that one day a year. That is the true remaining
  duration; rounding it up into an extra day would contradict the day count
  sitting next to it, and a countdown that disagrees with itself is worse than
  one that is briefly surprising.
  -------------------------------------------------------------------------- */

import { addDays, addMonths } from './calendar.js'

/* Largest first. `min: true` marks the units that are always rendered, so the
   block never shrinks to a single cell that re-widths itself every minute. */
export const UNITS = [
  { key: 'years',   label: 'YR' },
  { key: 'months',  label: 'MO' },
  { key: 'days',    label: 'DAY' },
  { key: 'hours',   label: 'HR' },
  { key: 'minutes', label: 'MIN', min: true },
  { key: 'seconds', label: 'SEC', min: true },
]

export const ZERO = Object.freeze({ years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 })

/**
 * Break the span between two instants into calendar units.
 * `from` must be the earlier one; the caller decides which is which, and that
 * is what lets one function serve both the countdown and the count-up after it.
 * A non-positive span returns all zeros rather than negatives.
 */
export function decompose(from, to) {
  const start = new Date(from)
  const end = new Date(to)
  if (!(end > start)) return { ...ZERO }

  /* MONTHS ARE MEASURED FROM THE ORIGINAL DATE, NOT ACCUMULATED ONE AT A TIME.

     Stepping `cur = addMonths(cur, 1)` in a loop looks equivalent and is not:
     addMonths clamps, and once it has clamped it has forgotten the day it came
     from. 31 Jan → 31 Mar then walks Jan31 → Feb28 → Mar28 and reports "2
     months 3 days" for what is plainly two months. Measuring every candidate
     against `start` keeps the original day-of-month, so the clamp only ever
     applies to the month the answer actually lands in.

     Estimate-then-correct rather than a loop, and that is not premature: this
     runs once a second per block on screen, and stepping a month at a time
     costs 1,200 iterations a tick on a countdown a century out. Each
     correction loop runs at most once or twice. */
  let tm = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  while (tm > 0 && addMonths(start, tm) > end) tm--
  while (addMonths(start, tm + 1) <= end) tm++
  if (tm < 0) tm = 0

  const afterMonths = addMonths(start, tm)

  /* Same shape for days. The /86_400_000 estimate is allowed to be an hour
     wrong across a DST boundary precisely because the corrections decide. */
  let d = Math.floor((end.getTime() - afterMonths.getTime()) / 86_400_000)
  if (d < 0) d = 0
  while (d > 0 && addDays(afterMonths, d) > end) d--
  while (addDays(afterMonths, d + 1) <= end) d++

  const cur = addDays(afterMonths, d)
  let rem = end.getTime() - cur.getTime()
  const hours = Math.floor(rem / 3_600_000); rem -= hours * 3_600_000
  const minutes = Math.floor(rem / 60_000);  rem -= minutes * 60_000
  const seconds = Math.floor(rem / 1000)

  return { years: Math.floor(tm / 12), months: tm % 12, days: d, hours, minutes, seconds }
}

/**
 * The units actually worth rendering: the largest non-zero one downwards,
 * with minutes and seconds as the floor.
 *
 * "0 YR 0 MO 3 DAY" is noise, and it is the reason this exists — the block
 * narrows as the date approaches rather than carrying six cells of zeros for
 * a year. The floor is what stops a countdown under a minute from collapsing
 * to one lonely cell whose width changes every time it ticks.
 */
export function visibleUnits(parts) {
  const first = UNITS.findIndex(u => parts[u.key] > 0)
  const floor = UNITS.findIndex(u => u.min)
  return UNITS.slice(first === -1 ? floor : Math.min(first, floor))
}

export const pad = n => String(n).padStart(2, '0')

/* ── datetime-local ⇄ ISO ──────────────────────────────────────────────────
   `datetime-local` speaks local wall time with no zone; the block stores a
   real instant. Going through the string in both directions rather than
   through toISOString().slice(0,16) — which converts to UTC first and so
   shows a time your own offset hours away from the one you typed — is the
   entire reason these two functions exist rather than one inline slice. */

/** ISO instant → the `YYYY-MM-DDTHH:mm` a datetime-local input wants. */
export function toLocalInput(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A datetime-local value → an ISO instant, or null if the field is empty. */
export function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)          // no Z and no offset, so parsed as local
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
