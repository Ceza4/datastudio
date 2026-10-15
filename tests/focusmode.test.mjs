/* Full screen for one block: frame, camera, FLIP, patch mapping, Escape hold. */
import {
  FOCUS_INSET, HOLD_MS, canFocus, focusFrame, focusCamera, withFocusFrame, screenRect,
  flipTransform, patchForFocus, backdropRect, createEscHold,
} from '../lib/focusmode.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

console.log('\n which blocks')
ok(canFocus({ type: 'document' }) && canFocus({ type: 'table' }) && canFocus({ type: 'task' }), 'ordinary blocks can go full screen')
ok(!canFocus({ type: 'section' }) && !canFocus({ type: 'columns' }), 'containers cannot (their children live on the canvas)')
ok(!canFocus(null) && !canFocus({}), 'nothing / no type: no')

console.log('\n frame + camera')
ok(JSON.stringify(focusFrame({ w: 1500, h: 900 })) === JSON.stringify({ w: 1480, h: 880 }), 'frame = viewport minus the inset on each side')
ok(focusFrame({ w: 10, h: 5 }).w === 0 && focusFrame({ w: 10, h: 5 }).h === 0, 'a tiny viewport never gives a negative frame')
const cam = focusCamera({ x: 400, y: -120 })
ok(cam.zoom === 1 && cam.pan.x === FOCUS_INSET - 400 && cam.pan.y === FOCUS_INSET + 120, 'camera puts the corner at the inset, zoom 1')
const b = { id: 'a', x: 400, y: -120, w: 720, h: 600 }
const r = screenRect(b, { w: 720, h: 600 }, cam, { left: 0, top: 0 })
ok(r.left === FOCUS_INSET && r.top === FOCUS_INSET, 'under that camera the block lands at the inset')
ok(withFocusFrame(b, { w: 1480, h: 880 }).w === 1480 && withFocusFrame(b, { w: 1480, h: 880 }).x === 400, 'override changes size only')
ok(withFocusFrame(b, { w: 720, h: 600 }) === b, 'same object when nothing changes')
ok(b.w === 720 && b.h === 600, 'the stored block is never mutated')

console.log('\n screen rect + FLIP')
const s = screenRect(b, { w: 720, h: 600 }, { pan: { x: 50, y: 20 }, zoom: 0.5 }, { left: 0, top: 0 })
ok(s.left === 250 && s.top === -40 && s.width === 360 && s.height === 300, 'screen rect follows pan and zoom')
ok(flipTransform({ left: 100, top: 50, width: 360, height: 300 }, { left: 10, top: 10, width: 1440, height: 900 }) === 'translate(90px, 40px) scale(0.25, 0.3333)', 'FLIP maps the new box onto the old one')
ok(flipTransform(null, s) === 'none' && flipTransform(s, { left: 0, top: 0, width: 0, height: 0 }) === 'none', 'degenerate input gives none')

console.log('\n size edits while enlarged')
const frame = { w: 1480, h: 880 }
const p = { name: 'x' }
ok(patchForFocus(p, { w: 880, h: 360 }, frame) === p, 'a patch without w/h passes through untouched')
ok(patchForFocus({ w: 1480 + 230, lanes: [] }, { w: 880, h: 360 }, frame).w === 1110, 'Kanban +lane (drawn width + 230) grows the STORED width by 230')
ok(patchForFocus({ h: 880 - 40 }, { w: 880, h: 360 }, frame).h === 320, 'a shrink maps the same way')
ok(patchForFocus({ w: 0 }, { w: 10, h: 10 }, frame).w === 1, 'never below 1')

console.log('\n backdrop')
const bd = backdropRect({ w: 1000, h: 700 }, { pan: { x: -390, y: 130 }, zoom: 1 }, 40)
ok(bd.left === 350 && bd.top === -170 && bd.width === 1080 && bd.height === 780, 'backdrop covers the viewport plus a margin, in world units')
const bd2 = backdropRect({ w: 1000, h: 700 }, { pan: { x: 0, y: 0 }, zoom: 0.5 }, 0)
ok(bd2.width === 2000 && bd2.height === 1400, 'and scales with zoom')

console.log('\n Escape hold')
let timers = [], now = 0
const setTimer = (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t }
const clearTimer = t => { timers = timers.filter(x => x !== t) }
const advance = ms => { now += ms; for (const t of [...timers].sort((a, b) => a.at - b.at)) if (t.at <= now && timers.includes(t)) { timers = timers.filter(x => x !== t); t.fn() } }
let exits = 0, states = []
const h = createEscHold({ onExit: () => exits++, onChange: s => states.push(s), setTimer, clearTimer })
const esc = (o = {}) => ({ key: 'Escape', ...o })
ok(h.down(esc()) === true && h.state === 'holding', 'a press starts a hold')
advance(200); h.up(esc())
ok(exits === 0 && h.state === 'hint', 'a tap does NOT exit, it shows the hint')
advance(2000)
ok(h.state === 'idle', 'the hint goes away on its own')
h.down(esc()); advance(HOLD_MS - 1)
ok(exits === 0, 'not yet at HOLD_MS - 1')
advance(1)
ok(exits === 1 && h.state === 'idle', 'holding for HOLD_MS exits once')
h.up(esc())
ok(h.state === 'idle', 'the keyup after an exit does nothing')
h.down(esc()); advance(300)
ok(h.down(esc({ repeat: true })) === true, 'OS key-repeat is swallowed while holding')
advance(299); ok(exits === 1, 'repeat does not restart or shorten the timer (still 1 exit at 599ms)')
advance(1); ok(exits === 2, 'timed from the FIRST press')
ok(h.down(esc({ defaultPrevented: true })) === false && h.state === 'idle', 'a press a menu already used is ignored')
ok(h.down(esc({ __dsConsumed: true })) === false, 'so is one a sheet cell consumed')
ok(h.down({ key: 'Enter' }) === false, 'other keys are not ours')
h.down(esc()); advance(100); h.cancel(); advance(1000)
ok(exits === 2 && h.state === 'idle', 'cancel (window blur) stops the hold')

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
