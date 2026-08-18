/*
  tests/pdfspace.test.mjs
  --------------------------------------------------------------------------
  Coordinate conversion.

  This is the one part of the PDF work that can be proved correct without a
  browser, and it's also the part every annotation tool will depend on — so
  it's worth proving thoroughly rather than discovering a half-inch drift
  after five tools are built on top of it.

  The transform is a port of pdf.js's PageViewport. The assertions below check
  it against values derived independently: known corner mappings, round trips,
  and the rotation behaviour reasoned out from first principles rather than
  from the same code being tested.
  -------------------------------------------------------------------------- */

import {
  makeViewport, toScreenSpace, toPdfSpace, rectToScreen, rectToPdf,
  applyMatrix, invertMatrix, normalizeRotation, fitScale, clampScale,
  canvasSizeFor, textItemRect, MIN_SCALE, MAX_SCALE, MAX_CANVAS_PIXELS,
} from '../lib/pdfspace.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol
const nearPt = (p, x, y, tol = 1e-6) => near(p.x, x, tol) && near(p.y, y, tol)

// A4 portrait in points, the common case.
const A4 = [0, 0, 595.28, 841.89]

/* ── matrix primitives ───────────────────────────────────────────────── */
console.log('\n matrix')
{
  const identity = [1, 0, 0, 1, 0, 0]
  ok(applyMatrix(identity, 3, 4).join() === '3,4', 'identity is a no-op')
  const translate = [1, 0, 0, 1, 10, 20]
  ok(applyMatrix(translate, 1, 2).join() === '11,22', 'translation')

  const inv = invertMatrix(translate)
  const [bx, by] = applyMatrix(inv, 11, 22)
  ok(near(bx, 1) && near(by, 2), 'inverse undoes the transform')
  ok(invertMatrix([0, 0, 0, 0, 0, 0]) === null, 'a degenerate matrix returns null rather than NaN')
  ok(invertMatrix([1, 2, 2, 4, 0, 0]) === null, 'a singular matrix (det 0) returns null')
}

/* ── rotation normalisation ──────────────────────────────────────────── */
console.log('\n normalizeRotation')
ok(normalizeRotation(0) === 0 && normalizeRotation(90) === 90, 'passes valid values through')
ok(normalizeRotation(360) === 0, '360 wraps to 0')
ok(normalizeRotation(450) === 90, '450 wraps to 90')
ok(normalizeRotation(-90) === 270, 'negative rotation wraps forward')
ok(normalizeRotation(45) === 0, 'a non-multiple of 90 falls back to 0 rather than throwing mid-render')
ok(normalizeRotation('90') === 90, 'numeric string coerced')
ok(normalizeRotation(null) === 0 && normalizeRotation(undefined) === 0 && normalizeRotation(NaN) === 0, 'junk falls back to 0')

/* ── viewport, unrotated ─────────────────────────────────────────────── */
console.log('\n viewport — no rotation')
{
  const vp = makeViewport({ viewBox: A4, scale: 1 })
  ok(near(vp.width, 595.28) && near(vp.height, 841.89), 'unscaled size matches the viewBox')

  // The y-flip is the whole point. PDF y=0 is the BOTTOM of the page.
  ok(nearPt(toScreenSpace({ x: 0, y: 0 }, vp), 0, 841.89), 'PDF origin (bottom-left) maps to screen bottom-left')
  ok(nearPt(toScreenSpace({ x: 0, y: 841.89 }, vp), 0, 0), 'PDF top-left maps to screen (0,0)')
  ok(nearPt(toScreenSpace({ x: 595.28, y: 841.89 }, vp), 595.28, 0), 'PDF top-right maps to screen top-right')
  ok(nearPt(toScreenSpace({ x: 297.64, y: 420.945 }, vp), 297.64, 420.945), 'the centre maps to the centre')

  const vp2 = makeViewport({ viewBox: A4, scale: 2 })
  ok(near(vp2.width, 1190.56), 'scale 2 doubles the width')
  ok(nearPt(toScreenSpace({ x: 100, y: 741.89 }, vp2), 200, 200), 'scale applies to both axes')
}

/* ── round trips ─────────────────────────────────────────────────────── */
console.log('\n round trips — every scale × every rotation')
{
  let worst = 0
  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [0.25, 0.5, 1, 1.5, 3, 5.75]) {
      const vp = makeViewport({ viewBox: A4, scale, rotation })
      for (const p of [{ x: 0, y: 0 }, { x: 595.28, y: 841.89 }, { x: 72, y: 769 }, { x: 300.5, y: 12.25 }]) {
        const back = toPdfSpace(toScreenSpace(p, vp), vp)
        worst = Math.max(worst, Math.abs(back.x - p.x), Math.abs(back.y - p.y))
      }
    }
  }
  ok(worst < 1e-9, `PDF → screen → PDF is lossless across 24 combinations (worst drift ${worst.toExponential(2)})`)
}

/* ── rotation ────────────────────────────────────────────────────────── */
console.log('\n rotation')
{
  const p = makeViewport({ viewBox: A4, scale: 1, rotation: 0 })
  const r90 = makeViewport({ viewBox: A4, scale: 1, rotation: 90 })
  const r180 = makeViewport({ viewBox: A4, scale: 1, rotation: 180 })
  const r270 = makeViewport({ viewBox: A4, scale: 1, rotation: 270 })

  ok(near(r90.width, p.height) && near(r90.height, p.width), '90° swaps width and height')
  ok(near(r270.width, p.height) && near(r270.height, p.width), '270° swaps width and height')
  ok(near(r180.width, p.width) && near(r180.height, p.height), '180° keeps the dimensions')

  // Reasoned independently: at 180° the page is upside down, so the PDF
  // bottom-left corner has to land at the screen TOP-right.
  ok(nearPt(toScreenSpace({ x: 0, y: 0 }, r180), 595.28, 0), '180°: PDF bottom-left → screen top-right')
  ok(nearPt(toScreenSpace({ x: 595.28, y: 841.89 }, r180), 0, 841.89), '180°: PDF top-right → screen bottom-left')

  // Every corner must land inside the rendered area, at every rotation. A
  // sign error typically parks one corner at a negative coordinate.
  for (const [name, vp] of [['0', p], ['90', r90], ['180', r180], ['270', r270]]) {
    const corners = [[0, 0], [595.28, 0], [0, 841.89], [595.28, 841.89]]
      .map(([x, y]) => toScreenSpace({ x, y }, vp))
    const inside = corners.every(c => c.x >= -1e-6 && c.y >= -1e-6 && c.x <= vp.width + 1e-6 && c.y <= vp.height + 1e-6)
    ok(inside, `${name}°: all four page corners land within the rendered bounds`,
       inside ? '' : JSON.stringify(corners))
    // And they must be four DISTINCT points — a collapsed axis means a lost dimension.
    const uniq = new Set(corners.map(c => `${c.x.toFixed(3)},${c.y.toFixed(3)}`))
    ok(uniq.size === 4, `${name}°: the four corners stay distinct`)
  }
}

/* ── offset viewBox ──────────────────────────────────────────────────── */
console.log('\n offset viewBox — pages that do not start at 0,0')
{
  /* Real documents do this constantly: cropped scans, imposed print files,
     anything produced by a layout tool with bleed. Assuming a 0,0 origin is
     the second most common way to get PDF coordinates wrong. */
  const vp = makeViewport({ viewBox: [20, 30, 620, 830], scale: 1 })
  ok(near(vp.width, 600) && near(vp.height, 800), 'size comes from the viewBox extent, not its far corner')
  ok(nearPt(toScreenSpace({ x: 20, y: 830 }, vp), 0, 0), 'the viewBox top-left maps to screen (0,0), not the PDF origin')
  ok(nearPt(toScreenSpace({ x: 620, y: 30 }, vp), 600, 800), 'the viewBox bottom-right maps to the far corner')
  const back = toPdfSpace({ x: 0, y: 0 }, vp)
  ok(nearPt(back, 20, 830), 'and it round-trips back to the offset origin')
}

/* ── rectangles ──────────────────────────────────────────────────────── */
console.log('\n rectangles')
{
  for (const rotation of [0, 90, 180, 270]) {
    const vp = makeViewport({ viewBox: A4, scale: 1.5, rotation })
    const pdfRect = { x: 72, y: 700, w: 200, h: 24 }
    const screen = rectToScreen(pdfRect, vp)
    ok(screen.w > 0 && screen.h > 0, `${rotation}°: a converted rect has positive width and height`)
    const back = rectToPdf(screen, vp)
    ok(near(back.x, pdfRect.x, 1e-6) && near(back.w, pdfRect.w, 1e-6),
       `${rotation}°: rect round-trips (x and w)`)
    ok(near(back.y, pdfRect.y, 1e-6) && near(back.h, pdfRect.h, 1e-6),
       `${rotation}°: rect round-trips (y and h)`)
  }
}

/* ── fitting ─────────────────────────────────────────────────────────── */
console.log('\n fitting')
ok(near(fitScale(600, 800, 300, 400, 'width'), 0.5), 'fit-width uses the width ratio')
ok(near(fitScale(600, 800, 300, 200, 'page'), 0.25), 'fit-page uses the tighter of the two')
ok(fitScale(600, 800, 300, 400, 'actual') === 1, 'actual size is always 1')
ok(fitScale(0, 0, 300, 400) === 1, 'a zero-size page does not divide by zero')
ok(fitScale(-5, 10, 100, 100) === 1, 'a negative page size falls back to 1')

ok(clampScale(0.001) === MIN_SCALE, 'zoom clamped at the bottom')
ok(clampScale(999) === MAX_SCALE, 'zoom clamped at the top')
ok(clampScale(NaN) === 1, 'NaN zoom falls back to 1')
ok(clampScale(2) === 2, 'a sane zoom passes through')

/* ── canvas sizing ───────────────────────────────────────────────────── */
console.log('\n canvas sizing')
{
  const vp = makeViewport({ viewBox: A4, scale: 1 })
  const s1 = canvasSizeFor(vp, 1)
  ok(s1.width === Math.floor(vp.width), 'at dpr 1 the canvas matches the CSS size')

  const s2 = canvasSizeFor(vp, 2)
  ok(s2.width === Math.floor(vp.width * 2), 'at dpr 2 the canvas is doubled, so text stays crisp on retina')

  ok(canvasSizeFor(vp, 8).width <= Math.floor(vp.width * 3), 'dpr is capped at 3 — nobody needs 8')
  ok(canvasSizeFor(vp, 0.5).width === Math.floor(vp.width), 'dpr below 1 is treated as 1')

  /* The cap is what stops a browser refusing to allocate. An A3 page at 600%
     on a retina screen is comfortably past every browser's limit. */
  const huge = makeViewport({ viewBox: [0, 0, 1190, 1684], scale: 6 })
  const cap = canvasSizeFor(huge, 3)
  ok(cap.width * cap.height <= MAX_CANVAS_PIXELS, 'an oversized page is scaled down below the pixel cap')
  ok(cap.width > 0 && cap.height > 0, '…and still has a usable size')
  ok(near(cap.width / cap.height, huge.width / huge.height, 0.01), '…with the aspect ratio preserved')
}

/* ── text items ──────────────────────────────────────────────────────── */
console.log('\n textItemRect — the baseline trap')
{
  /* pdf.js reports a text run's origin as its BASELINE left, not the top-left
     of a box. Treating it as top-left puts every highlight one line too low —
     and it looks almost right, which is why it survives review. */
  const item = { transform: [12, 0, 0, 12, 72, 700], width: 120, height: 12, str: 'Hello' }
  const r = textItemRect(item)
  ok(r.x === 72, 'x is the transform e component')
  ok(r.baselineY === 700, 'baselineY is the transform f component')
  ok(r.topY === 712, 'topY is the baseline PLUS the height — this is the one that gets missed')
  ok(r.w === 120 && r.h === 12, 'width and height read through')

  const noHeight = textItemRect({ transform: [10, 0, 0, 10, 5, 5], width: 50 })
  ok(noHeight.h === 10, 'a missing height falls back to the transform scale rather than 0')
  ok(textItemRect(null) === null, 'null item returns null')
  ok(textItemRect({}) === null, 'an item with no transform returns null')
}

/* ── defensive ───────────────────────────────────────────────────────── */
console.log('\n bad input')
{
  const vp = makeViewport({})
  ok(near(vp.width, 612) && near(vp.height, 792), 'no viewBox falls back to US Letter rather than NaN')
  ok(makeViewport({ viewBox: [0, 0] }).width === 612, 'a short viewBox falls back')
  ok(makeViewport({ viewBox: [0, 0, NaN, 100] }).width === 612, 'a NaN in the viewBox falls back')
  ok(makeViewport({ viewBox: A4, scale: 0 }).scale === 1, 'zero scale falls back to 1')
  ok(makeViewport({ viewBox: A4, scale: -2 }).scale === 1, 'negative scale falls back to 1')
  ok(makeViewport({ viewBox: A4, rotation: 45 }).rotation === 0, 'an invalid rotation falls back instead of throwing')

  const good = makeViewport({ viewBox: A4 })
  ok(nearPt(toScreenSpace(null, good), 0, 0), 'a null point converts to 0,0 rather than throwing')
  ok(nearPt(toScreenSpace({ x: 'abc', y: undefined }, good), 0, 841.89), 'non-numeric coordinates are treated as 0')
  ok(nearPt(toPdfSpace({ x: 0, y: 0 }, null), 0, 0), 'a null viewport does not throw')

  // userUnit — rare, but CAD and large-format exports use it.
  const uu = makeViewport({ viewBox: A4, scale: 1, userUnit: 2 })
  ok(near(uu.width, 595.28 * 2), 'userUnit multiplies the scale')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
