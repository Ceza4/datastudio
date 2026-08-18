/*
  lib/canvasgeom.js
  --------------------------------------------------------------------------
  Screen coordinates versus canvas coordinates.

  THE PROBLEM, ONCE, SO IT STOPS RECURRING
  The infinite canvas renders its blocks inside

      transform: translate(panX, panY) scale(zoom)

  and a CSS transform changes two things that are easy to forget:

  1  getBoundingClientRect() returns the VISUALLY TRANSFORMED box. At 50% zoom
     a 520px block reports 260px wide. So `e.clientX - rect.left` is a distance
     in SCREEN pixels, while everything inside the block — its layout, its
     absolutely-positioned children, the numbers stored in a document — is in
     UNTRANSFORMED CSS pixels. Using one as the other puts every click at
     roughly `zoom ×` the distance from the block's top-left corner, which is
     exactly the "starts editing way past my mouse" symptom.

  2  A transformed element becomes the containing block for `position: fixed`
     descendants. So a menu at `position: fixed; left: e.clientX` inside the
     canvas is NOT positioned against the viewport — it's positioned against
     the canvas, and then scaled. This is why the sheet's right-click menu
     appears away from the cursor, and it cannot be fixed with arithmetic:
     the element has to leave the transformed subtree entirely, via a portal.

  WHAT'S SAFE, AND ISN'T OBVIOUS
  · offsetWidth / offsetHeight    — LAYOUT pixels, unaffected by transforms ✓
  · ResizeObserver contentRect    — LAYOUT pixels, unaffected ✓
  · getBoundingClientRect()       — VISUAL pixels, scaled ✗
  · e.clientX / e.clientY         — VISUAL pixels (viewport) ✗

  So the fix for measurement is usually "use offsetWidth", and the fix for
  pointer maths is "divide by the element's own measured scale".
  -------------------------------------------------------------------------- */

/**
 * The scale an element is currently rendered at, derived from the element
 * itself rather than from the app's zoom state.
 *
 * Reading it from the DOM means this stays correct regardless of how many
 * nested transforms sit above — and it can't fall out of sync with a zoom
 * value passed down through props, which is the other way this goes wrong.
 */
export function elementScale(el) {
  if (!el) return 1
  const rect = el.getBoundingClientRect()
  const layoutW = el.offsetWidth
  const layoutH = el.offsetHeight
  // Prefer whichever axis has a usable size; a zero-width element is not
  // evidence of a zero scale.
  if (layoutW > 0 && rect.width > 0) return rect.width / layoutW
  if (layoutH > 0 && rect.height > 0) return rect.height / layoutH
  return 1
}

/**
 * A pointer position, in an element's own untransformed coordinate space.
 *
 * This is the function every pointer handler inside the canvas must use.
 * `clientX - rect.left` alone is correct ONLY at zoom 1, which is why the bug
 * survives casual testing: it looks perfect until someone zooms.
 *
 * @returns {{x:number, y:number}} CSS pixels relative to the element's top-left
 */
export function localPoint(el, clientX, clientY) {
  if (!el) return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  const scale = elementScale(el)
  const s = scale > 0 ? scale : 1
  return {
    x: (num(clientX) - rect.left) / s,
    y: (num(clientY) - rect.top) / s,
  }
}

/** Convenience for a React or DOM pointer/mouse event. */
export const localPointFromEvent = (el, e) => localPoint(el, e?.clientX, e?.clientY)

/**
 * An element's untransformed size.
 *
 * offsetWidth/offsetHeight are layout pixels and already ignore transforms,
 * so this is mostly a named place to record that fact — a future reader
 * reaching for getBoundingClientRect here would silently reintroduce the bug.
 */
export function localSize(el) {
  if (!el) return { w: 0, h: 0 }
  return { w: el.offsetWidth || 0, h: el.offsetHeight || 0 }
}

/**
 * Is this element inside a transformed ancestor?
 *
 * Used by the development guard: a `position: fixed` element that answers yes
 * is positioned against that ancestor rather than the viewport, and is
 * therefore in the wrong place. Walks up to `stopAt` (or the document root).
 */
export function hasTransformedAncestor(el, stopAt = null) {
  if (typeof window === 'undefined' || !el?.parentElement) return false
  let node = el.parentElement
  while (node && node !== stopAt && node !== document.documentElement) {
    const cs = window.getComputedStyle(node)
    if ((cs.transform && cs.transform !== 'none') ||
        (cs.perspective && cs.perspective !== 'none') ||
        (cs.filter && cs.filter !== 'none')) {
      return true
    }
    node = node.parentElement
  }
  return false
}

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
