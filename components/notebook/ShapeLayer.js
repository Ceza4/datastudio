'use client'
import { memo } from 'react'
import { shapePath, arrowHead, shapeTransform, centreOf, isLinear, corners, shapeBounds, isLabelled } from '../../lib/shapes'
import { layout, setTextMeasurer, NODE_H, TOGGLE_R, countDescendants, mindmapBounds } from '../../lib/mindmap'

/* Topic widths come from real text metrics in the browser. Installed once,
   at module load, so layout() (which hit testing also calls) and the
   rendered text agree to the pixel. The fallback estimate stays for tests. */
if (typeof document !== 'undefined') {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    const family = getComputedStyle(document.body || document.documentElement).fontFamily || 'Inter, system-ui, sans-serif'
    if (ctx) setTextMeasurer((text, bold) => { ctx.font = `${bold ? 600 : 500} 13px ${family}`; return ctx.measureText(text).width })
  } catch { /* the estimate stays */ }
}

/** A stored colour token name ('accent', 'amber') or a literal colour. */
export const tokenColor = c => (!c ? null : /^[a-z][a-z0-9-]*$/.test(c) ? `var(--ds-${c})` : c)

/*
  components/notebook/ShapeLayer.js
  --------------------------------------------------------------------------
  Every recognised shape on the active sheet, in ONE svg.

  WHY ONE SVG AND NOT A DIV EACH — measured, not assumed. At 500 shapes a
  memoised layer costs ~1.0ms of render+commit+layout per drag frame and does
  not grow with the shape count; a memoised div-per-shape costs ~1.5ms, grows,
  and carries ~15% more DOM. But that was NOT the deciding factor: the spread
  is about 1ms and both are inside budget. What decided it was hit testing.
  See lib/shapes.js and claude/SHAPE_LAYER_AUG20.md.

  THE LAYER TAKES NO POINTER EVENTS. `pointerEvents: none` on the svg and on
  every shape in it, deliberately. Hit testing runs in JS, through
  pickShape() in lib/shapes.js, from the canvas's existing mousedown handler.

  That is the whole point of the layer model and it is worth stating plainly:
  if the browser dispatched these clicks, the hit area of a diagonal arrow
  would be its bounding rectangle — about 56x larger than the arrow — because
  a rectangle is the only thing the browser can dispatch on. Doing it in JS is
  what buys a 6px tolerance around the actual line.

  The ONE exception is the handles, which opt back in to pointer events. They
  are small, axis-aligned, and always on top, so the browser's own dispatch is
  exactly right for them and JS hit testing would be pure ceremony.

  EVERY CHROME DIMENSION IS DIVIDED BY ZOOM. A 1px selection outline inside a
  scaled transform is 3px at 3x and invisible at 0.25x. Same convention as the
  alignment guides elsewhere in the canvas.

  Coordinates carry the canvas's +3000 offset: this svg is 9000x9000 anchored
  at -3000,-3000 so that negative world coordinates have somewhere to live.
  --------------------------------------------------------------------------
*/

export const OFF = 3000

/* One shape. memo()'d on purpose — this is what keeps a drag from
   reconciling every other shape on the sheet. Props are primitives and one
   stable object, so the default shallow compare is enough. */
const Shape = memo(function Shape({ s, stroke, selected, accent, editing }) {
  const col = selected ? accent : (tokenColor(s.color) || stroke)
  const common = {
    strokeWidth: s.size || 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    /* Colours go through style, not attributes: a stored fill can be a CSS
       variable (Visuals shapes use the paper token), and var() is only
       guaranteed inside CSS. */
    style: { pointerEvents: 'none', fill: tokenColor(s.fill) || 'none', stroke: col },
  }
  const sticky = s.kind === 'sticky'
  const label = isLabelled(s.kind) && s.text && !editing
  return (
    <g style={{ transform: `translate(${OFF}px, ${OFF}px)` }}>
      <g transform={shapeTransform(s)}>
        {sticky ? (
          <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={4}
            style={{ pointerEvents: 'none', fill: 'var(--ds-sticky)', stroke: selected ? accent : 'var(--ds-sticky-edge)', strokeWidth: selected ? 2 : 1 }} />
        ) : s.kind === 'text' ? (
          /* A text box has no outline of its own: the words are the shape.
             Selection draws the box, through the handles. */
          null
        ) : (
          <path d={shapePath(s)} {...common} />
        )}
        {(s.kind === 'arrow' || s.kind === 'connector') && (
          <polyline
            points={arrowHead(s, Math.max(9, (s.size || 2) * 5)).map(p => `${p.x},${p.y}`).join(' ')}
            {...common} style={{ ...common.style, fill: 'none' }}
          />
        )}
        {label && <Label s={s} />}
      </g>
    </g>
  )
})

/* The words on a box. foreignObject so they WRAP, which svg text cannot do;
   the box clips them, the same as Miro, rather than growing the shape. The
   triangle's usable area is its lower two thirds. */
function Label({ s }) {
  const big = s.kind === 'text'
  const top = s.kind === 'triangle' ? s.h * 0.34 : 0
  return (
    <foreignObject x={s.x} y={s.y + top} width={Math.max(1, s.w)} height={Math.max(1, s.h - top)} style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: big ? '2px 4px' : 8, boxSizing: 'border-box', textAlign: 'center',
        fontFamily: 'var(--ds-font-body)', fontSize: big ? 16 : 13, fontWeight: big ? 600 : 500, lineHeight: 1.35,
        color: s.kind === 'sticky' ? 'var(--ds-sticky-text)' : 'var(--ds-text)',
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'hidden',
      }}>{s.text}</div>
    </foreignObject>
  )
}

/* A whole mind map: branches first, then topics over them. Topic text is
   HTML inside foreignObject so a long title ends in an ellipsis instead of
   running out of its box. */
const MindMap = memo(function MindMap({ s, selected, selNode, dropNode, editingNode, accent }) {
  const { boxes, visible } = layout(s)
  const N = s.nodes
  const edges = []
  for (const id of visible) {
    const n = N[id]
    if (n.collapsed) continue
    const pb = boxes[id]
    for (const k of n.children) {
      const cb = boxes[k]
      if (!cb) continue
      const x1 = s.x + pb.x + pb.w, y1 = s.y + pb.y + NODE_H / 2
      const x2 = s.x + cb.x, y2 = s.y + cb.y + NODE_H / 2, mx = (x1 + x2) / 2
      edges.push(<path key={k} d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
        style={{ fill: 'none', stroke: tokenColor(N[k].color) || accent, strokeWidth: 2, strokeLinecap: 'round' }} />)
    }
  }
  return (
    <g style={{ transform: `translate(${OFF}px, ${OFF}px)`, pointerEvents: 'none' }}>
      {selected && !selNode && (() => {
        const b = mindmapBounds(s)
        return <rect x={b.x - 8} y={b.y - 8} width={b.w + 16} height={b.h + 16} rx={10}
          style={{ fill: 'none', stroke: accent, strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.7 }} />
      })()}
      {edges}
      {visible.map(id => {
        const n = N[id], b = boxes[id], isRoot = id === s.root
        const x = s.x + b.x, y = s.y + b.y
        const col = tokenColor(n.color) || accent
        const sel = selNode === id, drop = dropNode === id
        return (
          <g key={id} data-mm-node={id}>
            {sel && <rect x={x - 4} y={y - 4} width={b.w + 8} height={NODE_H + 8} rx={isRoot ? 13 : 11}
              style={{ fill: 'none', stroke: accent, strokeWidth: 2, opacity: 0.35 }} />}
            <rect x={x} y={y} width={b.w} height={NODE_H} rx={isRoot ? 10 : 8}
              style={{
                fill: isRoot ? 'var(--ds-text)' : 'var(--ds-paper)',
                stroke: sel || drop ? accent : isRoot ? 'var(--ds-text)' : col,
                strokeWidth: sel ? 2.5 : 1.5,
                strokeDasharray: drop ? '4 3' : undefined,
              }} />
            {editingNode !== id && (
              <foreignObject x={x} y={y} width={b.w} height={NODE_H}>
                <div style={{
                  height: NODE_H, lineHeight: `${NODE_H}px`, padding: '0 14px', boxSizing: 'border-box',
                  fontFamily: 'var(--ds-font-body)', fontSize: 13, fontWeight: isRoot ? 600 : 500,
                  color: isRoot ? 'var(--ds-base)' : n.text ? 'var(--ds-text)' : 'var(--ds-text-3)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{n.text || 'Topic'}</div>
              </foreignObject>
            )}
            {n.children.length > 0 && (
              <g>
                <circle cx={x + b.w + TOGGLE_R + 1} cy={y + NODE_H / 2} r={TOGGLE_R}
                  style={{ fill: 'var(--ds-paper)', stroke: isRoot ? 'var(--ds-text)' : col, strokeWidth: 1.5 }} />
                <text x={x + b.w + TOGGLE_R + 1} y={y + NODE_H / 2 + 0.5} textAnchor="middle" dominantBaseline="middle"
                  style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11, fontWeight: 600, fill: 'var(--ds-text-2)' }}>
                  {n.collapsed ? countDescendants(s, id) : '−'}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
})

/* Selection chrome for exactly one shape: the rotated outline, eight resize
   handles, and a rotate handle standing off the top edge. */
function Handles({ s, zoom, accent, surface, onHandleDown }) {
  const px = n => n / zoom
  /* A mind map draws its own selection (the topic ring, or a dashed box
     around the map); it has no handles to offer. */
  if (s.kind === 'mindmap') return null
  const pts = corners(s)
  const c = centreOf(s)

  /* A line has endpoints, not a box. Showing it eight box handles implies
     eight things it cannot do. */
  if (isLinear(s.kind)) {
    const ends = [
      { id: 'nw', x: s.x, y: s.y },
      { id: 'se', x: s.x + s.w, y: s.y + s.h },
    ]
    return (
      <g style={{ transform: `translate(${OFF}px, ${OFF}px)` }}>
        {ends.map(h => (
          <circle key={h.id} cx={h.x} cy={h.y} r={px(5)}
            fill={surface} stroke={accent} strokeWidth={px(1.6)}
            style={{ pointerEvents: 'all', cursor: 'move' }}
            onMouseDown={e => onHandleDown(e, h.id)} />
        ))}
      </g>
    )
  }

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const [tl, tr, br, bl] = pts
  const spots = [
    { id: 'nw', p: tl }, { id: 'n', p: mid(tl, tr) }, { id: 'ne', p: tr },
    { id: 'e', p: mid(tr, br) }, { id: 'se', p: br }, { id: 's', p: mid(br, bl) },
    { id: 'sw', p: bl }, { id: 'w', p: mid(bl, tl) },
  ]
  /* The rotate handle stands off the TOP edge in the shape's own frame, so it
     follows the shape around instead of hovering north of it on screen. */
  const top = mid(tl, tr)
  const away = { x: top.x - c.x, y: top.y - c.y }
  const len = Math.hypot(away.x, away.y) || 1
  const rot = { x: top.x + (away.x / len) * px(22), y: top.y + (away.y / len) * px(22) }

  return (
    <g style={{ transform: `translate(${OFF}px, ${OFF}px)` }}>
      <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')}
        fill="none" stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`}
        opacity={0.75} style={{ pointerEvents: 'none' }} />
      <line x1={top.x} y1={top.y} x2={rot.x} y2={rot.y}
        stroke={accent} strokeWidth={px(1)} opacity={0.75} style={{ pointerEvents: 'none' }} />
      <circle cx={rot.x} cy={rot.y} r={px(5)}
        fill={accent} stroke={surface} strokeWidth={px(1.4)}
        style={{ pointerEvents: 'all', cursor: 'grab' }}
        onMouseDown={e => onHandleDown(e, 'rotate')} />
      {spots.map(h => (
        <rect key={h.id} x={h.p.x - px(4)} y={h.p.y - px(4)} width={px(8)} height={px(8)} rx={px(1.5)}
          fill={surface} stroke={accent} strokeWidth={px(1.4)}
          style={{ pointerEvents: 'all', cursor: 'pointer' }}
          onMouseDown={e => onHandleDown(e, h.id)} />
      ))}
    </g>
  )
}

/*
  Chrome for a MULTI-selection.

  Recolouring the selected shapes was the only signal, and colour alone cannot
  answer the two questions a multi-selection raises: WHICH things are in it,
  and WHERE does the group end. A stroke drawn in the accent colour to begin
  with was simply invisible as "selected", and with forty strokes on a sheet
  there was no way to see the extent of what a Delete was about to remove.

  So: a light dashed box around each member — which ones — and a stronger one
  around all of them with a count — how many, and how big. Deliberately
  different weights, or the two boxes compete and neither reads.

  No resize handles. Group resize is not implemented, and drawing eight
  handles you cannot use would be a promise the layer does not keep.
*/
function MultiSelect({ list, zoom, accent }) {
  if (!list.length) return null
  const px = n => n / zoom
  const bounds = list.map(shapeBounds)
  const x0 = Math.min(...bounds.map(b => b.x))
  const y0 = Math.min(...bounds.map(b => b.y))
  const x1 = Math.max(...bounds.map(b => b.x + b.w))
  const y1 = Math.max(...bounds.map(b => b.y + b.h))
  const pad = px(6)

  return (
    <g style={{ transform: `translate(${OFF}px, ${OFF}px)`, pointerEvents: 'none' }}>
      {bounds.map((b, i) => (
        <rect key={list[i].id} x={b.x - px(2)} y={b.y - px(2)} width={b.w + px(4)} height={b.h + px(4)}
          fill="none" stroke={accent} strokeWidth={px(0.9)} strokeDasharray={`${px(3)} ${px(3)}`}
          opacity={0.5} rx={px(2)} />
      ))}
      <rect x={x0 - pad} y={y0 - pad} width={(x1 - x0) + pad * 2} height={(y1 - y0) + pad * 2}
        fill={accent} fillOpacity={0.05} stroke={accent} strokeWidth={px(1.3)}
        strokeDasharray={`${px(7)} ${px(4)}`} rx={px(4)} />
      {/* The count sits ON the top edge rather than above it, so it cannot be
          pushed off-screen by a selection that reaches the top of the view. */}
      <g transform={`translate(${x0 - pad + px(9)}, ${y0 - pad})`}>
        <rect x={0} y={px(-8)} width={px(list.length > 9 ? 30 : 24)} height={px(16)} rx={px(8)} fill={accent} />
        <text x={px(list.length > 9 ? 15 : 12)} y={px(4)} textAnchor="middle"
          fill="#fff" style={{ fontSize: px(10), fontWeight: 700, fontFamily: 'var(--ds-font-body)' }}>
          {list.length}
        </text>
      </g>
    </g>
  )
}

function ShapeLayer({
  shapes, selectedIds, zoom, accent, surface, stroke,
  soleSelected, onHandleDown, live,
  /* Builder → Visuals. `mm` = { shapeId, nodeId } the selected topic;
     `mmDrop` = the topic a dragged topic would land under; `editing` =
     { shapeId, nodeId? } whose words are in the text editor right now, so
     the rendered copy steps aside instead of showing twice. */
  mm, mmDrop, editing,
}) {
  return (
    <svg style={{
      position: 'absolute', top: -OFF, left: -OFF, width: OFF * 3, height: OFF * 3,
      pointerEvents: 'none', zIndex: 7, overflow: 'visible',
    }}>
      {shapes.map(s => {
        /* `live` is a Map of id -> shape for the gesture in flight. A Map and
           not a single shape because a multi-selection drags together. Reading
           it here instead of writing every pointermove into the notebook keeps
           a drag out of the 600ms autosave and out of undo — the same reason
           blocks have liveOf(). Connectors arrive already resolved (the
           canvas runs resolveConnectors with the same live map). */
        const cur = (s.kind !== 'connector' && live && live.get(s.id)) || s
        if (cur.kind === 'mindmap') {
          return <MindMap key={s.id} s={cur} accent={accent}
            selected={selectedIds.has(s.id)}
            selNode={mm?.shapeId === s.id ? mm.nodeId : null}
            dropNode={mmDrop?.shapeId === s.id ? mmDrop.nodeId : null}
            editingNode={editing?.shapeId === s.id ? editing.nodeId : null} />
        }
        return <Shape key={s.id} s={cur}
          stroke={stroke} accent={accent} selected={selectedIds.has(s.id)}
          editing={editing?.shapeId === s.id && !editing.nodeId} />
      })}
      {/* Exactly one selected gets handles; more than one gets the group
          chrome. Never both — handles on one member of a group imply that
          dragging them resizes the group, which it does not. */}
      {!soleSelected && selectedIds.size > 1 && (
        <MultiSelect
          list={shapes.filter(s => selectedIds.has(s.id)).map(s => (live && live.get(s.id)) || s)}
          zoom={zoom} accent={accent}
        />
      )}
      {soleSelected && (
        <Handles s={(soleSelected.kind !== 'connector' && live && live.get(soleSelected.id)) || soleSelected}
          zoom={zoom} accent={accent} surface={surface} onHandleDown={onHandleDown} />
      )}
    </svg>
  )
}

export default memo(ShapeLayer)
