/*
  tests/shapes.test.mjs
  --------------------------------------------------------------------------
  The shape model.

  WHY THIS FILE EXISTS, AND WHAT IT IS REALLY GUARDING

  Every assertion about ROTATION here passes trivially while rot is 0. That is
  the trap this suite exists for: a shape layer built and tested before
  rotation ships looks completely healthy, and is wrong by up to 41% on the
  diagonal the day someone rotates something. shapeBounds, resizeShape and
  hitShape each have a rot-0 path that is correct and a rotated path that has
  to be derived — so each is tested at an angle, deliberately, including one
  case (`resize does not slide`) that already caught a real inverted-sign bug
  in resizeShape before this file was finished.

  The other headline case is `a diagonal is not its bounding box`. That single
  assertion is the entire argument for why a shape is not a block: the point
  it tests sits comfortably inside the arrow's rectangle and nowhere near the
  arrow. A DOM element cannot fail that test, because the browser dispatches
  on the box.
  -------------------------------------------------------------------------- */

import {
  SHAPE_KINDS, isLinear, createShape, newShapeId, normaliseAngle,
  centreOf, rotatePoint, toLocal, corners, shapeBounds,
  distToSegment, hitShape, pointInPolygon, hitTolerance, pickShape, shapesInRect,
  moveShape, rotateShape, snapAngle, resizeShape, HANDLES,
  anchorPoint, shapePath, arrowHead, shapeTransform,
  createInk, inkPoints, inkPath, migrateInk, migrateInkOnSheet,
} from '../lib/shapes.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps
const nearPt = (p, x, y, eps = 0.01) => near(p.x, x, eps) && near(p.y, y, eps)

const rect = (o = {}) => createShape('rect', { x: 0, y: 0, w: 100, h: 100, ...o })
const arrow = (o = {}) => createShape('arrow', { x: 30, y: 30, w: 200, h: 120, ...o })

console.log('\n construction')
{
  ok(SHAPE_KINDS.length === 11, 'eleven kinds (Visuals added sticky, text, connector, mindmap) — adding one is a decision, not a tweak')
  ok(createShape('rect', { w: -80, h: 40 }).w === 80, 'a boxed kind normalises negative width — it has no meaning')
  ok(createShape('arrow', { w: -80 }).w === -80, 'a linear kind KEEPS negative width, or the arrowhead swaps ends')
  ok(createShape('arrow', { rot: 40 }).rot === 0, 'a linear kind ignores rot — the angle already lives in its endpoints')
  ok(createShape('rect', { rot: 400 }).rot === 40, 'rot is normalised on the way in')
  let threw = false
  try { createShape('hexagon') } catch (_) { threw = true }
  ok(threw, 'an unknown kind throws rather than producing a shape nothing can render')
  const ids = new Set(Array.from({ length: 500 }, newShapeId))
  ok(ids.size === 500, '500 ids generated in a tight loop are all distinct — Date.now() alone is not')
}

console.log('\n normaliseAngle')
{
  ok(normaliseAngle(0) === 0 && normaliseAngle(45) === 45, 'leaves an in-range angle alone')
  ok(normaliseAngle(180) === 180 && normaliseAngle(-180) === 180, '180 and -180 fold to the same value')
  ok(normaliseAngle(190) === -170, 'past a half turn comes back the other way')
  ok(normaliseAngle(360) === 0 && normaliseAngle(720) === 0, 'whole turns cancel')
  ok(Object.is(normaliseAngle(-360), 0), 'and produce +0, not -0')
  ok(normaliseAngle(NaN) === 0 && normaliseAngle(undefined) === 0, 'garbage becomes 0 rather than propagating NaN')
}

console.log('\n frames of reference')
{
  ok(nearPt(centreOf(rect()), 50, 50), 'centre of a box')
  ok(nearPt(rotatePoint(10, 0, 0, 0, 90), 0, 10), 'rotating 90 degrees is counted in DEGREES, not radians')
  ok(nearPt(toLocal(rect({ rot: 90 }), 50, 100), 100, 50), 'a world point maps into the shape’s own unrotated frame')
  ok(nearPt(toLocal(rect(), 7, 9), 7, 9), 'and is a no-op at rot 0, with no float drift')
  ok(corners(rect()).length === 4, 'four corners')
}

console.log('\n shapeBounds — the rotation trap')
{
  const b = shapeBounds(rect())
  ok(b.x === 0 && b.y === 0 && b.w === 100 && b.h === 100, 'unrotated bounds are just the box')
  const r = shapeBounds(rect({ rot: 45 }))
  ok(near(r.w, 141.42, 0.05) && near(r.h, 141.42, 0.05),
     'a square rotated 45 degrees needs 41% MORE room — using x/y/w/h directly is wrong by exactly this much')
  ok(near(centreOf(rect({ rot: 45 })).x, r.x + r.w / 2, 0.01), 'and stays centred on the same point')
  ok(near(shapeBounds(rect({ rot: 90 })).w, 100, 0.01), 'a square at 90 degrees is the same size again')
  const neg = shapeBounds(createShape('arrow', { x: 100, y: 100, w: -60, h: -40 }))
  ok(neg.x === 40 && neg.y === 60 && neg.w === 60 && neg.h === 40, 'a backwards arrow still has forwards bounds')
}

console.log('\n distToSegment')
{
  ok(distToSegment(0, 5, 0, 0, 10, 0) === 5, 'perpendicular distance')
  ok(distToSegment(20, 0, 0, 0, 10, 0) === 10,
     'a point past the END measures to the endpoint — the infinite-line version reports a hit off the tip of every arrow')
  ok(distToSegment(3, 0, 3, 3, 3, 3) === 3, 'a zero-length segment degrades to point distance instead of dividing by zero')
}

console.log('\n hitShape — a diagonal is not its bounding box')
{
  const a = arrow()                       // (30,30) -> (230,150)
  ok(hitShape(a, 130, 90, 6), 'the midpoint of the arrow is a hit')
  ok(hitShape(a, 30, 30, 6) && hitShape(a, 230, 150, 6), 'both endpoints are hits')
  ok(!hitShape(a, 240, 160, 6), 'just past the head is a miss')

  /* THE ASSERTION THIS WHOLE MODEL EXISTS FOR. (210,45) is inside the arrow's
     bounding rectangle and about 95px from the arrow. A div cannot tell the
     difference, because its box IS its hit area. */
  const b = shapeBounds(a)
  const inBox = 210 >= b.x && 210 <= b.x + b.w && 45 >= b.y && 45 <= b.y + b.h
  ok(inBox && !hitShape(a, 210, 45, 6),
     'a point INSIDE the bounding box but far from the line is a miss — the block model cannot do this')
}

console.log('\n hitShape — outline vs fill')
{
  const r = rect()
  ok(hitShape(r, 0, 50, 6) && hitShape(r, 100, 50, 6), 'an unfilled rectangle is hit on its edges')
  ok(!hitShape(r, 50, 50, 6),
     'and NOT in its empty middle — otherwise a large shape becomes a lid over everything under it')
  ok(hitShape(rect({ fill: '#fff' }), 50, 50, 6), 'a FILLED rectangle is hit anywhere inside, because that is what fill means')

  const e = createShape('ellipse', { x: 0, y: 0, w: 100, h: 100 })
  ok(hitShape(e, 0, 50, 6), 'an ellipse is hit on its ring')
  ok(!hitShape(e, 50, 50, 6), 'and not through its middle')
  ok(!hitShape(e, 96, 96, 6), 'nor in the corner of its box, which is outside the ellipse entirely')

  const t = createShape('triangle', { x: 0, y: 0, w: 100, h: 100 })
  ok(!hitShape(t, 4, 4, 6), 'the top-left corner of a triangle’s box is outside the triangle')
  ok(hitShape(t, 50, 100, 6), 'its base is a hit')

  const d = createShape('diamond', { x: 0, y: 0, w: 100, h: 100 })
  ok(!hitShape(d, 4, 4, 6) && hitShape(d, 25, 25, 6), 'a diamond is hit on its slanted edge, not in its box corner')
}

console.log('\n hitShape — rotated')
{
  const r = rect({ rot: 45 })
  ok(hitShape(r, 50, -20, 8), 'the rotated top corner is where the shape actually is')
  ok(!hitShape(r, 4, 4, 6), 'and the UNROTATED corner is now empty space')
}

console.log('\n hitTolerance')
{
  ok(hitTolerance(1) === 6, 'at 100% zoom the tolerance is the screen tolerance')
  ok(hitTolerance(0.25) === 24, 'zoomed out 4x it grows 4x — a 2px line is half a pixel on screen and otherwise unselectable')
  ok(hitTolerance(2) === 3, 'zoomed in it shrinks, so precision improves rather than staying blunt')
  ok(hitTolerance(0.01) === 36, 'clamped, so at extreme zoom-out the canvas is not one giant hit area')
  ok(hitTolerance(0) === 6 && hitTolerance(NaN) === 6, 'a zero or NaN zoom falls back rather than dividing by it')
}

console.log('\n pickShape / shapesInRect')
{
  const a = rect({ id: 'a' }), b = rect({ id: 'b' })
  ok(pickShape([a, b], 0, 50, 6).id === 'b', 'the topmost shape wins — later shapes paint over earlier ones')
  ok(pickShape([a, b], 900, 900, 6) === null, 'empty space picks nothing')

  const inside = rect({ id: 'in', x: 10, y: 10, w: 50, h: 50 })
  const spill = rect({ id: 'out', x: 10, y: 10, w: 50, h: 50, rot: 45 })
  ok(shapesInRect([inside], { x: 0, y: 0, w: 100, h: 100 }).length === 1, 'a contained shape is marquee-selected')
  ok(shapesInRect([spill], { x: 0, y: 0, w: 70, h: 70 }).length === 0,
     'a ROTATED shape that spills past the marquee is not — marquee must use rotated bounds')
  ok(shapesInRect([inside], { x: 100, y: 100, w: -100, h: -100 }).length === 1,
     'a marquee dragged up-and-left works, rather than selecting nothing')
}

console.log('\n transforms')
{
  ok(moveShape(rect(), 5, -5).x === 5, 'move')
  ok(rotateShape(rect({ rot: 350 }), 20).rot === 10, 'rotate wraps')
  ok(rotateShape(arrow(), 20).rot === 0, 'rotating a linear kind is a no-op, not a corrupt shape')
  ok(snapAngle(2) === 0 && snapAngle(44) === 45, 'a near-multiple snaps')
  ok(snapAngle(37) === 37, 'and one that is genuinely off-grid is left alone')
}

console.log('\n resizeShape')
{
  const r = resizeShape(rect(), 'e', 150, 0)
  ok(r.w === 150 && r.x === 0, 'dragging east grows the width and leaves the left edge')
  const n = resizeShape(rect(), 'nw', 20, 30)
  ok(n.x === 20 && n.y === 30 && n.w === 80 && n.h === 70, 'dragging north-west moves the origin and shrinks both sides')
  const flip = resizeShape(rect(), 'e', -40, 0)
  ok(flip.x === -40 && flip.w === 40, 'dragging past the opposite edge FLIPS the shape rather than inverting its width')
  const min = resizeShape(rect(), 'e', 1, 0, { min: 20 })
  ok(min.w === 20, 'a minimum size is respected')

  const a = resizeShape(arrow(), 'se', 300, 300)
  ok(a.w === 270 && a.h === 270, 'a linear kind resizes by moving its HEAD')
  ok(resizeShape(arrow(), 'n', 0, 0).w === arrow().w, 'and ignores handles it does not have')

  /* THE ONE THAT CAUGHT A REAL BUG. The centre correction was inverted: at
     rot 0 everything passed, and at any other angle the shape slid away
     under the cursor while being resized. */
  const rot = rect({ rot: 30 })
  const grown = resizeShape(rot, 'e', 200, 50)
  const cb = centreOf(rot), cg = centreOf(grown)
  const moved = Math.hypot(cg.x - cb.x, cg.y - cb.y)
  ok(grown.w > rot.w, 'a rotated shape still grows when you drag its east handle')
  ok(near(moved, (grown.w - rot.w) / 2, 0.5),
     'and its centre moves by exactly half the growth, along the shape’s OWN axis — it does not slide')
  ok(HANDLES.length === 8, 'eight handles')
}

console.log('\n anchorPoint — why shapes are not blocks')
{
  const r = rect()
  ok(nearPt(anchorPoint(r, 500, 50), 100, 50, 0.5), 'a connector from the right lands on the right edge')
  ok(nearPt(anchorPoint(r, 50, -500), 50, 0, 0.5), 'from above, on the top edge')

  const e = createShape('ellipse', { x: 0, y: 0, w: 100, h: 100 })
  const d = anchorPoint(e, 500, 500)
  ok(near(Math.hypot(d.x - 50, d.y - 50), 50, 0.5),
     'on a circle it lands on the CURVE at 45 degrees, not on the corner of the box — 50 from centre, not 70.7')

  const t = createShape('triangle', { x: 0, y: 0, w: 100, h: 100 })
  const ta = anchorPoint(t, 500, 0)
  ok(ta.x < 100, 'on a triangle it lands on the slanted edge, which no bounding-box version can find')

  const rr = anchorPoint(rect({ rot: 45 }), 500, 50)
  ok(near(rr.x, 50 + 70.71, 1), 'and it follows the shape when the shape is rotated')
  ok(nearPt(anchorPoint(createShape('rect', { x: 0, y: 0, w: 0, h: 0 }), 10, 10), 0, 0),
     'a degenerate shape returns its centre instead of looping forever')
}

console.log('\n rendering')
{
  ok(shapePath(rect()).startsWith('M 0 0') && shapePath(rect()).endsWith('Z'), 'a boxed path is closed')
  ok(!shapePath(arrow()).includes('Z'), 'a linear path is not')
  ok(shapePath(createShape('ellipse', { w: 100, h: 60 })).includes('a 50 30'), 'an ellipse uses arcs, not a rounded box')
  ok(arrowHead(arrow()).length === 3, 'an arrowhead is two barbs and a tip')
  ok(shapeTransform(rect()) === undefined,
     'no transform attribute at rot 0 — so React drops it and the DOM stays clean under a memo diff')
  ok(shapeTransform(rect({ rot: 30 })) === 'rotate(30 50 50)', 'and rotates about the centre when there is an angle')
  ok(pointInPolygon(5, 5, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), 'point in polygon')
}

console.log('\n ink — a freehand stroke is a shape like any other')
{
  /* A stroke the recogniser declined is still data on the canvas, so it gets
     the same verbs as every other shape. The storage decision is what makes
     that affordable: points are normalised to the unit square, so move,
     resize and rotate touch four numbers and never the points array. */
  const raw = [{ x: 100, y: 50 }, { x: 150, y: 90 }, { x: 200, y: 50 }]
  const ink = createInk({ points: raw, color: "#f00", size: 3 })

  ok(ink.kind === "ink" && ink.x === 100 && ink.y === 50 && ink.w === 100 && ink.h === 40,
     'the box comes from the points\u2019 own bounds')
  ok(ink.points.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
     'and the points are stored as fractions of it, never as world coordinates')
  ok(inkPoints(ink).every((p, i) => near(p.x, raw[i].x, 0.001) && near(p.y, raw[i].y, 0.001)),
     'mapping them back reproduces the original stroke exactly')

  /* The whole point of normalising. */
  const moved = moveShape(ink, 25, -10)
  ok(moved.points === ink.points,
     'moving REUSES the same points array \u2014 dragging a 400-point scribble costs what dragging a rectangle costs')
  ok(near(inkPoints(moved)[0].x, 125) && near(inkPoints(moved)[0].y, 40),
     'and the stroke lands where it was dragged to')

  const wide = resizeShape(ink, "e", 300, 0)
  ok(wide.w === 200 && near(inkPoints(wide)[2].x, 300),
     'resizing STRETCHES the stroke, because the points are fractions of the box')

  ok(hitShape(ink, 150, 90, 6), "a point on the stroke is a hit")
  ok(hitShape(ink, 125, 70, 6), "and so is one on the segment between samples")
  /* THE ASSERTION THE INK KIND EXISTS FOR. (150,55) sits comfortably inside
     the bounding box and roughly 30px from the ink. A box-based hit area
     would swallow it, and a loose sketch would eat every click near it. */
  const b = shapeBounds(ink)
  const inBox = 150 >= b.x && 150 <= b.x + b.w && 55 >= b.y && 55 <= b.y + b.h
  ok(inBox && !hitShape(ink, 150, 55, 6),
     'a point inside the BOX but away from the stroke is a miss \u2014 a scribble\u2019s box is mostly empty')

  /* Degenerate strokes. A perfectly flat line has zero height, and dividing
     by the raw extent would make every normalised y Infinity \u2014 the stroke
     would vanish instead of rendering flat. */
  const flat = createInk({ points: [{ x: 0, y: 10 }, { x: 60, y: 10 }] })
  ok(flat.h === 1 && flat.points.every(p => Number.isFinite(p.y)),
     'a perfectly flat stroke keeps finite points rather than dividing by zero')
  ok(hitShape(flat, 30, 10, 4), "and is still selectable")

  let threw = false
  try { createInk({ points: [{ x: 1, y: 1 }] }) } catch (_) { threw = true }
  ok(threw, "a one-point stroke is refused rather than stored as an unrenderable shape")
  ok(inkPoints({ points: null }).length === 0, "and a shape with no points maps to nothing, without throwing")

  ok(shapePath(ink).startsWith("M 100 50") && shapePath(ink).includes("Q"),
     'the path is smoothed with quadratics, the same as the strokes drawn before ink was a shape')
  ok(inkPath([]) === "" && inkPath(null) === "", "an empty path is empty, not malformed")

  /* Rotation goes through the same local-frame transform as every other
     kind, so it is tested at an angle for the same reason those are. */
  const turned = { ...ink, rot: 90 }
  /* Asserting the stroke is NOT hit at its old position is the naive version
     and it is wrong: a rotated scribble frequently still covers a point it
     used to cover, purely by shape. The meaningful property is that the
     stroke follows the rotation — the point that was on it is now on it at
     the ROTATED position. */
  const wasOn = { x: 150, y: 90 }
  const nowOn = rotatePoint(wasOn.x, wasOn.y, 150, 70, 90)
  ok(hitShape(turned, nowOn.x, nowOn.y, 6),
     "a rotated stroke is hit at the rotated position of a point that was on it")
  ok(shapeTransform(turned) === "rotate(90 150 70)", "and rotates about the box centre")

  /* Straight down the middle from above. The centre of this stroke's box is
     NOT on the stroke, which is the case the generic ray-bisection cannot
     handle — it used to return the centre, pointing a connector at empty
     space inside the box. */
  const anchor2 = anchorPoint(ink, 150, -500)
  ok(hitShape(ink, anchor2.x, anchor2.y, 2),
     'a connector to a stroke lands ON the stroke, not in the empty middle of its box')
  /* Approached from directly above, the two nearest points on this V are
     its two top ends, exactly tied. Either is a correct answer, so the
     assertion is that it landed on the TOP of the stroke rather than which
     of the two arms won a tie-break. */
  ok(near(anchor2.y, 50, 1),
     'and on the side it was approached from')
}

console.log('\n migrating old strokes into ink')
{
  const stroke = { id: "d1", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: "#0f0", size: 4 }
  const sheet = { id: "s", blocks: [], drawings: [stroke] }
  const out = migrateInkOnSheet(sheet)
  ok(out.shapes.length === 1 && out.shapes[0].kind === "ink", "a legacy drawing becomes an ink shape")
  ok(out.shapes[0].id === "d1", "keeping its id, so anything holding a reference still resolves")
  ok(out.shapes[0].color === "#0f0" && out.shapes[0].size === 4, "and its colour and weight")
  ok(out.drawings.length === 0, "and the old array is emptied rather than left as a second copy")

  /* THE IDENTITY RULE. This runs over every sheet of every notebook on every
     boot; returning a fresh object when nothing changed would make React
     treat the whole workspace as new and hand the autosave a "changed"
     workspace on every single load. */
  const clean = { id: "s2", blocks: [], shapes: [] }
  ok(migrateInkOnSheet(clean) === clean, "a sheet with no drawings comes back IDENTICAL, not merely equal")
  ok(migrateInkOnSheet({ id: "s3", drawings: [] }).drawings.length === 0, "an empty drawings array is also a no-op")
  ok(migrateInkOnSheet(null) === null, "and null passes through without throwing")

  const nbs = [{ id: "n", sheets: [sheet] }]
  const migrated = migrateInk(nbs)
  ok(migrated[0].sheets[0].shapes.length === 1, "the whole-notebook form works")
  const cleanNbs = [{ id: "n", sheets: [clean] }]
  ok(migrateInk(cleanNbs) === cleanNbs, "and is identity-stable all the way up when there is nothing to migrate")
  ok(migrateInk(null) === null && migrateInk(undefined) === undefined, "garbage in, same garbage out, no throw")

  /* Order matters — what was on top stays on top. */
  const both = { id: "s4", shapes: [createShape("rect", { id: "r" })], drawings: [stroke] }
  const merged = migrateInkOnSheet(both)
  ok(merged.shapes[0].id === "r" && merged.shapes[1].id === "d1",
     "strokes are appended AFTER existing shapes, preserving what was drawn over what")

  const broken = migrateInkOnSheet({ id: "s5", drawings: [{ id: "bad", points: [{ x: 1, y: 1 }] }] })
  ok(broken.shapes.length === 0 && broken.drawings.length === 0,
     "a one-point stroke is dropped rather than carried along as an unrenderable leftover")
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
