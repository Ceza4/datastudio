/*
  lib/focusmode.js
  --------------------------------------------------------------------------
  FULL SCREEN FOR ONE BLOCK — the pure half.

  Full screen is a VIEWING mode. It never writes the block's size: the stored
  w/h stay exactly what they were on the canvas, and the enlarged size exists
  only in the render (NotebookCanvas's liveOf). The camera moves to zoom 1 with
  the block's corner at the inset, the block is drawn at the viewport's size,
  and a backdrop hides everything else. Leaving puts the camera back.

  Everything here is plain arithmetic so it can be unit-tested without a DOM:
  the frame the block fills, the camera that puts it there, the FLIP transform
  that animates between two screen rects, the patch correction that keeps a
  block's own "grow by N" edits relative to its STORED size, and the Escape
  hold that is the keyboard way out.
  -------------------------------------------------------------------------- */

/** Gap between the window edge and the full-screen block, px. */
export const FOCUS_INSET = 10

/** How long Escape must be held to leave full screen. A tap never leaves. */
export const HOLD_MS = 600

/** How long the "Keep holding Esc" hint stays after a tap. */
export const HINT_MS = 1800

/** Enter/leave animation lengths, ms. */
export const ENTER_MS = 360
export const LEAVE_MS = 300

/** Block types that cannot go full screen. Containers hold OTHER blocks that
 *  are positioned on the canvas in their own right; enlarging the frame alone
 *  would leave its children where they were. */
const NO_FOCUS = new Set(['section', 'columns'])

export function canFocus(block) {
  return !!block && typeof block.type === 'string' && !NO_FOCUS.has(block.type)
}

/** The size the block is drawn at while in full screen: the canvas viewport
 *  minus the inset on every side. Never negative. */
export function focusFrame(view, inset = FOCUS_INSET) {
  const w = Math.max(0, Math.round((view?.w || 0) - inset * 2))
  const h = Math.max(0, Math.round((view?.h || 0) - inset * 2))
  return { w, h }
}

/** The camera that puts the block's top-left corner at (inset, inset) at
 *  zoom 1. Derived from the block's own position, so a collaborator moving
 *  the block while you are in full screen does not push it off screen. */
export function focusCamera(block, inset = FOCUS_INSET) {
  return { pan: { x: inset - (block?.x || 0), y: inset - (block?.y || 0) }, zoom: 1 }
}

/** The render-time override: the block as drawn in full screen. Position is
 *  untouched (the camera does the moving); only w/h change. */
export function withFocusFrame(block, frame) {
  if (!block || !frame) return block
  if (block.w === frame.w && block.h === frame.h) return block
  return { ...block, w: frame.w, h: frame.h }
}

/** Where a block of the given (stored, clamped) size sits on screen under a
 *  given camera. `origin` is the canvas container's top-left in client px. */
export function screenRect(block, dims, cam, origin = { left: 0, top: 0 }) {
  const z = cam?.zoom || 1
  return {
    left: origin.left + (cam?.pan?.x || 0) + (block?.x || 0) * z,
    top: origin.top + (cam?.pan?.y || 0) + (block?.y || 0) * z,
    width: (dims?.w || 0) * z,
    height: (dims?.h || 0) * z,
  }
}

/** The transform that makes an element whose box is `to` LOOK like it is at
 *  `from`. Origin top-left. Used as the first keyframe of a FLIP. */
export function flipTransform(from, to) {
  if (!from || !to || !to.width || !to.height) return 'none'
  const dx = from.left - to.left
  const dy = from.top - to.top
  const sx = from.width / to.width
  const sy = from.height / to.height
  const r = n => Math.round(n * 10000) / 10000
  return `translate(${r(dx)}px, ${r(dy)}px) scale(${r(sx)}, ${r(sy)})`
}

/** A block's own size edits while it is enlarged, mapped back to its STORED
 *  size. Components compute growth from the size they are drawn at
 *  (Kanban's "+ lane" writes w = drawnW + laneW); in full screen the drawn
 *  size is the viewport, and writing that through would turn a viewing mode
 *  into a resize. So the patch is read as a DELTA from the frame and applied
 *  to the stored size. A patch that does not touch w/h passes through as-is
 *  (same object). */
export function patchForFocus(patch, storedDims, frame) {
  if (!patch || typeof patch !== 'object') return patch
  const hasW = typeof patch.w === 'number', hasH = typeof patch.h === 'number'
  if (!hasW && !hasH) return patch
  const out = { ...patch }
  if (hasW) out.w = Math.max(1, Math.round((storedDims?.w || 0) + (patch.w - frame.w)))
  if (hasH) out.h = Math.max(1, Math.round((storedDims?.h || 0) + (patch.h - frame.h)))
  return out
}

/** Backdrop rectangle in WORLD coordinates that covers the whole canvas
 *  viewport under the given camera, with a margin so a sub-pixel pan never
 *  shows a sliver of canvas at the edge. */
export function backdropRect(view, cam, margin = 40) {
  const z = cam?.zoom || 1
  return {
    left: (-(cam?.pan?.x || 0) - margin) / z,
    top: (-(cam?.pan?.y || 0) - margin) / z,
    width: ((view?.w || 0) + margin * 2) / z,
    height: ((view?.h || 0) + margin * 2) / z,
  }
}

/* ── THE ESCAPE HOLD ─────────────────────────────────────────────────────
   Escape must never throw you out of full screen by accident. You are typing,
   a menu does something you did not want, you hit Escape to back out of THAT
   — and the view should stay put. So:

     · a press that something inside the block used (a menu closed, a cell
       edit cancelled) is ignored here entirely;
     · a tap with nothing to close only shows a hint;
     · holding Escape for HOLD_MS leaves. Letting go early cancels.

   Key-repeat events are ignored (the hold is timed from the first press, not
   restarted by the OS repeat), and losing window focus cancels, because the
   keyup would never arrive. */
export function createEscHold({ ms = HOLD_MS, hintMs = HINT_MS, onExit, onChange, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let state = 'idle'         // 'idle' | 'holding' | 'hint'
  let t = null, hintT = null
  const set = s => { if (s !== state) { state = s; onChange?.(s) } }
  const clear = () => { if (t != null) { clearTimer(t); t = null } }
  const clearHint = () => { if (hintT != null) { clearTimer(hintT); hintT = null } }

  return {
    get state() { return state },
    /** @returns {boolean} true when this press was taken by the hold */
    down(e) {
      if (!e || e.key !== 'Escape') return false
      if (e.repeat) return state === 'holding'
      if (e.defaultPrevented || e.__dsConsumed) return false
      clear(); clearHint()
      set('holding')
      t = setTimer(() => { t = null; set('idle'); onExit?.() }, ms)
      return true
    },
    up(e) {
      if (!e || e.key !== 'Escape' || state !== 'holding') return
      clear()
      set('hint')
      clearHint()
      hintT = setTimer(() => { hintT = null; if (state === 'hint') set('idle') }, hintMs)
    },
    cancel() { clear(); clearHint(); set('idle') },
  }
}
