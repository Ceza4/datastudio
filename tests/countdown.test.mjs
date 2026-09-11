/*
  tests/countdown.test.mjs
  --------------------------------------------------------------------------
  The date arithmetic behind the countdown block.

  WHY THIS FILE EXISTS
  Every dated feature in this app has already been bitten once by the same
  mistake — dividing an interval by 86_400_000 and calling the result days.
  lib/calendar.js carries the scar tissue (addMonths' clamp, addDays' comment,
  msUntilNextLocalMidnight's whole docblock). A countdown is that mistake's
  natural habitat: it is the one component whose entire output IS the interval,
  it ticks once a second so a one-hour error is visible rather than theoretical,
  and "1 month" has no correct millisecond value at all.

  The month cases below are not hypothetical. 31 January is the date that
  breaks every naive implementation, and the accumulate-one-month-at-a-time
  version — which is what an obvious rewrite of this would produce — gets
  "31 Jan → 31 Mar" wrong by three days while looking completely reasonable.

  Run: node tests/countdown.test.mjs
  -------------------------------------------------------------------------- */

import { decompose, visibleUnits, UNITS, toLocalInput, fromLocalInput, pad } from '../lib/countdown.js'
import { addDays, addMonths } from '../lib/calendar.js'

let pass = 0, fail = 0
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + msg) }
  else { fail++; console.log(`  FAIL ${msg}${extra ? '\n        ' + extra : ''}`) }
}

const D = s => new Date(s)
const parts = (a, b) => decompose(D(a), D(b))
const eq = (p, exp) => Object.entries(exp).every(([k, v]) => p[k] === v)
const show = p => `${p.years}y ${p.months}mo ${p.days}d ${p.hours}:${p.minutes}:${p.seconds}`

/* ── the month-end cases, which is what this suite is for ───────────────── */
console.log('\n month arithmetic')
{
  const p = parts('2027-01-31T10:00', '2027-02-28T10:00')
  ok(eq(p, { years: 0, months: 1, days: 0 }), '31 Jan → 28 Feb is one month, not "28 days"', show(p))

  /* THE ONE THAT CATCHES THE OBVIOUS REWRITE. Accumulating a month at a time
     walks Jan31 → Feb28 → Mar28 and reports 2 months 3 days, because addMonths
     clamped and then forgot where it started. */
  const q = parts('2027-01-31T10:00', '2027-03-31T10:00')
  ok(eq(q, { years: 0, months: 2, days: 0 }), '31 Jan → 31 Mar is exactly two months, with no stray days', show(q))

  const r = parts('2027-01-31T10:00', '2027-03-01T10:00')
  ok(eq(r, { years: 0, months: 1, days: 1 }), '31 Jan → 1 Mar is one month and one day', show(r))

  const s = parts('2027-01-31T10:00', '2027-02-27T10:00')
  ok(eq(s, { years: 0, months: 0, days: 27 }), 'one day short of a month stays in days rather than rounding up', show(s))

  const t = parts('2028-02-29T10:00', '2029-02-28T10:00')
  ok(eq(t, { years: 1, months: 0, days: 0 }), '29 Feb → 28 Feb the following year is one year, not one year minus a day', show(t))

  const u = parts('2026-09-10T12:00', '2126-09-10T12:00')
  ok(eq(u, { years: 100, months: 0, days: 0 }), 'a century out is 100 years and nothing else', show(u))
}

/* ── DST, the other half of the 86_400_000 bug ──────────────────────────── */
console.log('\n daylight saving')
{
  /* Europe/Vilnius moves on the last Sunday of October and March. These two
     assertions are the entire reason this uses addDays instead of arithmetic:
     the gap between the same wall time on consecutive days is 23 or 25 hours,
     and a countdown that says "23 HR" on the last day before a deadline is
     wrong in the way people notice. TZ is set by the assertion itself rather
     than by the runner, so the suite means the same thing on any machine. */
  const tz = process.env.TZ
  process.env.TZ = 'Europe/Vilnius'

  /* A GUARD, BECAUSE THE TWO ASSERTIONS BELOW PASS TRIVIALLY IN UTC.

     Not every runtime re-reads TZ after start-up. If this one didn't, the
     clocks never move, noon to noon is a flat 24 hours, and both DST
     assertions would go green while testing nothing at all — the worst
     possible outcome for a regression test. So first prove the gap really is
     25 and 23 hours, which is exactly the fact the naive implementation gets
     wrong. If this line fails, the two below are meaningless rather than
     broken. */
  const gapH = (a, b) => (D(b).getTime() - D(a).getTime()) / 3_600_000
  ok(gapH('2026-10-24T12:00', '2026-10-25T12:00') === 25 && gapH('2027-03-27T12:00', '2027-03-28T12:00') === 23,
     'the runtime honours TZ, so the clock-change days really are 25 and 23 hours long',
     'if this fails the two assertions below are vacuous, not passing')

  const fallBack = parts('2026-10-24T12:00', '2026-10-25T12:00')
  ok(eq(fallBack, { days: 1, hours: 0, minutes: 0 }),
     'noon to noon across the autumn clock change is one day, not one day and an hour', show(fallBack))

  const springFwd = parts('2027-03-27T12:00', '2027-03-28T12:00')
  ok(eq(springFwd, { days: 1, hours: 0, minutes: 0 }),
     'noon to noon across the spring clock change is one day, not 23 hours', show(springFwd))

  process.env.TZ = tz
}

/* ── the ordinary cases ─────────────────────────────────────────────────── */
console.log('\n intervals')
{
  ok(eq(parts('2026-09-10T12:00', '2026-09-13T12:00'), { days: 3, hours: 0 }), 'three days')
  ok(eq(parts('2026-09-10T12:00:00', '2026-09-10T12:00:40'), { minutes: 0, seconds: 40 }), 'forty seconds')
  ok(eq(parts('2026-09-10T12:00:00', '2026-09-11T11:59:59'), { days: 0, hours: 23, minutes: 59, seconds: 59 }),
     'one second under a day never rounds up into a day')
  ok(eq(parts('2026-12-31T23:59:00', '2027-01-01T00:00:30'), { minutes: 1, seconds: 30 }),
     'a span across new year is ninety seconds, not a year')
}

console.log('\n a span that has run out')
{
  const same = parts('2026-09-10T12:00', '2026-09-10T12:00')
  ok(eq(same, { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }), 'an instant against itself is all zeros')

  const past = parts('2026-09-10T12:00', '2026-09-09T12:00')
  ok(Object.values(past).every(v => v === 0), 'a target in the past is all zeros, never negative numbers')
}

/* ── the round-trip invariant, fuzzed ───────────────────────────────────── */
console.log('\n round trip')
{
  /* THE PROPERTY THAT MATTERS: re-adding the decomposition to the start must
     land back on the target, to the second. Any unit that is off by one — the
     month clamp, a DST hour, a day that was counted twice — breaks this, which
     is what makes one assertion worth four thousand hand-written cases.

     Seeded rather than random, so a failure is reproducible: a fuzz test that
     fails once a fortnight in CI and never again locally is not a test. */
  let seed = 20260910
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

  const base = Date.parse('2026-01-01T00:00:00')
  let mismatch = 0, ranged = 0, first = ''
  for (let i = 0; i < 4000; i++) {
    const s = new Date(base + Math.floor(rnd() * 3.15e10))      // ~within a year
    const e = new Date(s.getTime() + Math.floor(rnd() * 1.6e11)) // ~up to five years on
    const p = decompose(s, e)

    let c = addMonths(s, p.years * 12 + p.months)
    c = addDays(c, p.days)
    const back = c.getTime() + p.hours * 3_600_000 + p.minutes * 60_000 + p.seconds * 1000
    if (Math.abs(back - e.getTime()) >= 1000) {
      mismatch++
      if (!first) first = `${s.toISOString()} → ${e.toISOString()} gave ${show(p)}`
    }
    if (p.months > 11 || p.days < 0 || p.hours < 0 || p.minutes > 59 || p.seconds > 59) ranged++
  }
  ok(mismatch === 0, '4000 random spans all rebuild to their target, to the second', first)
  ok(ranged === 0, 'and no unit ever escapes its range — months < 12, minutes and seconds < 60')
}

/* ── which units end up on screen ───────────────────────────────────────── */
console.log('\n visible units')
{
  const keys = p => visibleUnits(p).map(u => u.key).join(' ')
  ok(keys({ years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 }) === 'years months days hours minutes seconds',
     'a span with years on it shows all six units')
  ok(keys({ years: 0, months: 0, days: 3, hours: 4, minutes: 5, seconds: 6 }) === 'days hours minutes seconds',
     'three days out drops YR and MO rather than printing zeros')
  ok(keys({ years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 40 }) === 'minutes seconds',
     'under a minute still keeps MIN, so the block never collapses to one cell')
  ok(keys({ years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }) === 'minutes seconds',
     'and all-zero — the expired state — resolves to the same two')
  ok(visibleUnits({ years: 0, months: 5, days: 0, hours: 0, minutes: 0, seconds: 0 })[0].key === 'months',
     'a zero above the largest non-zero unit is dropped; a zero below it is kept')
  ok(UNITS.every(u => typeof u.label === 'string' && u.label.length <= 3),
     'every unit label is short enough for the cell it sits in')
}

/* ── the datetime-local round trip ──────────────────────────────────────── */
console.log('\n datetime-local')
{
  /* toISOString().slice(0, 16) is the tempting one-liner and it is wrong by
     your UTC offset: type 14:00 into the picker, reopen the block, read 11:00.
     This asserts the pair is offset-free in both directions. */
  const iso = fromLocalInput('2027-06-01T14:30')
  const back = toLocalInput(iso)
  ok(back === '2027-06-01T14:30', 'a picked local time survives the round trip unshifted', `got ${back}`)
  ok(new Date(iso).getHours() === 14, 'and the stored instant really is 14:30 local, not 14:30 UTC')

  ok(fromLocalInput('') === null, 'clearing the field yields null rather than an Invalid Date')
  ok(fromLocalInput('not a date') === null, 'so does junk')
  ok(toLocalInput('not a date') === '', 'an unparseable stored value renders as an empty field, not "NaN-NaN-NaN"')
  ok(toLocalInput(undefined) === '', 'and so does a missing one')
  ok(pad(7) === '07' && pad(11) === '11', 'pad keeps two digits without truncating')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
