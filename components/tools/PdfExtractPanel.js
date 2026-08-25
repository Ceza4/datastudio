'use client'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { extractText, extractTable, paragraphsToHtml, summarisePage } from '../../lib/pdfextract'
import { Z } from '../../lib/theme'

/*
  components/tools/PdfExtractPanel.js
  --------------------------------------------------------------------------
  "Pull this page's content out into a real block."

  PREVIEW FIRST, ALWAYS
  Extraction is inference — a PDF has no idea what a paragraph or a table is,
  so lib/pdfextract.js is guessing from geometry. It's a good guess on ordinary
  documents and it will sometimes be wrong.

  A tool that guesses should show its guess. Creating the block immediately
  and letting the user discover a mangled table afterwards means they have to
  undo, and lose confidence in the feature for every document after that one.
  Showing the result first turns a wrong guess into a "no thanks" instead of a
  cleanup job.

  Portalled and screen-centred, for the same reason as BlockPicker: the canvas
  sits inside a CSS transform, and anything positioned within it is scaled by
  the zoom level.
  -------------------------------------------------------------------------- */

export default function PdfExtractPanel({ items, pageNumber, pdfName, colors, onExtract, onClose }) {
  const [mode, setMode] = useState('auto')       // auto | text | table
  const { surface, raised, border, text, text2, text3, accent, accentText, accentDim, red } = colors

  const analysis = useMemo(() => {
    const summary = summarisePage(items)
    const asText = extractText(items)
    const asTable = extractTable(items)
    return { summary, asText, asTable }
  }, [items])

  /* "Auto" resolves to whichever is actually available, so the default is
     never a mode that can't produce anything. */
  const resolved = mode === 'auto' ? (analysis.asTable.ok ? 'table' : 'text') : mode
  const tableAvailable = analysis.asTable.ok
  const textAvailable = !analysis.asText.empty

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function go() {
    if (resolved === 'table' && tableAvailable) {
      onExtract({
        kind: 'table',
        headers: analysis.asTable.headers,
        rows: analysis.asTable.rows,
        bbox: analysis.asTable.bbox,
      })
    } else if (textAvailable) {
      onExtract({
        kind: 'text',
        html: paragraphsToHtml(analysis.asText.paragraphs),
        bbox: analysis.asText.bbox,
      })
    }
  }

  const canGo = resolved === 'table' ? tableAvailable : textAvailable

  if (typeof document === 'undefined') return null

  const panel = (
    <div
      role="dialog"
      aria-label="Extract from this page"
      data-kbd-zone
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: Z.popover, width: 520, maxHeight: '78vh',
        display: 'flex', flexDirection: 'column',
        background: surface, border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)', overflow: 'hidden',
        fontFamily: 'var(--ds-font-body)',
      }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: `1px solid ${border}` }}>
        <Icon name="action-send-to-column" size={15} style={{ color: accentText }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 650, color: text }}>
          Extract from page {pageNumber}
        </span>
        <span style={{ fontSize: 10, color: text3, fontFamily: 'var(--ds-font-mono)' }}>
          {analysis.summary.label}
        </span>
      </div>

      {/* mode */}
      <div style={{ display: 'flex', gap: 5, padding: '10px 14px 0' }}>
        {[
          ['auto', 'Auto', 'status-info'],
          ['text', 'Text', 'block-text'],
          ['table', 'Table', 'block-table'],
        ].map(([id, label, icon]) => {
          const on = mode === id
          const dead = (id === 'table' && !tableAvailable) || (id === 'text' && !textAvailable)
          return (
            <button key={id} onClick={() => setMode(id)} disabled={dead}
              aria-pressed={on}
              title={dead ? (id === 'table' ? 'No table detected on this page' : 'No text on this page') : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 11px', borderRadius: 7, cursor: dead ? 'not-allowed' : 'pointer',
                border: `1px solid ${on ? accent : border}`,
                background: on ? accentDim : 'transparent',
                color: on ? accent : text2,
                opacity: dead ? 0.4 : 1,
                fontFamily: 'var(--ds-font-body)', fontSize: 12,
              }}>
              <Icon name={icon} size={13} />
              {label}
            </button>
          )
        })}
      </div>

      {/* preview */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 14px' }}>
        {analysis.summary.empty && (
          <Notice colors={colors} icon="status-warning" tone={red}>
            <b>No text on this page.</b> It’s almost certainly a scan — an image of a
            document rather than a document. Extracting it needs OCR, which DataStudio
            doesn’t do yet.
          </Notice>
        )}

        {!analysis.summary.empty && resolved === 'table' && tableAvailable && (
          <>
            <Caption colors={colors}>
              {analysis.asTable.rows.length} rows × {analysis.asTable.headers.length} columns
              {analysis.asTable.headerDetected ? ' · header row detected' : ' · no header row found, columns numbered'}
            </Caption>
            <div style={{ border: `1px solid ${border}`, borderRadius: 8, overflow: 'auto', maxHeight: 300 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
                <thead>
                  <tr>
                    {analysis.asTable.headers.map((h, i) => (
                      <th key={i} style={{ textAlign: 'left', padding: '6px 9px', background: raised, color: text2, borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap', fontWeight: 650 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysis.asTable.rows.slice(0, 12).map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} style={{ padding: '5px 9px', color: text2, borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap' }}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {analysis.asTable.rows.length > 12 && (
              <Caption colors={colors}>…and {analysis.asTable.rows.length - 12} more rows</Caption>
            )}
          </>
        )}

        {!analysis.summary.empty && resolved === 'table' && !tableAvailable && (
          <Notice colors={colors} icon="status-info">
            {analysis.asTable.reason} Try <b>Text</b> instead.
          </Notice>
        )}

        {!analysis.summary.empty && resolved === 'text' && (
          <>
            <Caption colors={colors}>
              {analysis.asText.paragraphs.length} paragraphs · {analysis.asText.lines.length} lines
            </Caption>
            <div style={{
              border: `1px solid ${border}`, borderRadius: 8, padding: '10px 12px',
              maxHeight: 300, overflow: 'auto', background: raised,
              fontSize: 12, lineHeight: 1.6, color: text2, whiteSpace: 'pre-wrap',
            }}>
              {analysis.asText.text || '(nothing readable)'}
            </div>
          </>
        )}
      </div>

      {/* actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: `1px solid ${border}` }}>
        <span style={{ flex: 1, fontSize: 10, color: text3, lineHeight: 1.4 }}>
          {/* Says plainly that this is a guess, on the surface where it matters. */}
          Extraction is inferred from the page’s layout — check the preview before adding.
        </span>
        <button onClick={onClose} className="ds-tbtn" style={{ height: 30, fontSize: 12 }}>
          Cancel
        </button>
        <button onClick={go} disabled={!canGo} className="ds-tbtn is-on"
          style={{ height: 30, fontSize: 12, opacity: canGo ? 1 : 0.4, cursor: canGo ? 'pointer' : 'not-allowed' }}>
          <Icon name="action-add" size={13} />
          Add {resolved === 'table' ? 'table' : 'text'} block
        </button>
      </div>
    </div>
  )

  return createPortal(
    <>
      <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: Z.modalScrim, background: 'rgba(0,0,0,0.25)' }} />
      {panel}
    </>,
    document.body
  )
}

function Caption({ children, colors }) {
  return (
    <div style={{ fontSize: 10, color: colors.text3, fontFamily: 'var(--ds-font-mono)', margin: '0 0 7px' }}>
      {children}
    </div>
  )
}

function Notice({ children, colors, icon, tone }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '11px 12px', borderRadius: 8,
      border: `1px solid ${colors.border}`, background: colors.raised,
      fontSize: 11.5, lineHeight: 1.55, color: tone || colors.text2,
    }}>
      <Icon name={icon} size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}
