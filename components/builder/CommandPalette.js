'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { rowTitle } from '../../lib/database'
import { Z } from '../../lib/theme'

/*
  components/builder/CommandPalette.js
  --------------------------------------------------------------------------
  Builder Phase 1 (24 Sep 2026). Ctrl+K on Windows, ⌘K on Mac.

  Two kinds of result, in this order:
    · RECORDS: rows of every Database block on this sheet, grouped by
      database. Enter opens the row in a Record block.
    · COMMANDS: what the canvas can do from anywhere (add a block, toggle
      snap). The list is handed in by the canvas, so this file knows nothing
      about the canvas's internals.

  Same keyboard model as the Add menu and the link picker: type to filter,
  arrows move straight through the groups, Enter runs, Esc closes. Portalled to
  <body> and fixed, because the canvas zoom transform would scale it.
  -------------------------------------------------------------------------- */

const norm = s => String(s || '').toLowerCase()

export default function CommandPalette({ databases, commands, colors, onOpenRecord, onClose }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const { flat, groups } = useMemo(() => {
    const query = norm(q).trim()
    const groups = []
    for (const d of databases) {
      const rows = (d.db?.rows || [])
        .map(r => ({ kind: 'record', sourceId: d.id, rowId: r.id, label: rowTitle(d.db, r), sub: d.label }))
        .filter(r => !query || norm(r.label).includes(query))
        .slice(0, query ? 8 : 4)
      if (rows.length) groups.push({ name: d.label, items: rows })
    }
    const cmds = commands.filter(c => !query || norm(c.label + ' ' + (c.keywords || '')).includes(query))
    if (cmds.length) groups.push({ name: 'Commands', items: cmds.map(c => ({ kind: 'command', ...c })) })
    return { groups, flat: groups.flatMap(g => g.items) }
  }, [q, databases, commands])

  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  function run(item) {
    if (!item) return
    onClose()
    if (item.kind === 'record') onOpenRecord(item.sourceId, item.rowId)
    else item.run?.()
  }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[sel]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    e.stopPropagation()
  }

  if (typeof document === 'undefined') return null
  let i = -1
  return createPortal(
    <div onMouseDown={onClose} data-kbd-zone
      style={{ position: 'fixed', inset: 0, zIndex: Z.popover, background: 'rgba(0,0,0,0.28)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 'min(14vh, 120px)' }}>
      <div role="dialog" aria-label="Command palette" onMouseDown={e => e.stopPropagation()} onKeyDown={onKey}
        style={{ width: 'min(560px, calc(100vw - 32px))', maxHeight: '60vh', display: 'flex', flexDirection: 'column', background: surface, border: `1px solid ${border}`, borderRadius: 12, boxShadow: 'var(--ds-shadow-lg)', overflow: 'hidden', fontFamily: 'var(--ds-font-body)' }}>
        <div className="ds-searchrow">
          <Icon name="nav-search" size="sm" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search records or run a command…" aria-label="Search records and commands" />
          <kbd className="ds-kbd">esc</kbd>
        </div>
        <div ref={listRef} role="listbox" style={{ overflowY: 'auto', padding: 5 }}>
          {!flat.length && <div style={{ padding: '22px 10px', textAlign: 'center', color: text3, fontSize: 13 }}>Nothing matches “{q}”.</div>}
          {groups.map(g => (
            <div key={g.name}>
              <div style={{ padding: '8px 10px 4px', fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: text3 }}>{g.name}</div>
              {g.items.map(item => {
                i += 1
                const on = i === sel, me = i
                return (
                  <button key={item.kind + (item.rowId || item.id)} role="option" aria-selected={on} data-sel={on}
                    onMouseEnter={() => setSel(me)} onClick={() => run(item)}
                    style={{ border: 'none', cursor: 'pointer', fontFamily: 'var(--ds-font-body)', display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 36, padding: '0 10px', borderRadius: 8, textAlign: 'left', background: on ? accentDim : 'transparent', color: on ? accent : text }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', background: on ? accent : raised, color: on ? '#fff' : text2, flexShrink: 0 }}>
                      <Icon name={item.kind === 'record' ? 'nav-notebook' : (item.icon || 'action-add')} size={12} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                    {item.hint && <kbd className="ds-kbd">{item.hint}</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${border}`, padding: '6px 12px', fontSize: 11, fontFamily: 'var(--ds-font-mono)', color: text3, display: 'flex', gap: 10 }}>
          <span>↑↓ move</span><span>⏎ open</span><span>esc close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
