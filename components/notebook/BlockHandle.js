'use client'

/* The grey title bar at the top of every notebook block (text, table, kanban).
   Holds the block name, a drag-to-canvas grip (for tables), and a delete button. */
export default function BlockHandle({
  notebookId,
  block,
  label,
  draggableAsTable,
  colors,
  renaming,
  onStartRename,
  onStopRename,
  onRename,
  onDelete,
  onHeaderDragStart,
}) {
  const { raised, border, text2, text3, accent, red } = colors

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
            fontFamily: "'DM Sans',sans-serif",
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
            fontFamily: "'DM Sans',sans-serif",
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

      {draggableAsTable && (
        <span
          draggable
          title="Drag table to files"
          onMouseDown={e => e.stopPropagation()}
          onDragStart={e => {
            e.stopPropagation()
            window.__nbTableDrag = { notebookId, block }
            e.dataTransfer.effectAllowed = 'copy'
            e.dataTransfer.setData('text/plain', 'nb_table')
          }}
          onDragEnd={() => {
            window.__nbTableDrag = null
          }}
          style={{
            fontSize: 12,
            color: accent,
            cursor: 'grab',
            padding: '0 2px',
            flexShrink: 0,
          }}
        >
          ⇢
        </span>
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
        ✕
      </button>
    </div>
  )
}
