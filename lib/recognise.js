/*
  lib/recognise.js
  --------------------------------------------------------------------------
  Smart pen: one freehand stroke in, one clean shape out.

  Pure. No React, no DOM, no timers. Everything here is a function of a point
  array, which is what makes the hard part testable.

  THE HARD PART IS NOT RECOGNITION

  Recognition is cheap and always was: resample to 64 points, then a handful
  of least-squares fits and angle sums. It runs in well under a millisecond
  and will never be the bottleneck. The real questions are

    · WHEN does a stroke end and the next begin, and
    · what happens when we guess wrong

  and neither is solved in this file. The commit model — snap instantly on
  pen-up, offer "keep as drawn" for a few seconds — lives in the canvas,
  because it needs timers and undo. This file only ever answers "if this
  stroke IS a shape, which one, and how sure am I".

  The stated worry was: someone draws a circle and immediately draws a line.
  With per-stroke commit that case is free — the circle committed on pen-up
  and the line is a separate stroke with its own answer. The ONLY thing that
  looks across strokes is arrow grouping (tryArrowGroup), and it is
  deliberately narrow: the previous shape must be linear, the new stroke must
  be short, and it must start near that line's head. A line after a circle
  fails all three.

  CONFIDENCE IS A REFUSAL, NOT A SCORE. Below MIN_CONFIDENCE the answer is
  null and the ink stays ink. A smart pen that always guesses is worse than
  one that sometimes declines, because a wrong snap destroys what you drew and
  a declined one costs nothing.
  -------------------------------------------------------------------------- */

import {
  createShape, normaliseAngle, rotatePoint, distToSegment,
  centreOf, isLinear, outline, distToPolyline,
} from './shapes.js'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export const RECOGNISE_DEFAULTS = {
  /** Resample resolution. 64 is enough to see a corner and cheap enough to
   *  ignore; the numbers below are tuned against it, so changing it means
   *  re-tuning them. */
  samples: 64,
  /** Shorter than this and it is a tap or a speck, not a shape. World units. */
  minLength: 24,
  /** Below this the ink stays ink. */
  minConfidence: 0.55,
  /** A line within this many degrees of horizontal/vertical/45 snaps to it. */
  angleSnap: 7,
  /** A circle-ish ellipse whose sides are within this ratio becomes a true
   *  circle. Drawing a bad circle and getting a good ellipse is a failure. */
  circleRatio: 0.18,
  /** A box within this many degrees of axis-aligned is FORCED to axis-aligned
   *  rather than stored with a 3-degree rotation nobody asked for. */
  axisSnap: 8,
}

/* ── basics ───────────────────────────────────────────────────────────── */

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)

export function pathLength(pts) {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i])
  return n
}

/** Drop points closer together than `eps`. A pointermove stream at rest emits
 *  dozens of identical points, and they make every angle calculation NaN
 *  (atan2 of a zero vector) or wildly noisy. */
export function dedupe(pts, eps = 0.6) {
  const out = []
  if (!Array.isArray(pts)) return out
  for (const p of pts) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue
    if (!out.length || dist(out[out.length - 1], p) > eps) out.push({ x: p.x, y: p.y })
  }
  return out
}

/** Equidistant resample. Every downstream measure assumes uniform spacing:
 *  turn angles computed over raw pointer samples measure how FAST the hand
 *  moved as much as how sharply it turned. */
export function resample(pts, n) {
  if (pts.length < 2) return pts.slice()
  const total = pathLength(pts)
  if (total === 0) return [pts[0], pts[pts.length - 1]]
  const step = total / (n - 1)
  const out = [pts[0]]
  let acc = 0
  let prev = pts[0]
  for (let i = 1; i < pts.length; i++) {
    let d = dist(prev, pts[i])
    while (acc + d >= step && out.length < n - 1) {
      const t = (step - acc) / d
      prev = { x: prev.x + (pts[i].x - prev.x) * t, y: prev.y + (pts[i].y - prev.y) * t }
      out.push(prev)
      d = dist(prev, pts[i])
      acc = 0
    }
    acc += d
    prev = pts[i]
  }
  while (out.length < n) out.push(pts[pts.length - 1])
  return out
}

export function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Greatest perpendicular distance from the straight chord, as a FRACTION of
 *  the chord. Scale-free, so a small line and a large one are judged the same. */
export function straightness(pts) {
  const a = pts[0], b = pts[pts.length - 1]
  const chord = dist(a, b)
  if (chord < 1e-6) return Infinity
  let worst = 0
  for (const p of pts) worst = Math.max(worst, distToSegment(p.x, p.y, a.x, a.y, b.x, b.y))
  return worst / chord
}

/** Signed turn at each interior point, in degrees, over a smoothing window.
 *  The window is what separates a corner from hand tremor. */
export function turns(pts, win = 3) {
  const out = []
  for (let i = win; i < pts.length - win; i++) {
    const a = Math.atan2(pts[i].y - pts[i - win].y, pts[i].x - pts[i - win].x)
    const b = Math.atan2(pts[i + win].y - pts[i].y, pts[i + win].x - pts[i].x)
    let d = (b - a) * DEG
    while (d > 180) d -= 360
    while (d < -180) d += 360
    out.push({ i, deg: d })
  }
  return out
}

/**
 * TOTAL TURNING, over adjacent segments of a decimated polyline.
 *
 * This is deliberately NOT the sum of turns(). That one measures each turn
 * over a +/-win smoothing window, so every degree of rotation is counted `win`
 * times and the sum comes out around 3x the truth — a plain circle "turns"
 * 1000 degrees. Every threshold built on that number is then meaningless, and
 * it looks completely reasonable until you check one against a known shape.
 * That bug was here.
 *
 * Decimated because adjacent-segment angles on a hand-drawn stroke are mostly
 * tremor. Total turning is invariant to decimation for a smooth curve, so
 * dropping every other point costs nothing and removes most of the noise from
 * the ABSOLUTE figure — which is the one that has to separate a single loop
 * from a figure of eight.
 */
export function turning(pts, stride = 2) {
  const p = pts.filter((_, i) => i % stride === 0)
  if (p.length < 3) return { signed: 0, absolute: 0 }
  let signed = 0, absolute = 0
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x)
    const b = Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x)
    let d = (b - a) * DEG
    while (d > 180) d -= 360
    while (d < -180) d += 360
    signed += d
    absolute += Math.abs(d)
  }
  return { signed, absolute }
}

/**
 * How far a closed stroke is from being an ellipse, as a dimensionless mean.
 *
 * Normalising by the bounding box before measuring is what makes ONE test
 * work for a circle and for a long thin ellipse: in that frame both are the
 * unit circle. 0 is perfect. A square scores about 0.19, because its corners
 * sit 41% further out than its edge midpoints — which is exactly the number
 * that separates "round" from "boxy" without needing to count corners at all.
 */
export function ellipseError(pts, box) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  const rx = (box.w / 2) || 1, ry = (box.h / 2) || 1
  let e = 0
  for (const p of pts) e += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1)
  return e / pts.length
}

/**
 * Corner indices: local maxima of |turn| above `min`, with non-maximum
 * suppression so one physical corner spread over several samples counts once.
 */
export function corners(pts, min = 42, suppress = 6) {
  const t = turns(pts)
  const peaks = []
  for (const { i, deg } of t) {
    if (Math.abs(deg) < min) continue
    const clash = peaks.find(p => Math.abs(p.i - i) <= suppress)
    if (!clash) peaks.push({ i, deg })
    else if (Math.abs(deg) > Math.abs(clash.deg)) { clash.i = i; clash.deg = deg }
  }
  return peaks.sort((a, b) => a.i - b.i)
}

/* ── features ─────────────────────────────────────────────────────────── */

export function strokeFeatures(raw, opts = {}) {
  const o = { ...RECOGNISE_DEFAULTS, ...opts }
  const clean = dedupe(raw)
  if (clean.length < 2) return null
  const len = pathLength(clean)
  if (len < o.minLength) return null

  const pts = resample(clean, o.samples)
  const box = bboxOf(pts)
  const gap = dist(pts[0], pts[pts.length - 1])

  const t = turning(pts)

  return {
    pts, len, box,
    ellipseErr: ellipseError(pts, box),
    /* 0 = ends meet (closed), 1 = ends are a whole path apart (open). The
       single most useful number in the file. */
    closure: gap / len,
    gap,
    straight: straightness(pts),
    signedTurn: t.signed,
    absTurn: t.absolute,
    corners: corners(pts),
    /* How much of its bounding box the stroke fills. Separates a fat blob
       from a thin scribble that happens to span the same area. */
    density: len / (2 * (box.w + box.h) || 1),
  }
}

/* ── fitting helpers ──────────────────────────────────────────────────── */

/** Rotate every point about a centre, then take the axis-aligned bbox. Used
 *  to fit a rotated rectangle without any min-area-rectangle machinery. */
function boxInFrame(pts, cx, cy, deg) {
  return bboxOf(pts.map(p => rotatePoint(p.x, p.y, cx, cy, -deg)))
}

/** The dominant straight-edge direction of a closed stroke, folded into
 *  [-45, 45): a square has four edges 90 degrees apart and any of them is an
 *  equally good answer, so they must all fold to the same number. */
function dominantAngle(pts) {
  let bx = 0, by = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y
    const a = Math.atan2(dy, dx) * 4          // x4 folds 90 into 360
    const w = Math.hypot(dx, dy)
    bx += Math.cos(a) * w
    by += Math.sin(a) * w
  }
  return (Math.atan2(by, bx) * DEG) / 4
}

function snapLine(a, b, tolDeg) {
  const len = dist(a, b)
  let deg = Math.atan2(b.y - a.y, b.x - a.x) * DEG
  const snapped = Math.round(deg / 45) * 45
  if (Math.abs(normaliseAngle(deg - snapped)) <= tolDeg) deg = snapped
  return { x: a.x + Math.cos(deg * RAD) * len, y: a.y + Math.sin(deg * RAD) * len }
}

const clamp01 = v => Math.min(1, Math.max(0, v))
/** Map an error against a tolerance onto 0..1. err = 0 is certain, err = tol
 *  is the edge of acceptable. */
const score = (err, tol) => clamp01(1 - err / tol)

/* ── the recogniser ───────────────────────────────────────────────────── */

/*
  FIT AND RANK, NOT A CASCADE OF THRESHOLDS.

  The first version of this file was a decision tree: check closure, then
  count corners, then branch. It failed in the most embarrassing way available
  — a clean, four-sided box came back a TRIANGLE, every time — and the reason
  is worth writing down, because it is a whole class of bug rather than one
  mistake.

  corners() measured turning over a +/-3 sample window and therefore SKIPPED
  the first and last three samples. On a closed stroke one corner always sits
  at the start/end join, in exactly that blind spot. So a rectangle reliably
  reported three corners and fell into the triangle branch. One bad gate, and
  a cascade has no way to notice it was wrong — there is no second opinion
  anywhere in it.

  Worse, the unit tests passed. They drew boxes that OVERSHOT past their own
  start, which manufactured the missing fourth corner. The test data had been
  shaped, unconsciously, until it agreed with the code.

  So the structure changed rather than the numbers:

    1. Build every candidate shape the stroke could plausibly be — the same
       stroke fitted as a circle, an ellipse, a square, a rectangle (axis
       aligned AND rotated), a diamond, a triangle, a line, an arrow.
    2. Score every one of them with the SAME measure: the mean distance from
       the stroke's own points to that candidate's outline, divided by the
       bounding-box diagonal. Dimensionless, so a 40px doodle and a 900px
       sketch are judged on the same scale, and — critically — the scores are
       COMPARABLE ACROSS SHAPES, which nothing in the old design was.
    3. Take the best one. Refuse if even the best is a poor fit.

  A single bad feature can now only make one candidate score badly; it cannot
  route the whole stroke into the wrong branch. That is the actual fix.

  This is the PaleoSketch shape of the problem (fit primitives, rank by a
  goodness measure) rather than the $1-recogniser shape of it. $1 and its
  family are excellent at answering "which template is this" and cannot answer
  "and where exactly is the circle", which is the half a smart pen needs in
  order to draw the clean version.
*/

/** Ramer-Douglas-Peucker: the dominant vertices of a polyline. */
export function rdp(pts, eps) {
  if (!pts || pts.length < 3) return pts ? pts.slice() : []
  let worst = 0, idx = 0
  const a = pts[0], b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i].x, pts[i].y, a.x, a.y, b.x, b.y)
    if (d > worst) { worst = d; idx = i }
  }
  if (worst <= eps) return [a, b]
  const left = rdp(pts.slice(0, idx + 1), eps)
  const right = rdp(pts.slice(idx), eps)
  return [...left.slice(0, -1), ...right]
}

/**
 * The dominant vertices of a CLOSED stroke.
 *
 * Rotating the polyline so it starts at the point furthest from the centroid
 * is what stops the start/end join from swallowing a corner. RDP anchors its
 * first and last points and never removes them, so whichever sample happens
 * to be first is treated as a vertex whether it is one or not — and on a
 * closed stroke that sample is wherever the pen happened to touch down, which
 * is usually the middle of an edge. Starting at an extreme point means the
 * anchor is a real corner.
 */
export function closedVertices(pts, eps) {
  if (pts.length < 4) return pts.slice()
  let cx = 0, cy = 0
  for (const p of pts) { cx += p.x; cy += p.y }
  cx /= pts.length; cy /= pts.length

  let start = 0, far = -1
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - cx, pts[i].y - cy)
    if (d > far) { far = d; start = i }
  }
  const rotated = [...pts.slice(start), ...pts.slice(0, start)]
  rotated.push(rotated[0])                      // close it
  const v = rdp(rotated, eps)
  v.pop()                                       // drop the duplicated closing point
  return v
}

/* ── one error measure, used for every candidate ─────────────────────── */

/** A shape's outline as world-space points, rotation applied. */
function outlineWorld(s) {
  const c = centreOf(s)
  const spin = pts => s.rot ? pts.map(p => rotatePoint(p.x, p.y, c.x, c.y, s.rot)) : pts

  if (isLinear(s.kind)) return { pts: [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }], closed: false }
  if (s.kind === 'ellipse') {
    const rx = s.w / 2, ry = s.h / 2
    const pts = []
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2
      pts.push({ x: c.x + Math.cos(t) * rx, y: c.y + Math.sin(t) * ry })
    }
    return { pts: spin(pts), closed: true }
  }
  return { pts: spin(outline(s)), closed: true }
}

/**
 * How far the stroke sits from a candidate, as a fraction of its diagonal.
 *
 * Dimensionless on purpose: a 40px doodle and a 900px sketch are judged on
 * the same scale, and — the part that matters — a circle's score and a
 * rectangle's score mean the same thing and can be compared directly.
 */
export function fitError(pts, shape, diag) {
  const o = outlineWorld(shape)
  if (o.pts.length < 2) return Infinity
  let sum = 0
  for (const p of pts) sum += distToPolyline(p.x, p.y, o.pts, o.closed)
  return sum / pts.length / (diag || 1)
}

/* ── candidate construction ──────────────────────────────────────────── */

function boxCandidates(f, style, o) {
  const out = []
  const { box } = f
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  const side = (box.w + box.h) / 2

  const push = (kind, opts, why, regular = false) => {
    try { out.push({ kind, shape: createShape(kind, { ...opts, ...style }), why, regular }) } catch { /* degenerate */ }
  }

  /* Axis-aligned, as drawn and forced square. The square variant exists
     because a hand-drawn square should come back square for the same reason a
     hand-drawn circle should come back round — and because letting the
     SCORING decide is more honest than an aspect-ratio threshold guessing on
     its behalf. If the stroke really is oblong, the oblong fits better and
     wins on its own. */
  push('rect', { ...box }, 'closed, boxy')
  push('rect', { x: cx - side / 2, y: cy - side / 2, w: side, h: side }, 'closed, square', true)
  push('ellipse', { ...box }, 'closed, elliptical')
  push('ellipse', { x: cx - side / 2, y: cy - side / 2, w: side, h: side }, 'closed, round', true)
  push('diamond', { ...box }, 'closed, diamond')

  /* Rotated rectangle, in the frame of the stroke's own dominant edge. */
  const ang = dominantAngle(f.pts)
  if (Math.abs(ang) > o.axisSnap) {
    const frame = boxInFrame(f.pts, cx, cy, ang)
    const rside = (frame.w + frame.h) / 2
    push('rect', { ...frame, rot: normaliseAngle(ang) }, 'closed, boxy, rotated')
    push('rect', {
      x: frame.x + (frame.w - rside) / 2, y: frame.y + (frame.h - rside) / 2,
      w: rside, h: rside, rot: normaliseAngle(ang),
    }, 'closed, square, rotated', true)
  }

  /* TRIANGLES: PROPOSE ALL THREE ORIENTATIONS, LET THE SCORE CHOOSE.

     The model's triangle is canonical — apex at the top of its box — so a
     triangle drawn at any other angle has to be rotated into place, which
     means knowing which vertex is the apex.

     Guessing "the vertex furthest from the centre" was wrong, and wrong in a
     way that looked obviously right: for an apex-up triangle the two BASE
     corners sit at the corners of the bounding box and are therefore further
     from its centre than the apex is. It picked a base corner every time, and
     the resulting triangle scored 0.19 — a worse fit than a rectangle over
     the same stroke, so triangles were refused outright.

     The fix is to stop guessing. Build one candidate per vertex and let the
     same measure that ranks everything else decide, which is the whole point
     of the design. Three extra fits is nothing. */
  const verts = closedVertices(f.pts, Math.max(3, Math.hypot(box.w, box.h) * 0.045))
  if (verts.length === 3) {
    /* The vertex centroid, not the bounding box centre: it is where the
       triangle actually balances, so the apex angle is stable under a wobbly
       edge that stretches the box. */
    const gx = (verts[0].x + verts[1].x + verts[2].x) / 3
    const gy = (verts[0].y + verts[1].y + verts[2].y) / 3
    for (const v of verts) {
      const rot = normaliseAngle(Math.atan2(v.y - gy, v.x - gx) * DEG + 90)
      const upright = Math.abs(rot) <= o.axisSnap
      const frame = upright ? box : boxInFrame(f.pts, cx, cy, rot)
      push('triangle', {
        x: upright ? box.x : frame.x, y: upright ? box.y : frame.y,
        w: frame.w, h: frame.h, rot: upright ? 0 : rot,
      }, 'closed, three sides')
    }
  }
  return out
}

/**
 * PURE FIT IS NOT ENOUGH, and this is the one place a bias is deliberate.
 *
 * Ranking by fit alone always prefers the more faithful candidate, so a
 * hand-drawn circle that came out 122x134 is fitted better by a 122x134
 * ELLIPSE than by a circle — and "you drew a bad circle, here is a good
 * ellipse" is precisely the failure the feature exists to prevent. The tidy
 * answer has to be allowed to win when it is nearly as good.
 *
 * So a regular candidate — a true circle, a true square — gets a discount on
 * its error. It wins ties and near-ties and loses outright to a shape that is
 * genuinely oblong, because a 3:1 rectangle fits its stroke enormously better
 * than a square does and no discount this size closes that gap.
 *
 * Read it as a RATIO rather than a magic number: at 0.60 the tidy form wins
 * unless the untidy one fits more than about 1.67x better. A 10%-oblong
 * circle fits its ellipse ~1.6x better, so it rounds; a 110x40 ellipse fits
 * ~13x better, so it stays an ellipse. The margin between those two cases is
 * enormous, which is why one number covers both without balancing on a knife
 * edge.
 *
 * This is a beautification preference, not a measurement, which is why it is
 * one named number rather than scattered aspect-ratio thresholds.
 */
const REGULAR_BONUS = 0.60

/** Ranked candidates, best first. Exported for tuning — see explain(). */
export function rankShapes(f, style, o) {
  const diag = Math.hypot(f.box.w, f.box.h) || 1
  const cands = buildCandidates(f, style, o)
  return cands
    .map(c => {
      const err = fitError(f.pts, c.shape, diag)
      return { ...c, err, score: err * (c.regular ? REGULAR_BONUS : 1) }
    })
    .sort((a, b) => a.score - b.score)
}

/** Every candidate and its score, refusal or not. For tests and tuning. */
export function explain(raw, opts = {}) {
  const o = { ...RECOGNISE_DEFAULTS, ...opts }
  const f = strokeFeatures(raw, o)
  if (!f) return { features: null, candidates: [] }
  return { features: f, candidates: rankShapes(f, { color: null, size: 2 }, o) }
}

/**
 * @returns {{kind, shape, confidence, why}|null}
 *   null means "this is not a shape I am willing to guess at" — the caller
 *   keeps the ink exactly as drawn.
 */
export function recognise(raw, opts = {}) {
  const o = { ...RECOGNISE_DEFAULTS, ...opts }
  const f = strokeFeatures(raw, o)
  if (!f) return null

  const style = { color: opts.color ?? null, size: opts.size ?? 2 }
  const ranked = rankShapes(f, style, o)
  if (!ranked.length) return null
  const best = ranked[0]

  /* Refuse a poor best. The only threshold left that decides WHETHER to snap
     rather than which shape to snap to — a dozen tuned gates collapsed into
     one, which is most of why this version is easier to trust. Calibrated in
     tests/recognise.test.mjs; move it and re-run that file. */
  const LIMIT = 0.062
  if (best.err > LIMIT) return null

  const confidence = clamp01(1 - best.err / LIMIT) * 0.45 + 0.5
  if (confidence < o.minConfidence) return null
  return { kind: best.kind, shape: best.shape, confidence, why: best.why, features: f, error: best.err }
}

/** Every shape this stroke could plausibly be. Scoring decides between them. */
function buildCandidates(f, style, o) {
  const cands = []

  if (f.closure > 0.45) {
    /* Open. A line and an arrow are the only honest readings of an open
       stroke; an arc or half a letter must stay ink. */
    const a = f.pts[0]
    const b = snapLine(a, f.pts[f.pts.length - 1], o.angleSnap)
    try {
      cands.push({
        kind: 'line', why: 'straight and open',
        shape: createShape('line', { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, ...style }),
      })
    } catch { /* zero-length */ }
    const arrow = fitArrow(f, o, style)
    if (arrow) cands.push({ kind: 'arrow', shape: arrow.shape, why: arrow.why })
  } else if (f.closure < 0.40) {
    /* Closed. Refuse the shapes that are closed but are not ONE loop before
       spending any effort fitting them.

       A closed shape goes round once: ~360 degrees of signed turning, less
       after decimation and hand noise, so the floor is empirical. A figure of
       eight sums to about zero because its loops turn opposite ways; a double
       loop to about 720. */
    const turnTotal = Math.abs(f.signedTurn)
    if (turnTotal < 215 || turnTotal > 520) return []
    /* And signed turning alone cannot see a loop retraced with a wobble: a
       stroke can sum to 360 having rotated back and forth for 1500 degrees
       getting there. That is a scribble. */
    if (f.absTurn > turnTotal * 2.2 + 260) return []
    cands.push(...boxCandidates(f, style, o))
  } else {
    /* Neither open nor shut — an arc, a hook, half a letter. Refuse. */
    return []
  }

  return cands
}

/* ── arrows ───────────────────────────────────────────────────────────── */

/**
 * A one-stroke arrow: a long straight shaft, then a sharp reversal into a
 * short barb. Drawn without lifting the pen, which is how most people do it.
 *
 * The barb must be SHORT relative to the shaft, or a plain V — a tick, a
 * check mark, the letter A — turns into an arrow, and that is the most
 * annoying false positive available in this feature.
 */
function fitArrow(f, o, style) {
  const cs = f.corners
  if (!cs.length) return null

  const sharp = cs.filter(c => Math.abs(c.deg) > 95 && c.i > f.pts.length * 0.45)
  if (!sharp.length) return null
  const tipIdx = sharp[sharp.length - 1].i

  const shaft = f.pts.slice(0, tipIdx + 1)
  const barb = f.pts.slice(tipIdx)
  if (shaft.length < 8 || barb.length < 3) return null

  const shaftLen = pathLength(shaft), barbLen = pathLength(barb)
  if (barbLen > shaftLen * 0.42) return null      // a V, not an arrow
  if (straightness(shaft) > 0.11) return null     // a hook, not a shaft

  const a = shaft[0]
  const b = snapLine(a, shaft[shaft.length - 1], o.angleSnap)
  return {
    shape: createShape('arrow', { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, ...style }),
    confidence: score(straightness(shaft), 0.11) * 0.5 + 0.4,
    why: 'straight shaft with a barb at the end',
  }
}

export const ARROW_GROUP_MS = 900

/**
 * The ONLY cross-stroke rule: a short stroke landing on the head of a line
 * that was just committed turns that line into an arrow.
 *
 * Narrow on purpose. Three independent conditions have to hold, and the case
 * everyone worries about — a circle followed immediately by a line — fails
 * the first one before anything else is even measured.
 *
 * @param prev  the shape committed by the previous stroke
 * @param raw   the new stroke's points
 * @param age   milliseconds since `prev` was committed
 */
export function tryArrowGroup(prev, raw, age, opts = {}) {
  const o = { ...RECOGNISE_DEFAULTS, ...opts }
  if (!prev || prev.kind !== 'line') return null
  if (!(age >= 0) || age > (o.groupMs ?? ARROW_GROUP_MS)) return null

  const pts = dedupe(raw)
  if (pts.length < 2) return null

  const shaftLen = Math.hypot(prev.w, prev.h)
  const len = pathLength(pts)
  if (len > shaftLen * 0.5) return null           // too big to be a head

  const head = { x: prev.x + prev.w, y: prev.y + prev.h }
  /* Tolerance scales with the shaft: on a 40px line "near the head" is a few
     pixels, on a 600px one it is tens. A fixed radius is wrong at both ends. */
  const near = Math.max(14, shaftLen * 0.22)
  const startsNear = dist(pts[0], head) < near
  const endsNear = dist(pts[pts.length - 1], head) < near
  if (!startsNear && !endsNear) return null

  return { ...prev, kind: 'arrow' }
}
