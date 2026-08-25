'use client'
import { memo } from 'react'
import { shapePath, arrowHead, shapeTransform, centreOf, isLinear, corners, shapeBounds } from '../../lib/shapes'

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
const Shape = memo(function Shape({ s, stroke, selected, accent }) {
  const col = selected ? accent : (s.color || stroke)
  const common = {
    fill: s.fill || 'none',
    stroke: col,
    strokeWidth: s.size || 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    transform: shapeTransform(s),
    style: { pointerEvents: 'none' },
  }
  return (
    <g style={{ transform: `translate(${OFF}px, ${OFF}px)` }}>
      <path d={shapePath(s)} {...common} />
      {s.kind === 'arrow' && (
        <polyline
          points={arrowHead(s, Math.max(9, (s.size || 2) * 5)).map(p => `${p.x},${p.y}`).join(' ')}
          {...common} fill="none"
        />
      )}
    </g>
  )
})

/* Selection chrome for exactly one shape: the rotated outline, eight resize
   handles, and a rotate handle standing off the top edge. */
function Handles({ s, zoom, accent, surface, onHandleDown }) {
  const px = n => n / zoom
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
}) {
  return (
    <svg style={{
      position: 'absolute', top: -OFF, left: -OFF, width: OFF * 3, height: OFF * 3,
      pointerEvents: 'none', zIndex: 7, overflow: 'visible',
    }}>
      {shapes.map(s => (
        /* `live` is a Map of id -> shape for the gesture in flight. A Map and
           not a single shape because a multi-selection drags together. Reading
           it here instead of writing every pointermove into the notebook keeps
           a drag out of the 600ms autosave and out of undo — the same reason
           blocks have liveOf(). */
        <Shape key={s.id} s={(live && live.get(s.id)) || s}
          stroke={stroke} accent={accent} selected={selectedIds.has(s.id)} />
      ))}
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
        <Handles s={(live && live.get(soleSelected.id)) || soleSelected}
          zoom={zoom} accent={accent} surface={surface} onHandleDown={onHandleDown} />
      )}
    </svg>
  )
}

export default memo(ShapeLayer)
