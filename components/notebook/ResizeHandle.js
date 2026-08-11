'use client'
import Icon from '../ui/Icon'

/* Resize affordances for a block.
   --------------------------------------------------------------------------
   There used to be exactly one grip, in the bottom-right corner, which meant
   every resize also moved the opposite edge — to widen a block on its left you
   had to resize from the right and then drag the whole thing back.

   Eight handles now: four edges and four corners. Edges resize one dimension,
   corners resize both, and dragging a top or left handle holds the opposite
   edge still by adjusting x/y as the size changes.

   Hit areas are deliberately larger than what's drawn (10px bands, 16px
   corners) — a 2px border is a frustrating target, and the visible line stays
   thin so the canvas doesn't turn into a cage of chrome. */

const DIRS = [
  // [dir, cursor, style]
  ['n',  'ns-resize',   { top: -5, left: 14, right: 14, height: 10 }],
  ['s',  'ns-resize',   { bottom: -5, left: 14, right: 14, height: 10 }],
  ['w',  'ew-resize',   { left: -5, top: 14, bottom: 14, width: 10 }],
  ['e',  'ew-resize',   { right: -5, top: 14, bottom: 14, width: 10 }],
  ['nw', 'nwse-resize', { top: -6, left: -6, width: 16, height: 16 }],
  ['ne', 'nesw-resize', { top: -6, right: -6, width: 16, height: 16 }],
  ['sw', 'nesw-resize', { bottom: -6, left: -6, width: 16, height: 16 }],
  ['se', 'nwse-resize', { bottom: -6, right: -6, width: 16, height: 16 }],
]

export default function ResizeHandle({ onResizeStart, border, accent, show }) {
  return (
    <>
      {DIRS.map(([dir, cursor, pos]) => (
        <div
          key={dir}
          onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onResizeStart(e, dir) }}
          style={{ position: 'absolute', ...pos, cursor, zIndex: 25 }}
        />
      ))}

      {/* Corner grip, drawn only on the bottom-right so the block still reads
          as resizable at a glance without eight visible dots. */}
      <div style={{
        position: 'absolute', right: 1, bottom: 1, pointerEvents: 'none',
        color: show ? accent : border,
        opacity: show ? 0.95 : 0.5,
        transition: 'opacity .15s, color .15s',
      }}>
        <Icon name="handle-resize" size={11} />
      </div>
    </>
  )
}
