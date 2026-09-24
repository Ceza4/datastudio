/*
  lib/shapes.js
  --------------------------------------------------------------------------
  The shape model. Pure geometry — no React, no DOM, no canvas.

  WHY A SHAPE IS NOT A BLOCK

  A block is a box with content and a resize handle. That is enough for a
  table, a PDF or a note, and it is not enough for a drawn shape:

    · a diagonal has no rectangle. A 2px arrow across a 230x140 span has a
      bounding box roughly 56x larger than the shape inside it. If the box is
      the hit area — which it is, when the shape is a DOM element, because
      that is what the browser dispatches clicks on — then clicking empty
      space selects the arrow, and any marquee nearby catches it
    · shapes rotate. Blocks do not, and every axis-aligned assumption
      downstream (resize handles, snapping, marquee, getBoundingClientRect)
      is wrong the moment one does
    · connectors need to ask a shape where its edge is in a given direction.
      That is anchorPoint() below. There is nowhere to put it on a block

  Measured before committing to this: at 500 shapes a memoised SVG layer
  costs ~1.0ms of render+commit+layout per drag frame and does not grow with
  the shape count; a memoised div-per-shape layer costs ~1.5ms, grows, and
  carries ~15% more DOM. Performance was NOT the deciding factor — the spread
  is about 1ms — the hit testing and rotation were. Recorded so nobody
  re-runs the argument from the wrong premise.

  TWO CONVENTIONS, BOTH LOAD-BEARING

  1. ANGLES ARE DEGREES in the model, everywhere, because that is what CSS
     transforms, SVG transforms and the user all speak. Radians exist only
     inside a function body, never on a shape and never across a boundary.
     Mixed units is the classic silent geometry bug: everything renders, at
     the wrong angle, and the error is a factor of 57.
  2. `rot` IS ALWAYS ABOUT THE CENTRE of the unrotated box. Not the origin,
     not a handle. Rotating about anything else means position and angle stop
     being independent and every drag has to un-rotate first.

  TOLERANCES ARE IN WORLD UNITS, not screen pixels. The caller divides by the
  canvas zoom before passing one in — see hitTolerance(). At 0.25x a 2px line
  is half a pixel on screen, and a fixed pixel tolerance makes it impossible
  to select anything while zoomed out.
  -------------------------------------------------------------------------- */

import { createMindMap, mindmapBounds, nodeAt, nodeBox } from './mindmap.js'

/** Every kind the smart pen can produce. Adding one means: a branch in
 *  hitShape, one in shapePath, one in anchorPoint. Nowhere else. */
export const SHAPE_KINDS = ['line', 'arrow', 'rect', 'ellipse', 'triangle', 'diamond', 'ink',
  /* Builder → Visuals (24 Sep 2026). `sticky` and `text` are boxes that
     exist to hold words; `connector` is a line whose ends can be ATTACHED to
     shapes (`from` / `to` shape ids) and follow them; `mindmap` is a whole
     tree of topics in one shape, see lib/mindmap.js. */
  'sticky', 'text', 'connector', 'mindmap']

/** Kinds that carry a text label in `text`. */
export const LABELLED_KINDS = ['rect', 'ellipse', 'triangle', 'diamond', 'sticky', 'text']
export const isLabelled = kind => LABELLED_KINDS.includes(kind)
/** Kinds hit anywhere inside, fill or not: they are made to be clicked on. */
const SOLID_KINDS = ['sticky', 'text']

/* INK IS A SHAPE, NOT A SEPARATE SYSTEM.

   A freehand stroke the recogniser declined is still DATA — it is on the
   canvas showing something, permanently. So it gets the same verbs as every
   other shape: select, drag, resize, rotate, marquee, delete with undo. The
   alternative was a second `drawings` array with its own selection model,
   which is the "selected thing = block" problem repeating one level down.

   POINTS ARE STORED NORMALISED to the unit square, 0..1, alongside the box in
   x/y/w/h. Moving, resizing and rotating a stroke are then pure edits to four
   numbers and the points array is never touched — dragging a 400-point
   scribble costs exactly what dragging a rectangle costs. Rendering and hit
   testing map back through inkPoints().

   The alternative (absolute points, rewritten on every drag frame) allocates
   a new array of 400 objects per pointermove, per stroke, and puts all of it
   through the autosave. */

/** Kinds defined by two endpoints rather than by a box. They ignore `rot` —
 *  the angle is already in the endpoints, and storing it twice means the two
 *  can disagree. */
export const LINEAR_KINDS = ['line', 'arrow', 'connector']

export const isLinear = kind => LINEAR_KINDS.includes(kind)

const RAD = Math.PI / 180
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/* ── construction ─────────────────────────────────────────────────────── */

let seq = 0
export function newShapeId() {
  /* Date.now() alone is not unique: the recogniser can commit two shapes in
     the same millisecond when a stroke is split, and lib/persistence keys by
     id. Same lesson the workbook import learned the hard way. */
  seq = (seq + 1) % 1e6
  return `shape_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 7)}`
}

export function createShape(kind, opts = {}) {
  if (!SHAPE_KINDS.includes(kind)) throw new Error(`unknown shape kind: ${kind}`)
  if (kind === 'ink') return createInk(opts)
  if (kind === 'mindmap') return createMindMap({ ...opts, id: opts.id || newShapeId() })
  const w = Math.round(opts.w ?? 100)
  const h = Math.round(opts.h ?? 80)
  return {
    id: opts.id || newShapeId(),
    kind,
    x: Math.round(opts.x ?? 0),
    y: Math.round(opts.y ?? 0),
    /* Width and height are SIGNED for linear kinds — an arrow drawn
       right-to-left has a negative w, and normalising it here would silently
       reverse which end the head is on. Boxed kinds are normalised, because a
       rectangle with negative width has no meaning. */
    w: isLinear(kind) ? w : Math.abs(w),
    h: isLinear(kind) ? h : Math.abs(h),
    rot: isLinear(kind) ? 0 : normaliseAngle(opts.rot ?? 0),
    color: opts.color || null,   // null = take the theme accent at render time
    size: opts.size ?? 2,
    fill: opts.fill ?? null,
    /* Only written when present, so shapes that never had them stay the
       exact objects they were (snapshots, persistence diffs). */
    ...(opts.text != null ? { text: String(opts.text) } : {}),
    ...(kind === 'connector' ? { from: opts.from || null, to: opts.to || null } : {}),
  }
}

/**
 * Build an ink shape from a stroke in world coordinates.
 *
 * The box comes from the points' bounds; the points are then rewritten as
 * fractions of that box. A stroke drawn perfectly flat has zero height, so
 * the divisor is clamped to 1 — dividing by the raw extent would produce
 * Infinity for every point and the stroke would vanish rather than render
 * flat, which is the correct thing for it to do.
 */
export function createInk(opts = {}) {
  const raw = Array.isArray(opts.points) ? opts.points.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : []
  if (raw.length < 2) throw new Error('an ink shape needs at least two points')

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of raw) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.y < y0) y0 = p.y
    if (p.y > y1) y1 = p.y
  }
  const w = Math.max(1, x1 - x0)
  const h = Math.max(1, y1 - y0)

  return {
    id: opts.id || newShapeId(),
    kind: 'ink',
    x: x0, y: y0, w, h,
    rot: normaliseAngle(opts.rot ?? 0),
    color: opts.color || null,
    size: opts.size ?? 2,
    fill: null,                 // a stroke is never filled
    points: raw.map(p => ({ x: (p.x - x0) / w, y: (p.y - y0) / h })),
  }
}

/**
 * Move a sheet's legacy `drawings` into `shapes` as ink.
 *
 * Strokes used to live in their own array with no verbs — you could draw one
 * and then never touch it again. As ink shapes they get select, drag, resize,
 * rotate, marquee and delete-with-undo, all of which already existed for
 * shapes.
 *
 * RETURNS THE SAME OBJECT when there is nothing to do. That identity matters:
 * this runs over every sheet of every notebook on load, and returning a fresh
 * object each time would change the identity of the entire workspace, make
 * React treat all of it as new, and hand the autosave a "changed" workspace
 * on every single boot.
 *
 * Order is preserved — strokes are appended after existing shapes in the
 * order they were drawn, so what was on top stays on top.
 *
 * A stroke that cannot become a shape (fewer than two points) is DROPPED
 * rather than carried along as an unrenderable leftover. It could not be seen
 * before either.
 */
export function migrateInkOnSheet(sheet) {
  if (!sheet || !Array.isArray(sheet.drawings) || sheet.drawings.length === 0) return sheet
  const ink = []
  for (const d of sheet.drawings) {
    try {
      ink.push(createInk({ id: d?.id, points: d?.points, color: d?.color, size: d?.size }))
    } catch { /* degenerate stroke — it rendered as nothing before, too */ }
  }
  return { ...sheet, shapes: [...(sheet.shapes || []), ...ink], drawings: [] }
}

/** The same, across a whole notebook list. Same identity rule at every level. */
export function migrateInk(notebooks) {
  if (!Array.isArray(notebooks)) return notebooks
  let changedAny = false
  const out = notebooks.map(n => {
    if (!Array.isArray(n?.sheets)) return n
    let changed = false
    const sheets = n.sheets.map(sh => {
      const next = migrateInkOnSheet(sh)
      if (next !== sh) changed = true
      return next
    })
    if (!changed) return n
    changedAny = true
    return { ...n, sheets }
  })
  return changedAny ? out : notebooks
}

/** Normalised points mapped back into world space through the current box. */
export function inkPoints(s) {
  if (!s?.points?.length) return []
  return s.points.map(p => ({ x: s.x + p.x * s.w, y: s.y + p.y * s.h }))
}

/** Fold any angle into (-180, 180]. Keeps a shape rotated 15 times from
 *  carrying 5400 degrees around and losing float precision doing it. */
export function normaliseAngle(deg) {
  if (!Number.isFinite(deg)) return 0
  let a = deg % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return a === 0 ? 0 : a   // kill -0, which !== 0 in Object.is and in snapshots
}

/* ── frames of reference ──────────────────────────────────────────────── */

export const centreOf = s => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 })

/** Rotate (px,py) around (cx,cy) by `deg`. */
export function rotatePoint(px, py, cx, cy, deg) {
  if (!deg) return { x: px, y: py }
  const a = deg * RAD, cos = Math.cos(a), sin = Math.sin(a)
  const dx = px - cx, dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** World point -> the shape's own unrotated frame. Every hit test goes
 *  through here, so each kind only ever has to solve the axis-aligned case. */
export function toLocal(s, px, py) {
  if (!s.rot) return { x: px, y: py }
  const c = centreOf(s)
  return rotatePoint(px, py, c.x, c.y, -s.rot)
}

/** The four corners of the box, rotated, in world space. */
export function corners(s) {
  const c = centreOf(s)
  const pts = [
    [s.x, s.y], [s.x + s.w, s.y],
    [s.x + s.w, s.y + s.h], [s.x, s.y + s.h],
  ]
  return pts.map(([px, py]) => rotatePoint(px, py, c.x, c.y, s.rot))
}

/**
 * Axis-aligned world bounds, ROTATION INCLUDED.
 *
 * This is the function marquee selection, "zoom to fit" and any spatial index
 * must use. Using {x,y,w,h} directly is correct only while rot is 0, which is
 * exactly why it will pass every test written before rotation ships and be
 * wrong by up to 41% the day after.
 */
export function shapeBounds(s) {
  if (s.kind === 'mindmap') return mindmapBounds(s)
  if (!s.rot) {
    const x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h)
    return { x, y, w: Math.abs(s.w), h: Math.abs(s.h) }
  }
  const pts = corners(s)
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/* ── hit testing ──────────────────────────────────────────────────────── */

/** Shortest distance from a point to a line SEGMENT (not an infinite line —
 *  the infinite-line version reports a hit off the end of every arrow). */
export function closestOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: x1, y: y1 }
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1)
  return { x: x1 + t * dx, y: y1 + t * dy }
}

export function distToSegment(px, py, x1, y1, x2, y2) {
  const q = closestOnSegment(px, py, x1, y1, x2, y2)
  return Math.hypot(px - q.x, py - q.y)
}

export function distToPolyline(px, py, pts, closed) {
  let best = Infinity
  const n = pts.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n]
    best = Math.min(best, distToSegment(px, py, a.x, a.y, b.x, b.y))
  }
  return best
}

/** The outline points of a boxed kind, in LOCAL (unrotated) space. */
export function outline(s) {
  const { x, y, w, h } = s
  if (s.kind === 'triangle') return [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  if (s.kind === 'diamond')  return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }]
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
}

/**
 * Is (px,py) on this shape?
 *
 * `tol` is in WORLD units. An unfilled shape is hit on its OUTLINE, not in
 * its middle — that is what makes a large rectangle something you can draw
 * inside of rather than a lid over everything beneath it. A filled shape is
 * hit anywhere inside, because that is what a fill means.
 */
export function hitShape(s, px, py, tol = 6) {
  if (!s) return false

  if (isLinear(s.kind)) {
    return distToSegment(px, py, s.x, s.y, s.x + s.w, s.y + s.h) <= tol
  }

  /* A mind map is hit on its topics and their collapse toggles, not on the
     empty space its branches span. */
  if (s.kind === 'mindmap') return !!nodeAt(s, px, py, tol / 2)

  if (s.kind === 'ink') {
    /* Along the STROKE, not inside its bounding box. A scribble's box is
       mostly empty; treating the box as the hit area would make a loose
       sketch swallow every click near it — the same defect that made a
       diagonal arrow unusable as a div. */
    const p = toLocal(s, px, py)
    return distToPolyline(p.x, p.y, inkPoints(s), false) <= tol
  }

  const p = toLocal(s, px, py)

  if (s.kind === 'ellipse') {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2
    const inside = (rx, ry) => {
      if (rx <= 0 || ry <= 0) return false
      const nx = (p.x - cx) / rx, ny = (p.y - cy) / ry
      return nx * nx + ny * ny <= 1
    }
    if (s.fill) return inside(s.w / 2 + tol, s.h / 2 + tol)
    /* Between the two offset ellipses = on the ring. Note this is an
       approximation of true perpendicular distance and is slightly generous
       at the flat ends of a very eccentric ellipse. That errs toward
       selectable, which is the right direction to be wrong in. */
    return inside(s.w / 2 + tol, s.h / 2 + tol) && !inside(s.w / 2 - tol, s.h / 2 - tol)
  }

  const pts = outline(s)
  if (SOLID_KINDS.includes(s.kind)) return pointInPolygon(p.x, p.y, pts) || distToPolyline(p.x, p.y, pts, true) <= tol
  if (s.fill) return pointInPolygon(p.x, p.y, pts) || distToPolyline(p.x, p.y, pts, true) <= tol
  return distToPolyline(p.x, p.y, pts, true) <= tol
}

/** Even-odd ray casting. Used for filled shapes only. */
export function pointInPolygon(px, py, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y
    const crosses = (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/**
 * Screen tolerance -> world tolerance.
 *
 * Call this instead of passing a constant. At zoom 0.25 a 2px stroke is half
 * a pixel on screen: without scaling, selecting a line while zoomed out is
 * not hard, it is impossible. Clamped at the top so that at 0.1x the whole
 * canvas does not become one giant hit area.
 */
export function hitTolerance(zoom, screenPx = 6) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return Math.min(screenPx / z, screenPx * 6)
}

/** Topmost shape at a point, or null. Back to front: later shapes paint over
 *  earlier ones, so they must also be picked before them. */
export function pickShape(shapes, px, py, tol = 6) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (hitShape(shapes[i], px, py, tol)) return shapes[i]
  }
  return null
}

/** Every shape whose ROTATED bounds fall inside a marquee rectangle. */
export function shapesInRect(shapes, rect) {
  const x2 = rect.x + rect.w, y2 = rect.y + rect.h
  const lo = { x: Math.min(rect.x, x2), y: Math.min(rect.y, y2) }
  const hi = { x: Math.max(rect.x, x2), y: Math.max(rect.y, y2) }
  return shapes.filter(s => {
    const b = shapeBounds(s)
    return b.x >= lo.x && b.y >= lo.y && b.x + b.w <= hi.x && b.y + b.h <= hi.y
  })
}

/* ── transforms ───────────────────────────────────────────────────────── */

export const moveShape = (s, dx, dy) => ({ ...s, x: s.x + dx, y: s.y + dy })
export const rotateShape = (s, deg) => isLinear(s.kind) || s.kind === 'mindmap' ? s : { ...s, rot: normaliseAngle(s.rot + deg) }

/** Angle snapping for a rotation handle. Shift-free by default: people want
 *  0/45/90 far more often than 43. */
export function snapAngle(deg, step = 15, threshold = 4) {
  const snapped = Math.round(deg / step) * step
  return Math.abs(deg - snapped) <= threshold ? normaliseAngle(snapped) : normaliseAngle(deg)
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * Resize by dragging `handle` to the world point (px,py).
 *
 * The pointer is converted into the shape's local frame FIRST, so a rotated
 * shape resizes along its own axes — drag the east handle of a shape rotated
 * 30 degrees and it gets wider in the direction it is pointing, not eastward
 * on screen. Doing this in world space is the single most common way rotated
 * resize goes wrong, and it looks fine until the first non-zero angle.
 *
 * Boxed kinds are re-normalised at the end, so dragging a handle past the
 * opposite edge flips the shape rather than inverting its width.
 */
export function resizeShape(s, handle, px, py, opts = {}) {
  /* A mind map's size is its layout's; there is nothing to drag. */
  if (s.kind === 'mindmap') return s
  if (isLinear(s.kind)) {
    /* Linear kinds have no handles, they have ENDPOINTS. 'nw' is the tail,
       'se' is the head; nothing else moves them. */
    if (handle === 'nw') return { ...s, x: px, y: py, w: s.x + s.w - px, h: s.y + s.h - py }
    if (handle === 'se') return { ...s, w: px - s.x, h: py - s.y }
    return s
  }

  const p = toLocal(s, px, py)
  let { x, y, w, h } = s
  const right = x + w, bottom = y + h

  if (handle.includes('w')) { x = p.x; w = right - p.x }
  if (handle.includes('e')) { w = p.x - x }
  if (handle.includes('n')) { y = p.y; h = bottom - p.y }
  if (handle.includes('s')) { h = p.y - y }

  if (opts.min != null) {
    if (Math.abs(w) < opts.min) w = Math.sign(w || 1) * opts.min
    if (Math.abs(h) < opts.min) h = Math.sign(h || 1) * opts.min
  }

  const next = { ...s, x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) }

  /* Resizing in local space moves the local-space centre, and the world
     position of a rotated shape depends on its centre. Without putting the
     centre back, a rotated shape SLIDES while you resize it. */
  if (s.rot) {
    /* The resize was solved in the shape's LOCAL frame, unrotated about the
       OLD centre. So the new box's local centre has to be mapped back through
       that same rotation to find where it belongs in the world — and then the
       box translated so its own centre lands there, because a stored shape
       rotates about ITS OWN centre, not about the one it used to have.

       Getting this backwards (translating by before - desired instead of
       desired - after) is invisible at rot 0 and slides the shape away under
       the cursor at every other angle. It was backwards here first. */
    const before = centreOf(s), after = centreOf(next)
    const desired = rotatePoint(after.x, after.y, before.x, before.y, s.rot)
    next.x += desired.x - after.x
    next.y += desired.y - after.y
  }
  return next
}

/* ── connectors ───────────────────────────────────────────────────────── */

/**
 * Where a connector should touch this shape when coming from (tx,ty).
 *
 * This is the whole reason shapes are not blocks. An arrow that stays
 * attached when you move a box has to ask the box where its edge is in a
 * given direction — so it must be one method on the shape model, not
 * something re-derived at every call site from a bounding rectangle.
 *
 * Walks the ray from the centre outward and takes the last point still
 * inside. Bisection rather than per-kind algebra: one implementation that is
 * correct for every kind including rotated ones, at a cost of ~24 hit tests,
 * which is nothing next to being wrong for triangles.
 */
export function anchorPoint(s, tx, ty) {
  /* A connector to a mind map attaches to its ROOT topic: the map's own box
     is mostly empty space between branches. */
  if (s.kind === 'mindmap') {
    const b = nodeBox(s, s.root)
    return b ? anchorPoint({ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, rot: 0 }, tx, ty) : centreOf(s)
  }
  const c = centreOf(s)
  const dx = tx - c.x, dy = ty - c.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return c

  /* A STROKE HAS NO INTERIOR, so the ray-bisection below cannot work for it:
     it starts by asking whether the CENTRE is inside the shape, and the
     centre of a scribble's bounding box is almost never on the scribble. The
     first version fell straight through that guard and returned the centre —
     a connector pointing at the empty middle of the box, which is exactly
     the thing ink was made a real shape to avoid.

     For ink the honest answer is the nearest point on the stroke itself. */
  if (s.kind === 'ink') {
    const c2 = centreOf(s)
    const pts = inkPoints(s).map(p => s.rot ? rotatePoint(p.x, p.y, c2.x, c2.y, s.rot) : p)
    if (pts.length < 2) return c2
    let best = pts[0], bestD = Infinity
    for (let i = 1; i < pts.length; i++) {
      const q = closestOnSegment(tx, ty, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y)
      const d = Math.hypot(q.x - tx, q.y - ty)
      if (d < bestD) { bestD = d; best = q }
    }
    return best
  }

  const ux = dx / len, uy = dy / len
  const b = shapeBounds(s)
  const far = Math.hypot(b.w, b.h) / 2 + 1

  const inside = t => {
    const px = c.x + ux * t, py = c.y + uy * t
    if (isLinear(s.kind)) return distToSegment(px, py, s.x, s.y, s.x + s.w, s.y + s.h) <= 1
    const p = toLocal(s, px, py)
    if (s.kind === 'ellipse') {
      const nx = (p.x - (s.x + s.w / 2)) / (s.w / 2 || 1)
      const ny = (p.y - (s.y + s.h / 2)) / (s.h / 2 || 1)
      return nx * nx + ny * ny <= 1
    }
    return pointInPolygon(p.x, p.y, outline(s))
  }

  if (!inside(0)) return c   // degenerate shape: nothing to anchor to
  let lo = 0, hi = far
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (inside(mid)) lo = mid; else hi = mid
  }
  return { x: c.x + ux * lo, y: c.y + uy * lo }
}

/* ── rendering ────────────────────────────────────────────────────────── */

/**
 * SVG path data, in LOCAL space. Rotation is applied by the renderer as a
 * transform rather than baked into the numbers, so `rot` stays editable and
 * the path stays comparable between two shapes at different angles.
 */
export function shapePath(s) {
  const { x, y, w, h } = s
  if (s.kind === 'ink') return inkPath(inkPoints(s))
  if (s.kind === 'mindmap') return ''
  if (isLinear(s.kind)) return `M ${x} ${y} L ${x + w} ${y + h}`
  if (s.kind === 'ellipse') {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`
  }
  const pts = outline(s)
  return `M ${pts.map(p => `${p.x} ${p.y}`).join(' L ')} Z`
}

/**
 * A smoothed path through a stroke: quadratic segments between the midpoints
 * of consecutive samples, which is the standard way to draw freehand ink
 * without the polyline looking faceted at high zoom.
 *
 * Kept identical in shape to the canvas's original pointsToPath so that
 * strokes drawn before ink became a shape render the same afterwards.
 */
export function inkPath(pts) {
  if (!pts || pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], curr = pts[i]
    d += ` Q ${prev.x} ${prev.y} ${(prev.x + curr.x) / 2} ${(prev.y + curr.y) / 2}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

/** The two barbs of an arrowhead, in world space. */
export function arrowHead(s, len = 12, spread = 0.42) {
  const x2 = s.x + s.w, y2 = s.y + s.h
  const a = Math.atan2(s.h, s.w)
  return [
    { x: x2 - len * Math.cos(a - spread), y: y2 - len * Math.sin(a - spread) },
    { x: x2, y: y2 },
    { x: x2 - len * Math.cos(a + spread), y: y2 - len * Math.sin(a + spread) },
  ]
}

/** The `transform` attribute for a shape, or undefined when it has no angle.
 *  Undefined rather than 'rotate(0 ...)' so React drops the attribute
 *  entirely and the DOM stays clean under a memo diff. */
export function shapeTransform(s) {
  if (!s.rot) return undefined
  const c = centreOf(s)
  return `rotate(${s.rot} ${c.x} ${c.y})`
}

/* ── connectors (Builder → Visuals, 24 Sep 2026) ─────────────────────── */

/** The shape a connector end should attach to at (px,py): the topmost shape
 *  that is not itself a line, hit ANYWHERE inside (an unfilled rectangle's
 *  middle still means "this rectangle" when you are aiming a connector at
 *  it). Null over empty canvas. */
export function pickTarget(shapes, px, py, tol = 6, exclude) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    if (isLinear(s.kind) || s.kind === 'ink' || s.id === exclude) continue
    if (s.kind === 'mindmap') { if (nodeAt(s, px, py, tol)) return s; continue }
    if (hitShape({ ...s, fill: s.fill || '#000' }, px, py, tol)) return s
  }
  return null
}

/**
 * Connectors with their ends placed on the shapes they are attached to.
 *
 * An attached end is the point where the line from the other end's centre
 * leaves the shape (anchorPoint), so the line always meets the outline, for
 * every kind and at every rotation. An end whose shape is gone (deleted, on
 * another sheet after a paste) keeps its stored point; an undo that brings
 * the shape back re-attaches it with no extra bookkeeping.
 *
 * `live` is the canvas's Map of shapes mid-gesture, so a connector follows a
 * box DURING the drag, not only after it.
 *
 * Returns the SAME array when there are no attached connectors, so a sheet
 * without any pays nothing and memoised consumers see no change.
 */
export function resolveConnectors(shapes, live) {
  const moving = id => !!(live && live.has(id))
  if (!shapes.some(s => s.kind === 'connector' && (s.from || s.to || moving(s.id)))) return shapes
  const byId = new Map(shapes.map(s => [s.id, (live && live.get(s.id)) || s]))
  return shapes.map(s => {
    if (s.kind !== 'connector') return s
    /* The live copy wins for the connector itself too: dragging one end, or
       dragging an unattached connector, is a gesture on the connector. Its
       attachments are read from the live copy for the same reason: grabbing
       an end detaches that end for the length of the drag. */
    const self = (live && live.get(s.id)) || s
    if (!(self.from || self.to)) return self
    const A = self.from ? byId.get(self.from) : null
    const B = self.to ? byId.get(self.to) : null
    if (!A && !B) return self
    let a = A ? centreOf(A.kind === 'mindmap' ? (nodeBox(A, A.root) || A) : A) : { x: self.x, y: self.y }
    let b = B ? centreOf(B.kind === 'mindmap' ? (nodeBox(B, B.root) || B) : B) : { x: self.x + self.w, y: self.y + self.h }
    if (A) a = anchorPoint(A, b.x, b.y)
    if (B) b = anchorPoint(B, a.x, a.y)
    return { ...self, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
  })
}

/** Connectors attached to any of `ids`, with their current resolved ends,
 *  as { id, patch } writes. Used before a delete so a connector left behind
 *  stays where it was drawn instead of jumping to a stale stored point. */
export function bakeConnectorsFor(shapes, ids) {
  const kill = new Set(ids)
  const resolved = resolveConnectors(shapes)
  const out = []
  for (const s of resolved) {
    if (s.kind !== 'connector' || kill.has(s.id)) continue
    if ((s.from && kill.has(s.from)) || (s.to && kill.has(s.to))) {
      out.push({ id: s.id, patch: { x: s.x, y: s.y, w: s.w, h: s.h } })
    }
  }
  return out
}
