/*
  tests/canvasgeom.test.mjs
  --------------------------------------------------------------------------
  Screen coordinates versus canvas coordinates.

  This is the bug behind BOTH "the PDF editor starts editing way past my
  mouse" and "the sheet's right-click menu isn't at the cursor". One root
  cause, reported twice, and previously "fixed" without being understood.

  The fake element below models the thing that actually goes wrong: a
  getBoundingClientRect() that reports the SCALED box while offsetWidth
  reports the LAYOUT box. Every assertion is checked at zoom 1 as well as at
  other zooms, because at zoom 1 the broken and correct implementations agree
  exactly — which is precisely why this survives casual testing.
  -------------------------------------------------------------------------- */

import { elementScale, localPoint, localPointFromEvent, localSize } from '../lib/canvasgeom.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol

/**
 * An element of `w × h` LAYOUT pixels, rendered at `scale`, whose top-left
 * corner sits at (screenX, screenY) on screen.
 */
const fakeEl = ({ w = 520, h = 620, scale = 1, screenX = 100, screenY = 50 } = {}) => ({
  offsetWidth: w,
  offsetHeight: h,
  getBoundingClientRect: () => ({
    left: screenX, top: screenY,
    width: w * scale, height: h * scale,
    right: screenX + w * scale, bottom: screenY + h * scale,
  }),
})

/* ── scale detection ─────────────────────────────────────────────────── */
console.log('\n elementScale')
ok(elementScale(fakeEl({ scale: 1 })) === 1, 'unzoomed')
ok(elementScale(fakeEl({ scale: 0.5 })) === 0.5, 'zoomed out to 50%')
ok(elementScale(fakeEl({ scale: 2 })) === 2, 'zoomed in to 200%')
ok(near(elementScale(fakeEl({ scale: 0.37 })), 0.37), 'an arbitrary zoom')
ok(elementScale(null) === 1, 'null element falls back to 1 rather than NaN')
ok(elementScale({ offsetWidth: 0, offsetHeight: 0, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }) === 1,
   'a zero-size element is not evidence of a zero scale')
{
  // A collapsed width must not defeat detection when the height is usable.
  const el = { offsetWidth: 0, offsetHeight: 100, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 50 }) }
  ok(elementScale(el) === 0.5, 'falls back to the height axis when the width is unusable')
}

/* ── the actual bug ──────────────────────────────────────────────────── */
console.log('\n localPoint — the correction that was missing')
{
  /* The broken implementation, for comparison. This is what was shipped, and
     what every naive pointer handler does. */
  const broken = (el, cx, cy) => {
    const r = el.getBoundingClientRect()
    return { x: cx - r.left, y: cy - r.top }
  }

  // At zoom 1 the two agree exactly — which is why this passed every manual test.
  {
    const el = fakeEl({ scale: 1, screenX: 100, screenY: 50 })
    const good = localPoint(el, 300, 250)
    const bad = broken(el, 300, 250)
    ok(good.x === 200 && good.y === 200, 'zoom 1: 200px in from the corner')
    ok(good.x === bad.x && good.y === bad.y, 'zoom 1: correct and broken agree — hence the bug survived')
  }

  // At 50% the broken version reports DOUBLE the true distance.
  {
    const el = fakeEl({ scale: 0.5, screenX: 100, screenY: 50 })
    // A point 100 screen-px right of the corner is 200 layout-px in.
    const good = localPoint(el, 200, 150)
    ok(good.x === 200 && good.y === 200, 'zoom 0.5: 100 screen px → 200 layout px')
    ok(broken(el, 200, 150).x === 100, '…where the broken version said 100 — half the truth')
  }

  // At 200% the broken version reports HALF.
  {
    const el = fakeEl({ scale: 2, screenX: 100, screenY: 50 })
    const good = localPoint(el, 300, 250)
    ok(good.x === 100 && good.y === 100, 'zoom 2: 200 screen px → 100 layout px')
    ok(broken(el, 300, 250).x === 200, '…where the broken version said 200 — double')
  }

  /* The error grows with distance from the corner, which is exactly the
     reported symptom: fine near the top-left, badly off further in. */
  {
    const el = fakeEl({ scale: 0.5, screenX: 0, screenY: 0 })
    const nearCorner = Math.abs(localPoint(el, 10, 10).x - broken(el, 10, 10).x)
    const farCorner = Math.abs(localPoint(el, 250, 250).x - broken(el, 250, 250).x)
    ok(farCorner > nearCorner * 10, 'the error grows with distance from the corner, as reported')
  }
}

console.log('\n localPoint — corners are exact at every zoom')
{
  for (const scale of [0.25, 0.5, 1, 1.5, 2, 3]) {
    const el = fakeEl({ w: 400, h: 300, scale, screenX: 37, screenY: 91 })
    const r = el.getBoundingClientRect()
    const tl = localPoint(el, r.left, r.top)
    const br = localPoint(el, r.right, r.bottom)
    ok(near(tl.x, 0) && near(tl.y, 0), `zoom ${scale}: top-left maps to (0, 0)`)
    ok(near(br.x, 400) && near(br.y, 300), `zoom ${scale}: bottom-right maps to the LAYOUT size, not the visual one`)
  }
}

console.log('\n localPoint — outside the element')
{
  const el = fakeEl({ scale: 0.5, screenX: 100, screenY: 100 })
  const before = localPoint(el, 50, 50)
  ok(before.x < 0 && before.y < 0, 'a point above and left reports negative coordinates, not clamped')
  // Clamping here would silently swallow a drag that starts off the element.
}

console.log('\n localPoint — defensive')
ok(localPoint(null, 10, 10).x === 0, 'null element')
{
  const el = fakeEl({ scale: 1, screenX: 0, screenY: 0 })
  ok(localPoint(el, undefined, undefined).x === 0, 'undefined coordinates become 0 rather than NaN')
  ok(localPoint(el, 'abc', null).y === 0, 'non-numeric coordinates become 0')
  ok(Number.isFinite(localPoint(el, NaN, NaN).x), 'NaN coordinates do not propagate')
}

console.log('\n localPointFromEvent')
{
  const el = fakeEl({ scale: 0.5, screenX: 100, screenY: 50 })
  const p = localPointFromEvent(el, { clientX: 200, clientY: 150 })
  ok(p.x === 200 && p.y === 200, 'reads clientX/clientY off an event')
  ok(localPointFromEvent(el, null).x === -200, 'a null event is treated as (0,0) on screen, not a crash')
}

/* ── measurement ─────────────────────────────────────────────────────── */
console.log('\n localSize — why measurement must NOT use getBoundingClientRect')
{
  const el = fakeEl({ w: 520, h: 620, scale: 0.4 })
  const size = localSize(el)
  ok(size.w === 520 && size.h === 620, 'reports LAYOUT size regardless of zoom')

  const visual = el.getBoundingClientRect()
  ok(visual.width === 208, '…where getBoundingClientRect would have said 208')
  /* Measuring a PDF page container with the scaled number makes fit-to-width
     compute a scale for a box 40% of the real size, so the page renders
     tiny — a quiet, plausible-looking wrongness rather than a crash. */
  ok(size.w !== visual.width, 'the two genuinely differ, which is the whole point')

  ok(localSize(null).w === 0, 'null element')
  ok(localSize({}).w === 0, 'an element with no offsetWidth reports 0 rather than NaN')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
