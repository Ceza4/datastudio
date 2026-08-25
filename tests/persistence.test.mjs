/*
  tests/persistence.test.mjs
  --------------------------------------------------------------------------
  lib/persistence.js and lib/idb.js had ZERO test coverage. They are also the
  two modules in the app where a bug is unrecoverable — this is a local-first
  product, so a persistence defect destroys the user's only copy. Ten of the
  audit's forty-four findings lived in this file, which is roughly what you
  would expect of code nothing was watching.

  What is tested here is the DECISION LOGIC, not the browser's storage engine:
  refuse a row newer than the one we read, refuse a payload from a future
  build, carry unknown keys through a save, and bound the debounce so
  continuous typing cannot postpone a write forever.

  Every rule is imported from lib/persistence.js and called directly —
  mayOverwrite, isFutureVersion, collectUnknown are exported for exactly that
  reason. A test that re-implements the predicate it is checking passes
  forever, including after someone changes the original, and that is precisely
  how the two-tab bug shipped.
  -------------------------------------------------------------------------- */

let pass = 0, fail = 0
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok   ' + msg) }
  else { fail++; console.log('  FAIL ' + msg) }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg}  (got ${JSON.stringify(a)})`) }

/* lib/persistence.js reads window.localStorage on the legacy-migration path
   and checks for indexedDB. Neither is exercised below, but the module must
   evaluate. */
globalThis.window = { localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} } }
globalThis.indexedDB = {}

const P = await import('../lib/persistence.js')

/* ── debounce: the ceiling, the flush, the pending flag ─────────────────── */
console.log('\n  debounce')
{
  let calls = []
  const d = P.debounce((...a) => calls.push(a), 50, { maxWait: 120 })

  ok(d.pending() === false, 'a fresh debounce reports nothing pending')
  d('a')
  ok(d.pending() === true, 'pending() is true once a change is recorded')
  d.flush()
  eq(calls, [['a']], 'flush() runs the pending call immediately')
  ok(d.pending() === false, 'pending() clears after a flush')

  calls = []
  d.flush()
  eq(calls, [], 'flush() on an idle debounce does nothing')

  calls = []
  d('x'); d.cancel()
  d.flush()
  eq(calls, [], 'cancel() drops the pending call without running it')
}

/* The max-wait ceiling is the one that lost work in production: a plain
   trailing debounce postpones forever under continuous input. */
console.log('\n  debounce max-wait')
await (async () => {
  const calls = []
  const d = P.debounce(v => calls.push(v), 40, { maxWait: 100 })
  const start = Date.now()
  // Call every 15ms for 200ms — always inside the 40ms debounce window.
  await new Promise(res => {
    const iv = setInterval(() => {
      d(Date.now() - start)
      if (Date.now() - start > 200) { clearInterval(iv); res() }
    }, 15)
  })
  ok(calls.length >= 1, `continuous input still produced a save (${calls.length}) rather than none`)
  const plain = []
  // Same input against the old behaviour, for contrast.
  let t = null
  await new Promise(res => {
    const s2 = Date.now()
    const iv = setInterval(() => {
      if (t) clearTimeout(t)
      t = setTimeout(() => plain.push(1), 40)
      if (Date.now() - s2 > 200) { clearInterval(iv); res() }
    }, 15)
  })
  clearTimeout(t)
  eq(plain, [], 'the old trailing-only debounce would have written nothing at all')
})()

/* ── the version guard ──────────────────────────────────────────────────── */
console.log('\n  version guard')
{
  const V = P.STATE_VERSION
  /* The REAL predicate, not a copy of it. */
  const refuses = v => P.isFutureVersion({ version: v })
  ok(refuses(V + 1) === true, 'a payload one version ahead is refused')
  ok(refuses(V) === false, 'the current version loads')
  ok(refuses(V - 1) === false, 'an older version still loads (that is what migrations are for)')
  ok(refuses(undefined) === false, 'a payload with no version at all still loads')
  ok(P.LOAD_FAILED === 'load-failed', 'LOAD_FAILED is the shape callers already branch on')
  ok(typeof P.SAVE_STALE === 'string' && P.SAVE_STALE !== P.SAVE_FAILED,
    'SAVE_STALE is distinct from SAVE_FAILED — a busy tab is not a broken one')
}

/* ── the two-tab rule ───────────────────────────────────────────────────── */
console.log('\n  two-tab safety')
{
  /* The REAL predicate saveState installs. */
  const accept = (observed) => (current) => P.mayOverwrite(current, observed)
  ok(accept(null)(undefined) === true, 'first ever save proceeds (no row, nothing observed)')
  ok(accept(1000)({ savedAt: 1000 }) === true, 'saving over the row we ourselves last wrote proceeds')
  ok(accept(1000)({ savedAt: 900 }) === true, 'saving over an OLDER row proceeds')
  ok(accept(1000)({ savedAt: 1001 }) === false, 'saving over a NEWER row is refused — this is the whole bug')
  ok(accept(null)({ savedAt: 5 }) === true,
    'a tab that never observed a row still writes (it has nothing to be stale against)')
}

/* ── unknown keys survive a round trip ──────────────────────────────────── */
console.log('\n  forward compatibility')
{
  const collect = P.collectUnknown   // the real one
  const fromFuture = { version: 9, notebooks: [], folders: [], savedAt: 1, comments: [{ id: 'c1' }], theme2: 'x' }
  eq(Object.keys(collect(fromFuture)).sort(), ['comments', 'theme2'],
    'keys this build does not model are collected')
  eq(collect({ version: 4, notebooks: [], folders: [] }), {},
    'a payload with nothing extra collects nothing')
  // And the spread order: unknown first, real values win.
  const merged = { ...collect(fromFuture), version: 4, notebooks: ['real'] }
  eq(merged.notebooks, ['real'], 'a real value always wins over a carried-forward one')
  eq(merged.comments, [{ id: 'c1' }], 'the carried-forward key survives the save')
}

/* ── formatBytes, the one pure helper that was already here ─────────────── */
console.log('\n  formatBytes')
{
  eq(P.formatBytes(0), '0 KB', 'zero')
  eq(P.formatBytes(-5), '0 KB', 'negative is clamped rather than rendered')
  eq(P.formatBytes(NaN), '0 KB', 'NaN does not leak into the meter')
  eq(P.formatBytes(1), '1 KB', 'sub-kilobyte rounds up to 1 rather than showing 0')
  eq(P.formatBytes(1024 * 1024), '1.0 MB', 'exactly 1MB')
  eq(P.formatBytes(1024 * 1024 * 1024 * 3), '3.00 GB', 'gigabytes')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
