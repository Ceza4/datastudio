'use client'
import { useEffect, useMemo, useState } from 'react'
import { Dialog, Btn, Field, fieldStyle } from './DocUi'
import { DOC_FONTS, LINE_SPACINGS, CUSTOM_MIN_IN, CUSTOM_MAX_IN } from '../../../lib/pagesetup'
import { SWATCHES, INK_SWATCH } from '../../../lib/theme'
import { CITE_STYLES, inText, referenceHtml, newSourceId } from '../../../lib/doccite'
import { listVersions, saveVersion } from '../../../lib/docversions'
import { sanitizeEditorHtml } from '../../../lib/sanitize'
import { timeLabel } from '../../../lib/doccomments'

/*
  components/notebook/doc/DocDialogs.js
  --------------------------------------------------------------------------
  The Document block's dialogs: Word count, Paragraph, Font, Sources
  (citations), Version history, Custom page size, Alt text and Watermark.
  Each is a real modal (focus in, Tab trapped, Esc closes, focus returns),
  from DocUi's Dialog.
  -------------------------------------------------------------------------- */

const row = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }
const sectionTitle = { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-2)', margin: '12px 0 8px' }

/* ── Word count ──────────────────────────────────────────────────────── */

export function statsOf(text) {
  const t = String(text || '').replace(/​/g, '')
  const words = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length
  return { words, chars: t.replace(/\n/g, '').length, charsNoSpaces: t.replace(/\s/g, '').length }
}

export function StatsDialog({ stats, onClose }) {
  const rows = [
    ['Pages', stats.pages],
    ['Words', stats.words],
    ['Characters (no spaces)', stats.charsNoSpaces],
    ['Characters (with spaces)', stats.chars],
    ['Paragraphs', stats.paragraphs],
    ['Footnotes', stats.notes],
    ['Comments', stats.comments],
  ]
  return (
    <Dialog title="Word count" width={340} onClose={onClose} footer={<Btn primary onClick={onClose}>Close</Btn>}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '6px 0', color: 'var(--ds-text-2)' }}>{k}</td>
              <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--ds-text)', fontWeight: 600 }}>{Number(v || 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stats.selection && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ds-text-3)' }}>
          Selection: {stats.selection.words.toLocaleString()} words, {stats.selection.chars.toLocaleString()} characters
        </div>
      )}
    </Dialog>
  )
}

/* ── Paragraph ───────────────────────────────────────────────────────── */

const PX_IN = 96, PX_PT = 96 / 72
const r2 = n => Math.round(n * 100) / 100

/** The dialog's values from a paragraph's computed style. */
export function paragraphValues(p) {
  if (!p) return null
  const cs = getComputedStyle(p)
  const left = parseFloat(cs.marginLeft) || 0
  const indent = parseFloat(cs.textIndent) || 0
  const fs = parseFloat(cs.fontSize) || 16
  const lh = cs.lineHeight === 'normal' ? 1.2 : (parseFloat(cs.lineHeight) || fs * 1.5) / fs
  const special = indent > 0.5 ? 'first' : indent < -0.5 ? 'hanging' : 'none'
  return {
    align: cs.textAlign === 'start' ? 'left' : cs.textAlign === 'end' ? 'right' : cs.textAlign,
    left: r2((special === 'hanging' ? left + indent : left) / PX_IN),
    right: r2((parseFloat(cs.marginRight) || 0) / PX_IN),
    special, by: r2(Math.abs(indent) / PX_IN),
    before: Math.round((parseFloat(cs.marginTop) || 0) / PX_PT),
    after: Math.round((parseFloat(cs.marginBottom) || 0) / PX_PT),
    line: r2(lh),
  }
}

export function ParagraphDialog({ initial, onApply, onClose }) {
  const [v, setV] = useState(initial)
  const set = (k, x) => setV(s => ({ ...s, [k]: x }))
  const num = (k, min, max) => { const n = Number(v[k]); return Number.isFinite(n) && n >= min && n <= max }
  const ok = num('left', 0, 10) && num('right', 0, 10) && num('by', 0, 5) && num('before', 0, 200) && num('after', 0, 200) && num('line', 0.5, 5)
  const apply = () => { if (ok) onApply({ ...v, left: Number(v.left), right: Number(v.right), by: Number(v.by), before: Number(v.before), after: Number(v.after), line: Number(v.line) }) }
  const n = (k, step, label, unit) => (
    <Field label={`${label} (${unit})`}>
      <input type="number" step={step} value={v[k]} onChange={e => set(k, e.target.value)} style={fieldStyle}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply() } }} />
    </Field>
  )
  return (
    <Dialog title="Paragraph" width={440} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!ok} onClick={apply}>OK</Btn></>}>
      <Field label="Alignment">
        <select value={v.align} onChange={e => set('align', e.target.value)} style={fieldStyle}>
          <option value="left">Left</option><option value="center">Centred</option>
          <option value="right">Right</option><option value="justify">Justified</option>
        </select>
      </Field>
      <div style={sectionTitle}>Indentation</div>
      <div style={row}>
        {n('left', 0.1, 'Left', 'in')}
        {n('right', 0.1, 'Right', 'in')}
        <Field label="Special">
          <select value={v.special} onChange={e => set('special', e.target.value)} style={fieldStyle}>
            <option value="none">None</option><option value="first">First line</option><option value="hanging">Hanging</option>
          </select>
        </Field>
        {n('by', 0.1, 'By', 'in')}
      </div>
      <div style={sectionTitle}>Spacing</div>
      <div style={row}>
        {n('before', 1, 'Before', 'pt')}
        {n('after', 1, 'After', 'pt')}
        <Field label="Line spacing">
          <select value={LINE_SPACINGS.some(s => s.id === Number(v.line)) ? String(Number(v.line)) : 'custom'}
            onChange={e => { if (e.target.value !== 'custom') set('line', Number(e.target.value)) }} style={fieldStyle}>
            {LINE_SPACINGS.map(s => <option key={s.id} value={String(s.id)}>{s.label}</option>)}
            <option value="custom">Multiple…</option>
          </select>
        </Field>
        {n('line', 0.05, 'Multiple', '×')}
      </div>
      {!ok && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--ds-red)' }}>Check the numbers: indents 0–10″, spacing 0–200 pt, line spacing 0.5–5.</div>}
    </Dialog>
  )
}

/** Write the dialog's values to paragraphs. */
export function applyParagraphValues(paras, v) {
  for (const p of paras) {
    p.style.textAlign = v.align === 'left' ? '' : v.align
    const hanging = v.special === 'hanging' ? v.by : 0
    const left = v.left + hanging
    p.style.marginLeft = left ? left + 'in' : ''
    p.style.marginRight = v.right ? v.right + 'in' : ''
    p.style.textIndent = v.special === 'first' ? v.by + 'in' : v.special === 'hanging' ? -v.by + 'in' : ''
    p.style.marginTop = v.before + 'pt'
    p.style.marginBottom = v.after + 'pt'
    p.style.lineHeight = String(v.line)
    if (!p.getAttribute('style')) p.removeAttribute('style')
  }
}

/* ── Font ────────────────────────────────────────────────────────────── */

export function FontDialog({ initial, onApply, onClose }) {
  const [v, setV] = useState(initial)
  const set = (k, x) => setV(s => ({ ...s, [k]: x }))
  const sizeOk = Number(v.size) >= 6 && Number(v.size) <= 200
  const stack = DOC_FONTS.find(f => f.name === v.font)?.stack || 'inherit'
  const check = (k, label) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-text-2)' }}>
      <input type="checkbox" checked={!!v[k]} onChange={e => set(k, e.target.checked)} /> {label}
    </label>
  )
  return (
    <Dialog title="Font" width={460} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!sizeOk} onClick={() => onApply({ ...v, size: Number(v.size) })}>OK</Btn></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <Field label="Font">
          <select value={v.font} onChange={e => set('font', e.target.value)} style={fieldStyle}>
            {DOC_FONTS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Size (pt)">
          <input type="number" min={6} max={200} value={v.size} onChange={e => set('size', e.target.value)} style={{ ...fieldStyle, borderColor: sizeOk ? 'var(--ds-border)' : 'var(--ds-red)' }} />
        </Field>
      </div>
      <div style={sectionTitle}>Style</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {check('bold', 'Bold')}{check('italic', 'Italic')}{check('underline', 'Underline')}{check('strike', 'Strikethrough')}
      </div>
      <div style={sectionTitle}>Effects</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {check('smallCaps', 'Small caps')}{check('allCaps', 'All caps')}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-text-2)' }}>
          <input type="radio" name="dsvpos" checked={v.pos === 'sup'} onChange={() => set('pos', 'sup')} /> Superscript
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-text-2)' }}>
          <input type="radio" name="dsvpos" checked={v.pos === 'sub'} onChange={() => set('pos', 'sub')} /> Subscript
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-text-2)' }}>
          <input type="radio" name="dsvpos" checked={!v.pos} onChange={() => set('pos', '')} /> Normal position
        </label>
      </div>
      <div style={sectionTitle}>Colour</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[INK_SWATCH, ...SWATCHES].map(sw => (
          <button key={sw.name} type="button" title={sw.name} aria-label={`Colour ${sw.name}`} aria-pressed={v.color === sw.value}
            onClick={() => set('color', sw.value)}
            style={{ width: 22, height: 22, borderRadius: 12, background: sw.value, cursor: 'pointer', padding: 0, border: `2px solid ${v.color === sw.value ? 'var(--ds-text)' : 'transparent'}` }} />
        ))}
      </div>
      <div style={sectionTitle}>Preview</div>
      <div style={{
        border: '1px solid var(--ds-border)', borderRadius: 6, padding: '14px 12px', background: '#fff', color: v.color || '#1A1917',
        fontFamily: stack, fontSize: Math.min(40, Number(v.size) * PX_PT || 16), fontWeight: v.bold ? 700 : 400, fontStyle: v.italic ? 'italic' : 'normal',
        textDecoration: [v.underline && 'underline', v.strike && 'line-through'].filter(Boolean).join(' ') || 'none',
        fontVariant: v.smallCaps ? 'small-caps' : 'normal', textTransform: v.allCaps ? 'uppercase' : 'none',
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}>The quick brown fox{v.pos === 'sup' ? <sup>2</sup> : v.pos === 'sub' ? <sub>2</sub> : ''}</div>
    </Dialog>
  )
}

/* ── Sources (citations) ─────────────────────────────────────────────── */

const EMPTY_SRC = { type: 'book', authors: '', year: '', title: '', container: '', publisher: '', pages: '', url: '' }

export function SourcesDialog({ sources, style, onSave, onInsert, onClose }) {
  const [list, setList] = useState(sources || [])
  const [sel, setSel] = useState(list[0]?.id || null)
  const [draft, setDraft] = useState(null)       // editing/adding: a source object
  const [st, setSt] = useState(style || 'apa')
  const cur = list.find(s => s.id === sel)
  const setD = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const saveDraft = () => {
    if (!draft.title.trim() && !draft.authors.trim()) return
    const next = draft.id ? list.map(s => (s.id === draft.id ? draft : s)) : [...list, { ...draft, id: newSourceId() }]
    setList(next)
    setSel(draft.id || next[next.length - 1].id)
    setDraft(null)
    onSave(next, st)
  }
  const f = (k, label, ph) => (
    <Field label={label}><input value={draft[k]} placeholder={ph} onChange={e => setD(k, e.target.value)} style={fieldStyle} /></Field>
  )
  return (
    <Dialog title="Citations and sources" width={620} onClose={onClose}
      footer={draft ? <><Btn onClick={() => setDraft(null)}>Cancel</Btn><Btn primary onClick={saveDraft}>{draft.id ? 'Save source' : 'Add source'}</Btn></>
        : <>
          <select value={st} onChange={e => { setSt(e.target.value); onSave(list, e.target.value) }} style={{ ...fieldStyle, width: 120, marginRight: 'auto' }} aria-label="Citation style">
            {CITE_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Btn onClick={onClose}>Close</Btn>
          <Btn primary disabled={!cur} onClick={() => cur && onInsert(cur, st)}>Insert citation</Btn>
        </>}>
      {draft ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={row}>
            <Field label="Type">
              <select value={draft.type} onChange={e => setD('type', e.target.value)} style={fieldStyle}>
                <option value="book">Book</option><option value="article">Journal article</option><option value="web">Web page</option><option value="report">Report</option>
              </select>
            </Field>
            {f('year', 'Year', '2026')}
          </div>
          {f('authors', 'Authors', 'Oke, Timothy R.; Smith, Jane')}
          {f('title', 'Title', 'The energetic basis of the urban heat island')}
          <div style={row}>
            {f('container', draft.type === 'web' ? 'Website' : 'Journal or book', 'Quarterly Journal of the Royal Meteorological Society')}
            {f('pages', 'Pages', '1–24')}
          </div>
          <div style={row}>
            {f('publisher', 'Publisher', 'Wiley')}
            {f('url', 'Link', 'https://doi.org/…')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ds-text-3)' }}>Separate authors with a semicolon, each as Last, First.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12, minHeight: 240 }}>
          <div style={{ border: '1px solid var(--ds-border)', borderRadius: 8, overflowY: 'auto', maxHeight: 320 }}>
            {!list.length && <div style={{ padding: 12, fontSize: 12, color: 'var(--ds-text-3)' }}>No sources yet.</div>}
            {list.map(s => (
              <button key={s.id} type="button" onClick={() => setSel(s.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--ds-border)', background: s.id === sel ? 'var(--ds-accent-dim)' : 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ds-text)' }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || 'Untitled'}</div>
                <div style={{ fontSize: 11, color: 'var(--ds-text-3)' }}>{inText(s, st)}</div>
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn onClick={() => setDraft({ ...EMPTY_SRC })}>New source</Btn>
              <Btn disabled={!cur} onClick={() => setDraft({ ...cur })}>Edit</Btn>
              <Btn disabled={!cur} onClick={() => { const next = list.filter(s => s.id !== sel); setList(next); setSel(next[0]?.id || null); onSave(next, st) }}>Delete</Btn>
            </div>
            {cur && (
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ds-text-2)', border: '1px solid var(--ds-border)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--ds-text-3)', marginBottom: 6 }}>In the text: {inText(cur, st)}</div>
                <div dangerouslySetInnerHTML={{ __html: sanitizeEditorHtml(referenceHtml(cur, st)) }} />
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

/* ── Version history ─────────────────────────────────────────────────── */

export function VersionsDialog({ docId, current, onRestore, onClose }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const load = () => listVersions(docId).then(l => { setList(l); setSel(s => s || l[0]?.key || null) }).catch(e => setErr(e.message || 'Could not read versions.'))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const v = list?.find(x => x.key === sel)
  const preview = useMemo(() => (v ? sanitizeEditorHtml(v.content) : ''), [v])
  return (
    <Dialog title="Version history" width={720} onClose={onClose}
      footer={<>
        <span style={{ fontSize: 11, color: 'var(--ds-text-3)', marginRight: 'auto' }}>Kept in this browser; a version is saved every few minutes while you write.</span>
        <Btn onClick={() => saveVersion(docId, current, 'Saved by hand').then(load)}>Save a version now</Btn>
        <Btn primary disabled={!v} onClick={() => v && onRestore(v.content)}>Restore this version</Btn>
      </>}>
      {err && <div role="alert" style={{ fontSize: 13, color: 'var(--ds-red)' }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, height: 380 }}>
        <div style={{ overflowY: 'auto', border: '1px solid var(--ds-border)', borderRadius: 8 }}>
          {list && !list.length && <div style={{ padding: 12, fontSize: 12, color: 'var(--ds-text-3)' }}>No versions yet. One is saved after a few minutes of writing, or now with the button below.</div>}
          {(list || []).map(x => (
            <button key={x.key} type="button" onClick={() => setSel(x.key)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--ds-border)', background: x.key === sel ? 'var(--ds-accent-dim)' : 'none', cursor: 'pointer' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)' }}>{new Date(x.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              <div style={{ fontSize: 11, color: 'var(--ds-text-3)' }}>{x.words.toLocaleString()} words{x.label ? ` · ${x.label}` : ''} · {timeLabel(new Date(x.at).toISOString())}</div>
            </button>
          ))}
        </div>
        <div style={{ overflowY: 'auto', border: '1px solid var(--ds-border)', borderRadius: 8, padding: '16px 20px', background: '#fff', color: '#1A1917', fontSize: 14, lineHeight: 1.5 }}
          dangerouslySetInnerHTML={{ __html: preview || '<p style="color:#8A877F">Pick a version to preview it.</p>' }} />
      </div>
    </Dialog>
  )
}

/* ── Custom page size, alt text, watermark ───────────────────────────── */

export function PageSizeDialog({ initial, onApply, onClose }) {
  const [w, setW] = useState(String(initial?.w ?? 8.27))
  const [h, setH] = useState(String(initial?.h ?? 11.69))
  const ok = [w, h].every(x => Number(x) >= CUSTOM_MIN_IN && Number(x) <= CUSTOM_MAX_IN)
  return (
    <Dialog title="Custom page size" width={340} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!ok} onClick={() => onApply({ w: Number(w), h: Number(h) })}>OK</Btn></>}>
      <div style={row}>
        <Field label="Width (in)"><input type="number" step={0.1} value={w} onChange={e => setW(e.target.value)} style={fieldStyle} /></Field>
        <Field label="Height (in)"><input type="number" step={0.1} value={h} onChange={e => setH(e.target.value)} style={fieldStyle} /></Field>
      </div>
      {!ok && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--ds-red)' }}>Each side must be {CUSTOM_MIN_IN}–{CUSTOM_MAX_IN} inches.</div>}
    </Dialog>
  )
}

export function TextDialog({ title, label, initial, placeholder, hint, onApply, onClose, multiline }) {
  const [v, setV] = useState(initial || '')
  return (
    <Dialog title={title} width={380} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={() => onApply(v.trim())}>OK</Btn></>}>
      <Field label={label} hint={hint}>
        {multiline
          ? <textarea value={v} placeholder={placeholder} rows={3} onChange={e => setV(e.target.value)} style={{ ...fieldStyle, height: 'auto', padding: 8, resize: 'vertical' }} />
          : <input value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} style={fieldStyle}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onApply(v.trim()) } }} />}
      </Field>
    </Dialog>
  )
}
