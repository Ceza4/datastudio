/*
  tests/recognise.test.mjs
  --------------------------------------------------------------------------
  The smart pen recogniser.

  STROKES ARE SYNTHESISED, AND SEEDED. Every stroke here is generated from one
  deterministic PRNG, so a failure is reproducible and a tolerance change
  shows up as a diff rather than as flakiness. Hand-captured strokes would be
  more realistic and completely untunable.

  HALF THIS FILE IS ABOUT REFUSAL, and that is the right ratio. A recogniser
  that turns every stroke into something is worse than one that declines,
  because a wrong snap destroys what you drew and a declined one costs
  nothing. So: scribbles, arcs, figure-eights, handwriting, ticks and taps all
  have to come back null. The tick case matters most — a V and an arrowhead
  are the same gesture at different scales, and getting it wrong makes every
  check mark you draw explode into an arrow.
  -------------------------------------------------------------------------- */

import {
  recognise, tryArrowGroup, strokeFeatures, resample, dedupe,
  pathLength, straightness, corners, bboxOf, RECOGNISE_DEFAULTS,
  explain, rdp, closedVertices, fitError,
} from '../lib/recognise.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
const near = (a, b, eps = 1) => Math.abs(a - b) <= eps

/* One seeded generator for the whole file. */
let seed = 20260820
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
const jitter = amp => (rnd() - 0.5) * 2 * amp
const reseed = () => { seed = 20260820 }

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** A hand-drawn straight line: n samples with perpendicular wobble. */
function strokeLine(a, b, n = 40, amp = 1.5) {
  const out = []
  for (let i = 0; i < n; i++) {
    const p = lerp(a, b, i / (n - 1))
    out.push({ x: p.x + jitter(amp), y: p.y + jitter(amp) })
  }
  return out
}

/** A hand-drawn closed loop. `wobble` is radial noise, `gap` leaves the ends
 *  slightly apart the way a real hand does. */
function strokeEllipse(cx, cy, rx, ry, n = 90, amp = 3, sweep = 1.0) {
  const out = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2 * sweep - Math.PI / 2
    out.push({ x: cx + Math.cos(t) * (rx + jitter(amp)), y: cy + Math.sin(t) * (ry + jitter(amp)) })
  }
  return out
}

/** Walk a polygon's perimeter with wobble; `overshoot` re-draws a little past
 *  the start, which is what a real closed stroke does. */
function strokePoly(pts, per = 22, amp = 2.5, overshoot = 0.12) {
  const out = []
  const loop = [...pts, pts[0]]
  for (let s = 0; s < loop.length - 1; s++) {
    for (let i = 0; i < per; i++) {
      const p = lerp(loop[s], loop[s + 1], i / per)
      out.push({ x: p.x + jitter(amp), y: p.y + jitter(amp) })
    }
  }
  const n = Math.round(per * overshoot)
  for (let i = 0; i < n; i++) {
    const p = lerp(loop[0], loop[1], i / per)
    out.push({ x: p.x + jitter(amp), y: p.y + jitter(amp) })
  }
  return out
}

/** Shaft then a barb back along it — one stroke, pen never lifted. */
function strokeArrow(a, b, barb = 0.22, amp = 1.5) {
  const shaft = strokeLine(a, b, 44, amp)
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const len = Math.hypot(b.x - a.x, b.y - a.y) * barb
  const tail = { x: b.x - Math.cos(ang - 0.5) * len, y: b.y - Math.sin(ang - 0.5) * len }
  return [...shaft, ...strokeLine(b, tail, 12, amp)]
}

console.log('\n primitives')
{
  reseed()
  ok(dedupe([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }]).length === 2,
     'duplicate points are dropped — a pointer at rest emits dozens and they make every angle NaN')
  ok(dedupe([{ x: 0, y: 0 }, { x: NaN, y: 2 }]).length === 1, 'and non-finite points with them')
  ok(near(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5, 0.001), 'path length')
  const rs = resample(strokeLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 7, 0), 64)
  ok(rs.length === 64, 'resample hits the requested count exactly')
  const gaps = rs.slice(1).map((p, i) => Math.hypot(p.x - rs[i].x, p.y - rs[i].y))
  ok(Math.max(...gaps) - Math.min(...gaps) < 0.5,
     'and spaces them evenly — turn angles over RAW samples measure hand speed, not curvature')
  ok(resample([{ x: 1, y: 1 }], 64).length === 1, 'a single point survives resampling without looping forever')
  ok(near(straightness(strokeLine({ x: 0, y: 0 }, { x: 200, y: 0 }, 40, 0)), 0, 0.01), 'a perfect line is perfectly straight')
  ok(corners(resample(strokePoly([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], 22, 0, 0), 64)).length >= 3,
     'a square has corners')
  ok(bboxOf([{ x: 5, y: 9 }, { x: 1, y: 2 }]).w === 4, 'bbox')
}

console.log('\n lines')
{
  reseed()
  const r = recognise(strokeLine({ x: 10, y: 10 }, { x: 210, y: 90 }))
  ok(r && r.kind === 'line', 'a wobbly straight stroke is a line')
  ok(r.confidence > RECOGNISE_DEFAULTS.minConfidence, 'and is confident enough to commit')
  ok(near(r.shape.x, 10, 4) && near(r.shape.y, 10, 4), 'starting where the stroke started')

  const flat = recognise(strokeLine({ x: 0, y: 100 }, { x: 300, y: 104 }))
  ok(flat.shape.h === 0, 'a nearly-horizontal line SNAPS to horizontal — the whole point of a smart pen')
  const vert = recognise(strokeLine({ x: 50, y: 0 }, { x: 46, y: 260 }))
  ok(vert.shape.w === 0, 'and a nearly-vertical one to vertical')
  const diag = recognise(strokeLine({ x: 0, y: 0 }, { x: 200, y: 196 }))
  ok(near(Math.abs(diag.shape.w), Math.abs(diag.shape.h), 0.01), 'and a near-45 one to exactly 45')
  const odd = recognise(strokeLine({ x: 0, y: 0 }, { x: 200, y: 60 }))
  ok(!near(Math.abs(odd.shape.w), Math.abs(odd.shape.h), 1) && odd.shape.h !== 0,
     'a line at a genuinely odd angle is LEFT at that angle rather than yanked to the nearest 45')
}

console.log('\n circles and ellipses')
{
  reseed()
  const c = recognise(strokeEllipse(100, 100, 60, 66))
  ok(c && c.kind === 'ellipse', 'a wobbly loop is an ellipse')
  ok(near(c.shape.w, c.shape.h, 0.01),
     'and a nearly-round one comes back EXACTLY round — returning a good ellipse for a bad circle is the failure case')
  ok(near(c.shape.x + c.shape.w / 2, 100, 8), 'centred where it was drawn')

  const e = recognise(strokeEllipse(200, 100, 110, 40))
  ok(e && e.kind === 'ellipse', 'a deliberately flat loop is still an ellipse')
  ok(e.shape.w > e.shape.h * 1.8, 'and KEEPS its shape rather than being rounded up into a circle')
}

console.log('\n polygons')
{
  reseed()
  const sq = recognise(strokePoly([{ x: 0, y: 0 }, { x: 120, y: 4 }, { x: 116, y: 122 }, { x: -3, y: 118 }]))
  ok(sq && sq.kind === 'rect', 'a wobbly box is a rectangle')
  ok(near(sq.shape.w, sq.shape.h, 1), 'and a nearly-square one comes back square')
  ok(sq.shape.rot === 0, 'a nearly-upright box is FORCED upright — nobody asked for a 3-degree tilt')

  reseed()
  const wide = recognise(strokePoly([{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 260, y: 90 }, { x: 0, y: 90 }]))
  ok(wide && wide.kind === 'rect' && wide.shape.w > wide.shape.h * 2, 'a wide box stays wide')

  reseed()
  const tri = recognise(strokePoly([{ x: 60, y: 0 }, { x: 120, y: 110 }, { x: 0, y: 110 }]))
  ok(tri && tri.kind === 'triangle', 'three corners is a triangle')

  reseed()
  const dia = recognise(strokePoly([{ x: 60, y: 0 }, { x: 120, y: 60 }, { x: 60, y: 120 }, { x: 0, y: 60 }]))
  ok(dia && dia.kind === 'diamond',
     'corners at the box EDGES is a diamond, not a rectangle — the two are the same four-corner count')
}

console.log('\n arrows')
{
  reseed()
  const a = recognise(strokeArrow({ x: 0, y: 0 }, { x: 220, y: 60 }))
  ok(a && a.kind === 'arrow', 'a shaft with a barb on the end is an arrow')
  ok(near(a.shape.x, 0, 5) && near(a.shape.y, 0, 5), 'anchored at the tail')
  ok(Math.hypot(a.shape.w, a.shape.h) > 180, 'and as long as the shaft, not as long as the whole stroke')

  /* THE FALSE POSITIVE THAT MATTERS. A tick is a short leg and a long one:
     the same gesture as an arrowhead, at a different ratio. If this ever
     comes back as an arrow, every check mark anyone draws explodes. */
  reseed()
  const tick = [...strokeLine({ x: 0, y: 40 }, { x: 30, y: 70 }, 16, 1), ...strokeLine({ x: 30, y: 70 }, { x: 90, y: 0 }, 30, 1)]
  const t = recognise(tick)
  ok(!t || t.kind !== 'arrow', 'a TICK is not an arrow — the barb has to be short relative to the shaft')
}

console.log('\n refusal — the half that protects your handwriting')
{
  reseed()
  ok(recognise([{ x: 5, y: 5 }, { x: 6, y: 6 }]) === null, 'a tap is not a shape')
  ok(recognise([]) === null && recognise(null) === null, 'empty and null input, without throwing')
  ok(recognise(strokeLine({ x: 0, y: 0 }, { x: 8, y: 8 })) === null,
     'a stroke shorter than minLength is refused — a speck must not become a line')

  reseed()
  ok(recognise(strokeEllipse(100, 100, 60, 60, 90, 3, 0.5)) === null,
     'a half loop is an ARC and stays ink — neither open enough for a line nor closed enough for a shape')

  reseed()
  const eight = [...strokeEllipse(80, 60, 40, 40), ...strokeEllipse(80, 140, 40, 40)]
  ok(recognise(eight) === null,
     'a figure of eight is refused — its SIGNED turning cancels to about zero even though it is closed')

  reseed()
  const scribble = []
  for (let i = 0; i < 260; i++) scribble.push({ x: 60 + Math.sin(i / 2) * 50 + jitter(9), y: 60 + i * 0.5 + jitter(9) })
  ok(recognise(scribble) === null, 'a scribble is refused')

  reseed()
  /* A lowercase cursive "e": closed-ish, but far too much absolute turning. */
  const letter = []
  for (let i = 0; i < 70; i++) {
    const t = i / 69
    letter.push({ x: 40 + Math.sin(t * 7) * 22 + jitter(1), y: 40 + t * 46 + Math.cos(t * 9) * 12 + jitter(1) })
  }
  ok(recognise(letter) === null, 'a handwritten letter is refused')
}

console.log('\n tryArrowGroup — the only rule that looks across strokes')
{
  const line = { id: 'l', kind: 'line', x: 0, y: 0, w: 200, h: 0, rot: 0 }
  const head = strokeLine({ x: 200, y: 0 }, { x: 176, y: -14 }, 10, 0.5)

  const g = tryArrowGroup(line, head, 200)
  ok(g && g.kind === 'arrow', 'a short stroke on the head of a fresh line turns it into an arrow')
  ok(g.id === line.id && g.w === line.w, 'in place — same id, same geometry, so undo and selection survive')

  ok(tryArrowGroup(line, head, 5000) === null, 'but not after the window has passed')
  ok(tryArrowGroup(line, strokeLine({ x: 200, y: 0 }, { x: 20, y: -90 }, 30, 0.5), 200) === null,
     'and not for a stroke too long to be a head')
  ok(tryArrowGroup(line, strokeLine({ x: 0, y: 0 }, { x: -20, y: -14 }, 10, 0.5), 200) === null,
     'nor one at the TAIL — an arrow has one head and it is at the end')

  /* THE CASE THAT WAS ACTUALLY WORRIED ABOUT: circle, then immediately a
     line. It fails on the first condition, before anything is measured. */
  const circle = { id: 'c', kind: 'ellipse', x: 0, y: 0, w: 80, h: 80, rot: 0 }
  ok(tryArrowGroup(circle, head, 50) === null,
     'a stroke right after a CIRCLE never groups — grouping requires the previous shape to be linear')
  ok(tryArrowGroup(null, head, 50) === null, 'and there is nothing to group with when nothing was drawn')
}

console.log('\n features are exposed for tuning')
{
  reseed()
  const f = strokeFeatures(strokeEllipse(50, 50, 40, 40))
  ok(f.closure < 0.2, 'a loop has low closure')
  ok(strokeFeatures(strokeLine({ x: 0, y: 0 }, { x: 200, y: 0 })).closure > 0.9, 'a line has high closure')
  ok(strokeFeatures([{ x: 0, y: 0 }]) === null, 'and a degenerate stroke has no features rather than fake ones')
}

console.log('\n the confidence gate')
{
  reseed()
  const stroke = strokeLine({ x: 0, y: 0 }, { x: 200, y: 40 })
  ok(recognise(stroke) !== null, 'a clear line is recognised at the default threshold')
  ok(recognise(stroke, { minConfidence: 0.99 }) === null,
     'and refused when the bar is raised — minConfidence is ENFORCED, not decorative')
  ok(recognise(stroke, { minConfidence: 0 }) !== null, 'and lowering it lets everything through')
}

console.log('\n boxes are boxes — the regression that shipped')
{
  /* A CLEAN RECTANGLE CAME BACK A TRIANGLE. Every time, deterministically.

     corners() measured turning over a +/-3 sample window and skipped the
     first and last three samples; on a closed stroke one corner always sits
     at the start/end join, in exactly that blind spot. So a box reported
     three corners and the cascade routed it to the triangle branch.

     The tests did not catch it because the box they drew OVERSHOT past its
     own start, which manufactured the missing fourth corner. The data had
     been shaped, unconsciously, until it agreed with the code. So these
     strokes are built the way a hand actually draws: tremor, rounded
     corners, and crucially the cases that do NOT overshoot. */
  const handBox = ({ w = 200, h = 140, tremor = 2, round = 0, overshoot = 0, gap = 0, samples = 260 }) => {
    const corners4 = [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
    const pts = []
    const per = Math.floor(samples / 4)
    for (let s2 = 0; s2 < 4; s2++) {
      const [x1, y1] = corners4[s2], [x2, y2] = corners4[s2 + 1]
      for (let i = 0; i < per; i++) {
        const t = i / per
        let x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t
        const near = Math.min(t, 1 - t)
        if (round > 0 && near < 0.12) {
          const pull = (1 - near / 0.12) * round
          x += (w / 2 - x) * pull * 0.06
          y += (h / 2 - y) * pull * 0.06
        }
        const ph = (s2 * per + i) / samples * Math.PI * 2
        pts.push({ x: x + Math.sin(ph * 3) * tremor + jitter(0.6), y: y + Math.cos(ph * 2.3) * tremor + jitter(0.6) })
      }
    }
    if (gap > 0) pts.splice(pts.length - Math.round(per * gap))
    if (overshoot > 0) for (let i = 0; i < Math.round(per * overshoot); i++) pts.push({ x: w * (i / per), y: jitter(1) })
    return pts
  }

  const boxCases = [
    ["a clean box, no overshoot", {}],
    ["with a light tremor", { tremor: 3 }],
    ["with a heavy tremor", { tremor: 6 }],
    ["with rounded corners, as nobody draws a right angle", { round: 1 }],
    ["rounded AND shaky", { round: 1, tremor: 4 }],
    ["drawn past its own start", { overshoot: 0.25 }],
    ["with the pen lifted early", { gap: 0.18 }],
    ["with a big gap left open", { gap: 0.4 }],
    ["a small one", { w: 70, h: 55, tremor: 2 }],
    ["a tall thin one", { w: 60, h: 220 }],
    ["and one with every one of those at once", { tremor: 4, round: 1, overshoot: 0.12, gap: 0.08 }],
  ]
  for (const [label, opts] of boxCases) {
    reseed()
    const r = recognise(handBox(opts))
    ok(r && r.kind === "rect", "a box is a rectangle: " + label)
  }

  reseed()
  const r = recognise(handBox({ tremor: 3 }))
  ok(r.confidence > 0.8, "and it is confident about it, not scraping past the threshold")
}

console.log('\n ranking — every candidate scored by the same measure')
{
  reseed()
  const e = explain(strokePoly([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 90 }, { x: 0, y: 90 }]))
  ok(e.candidates.length >= 5, "a closed stroke is fitted as several different shapes, not routed to one")
  ok(e.candidates[0].err <= e.candidates[e.candidates.length - 1].err,
     "and they come back ranked, best first")
  ok(e.candidates.every(c => Number.isFinite(c.err)),
     "every candidate gets a real score — an Infinity here means a shape nothing can measure")
  /* The scores are COMPARABLE ACROSS SHAPES, which is the property the old
     cascade never had and could not have. */
  const kinds = new Set(e.candidates.map(c => c.kind))
  ok(kinds.size >= 3, "including candidates of genuinely different kinds")
}

console.log('\n vertices')
{
  const square = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 50, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 50 }]
  ok(rdp(square, 2).length === 5, "RDP keeps the corners of an open polyline and drops the points along its edges")
  ok(rdp([{ x: 0, y: 0 }, { x: 1, y: 1 }], 2).length === 2, "a two-point line survives")
  ok(rdp(null, 2).length === 0, "null does not throw")

  /* THE FIX FOR THE ORIGINAL BUG. A closed stroke is rotated to start at an
     extreme point before simplifying, because RDP anchors its first and last
     points and never removes them — so whichever sample happened to be first
     is treated as a vertex whether it is one or not. On a closed stroke that
     is wherever the pen touched down, usually mid-edge. */
  reseed()
  const boxPts = strokeFeatures(strokePoly([{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }, { x: 0, y: 100 }], 22, 1, 0)).pts
  ok(closedVertices(boxPts, 8).length === 4,
     "a closed box yields FOUR vertices — three was the bug, and it made every box a triangle")
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
