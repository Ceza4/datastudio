'use client'
import { useState } from 'react'
import { Dialog, Btn, fieldStyle } from './DocUi'
import { NUM_FORMATS, formatNumber } from '../../../lib/docsections'

/*
  components/notebook/doc/DocSection.js
  --------------------------------------------------------------------------
  Layout → Breaks → Section… : the settings of the section the caret is in.

  What a section can change (lib/docsections.js): its orientation, and its
  page numbering — continue from the section before, or restart at a number,
  in a format (1 2 3 / i ii iii / I II III / a b c). The first section is the
  document's own settings; it always starts its own numbering.
  -------------------------------------------------------------------------- */

const row = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }
/* A group, not a <label>: a label around buttons would click the first one
   whenever its caption is clicked. */
function Group({ label, hint, children }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--ds-text-3)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ds-text-3)' }}>{hint}</span>}
    </div>
  )
}

export function SectionDialog({ index, count, initial, onApply, onRemove, onClose }) {
  const first = index === 0
  const [orient, setOrient] = useState(initial.orient || 'portrait')
  const [restart, setRestart] = useState(first || !!initial.restart)
  const [start, setStart] = useState(String(initial.start || 1))
  const [numfmt, setNumfmt] = useState(initial.numfmt || 'decimal')
  const n = Number(start)
  const ok = !restart || (Number.isInteger(n) && n >= 0 && n <= 9999)
  const apply = () => ok && onApply({ orient, restart: first || restart, start: restart ? n : 1, numfmt })
  const choice = (on, label, pick) => (
    <button type="button" onClick={pick} aria-pressed={on}
      style={{ ...fieldStyle, cursor: 'pointer', textAlign: 'center', fontWeight: on ? 600 : 400, color: on ? 'var(--ds-accent)' : 'var(--ds-text-2)', borderColor: on ? 'var(--ds-accent)' : undefined }}>
      {label}
    </button>
  )
  return (
    <Dialog title={`Section ${index + 1} of ${count}`} width={380} onClose={onClose}
      footer={<>
        {!first && <span style={{ marginRight: 'auto' }}><Btn onClick={onRemove}>Remove this break</Btn></span>}
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn primary disabled={!ok} onClick={apply}>OK</Btn>
      </>}>
      <Group label="Orientation">
        <div style={row}>
          {choice(orient === 'portrait', 'Portrait', () => setOrient('portrait'))}
          {choice(orient === 'landscape', 'Landscape', () => setOrient('landscape'))}
        </div>
      </Group>
      <div style={{ height: 12 }} />
      <Group label="Page numbering" hint={first ? 'The first section always starts the numbering.' : 'Front matter in i, ii, iii, then the body from 1 — restart each section.'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!first && (
            <div style={row}>
              {choice(!restart, 'Continue', () => setRestart(false))}
              {choice(restart, 'Restart at', () => setRestart(true))}
            </div>
          )}
          <div style={row}>
            <input type="number" min={0} max={9999} value={start} disabled={!restart} aria-label="Start at"
              onChange={e => setStart(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply() } }}
              style={{ ...fieldStyle, opacity: restart ? 1 : 0.45 }} />
            <select value={numfmt} onChange={e => setNumfmt(e.target.value)} aria-label="Number format" style={fieldStyle}>
              {NUM_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </Group>
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ds-text-3)' }}>
        First page of this section: {restart && ok ? formatNumber(n, numfmt) : 'continues'} · {orient === 'landscape' ? 'Landscape' : 'Portrait'}
      </div>
      {!ok && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--ds-red)' }}>Start at a whole number from 0 to 9999.</div>}
    </Dialog>
  )
}
