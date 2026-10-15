'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '../../../lib/theme'
import { FloatAt, Item, Sep, K, fieldStyle } from './DocUi'

/*
  components/notebook/doc/DocMenus.js
  The Document block's right-click menu, link popover, page jump, zoom menu
  and the paste-options chip.
  -------------------------------------------------------------------------- */

/* The canvas's right-click menu is about BLOCKS; inside the text you get the
   text's, Word's order. Context-dependent rows: a table's rows and columns
   when the caret is in a table, Accept/Reject on a tracked change, Resolve on
   a comment. */
export function DocMenu({ at, ctx, onPick, onClose }) {
  const it = (act, label, hint, disabled, extra) => <Item key={act} label={label} hint={hint} disabled={disabled} onPick={() => onPick(act)} {...extra} />
  return (
    <FloatAt x={at.x} y={at.y} style={{ minWidth: 240 }} onClose={onClose} label="Document menu">
      {it('cut', 'Cut', K('X'), !ctx.hasSelection)}
      {it('copy', 'Copy', K('C'), !ctx.hasSelection)}
      {it('paste', 'Paste', K('V'))}
      {it('pasteplain', 'Paste as plain text', K('Shift+V'))}
      <Sep />
      {ctx.change && <>
        {it('acceptChange', `Accept ${ctx.change === 'ins' ? 'insertion' : 'deletion'}`)}
        {it('rejectChange', `Reject ${ctx.change === 'ins' ? 'insertion' : 'deletion'}`)}
        <Sep />
      </>}
      {ctx.table && <>
        {it('rowAbove', 'Insert row above')}
        {it('rowBelow', 'Insert row below')}
        {it('colLeft', 'Insert column left')}
        {it('colRight', 'Insert column right')}
        {it('delRow', 'Delete row')}
        {it('delCol', 'Delete column')}
        {it('delTable', 'Delete table', null, false, { danger: true })}
        <Sep />
      </>}
      {it('comment', ctx.comment ? 'Open comment' : 'New comment', K('Alt+M'))}
      {it('link', ctx.link ? 'Edit link…' : 'Link…', K('K'))}
      {ctx.link && it('unlink', 'Remove link')}
      {it('footnote', 'Insert footnote', K('Alt+F'))}
      <Sep />
      {it('h1', 'Heading 1', K('Alt+1'))}
      {it('h2', 'Heading 2', K('Alt+2'))}
      {it('p', 'Normal text', K('Alt+0'))}
      {it('clear', 'Clear formatting', K('Space'))}
      {it('paragraph', 'Paragraph…')}
      {it('pagebreak', 'Page break', K('Enter'))}
      <Sep />
      {it('all', 'Select all', K('A'))}
      <div style={{ padding: '6px 10px 2px', fontSize: 11, color: 'var(--ds-text-3)', fontFamily: 'var(--ds-font-body)' }}>Shift+right-click for spelling</div>
    </FloatAt>
  )
}

export function LinkPop({ at, onApply, onRemove, onClose }) {
  const [href, setHref] = useState(at.href)
  const [label, setLabel] = useState('')
  const [err, setErr] = useState('')
  const go = () => { const m = onApply(href.trim(), label.trim()); if (m) setErr(m) }
  return (
    <FloatAt x={at.x} y={at.y} role="dialog" label="Link" onClose={onClose} style={{ width: 300, padding: 10, display: 'grid', gap: 8 }}>
      {at.text === '' && (
        <input placeholder="Text to show" value={label} onChange={e => setLabel(e.target.value)} style={fieldStyle}
          onKeyDown={e => { if (e.key === 'Enter') go() }} />
      )}
      <input data-autofocus="" placeholder="Paste or type a link" value={href} onChange={e => { setHref(e.target.value); setErr('') }}
        style={{ ...fieldStyle, borderColor: err ? 'var(--ds-red)' : 'var(--ds-border)' }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go() } }} />
      {err && <div style={{ fontSize: 12, color: 'var(--ds-red)' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--ds-text-3)', marginRight: 'auto' }}>{K('click')} opens a link</span>
        {onRemove && <button className="ds-btn" onClick={onRemove}>Remove</button>}
        <button className="ds-btn ds-btn-primary" onClick={go}>Apply</button>
      </div>
    </FloatAt>
  )
}

/** "Page 2 of 4" — a click lists the pages to jump to. */
export function PageJump({ current, pages, onGo }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const r = open && btnRef.current ? btnRef.current.getBoundingClientRect() : null
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title="Go to page"
        style={{ background: 'none', border: 'none', padding: '1px 4px', margin: '-1px -4px', borderRadius: 4, cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
        Page {current} of {pages}
      </button>
      {r && (
        <FloatAt x={r.left} y={Math.max(8, r.top - Math.min(280, 36 + pages * 30))} onClose={() => setOpen(false)} style={{ minWidth: 130, maxHeight: 280, overflowY: 'auto' }} label="Go to page">
          {Array.from({ length: pages }, (_, i) => (
            <Item key={i} label={`Page ${i + 1}`} on={i + 1 === current} onPick={() => { setOpen(false); onGo(i + 1) }} />
          ))}
        </FloatAt>
      )}
    </>
  )
}

export const ZOOMS = [
  { id: 'fit', label: 'Fit width' },
  { id: 'page', label: 'Whole page' },
  { id: 0.5, label: '50%' }, { id: 0.75, label: '75%' }, { id: 1, label: '100%' },
  { id: 1.25, label: '125%' }, { id: 1.5, label: '150%' }, { id: 2, label: '200%' },
]

export function ZoomMenu({ zoom, scale, onZoom }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const r = open && btnRef.current ? btnRef.current.getBoundingClientRect() : null
  const step = dir => {
    const cur = typeof zoom === 'number' ? zoom : scale
    const levels = [0.5, 0.75, 1, 1.25, 1.5, 2]
    const next = dir > 0 ? levels.find(l => l > cur + 0.01) : [...levels].reverse().find(l => l < cur - 0.01)
    if (next) onZoom(next)
  }
  const small = { width: 20, height: 20, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', borderRadius: 4, padding: 0, font: 'inherit' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <button type="button" style={small} title="Zoom out" aria-label="Zoom out" onClick={() => step(-1)}>−</button>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title="Zoom"
        style={{ background: 'none', border: 'none', padding: '1px 4px', borderRadius: 4, cursor: 'pointer', color: 'inherit', font: 'inherit', minWidth: 44 }}>
        {zoom === 'fit' ? 'Fit' : zoom === 'page' ? 'Page' : ''} {Math.round(scale * 100)}%
      </button>
      <button type="button" style={small} title="Zoom in" aria-label="Zoom in" onClick={() => step(1)}>+</button>
      {r && (
        <FloatAt x={r.left} y={Math.max(8, r.top - 290)} onClose={() => setOpen(false)} style={{ minWidth: 150 }} label="Zoom">
          {ZOOMS.map(z => <Item key={z.id} label={z.label} on={zoom === z.id} onPick={() => { setOpen(false); onZoom(z.id) }} />)}
        </FloatAt>
      )}
    </span>
  )
}

/** Word's paste options: after a formatted paste, "Text only" for a few
 *  seconds. Anchored in screen space at the paste point. */
export function PasteChip({ at, onTextOnly, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000)
    const key = e => { if (e.key === 'Escape') onDone() }
    window.addEventListener('keydown', key)
    return () => { clearTimeout(t); window.removeEventListener('keydown', key) }
  }, [onDone])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div data-ds-doc-pop="" style={{
      position: 'fixed', left: Math.min(at.x, window.innerWidth - 190), top: Math.min(at.y + 8, window.innerHeight - 40), zIndex: Z.popover,
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', borderRadius: 8,
      background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', boxShadow: 'var(--ds-shadow-md)',
      fontFamily: 'var(--ds-font-body)', fontSize: 12, color: 'var(--ds-text-2)',
    }}>
      Pasted with formatting
      <button className="ds-btn" onMouseDown={e => { e.preventDefault(); onTextOnly() }} style={{ height: 24 }}>Text only</button>
    </div>,
    document.body,
  )
}
