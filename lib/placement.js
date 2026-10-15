/*
  lib/placement.js
  --------------------------------------------------------------------------
  Where a new block goes when nobody pointed at a spot.

  The Add menu, the command palette and the keyboard shortcuts all used to
  drop a new block at the centre of the view (plus a few pixels of random
  jitter). Add three blocks without panning and they land on top of each
  other, each hiding the last — the canvas looks like it swallowed them.

  The rule now: start from the spot the caller wanted; if a block is already
  there, take the nearest free spot, preferring one that is still on screen
  and to the right of or below the wanted spot (where the eye goes next).
  Candidates are the edges of existing blocks, so a new block lines up with
  its neighbours instead of landing on an arbitrary grid step. Pure.
  -------------------------------------------------------------------------- */

/**
 * @param {{x:number,y:number,w:number,h:number}[]} rects  obstacles, canvas coords
 * @param {{x:number,y:number,w:number,h:number}} want      the preferred box
 * @param {{gap?:number, view?:{x:number,y:number,w:number,h:number}|null}} [opts]
 * @returns {{x:number,y:number,moved:boolean,inView:boolean}}
 */
export function findFreeSpot(rects, want, { gap = 24, view = null } = {}) {
  const { w, h } = want
  const list = (rects || []).filter(r => r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 0 && r.h > 0)
  const hits = (x, y) => list.some(r =>
    x < r.x + r.w + gap && x + w + gap > r.x && y < r.y + r.h + gap && y + h + gap > r.y)
  const inView = (x, y) => !view ||
    (x >= view.x && y >= view.y && x + Math.min(w, view.w) <= view.x + view.w && y + Math.min(h, 240) <= view.y + view.h)

  if (!hits(want.x, want.y)) return { x: Math.round(want.x), y: Math.round(want.y), moved: false, inView: inView(want.x, want.y) }

  /* Only neighbours near the wanted spot become candidate edges; far-away
     blocks still count as obstacles. Keeps this fast on a big sheet. */
  const reach = 4000
  const near = list.filter(r => Math.abs(r.x - want.x) < reach && Math.abs(r.y - want.y) < reach)
  const xs = new Set([want.x]), ys = new Set([want.y])
  for (const r of near) {
    xs.add(r.x); xs.add(r.x + r.w + gap); xs.add(r.x - gap - w)
    ys.add(r.y); ys.add(r.y + r.h + gap); ys.add(r.y - gap - h)
  }
  if (view) { xs.add(view.x + gap); ys.add(view.y + gap) }

  let best = null
  for (const x of xs) for (const y of ys) {
    const dx = x - want.x, dy = y - want.y
    /* Up and to the left cost double: a new block that appears above the
       one you were looking at is easy to miss. Off screen costs a lot. */
    let score = Math.hypot(dx < 0 ? dx * 2 : dx, dy < 0 ? dy * 2 : dy)
    const seen = inView(x, y)
    if (!seen) score += 100000
    if (best && score >= best.score) continue
    if (hits(x, y)) continue
    best = { x, y, score, seen }
  }
  if (!best) {
    /* Fully boxed in (practically impossible): below everything. */
    const bottom = Math.max(...list.map(r => r.y + r.h))
    return { x: Math.round(want.x), y: Math.round(bottom + gap), moved: true, inView: false }
  }
  return { x: Math.round(best.x), y: Math.round(best.y), moved: true, inView: best.seen }
}
