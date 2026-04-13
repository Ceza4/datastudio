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
  'DM Sans', 'Times New Roman', 'Georgia', 'Helvetica',
  'Arial', 'Courier New', 'Verdana',
]

const COLORS = [
  '#1A1917', '#5B5FE8', '#4ade80', '#E8B85B',
  '#f87171', '#a78bfa', '#38bdf8', '#ffffff',
]

export default function TextBlockToolbar({ x, y, colors, onClose }) {
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

  const left = Math.min(Math.max(x - 160, 8), window.innerWidth - 340)
  const top = Math.min(y + 8, window.innerHeight - 140)

  const btnStyle = {
    background: 'transparent',
    border: `1px solid transparent`,
    padding: '6px 11px',
    color: text2,
    cursor: 'pointer',
    fontFamily: "'DM Sans',sans-serif",
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
      style={{
        position: 'fixed', left, top, zIndex: 99999,
        background: surface, border: `1px solid ${border}`, borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.3)', padding: '6px 8px',
        fontFamily: "'DM Sans',sans-serif",
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      {/* Row 1: Text formatting */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Btn onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h1') }} title="Heading 1" style={{ fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>H1</Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h2') }} title="Heading 2" style={{ fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>H2</Btn>
        <Btn onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h3') }} title="Heading 3" style={{ fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>H3</Btn>
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
