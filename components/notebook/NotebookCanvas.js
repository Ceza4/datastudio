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
  onAddConnection,
  onDeleteConnection,
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
  const [nbZoom, setNbZoom] = useState(1)
  const nbZoomRef = useRef(1)
  const [snapLines, setSnapLines] = useState([])
  const [isPresentation, setIsPresentation] = useState(false)
  const outerRef = useRef(null)
const [selectedIds, setSelectedIds] = useState(new Set())
  const [ctxMenu, setCtxMenu] = useState(null)
  const [mindMapMode, setMindMapMode] = useState(false)
  const [mindMapMaster, setMindMapMaster] = useState(null)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const snapRef = useRef(false)
  const [draggingBlockId, setDraggingBlockId] = useState(null)
  const [hoverSectionId, setHoverSectionId] = useState(null)
  const [hoveredConnId, setHoveredConnId] = useState(null)
  const [hoveredBlockId, setHoveredBlockId] = useState(null)
  const [animatingBlockId, setAnimatingBlockId] = useState(null)
  const [deletingBlockId, setDeletingBlockId] = useState(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef(null)
  const ctxMenuRef = useRef(null)

  useEffect(() => { setNbLabel(nb.name) }, [nb.name])
  useEffect(() => {
    function onFs() { if (!document.fullscreenElement) setIsPresentation(false) }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const activeSheet = nb.sheets?.find(s => s.id === nb.activeSheetId) || nb.sheets?.[0]
  const blocks = activeSheet?.blocks || []
  function selectBlock(id, ctrl) {
    if (ctrl) { setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
    else { setSelectedIds(new Set([id])) }
  }
  function handleBlockContextMenu(e, blockId) {
    e.preventDefault(); e.stopPropagation()
    if (!selectedIds.has(blockId)) setSelectedIds(new Set([blockId]))
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }
  function deleteSelected() {
    if (selectedIds.size === 0) return
    if (!window.confirm(`Delete ${selectedIds.size} block${selectedIds.size > 1 ? 's' : ''}?`)) return
    selectedIds.forEach(id => onDeleteBlock(id))
    setSelectedIds(new Set()); setCtxMenu(null)
  }
  function duplicateSelected() {
    selectedIds.forEach(id => {
      const b = blocks.find(bl => bl.id === id)
      if (!b) return
      const patch = {}
      if (b.w) patch.w = b.w
      if (b.h) patch.h = b.h
      if (b.name) patch.name = b.name + ' (copy)'
      if (b.type === 'text' && b.content) patch.content = b.content
      if (b.type === 'kanban' && b.lanes) patch.lanes = JSON.parse(JSON.stringify(b.lanes))
      onAddBlock(b.type, b.x + 30, b.y + 30,
        b.type === 'table' ? [...b.headers] : null,
        b.type === 'table' ? b.rows.map(r => [...r]) : null,
        b.w || null, b.h || null, patch)
    })
    setCtxMenu(null)
  }

  // ── Mind map & snap helpers ──
  const connections = activeSheet?.connections || []
  function toggleMindMap() { setMindMapMode(m => !m); setMindMapMaster(null) }
  function toggleSnap() { const next = !snapEnabled; setSnapEnabled(next); snapRef.current = next }

  function blockDims(b) {
    const w = b.w || (b.type === 'kanban' ? 720 : b.type === 'table' ? 520 : b.type === 'section' ? 500 : 320)
    const h = b.h || (b.type === 'kanban' ? 280 : b.type === 'table' ? 260 : b.type === 'section' ? 350 : 150)
    return { w, h }
  }

  function pickPortSide(fromB, toB) {
    const fc = { x: fromB.x + blockDims(fromB).w/2, y: fromB.y + blockDims(fromB).h/2 }
    const tc = { x: toB.x + blockDims(toB).w/2, y: toB.y + blockDims(toB).h/2 }
    const dx = tc.x - fc.x, dy = tc.y - fc.y
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top')
  }

  function addConnection(fromId, toId) {
    if (fromId === toId) return
    if (connections.some(c => c.fromBlockId === fromId && c.toBlockId === toId)) return
    const from = blocks.find(b => b.id === fromId)
    const to = blocks.find(b => b.id === toId)
    if (!from || !to) return
    const conn = {
      id: `conn_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      fromBlockId: fromId, toBlockId: toId,
      fromSide: pickPortSide(from, to),
      toSide: pickPortSide(to, from),
    }
    if (onAddConnection) onAddConnection(conn)
  }

  function deleteConnection(connId) {
    if (onDeleteConnection) onDeleteConnection(connId)
  }

  function getBlockConnections(blockId) {
    return connections.filter(c => c.fromBlockId === blockId || c.toBlockId === blockId)
  }

  /* Wrap delete with content-aware confirmation. We don't ask if the
     block is empty (no point making the user confirm "delete nothing"),
     but we do ask if there's actual data they could lose. */
  function confirmDelete(block) {
    let hasContent = false
    if (block.type === 'text') {
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
    // Animate out, then remove
    setDeletingBlockId(block.id)
    setTimeout(() => {
      onDeleteBlock(block.id)
      setDeletingBlockId(null)
      if (selectedIds.has(block.id)) setSelectedIds(new Set())
    }, 200)
  }
function addBlockAnimated(type, x, y) {
    const tempId = `temp_${Date.now()}`
    setAnimatingBlockId(tempId)
    onAddBlock(type, x, y)
    setTimeout(() => setAnimatingBlockId(null), 400)
  }

  // Close add menu when clicking outside
  useEffect(() => {
    if (!addMenuOpen) return
    function handleClick(e) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [addMenuOpen])
  useEffect(() => {
    if (!ctxMenu) return
    function h(e) { if (ctxMenuRef.current && ctxMenuRef.current.contains(e.target)) return; setCtxMenu(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ctxMenu])

  useEffect(() => {
    if (!mindMapMode) return
    function onKey(e) { if (e.key === 'Escape') { setMindMapMode(false); setMindMapMaster(null) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mindMapMode])
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
    const bzoom = window.visualViewport?.scale || 1
    const z = nbZoomRef.current
    const x = ((e.clientX - rect.left) / bzoom - panRef.current.x) / z
    const y = ((e.clientY - rect.top) / bzoom - panRef.current.y) / z
    setSelectedIds(new Set())
    addBlockAnimated('text', x - 140, y - 20)
  }

  function startBlockDrag(e, block) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    const startMX = e.clientX
    const startMY = e.clientY
    const origX = block.x
    const origY = block.y
    const { w: bw, h: bh } = blockDims(block)
    let dragging = false
    let currentHoverSection = null

    // If dragging a section, capture all child absolute positions up-front
    const childOffsets = block.type === 'section'
      ? blocks.filter(b => b.parentSectionId === block.id).map(c => ({ id: c.id, dx: c.x - origX, dy: c.y - origY }))
      : []

    function onMove(ev) {
      if (!dragging) {
        if (Math.abs(ev.clientX - startMX) < 5 && Math.abs(ev.clientY - startMY) < 5) return
        dragging = true
        setDraggingBlockId(block.id)
      }
      const z = nbZoomRef.current
      let nx = origX + (ev.clientX - startMX) / z
      let ny = origY + (ev.clientY - startMY) / z

      if (snapRef.current) {
        const ST = 6, lines = []
        blocks.forEach(b => {
          if (b.id === block.id) return
          const { w: ow, h: oh } = blockDims(b)
          if (Math.abs((nx + bw/2) - (b.x + ow/2)) < ST) { nx = b.x + ow/2 - bw/2; lines.push({ t:'v', p: b.x + ow/2 }) }
          else if (Math.abs(nx - b.x) < ST) { nx = b.x; lines.push({ t:'v', p: b.x }) }
          else if (Math.abs((nx+bw) - (b.x+ow)) < ST) { nx = b.x+ow-bw; lines.push({ t:'v', p: b.x+ow }) }
          if (Math.abs((ny + bh/2) - (b.y + oh/2)) < ST) { ny = b.y + oh/2 - bh/2; lines.push({ t:'h', p: b.y + oh/2 }) }
          else if (Math.abs(ny - b.y) < ST) { ny = b.y; lines.push({ t:'h', p: b.y }) }
          else if (Math.abs((ny+bh) - (b.y+oh)) < ST) { ny = b.y+oh-bh; lines.push({ t:'h', p: b.y+oh }) }
        })
        setSnapLines(lines)
      } else if (snapLines.length > 0) {
        setSnapLines([])
      }

      onUpdateBlock(block.id, { x: nx, y: ny })

      // Drag section's children with it
      if (block.type === 'section') {
        childOffsets.forEach(c => onUpdateBlock(c.id, { x: nx + c.dx, y: ny + c.dy }))
      } else {
        // Live containment detection based on CURSOR position (not block center)
        const rect = containerRef.current.getBoundingClientRect()
        const bzoom = window.visualViewport?.scale || 1
        const cx = ((ev.clientX - rect.left) / bzoom - panRef.current.x) / z
        const cy = ((ev.clientY - rect.top) / bzoom - panRef.current.y) / z
        let hit = null
        blocks.forEach(s => {
          if (s.type !== 'section' || s.id === block.id) return
          const { w: sw, h: sh } = blockDims(s)
          if (cx >= s.x && cx <= s.x + sw && cy >= s.y && cy <= s.y + sh) hit = s.id
        })
        if (hit !== currentHoverSection) {
          currentHoverSection = hit
          setHoverSectionId(hit)
        }
      }
    }
    function onUp(ev) {
      setSnapLines([])
      setDraggingBlockId(null)
      setHoverSectionId(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)

      if (dragging && block.type !== 'section') {
        if (currentHoverSection !== (block.parentSectionId || null)) {
          onUpdateBlock(block.id, { parentSectionId: currentHoverSection })
        }
      }
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
        w: Math.max(220, baseW + (ev.clientX - startX) / nbZoomRef.current),
        h: Math.max(120, baseH + (ev.clientY - startY) / nbZoomRef.current),
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
  function togglePresentation() {
    if (!document.fullscreenElement) {
      outerRef.current?.requestFullscreen?.().then(() => setIsPresentation(true)).catch(() => {})
    } else {
      document.exitFullscreen?.().then(() => setIsPresentation(false)).catch(() => {})
    }
  }
  function commitSheetRename() {
    if (activeSheet && onRenameSheet) {
      onRenameSheet(activeSheet.id, sheetLabel || activeSheet.name)
    }
    setRenamingSheet(false)
  }
  // Connection port dots on hovered/selected blocks
  function Ports({ show }) {
    if (!show) return null
    const p = (pos) => ({
      position: 'absolute', ...pos, width: 8, height: 8, borderRadius: '50%',
      background: surface, border: `2px solid ${accent}`, zIndex: 30,
      transition: 'transform 0.15s ease', opacity: 0.7, cursor: 'crosshair',
    })
    return (<>
      <div style={p({ top: -4, left: '50%', marginLeft: -4 })} onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.4)'; e.currentTarget.style.background = accent }} onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = surface }} />
      <div style={p({ bottom: -4, left: '50%', marginLeft: -4 })} onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.4)'; e.currentTarget.style.background = accent }} onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = surface }} />
      <div style={p({ top: '50%', left: -4, marginTop: -4 })} onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.4)'; e.currentTarget.style.background = accent }} onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = surface }} />
      <div style={p({ top: '50%', right: -4, marginTop: -4 })} onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.4)'; e.currentTarget.style.background = accent }} onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = surface }} />
    </>)
  }
// Scroll-wheel pans the notebook canvas
  // Scroll-wheel: pan + Ctrl+scroll: zoom (rAF-throttled)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let rafId = null
    function flush() {
      rafId = null
      setPan({ ...panRef.current })
      setNbZoom(nbZoomRef.current)
    }
    function schedule() { if (rafId == null) rafId = requestAnimationFrame(flush) }
    function handleWheel(e) {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left, my = e.clientY - rect.top
        const oldZ = nbZoomRef.current
        const newZ = Math.min(3, Math.max(0.25, oldZ - e.deltaY * 0.002))
        const ratio = newZ / oldZ
        panRef.current = { x: mx - (mx - panRef.current.x) * ratio, y: my - (my - panRef.current.y) * ratio }
        nbZoomRef.current = newZ
      } else {
        panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY }
      }
      schedule()
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => { el.removeEventListener('wheel', handleWheel); if (rafId) cancelAnimationFrame(rafId) }
  }, [])
  return (
    <div ref={outerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif", background: dark ? '#141412' : '#EAE7DE' }}>
    {/* ── Floating Island ── */}
      <div style={{ position: 'absolute', top: 16, left: '25%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: 0, padding: '4px 6px', background: `${surface}dd`, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 10, border: `1px solid ${border}`, boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`, fontFamily: "'DM Sans',sans-serif", alignItems: 'center' }}>
        {/* Left: Back + Name */}
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 12, padding: '4px 6px', borderRadius: 4, fontFamily: "'DM Sans',sans-serif" }}
          onMouseEnter={e => e.currentTarget.style.color = text}
          onMouseLeave={e => e.currentTarget.style.color = text3}>←</button>
        <span style={{ fontSize: 12, marginRight: 4 }}>📓</span>
        {renamingNb ? (
          <input autoFocus value={nbLabel} onChange={e => setNbLabel(e.target.value)} onBlur={() => { onRenameNotebook(nbLabel || nb.name); setRenamingNb(false) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} maxLength={40} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, outline: 'none', minWidth: 100, maxWidth: 200 }} />
        ) : (
          <span onDoubleClick={() => setRenamingNb(true)} style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: text, cursor: 'text', marginRight: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }}>{nb.name}</span>
        )}
        {activeSheet && !renamingSheet && (
          <span onDoubleClick={() => { setSheetLabel(activeSheet.name); setRenamingSheet(true) }} style={{ fontSize: 10, color: text3, cursor: 'text', marginRight: 4 }}>
            · {activeSheet.name || 'Sheet 1'} · {blocks.length} block{blocks.length !== 1 ? 's' : ''}
          </span>
        )}
        {renamingSheet && (
          <input autoFocus value={sheetLabel} onChange={e => setSheetLabel(e.target.value)} onBlur={commitSheetRename} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text2, fontSize: 10, outline: 'none', minWidth: 60, marginRight: 4 }} />
        )}

        
        <div style={{ width: 1, height: 18, background: border, margin: '0 6px' }} />
        <span style={{ fontSize: 10, color: text3, fontFamily: "'DM Mono',monospace", padding: '0 4px' }}onClick={() => { nbZoomRef.current = 1; setNbZoom(1); panRef.current = { x: 60, y: 60 }; setPan({ x: 60, y: 60 }) }} title="Click to reset">{Math.round(nbZoom * 100)}%</span>
        <div style={{ width: 1, height: 18, background: border, margin: '0 6px' }} />
        <button onClick={togglePresentation} title={isPresentation ? 'Exit fullscreen' : 'Presentation mode'}
          style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 10, padding: '2px 4px', fontFamily: "'DM Sans',sans-serif" }}
          onMouseEnter={e => e.currentTarget.style.color = accent} onMouseLeave={e => e.currentTarget.style.color = text3}>
          {isPresentation ? 'End Presentation' : 'Present'}
        </button>
        
      </div>

      {/* ── Floating Island Toolbar ── */}
      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: 4, padding: '5px 6px', background: `${surface}ee`, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 10, border: `1px solid ${border}`, boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.1)'}`, fontFamily: "'DM Sans',sans-serif", alignItems: 'center' }}>
        {/* Add block dropdown */}
        <div ref={addMenuRef} style={{ position: 'relative' }}>
          <button onClick={() => setAddMenuOpen(!addMenuOpen)}
            style={{ padding: '4px 10px', background: addMenuOpen ? accentDim : 'none', border: `1px solid ${addMenuOpen ? accent : border}`, borderRadius: 6, color: addMenuOpen ? accent : text3, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: addMenuOpen ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4 }}
            onMouseEnter={e => { if (!addMenuOpen) { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent } }}
            onMouseLeave={e => { if (!addMenuOpen) { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 } }}>
            + Add
          </button>
          {addMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: `0 8px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}`, overflow: 'hidden', minWidth: 140, zIndex: 200 }}>
              {[['text', '', 'Text Block'], ['table', '', 'Table Block'], ['kanban', '', 'Kanban Board'], ['section', '', 'Section']].map(([type, icon, label]) => (
                <button key={type} onClick={() => { const z = nbZoomRef.current; addBlockAnimated(type, (200 - panRef.current.x) / z + Math.random() * 40, (120 - panRef.current.y) / z + Math.random() * 30); setAddMenuOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: text2, fontSize: 12, fontFamily: "'DM Sans',sans-serif", cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = text2 }}>
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{icon}</span>{label}
                  
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 18, background: border, margin: '0 2px' }} />

        <button onClick={toggleSnap} title={snapEnabled ? 'Snap to grid: on' : 'Snap to grid: off'}
          style={{ padding: '4px 8px', background: snapEnabled ? accentDim : 'transparent', border: `1px solid ${snapEnabled ? accent : 'transparent'}`, borderRadius: 6, color: snapEnabled ? accent : text3, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: snapEnabled ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}
          onMouseEnter={e => { if (!snapEnabled) { e.currentTarget.style.color = text2; e.currentTarget.style.background = raised } }}
          onMouseLeave={e => { if (!snapEnabled) { e.currentTarget.style.color = text3; e.currentTarget.style.background = 'transparent' } }}>
          ⊞ Snap
        </button>

        <button onClick={toggleMindMap} title={mindMapMode ? 'Exit mind map mode' : 'Click master then slave to connect'}
          style={{ padding: '4px 8px', background: mindMapMode ? accentDim : 'transparent', border: `1px solid ${mindMapMode ? accent : 'transparent'}`, borderRadius: 6, color: mindMapMode ? accent : text3, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: mindMapMode ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}
          onMouseEnter={e => { if (!mindMapMode) { e.currentTarget.style.color = text2; e.currentTarget.style.background = raised } }}
          onMouseLeave={e => { if (!mindMapMode) { e.currentTarget.style.color = text3; e.currentTarget.style.background = 'transparent' } }}>
          ⟋ Mind map
        </button>

        <div style={{ width: 1, height: 18, background: border, margin: '0 2px' }} />

        <span style={{ fontSize: 10, color: text3, fontFamily: "'DM Mono',monospace", padding: '0 6px', cursor: 'pointer' }} onClick={() => { nbZoomRef.current = 1; setNbZoom(1); panRef.current = { x: 60, y: 60 }; setPan({ x: 60, y: 60 }) }} title="Click to reset">{Math.round(nbZoom * 100)}%</span>

        <div style={{ width: 1, height: 18, background: border, margin: '0 2px' }} />

        <span style={{ fontSize: 10, color: text3, padding: '4px 6px' }}>Scroll to pan · Right-click text to format</span>
      </div>

      {mindMapMode && (
        <div style={{ position: 'absolute', top: 120, left: '50%', transform: 'translateX(-50%)', zIndex: 150, padding: '8px 16px', background: accentDim, border: `1px solid ${accent}`, borderRadius: 8, boxShadow: `0 4px 20px ${dark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.1)'}`, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: accent, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>⟋</span>
          <span>{mindMapMaster ? 'Click slave block (Esc to finish)' : 'Click master block'}</span>
          <button onClick={() => { setMindMapMode(false); setMindMapMaster(null) }} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, opacity: 0.7 }}>✕</button>
        </div>
      )}
      {ctxMenu && (() => {
        const singleBlockId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null
        const singleConns = singleBlockId ? getBlockConnections(singleBlockId) : []
        return (
        <div ref={ctxMenuRef} style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 300, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: `0 8px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}`, overflow: 'hidden', minWidth: 170, fontFamily: "'DM Sans',sans-serif" }}>
          {[
            { label: `Duplicate (${selectedIds.size})`, icon: '⊕', color: text2, action: duplicateSelected },
            { label: `Delete (${selectedIds.size})`, icon: '✕', color: red, action: deleteSelected },
          ].map((item, i) => (
            <button key={i} onClick={item.action}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: item.color, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}
              onMouseEnter={e => e.currentTarget.style.background = raised} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <span style={{ width: 16, textAlign: 'center' }}>{item.icon}</span>{item.label}
            </button>
          ))}
          {singleConns.length > 0 && (<>
            <div style={{ borderTop: `1px solid ${border}`, margin: '2px 0' }} />
            <div style={{ padding: '6px 12px 2px', fontSize: 10, color: text3, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1 }}>Delete mind map</div>
            {singleConns.map(conn => {
              const otherId = conn.fromBlockId === singleBlockId ? conn.toBlockId : conn.fromBlockId
              const other = blocks.find(b => b.id === otherId)
              const label = other?.name || (other?.type === 'text' ? (other?.content || '').replace(/<[^>]*>/g,'').slice(0,24) : '') || other?.type || 'block'
              const arrow = conn.fromBlockId === singleBlockId ? '→' : '←'
              return (
                <button key={conn.id} onClick={() => { deleteConnection(conn.id); setCtxMenu(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: text2, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = red }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = text2 }}>
                  <span style={{ width: 16, textAlign: 'center', color: accent }}>{arrow}</span>{label}
                </button>
              )
            })}
          </>)}
        </div>
        )
      })()}
<style>{`
        @keyframes dsBlockAppear {
          0% { opacity: 0; transform: scale(0.92) translateY(6px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes dsBlockDelete {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.92); }
        }
      `}</style>
      <div ref={containerRef} onClick={handleBgClick} onMouseDown={startPan} onContextMenu={e => e.preventDefault()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (!onDropColumn) return; const rect = containerRef.current.getBoundingClientRect(); onDropColumn(e.clientX - rect.left - panRef.current.x, e.clientY - rect.top - panRef.current.y) }}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', background: dark ? '#141412' : '#EAE7DE', cursor: 'crosshair', userSelect: 'none' }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs><pattern id="nb-dots" x={pan.x % (32 * nbZoom)} y={pan.y % (32 * nbZoom)} width={32 * nbZoom} height={32 * nbZoom} patternUnits="userSpaceOnUse"><circle cx={nbZoom} cy={nbZoom} r={nbZoom} fill={dark ? '#3a3835' : '#C0BCB2'} /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#nb-dots)" />
        </svg>
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${nbZoom})`, transformOrigin: '0 0' }}>
          {snapLines.length > 0 && (
            <svg style={{ position:'absolute', top:-3000, left:-3000, width:9000, height:9000, pointerEvents:'none', zIndex:50 }}>
              {snapLines.map((l,i) => l.t==='v'
                ? <line key={i} x1={l.p+3000} y1={0} x2={l.p+3000} y2={9000} stroke={accent} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
                : <line key={i} x1={0} y1={l.p+3000} x2={9000} y2={l.p+3000} stroke={accent} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
              )}
            </svg>
          )}
          {/* Connection lines layer — sits between sections (z=1) and blocks (z=10) */}
          <svg style={{ position: 'absolute', top: -3000, left: -3000, width: 9000, height: 9000, pointerEvents: 'none', zIndex: 5, overflow: 'visible' }}>
            <defs>
              <filter id="nb-line-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {connections.map(conn => {
              const from = blocks.find(b => b.id === conn.fromBlockId)
              const to = blocks.find(b => b.id === conn.toBlockId)
              if (!from || !to) return null
              const { w: fw, h: fh } = blockDims(from)
              const { w: tw, h: th } = blockDims(to)
              const fc = { x: from.x + fw/2, y: from.y + fh/2 }
              const tc = { x: to.x + tw/2, y: to.y + th/2 }
              const dx = tc.x - fc.x, dy = tc.y - fc.y
              const fs = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top')
              const ts = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'top' : 'bottom')
              const portPos = (b, side) => {
                const { w, h } = blockDims(b)
                if (side === 'top') return { x: b.x + w/2, y: b.y }
                if (side === 'bottom') return { x: b.x + w/2, y: b.y + h }
                if (side === 'left') return { x: b.x, y: b.y + h/2 }
                return { x: b.x + w, y: b.y + h/2 }
              }
              const p1 = portPos(from, fs)
              const p2 = portPos(to, ts)
              const cdx = p2.x - p1.x, cdy = p2.y - p1.y
              const curve = Math.min(120, Math.max(40, Math.hypot(cdx, cdy) * 0.4))
              const c1 = { x: p1.x + (fs === 'right' ? curve : fs === 'left' ? -curve : 0), y: p1.y + (fs === 'bottom' ? curve : fs === 'top' ? -curve : 0) }
              const c2 = { x: p2.x + (ts === 'right' ? curve : ts === 'left' ? -curve : 0), y: p2.y + (ts === 'bottom' ? curve : ts === 'top' ? -curve : 0) }
              const path = `M ${p1.x + 3000} ${p1.y + 3000} C ${c1.x + 3000} ${c1.y + 3000}, ${c2.x + 3000} ${c2.y + 3000}, ${p2.x + 3000} ${p2.y + 3000}`
              const isSel = selectedIds.has(conn.fromBlockId) || selectedIds.has(conn.toBlockId)
              const isHov = hoveredBlockId === conn.fromBlockId || hoveredBlockId === conn.toBlockId || hoveredConnId === conn.id
              const highlight = isSel || isHov
              return (
                <g key={conn.id}>
                  {/* Invisible wider hit-area for hover */}
                  <path d={path} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredConnId(conn.id)} onMouseLeave={() => setHoveredConnId(null)} />
                  <path d={path} fill="none" stroke={accent}
                    strokeWidth={highlight ? 2.2 : 1.5}
                    strokeDasharray={highlight ? 'none' : '5 4'}
                    opacity={highlight ? 0.95 : 0.5}
                    filter={isSel ? 'url(#nb-line-glow)' : undefined}
                    style={{ transition: 'opacity 0.2s, stroke-width 0.2s' }} />
                  <circle r={highlight ? 3.5 : 3} fill={accent} opacity={highlight ? 1 : 0.85}
                    filter={isSel ? 'url(#nb-line-glow)' : undefined}>
                    <animateMotion dur={highlight ? '1.8s' : '2.4s'} repeatCount="indefinite" path={path} />
                  </circle>
                </g>
              )
            })}
          </svg>

          {blocks.map((block, bi) => {
            const isSelected = selectedIds.has(block.id)
            const isHovered = hoveredBlockId === block.id
            const isDeleting = deletingBlockId === block.id
            const isNew = bi === blocks.length - 1 && animatingBlockId
            const isActive = isSelected || isHovered
            return (
            <div key={block.id}
              onMouseEnter={() => setHoveredBlockId(block.id)}
              onMouseLeave={() => setHoveredBlockId(null)}
              onPointerDownCapture={e => {
                if (e.button === 2 && selectedIds.has(block.id)) return
                if (mindMapMode && e.button === 0) {
                  e.preventDefault(); e.stopPropagation()
                  if (!mindMapMaster) { setMindMapMaster(block.id) }
                  else if (mindMapMaster !== block.id) { addConnection(mindMapMaster, block.id) }
                  return
                }
                selectBlock(block.id, e.ctrlKey || e.metaKey)
              }}
onContextMenu={e => handleBlockContextMenu(e, block.id)}
              style={(() => {
                const base = {
                  position: 'absolute', left: block.x, top: block.y,
                  zIndex: block.type === 'section' ? (isSelected ? 3 : 1) : (isSelected ? 20 : isHovered ? 15 : 10),
                  transition: isDeleting ? 'none' : 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease, clip-path 0.15s ease, z-index 0s',
                  transformOrigin: 'top left',
                  transform:
                    draggingBlockId === block.id && hoverSectionId
                      ? 'scale(0.6)'
                      : 'scale(1)',
                  animation: isDeleting ? 'dsBlockDelete 0.2s ease forwards' : isNew ? 'dsBlockAppear 0.3s cubic-bezier(0.34,1.56,0.64,1)' : 'none',
                }
                // Clip child blocks to their parent section's bounds
                if (block.parentSectionId && draggingBlockId !== block.id) {
                  const parent = blocks.find(b => b.id === block.parentSectionId)
                  if (parent) {
                    const pw = parent.w || 500, ph = parent.h || 350
                    const top = Math.max(0, parent.y - block.y)
                    const left = Math.max(0, parent.x - block.x)
                    const right = Math.max(0, (block.x + (block.w || 320)) - (parent.x + pw))
                    const bottom = Math.max(0, (block.y + (block.h || 150)) - (parent.y + ph))
                    base.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`
                  }
                }
                return base
              })()}>

              {/* TEXT BLOCK */}
              {block.type === 'text' && (
                <div style={{
                  width: block.w || 320, minHeight: block.h || 150,
                  background: isSelected ? `linear-gradient(135deg, ${raised}, ${surface})` : surface,
                  border: `1.5px solid ${isSelected ? accent : isHovered ? border : dark ? '#252420' : '#D5D1C7'}`,
                  borderRadius: 10, overflow: 'hidden', position: 'relative',
                  boxShadow: isSelected
                    ? `0 0 0 2px ${dark ? 'rgba(91,95,232,0.12)' : 'rgba(29,158,117,0.12)'}, 0 8px 32px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)'}`
                    : isHovered
                    ? `0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease',
                }}>
                  {/* Accent bar */}
                  <div style={{ height: isSelected ? 3 : 0, background: accent, transition: 'height 0.2s ease', borderRadius: '10px 10px 0 0' }} />
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
                <Ports show={isSelected || isHovered} />
                </div>
              )}
              {/* TABLE BLOCK — now resizable */}
             {block.type === 'table' && (
                <div style={{
                  width: block.w || 520, minHeight: block.h || 260,
                  background: isSelected ? `linear-gradient(135deg, ${raised}, ${surface})` : surface,
                  border: `1.5px solid ${isSelected ? accent : isHovered ? border : dark ? '#252420' : '#D5D1C7'}`,
                  borderRadius: 10, overflow: 'hidden', position: 'relative',
                  boxShadow: isSelected
                    ? `0 0 0 2px ${dark ? 'rgba(91,95,232,0.12)' : 'rgba(29,158,117,0.12)'}, 0 8px 32px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)'}`
                    : isHovered
                    ? `0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease',
                }}>
                  <div style={{ height: isSelected ? 3 : 0, background: accent, transition: 'height 0.2s ease', borderRadius: '10px 10px 0 0' }} />
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
                              <button title="Delete column" onMouseDown={e => e.stopPropagation()} onClick={e => {
                                e.stopPropagation()
                                if (block.headers.length <= 1) { confirmDelete(block); return }
                                onUpdateBlock(block.id, { headers: block.headers.filter((_, i) => i !== ci), rows: block.rows.map(r => r.filter((_, i) => i !== ci)) })
                              }} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 9, padding: '2px 3px', flexShrink: 0, opacity: 0.3 }}
                                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = red }}
                                onMouseLeave={e => { e.currentTarget.style.opacity = '0.3'; e.currentTarget.style.color = text3 }}>✕</button>
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
                                <textarea value={cell} data-bid={block.id} data-ri={ri} data-ci={ci} rows={1}
                                  onChange={e => {
                                    const nr = block.rows.map((r, rIdx) => rIdx !== ri ? r : r.map((c, cIdx) => cIdx !== ci ? c : e.target.value))
                                    onUpdateBlock(block.id, { rows: nr })
                                    e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'
                                  }}
                                  onFocus={e => { editingRef.current = true; e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                                  onBlur={() => { editingRef.current = false }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const nextRi = ri + 1; if (nextRi >= block.rows.length) { onUpdateBlock(block.id, { rows: [...block.rows, Array(block.headers.length).fill('')] }); setTimeout(() => document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${ci}"]`)?.focus(), 20) } else { document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${ci}"]`)?.focus() } }
                                    if (e.key === 'Tab') { e.preventDefault(); const isLastCol = ci + 1 >= block.headers.length; const nextCi = isLastCol ? 0 : ci + 1; const nextRi = isLastCol ? ri + 1 : ri; if (nextRi >= block.rows.length) { onUpdateBlock(block.id, { rows: [...block.rows, Array(block.headers.length).fill('')] }); setTimeout(() => document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${nextCi}"]`)?.focus(), 20) } else { document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${nextCi}"]`)?.focus() } }
                                    if (e.key === 'ArrowDown') { e.preventDefault(); const tgt = document.querySelector(`[data-bid="${block.id}"][data-ri="${ri + 1}"][data-ci="${ci}"]`); if (tgt) tgt.focus() }
                                    if (e.key === 'ArrowUp') { e.preventDefault(); const tgt = document.querySelector(`[data-bid="${block.id}"][data-ri="${ri - 1}"][data-ci="${ci}"]`); if (tgt) tgt.focus() }
                                  }}
                                  onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                                  style={{ width: '100%', background: 'transparent', border: 'none', color: text2, fontFamily: "'DM Mono',monospace", fontSize: 11, padding: '5px 7px', outline: 'none', minWidth: 60, resize: 'none', overflow: 'hidden', lineHeight: 1.5, wordBreak: 'break-word' }} />
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
                <Ports show={isSelected || isHovered} />
                </div>
              )}
              {/* SECTION BLOCK — always sits behind other blocks */}
              {block.type === 'section' && (
                <div style={{
                  width: block.w || 500, height: block.h || 350,
                  background: `${block.sectionColor || accent}08`,
                  border: `2px dashed ${hoverSectionId === block.id ? (block.sectionColor || accent) : `${block.sectionColor || accent}44`}`,
                  borderRadius: 12, overflow: 'hidden', position: 'relative',
                  boxShadow: hoverSectionId === block.id
                    ? `0 0 0 3px ${block.sectionColor || accent}22`
                    : isSelected
                    ? `0 0 0 2px ${block.sectionColor || accent}22, 0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 38, background: `${block.sectionColor || accent}18`, borderBottom: `1px solid ${block.sectionColor || accent}22`, cursor: 'grab' }}
                    onMouseDown={e => startBlockDrag(e, block)}>
                    <div style={{ width: 4, height: 18, borderRadius: 2, background: block.sectionColor || accent }} />
                    {renamingBlockId === block.id ? (
                      <input autoFocus defaultValue={block.name || 'Section'} onBlur={e => { onUpdateBlock(block.id, { name: e.target.value || 'Section' }); setRenamingBlockId(null) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} onMouseDown={e => e.stopPropagation()} maxLength={40}
                        style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${block.sectionColor || accent}`, color: text, fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, outline: 'none', minWidth: 0 }} />
                    ) : (
                      <span onDoubleClick={e => { e.stopPropagation(); setRenamingBlockId(block.id) }} style={{ flex: 1, color: text, fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{block.name || 'Section'}</span>
                    )}
                    <div style={{ display: 'flex', gap: 3 }}>
                      {['#5B5FE8','#1D9E75','#E8B85B','#f87171','#a78bfa','#38bdf8','#fb923c'].map(hex => (
                        <div key={hex} onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { sectionColor: hex }) }} onMouseDown={e => e.stopPropagation()}
                          style={{ width: 9, height: 9, borderRadius: '50%', background: hex, cursor: 'pointer', border: hex === (block.sectionColor || accent) ? `2px solid ${text}` : '2px solid transparent' }} />
                      ))}
                    </div>
                    <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); confirmDelete(block) }} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 13, padding: '2px 4px', opacity: 0.5 }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = red }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = text3 }}>✕</button>
                  </div>
                  {blocks.filter(b => b.parentSectionId === block.id).length === 0 && (
                    <div style={{ position: 'absolute', top: 38, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: `${block.sectionColor || accent}77`, fontSize: 11, fontStyle: 'italic', fontFamily: "'DM Sans',sans-serif" }}>
                      Drag blocks here
                    </div>
                  )}
                  <ResizeHandle border={border} onResizeStart={e => startResize(e, block)} />
                </div>
              )}
              {block.type === 'kanban' && (
                <div style={{
                  width: block.w || 720, minHeight: block.h || 280,
                  background: isSelected ? `linear-gradient(135deg, ${raised}, ${surface})` : surface,
                  border: `1.5px solid ${isSelected ? accent : isHovered ? border : dark ? '#252420' : '#D5D1C7'}`,
                  borderRadius: 10, overflow: 'hidden', position: 'relative',
                  boxShadow: isSelected
                    ? `0 0 0 2px ${dark ? 'rgba(91,95,232,0.12)' : 'rgba(29,158,117,0.12)'}, 0 8px 32px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)'}`
                    : isHovered
                    ? `0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease',
                }}>
                  <div style={{ height: isSelected ? 3 : 0, background: accent, transition: 'height 0.2s ease', borderRadius: '10px 10px 0 0' }} />
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
                 <Ports show={isSelected || isHovered} />
                </div>
              )}
            </div>
            )
          })}
        </div>
        {blocks.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ textAlign: 'center', color: text3, fontFamily: "'DM Sans',sans-serif" }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>📓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: text2, fontFamily: "'Syne',sans-serif", marginBottom: 8 }}>Click anywhere to write</div>
              <div style={{ fontSize: 12, lineHeight: 1.9 }}>Or use + Text · + Table · + Kanban above<br />Drag header to move blocks · Right-click drag to pan</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

