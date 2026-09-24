'use client'
import { useRef, useState } from 'react'
import { Z } from '../../lib/theme'

/*
  components/visuals/VisualsOverlay.js
  --------------------------------------------------------------------------
  The surface a Visuals creation tool draws on. Mounted only while a
  creation tool is armed; covers the canvas in SCREEN space and takes every
  pointer, so placing a rectangle over a block places a rectangle, not a
  click into the block.

  It owns only the gesture and its ghost. What gets created is the canvas's
  business (onCreate), in world coordinates it converts with toCanvas. A
  press that never moves 4px is a CLICK and places the tool's default size
  centred on the pointer; a drag sizes it. Shift makes boxes square and
  snaps lines to 15 degrees.
  -------------------------------------------------------------------------- */

const LINES = new Set(['line', 'arrow', 'connector'])

export default function VisualsOverlay({ tool, toCanvas, toScreen, targetAt, onCreate, accent }) {
  const ref = useRef(null)
  const [g, setG] = useState(null)     // ghost, screen space: { x0, y0, x1, y1 }
  const [hover, setHover] = useState(null)
  const start = useRef(null)

  const local = e => {
    const r = ref.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const constrain = (p0, p1, shift) => {
    if (!shift) return p1
    let dx = p1.x - p0.x, dy = p1.y - p0.y
    if (LINES.has(tool)) {
      const len = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12)
      return { x: p0.x + Math.cos(a) * len, y: p0.y + Math.sin(a) * len }
    }
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    return { x: p0.x + Math.sign(dx || 1) * m, y: p0.y + Math.sign(dy || 1) * m }
  }
  const hoverRect = (e) => {
    if (tool !== 'connector' || !targetAt) return null
    const t = targetAt(toCanvas(e.clientX, e.clientY))
    if (!t) return null
    const r = ref.current.getBoundingClientRect()
    const a = toScreen(t.x, t.y), b = toScreen(t.x + t.w, t.y + t.h)
    return { id: t.id, x: a.x - r.left, y: a.y - r.top, w: b.x - a.x, h: b.y - a.y }
  }

  function down(e) {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    ref.current.setPointerCapture?.(e.pointerId)
    const p = local(e)
    start.current = { p, client: { x: e.clientX, y: e.clientY }, moved: false }
    setG({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  function move(e) {
    const hv = hoverRect(e)
    if ((hv?.id || null) !== (hover?.id || null) || (hv && hover && (hv.x !== hover.x || hv.y !== hover.y))) setHover(hv)
    if (!start.current) return
    const s = start.current
    if (!s.moved && Math.hypot(e.clientX - s.client.x, e.clientY - s.client.y) < 4) return
    s.moved = true
    const p1 = constrain(s.p, local(e), e.shiftKey)
    setG({ x0: s.p.x, y0: s.p.y, x1: p1.x, y1: p1.y })
  }
  function up(e) {
    const s = start.current
    start.current = null
    setG(null)
    if (!s) return
    const r = ref.current.getBoundingClientRect()
    const p1 = s.moved ? constrain(s.p, local(e), e.shiftKey) : s.p
    const a = toCanvas(s.p.x + r.left, s.p.y + r.top)
    const b = toCanvas(p1.x + r.left, p1.y + r.top)
    onCreate({ tool, a, b, dragged: s.moved })
  }

  const isLine = LINES.has(tool)
  return (
    <div ref={ref} data-visuals-overlay
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={() => { start.current = null; setG(null) }}
      onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      style={{ position: 'absolute', inset: 0, zIndex: Z.marquee, cursor: 'crosshair', touchAction: 'none' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
        {hover && <rect x={hover.x - 3} y={hover.y - 3} width={hover.w + 6} height={hover.h + 6} rx={6}
          style={{ fill: 'none', stroke: accent, strokeWidth: 1.5, strokeDasharray: '4 3' }} />}
        {g && (isLine
          ? <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y1} style={{ stroke: accent, strokeWidth: 2, strokeDasharray: '5 4' }} />
          : <rect x={Math.min(g.x0, g.x1)} y={Math.min(g.y0, g.y1)} width={Math.abs(g.x1 - g.x0)} height={Math.abs(g.y1 - g.y0)} rx={6}
              style={{ fill: accent, fillOpacity: 0.06, stroke: accent, strokeWidth: 1.5, strokeDasharray: '5 4' }} />)}
      </svg>
    </div>
  )
}
