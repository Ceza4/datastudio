'use client'
import { useEffect, useRef, useState } from 'react'

/* TextBlockToolbar
   --------------------------------------------------------------------------
   Floating right-click menu for formatting selected text inside a
   text block. Provides:
     - Bold / Italic / Underline
     - Font color
     - Font family
     - Add hyperlink

   Uses document.execCommand under the hood. Yes, execCommand is
   technically deprecated, but it's still the only practical way to
   format contentEditable selections without writing a custom DOM
   manipulation engine. It works in every browser DataStudio targets.

   Selection preservation: button onMouseDown calls preventDefault to
   keep focus inside the contentEditable. Without that, clicking a
   button would clear the selection and the format command would have
   nothing to act on.
   -------------------------------------------------------------------------- */

const FONTS = [
  'DM Sans',
  'Times New Roman',
  'Georgia',
  'Helvetica',
  'Arial',
  'Courier New',
  'Verdana',
  'Comic Sans MS',
]

const COLORS = [
  '#1A1917', // default text
  '#5B5FE8', // accent indigo
  '#4ade80', // green
  '#E8B85B', // amber
  '#f87171', // red
  '#a78bfa', // purple
  '#38bdf8', // sky
]

export default function TextBlockToolbar({ x, y, colors, onClose }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const ref = useRef(null)
  const [showFontMenu, setShowFontMenu] = useState(false)
  const [showColorMenu, setShowColorMenu] = useState(false)

  // Close on click outside. setTimeout so the contextmenu's own click
  // doesn't immediately close us.
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

  function applyBold(e) { e.preventDefault(); exec('bold') }
  function applyItalic(e) { e.preventDefault(); exec('italic') }
  function applyUnderline(e) { e.preventDefault(); exec('underline') }

  function applyFont(font) {
    exec('fontName', font)
    setShowFontMenu(false)
  }

  function applyColor(color) {
    exec('foreColor', color)
    setShowColorMenu(false)
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
      // Make new links open in a new tab so internal data isn't navigated away from
      const links = ref.current?.parentElement?.querySelectorAll('a:not([target])')
      links?.forEach(a => a.setAttribute('target', '_blank'))
    }
  }

  // Position the toolbar so it doesn't overflow the viewport
  const left = Math.min(x, window.innerWidth - 320)
  const top = Math.min(y, window.innerHeight - 60)

  const btnStyle = {
    background: 'transparent',
    border: 'none',
    padding: '6px 9px',
    color: text2,
    cursor: 'pointer',
    fontFamily: "'DM Sans',sans-serif",
    fontSize: 12,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  }

  return (
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 9999,
        background: surface,
        border: `1px solid ${border}`,
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        padding: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        fontFamily: "'DM Sans',sans-serif",
      }}
    >
      <button
        onMouseDown={applyBold}
        title="Bold (selection)"
        style={btnStyle}
        onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}
      >
        <b>B</b>
      </button>
      <button
        onMouseDown={applyItalic}
        title="Italic (selection)"
        style={btnStyle}
        onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}
      >
        <i>I</i>
      </button>
      <button
        onMouseDown={applyUnderline}
        title="Underline (selection)"
        style={btnStyle}
        onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}
      >
        <u>U</u>
      </button>

      <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

      {/* Font picker */}
      <div style={{ position: 'relative' }}>
        <button
          onMouseDown={e => { e.preventDefault(); setShowFontMenu(v => !v); setShowColorMenu(false) }}
          title="Font"
          style={btnStyle}
          onMouseEnter={e => { e.currentTarget.style.background = raised }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          Aa ▾
        </button>
        {showFontMenu && (
          <div style={{ position: 'absolute', top: 30, left: 0, background: surface, border: `1px solid ${border}`, borderRadius: 6, padding: 4, minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
            {FONTS.map(font => (
              <button
                key={font}
                onMouseDown={e => { e.preventDefault(); applyFont(font) }}
                style={{ ...btnStyle, width: '100%', justifyContent: 'flex-start', fontFamily: `'${font}', sans-serif` }}
                onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}
              >
                {font}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Color picker */}
      <div style={{ position: 'relative' }}>
        <button
          onMouseDown={e => { e.preventDefault(); setShowColorMenu(v => !v); setShowFontMenu(false) }}
          title="Text color"
          style={btnStyle}
          onMouseEnter={e => { e.currentTarget.style.background = raised }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'linear-gradient(45deg, #5B5FE8, #4ade80, #f87171)' }} />
        </button>
        {showColorMenu && (
          <div style={{ position: 'absolute', top: 30, left: 0, background: surface, border: `1px solid ${border}`, borderRadius: 6, padding: 6, display: 'flex', gap: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
            {COLORS.map(c => (
              <button
                key={c}
                onMouseDown={e => { e.preventDefault(); applyColor(c) }}
                title={c}
                style={{ width: 20, height: 20, borderRadius: 4, background: c, border: `1px solid ${border}`, cursor: 'pointer', padding: 0, flexShrink: 0 }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

      <button
        onMouseDown={addLink}
        title="Add link"
        style={btnStyle}
        onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}
      >
        🔗 Link
      </button>
    </div>
  )
}
