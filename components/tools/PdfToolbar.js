'use client'
import Icon from '../ui/Icon'
import { Z } from '../../lib/theme'

/*
  components/tools/PdfToolbar.js
  --------------------------------------------------------------------------
  Contextual rail for a selected PDF block. Same slot, shape and surface as
  SheetToolbar, and mutually exclusive with it.

  Stage 2 turned five of these on. The rest stay declared and disabled — a
  greyed control that names what's coming is a roadmap you can read; an absent
  one is just a missing feature. They are NOT clickable no-ops.
  -------------------------------------------------------------------------- */

/* Tools that put the annotation layer into a mode. */
export const PDF_TOOLS = [
  { id: 'select', label: 'Select', icon: 'action-check', ready: true,
    hint: 'Click an annotation to select it · Delete removes it' },
  /* Editing what the document already says, and adding something it doesn't,
     are two different intentions and the labels have to say which is which —
     "Text" alone was ambiguous the moment a second text tool existed. They
     share a glyph because the set has no edit mark; see the note in the
     report rather than inventing one here, since a name that isn't in
     icon-paths.js renders as an invisible spacer. */
  { id: 'edittext', label: 'Edit text', icon: 'action-rename', ready: true,
    hint: 'Click a line of text to rewrite it' },
  { id: 'text', label: 'Add text', icon: 'pdf-text', ready: true,
    hint: 'Click empty space to add a new line of your own' },
  { id: 'whiteout', label: 'White-out', icon: 'pdf-whiteout', ready: true,
    hint: 'Drag a rectangle to cover content' },
  { id: 'highlight', label: 'Highlight', icon: 'pdf-highlight', ready: true,
    hint: 'Drag over text for a translucent mark' },
  { id: 'ink', label: 'Draw', icon: 'tool-draw', ready: true,
    hint: 'Freehand on the page' },
  { id: 'signature', label: 'Signature', icon: 'pdf-signature', ready: false,
    hint: 'Draw once, save it, stamp it from then on' },
  { id: 'form', label: 'Form fill', icon: 'pdf-form', ready: false,
    hint: 'Detect AcroForm fields and fill them in' },
  { id: 'pages', label: 'Pages', icon: 'pdf-page-reorder', ready: false,
    hint: 'Reorder, delete, rotate, insert, extract or merge' },
]

export default function PdfToolbar({ block, dark, colors, tool = 'select', onToolChange, editState }) {
  if (!block) return null
  const { surface, border } = colors
  const st = editState || {}
  const hasEdits = (st.count || 0) > 0

  return (
    <div
      data-island-rail
      data-kbd-zone
      style={{
        position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
        zIndex: Z.rail, width: 152,
        display: 'flex', flexDirection: 'column', gap: 3, padding: 8,
        maxHeight: 'calc(100% - 120px)', overflowY: 'auto',
        background: `${surface}dd`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
        fontFamily: 'var(--ds-font-body)',
        animation: 'dsRailIn 0.18s cubic-bezier(.34,1.3,.64,1)',
      }}>

      <div title={block.name || 'PDF'} style={{
        fontSize: 9, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase',
        letterSpacing: 0.9, color: 'var(--ds-text-3)',
        padding: '2px 6px 6px', borderBottom: `1px solid ${border}`,
        marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {block.name || 'PDF'}
      </div>

      {PDF_TOOLS.map(t => (
        <button
          key={t.id}
          disabled={!t.ready}
          onClick={() => t.ready && onToolChange?.(t.id)}
          title={t.ready ? t.hint : `${t.hint} — not built yet`}
          aria-pressed={tool === t.id}
          className={`ds-tbtn${tool === t.id ? ' is-on' : ''}`}
          style={{
            width: '100%', height: 29, padding: '0 9px', fontSize: 11.5,
            justifyContent: 'flex-start',
            opacity: t.ready ? 1 : 0.38,
            cursor: t.ready ? 'pointer' : 'not-allowed',
          }}>
          <Icon name={t.icon} size={14} />
          <span style={{ flex: 1, textAlign: 'left' }}>{t.label}</span>
          {!t.ready && (
            <span style={{
              fontSize: 7.5, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.4,
              color: 'var(--ds-text-3)', border: '1px solid var(--ds-border)',
              borderRadius: 3, padding: '1px 3px', flexShrink: 0,
            }}>SOON</span>
          )}
        </button>
      ))}

      {/* ── history ── */}
      <div style={{ display: 'flex', gap: 3, marginTop: 5, paddingTop: 6, borderTop: `1px solid ${border}` }}>
        <button onClick={() => st.undo?.()} disabled={!st.canUndo}
          title="Undo (Ctrl+Z)" aria-label="Undo"
          className="ds-tbtn"
          style={{ flex: 1, height: 27, padding: 0, justifyContent: 'center', opacity: st.canUndo ? 1 : 0.35, cursor: st.canUndo ? 'pointer' : 'not-allowed' }}>
          <Icon name="draw-undo" size={13} />
        </button>
        <button onClick={() => st.redo?.()} disabled={!st.canRedo}
          title="Redo (Ctrl+Shift+Z)" aria-label="Redo"
          className="ds-tbtn"
          style={{ flex: 1, height: 27, padding: 0, justifyContent: 'center', opacity: st.canRedo ? 1 : 0.35, cursor: st.canRedo ? 'pointer' : 'not-allowed' }}>
          <Icon name="draw-undo" size={13} style={{ transform: 'scaleX(-1)' }} />
        </button>
        <button onClick={() => st.deleteSelected?.()} disabled={!st.hasSelection}
          title="Delete the selected annotation" aria-label="Delete annotation"
          className="ds-tbtn"
          style={{ flex: 1, height: 27, padding: 0, justifyContent: 'center', color: st.hasSelection ? 'var(--ds-red)' : undefined, opacity: st.hasSelection ? 1 : 0.35, cursor: st.hasSelection ? 'pointer' : 'not-allowed' }}>
          <Icon name="action-delete" size={13} />
        </button>
      </div>

      {/* Extract is an ACTION, not a mode — it opens a preview and creates a
          block, rather than arming the annotation layer. Grouping it with the
          modes above would imply the next click on the page does something. */}
      <button onClick={() => st.extract?.()}
        title="Pull this page's text or table out into its own block"
        className="ds-tbtn"
        style={{ width: '100%', height: 29, marginTop: 5, paddingLeft: 9, paddingRight: 9, fontSize: 11.5, justifyContent: 'flex-start' }}>
        <Icon name="action-send-to-column" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>Extract</span>
      </button>

      {/* ── output ── */}
      <button onClick={() => st.export?.()} disabled={st.exporting}
        title={hasEdits ? 'Save a new PDF with your edits applied' : 'Save a copy — no edits yet'}
        className="ds-tbtn"
        style={{ width: '100%', height: 29, marginTop: 3, padding: '0 9px', fontSize: 11.5, justifyContent: 'flex-start' }}>
        <Icon name={st.exporting ? 'status-spinner' : 'action-export'} size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>{st.exporting ? 'Saving…' : 'Export'}</span>
      </button>

      <button onClick={() => st.revert?.()} disabled={!hasEdits}
        title="Discard every edit and return to the imported document"
        className="ds-tbtn"
        style={{ width: '100%', height: 29, padding: '0 9px', fontSize: 11.5, justifyContent: 'flex-start', color: hasEdits ? 'var(--ds-red)' : undefined, opacity: hasEdits ? 1 : 0.38, cursor: hasEdits ? 'pointer' : 'not-allowed' }}>
        <Icon name="pdf-revert" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>Revert</span>
      </button>

      {hasEdits && (
        <div style={{
          marginTop: 4, fontSize: 9, lineHeight: 1.45, color: 'var(--ds-text-3)',
          fontFamily: 'var(--ds-font-mono)', padding: '0 2px',
        }}>
          {st.summary}
        </div>
      )}

      {/* The reassurance that makes the local-first pitch concrete, on the
          surface where someone is about to trust the app with a document. */}
      <div style={{
        marginTop: 5, paddingTop: 6, borderTop: `1px solid ${border}`,
        fontSize: 9, lineHeight: 1.5, color: 'var(--ds-text-3)',
        display: 'flex', gap: 5,
      }}>
        <Icon name="status-info" size={11} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Edits are an overlay. The imported file is never modified.</span>
      </div>
    </div>
  )
}
