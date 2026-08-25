/*
  tests/windowing.test.mjs
  --------------------------------------------------------------------------
  The row/column window in SheetGrid.

  The scan used to be four linear walks from index 0, in the component body,
  on every render — 200,000 iterations per scroll frame at the bottom of a
  large import. rowOff and colOff are prefix sums and therefore already sorted,
  so it was a binary search wearing a while loop.

  Replacing a working algorithm with a faster one is exactly the change that
  quietly renders one row too few at some boundary and shows a blank strip at
  the bottom of the viewport. So the property tested here is not "the two agree
  exactly" — the new window is allowed to be slightly larger — but "the new
  window never covers LESS than the old one", checked against the original
  implementation over thousands of randomised layouts.
  -------------------------------------------------------------------------- */

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }

/* The implementation as it stood before the change. Kept here on purpose: it
   is the oracle, and a copy of it is the only way to assert equivalence. */
function linearWindow(off, n, start, extent, overscan) {
  let first = 0
  while (first < n - 1 && off[first + 1] <= start) first++
  first = Math.max(0, first - overscan)
  let last = first
  while (last < n && off[last] < start + extent + 40) last++
  last = Math.min(n, last + overscan)
  return [first, last]
}

/* The implementation now in SheetGrid.js. */
function firstAtOrAfter(offsets, count, target) {
  let lo = 0, hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}
function binaryWindow(off, n, start, extent, overscan) {
  let first = Math.max(0, firstAtOrAfter(off, n, start) - overscan)
  let last = Math.min(n, firstAtOrAfter(off, n, start + extent + 40) + 1 + overscan)
  if (last <= first) last = Math.min(n, first + 1)
  return [first, last]
}

console.log('\n  the new window never shows less than the old one')
{
  let narrower = 0, wastedTotal = 0, worstWaste = 0, checked = 0
  /* Deterministic pseudo-random, so a failure is reproducible. */
  let seed = 1234567
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

  for (let trial = 0; trial < 400; trial++) {
    const n = 1 + Math.floor(rnd() * 400)
    const off = [0]
    for (let i = 0; i < n; i++) off.push(off[i] + (10 + Math.floor(rnd() * 40)))
    for (let k = 0; k < 25; k++) {
      const start = Math.floor(rnd() * (off[n] + 200)) - 50
      const extent = 1 + Math.floor(rnd() * 600)
      const overscan = Math.floor(rnd() * 4)
      const a = linearWindow(off, n, start, extent, overscan)
      const b = binaryWindow(off, n, start, extent, overscan)
      checked++
      if (b[0] > a[0] || b[1] < a[1]) narrower++
      const waste = (a[0] - b[0]) + (b[1] - a[1])
      wastedTotal += waste
      if (waste > worstWaste) worstWaste = waste
    }
  }
  ok(narrower === 0, `${checked} randomised windows, none narrower than the linear scan`)
  ok(worstWaste <= 2, `and never more than 2 extra rows at the edges (worst: ${worstWaste})`)
  ok(wastedTotal / checked < 1, `average extra rows per window under 1 (${(wastedTotal / checked).toFixed(2)})`)
}

console.log('\n  edge cases the random pass will not reliably hit')
{
  const off = [0, 20, 40, 60, 80, 100]
  const n = 5
  ok(binaryWindow(off, n, 0, 100, 0)[0] === 0, 'scrolled to the very top starts at row 0')
  ok(binaryWindow(off, n, -999, 100, 0)[0] === 0, 'a negative scroll (overscroll bounce) clamps to 0')
  ok(binaryWindow(off, n, 99999, 100, 0)[1] <= n, 'scrolled past the end never exceeds the row count')
  const [f, l] = binaryWindow(off, n, 99999, 100, 0)
  ok(l > f, 'and still yields a non-empty window rather than a blank grid')
  ok(binaryWindow([0], 0, 0, 100, 0)[1] >= 0, 'zero rows does not loop or throw')
  ok(binaryWindow([0, 10], 1, 0, 100, 3)[1] === 1, 'one row with a large overscan stays clamped to one row')
}

console.log('\n  it is actually logarithmic')
{
  /* Not a timing test — those are flaky. Counts the comparisons instead. */
  let steps = 0
  const counting = (offsets, count, target) => {
    let lo = 0, hi = count - 1
    while (lo < hi) { steps++; const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= target) lo = mid; else hi = mid - 1 }
    return lo
  }
  const n = 200000
  const off = new Array(n + 1)
  off[0] = 0
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + 24
  counting(off, n, off[n - 1])
  ok(steps < 25, `finding the last row of a 200,000-row sheet takes ${steps} steps, not 200,000`)
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
