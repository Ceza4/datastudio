'use client'
import { useState, useMemo, useEffect } from 'react'
import { writeColumn } from '../../lib/exporters'

/* SendToSheet
   --------------------------------------------------------------------------
   Destination picker: choose a table block, a column and a starting row, and
   write a set of values straight into it.

   Why this exists: every tool that produced data used to have exactly one
   outlet — spawn a new table block on the canvas — which meant getting a fit
   result next to the data it came from was a manual copy-paste. Results
   usually belong in the sheet you're already working in, in a column you pick.

   Three destination modes, because they're genuinely different intents:
     Overwrite — replace a column's contents
     Insert    — push a new column in at that position, shifting the rest right
     Append    — add a new column at the end
   Overwrite is destructive, so it's never the default when a column has data.
   -------------------------------------------------------------------------- */

export default function SendToSheet({ tables, columns, onWrite, onDone, compact }) {
  const [blockId, setBlockId] = useState(tables[0]?.id ?? null)
  /* Column and mode are tagged with the sheet they belong to and derived,
     rather than reset by an effect on blockId. The effect version cost a
     second render pass on every sheet change and React's compiler rejects it. */
  const [pick, setPick] = useState(null)   // { key, mode, colIdx }
  const fresh = pick?.key === blockId
  const mode = fresh ? pick.mode : 'append'
  const colIdx = fresh ? pick.colIdx : 0
  const setMode = m => setPick({ key: blockId, mode: m, colIdx })
  const setColIdx = c => setPick({ key: blockId, mode, colIdx: c })
  const [startRow, setStartRow] = useState(0)
  const [header, setHeader] = useState('')
  const [done, setDone] = useState(false)

  const target = tables.find(t => t.id === blockId) || tables[0] || null
  const targetHeaders = target?.headers || []

  const preview = useMemo(() => {
    if (!target) return null
    const values = columns.length === 1
      ? columns[0].values
      : columns[0]?.values || []
    return { count: values.length, values }
  }, [target, columns])

  if (!tables.length) {
    return (
      <div style={{ fontSize: 11, color: 'var(--ds-text-2)', lineHeight: 1.5 }}>
        No table blocks on this sheet to write into. Add one first, or use
        “Add results to canvas”.
      </div>
    )
  }

  function apply() {
    if (!target || !preview) return
    const idx = mode === 'append' ? -1 : colIdx
    const patch = writeColumn(target, idx, preview.values, {
      startRow: Number(startRow) || 0,
      header: header.trim() || undefined,
      mode: mode === 'insert' ? 'insert' : 'overwrite',
    })
    onWrite(target.id, patch)
    setDone(true)
    setTimeout(() => { setDone(false); onDone?.() }, 900)
  }

  const sel = {
    width: '100%', padding: '6px 8px', borderRadius: 6,
    border: '1px solid var(--ds-border)', background: 'var(--ds-raised)',
    color: 'var(--ds-text)', fontFamily: 'var(--ds-font-body)', fontSize: 12, outline: 'none',
  }
  const label = { fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ds-text-3)', display: 'block', marginBottom: 4 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div>
        <span style={label}>Sheet</span>
        <select value={blockId ?? ''} onChange={e => setBlockId(e.target.value)} style={sel}>
          {tables.map(t => (
            <option key={t.id} value={t.id}>
              {t.name || 'Table'} · {(t.headers || []).length} cols
            </option>
          ))}
        </select>
      </div>

      <div>
        <span style={label}>Destination</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            ['append', 'New column'],
            ['insert', 'Insert at'],
            ['overwrite', 'Overwrite'],
          ].map(([m, text]) => (
            <button key={m} onClick={() => setMode(m)}
              style={{
                flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 10.5,
                border: `1.5px solid ${mode === m ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
                background: mode === m ? 'var(--ds-accent-dim)' : 'transparent',
                color: mode === m ? 'var(--ds-accent)' : 'var(--ds-text-2)',
                fontWeight: mode === m ? 650 : 500, cursor: 'pointer',
                fontFamily: 'var(--ds-font-body)',
              }}>{text}</button>
          ))}
        </div>
      </div>

      {mode !== 'append' && (
        <div>
          <span style={label}>Column</span>
          <select value={colIdx} onChange={e => setColIdx(+e.target.value)} style={sel}>
            {targetHeaders.map((h, i) => (
              <option key={i} value={i}>{colLetter(i)}{h ? ` · ${h}` : ''}</option>
            ))}
          </select>
          {mode === 'overwrite' && (
            <div style={{ fontSize: 10, color: 'var(--ds-amber)', marginTop: 4, lineHeight: 1.4 }}>
              Replaces whatever is in {colLetter(colIdx)} from row {Number(startRow) + 1} down.
            </div>
          )}
        </div>
      )}

      {!compact && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <span style={label}>Start row</span>
            <input type="number" min={0} value={startRow}
              onChange={e => setStartRow(Math.max(0, +e.target.value || 0))} style={sel} />
          </div>
          <div style={{ flex: 2 }}>
            <span style={label}>Header (optional)</span>
            <input value={header} onChange={e => setHeader(e.target.value)}
              placeholder="leave blank to keep" style={sel} />
          </div>
        </div>
      )}

      <button className="ds-btn ds-btn-primary" onClick={apply}
        disabled={!target || !preview?.count}
        style={{ width: '100%', padding: '9px 0', opacity: target && preview?.count ? 1 : 0.4 }}>
        {done ? 'Written' : `Write ${preview?.count ?? 0} values`}
      </button>
    </div>
  )
}

function colLetter(i) {
  let s = ''
  i += 1
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) }
  return s
}
