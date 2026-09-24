'use client'
import { useEffect, useState } from 'react'
import { Z } from '../../lib/theme'

/*
  components/visuals/VisualsBar.js
  --------------------------------------------------------------------------
  Builder → Visuals: the action bar. Bottom centre of the canvas, the
  placement picked from the prototype (24 Sep 2026).

  One-shot tools, like Miro: pick a shape, place one, and you are back on
  Select. Pen is the exception, since the canvas's own draw mode is a mode.
  Letter shortcuts work while the bar is open (see VISUAL_KEYS); the bar
  showing IS the signal that letters mean tools, so they cannot surprise
  anyone who has not opened it.

  "Link blocks" is the block-to-block connection mode that used to be the
  Builder's Mind map row. It lives here now because it is a visual tool;
  the new Mind map tool draws real mind maps.
  -------------------------------------------------------------------------- */

const ICONS = {
  select: <path d="M5 3l12 7-5.5 1.5L9 17z" />,
  rect: <rect x="3.5" y="5" width="13" height="10" rx="2" />,
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="5.5" />,
  diamond: <path d="M10 3l7 7-7 7-7-7z" />,
  triangle: <path d="M10 4l7 12H3z" />,
  line: <path d="M4 16L16 4" />,
  arrow: <path d="M4 16L16 4M9 4h7v7" />,
  connector: <><rect x="2.5" y="3" width="5" height="5" rx="1" /><rect x="12.5" y="12" width="5" height="5" rx="1" /><path d="M7.5 5.5h3a2 2 0 0 1 2 2V12" /></>,
  text: <path d="M5 5h10M10 5v11" />,
  sticky: <><path d="M4 4h12v8l-4 4H4z" /><path d="M12 16v-4h4" /></>,
  mindmap: <><circle cx="5" cy="10" r="2.5" /><circle cx="15" cy="5" r="2" /><circle cx="15" cy="15" r="2" /><path d="M7.5 10c3 0 3-5 5.5-5M7.5 10c3 0 3 5 5.5 5" /></>,
  pen: <path d="M4 16l1-4 8-8 3 3-8 8z" />,
  link: <><rect x="2" y="6" width="6" height="8" rx="1.5" /><rect x="12" y="6" width="6" height="8" rx="1.5" /><path d="M8 10h4" /></>,
  close: <path d="M6 6l8 8M14 6l-8 8" />,
}

export const VISUAL_TOOLS = [
  ['select', 'Select', 'V'], null,
  ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['diamond', 'Diamond', 'D'], ['triangle', 'Triangle', ''], null,
  ['line', 'Line', 'L'], ['arrow', 'Arrow', 'A'], ['connector', 'Connector', 'C'], null,
  ['text', 'Text', 'T'], ['sticky', 'Sticky note', 'N'], null,
  ['mindmap', 'Mind map', 'M'], null,
  ['pen', 'Pen', 'P'], ['link', 'Link blocks', ''],
]

/** Letter → tool, for the canvas's key handler. */
export const VISUAL_KEYS = Object.fromEntries(VISUAL_TOOLS.filter(t => t && t[2]).map(t => [t[2].toLowerCase(), t[0]]))

/** What a tool does, shown once as a hint when it is picked. */
export const TOOL_HINTS = {
  rect: 'Click to place, or drag to size', ellipse: 'Click to place, or drag to size',
  diamond: 'Click to place, or drag to size', triangle: 'Click to place, or drag to size',
  line: 'Drag to draw a line', arrow: 'Drag to draw an arrow',
  connector: 'Drag from one shape to another',
  text: 'Click to place text', sticky: 'Click to place a sticky note',
  mindmap: 'Click to start a mind map. Tab adds a topic, Enter a sibling',
  link: 'Click one block, then another, to link them',
}

export default function VisualsBar({ tool, penOn, linkOn, onTool, onClose, colors }) {
  const { surface, border, raised, text, text2, accent, accentDim } = colors
  const [tip, setTip] = useState(null)
  /* Toasts dock bottom centre too; lift them above the bar while it is up. */
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--ds-toast-lift', '64px')
    return () => root.style.removeProperty('--ds-toast-lift')
  }, [])
  const active = id => (id === 'pen' ? penOn : id === 'link' ? linkOn : !penOn && !linkOn && tool === id)

  const btn = (id, name, key) => (
    <button key={id} type="button" aria-label={key ? `${name} (${key})` : name} aria-pressed={active(id)}
      data-visual-tool={id}
      onClick={() => onTool(id)}
      onMouseEnter={e => setTip({ name, key, el: e.currentTarget })} onMouseLeave={() => setTip(null)}
      onFocus={e => setTip({ name, key, el: e.currentTarget })} onBlur={() => setTip(null)}
      style={{
        width: 36, height: 36, display: 'grid', placeItems: 'center',
        border: 'none', borderRadius: 8, cursor: 'pointer', padding: 0,
        background: active(id) ? accentDim : 'transparent', color: active(id) ? accent : text2,
        transition: 'background-color .12s ease, color .12s ease',
      }}
      onMouseOver={e => { if (!active(id)) { e.currentTarget.style.background = raised; e.currentTarget.style.color = text } }}
      onMouseOut={e => { if (!active(id)) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 } }}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
        {ICONS[id]}
      </svg>
    </button>
  )

  let sep = 0
  const tipBox = tip?.el?.getBoundingClientRect?.()
  return (
    <>
      <div role="toolbar" aria-label="Visuals" data-kbd-zone data-visuals-bar
        onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: Z.chrome,
          display: 'flex', alignItems: 'center', gap: 2, padding: 6, maxWidth: 'calc(100% - 32px)', overflowX: 'auto',
          background: surface, border: `1px solid ${border}`, borderRadius: 12, boxShadow: 'var(--ds-shadow-lg)',
        }}>
        {VISUAL_TOOLS.map(t => t
          ? btn(t[0], t[1], t[2])
          : <span key={'sep' + (sep++)} aria-hidden="true" style={{ flex: '0 0 1px', width: 1, height: 24, margin: '0 4px', background: border }} />)}
        <span aria-hidden="true" style={{ flex: '0 0 1px', width: 1, height: 24, margin: '0 4px', background: border }} />
        {btn('close', 'Close Visuals', '')}
      </div>
      {tipBox && (
        <div role="tooltip" style={{
          position: 'fixed', zIndex: Z.hint, pointerEvents: 'none',
          left: tipBox.left + tipBox.width / 2, top: tipBox.top - 8, transform: 'translate(-50%, -100%)',
          background: text, color: surface, fontFamily: 'var(--ds-font-body)', fontSize: 12, padding: '5px 8px', borderRadius: 6, whiteSpace: 'nowrap',
        }}>
          {tip.name}{tip.key && <span style={{ fontFamily: 'var(--ds-font-mono)', opacity: 0.7, marginLeft: 6 }}>{tip.key}</span>}
        </div>
      )}
    </>
  )
}
