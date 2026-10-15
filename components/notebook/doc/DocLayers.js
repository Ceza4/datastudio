'use client'
import { memo, useEffect, useRef, useState } from 'react'
import Icon from '../../ui/Icon'
import { PT_TO_PX, offsetIn } from '../../../lib/docedit'
import { IMAGE_LAYOUTS, imageLayoutOf } from '../../../lib/docformat'

/*
  components/notebook/doc/DocLayers.js
  --------------------------------------------------------------------------
  What is drawn ON the pages but is not the flowing text: headers and
  footers (double-click the top or bottom of a page to edit, as in Word),
  footnotes at the bottom of their page, a watermark, and the tools that
  appear over a picture or a table you are working in.

  All of it lives inside the page stack's scaled container, positioned in
  the editor's own pixels, so it lines up with the text at every zoom
  (and so none of it needs screen-space rect maths).
  -------------------------------------------------------------------------- */

export const HF_TOKENS = [
  { token: '{page}', label: 'Page number' },
  { token: '{pages}', label: 'Page count' },
  { token: '{title}', label: 'Title' },
  { token: '{date}', label: 'Date' },
]

/** The header/footer texts for one page: { l, c, r }. */
export function hfFor(hf, zone, pageIndex) {
  if (!hf) return zone === 'footer' ? { c: '' } : {}
  if (hf.firstDifferent && pageIndex === 0) return (zone === 'header' ? hf.firstHeader : hf.firstFooter) || {}
  return (zone === 'header' ? hf.header : hf.footer) || {}
}

export function fillTokens(s, { page, pages, title }) {
  return String(s || '')
    .replace(/\{page\}/g, String(page))
    .replace(/\{pages\}/g, String(pages))
    .replace(/\{title\}/g, title || 'Untitled')
    .replace(/\{date\}/g, () => todayLabel())
}
/* One formatter, one label per day: this runs for every header slot of every
   page on every render. */
let dateFmt = null, dateKey = '', dateLabel = ''
function todayLabel() {
  const d = new Date()
  const k = d.toDateString()
  if (k !== dateKey) {
    dateFmt ||= new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    dateKey = k; dateLabel = dateFmt.format(d)
  }
  return dateLabel
}

/* Word puts the header 0.5″ from the top edge; with a narrower top margin
   it moves up so it never sits on the text. */
export function hfGeometry(px, lineH) {
  const top = px.top ?? px.mt, bottom = px.bottom ?? px.mb
  const headTop = Math.max(8, Math.min(48, top - lineH - 6))
  const footTop = Math.max(8, Math.min(48, bottom - lineH - 6))
  return { headTop, footTop }
}

/* pages: [{ top, h, w, x, mt, mb, left, right, label, total }] — the laid-out
   pages (lib/docpages.js + lib/docsections.js), x/top in editor px. A
   landscape section's pages are wider; mirror margins move x and the sides. */
export const HeaderFooterLayer = memo(function HeaderFooterLayer({
  pages, hf, legacyFooter, font, fontPt, pal, title, editing,
  onChange, onClose,
}) {
  const lineH = Math.round(fontPt * PT_TO_PX * 1.3)
  const slot = (zone, i) => {
    if (!hf && zone === 'footer') return legacyFooter && pages.length > 1 ? { c: 'Page {page} of {pages}' } : {}
    return hfFor(hf, zone, i)
  }
  const zoneTop = (zone, i) => {
    const pg = pages[i] || pages[0]
    const { headTop, footTop } = hfGeometry(pg, lineH)
    return zone === 'header' ? pg.top + headTop : pg.top + pg.h - footTop - lineH
  }
  const across = i => { const pg = pages[i] || pages[0]; return { left: pg.x + pg.left, width: pg.w - pg.left - pg.right } }
  const base = {
    position: 'absolute', height: lineH, display: 'flex', gap: 12,
    fontFamily: font, fontSize: fontPt * PT_TO_PX, lineHeight: `${lineH}px`, color: pal.mute, pointerEvents: 'none',
  }
  const out = []
  for (let i = 0; i < pages.length; i++) {
    for (const zone of ['header', 'footer']) {
      const group = pg => (hf?.firstDifferent && pg === 0 ? 'first' : 'rest')
      const isEdit = !!editing && editing.zone === zone && group(i) === group(editing.page)
      const texts = slot(zone, i)
      const y = zoneTop(zone, i)
      if (isEdit && editing.page === i) continue            // the live editor draws this one
      const any = texts.l || texts.c || texts.r
      if (!any && !isEdit) continue
      out.push(
        <div key={`${zone}${i}`} aria-hidden="true" data-ds-hf={zone} style={{ ...base, ...across(i), top: y, opacity: editing && !isEdit ? 0.45 : 1 }}>
          {['l', 'c', 'r'].map(k => (
            <span key={k} style={{ flex: 1, minWidth: 0, textAlign: k === 'l' ? 'left' : k === 'c' ? 'center' : 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {fillTokens(texts[k], { page: pages[i].label, pages: pages[i].total, title })}
            </span>
          ))}
        </div>,
      )
    }
  }
  return (
    <>
      {out}
      {editing && (
        <HfEditor key={`${editing.zone}${editing.page}`} editing={editing} hf={hf} legacy={!hf && legacyFooter}
          top={zoneTop(editing.zone, editing.page)}
          base={{ ...base, ...across(editing.page) }} lineH={lineH} pal={pal} onChange={onChange} onClose={onClose} />
      )}
    </>
  )
}, (a, b) => {
  /* Typing re-renders the document on every key; the layer only needs to when
     what it draws changes. The callbacks are read at event time. */
  for (const k of ['pages', 'hf', 'legacyFooter', 'font', 'fontPt', 'title', 'editing']) if (a[k] !== b[k]) return false
  return a.pal === b.pal || JSON.stringify(a.pal) === JSON.stringify(b.pal)
})

function HfEditor({ editing, hf, legacy, top, base, lineH, pal, onChange, onClose }) {
  const first = !!hf?.firstDifferent && editing.page === 0
  const key = editing.zone === 'header' ? (first ? 'firstHeader' : 'header') : (first ? 'firstFooter' : 'footer')
  const initial = (hf && hf[key]) || (legacy && editing.zone === 'footer' ? { c: 'Page {page} of {pages}' } : {})
  const [vals, setVals] = useState({ l: initial.l || '', c: initial.c || '', r: initial.r || '' })
  const focused = useRef('c')
  const inputs = useRef({})
  const baseHf = () => hf || (legacy ? { footer: { c: 'Page {page} of {pages}' } } : {})
  const commit = next => onChange({ ...baseHf(), [key]: next })
  const set = (k, v) => { const next = { ...vals, [k]: v }; setVals(next); commit(next) }
  const insert = tok => {
    const k = focused.current
    const el = inputs.current[k]
    const at = el?.selectionStart ?? vals[k].length
    const v = vals[k].slice(0, at) + tok + vals[k].slice(el?.selectionEnd ?? at)
    set(k, v)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + tok.length, at + tok.length) })
  }
  useEffect(() => { inputs.current.c?.focus() }, [])
  const label = `${first ? 'First page ' : ''}${editing.zone === 'header' ? 'Header' : 'Footer'}`
  const barTop = editing.zone === 'header' ? top + lineH + 10 : top - 44
  const chip = { height: 26, padding: '0 8px', border: '1px solid var(--ds-border)', borderRadius: 6, background: 'var(--ds-surface)', color: 'var(--ds-text-2)', fontSize: 12, fontFamily: 'var(--ds-font-body)', cursor: 'pointer', whiteSpace: 'nowrap' }
  return (
    <>
      <div data-ds-hf-edit="" onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
        style={{ ...base, top: top - 6, height: lineH + 12, padding: '6px 0', pointerEvents: 'auto', color: pal.text, outline: '1px dashed var(--ds-accent)', outlineOffset: 4, zIndex: 4 }}>
        <span style={{ position: 'absolute', left: -2, top: editing.zone === 'header' ? -24 : lineH + 16, fontFamily: 'var(--ds-font-body)', fontSize: 11, color: 'var(--ds-accent)', lineHeight: 1.4, background: 'var(--ds-accent-dim)', padding: '1px 6px', borderRadius: 4 }}>{label}</span>
        {['l', 'c', 'r'].map(k => (
          <input key={k} ref={el => { inputs.current[k] = el }} value={vals[k]} aria-label={`${label}, ${k === 'l' ? 'left' : k === 'c' ? 'centre' : 'right'}`}
            placeholder={k === 'c' ? 'Type here' : ''}
            onFocus={() => { focused.current = k }}
            onChange={e => set(k, e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; onClose() }
            }}
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: 0,
              font: 'inherit', color: 'inherit', textAlign: k === 'l' ? 'left' : k === 'c' ? 'center' : 'right',
              boxShadow: 'inset 0 -1px 0 var(--ds-border)',
            }} />
        ))}
      </div>
      <div data-ds-hf-bar="" onMouseDown={e => { e.stopPropagation(); if (e.target.tagName === 'BUTTON' || e.target.closest('button')) e.preventDefault() }}
        style={{ position: 'absolute', left: base.left, top: barTop, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', pointerEvents: 'auto' }}>
        {HF_TOKENS.map(t => <button key={t.token} type="button" style={chip} onClick={() => insert(t.token)}>{t.label}</button>)}
        <label style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!hf?.firstDifferent}
            onChange={e => onChange({ ...baseHf(), firstDifferent: e.target.checked })} />
          Different first page
        </label>
        <button type="button" style={chip} onClick={() => { setVals({ l: '', c: '', r: '' }); commit({ l: '', c: '', r: '' }) }}>Remove</button>
        <button type="button" style={{ ...chip, background: 'var(--ds-accent)', color: '#fff', borderColor: 'var(--ds-accent)' }} onClick={onClose}>Close</button>
      </div>
    </>
  )
}

/* ── footnotes ─────────────────────────────────────────────────────────── */

export const NOTE_SEP = 14

export function noteStyle(fontStack, fontPt) {
  const pt = Math.max(8, Math.round(fontPt * 0.83))
  return { fontFamily: fontStack, fontSize: pt * PT_TO_PX, lineHeight: 1.3, paddingTop: 2 }
}

export function FootnoteLayer({ byPage, pages, style, pal, heights, onEdit, focusId, onFocused, onBack }) {
  const out = []
  for (const [p, notes] of byPage) {
    const total = notes.reduce((s, n) => s + (heights.get(n.id) || 20), 0)
    const pg = pages[p] || pages[pages.length - 1]
    const bottom = pg.top + pg.h - pg.mb
    const top = bottom - total
    out.push(
      <div key={p} style={{ position: 'absolute', left: pg.x + pg.left, width: pg.w - pg.left - pg.right, top: top - NOTE_SEP, zIndex: 2 }}>
        <div aria-hidden="true" style={{ height: NOTE_SEP, display: 'flex', alignItems: 'center' }}>
          <span style={{ width: '33%', height: 1, background: pal.rule }} />
        </div>
        {notes.map(n => (
          <Note key={n.id} n={n} style={style} pal={pal} onEdit={onEdit} focus={focusId === n.id} onFocused={onFocused} onBack={onBack} />
        ))}
      </div>,
    )
  }
  return out
}

function Note({ n, style, pal, onEdit, focus, onFocused, onBack }) {
  const ref = useRef(null)
  const noteText = n.text
  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== noteText) el.textContent = noteText
  }, [noteText])
  useEffect(() => {
    if (!focus || !ref.current) return
    const el = ref.current
    el.focus({ preventScroll: true })
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
    onFocused?.()
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div data-ds-note={n.id} style={{ ...style, color: pal.text, display: 'flex', gap: 4 }}>
      <sup style={{ lineHeight: 0, fontSize: '0.75em' }}>{n.n}</sup>
      <span ref={ref} contentEditable suppressContentEditableWarning spellCheck
        role="textbox" aria-label={`Footnote ${n.n}`}
        data-placeholder="Type the note"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault() }
          if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; onBack?.(n.id) }
        }}
        onInput={e => onEdit(n.id, e.currentTarget.textContent)}
        onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')) }}
        style={{ flex: 1, minWidth: 0, outline: 'none', cursor: 'text' }} />
    </div>
  )
}

/* ── watermark ─────────────────────────────────────────────────────────── */

export function WatermarkLayer({ text, pages, pal }) {
  if (!text) return null
  return pages.map((pg, i) => (
    <div key={i} aria-hidden="true" style={{
      position: 'absolute', left: pg.x, top: pg.top, width: pg.w, height: pg.h, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0,
    }}>
      <span style={{
        transform: 'rotate(-45deg)', fontFamily: 'var(--ds-font-body)', fontWeight: 700,
        fontSize: Math.min(140, (pg.w * 1.1) / Math.max(4, text.length)), letterSpacing: 4,
        color: pal.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)', whiteSpace: 'nowrap', textTransform: 'uppercase',
      }}>{text}</span>
    </div>
  ))
}

/* ── picture tools ─────────────────────────────────────────────────────── */

export function offsetLeftIn(el, root) {
  let x = 0, n = el
  while (n && n !== root) { x += n.offsetLeft; n = n.offsetParent }
  return x
}

export function ImageTools({ img, root, scale, contentW, onChange, onCaption, onDelete, onAlt }) {
  const [, force] = useState(0)
  const drag = useRef(null)
  if (!img?.isConnected || !root) return null
  const x = offsetLeftIn(img, root), y = offsetIn(img, root)
  const w = img.offsetWidth, h = img.offsetHeight
  const layout = imageLayoutOf(img)
  const start = e => {
    e.preventDefault(); e.stopPropagation()
    drag.current = { x: e.clientX, w, ratio: h / Math.max(1, w) }
    const move = ev => {
      const d = drag.current
      if (!d) return
      const nw = Math.round(Math.max(32, Math.min(contentW, d.w + (ev.clientX - d.x) / scale)))
      img.style.width = nw + 'px'
      img.style.height = 'auto'
      img.setAttribute('width', String(nw))
      img.removeAttribute('height')
      force(t => t + 1)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      drag.current = null
      onChange()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const btn = { height: 26, minWidth: 26, padding: '0 7px', border: 'none', borderRadius: 6, background: 'none', color: 'var(--ds-text-2)', fontSize: 12, fontFamily: 'var(--ds-font-body)', cursor: 'pointer', whiteSpace: 'nowrap' }
  return (
    <>
      <div aria-hidden="true" style={{ position: 'absolute', left: x - 1, top: y - 1, width: w + 2, height: h + 2, outline: '2px solid var(--ds-accent)', pointerEvents: 'none', zIndex: 3 }} />
      <div role="slider" aria-label="Resize picture" aria-valuenow={w} tabIndex={-1} onPointerDown={start}
        style={{ position: 'absolute', left: x + w - 6, top: y + h - 6, width: 12, height: 12, borderRadius: 4, background: 'var(--ds-accent)', border: '2px solid #fff', cursor: 'nwse-resize', zIndex: 4, boxSizing: 'border-box' }} />
      <div role="toolbar" aria-label="Picture" onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        style={{ position: 'absolute', left: Math.max(0, x), top: Math.max(0, y - 38), zIndex: 4, display: 'flex', alignItems: 'center', gap: 2, padding: 3, background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 8, boxShadow: 'var(--ds-shadow-md)' }}>
        {IMAGE_LAYOUTS.map(l => (
          <button key={l.id} type="button" title={l.label} aria-pressed={layout === l.id}
            onClick={() => onChange(l.id)}
            style={{ ...btn, background: layout === l.id ? 'var(--ds-accent-dim)' : 'none', color: layout === l.id ? 'var(--ds-accent)' : btn.color }}>
            {{ inline: 'Inline', left: 'Left', center: 'Centre', right: 'Right', wrapLeft: 'Wrap ◧', wrapRight: 'Wrap ◨' }[l.id]}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: 'var(--ds-border)', margin: '0 2px' }} />
        <button type="button" style={btn} title="Add a numbered caption under the picture" onClick={onCaption}>Caption</button>
        <button type="button" style={btn} title="Describe the picture for screen readers" onClick={onAlt}>Alt text</button>
        <button type="button" style={btn} title="Back to the picture's own size" onClick={() => { img.style.removeProperty('width'); img.style.removeProperty('height'); img.removeAttribute('width'); onChange() }}>Reset</button>
        <button type="button" style={{ ...btn, color: 'var(--ds-red)' }} title="Delete picture" onClick={onDelete}>Delete</button>
      </div>
    </>
  )
}

/* ── table tools ───────────────────────────────────────────────────────── */

const SHADES = ['', '#F3F1EC', '#FFF4C2', '#DDEFE6', '#DCE8FA', '#F9DEDC', '#E9E3F5']

export function TableTools({ table, root, onOp }) {
  const [menu, setMenu] = useState(null)
  if (!table?.isConnected || !root) return null
  const x = offsetLeftIn(table, root), y = offsetIn(table, root)
  const b = { height: 26, minWidth: 26, padding: '0 6px', border: 'none', borderRadius: 6, background: 'none', color: 'var(--ds-text-2)', fontSize: 12, fontFamily: 'var(--ds-font-body)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }
  const I = (op, icon, title) => <button key={op} type="button" title={title} aria-label={title} style={b} onClick={() => onOp(op)}><Icon name={icon} size={14} /></button>
  return (
    <div role="toolbar" aria-label="Table" onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
      style={{ position: 'absolute', left: x, top: Math.max(0, y - 36), zIndex: 4, display: 'flex', alignItems: 'center', gap: 1, padding: 3, background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 8, boxShadow: 'var(--ds-shadow-md)' }}>
      {I('rowAbove', 'grid-row-insert-above', 'Insert row above')}
      {I('rowBelow', 'grid-row-insert-below', 'Insert row below')}
      {I('colLeft', 'grid-col-insert-left', 'Insert column left')}
      {I('colRight', 'grid-col-insert-right', 'Insert column right')}
      {I('delRow', 'grid-row-delete', 'Delete row')}
      {I('delCol', 'grid-col-delete', 'Delete column')}
      <span style={{ width: 1, height: 18, background: 'var(--ds-border)', margin: '0 2px' }} />
      <button type="button" style={b} title="Header row on or off" onClick={() => onOp('headerRow')}>Header row</button>
      <div style={{ position: 'relative' }}>
        <button type="button" style={b} onClick={() => setMenu(m => (m === 'b' ? null : 'b'))}>Borders ▾</button>
        {menu === 'b' && (
          <div style={{ position: 'absolute', top: 30, left: 0, zIndex: 5, padding: 4, minWidth: 130, background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 8, boxShadow: 'var(--ds-shadow-md)' }}>
            {[['all', 'All borders'], ['outer', 'Outside only'], ['rows', 'Rows only'], ['none', 'No borders']].map(([id, l]) => (
              <button key={id} type="button" style={{ ...b, width: '100%', justifyContent: 'flex-start' }} onClick={() => { setMenu(null); onOp('borders:' + id) }}>{l}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <button type="button" style={b} onClick={() => setMenu(m => (m === 's' ? null : 's'))}>Shading ▾</button>
        {menu === 's' && (
          <div style={{ position: 'absolute', top: 30, left: 0, zIndex: 5, padding: 8, display: 'grid', gridTemplateColumns: 'repeat(4, 22px)', gap: 6, background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 8, boxShadow: 'var(--ds-shadow-md)' }}>
            {SHADES.map(c => (
              <button key={c || 'none'} type="button" title={c ? c : 'No shading'} aria-label={c ? `Shading ${c}` : 'No shading'}
                onClick={() => { setMenu(null); onOp('shade:' + c) }}
                style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--ds-border)', background: c || 'linear-gradient(135deg, #fff 45%, #d33 47%, #d33 53%, #fff 55%)', cursor: 'pointer', padding: 0 }} />
            ))}
          </div>
        )}
      </div>
      <button type="button" style={{ ...b, color: 'var(--ds-red)' }} onClick={() => onOp('delTable')}>Delete table</button>
    </div>
  )
}
