/*
  tests/renderqueue.test.mjs
  --------------------------------------------------------------------------
  The queue that stops pdf.js renders colliding.

  This file exists because the first fix for that collision looked correct,
  read correctly, and was still wrong. The bug only appeared when the real
  constraint was simulated:

      one render per canvas, and cancel() releases it ASYNCHRONOUSLY

  So the canvas below is a fake that enforces exactly that, and throws the
  same error pdf.js throws. Every test drives the queue through a sequence
  that actually happens in the app.

  The specific sequence that broke the previous design is `page flip` below:
  three draws 2ms apart, where the second cancels the first and the third
  arrives before the first has released. Anything that reintroduces a
  "current task" ref will fail there.
  -------------------------------------------------------------------------- */

import { createRenderQueue } from '../lib/renderqueue.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** A canvas with pdf.js's exclusivity rules. */
function makeCanvas({ renderMs = 12, cancelMs = 3 } = {}) {
  let claimed = false
  const state = { collisions: 0, started: 0, completed: 0 }

  return {
    state,
    render(id) {
      state.started++
      if (claimed) {
        state.collisions++
        throw new Error('Cannot use the same canvas during multiple render() operations.')
      }
      claimed = true
      let cancelled = false
      let release
      const promise = new Promise((res, rej) => {
        release = () => {
          claimed = false
          if (cancelled) rej(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' }))
          else { state.completed++; res(id) }
        }
      })
      const timer = setTimeout(release, renderMs)
      return {
        promise,
        cancel() { cancelled = true; clearTimeout(timer); setTimeout(release, cancelMs) },
      }
    },
  }
}

/** A job shaped exactly like PdfBlock's drawNow. */
const job = (canvas, id, painted) => async ctx => {
  if (!ctx.isCurrent()) return
  const task = canvas.render(id)
  ctx.track(task)
  try { await task.promise } catch { return }
  ctx.untrack(task)
  if (!ctx.isCurrent()) return
  painted.push(id)
}

/* ── 1 · the open burst ──────────────────────────────────────────────── */
console.log('\n open burst — five draws in one tick (StrictMode doubles it)')
{
  const c = makeCanvas()
  const q = createRenderQueue()
  const painted = []
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map(id => q.run(job(c, id, painted))))
  await sleep(60)
  ok(c.state.collisions === 0, 'no canvas collisions')
  ok(painted.length <= 1, `at most one paint (${painted.length})`)
  ok(painted[0] === 'e' || painted.length === 0, 'and it is the newest, not an earlier one')
}

/* ── 2 · the sequence that broke the previous design ─────────────────── */
console.log('\n page flip — draws 2ms apart, render 12ms, cancel releases at 3ms')
{
  const c = makeCanvas()
  const q = createRenderQueue()
  const painted = []
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
    q.run(job(c, id, painted))
    await sleep(2)
  }
  await sleep(200)
  ok(c.state.collisions === 0, 'no collisions — THIS is the case a task-ref fix fails')
  ok(painted.length === 1 && painted[0] === 'p6', `only the last page painted (${JSON.stringify(painted)})`)
}

/* ── 3 · pathological ────────────────────────────────────────────────── */
console.log('\n forty draws at random intervals')
{
  const c = makeCanvas()
  const q = createRenderQueue()
  const painted = []
  for (let i = 0; i < 40; i++) {
    q.run(job(c, `x${i}`, painted))
    await sleep(Math.random() * 6)
  }
  await sleep(300)
  ok(c.state.collisions === 0, `no collisions across ${c.state.started} attempted renders`)
  ok(painted.length === 1 && painted[0] === 'x39', 'exactly one paint, and it is the newest')
}

/* ── 4 · the quiet case still works ──────────────────────────────────── */
console.log('\n unhurried use')
{
  const c = makeCanvas({ renderMs: 4 })
  const q = createRenderQueue()
  const painted = []
  for (const id of ['a', 'b', 'c']) { await q.run(job(c, id, painted)); await sleep(8) }
  ok(c.state.collisions === 0, 'no collisions')
  ok(painted.join() === 'a,b,c', 'every page paints when there is time — supersession does not over-fire')
  ok(c.state.completed === 3, 'and all three renders ran to completion')
}

/* ── 5 · teardown ────────────────────────────────────────────────────── */
console.log('\n cancelAll')
{
  const c = makeCanvas()
  const q = createRenderQueue()
  const painted = []
  q.run(job(c, 'a', painted))
  await sleep(2)
  q.cancelAll()
  await sleep(60)
  ok(painted.length === 0, 'nothing paints after teardown — no setState on an unmounted component')
  ok(c.state.collisions === 0, 'and no collision on the way out')

  // The queue must still be usable afterwards (a remount reuses nothing, but
  // a poisoned chain here would be a silent dead end).
  const painted2 = []
  await q.run(job(c, 'z', painted2))
  await sleep(30)
  ok(painted2.join() === 'z', 'the queue still works after cancelAll')
}

/* ── 6 · a throwing job must not wedge the queue ─────────────────────── */
console.log('\n error containment')
{
  const c = makeCanvas({ renderMs: 3 })
  const q = createRenderQueue()
  const painted = []

  const boom = q.run(async () => { throw new Error('render exploded') })
  ok(boom instanceof Promise, 'run() returns a promise')
  await boom.catch(() => {})

  await q.run(job(c, 'after', painted))
  await sleep(30)
  ok(painted.join() === 'after', 'a job that throws does not poison the queue for later work')
  ok(c.state.collisions === 0, 'and leaves the canvas free')

  /* Every rejection must be handled internally too. An unhandled rejection
     here would crash a production browser tab. */
  let unhandled = 0
  const onUnhandled = () => unhandled++
  process.on('unhandledRejection', onUnhandled)
  q.run(async () => { throw new Error('ignored on purpose') })
  await sleep(40)
  process.off('unhandledRejection', onUnhandled)
  ok(unhandled === 0, 'a rejection nobody awaits is contained, not unhandled')
}

/* ── 7 · supersession bookkeeping ────────────────────────────────────── */
console.log('\n generation')
{
  const q = createRenderQueue()
  const before = q.generation
  q.run(async () => {})
  ok(q.generation === before + 1, 'scheduling bumps the generation')
  q.run(async () => {})
  ok(q.generation === before + 2, 'each schedule bumps it again')
  q.cancelAll()
  ok(q.generation === before + 3, 'cancelAll bumps it, invalidating anything queued')

  let sawStale = false
  await q.run(async ctx => { sawStale = !ctx.isCurrent() })
  ok(sawStale === false, 'a job that is still the newest sees isCurrent() true')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
