'use client'
import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { extractText, paragraphsToHtml, summarisePage } from '../../lib/pdfextract'
import { Z } from '../../lib/theme'

/*
  components/tools/PdfExtractPanel.js
  --------------------------------------------------------------------------
  "Pull this page's content out into a real block."

  PREVIEW FIRST, ALWAYS
  Extraction is inference — a PDF has no idea what a paragraph is, so
  lib/pdfextract.js is guessing from geometry. It's a good guess on ordinary
  documents and it will sometimes be wrong.

  A tool that guesses should show its guess. Creating the block immediately and
  letting the user discover mangled output afterwards means they have to undo,
  and lose confidence in the feature for every document after that one. Showing
  the result first turns a wrong guess into a "no thanks" instead of a cleanup
  job.

  This is also why table detection was removed rather than fixed: a preview can
  make a wrong paragraph break obvious at a glance, but a plausible-looking
  wrong table is exactly the kind of error a preview does NOT catch — the
  columns line up, the header looks right, and the values are in the wrong
  cells. See the note in lib/pdfextract.js.

  Portalled and screen-centred, for the same reason as BlockPicker: the canvas
  sits inside a CSS transform, and anything positioned within it is scaled by
  the zoom level.
  -------------------------------------------------------------------------- */

/* ONE MODE NOW, NOT THREE.

   Auto / Text / Table are gone, and this is a real simplification rather than
   two hidden buttons: the `mode` state, the three-tab row, the
   resolved/tableAvailable branching and the whole table-preview block went with
   them, along with detectTable/extractTable in lib/pdfextract.js.

   WHY. Auto resolved to Table whenever detectTable's geometry heuristic thought
   it had found one — clustering column x-positions with a 6px tolerance and
   guessing a header row by typographic distinctness. That inference is what
   people experienced as extraction being sloppy. There was never a separate
   silent "auto-extract" to remove; extraction has always run through this panel
   and always required an explicit Add-block click. The sloppiness was the table
   GUESS, and the guess is what has been cut.

   Text — paragraph and line grouping from geometry — is a much safer inference
   and is the mode that was already reliable. It is now the only one. */
export default function PdfExtractPanel({ items, pageNumber, pdfName, colors, onExtract, onClose }) {
  const { surface, raised, border, text, text2, text3, accent, accentText, accentDim, red } = colors

  const analysis = useMemo(() => {
    const summary = summarisePage(items)
    const asText = extractText(items)
    return { summary, asText }
  }, [items])

  const textAvailable = !analysis.asText.empty

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function go() {
    if (!textAvailable) return
    onExtract({
      kind: 'text',
      html: paragraphsToHtml(analysis.asText.paragraphs),
      bbox: analysis.asText.bbox,
    })
  }

  const canGo = textAvailable

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${border}` }}>
        <Icon name="action-send-to-column" size={16} style={{ color: accentText }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 650, color: text }}>
          Extract from page {pageNumber}
        </span>
        <span style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)' }}>
          {analysis.summary.label}
        </span>
      </div>

      {/* preview */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '14px' }}>
        {analysis.summary.empty && (
          <Notice colors={colors} icon="status-warning" tone={red}>
            <b>No text on this page.</b> It’s almost certainly a scan — an image of a
            document rather than a document. Extracting it needs OCR, which DataStudio
            doesn’t do yet.
          </Notice>
        )}

        {!analysis.summary.empty && (
          <>
            <Caption colors={colors}>
              {analysis.asText.paragraphs.length} paragraphs · {analysis.asText.lines.length} lines
            </Caption>
            <div style={{
              border: `1px solid ${border}`, borderRadius: 8, padding: '10px 12px',
              maxHeight: 300, overflow: 'auto', background: raised,
              fontSize: 13, lineHeight: 1.6, color: text2, whiteSpace: 'pre-wrap',
            }}>
              {analysis.asText.text || '(nothing readable)'}
            </div>
          </>
        )}
      </div>

      {/* actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: `1px solid ${border}` }}>
        <span style={{ flex: 1, fontSize: 11, color: text3, lineHeight: 1.4 }}>
          {/* Says plainly that this is a guess, on the surface where it matters. */}
          Extraction is inferred from the page’s layout — check the preview before adding.
        </span>
        <button onClick={onClose} className="ds-tbtn" style={{ height: 30, fontSize: 13 }}>
          Cancel
        </button>
        <button onClick={go} disabled={!canGo} className="ds-tbtn is-on"
          style={{ height: 30, fontSize: 13, opacity: canGo ? 1 : 0.4, cursor: canGo ? 'pointer' : 'not-allowed' }}>
          <Icon name="action-add" size={14} />
          Add text block
        </button>
      </div>
    </div>
  )

  return createPortal(
    <>
      <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: Z.popoverScrim, background: 'rgba(0,0,0,0.25)' }} />
      {panel}
    </>,
    document.body
  )
}

function Caption({ children, colors }) {
  return (
    <div style={{ fontSize: 11, color: colors.text3, fontFamily: 'var(--ds-font-mono)', margin: '0 0 7px' }}>
      {children}
    </div>
  )
}

function Notice({ children, colors, icon, tone }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '12px 12px', borderRadius: 8,
      border: `1px solid ${colors.border}`, background: colors.raised,
      fontSize: 12, lineHeight: 1.55, color: tone || colors.text2,
    }}>
      <Icon name={icon} size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}
