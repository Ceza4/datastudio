/*
  tests/viewportlock.test.mjs
  --------------------------------------------------------------------------
  The browser-zoom lock.

  WHY THIS FILE EXISTS
  The bug it replaces was an ORDERING bug, not a logic bug. NotebookCanvas's
  wheel handler called preventDefault() *after* an early
  `if (selectionLockRef.current) return`, so selecting any block silently
  handed ctrl+scroll back to the browser and the whole page zoomed. Nothing
  caught it because every individual line was correct.

  So the assertions here are mostly about COVERAGE of the ways in, not about
  clever inputs. The interesting cases are the unshifted key faces ('=' and
  '_'), which are what people actually press, and altKey, which must NOT be
  swallowed because AltGr is how several European layouts type.

  WHAT THIS CANNOT TEST
  That preventDefault() is honoured. A passive listener ignores it with only
  a console warning, and passive-by-default is exactly what Chrome does to
  wheel listeners on window — so the single most likely way for this file to
  be green while the feature is dead is invisible here. That needs
  tests/browser/. The listener options are asserted instead, which is the
  closest a DOM-free test can get.
  -------------------------------------------------------------------------- */

import { lockViewportZoom, isZoomWheel, isZoomKey } from '../lib/viewportlock.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

/* A target that records what was registered and can replay events. */
function fakeTarget() {
  const listeners = []
  return {
    listeners,
    addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
    removeEventListener: (type, fn, opts) => {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn)
      if (i >= 0) listeners.splice(i, 1)
    },
    fire(type, ev) {
      const e = { type, prevented: false, preventDefault() { this.prevented = true }, ...ev }
      for (const l of listeners) if (l.type === type) l.fn(e)
      return e.prevented
    },
  }
}

console.log('\n isZoomWheel')
{
  ok(isZoomWheel({ ctrlKey: true, deltaY: 100 }) === true, 'ctrl+wheel — the mouse route')
  ok(isZoomWheel({ ctrlKey: true, deltaY: 2.5 }) === true, 'ctrl+wheel with a fractional delta — a trackpad pinch, same event')
  ok(isZoomWheel({ metaKey: true, deltaY: 100 }) === true, 'cmd+wheel, for macOS')
  ok(isZoomWheel({ deltaY: 100 }) === false, 'a plain wheel is the canvas pan and must be left alone')
  ok(isZoomWheel({ shiftKey: true, deltaY: 100 }) === false, 'shift+wheel is horizontal scroll, not zoom')
  ok(isZoomWheel(null) === false, 'null, without throwing')
}

console.log('\n isZoomKey')
{
  ok(isZoomKey({ ctrlKey: true, key: '+' }) === true, 'ctrl and the shifted plus')
  ok(isZoomKey({ ctrlKey: true, key: '=' }) === true, 'ctrl and the UNSHIFTED plus — the one people actually press')
  ok(isZoomKey({ ctrlKey: true, key: '-' }) === true, 'ctrl and minus')
  ok(isZoomKey({ ctrlKey: true, key: '_' }) === true, 'ctrl and the shifted minus')
  ok(isZoomKey({ ctrlKey: true, key: '0' }) === true, 'ctrl+0, which is reset-to-100% and zoom all the same')
  ok(isZoomKey({ metaKey: true, key: '-' }) === true, 'cmd+minus')
  ok(isZoomKey({ ctrlKey: true, key: 'd' }) === false, 'ctrl+d is duplicate-block and must survive')
  ok(isZoomKey({ ctrlKey: true, key: 'z' }) === false, 'ctrl+z is undo and must survive')
  ok(isZoomKey({ key: '-' }) === false, 'a bare minus is typing')
  ok(isZoomKey({ ctrlKey: true, altKey: true, key: '0' }) === false, 'ctrl+alt is AltGr on several layouts — never swallowed')
  ok(isZoomKey(null) === false, 'null, without throwing')
}

console.log('\n lockViewportZoom — registration')
{
  const t = fakeTarget()
  lockViewportZoom(t)
  const types = t.listeners.map(l => l.type)
  ok(types.includes('wheel'), 'binds wheel')
  ok(types.includes('keydown'), 'binds keydown')
  ok(['gesturestart', 'gesturechange', 'gestureend'].every(g => types.includes(g)),
     "binds Safari's three gesture events, which fire INSTEAD of wheel there")
  ok(t.listeners.every(l => l.opts && l.opts.capture === true),
     'every listener is capture phase — a bubble listener can be beaten by an early return further down')
  ok(t.listeners.every(l => l.opts && l.opts.passive === false),
     'every listener is passive:false — Chrome makes window wheel listeners passive by default and then IGNORES preventDefault')
}

console.log('\n lockViewportZoom — behaviour')
{
  const t = fakeTarget()
  lockViewportZoom(t)
  ok(t.fire('wheel', { ctrlKey: true, deltaY: 100 }) === true, 'cancels ctrl+wheel')
  ok(t.fire('wheel', { ctrlKey: true, deltaY: 1.7 }) === true, 'cancels a pinch')
  ok(t.fire('wheel', { deltaY: 100 }) === false, 'leaves a plain wheel for the canvas to pan with')
  ok(t.fire('keydown', { ctrlKey: true, key: '=' }) === true, 'cancels ctrl+=')
  ok(t.fire('keydown', { ctrlKey: true, key: 'z' }) === false, 'leaves ctrl+z alone')
  ok(t.fire('gesturestart', {}) === true, 'cancels a Safari gesture unconditionally')
}

console.log('\n lockViewportZoom — cleanup')
{
  const t = fakeTarget()
  const stop = lockViewportZoom(t)
  const n = t.listeners.length
  stop()
  ok(t.listeners.length === 0, `removes all ${n} listeners, so a remount does not stack them`)
  ok(t.fire('wheel', { ctrlKey: true, deltaY: 100 }) === false, 'and stops cancelling once removed')
}

console.log('\n lockViewportZoom — degenerate targets')
{
  ok(typeof lockViewportZoom({}) === 'function', 'a target with no addEventListener returns a no-op cleanup rather than throwing')
  let threw = false
  try { lockViewportZoom({})() } catch (_) { threw = true }
  ok(threw === false, 'and that no-op cleanup is safe to call')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
