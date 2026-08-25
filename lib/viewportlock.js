/*
  lib/viewportlock.js
  --------------------------------------------------------------------------
  Browser zoom is banned inside the app. The canvas owns scale; the page does
  not.

  This is not a preference. A document whose chrome silently rescales under
  the user's fingers is the loudest "this is a web page, not an application"
  signal there is, and it was breaking canvas coordinate maths besides —
  getCanvasPoint() carries a visualViewport.scale divisor that only exists to
  compensate for a zoom that should never have happened.

  FOUR ROUTES IN, ALL CLOSED HERE

    1. ctrl/meta + wheel          mouse
    2. trackpad pinch             arrives as a wheel event with ctrlKey true
                                  and fractional deltas. At the event level it
                                  is INDISTINGUISHABLE from (1), which is why
                                  one listener handles both
    3. ctrl/meta + [+ - = _ 0]    keyboard
    4. gesturestart/change/end    Safari's non-standard pinch events, which
                                  fire INSTEAD of a wheel event there

  WHY CAPTURE PHASE, ON WINDOW

  The previous arrangement put preventDefault() inside NotebookCanvas's own
  wheel handler, AFTER an early `if (selectionLockRef.current) return`. Two
  holes followed directly:

    · selecting any block re-enabled browser zoom, because the guard ran first
    · a wheel event over the sidebar, a rail or the toolbar never reached the
      canvas listener at all, so ctrl+scroll there always zoomed the page

  Registering on window in the capture phase fixes both by construction: this
  runs before any component listener and cannot be skipped by an early return
  further down the tree. It ONLY calls preventDefault — it never decides what
  a gesture means. The canvas keeps its own bubble-phase listener and does the
  actual zooming; by the time that runs the browser default is already gone.

  Keep the two jobs separate. The moment this file starts knowing about pan
  and zoom state, the bug above comes back.

  NOT HANDLED HERE: horizontal overscroll (the two-finger swipe that navigates
  back). Chrome decides that before any wheel listener runs, so preventDefault
  is too late by definition — it has to be refused declaratively, and it is,
  via `overscroll-behavior` in app/globals.css. Do not try to move it here.

  ACCESSIBILITY, HONESTLY: closing route 3 removes the only way a user can
  enlarge this UI. That is a deliberate instruction, not an oversight, and it
  owes them an in-app UI-scale preference. Until that ships this is a real
  regression for anyone who relies on page zoom to read.
  -------------------------------------------------------------------------- */

/* '=' and '_' are the unshifted faces of '+' and '-'. Chrome zooms on the
   physical key, so matching only the shifted glyphs leaves the common case
   (ctrl and the key next to backspace) wide open. '0' is reset-to-100%. */
const ZOOM_KEYS = new Set(['+', '-', '=', '_', '0'])

/** True if this wheel event is a browser-zoom gesture (mouse or pinch). */
export function isZoomWheel(e) {
  return !!(e && (e.ctrlKey || e.metaKey))
}

/** True if this keydown is a browser-zoom shortcut. */
export function isZoomKey(e) {
  if (!e || !(e.ctrlKey || e.metaKey)) return false
  /* alt+ctrl is not a zoom shortcut on any platform, and swallowing it would
     eat AltGr combinations, which is how several European layouts type. */
  if (e.altKey) return false
  return ZOOM_KEYS.has(e.key)
}

/**
 * Cancel every browser-zoom gesture on `target` (default: window).
 * Returns a cleanup function — call it on unmount.
 */
export function lockViewportZoom(target) {
  const t = target || (typeof window !== 'undefined' ? window : null)
  if (!t || typeof t.addEventListener !== 'function') return () => {}

  const onWheel = e => { if (isZoomWheel(e)) e.preventDefault() }
  const onKeyDown = e => { if (isZoomKey(e)) e.preventDefault() }
  const onGesture = e => { e.preventDefault() }

  /* passive:false is mandatory. Chrome treats wheel listeners on window as
     passive BY DEFAULT, and a passive listener's preventDefault() is ignored
     with only a console warning — the lock would silently do nothing. */
  const opts = { passive: false, capture: true }

  t.addEventListener('wheel', onWheel, opts)
  t.addEventListener('keydown', onKeyDown, opts)
  t.addEventListener('gesturestart', onGesture, opts)
  t.addEventListener('gesturechange', onGesture, opts)
  t.addEventListener('gestureend', onGesture, opts)

  return () => {
    t.removeEventListener('wheel', onWheel, opts)
    t.removeEventListener('keydown', onKeyDown, opts)
    t.removeEventListener('gesturestart', onGesture, opts)
    t.removeEventListener('gesturechange', onGesture, opts)
    t.removeEventListener('gestureend', onGesture, opts)
  }
}
