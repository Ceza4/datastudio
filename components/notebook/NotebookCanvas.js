'use client'
import { useState, useRef, useEffect } from 'react'
import TextBlockContent from './TextBlockContent'
import ResizeHandle from './ResizeHandle'
import BlockHandle from './BlockHandle'
import KanbanBlock from './KanbanBlock'

/* The freeform infinite-canvas notebook view. Hosts text/table/kanban blocks
   that the user drags around on a dot-grid background. Right-click drag pans.

   POLISH UPDATES:
   - Active sheet name is now editable inline (double-click to rename)
   - Tables and kanban blocks now have resize handles in their bottom-right
   - Deleting a block with content asks for confirmation first
   - colors prop is forwarded to TextBlockContent for the right-click toolbar
*/
export default function NotebookCanvas({
  nb,
  dark,
  colors,
  onBack,
  onAddBlock,
  onUpdateBlock,
  onDeleteBlock,
  onRenameNotebook,
  onRenameSheet,
  onSendColToCanvas,
  onDropColumn,
  onRemoveTableColumn,
}) {
  const { surface, raised, border, text, text2, text3, accent, accentDim, red, base, green, amber } = colors
  const containerRef = useRef(null)
  const [pan, setPan] = useState({ x: 60, y: 60 })
  const panRef = useRef({ x: 60, y: 60 })
  const [renamingNb, setRenamingNb] = useState(false)
  const [nbLabel, setNbLabel] = useState(nb.name)
  const [renamingSheet, setRenamingSheet] = useState(false)
  const [sheetLabel, setSheetLabel] = useState('')
  const editingRef = useRef(false)
  const [renamingBlockId, setRenamingBlockId] = useState(null)
  const suppressNextBgClickRef = useRef(false)

  useEffect(() => { setNbLabel(nb.name) }, [nb.name])

  const activeSheet = nb.sheets?.find(s => s.id === nb.activeSheetId) || nb.sheets?.[0]
  const blocks = activeSheet?.blocks || []

  /* Wrap delete with content-aware confirmation. We don't ask if the
     block is empty (no point making the user confirm "delete nothing"),
     but we do ask if there's actual data they could lose. */
  function confirmDelete(block) {
    let hasContent = false
    if (block.type === 'text') {
      // strip HTML tags to check actual visible text
      const stripped = (block.content || '').replace(/<[^>]*>/g, '').trim()
      hasContent = stripped.length > 0
    } else if (block.type === 'table') {
      hasContent = block.rows?.some(row => row.some(c => c && String(c).trim()))
    } else if (block.type === 'kanban') {
      hasContent = block.lanes?.some(l => l.cards?.length > 0)
    }
    if (hasContent) {
      const ok = window.confirm(`Delete this ${block.type} block? This cannot be undone.`)
      if (!ok) return
    }
    onDeleteBlock(block.id)
  }

  /* Only create a text block when nothing is being edited */
  function handleBgClick(e) {
    if (e.target !== e.currentTarget) return

    if (suppressNextBgClickRef.current) {
      suppressNextBgClickRef.current = false
      return
    }

    if (editingRef.current) {
      editingRef.current = false
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur()
      }
      suppressNextBgClickRef.current = true
      return
    }

    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - panRef.current.x
    const y = e.clientY - rect.top - panRef.current.y
    onAddBlock('text', Math.max(0, x - 140), Math.max(0, y - 20))
  }

  function startBlockDrag(e, block) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    const startMX = e.clientX
    const startMY = e.clientY
    const origX = block.x
    const origY = block.y
    let dragging = false

    function onMove(ev) {
      if (!dragging) {
        if (Math.abs(ev.clientX - startMX) < 5 && Math.abs(ev.clientY - startMY) < 5) return
        dragging = true
      }
      onUpdateBlock(block.id, {
        x: origX + ev.clientX - startMX,
        y: origY + ev.clientY - startMY,
      })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startPan(e) {
    if (e.button !== 2) return
    e.preventDefault()
    const startX = e.clientX - panRef.current.x
    const startY = e.clientY - panRef.current.y
    function onMove(ev) {
      const nx = ev.clientX - startX
      const ny = ev.clientY - startY
      panRef.current = { x: nx, y: ny }
      setPan({ x: nx, y: ny })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startResize(e, block) {
    e.stopPropagation()
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const baseW = block.w || (block.type === 'kanban' ? 720 : block.type === 'table' ? 520 : 320)
    const baseH = block.h || (block.type === 'kanban' ? 280 : block.type === 'table' ? 260 : 150)

    function onMove(ev) {
      onUpdateBlock(block.id, {
        w: Math.max(220, baseW + ev.clientX - startX),
        h: Math.max(120, baseH + ev.clientY - startY),
      })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startSheetRename() {
    if (!activeSheet) return
    setSheetLabel(activeSheet.name)
    setRenamingSheet(true)
  }
  function commitSheetRename() {
    if (activeSheet && onRenameSheet) {
      onRenameSheet(activeSheet.id, sheetLabel || activeSheet.name)
    }
    setRenamingSheet(false)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '0 16px', height: 42, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 12, padding: '4px 8px', borderRadius: 5, fontFamily: "'DM Sans',sans-serif" }} onMouseEnter={e => e.currentTarget.style.background = raised} onMouseLeave={e => e.currentTarget.style.background = 'none'}>← Back</button>
        <span style={{ color: border, fontSize: 16 }}>|</span>
        <span style={{ fontSize: 13 }}>📓</span>
        {renamingNb ? (
          <input autoFocus value={nbLabel} onChange={e => setNbLabel(e.target.value)} onBlur={() => { onRenameNotebook(nbLabel || nb.name); setRenamingNb(false) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, outline: 'none', minWidth: 120 }} />
        ) : (
          <span onDoubleClick={() => setRenamingNb(true)} style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: text, cursor: 'text' }}>{nb.name}</span>
        )}

        {/* POLISH: editable active sheet name */}
        {activeSheet && (
          renamingSheet ? (
            <input
              autoFocus
              value={sheetLabel}
              onChange={e => setSheetLabel(e.target.value)}
              onBlur={commitSheetRename}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
              style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text2, fontFamily: "'DM Sans',sans-serif", fontSize: 11, outline: 'none', minWidth: 80 }}
            />
          ) : (
            <span
              onDoubleClick={startSheetRename}
              title="Double-click to rename sheet"
              style={{ fontSize: 11, color: text3, cursor: 'text' }}
            >
              {activeSheet.name || 'Sheet 1'} · {blocks.length} block{blocks.length !== 1 ? 's' : ''}
            </span>
          )
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {[['text', '+ Text'], ['table', '+ Table'], ['kanban', '+ Kanban']].map(([type, label]) => (
            <button key={type} onClick={() => onAddBlock(type, Math.max(0, 120 - panRef.current.x + Math.random() * 40), Math.max(0, 80 - panRef.current.y + Math.random() * 30))} style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${border}`, background: 'transparent', color: text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer' }} onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }} onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text2 }}>{label}</button>
          ))}
          <span style={{ fontSize: 11, color: text3, paddingLeft: 8, borderLeft: `1px solid ${border}` }}>Right-click drag to pan · Right-click text to format</span>
        </div>
      </div>

      <div ref={containerRef} onClick={handleBgClick} onMouseDown={startPan} onContextMenu={e => e.preventDefault()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (!onDropColumn) return; const rect = containerRef.current.getBoundingClientRect(); onDropColumn(e.clientX - rect.left - panRef.current.x, e.clientY - rect.top - panRef.current.y) }}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', background: dark ? '#141412' : '#EAE7DE', cursor: 'crosshair', userSelect: 'none' }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs><pattern id="nb-dots" x={pan.x % 32} y={pan.y % 32} width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill={dark ? '#3a3835' : '#C0BCB2'} /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#nb-dots)" />
        </svg>
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          {blocks.map(block => (
            <div key={block.id} style={{ position: 'absolute', left: block.x, top: block.y, zIndex: 10 }}>
              {/* TEXT BLOCK */}
              {block.type === 'text' && (
                <div style={{ width: block.w || 320, minHeight: block.h || 150, background: surface, border: `1.5px solid ${border}`, borderRadius: 10, boxShadow: `0 4px 20px ${dark ? '#00000055' : '#00000015'}`, overflow: 'hidden', position: 'relative' }}>
                  <BlockHandle
                    notebookId={nb.id}
                    block={block}
                    label="text"
                    colors={colors}
                    renaming={renamingBlockId === block.id}
                    onStartRename={() => setRenamingBlockId(block.id)}
                    onStopRename={() => setRenamingBlockId(null)}
                    onRename={value => onUpdateBlock(block.id, { name: value })}
                    onDelete={() => confirmDelete(block)}
                    onHeaderDragStart={e => startBlockDrag(e, block)}
                  />
                  <TextBlockContent
                    blockId={block.id}
                    initialContent={block.content}
                    onSave={html => onUpdateBlock(block.id, { content: html })}
                    text={text}
                    colors={colors}
                    minHeight={Math.max(80, (block.h || 150) - 30)}
                    onEditStart={() => { editingRef.current = true }}
                    onEditEnd={() => {
                      editingRef.current = false
                      suppressNextBgClickRef.current = true
                    }}
                  />
                  <ResizeHandle border={border} onResizeStart={e => startResize(e, block)} />
                </div>
              )}
              {/* TABLE BLOCK — now resizable */}
              {block.type === 'table' && (
                <div style={{ width: block.w || 520, minHeight: block.h || 260, background: surface, border: `1.5px solid ${border}`, borderRadius: 10, boxShadow: `0 4px 20px ${dark ? '#00000055' : '#00000015'}`, overflow: 'hidden', position: 'relative' }}>
                  <BlockHandle
                    notebookId={nb.id}
                    block={block}
                    label="table"
                    draggableAsTable={true}
                    colors={colors}
                    renaming={renamingBlockId === block.id}
                    onStartRename={() => setRenamingBlockId(block.id)}
                    onStopRename={() => setRenamingBlockId(null)}
                    onRename={value => onUpdateBlock(block.id, { name: value })}
                    onDelete={() => confirmDelete(block)}
                    onHeaderDragStart={e => startBlockDrag(e, block)}
                  />
                  <div style={{ overflow: 'auto', maxHeight: Math.max(120, (block.h || 260) - 30) }}>
                    <table style={{ borderCollapse: 'collapse', fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
                      <thead><tr>
                        {block.headers.map((h, ci) => (
                          <th key={ci} style={{ padding: 0, borderRight: `1px solid ${border}`, background: accentDim, minWidth: 100 }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <input value={h} onChange={e => { const nh = [...block.headers]; nh[ci] = e.target.value; onUpdateBlock(block.id, { headers: nh }) }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onFocus={() => { editingRef.current = true }} onBlur={() => { editingRef.current = false }} style={{ flex: 1, background: 'transparent', border: 'none', color: accent, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", fontSize: 11, padding: '5px 7px', outline: 'none', minWidth: 0 }} />
                              <button title="Send to canvas" onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSendColToCanvas(block, ci); if (onRemoveTableColumn) onRemoveTableColumn(block.id, ci) }} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: 12, padding: '2px 6px', flexShrink: 0, opacity: 0.55 }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.55'}>→</button>
                            </div>
                          </th>
                        ))}
                        <th style={{ padding: '4px 6px', background: raised, borderLeft: `1px solid ${border}` }}>
                          <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { headers: [...block.headers, `Col ${block.headers.length + 1}`], rows: block.rows.map(r => [...r, '']) }) }} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>+</button>
                        </th>
                      </tr></thead>
                      <tbody>
                        {block.rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci} style={{ borderRight: `1px solid ${border}`, borderTop: `1px solid ${border}22`, padding: 0 }}>
                                <input value={cell} data-bid={block.id} data-ri={ri} data-ci={ci}
                                  onChange={e => { const nr = block.rows.map((r, rIdx) => rIdx !== ri ? r : r.map((c, cIdx) => cIdx !== ci ? c : e.target.value)); onUpdateBlock(block.id, { rows: nr }) }}
                                  onFocus={() => { editingRef.current = true }} onBlur={() => { editingRef.current = false }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); const nextRi = ri + 1; if (nextRi >= block.rows.length) { onUpdateBlock(block.id, { rows: [...block.rows, Array(block.headers.length).fill('')] }); setTimeout(() => document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${ci}"]`)?.focus(), 20) } else { document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${ci}"]`)?.focus() } }
                                    if (e.key === 'Tab') { e.preventDefault(); const isLastCol = ci + 1 >= block.headers.length; const nextCi = isLastCol ? 0 : ci + 1; const nextRi = isLastCol ? ri + 1 : ri; if (nextRi >= block.rows.length) { onUpdateBlock(block.id, { rows: [...block.rows, Array(block.headers.length).fill('')] }); setTimeout(() => document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${nextCi}"]`)?.focus(), 20) } else { document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${nextCi}"]`)?.focus() } }
                                  }}
                                  onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                                  style={{ width: '100%', background: 'transparent', border: 'none', color: text2, fontFamily: "'DM Mono',monospace", fontSize: 11, padding: '5px 7px', outline: 'none', minWidth: 80 }} />
                              </td>
                            ))}
                            <td style={{ borderTop: `1px solid ${border}22`, borderLeft: `1px solid ${border}`, width: 26 }}>
                              <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { rows: block.rows.filter((_, i) => i !== ri) }) }} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, width: '100%', padding: '5px 3px' }} onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
                            </td>
                          </tr>
                        ))}
                        <tr><td colSpan={block.headers.length + 1} style={{ borderTop: `1px solid ${border}22` }}>
                          <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { rows: [...block.rows, Array(block.headers.length).fill('')] }) }} style={{ width: '100%', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '5px', fontFamily: "'DM Sans',sans-serif" }} onMouseEnter={e => e.currentTarget.style.color = accent} onMouseLeave={e => e.currentTarget.style.color = text3}>+ row</button>
                        </td></tr>
                      </tbody>
                    </table>
                  </div>
                  <ResizeHandle border={border} onResizeStart={e => startResize(e, block)} />
                </div>
              )}
              {block.type === 'kanban' && (
                <div style={{ width: block.w || 720, minHeight: block.h || 280, background: surface, border: `1.5px solid ${border}`, borderRadius: 10, boxShadow: `0 4px 20px ${dark ? '#00000055' : '#00000015'}`, overflow: 'hidden', position: 'relative' }}>
                  <BlockHandle
                    notebookId={nb.id}
                    block={block}
                    label="kanban"
                    colors={colors}
                    renaming={renamingBlockId === block.id}
                    onStartRename={() => setRenamingBlockId(block.id)}
                    onStopRename={() => setRenamingBlockId(null)}
                    onRename={value => onUpdateBlock(block.id, { name: value })}
                    onDelete={() => confirmDelete(block)}
                    onHeaderDragStart={e => startBlockDrag(e, block)}
                  />
                  <div style={{ overflow: 'auto', maxHeight: Math.max(140, (block.h || 280) - 30) }}>
                    <KanbanBlock
                      block={block}
                      onUpdateBlock={onUpdateBlock}
                      colors={colors}
                      dark={dark}
                      editingRef={editingRef}
                    />
                  </div>
                  <ResizeHandle border={border} onResizeStart={e => startResize(e, block)} />
                </div>
              )}
            </div>
          ))}
        </div>
        {blocks.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ textAlign: 'center', color: text3, fontFamily: "'DM Sans',sans-serif" }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>📓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: text2, fontFamily: "'Syne',sans-serif", marginBottom: 8 }}>Click anywhere to write</div>
              <div style={{ fontSize: 12, lineHeight: 1.9 }}>Or use + Text · + Table · + Kanban above<br />Drag ⠿ grip to move blocks · Right-click drag to pan</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
