'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/* SlashMenu — renders via portal into document.body so it's never
   affected by CSS transforms on parent containers (the notebook
   canvas uses transform for panning, which breaks position:fixed). */

const COMMANDS = [
  { id: 'h1', label: 'Heading 1', desc: 'Large section heading', icon: 'H1', keywords: 'heading title' },
  { id: 'h2', label: 'Heading 2', desc: 'Medium section heading', icon: 'H2', keywords: 'heading subtitle' },
  { id: 'h3', label: 'Heading 3', desc: 'Small section heading', icon: 'H3', keywords: 'heading' },
  { id: 'bullet', label: 'Bullet list', desc: 'Unordered list', icon: '•', keywords: 'bullet unordered list' },
  { id: 'numbered', label: 'Numbered list', desc: 'Ordered list with numbers', icon: '1.', keywords: 'numbered ordered list' },
  { id: 'checklist', label: 'Checklist', desc: 'To-do items with checkboxes', icon: '☐', keywords: 'checklist todo checkbox task' },
  { id: 'divider', label: 'Divider', desc: 'Horizontal separator line', icon: '—', keywords: 'divider line separator rule' },
  { id: 'code', label: 'Code block', desc: 'Monospaced code snippet', icon: '</>', keywords: 'code snippet pre monospace' },
]

export default function SlashMenu({ x, y, filter, colors, onSelect, onClose }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const ref = useRef(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const q = (filter || '').toLowerCase()
  const filtered = COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(q) || cmd.keywords.toLowerCase().includes(q)
  )

  useEffect(() => { setActiveIdx(0) }, [filter])

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation()
        if (filtered.length > 0) onSelect(filtered[Math.min(activeIdx, filtered.length - 1)].id)
        return
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [filtered, activeIdx, onSelect, onClose])

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handleClickOutside) }
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 260)
  const top = Math.min(y + 4, window.innerHeight - 340)

  const menu = (
    <div ref={ref} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, zIndex: 99999,
        background: surface, border: `1px solid ${border}`, borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.3)', padding: 6,
        fontFamily: "'DM Sans',sans-serif", minWidth: 240, maxHeight: 320, overflowY: 'auto',
      }}>
      <div style={{ padding: '8px 12px 6px', fontSize: 11, color: text3, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        Commands
      </div>
      {filtered.length === 0 && (
        <div style={{ padding: '12px', fontSize: 13, color: text3 }}>No matching commands</div>
      )}
      {filtered.map((cmd, i) => (
        <button key={cmd.id}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onSelect(cmd.id) }}
          onMouseEnter={() => setActiveIdx(i)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%',
            padding: '9px 12px', border: 'none', borderRadius: 8, cursor: 'pointer',
            background: i === activeIdx ? accentDim : 'transparent',
            color: i === activeIdx ? accent : text,
            fontFamily: "'DM Sans',sans-serif", fontSize: 14, textAlign: 'left',
          }}>
          <span style={{
            width: 32, height: 32, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: i === activeIdx ? accent : raised, color: i === activeIdx ? '#fff' : text2,
            fontSize: 13, fontWeight: 700, flexShrink: 0,
            fontFamily: cmd.id === 'code' ? "'DM Mono',monospace" : "'DM Sans',sans-serif",
          }}>
            {cmd.icon}
          </span>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>{cmd.label}</div>
            <div style={{ fontSize: 12, color: i === activeIdx ? accent : text3, marginTop: 1 }}>{cmd.desc}</div>
          </div>
        </button>
      ))}
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(menu, document.body)
}
