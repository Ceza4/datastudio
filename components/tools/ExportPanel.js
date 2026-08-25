'use client'
import Icon from '../ui/Icon'
import { useState, useEffect, useMemo } from 'react'

/* ExportPanel
   --------------------------------------------------------------------------
   Floating island for exporting the canvas, the current selection, or a single
   block. Two decisions the user makes, in order:

     1. SCOPE  — what goes in the file
     2. FORMAT — what kind of file

   Scope first, because it changes which formats are even possible: pick a text
   block and Excel stops making sense. Formats that can't carry the chosen
   scope are shown disabled with the reason, rather than hidden — hiding them
   makes the user wonder whether the feature exists at all.

   State lives here; the actual writing is in lib/exporters.js.
   -------------------------------------------------------------------------- */

import { formatsFor, runExport, toColumns } from '../../lib/exporters'
import SendToSheet from './SendToSheet'
import { Z } from '../../lib/theme'

/* Export format → icon. Keyed on format id rather than extension so an id can
   change file type later without silently falling back to the generic glyph. */
const FORMAT_ICON = {
  pdf: 'format-pdf', docx: 'format-word', md: 'format-markdown',
  xlsx: 'format-excel', csv: 'format-csv', pptx: 'format-powerpoint',
  png: 'format-image', html: 'format-html', json: 'format-json',
}

export default function ExportPanel({ open, onClose, blocks, selectedIds, notebookName, sheetName, dark, onUpdateBlock }) {
  const [scope, setScope] = useState('canvas')
  const [toSheet, setToSheet] = useState(false)
  const [srcCol, setSrcCol] = useState(0)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const selected = useMemo(
    () => blocks.filter(b => selectedIds.has(b.id)),
    [blocks, selectedIds]
  )

  useEffect(() => {
    if (!open) return
    setError(null); setDone(null); setBusy(null)
    // Default to the selection when there is one — that's almost always what
    // you meant if you selected something and then hit Export.
    setScope(selected.length > 0 ? 'selection' : 'canvas')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const payload = scope === 'selection' ? selected : blocks
  const formats = useMemo(() => formatsFor(payload), [payload])
  // Columns available to send, and every table on the sheet that can receive.
  const sourceColumns = useMemo(() => toColumns(payload), [payload])
  const allTables = useMemo(() => blocks.filter(b => b.type === 'table'), [blocks])
  const exportName = scope === 'selection' && selected.length === 1
    ? (selected[0].name || `${selected[0].type} block`)
    : `${notebookName || 'Project'} — ${sheetName || 'Sheet'}`

  if (!open) return null

  async function go(f) {
    if (!f.enabled || busy) return
    setError(null); setDone(null); setBusy(f.id)
    try {
      await runExport(f.id, payload, exportName, { dark })
      setDone(f.id)
      setTimeout(() => setDone(d => (d === f.id ? null : d)), 2600)
    } catch (err) {
      setError(err.message || 'Export failed.')
    } finally {
      setBusy(null)
    }
  }

  const groups = formats.reduce((acc, f) => {
    (acc[f.group] = acc[f.group] || []).push(f)
    return acc
  }, {})

  const scopes = [
    { id: 'canvas', label: 'Whole sheet', count: blocks.length },
    { id: 'selection', label: selected.length === 1 ? 'Selected block' : 'Selection', count: selected.length },
  ]

  return (
    <>
      {/* Click-away catcher. Deliberately not a dimming overlay: the canvas
          stays legible so you can see what you're about to export. */}
      <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: Z.panel }} />

      <div className="ds-island" role="dialog" aria-label="Export"
        style={{
          position: 'fixed', top: 74, left: '50%', transform: 'translateX(-50%)',
          zIndex: Z.panel, width: 470, maxWidth: 'calc(100vw - 32px)',
          padding: 16, display: 'flex', flexDirection: 'column', gap: 13,
          maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
        }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--ds-font-head)', fontSize: 14, fontWeight: 700, color: 'var(--ds-text)' }}>
            Export
          </span>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--ds-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {exportName}
          </span>
          <button onClick={onClose} aria-label="Close export panel"
            style={{ background: 'none', border: 'none', color: 'var(--ds-text-3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        {/* ── scope ── */}
        <div>
          <div className="ds-label" style={{ marginBottom: 6 }}>Include</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {scopes.map(s => {
              const on = scope === s.id
              const disabled = s.count === 0
              return (
                <button key={s.id} disabled={disabled} onClick={() => setScope(s.id)}
                  style={{
                    flex: 1, padding: '9px 10px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
                    border: `1.5px solid ${on ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
                    background: on ? 'var(--ds-accent-dim)' : 'transparent',
                    color: on ? 'var(--ds-accent)' : 'var(--ds-text-2)',
                    opacity: disabled ? 0.4 : 1, fontFamily: 'var(--ds-font-body)',
                    fontSize: 12, fontWeight: on ? 650 : 500, textAlign: 'left',
                  }}>
                  {s.label}
                  <span style={{ display: 'block', fontSize: 10, opacity: 0.75, marginTop: 2, fontFamily: 'var(--ds-font-mono)' }}>
                    {s.count} block{s.count === 1 ? '' : 's'}
                  </span>
                </button>
              )
            })}
          </div>
          {scope === 'selection' && selected.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--ds-text-2)', marginTop: 6 }}>
              Nothing selected — click a block on the canvas first.
            </div>
          )}
        </div>

        {/* ── send into a sheet, instead of downloading a file ──
            An export isn't always a file. Often what you want is these values
            in a column of a sheet you already have open. */}
        <div>
          <button onClick={() => setToSheet(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              border: `1.5px solid ${toSheet ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
              background: toSheet ? 'var(--ds-accent-dim)' : 'transparent',
              color: toSheet ? 'var(--ds-accent)' : 'var(--ds-text-2)',
              fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: toSheet ? 650 : 500,
            }}>
            <span style={{ flex: 1, textAlign: 'left' }}>Send to a sheet column</span>
            <Icon name={toSheet ? 'nav-chevron-down' : 'nav-chevron-right'} size={11} style={{ opacity: 0.8 }} />
          </button>

          {toSheet && (
            <div style={{ marginTop: 9, padding: 11, borderRadius: 8, border: '1px solid var(--ds-border)', background: 'var(--ds-raised)' }}>
              {sourceColumns.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--ds-text-2)', lineHeight: 1.5 }}>
                  The current selection has no table columns to send.
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 9 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ds-text-3)', display: 'block', marginBottom: 4 }}>
                      Take column
                    </span>
                    <select value={srcCol} onChange={e => setSrcCol(+e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ds-border)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontFamily: 'var(--ds-font-body)', fontSize: 12, outline: 'none' }}>
                      {sourceColumns.map((c, i) => (
                        <option key={i} value={i}>
                          {c.blockName} · {c.header || `column ${i + 1}`} ({c.values.length} rows)
                        </option>
                      ))}
                    </select>
                  </div>
                  <SendToSheet
                    tables={allTables}
                    columns={[sourceColumns[Math.min(srcCol, sourceColumns.length - 1)]]}
                    onWrite={(id, patch) => onUpdateBlock?.(id, patch)}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* ── formats ── */}
        {Object.entries(groups).map(([group, list]) => (
          <div key={group}>
            <div className="ds-label" style={{ marginBottom: 6 }}>{group}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {list.map(f => {
                const isBusy = busy === f.id
                const isDone = done === f.id
                return (
                  <button key={f.id} disabled={!f.enabled || !!busy || payload.length === 0}
                    onClick={() => go(f)}
                    title={f.enabled ? f.note : 'Not available for the blocks in this selection'}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                      padding: '9px 11px', borderRadius: 8, textAlign: 'left',
                      border: `1px solid ${isDone ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
                      background: isDone ? 'var(--ds-accent-dim)' : 'var(--ds-raised)',
                      color: isDone ? 'var(--ds-accent)' : 'var(--ds-text)',
                      cursor: f.enabled && !busy && payload.length ? 'pointer' : 'default',
                      opacity: f.enabled && payload.length ? 1 : 0.38,
                      fontFamily: 'var(--ds-font-body)', transition: 'border-color .15s, background .15s',
                    }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                      <Icon name={FORMAT_ICON[f.id] || 'action-export'} size={15} />
                      {f.label}
                      <span style={{ marginLeft: 'auto', fontFamily: 'var(--ds-font-mono)', fontSize: 9, color: 'var(--ds-text-3)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3 }}>
                        {isBusy ? <Icon name="status-spinner" size={11} />
                          : isDone ? <><Icon name="action-check" size={11} />saved</>
                          : f.ext}
                      </span>
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--ds-text-3)', lineHeight: 1.35 }}>{f.note}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {error && (
          <div role="alert" style={{
            padding: '9px 11px', borderRadius: 7, background: 'var(--ds-red-bg)',
            border: '1px solid var(--ds-red)', color: 'var(--ds-red)', fontSize: 11.5, lineHeight: 1.5,
          }}>{error}</div>
        )}

        <div style={{ fontSize: 10.5, color: 'var(--ds-text-2)', lineHeight: 1.55, borderTop: '1px solid var(--ds-border)', paddingTop: 10 }}>
          PDF opens your browser’s print dialog — choose <b style={{ color: 'var(--ds-text-2)' }}>Save as PDF</b>.
          Word and PowerPoint files are real Office documents, not renamed HTML.
        </div>
      </div>
    </>
  )
}
