'use client'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/* SlashMenu — presentational only.
   --------------------------------------------------------------------------
   WHY THIS WAS REWRITTEN

   The old version owned its own keyboard handling via a capture-phase
   `document.addEventListener('keydown', …, true)`, while the contentEditable
   that owns the caret had its own React onKeyDown. Two handlers, two phases,
   and an effect whose dependency array (`[filtered, activeIdx, onSelect,
   onClose]`) was a fresh array plus two fresh closures on every render — so
   the listener was torn down and re-registered constantly. Arrow keys raced
   the caret: whichever handler won decided whether the caret moved, and once
   the caret moved off the end of "/query" the parent's detectSlash() no
   longer matched and closed the menu. That's the "press / then arrow down and
   it disappears" bug.

   The fix is ownership, not patching. The component that owns the caret —
   TextBlockContent — now owns the keyboard too. It intercepts arrows, Enter,
   Tab and Escape in its own onKeyDown before the browser can move the caret,
   and drives this component through props. This file no longer listens to
   anything. There is exactly one handler, in one phase, and no race is
   possible.

   Rendered through a portal into document.body because the notebook canvas
   applies a CSS transform, which breaks position:fixed for descendants.
   -------------------------------------------------------------------------- */

export const COMMANDS = [
  { id: 'h1',        label: 'Heading 1',   desc: 'Large section heading',      icon: 'H1',    keywords: 'heading title big' },
  { id: 'h2',        label: 'Heading 2',   desc: 'Medium section heading',     icon: 'H2',    keywords: 'heading subtitle' },
  { id: 'h3',        label: 'Heading 3',   desc: 'Small section heading',      icon: 'H3',    keywords: 'heading small' },
  { id: 'bullet',    label: 'Bullet list', desc: 'Unordered list',             icon: '•',     keywords: 'bullet unordered list ul point' },
  { id: 'numbered',  label: 'Numbered list', desc: 'Ordered list with numbers', icon: '1.',   keywords: 'numbered ordered list ol' },
  { id: 'checklist', label: 'Checklist',   desc: 'To-do items with checkboxes', icon: '☐',    keywords: 'checklist todo checkbox task' },
  { id: 'quote',     label: 'Quote',       desc: 'Indented quotation',          icon: '❝',    keywords: 'quote blockquote cite' },
  { id: 'divider',   label: 'Divider',     desc: 'Horizontal separator line',   icon: '—',    keywords: 'divider line separator rule hr' },
  { id: 'code',      label: 'Code block',  desc: 'Monospaced code snippet',     icon: '</>',  keywords: 'code snippet pre monospace' },
]

/* Shared by the menu and by its parent, so the parent can clamp the active
   index against exactly the list the user is looking at. */
export function filterCommands(filter) {
  const q = (filter || '').toLowerCase().trim()
  if (!q) return COMMANDS
  return COMMANDS.filter(c =>
    c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q)
  )
}

export default function SlashMenu({ x, y, filter, activeIdx, colors, onSelect, onHover }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const listRef = useRef(null)
  // Mouse selection is suppressed until the pointer actually moves. Cycling
  // with the arrow keys scrolls the list under a stationary cursor, which
  // fires mouseenter on whatever slid beneath it — the keyboard and the mouse
  // then fight over the highlight. Standard menu behaviour: last input wins.
  const mouseLive = useRef(false)
  const filtered = filterCommands(filter)

  useEffect(() => {
    function wake() { mouseLive.current = true }
    window.addEventListener('mousemove', wake)
    return () => window.removeEventListener('mousemove', wake)
  }, [])

  /* Keep the highlighted row in view when the parent moves the index.
     scrollTop is set directly rather than via scrollIntoView, which walks up
     the ancestor chain and can scroll the page or the canvas behind us. */
  useEffect(() => {
    mouseLive.current = false
    const list = listRef.current
    const el = list?.querySelector('[data-active="true"]')
    if (!list || !el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [activeIdx, filter])

  if (typeof document === 'undefined') return null

  const MENU_W = 268
  const MENU_H = 340
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8))
  // Flip above the caret when there isn't room below it.
  const below = y + 6
  const top = below + MENU_H > window.innerHeight - 8
    ? Math.max(8, y - MENU_H - 22)
    : below

  const menu = (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert block"
      onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
      style={{
        position: 'fixed', left, top, zIndex: 99999,
        background: surface, border: `1px solid ${border}`, borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.28)', padding: 6,
        fontFamily: 'var(--ds-font-body)', width: MENU_W,
        maxHeight: MENU_H, overflowY: 'auto',
      }}>
      <div style={{
        padding: '7px 11px 5px', fontSize: 9.5, color: text3, textTransform: 'uppercase',
        letterSpacing: 0.8, fontWeight: 700, fontFamily: 'var(--ds-font-mono)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ flex: 1 }}>Insert</span>
        <span style={{ opacity: 0.7, textTransform: 'none', letterSpacing: 0 }}>↑↓ ⏎</span>
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: '10px 11px', fontSize: 12.5, color: text3 }}>
          No blocks match “{filter}”
        </div>
      )}

      {filtered.map((cmd, i) => {
        const on = i === activeIdx
        return (
          <button key={cmd.id}
            role="option"
            aria-selected={on}
            data-active={on ? 'true' : 'false'}
            onMouseEnter={() => { if (mouseLive.current) onHover?.(i) }}
            onClick={() => onSelect(cmd.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '7px 10px', border: 'none', borderRadius: 7, cursor: 'pointer',
              background: on ? accentDim : 'transparent',
              color: on ? accent : text,
              fontFamily: 'var(--ds-font-body)', textAlign: 'left',
            }}>
            <span style={{
              width: 27, height: 27, borderRadius: 6, display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: on ? accent : raised, color: on ? '#fff' : text2,
              fontSize: cmd.id === 'code' ? 10 : 12, fontWeight: 700,
              fontFamily: cmd.id === 'code' ? 'var(--ds-font-mono)' : 'var(--ds-font-body)',
            }}>
              {cmd.icon}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 500, fontSize: 13 }}>{cmd.label}</span>
              <span style={{ display: 'block', fontSize: 11, color: on ? accent : text3, opacity: on ? 0.8 : 1, marginTop: 1 }}>
                {cmd.desc}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )

  return createPortal(menu, document.body)
}
