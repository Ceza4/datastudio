'use client'
import { useState } from 'react'
import Icon from '../ui/Icon'

/* Shared fallback for a handle rendered outside the canvas, which has nobody
   to build the index. Frozen because it is handed to every such handle at
   once — one stray push would give all of them a backlink they never had. */
const NO_BACKLINKS = Object.freeze([])

/* The grey title bar at the top of every notebook block (text, table, kanban).
   Holds the block name and a delete button. */
export default function BlockHandle({
  notebookId,
  block,
  label,
  colors,
  renaming,
  onStartRename,
  onStopRename,
  onRename,
  onDelete,
  onHeaderDragStart,
  /* Who links here, handed in already computed. This used to be a
     findBacklinks() scan of the entire workspace per handle, memoised on the
     notebook tree — and the memo never held during a drag, because moving a
     block re-mints that tree every frame. Six block types render a handle, so
     the scan ran once per visible block per frame. NotebookCanvas now walks
     the workspace once and passes each handle its own slice. */
  backlinks = NO_BACKLINKS,
  onTeleport,
  onGoToSource,
}) {
  const { raised, border, text2, text3, red, accent, accentDim, surface } = colors
  const [showBacklinks, setShowBacklinks] = useState(false)

  return (
    <div
      onMouseDown={e => {
        if (e.target.closest('input,button')) return
        onHeaderDragStart(e)
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        height: 30,
        background: raised,
        borderBottom: `1px solid ${border}`,
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: text3,
          textTransform: 'uppercase',
          letterSpacing: 1,
          flexShrink: 0,
          opacity: 0.6,
        }}
      >
        {label}
      </span>

      {renaming ? (
        <input
          autoFocus
          value={block.name || ''}
          onChange={e => onRename(e.target.value)}
          onBlur={onStopRename}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: text2,
            fontFamily: 'var(--ds-font-body)',
            fontSize: 11,
            outline: 'none',
            minWidth: 0,
          }}
        />
      ) : (
        <span
          onDoubleClick={e => {
            e.stopPropagation()
            onStartRename()
          }}
          style={{
            flex: 1,
            color: block.name ? text2 : text3,
            fontFamily: 'var(--ds-font-body)',
            fontSize: 11,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'text',
            fontStyle: block.name ? 'normal' : 'italic',
          }}
        >
          {block.name || 'Untitled'}
        </span>
      )}

      {/* Provenance. A block extracted from a PDF says so, and clicking takes
          you back to the page it came from.

          This is the same idea as a teleport link, pointed the other way: a
          teleport is a link the user wrote, this is one the app wrote on their
          behalf. Without it an extracted table is just a table, and in a week
          nobody remembers which document produced it — which for a research
          tool is the difference between a citation and a rumour. */}
      {block.source?.type === 'pdf' && (
        <button
          onClick={e => { e.stopPropagation(); onGoToSource?.(block.source) }}
          onMouseDown={e => e.stopPropagation()}
          title={`Extracted from page ${block.source.page} — click to go back to it`}
          style={{
            display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
            background: 'none', border: 'none', borderRadius: 4, padding: '2px 5px',
            color: text3, cursor: 'pointer',
            fontFamily: 'var(--ds-font-mono)', fontSize: 9, lineHeight: 1,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = accent)}
          onMouseLeave={e => (e.currentTarget.style.color = text3)}>
          <Icon name="block-pdf" size={10} />
          p{block.source.page}
        </button>
      )}

      {/* Backlinks. Rendered only when there ARE some — a permanent "0" on
          every block would be noise on the 95% of blocks nothing points at. */}
      {backlinks.length > 0 && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); setShowBacklinks(v => !v) }}
            onMouseDown={e => e.stopPropagation()}
            aria-expanded={showBacklinks}
            title={`${backlinks.length} block${backlinks.length > 1 ? 's link' : ' links'} here`}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              background: showBacklinks ? accentDim : 'none',
              border: 'none', borderRadius: 4, padding: '2px 5px',
              color: showBacklinks ? accent : text3, cursor: 'pointer',
              fontFamily: 'var(--ds-font-mono)', fontSize: 9, lineHeight: 1,
            }}>
            <Icon name="share-link" size={10} />
            {backlinks.length}
          </button>

          {showBacklinks && (
            <div
              onMouseDown={e => e.stopPropagation()}
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 5, zIndex: 300,
                width: 232, maxHeight: 240, overflowY: 'auto',
                background: surface, border: `1px solid ${border}`, borderRadius: 9,
                boxShadow: '0 10px 30px rgba(0,0,0,0.28)', padding: 5,
                fontFamily: 'var(--ds-font-body)', cursor: 'default',
              }}>
              <div style={{
                fontSize: 8.5, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.8,
                textTransform: 'uppercase', color: text3, padding: '3px 7px 5px',
              }}>
                Linked from
              </div>
              {backlinks.map((bl, i) => (
                <button
                  key={`${bl.from.blockId}:${i}`}
                  onClick={e => {
                    e.stopPropagation()
                    setShowBacklinks(false)
                    onTeleport?.(bl.from)
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 7px', borderRadius: 6, border: 'none',
                    background: 'transparent', cursor: 'pointer',
                    fontFamily: 'var(--ds-font-body)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = raised)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ display: 'block', fontSize: 11.5, color: text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bl.sourceName}
                  </span>
                  {/* The link's own words, which are usually more useful than
                      the source block's name for remembering why it points here. */}
                  {bl.label && bl.label !== bl.sourceName && (
                    <span style={{ display: 'block', fontSize: 10, color: accent, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      “{bl.label}”
                    </span>
                  )}
                  <span style={{ display: 'block', fontSize: 9.5, color: text3, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bl.notebookName} › {bl.sheetName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={e => {
          e.stopPropagation()
          onDelete()
        }}
        style={{
          background: 'none',
          border: 'none',
          color: text3,
          cursor: 'pointer',
          fontSize: 12,
          lineHeight: 1,
          padding: '0 2px',
          flexShrink: 0,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = red)}
        onMouseLeave={e => (e.currentTarget.style.color = text3)}
      >
        <Icon name="action-delete" size={11} />
      </button>
    </div>
  )
}
