'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/* TextBlockToolbar — REDESIGNED
   --------------------------------------------------------------------------
   Fixes from v1:
   - Uses React portal → renders into document.body, unaffected by transforms
   - Bigger buttons with readable labels (not cryptic single characters)
   - Two-row layout: formatting on top, structure on bottom
   - Clear visual grouping with labels
   -------------------------------------------------------------------------- */

const FONTS = [
  'Inter', 'DM Sans', 'Times New Roman', 'Georgia', 'Helvetica',
  'Arial', 'Courier New', 'Verdana',
]

const COLORS = [
  '#1A1917', '#5B5FE8', '#4ade80', '#E8B85B',
  '#f87171', '#a78bfa', '#38bdf8', '#ffffff',
]

export default function TextBlockToolbar({ colors, onClose }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const ref = useRef(null)
  const [showFontMenu, setShowFontMenu] = useState(false)
  const [showColorMenu, setShowColorMenu] = useState(false)

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  function exec(cmd, value = null) {
    document.execCommand(cmd, false, value)
  }

  function addLink(e) {
    e.preventDefault()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      window.alert('Select some text first, then click Link.')
      return
    }
    const url = window.prompt('Enter URL:', 'https://')
    if (url) {
      exec('createLink', url)
      setTimeout(() => {
        document.querySelectorAll('[data-ds-text] a:not([target])').forEach(a => a.setAttribute('target', '_blank'))
      }, 0)
    }
  }

  /* x/y are still accepted so callers don't have to change, but the rail is
     docked rather than cursor-positioned, so they're no longer used. */

  const btnStyle = {
    background: 'transparent',
    border: `1px solid transparent`,
    padding: '6px 11px',
    color: text2,
    cursor: 'pointer',
    fontFamily: 'var(--ds-font-body)',
    fontSize: 13,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  }

  function Btn({ onMouseDown: handler, title, children, active, style: extra = {} }) {
    return (
      <button
        onMouseDown={handler}
        title={title}
        style={{
          ...btnStyle,
          ...extra,
          ...(active ? { background: accentDim, color: accent, borderColor: accent + '44' } : {}),
        }}
        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = raised; e.currentTarget.style.color = text } }}
        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2; e.currentTarget.style.borderColor = 'transparent' } }}
      >
        {children}
      </button>
    )
  }

  const sep = <div style={{ width: 1, height: 22, background: border, margin: '0 4px', flexShrink: 0 }} />

  const toolbar = (
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      data-island-rail
      data-kbd-zone
      /* Docked as a floating island on the right, matching the sheet and image
         rails, rather than popping up at the cursor. Three reasons it's better
         here: it never covers the text you're formatting, it lands in the same
         place every time so the buttons become muscle memory, and it makes the
         formatting controls keyboard-reachable through the same Tab-to-toolbar
         path as every other rail. */
      style={{
        position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)',
        zIndex: 99999, width: 176,
        background: `${surface}f2`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: '0 6px 30px rgba(0,0,0,0.28)', padding: 10,
        fontFamily: 'var(--ds-font-body)',
        display: 'flex', flexDirection: 'column', gap: 6,
        animation: 'dsRailIn 0.18s cubic-bezier(.34,1.3,.64,1)',
      }}
    >
      <style>{`
        @keyframes dsRailIn {
          from { opacity: 0; transform: translateY(-50%) translateX(8px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
      `}</style>
      <div style={{
        fontSize: 9, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase',
        letterSpacing: 0.9, color: text3, padding: '0 2px 6px',
        borderBottom: `1px solid ${border}`,
      }}>
        Format
      </div>
      {/* Row 1: Text formatting */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <Btn onMouseDown={e => { e.preventDefault(); exec('bold') }} title="Bold"><b style={{ fontSize: 14 }}>B</b></Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('italic') }} title="Italic"><i style={{ fontSize: 14 }}>I</i></Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('underline') }} title="Underline"><u style={{ fontSize: 14 }}>U</u></Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('strikeThrough') }} title="Strikethrough"><s style={{ fontSize: 14 }}>S</s></Btn>

        {sep}

        {/* Font picker */}
        <div style={{ position: 'relative' }}>
          <Btn onMouseDown={e => { e.preventDefault(); setShowFontMenu(v => !v); setShowColorMenu(false) }} title="Font family">
            Font ▾
          </Btn>
          {showFontMenu && (
            <div style={{ position: 'absolute', top: 34, left: 0, background: surface, border: `1px solid ${border}`, borderRadius: 8, padding: 4, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 10 }}>
              {FONTS.map(font => (
                <button key={font} onMouseDown={e => { e.preventDefault(); exec('fontName', font); setShowFontMenu(false) }}
                  style={{ ...btnStyle, width: '100%', justifyContent: 'flex-start', fontFamily: `'${font}', sans-serif`, padding: '8px 12px' }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}>
                  {font}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Color picker */}
        <div style={{ position: 'relative' }}>
          <Btn onMouseDown={e => { e.preventDefault(); setShowColorMenu(v => !v); setShowFontMenu(false) }} title="Text color">
            Color ▾
          </Btn>
          {showColorMenu && (
            <div style={{ position: 'absolute', top: 34, left: 0, background: surface, border: `1px solid ${border}`, borderRadius: 8, padding: 8, display: 'flex', gap: 5, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 10 }}>
              {COLORS.map(c => (
                <button key={c} onMouseDown={e => { e.preventDefault(); exec('foreColor', c); setShowColorMenu(false) }} title={c}
                  style={{ width: 24, height: 24, borderRadius: 5, background: c, border: `1.5px solid ${border}`, cursor: 'pointer', padding: 0, flexShrink: 0 }} />
              ))}
            </div>
          )}
        </div>

        {sep}

        <Btn onMouseDown={addLink} title="Insert hyperlink">Link</Btn>
      </div>

      {/* Row 2: Structure */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <Btn onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h1') }} title="Heading 1" style={{ fontWeight: 700, fontFamily: 'var(--ds-font-head)' }}>H1</Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h2') }} title="Heading 2" style={{ fontWeight: 700, fontFamily: 'var(--ds-font-head)' }}>H2</Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h3') }} title="Heading 3" style={{ fontWeight: 700, fontFamily: 'var(--ds-font-head)' }}>H3</Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'div') }} title="Normal paragraph">Text</Btn>

        {sep}

        <Btn onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList') }} title="Bullet list">• Bullets</Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('insertOrderedList') }} title="Numbered list">1. Numbers</Btn>
        <Btn onMouseDown={e => {
          e.preventDefault()
          exec('insertHTML',
            '<div data-type="checklist" style="display:flex;align-items:flex-start;gap:8px;padding:3px 0;"><input type="checkbox" style="margin-top:5px;cursor:pointer;accent-color:#5B5FE8;width:15px;height:15px;flex-shrink:0;"><span></span></div>'
          )
        }} title="Checklist">☐ Check</Btn>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(toolbar, document.body)
}
