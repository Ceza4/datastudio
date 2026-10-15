'use client'
import { useEffect, useRef } from 'react'
import Icon from '../../ui/Icon'

/*
  components/notebook/doc/DocPanels.js
  The find-and-replace bar (Ctrl+F / Ctrl+H) and the navigation pane (the
  document's headings, click to jump), both part of the block's own chrome
  rather than the scaled page.
  -------------------------------------------------------------------------- */

const inputStyle = {
  height: 26, minWidth: 0, flex: 1, border: '1px solid var(--ds-border)', borderRadius: 6, background: 'var(--ds-base)',
  color: 'var(--ds-text)', padding: '0 8px', fontFamily: 'var(--ds-font-body)', fontSize: 13, outline: 'none',
}
const tbtn = on => ({
  height: 26, minWidth: 26, padding: '0 6px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--ds-font-body)',
  border: `1px solid ${on ? 'var(--ds-accent)' : 'transparent'}`, background: on ? 'var(--ds-accent-dim)' : 'none',
  color: on ? 'var(--ds-accent)' : 'var(--ds-text-2)', whiteSpace: 'nowrap', flexShrink: 0,
})

export function FindBar({ state, count, index, onChange, onNext, onPrev, onReplace, onReplaceAll, onClose, focusTick }) {
  const q = useRef(null)
  useEffect(() => { q.current?.focus(); q.current?.select() }, [focusTick])
  const set = p => onChange({ ...state, ...p })
  const keys = e => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; onClose(); return }
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onPrev(); else onNext() }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); set({ showReplace: true }) }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); q.current?.select() }
  }
  const status = !state.query ? '' : count ? `${index + 1} of ${count}` : 'No results'
  return (
    <div data-ds-findbar="" onMouseDown={e => e.stopPropagation()} style={{
      display: 'grid', gap: 6, padding: '6px 10px', flexShrink: 0,
      background: 'var(--ds-surface)', borderBottom: '1px solid var(--ds-border)', fontFamily: 'var(--ds-font-body)',
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" style={tbtn(false)} title={state.showReplace ? 'Hide replace' : 'Show replace (Ctrl+H)'}
          aria-label="Toggle replace" onClick={() => set({ showReplace: !state.showReplace })}>{state.showReplace ? '▾' : '▸'}</button>
        <Icon name="nav-search" size={14} style={{ color: 'var(--ds-text-3)', flexShrink: 0 }} />
        <input ref={q} value={state.query} placeholder="Find in document" aria-label="Find" onKeyDown={keys}
          onChange={e => set({ query: e.target.value })} style={inputStyle} />
        <span aria-live="polite" style={{ fontSize: 12, color: count || !state.query ? 'var(--ds-text-3)' : 'var(--ds-red)', minWidth: 64, textAlign: 'right', flexShrink: 0 }}>{status}</span>
        <button type="button" style={tbtn(state.matchCase)} title="Match case" aria-pressed={!!state.matchCase} onClick={() => set({ matchCase: !state.matchCase })}>Aa</button>
        <button type="button" style={tbtn(state.wholeWord)} title="Whole words only" aria-pressed={!!state.wholeWord} onClick={() => set({ wholeWord: !state.wholeWord })}>ab|</button>
        <button type="button" style={tbtn(false)} title="Previous (Shift+Enter)" aria-label="Previous match" disabled={!count} onClick={onPrev}>↑</button>
        <button type="button" style={tbtn(false)} title="Next (Enter)" aria-label="Next match" disabled={!count} onClick={onNext}>↓</button>
        <button type="button" style={tbtn(false)} title="Close (Esc)" aria-label="Close find" onClick={onClose}>✕</button>
      </div>
      {state.showReplace && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 58 }}>
          <input value={state.replace} placeholder="Replace with" aria-label="Replace with" onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; onClose() }
            if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) onReplaceAll(); else onReplace() }
          }} onChange={e => set({ replace: e.target.value })} style={inputStyle} />
          <button type="button" className="ds-btn" style={{ height: 26 }} disabled={!count} onClick={onReplace}>Replace</button>
          <button type="button" className="ds-btn" style={{ height: 26 }} disabled={!count} onClick={onReplaceAll}>Replace all</button>
        </div>
      )}
    </div>
  )
}

export function NavPane({ heads, current, onGo, onClose }) {
  return (
    <nav aria-label="Document outline" onMouseDown={e => e.stopPropagation()} style={{
      width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0,
      background: 'var(--ds-surface)', borderRight: '1px solid var(--ds-border)', fontFamily: 'var(--ds-font-body)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--ds-border)' }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ds-text)' }}>Navigation</span>
        <button type="button" onClick={onClose} aria-label="Close navigation" title="Close"
          style={{ width: 24, height: 24, border: 'none', background: 'none', borderRadius: 6, cursor: 'pointer', color: 'var(--ds-text-3)' }}>✕</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: 4 }}>
        {!heads.length && <div style={{ padding: 10, fontSize: 12, color: 'var(--ds-text-3)', lineHeight: 1.5 }}>Headings appear here. Use Heading 1–3 (Ctrl+Alt+1–3) to build an outline.</div>}
        {heads.map((h, i) => (
          <button key={i} type="button" onClick={() => onGo(i)} title={`Page ${h.page}`}
            onMouseEnter={e => { if (i !== current) e.currentTarget.style.background = 'var(--ds-raised)' }}
            onMouseLeave={e => { if (i !== current) e.currentTarget.style.background = 'none' }}
            style={{
              display: 'flex', gap: 6, width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, cursor: 'pointer',
              padding: `5px 8px 5px ${8 + Math.max(0, h.level - 1) * 12}px`,
              background: i === current ? 'var(--ds-accent-dim)' : 'none',
              color: i === current ? 'var(--ds-accent)' : h.level <= 1 ? 'var(--ds-text)' : 'var(--ds-text-2)',
              fontSize: h.level <= 1 ? 13 : 12, fontWeight: h.level <= 1 ? 600 : 400,
            }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.text}</span>
            <span style={{ fontSize: 11, color: 'var(--ds-text-3)', flexShrink: 0 }}>{h.page}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
