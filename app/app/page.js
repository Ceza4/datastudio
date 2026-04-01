'use client'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTheme } from '../providers'
import * as XLSX from 'xlsx'

const defaultColFormat = () => ({
  fontSize: 12,
  bold: false,
  align: 'left',
  wrap: false,
})

const defaultGlobalFormat = () => ({
  freezeHeader: false,
  banding: false,
  borderStyle: 'none',
  boldHeader: true,
  headerColor: '#5B5FE8',
  exportAsTable: false, // moved into format bar
})
function NotebookCanvas({ nb, dark, colors, onBack, onAddBlock, onUpdateBlock, onDeleteBlock, onRenameNotebook, onSendColToCanvas, onDropColumn, onAddSheet, onDeleteSheet, onRenameSheet, onSetActiveSheet }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim, red, base, green, amber } = colors
  const containerRef = useRef(null)
  const [pan, setPan] = useState({ x: 60, y: 60 })
  const panRef = useRef({ x: 60, y: 60 })
  const [renamingNb, setRenamingNb] = useState(false)
  const [nbLabel, setNbLabel] = useState(nb.name)
  const [sheetsOpen, setSheetsOpen] = useState(false)
  const [renamingSheetId, setRenamingSheetId] = useState(null)
  const [renamingSheetLabel, setRenamingSheetLabel] = useState('')
  const [cardDrag, setCardDrag] = useState(null)
  const [cardDragOver, setCardDragOver] = useState(null)
  useEffect(() => { setNbLabel(nb.name) }, [nb.name])

  const activeSheet = nb.sheets?.find(s => s.id === nb.activeSheetId) || nb.sheets?.[0]
  const blocks = activeSheet?.blocks || []

  function handleBgClick(e) {
    if (e.target !== e.currentTarget) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - panRef.current.x
    const y = e.clientY - rect.top - panRef.current.y
    onAddBlock('text', Math.max(0, x - 140), Math.max(0, y - 20))
  }
  function startBlockDrag(e, blockId, blockX, blockY) {
    if (e.button !== 0) return
    e.stopPropagation()
    let dragging = false
    const origX = blockX, origY = blockY, startMX = e.clientX, startMY = e.clientY
    function onMove(ev) {
      if (!dragging) {
        if (Math.abs(ev.clientX - startMX) < 5 && Math.abs(ev.clientY - startMY) < 5) return
        dragging = true
      }
      onUpdateBlock(blockId, { x: origX + ev.clientX - startMX, y: origY + ev.clientY - startMY })
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }
  function startPan(e) {
    if (e.button !== 2) return
    e.preventDefault()
    const startX = e.clientX - panRef.current.x, startY = e.clientY - panRef.current.y
    function onMove(ev) { const nx = ev.clientX - startX, ny = ev.clientY - startY; panRef.current = { x: nx, y: ny }; setPan({ x: nx, y: ny }) }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }

  function BlockHandle({ block, label }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 30, background: raised, borderBottom: `1px solid ${border}`, cursor: 'grab' }}
        onMouseDown={e => startBlockDrag(e, block.id, block.x, block.y)}>
        <span style={{ fontSize: 10, color: text3, letterSpacing: 1.5, userSelect: 'none', flexShrink: 0 }}>⠿</span>
        <span style={{ fontSize: 9, color: text3, textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0, opacity: 0.6 }}>{label}</span>
        <input value={block.name || ''} onChange={e => onUpdateBlock(block.id, { name: e.target.value })}
          placeholder="Untitled" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          style={{ flex: 1, background: 'transparent', border: 'none', color: text2, fontFamily: "'DM Sans',sans-serif", fontSize: 11, outline: 'none', fontStyle: block.name ? 'normal' : 'italic' }} />
        <button onClick={e => { e.stopPropagation(); onDeleteBlock(block.id) }}
          style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
      </div>
    )
  }

  const CARD_COLORS = ['#5B5FE8','#4ade80','#E8B85B','#f87171','#a78bfa','#38bdf8','#fb923c']

  function KanbanBlock({ block }) {
    const [addingCard, setAddingCard] = useState({})
    const [newCardTitle, setNewCardTitle] = useState({})
    function addCard(laneId) {
      const title = (newCardTitle[laneId] || '').trim()
      if (!title) return
      const card = { id: `card_${Date.now()}`, title, tag: '', color: CARD_COLORS[0] }
      onUpdateBlock(block.id, { lanes: block.lanes.map(l => l.id === laneId ? { ...l, cards: [...l.cards, card] } : l) })
      setNewCardTitle(p => ({ ...p, [laneId]: '' }))
      setAddingCard(p => ({ ...p, [laneId]: false }))
    }
    function moveCard(cardId, fromLaneId, toLaneId) {
      if (fromLaneId === toLaneId) return
      let card
      const newLanes = block.lanes.map(l => {
        if (l.id === fromLaneId) { card = l.cards.find(c => c.id === cardId); return { ...l, cards: l.cards.filter(c => c.id !== cardId) } }
        return l
      }).map(l => l.id === toLaneId && card ? { ...l, cards: [...l.cards, card] } : l)
      onUpdateBlock(block.id, { lanes: newLanes })
    }
    function deleteCard(laneId, cardId) {
      onUpdateBlock(block.id, { lanes: block.lanes.map(l => l.id === laneId ? { ...l, cards: l.cards.filter(c => c.id !== cardId) } : l) })
    }
    function updateCard(laneId, cardId, patch) {
      onUpdateBlock(block.id, { lanes: block.lanes.map(l => l.id === laneId ? { ...l, cards: l.cards.map(c => c.id === cardId ? { ...c, ...patch } : c) } : l) })
    }
    return (
      <div style={{ display: 'flex', gap: 8, padding: 10, alignItems: 'flex-start', overflowX: 'auto', maxWidth: '70vw' }}>
        {block.lanes.map(lane => (
          <div key={lane.id}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setCardDragOver({ laneId: lane.id, blockId: block.id }) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setCardDragOver(null) }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); if (cardDrag?.blockId === block.id) { moveCard(cardDrag.cardId, cardDrag.fromLaneId, lane.id); setCardDrag(null); setCardDragOver(null) } }}
            style={{ width: 200, background: cardDragOver?.laneId === lane.id && cardDragOver?.blockId === block.id ? accentDim : (dark ? '#1a1917' : '#DDD9CF'), borderRadius: 8, padding: 8, border: cardDragOver?.laneId === lane.id && cardDragOver?.blockId === block.id ? `1px solid ${accent}` : `1px solid ${border}`, transition: 'all 0.15s', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <input value={lane.name} onChange={e => onUpdateBlock(block.id, { lanes: block.lanes.map(l => l.id === lane.id ? { ...l, name: e.target.value } : l) })}
                onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                style={{ flex: 1, background: 'transparent', border: 'none', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 12, color: text, outline: 'none', minWidth: 0 }} />
              <span style={{ fontSize: 10, color: text3, background: raised, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{lane.cards.length}</span>
              <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete lane?')) onUpdateBlock(block.id, { lanes: block.lanes.filter(l => l.id !== lane.id) }) }}
                style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
            </div>
            {lane.cards.map(card => (
              <div key={card.id} draggable
                onDragStart={e => { e.stopPropagation(); setCardDrag({ cardId: card.id, fromLaneId: lane.id, blockId: block.id }) }}
                onDragEnd={() => { setCardDrag(null); setCardDragOver(null) }}
                onMouseDown={e => e.stopPropagation()}
                style={{ background: surface, borderRadius: 7, padding: '8px 10px', marginBottom: 6, border: `1px solid ${border}`, borderLeft: `3px solid ${card.color}`, cursor: 'grab', position: 'relative' }}>
                <div style={{ fontSize: 12, color: text, fontFamily: "'DM Sans',sans-serif", lineHeight: 1.4, paddingRight: 16 }}>{card.title}</div>
                {card.tag && <div style={{ fontSize: 10, color: card.color, fontWeight: 700, background: card.color + '22', borderRadius: 3, padding: '1px 6px', display: 'inline-block', marginTop: 4 }}>{card.tag}</div>}
                <button onClick={e => { e.stopPropagation(); deleteCard(lane.id, card.id) }}
                  style={{ position: 'absolute', top: 5, right: 5, background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '1px 3px' }}
                  onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  {CARD_COLORS.map(c => (
                    <div key={c} onClick={e => { e.stopPropagation(); updateCard(lane.id, card.id, { color: c }) }}
                      style={{ width: 10, height: 10, borderRadius: '50%', background: c, cursor: 'pointer', border: card.color === c ? `2px solid ${text}` : '1px solid transparent', flexShrink: 0 }} />
                  ))}
                </div>
                <input value={card.tag} onChange={e => updateCard(lane.id, card.id, { tag: e.target.value })}
                  onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                  placeholder="tag..."
                  style={{ width: '100%', marginTop: 5, background: 'transparent', border: 'none', borderTop: `1px solid ${border}33`, color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 10, outline: 'none', padding: '3px 0', fontStyle: card.tag ? 'normal' : 'italic' }} />
              </div>
            ))}
            {addingCard[lane.id] ? (
              <div style={{ background: surface, borderRadius: 7, padding: '7px 9px', border: `1px solid ${accent}` }}>
                <input autoFocus value={newCardTitle[lane.id] || ''}
                  onChange={e => setNewCardTitle(p => ({ ...p, [lane.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addCard(lane.id); if (e.key === 'Escape') setAddingCard(p => ({ ...p, [lane.id]: false })) }}
                  onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                  placeholder="Card title..."
                  style={{ width: '100%', background: 'transparent', border: 'none', color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, outline: 'none', marginBottom: 6 }} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={e => { e.stopPropagation(); addCard(lane.id) }} style={{ background: accent, border: 'none', borderRadius: 4, color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 11, padding: '3px 10px', cursor: 'pointer' }}>Add</button>
                  <button onClick={e => { e.stopPropagation(); setAddingCard(p => ({ ...p, [lane.id]: false })) }} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 4, color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            ) : (
              <button onClick={e => { e.stopPropagation(); setAddingCard(p => ({ ...p, [lane.id]: true })) }}
                onMouseDown={e => e.stopPropagation()}
                style={{ width: '100%', background: 'none', border: `1px dashed ${border}`, borderRadius: 6, padding: '5px', color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>+ card</button>
            )}
          </div>
        ))}
        <button onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { lanes: [...block.lanes, { id: `lane_${Date.now()}`, name: `Lane ${block.lanes.length + 1}`, cards: [] }] }) }}
          onMouseDown={e => e.stopPropagation()}
          style={{ width: 36, minHeight: 60, background: 'none', border: `1px dashed ${border}`, borderRadius: 8, color: text3, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-start', marginTop: 28 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>+</button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '0 16px', height: 42, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 12, padding: '4px 8px', borderRadius: 5, fontFamily: "'DM Sans',sans-serif" }}
          onMouseEnter={e => e.currentTarget.style.background = raised} onMouseLeave={e => e.currentTarget.style.background = 'none'}>← Back</button>
        <span style={{ color: border, fontSize: 16 }}>|</span>
        <span style={{ fontSize: 13 }}>📓</span>
        {renamingNb ? (
          <input autoFocus value={nbLabel} onChange={e => setNbLabel(e.target.value)}
            onBlur={() => { onRenameNotebook(nbLabel || nb.name); setRenamingNb(false) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
            style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, outline: 'none', minWidth: 120 }} />
        ) : (
          <span onDoubleClick={() => setRenamingNb(true)} style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: text, cursor: 'text' }}>{nb.name}</span>
        )}

        {/* Sheets dropdown */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setSheetsOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 5, border: `1px solid ${sheetsOpen ? accent : border}`, background: sheetsOpen ? accentDim : 'transparent', color: sheetsOpen ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer' }}>
            <span>{activeSheet?.name || 'Sheet 1'}</span><span style={{ fontSize: 9 }}>▾</span>
          </button>
          {sheetsOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: surface, border: `1px solid ${border}`, borderRadius: 9, boxShadow: `0 8px 24px #00000044`, zIndex: 9999, minWidth: 190, overflow: 'hidden' }}>
              {nb.sheets?.map(sheet => (
                <div key={sheet.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: sheet.id === nb.activeSheetId ? accentDim : 'transparent' }}>
                  {renamingSheetId === sheet.id ? (
                    <input autoFocus value={renamingSheetLabel} onChange={e => setRenamingSheetLabel(e.target.value)}
                      onBlur={() => { onRenameSheet(sheet.id, renamingSheetLabel || sheet.name); setRenamingSheetId(null) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                      style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, outline: 'none', padding: '8px 4px' }} />
                  ) : (
                    <button onClick={() => { onSetActiveSheet(sheet.id); setSheetsOpen(false) }}
                      onDoubleClick={() => { setRenamingSheetId(sheet.id); setRenamingSheetLabel(sheet.name) }}
                      style={{ flex: 1, background: 'none', border: 'none', color: sheet.id === nb.activeSheetId ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: '8px 4px', fontWeight: sheet.id === nb.activeSheetId ? 600 : 400 }}>
                      {sheet.id === nb.activeSheetId ? '✓ ' : ''}{sheet.name}
                    </button>
                  )}
                  {nb.sheets.length > 1 && (
                    <button onClick={() => onDeleteSheet(sheet.id)}
                      style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '2px 4px', flexShrink: 0 }}
                      onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
                  )}
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${border}`, padding: '4px 8px' }}>
                <button onClick={() => { onAddSheet(); setSheetsOpen(false) }}
                  style={{ width: '100%', background: 'none', border: 'none', color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: '6px 4px', display: 'flex', alignItems: 'center', gap: 5 }}
                  onMouseEnter={e => e.currentTarget.style.color = accent} onMouseLeave={e => e.currentTarget.style.color = text3}>+ New Sheet</button>
              </div>
            </div>
          )}
        </div>

        <span style={{ fontSize: 11, color: text3 }}>{blocks.length} block{blocks.length !== 1 ? 's' : ''}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {[['text','+ Text'],['table','+ Table'],['kanban','+ Kanban']].map(([type, label]) => (
            <button key={type} onClick={() => onAddBlock(type, Math.max(0, 120 - panRef.current.x + Math.random() * 40), Math.max(0, 80 - panRef.current.y + Math.random() * 30))}
              style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${border}`, background: 'transparent', color: text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text2 }}>{label}</button>
          ))}
          <span style={{ fontSize: 11, color: text3, paddingLeft: 8, borderLeft: `1px solid ${border}` }}>Right-click drag to pan</span>
        </div>
      </div>

      <div ref={containerRef} onClick={handleBgClick} onMouseDown={startPan} onContextMenu={e => e.preventDefault()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          if (!onDropColumn) return
          const rect = containerRef.current.getBoundingClientRect()
          onDropColumn(e.clientX - rect.left - panRef.current.x, e.clientY - rect.top - panRef.current.y)
        }}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', background: dark ? '#141412' : '#EAE7DE', cursor: 'crosshair', userSelect: 'none' }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs>
            <pattern id="nb-dots" x={pan.x % 32} y={pan.y % 32} width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill={dark ? '#3a3835' : '#C0BCB2'} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#nb-dots)" />
        </svg>

        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          {blocks.map(block => (
            <div key={block.id} style={{ position: 'absolute', left: block.x, top: block.y, zIndex: 10 }}>

              {block.type === 'text' && (
                <div style={{ width: block.w || 280, background: surface, border: `1.5px solid ${border}`, borderRadius: 10, boxShadow: `0 4px 20px ${dark ? '#00000055' : '#00000015'}`, overflow: 'hidden' }}>
                  <BlockHandle block={block} label="text" />
                  <div contentEditable suppressContentEditableWarning
                    onBlur={e => onUpdateBlock(block.id, { content: e.currentTarget.innerHTML })}
                    dangerouslySetInnerHTML={{ __html: block.content || '' }}
                    onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                    style={{ minHeight: 80, padding: '10px 12px', fontSize: 13, color: text, lineHeight: 1.7, outline: 'none', fontFamily: "'DM Sans',sans-serif", cursor: 'text', userSelect: 'text' }} />
                </div>
              )}

              {block.type === 'table' && (
                <div draggable
                  onDragStart={e => { e.stopPropagation(); window.__nbTableDrag = block; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'nb_table') }}
                  onDragEnd={() => { window.__nbTableDrag = null }}
                  style={{ background: surface, border: `1.5px solid ${border}`, borderRadius: 10, boxShadow: `0 4px 20px ${dark ? '#00000055' : '#00000015'}`, overflow: 'hidden', minWidth: 220 }}>
                  <BlockHandle block={block} label="table — drag to sidebar file" />
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
                      <thead>
                        <tr>
                          {block.headers.map((h, ci) => (
                            <th key={ci} style={{ padding: 0, borderRight: `1px solid ${border}`, background: accentDim, minWidth: 100 }}>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                <input value={h} onChange={e => { const nh = [...block.headers]; nh[ci] = e.target.value; onUpdateBlock(block.id, { headers: nh }) }}
                                  onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                                  style={{ flex: 1, background: 'transparent', border: 'none', color: accent, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", fontSize: 11, padding: '5px 7px', outline: 'none', minWidth: 0 }} />
                                <button title="→ Send column to canvas" onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSendColToCanvas(block, ci) }}
                                  style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: 12, padding: '2px 6px', flexShrink: 0, opacity: 0.55 }}
                                  onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.55'}>→</button>
                              </div>
                            </th>
                          ))}
                          <th style={{ padding: '4px 6px', background: raised, borderLeft: `1px solid ${border}` }}>
                            <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { headers: [...block.headers, `Col ${block.headers.length + 1}`], rows: block.rows.map(r => [...r, '']) }) }}
                              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>+</button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci} style={{ borderRight: `1px solid ${border}`, borderTop: `1px solid ${border}22`, padding: 0 }}>
                                <input value={cell} data-bid={block.id} data-ri={ri} data-ci={ci}
                                  onChange={e => { const nr = block.rows.map((r, rIdx) => rIdx !== ri ? r : r.map((c, cIdx) => cIdx !== ci ? c : e.target.value)); onUpdateBlock(block.id, { rows: nr }) }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      const nextRi = ri + 1
                                      if (nextRi >= block.rows.length) {
                                        onUpdateBlock(block.id, { rows: [...block.rows, Array(block.headers.length).fill('')] })
                                        setTimeout(() => document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${ci}"]`)?.focus(), 20)
                                      } else { document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${ci}"]`)?.focus() }
                                    }
                                    if (e.key === 'Tab') {
                                      e.preventDefault()
                                      const isLastCol = ci + 1 >= block.headers.length
                                      const nextCi = isLastCol ? 0 : ci + 1
                                      const nextRi = isLastCol ? ri + 1 : ri
                                      if (nextRi >= block.rows.length) {
                                        onUpdateBlock(block.id, { rows: [...block.rows, Array(block.headers.length).fill('')] })
                                        setTimeout(() => document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${nextCi}"]`)?.focus(), 20)
                                      } else { document.querySelector(`[data-bid="${block.id}"][data-ri="${nextRi}"][data-ci="${nextCi}"]`)?.focus() }
                                    }
                                  }}
                                  onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                                  style={{ width: '100%', background: 'transparent', border: 'none', color: text2, fontFamily: "'DM Mono',monospace", fontSize: 11, padding: '5px 7px', outline: 'none', minWidth: 80 }} />
                              </td>
                            ))}
                            <td style={{ borderTop: `1px solid ${border}22`, borderLeft: `1px solid ${border}`, width: 26 }}>
                              <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { rows: block.rows.filter((_, i) => i !== ri) }) }}
                                style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, width: '100%', padding: '5px 3px' }}
                                onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={block.headers.length + 1} style={{ borderTop: `1px solid ${border}22` }}>
                            <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { rows: [...block.rows, Array(block.headers.length).fill('')] }) }}
                              style={{ width: '100%', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '5px', fontFamily: "'DM Sans',sans-serif" }}
                              onMouseEnter={e => e.currentTarget.style.color = accent} onMouseLeave={e => e.currentTarget.style.color = text3}>+ row</button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {block.type === 'kanban' && (
                <div style={{ background: surface, border: `1.5px solid ${border}`, borderRadius: 10, boxShadow: `0 4px 20px ${dark ? '#00000055' : '#00000015'}`, overflow: 'hidden' }}>
                  <BlockHandle block={block} label="kanban" />
                  <KanbanBlock block={block} />
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
              <div style={{ fontSize: 12, lineHeight: 1.9 }}>Or use + Text · + Table · + Kanban above<br />Drag block header to move · Right-click drag to pan<br />Drag a table block onto a sidebar file to export it</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
export default function AppPage() {
  const { dark, setDark } = useTheme()
  const [mode, setMode] = useState('preview')
  const [activeTool, setActiveTool] = useState(null)
 const [toolResult, setToolResult] = useState(null)
const [statCards, setStatCards] = useState([])
  const [editingCell, setEditingCell] = useState(null)
  const [editingCellVal, setEditingCellVal] = useState('')
  const [selectedCell, setSelectedCell] = useState(null)
  const [highlightEmpty, setHighlightEmpty] = useState(false)
  const [duplicateMap, setDuplicateMap] = useState({})
  const [trimOptions, setTrimOptions] = useState({ spaces: true, casing: 'none' })
  const [files, setFiles] = useState([])
  const [expandedFiles, setExpandedFiles] = useState(new Set())
 const [showHidden, setShowHidden] = useState(false)
 const [crosscheckConfig, setCrosscheckConfig] = useState({ colAId: '', colBId: '', threshold: 85 })
  const [crosscheckRunning, setCrosscheckRunning] = useState(false)
  const [showCCWizard, setShowCCWizard] = useState(false)
  const [ccStep, setCCStep] = useState(1)
  const [ccLiveRows, setCCLiveRows] = useState([])
  const [ccResults, setCCResults] = useState(null)
  const [ccActiveTab, setCCActiveTab] = useState('matched')
  const [ccConfirmed, setCCConfirmed] = useState(new Set())
  const [ccRejected, setCCRejected] = useState(new Set())
  const ccWorkerRef = useRef(null)
  const [dragOverFileId, setDragOverFileId] = useState(null)
  const [dragOverSidebarCol, setDragOverSidebarCol] = useState(null)
  const [insertAt, setInsertAt] = useState(null)
  const [draggingCanvasId, setDraggingCanvasId] = useState(null)
  const draggingCanvasIdRef = useRef(null)
  const [editingColId, setEditingColId] = useState(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [selectedSidebarCols, setSelectedSidebarCols] = useState([])
  
  const [activeSheet, setActiveSheet] = useState('canvas')
  const [contextMenu, setContextMenu] = useState(null)
  const [colContextMenu, setColContextMenu] = useState(null)
 const makeCanvas = (id, name) => ({ 
  id, name, columns: [], pinnedColIds: [], hiddenRows: new Set(), zoom: 1 
})
const [canvases, setCanvases] = useState([makeCanvas('canvas_1', 'Canvas 1')])
const [activeCanvasId, setActiveCanvasId] = useState('canvas_1')
const [renamingCanvasId, setRenamingCanvasId] = useState(null)
const [renamingCanvasLabel, setRenamingCanvasLabel] = useState('')
const [folders, setFolders] = useState([])
const [notebooks, setNotebooks] = useState([])
const [activeNotebookId, setActiveNotebookId] = useState(null)
const [renamingFolderId, setRenamingFolderId] = useState(null)
const [renamingFolderLabel, setRenamingFolderLabel] = useState('')
const [folderDragOver, setFolderDragOver] = useState(null)
const [sidebarItemDrag, setSidebarItemDrag] = useState(null)
// These keep every other function working without changes
const activeCanvas = canvases.find(c => c.id === activeCanvasId) || canvases[0]
const canvasColumns = activeCanvas.columns
const pinnedColIds = activeCanvas.pinnedColIds
const hiddenRows = activeCanvas.hiddenRows
const canvasZoom = activeCanvas.zoom

// These replace the old React setters — same names, now canvas-aware
function setCanvasColumns(fn) {
  setCanvases(prev => {
    const canvas = prev.find(c => c.id === activeCanvasId) || prev[0]
    return prev.map(c => c.id === activeCanvasId ? { ...c, columns: typeof fn === 'function' ? fn(canvas.columns) : fn } : c)
  })
}
function setPinnedColIds(fn) {
  setCanvases(prev => {
    const canvas = prev.find(c => c.id === activeCanvasId) || prev[0]
    return prev.map(c => c.id === activeCanvasId ? { ...c, pinnedColIds: typeof fn === 'function' ? fn(canvas.pinnedColIds) : fn } : c)
  })
}
function setHiddenRows(fn) {
  setCanvases(prev => {
    const canvas = prev.find(c => c.id === activeCanvasId) || prev[0]
    return prev.map(c => c.id === activeCanvasId ? { ...c, hiddenRows: typeof fn === 'function' ? fn(canvas.hiddenRows) : fn } : c)
  })
}
function setCanvasZoom(fn) {
  setCanvases(prev => {
    const canvas = prev.find(c => c.id === activeCanvasId) || prev[0]
    return prev.map(c => c.id === activeCanvasId ? { ...c, zoom: typeof fn === 'function' ? fn(canvas.zoom) : fn } : c)
  })
}
  const [copiedRow, setCopiedRow] = useState(null)
 
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false)
  const exportDropdownRef = useRef(null)

  // Format state
  const [globalFormat, setGlobalFormat] = useState(defaultGlobalFormat())
  const [colFormats, setColFormats] = useState({})
  const [formatSelectedCols, setFormatSelectedCols] = useState([])

  // Preview filter/sort/group state
  const [selectedPreviewCol, setSelectedPreviewCol] = useState(null) // { fileId, sheetIdx, colId }
  const [selectedPreviewCols, setSelectedPreviewCols] = useState([]) // array of colIds for multi-select
  const [activePreviewSheet, setActivePreviewSheet] = useState(null) // { fileId, si } — which sheet tab is active
  const [previewAction, setPreviewAction] = useState(null) // { type: 'filter'|'sort'|'group', fileId, sheetIdx, colId }
  const [previewSortMap, setPreviewSortMap] = useState({}) // key -> 'asc'|'desc'
  const [previewFilterMap, setPreviewFilterMap] = useState({}) // key -> Set of hidden values
  const [previewGroupMap, setPreviewGroupMap] = useState({}) // key -> bool

  // Debounced color picker — store draft locally, commit on pointer up
  const [colorDraft, setColorDraft] = useState(null)

 useEffect(() => { window.__nbTableDrag = null }, [])
  const isPanning = useRef(false)
  const canvasScrollRef = useRef(null)
  const dragData = useRef(null)
  const lastInsert = useRef(null)
  const fileInputRef = useRef(null)
  const editInputRef = useRef(null)
  const bottomSentinelRef = useRef(null)
  const [visibleRowCount, setVisibleRowCount] = useState(200)

  const base      = dark ? '#1A1917' : '#F5F3EE'
  const surface   = dark ? '#201F1C' : '#EDEAE3'
  const raised    = dark ? '#262522' : '#E4E1D8'
  const border    = dark ? '#2E2D29' : '#D5D1C7'
  const text      = dark ? '#E8E6E1' : '#1A1917'
  const text2     = dark ? '#9A9790' : '#6B6860'
  const text3     = dark ? '#5A5955' : '#A09D97'
  const accent    = dark ? '#5B5FE8' : '#1D9E75'
  const accentDim = dark ? '#1e2057' : '#d0f0e4'
  const green     = '#4ade80'
  const red       = '#f87171'
  const redDim    = dark ? '#2a0d0d' : '#fee2e2'
  const amber     = '#E8B85B'

  const tools = [
    { id: 'crosscheck', label: 'Crosscheck',      icon: '⚡', desc: 'Fuzzy match names across files' },
    { id: 'duplicates', label: 'Duplicates',      icon: '⊕', desc: 'Find repeated values'           },
    { id: 'gaps',       label: 'Gap Finder',      icon: '◎', desc: 'What is in A but missing from B' },
    { id: 'mapper',     label: 'Col Mapper',      icon: '⇄', desc: 'Visual JOIN by shared key'       },
    { id: 'sort',       label: 'Sort & Filter',   icon: '⇅', desc: 'Sort canvas by any column'       },
    { id: 'merge',      label: 'Merge',           icon: '⬡', desc: 'Combine two columns into one'    },
    { id: 'split',      label: 'Split',           icon: '⋮', desc: 'Split column by delimiter'       },
    { id: 'trim',       label: 'Trim & Clean',    icon: '✦', desc: 'Strip spaces, fix casing'        },
    { id: 'empty',      label: 'Highlight Empty', icon: '□', desc: 'Flag blank/null cells'           },
    { id: 'stats',      label: 'Col Stats',       icon: '▦', desc: 'Count, unique, sum, min, max'    },
    { id: 'format',     label: 'Format',          icon: '◈', desc: 'Style columns for export'        },
  ]

  // ── Format helpers ───────────────────────────────────────────
  function getColFormat(canvasId) {
    return colFormats[canvasId] || defaultColFormat()
  }
  function updateColFormat(canvasIds, patch) {
    setColFormats(prev => {
      const next = { ...prev }
      canvasIds.forEach(id => { next[id] = { ...(next[id] || defaultColFormat()), ...patch } })
      return next
    })
  }
  function updateGlobalFormat(patch) {
    setGlobalFormat(prev => ({ ...prev, ...patch }))
  }
  useEffect(() => {
    if (activeTool === 'format') setFormatSelectedCols(canvasColumns.map(c => c.canvasId))
  }, [activeTool])
  function getFormatValue(key) {
    if (formatSelectedCols.length === 0) return defaultColFormat()[key]
    const vals = formatSelectedCols.map(id => getColFormat(id)[key])
    return vals.every(v => v === vals[0]) ? vals[0] : '—'
  }
  const allSelected = formatSelectedCols.length === canvasColumns.length && canvasColumns.length > 0
  function toggleFormatColSelect(canvasId) {
    setFormatSelectedCols(prev => prev.includes(canvasId) ? prev.filter(id => id !== canvasId) : [...prev, canvasId])
  }
  const hasAnyFormat = Object.keys(colFormats).length > 0 || globalFormat.banding || globalFormat.boldHeader || globalFormat.freezeHeader || globalFormat.borderStyle !== 'thin'

  // ── Close export dropdown ────────────────────────────────────
  useEffect(() => {
    if (!exportDropdownOpen) return
    function handleClick(e) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) setExportDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [exportDropdownOpen])

  // ── Export ───────────────────────────────────────────────────
  function exportCanvasCSV() {
    if (canvasColumns.length === 0) return
    const headers = canvasColumns.map(c => c.label)
    const rows = Array.from({ length: maxRows }).map((_, ri) =>
      canvasColumns.map(col => { const val = col.rows[ri]; return val === undefined || val === null ? '' : String(val) })
    )
    const csv = [headers, ...rows].map(row => row.map(cell => {
      const s = String(cell)
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
    }).join(',')).join('\n')
    downloadFile(csv, 'canvas_export.csv', 'text/csv')
    setExportDropdownOpen(false)
  }

  function exportCanvasXLSX() {
    if (canvasColumns.length === 0) return
    const { freezeHeader, banding, borderStyle, boldHeader, headerColor, exportAsTable } = globalFormat
    const headers = canvasColumns.map(c => c.label)
    const rows = Array.from({ length: maxRows }).map((_, ri) =>
      canvasColumns.map(col => { const val = col.rows[ri]; return val === undefined || val === null ? '' : val })
    )
    const wsData = [headers, ...rows]
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Auto-fit column widths
    ws['!cols'] = canvasColumns.map((col) => {
      const allVals = [col.label, ...col.rows.map(v => v == null ? '' : String(v))]
      const maxLen = Math.max(...allVals.map(v => String(v).length))
      return { wch: Math.min(Math.max(maxLen + 2, 8), 60) }
    })

    // Row heights
    ws['!rows'] = [{ hpt: 22 }, ...Array(maxRows).fill({ hpt: 16 })]

    // Freeze header — correct SheetJS syntax
    if (freezeHeader) {
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', sqref: 'A2' }
    }

    // Helpers
    const toRgb = (hex) => hex.replace('#', '').toUpperCase().padEnd(6, '0')
    const bdrThin = { style: 'thin',   color: { rgb: 'CCCCCC' } }
    const bdrMed  = { style: 'medium', color: { rgb: '888888' } }
    const getBdr  = () => {
      if (borderStyle === 'none') return {}
      const b = borderStyle === 'medium' ? bdrMed : bdrThin
      return { top: b, bottom: b, left: b, right: b }
    }
    const headerRgb = toRgb(headerColor)
    // Banding: use a lightened version of header color (just use F2F2FF as neutral light)
    const bandRgb = 'F0F0FA'

    for (let ri = 0; ri <= maxRows; ri++) {
      for (let ci = 0; ci < canvasColumns.length; ci++) {
        const cellRef = XLSX.utils.encode_cell({ r: ri, c: ci })
        if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' }
        const col = canvasColumns[ci]
        const fmt = getColFormat(col.canvasId)
        const isHeader = ri === 0
        const isBanded = banding && !isHeader && ri % 2 === 0
        ws[cellRef].s = {
          font: {
            name: 'Calibri',
            sz: fmt.fontSize || 12,
            bold: isHeader ? boldHeader : (fmt.bold || false),
            color: { rgb: isHeader ? 'FFFFFF' : '222222' },
          },
          alignment: {
            horizontal: fmt.align || 'left',
            vertical: 'center',
            wrapText: fmt.wrap || false,
          },
          fill: {
            patternType: 'solid',
            fgColor: { rgb: isHeader ? headerRgb : isBanded ? bandRgb : 'FFFFFF' },
          },
          border: getBdr(),
        }
      }
    }

    // Export as Table (autofilter = Excel table-style filtering)
    if (exportAsTable && maxRows > 0) {
      const tableRef = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRows, c: canvasColumns.length - 1 } })
      ws['!autofilter'] = { ref: tableRef }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Canvas')
    XLSX.writeFile(wb, 'canvas_export.xlsx')
    setExportDropdownOpen(false)
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  // ── File import ──────────────────────────────────────────────
  function handleImportClick() { fileInputRef.current.click() }
  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheets = workbook.SheetNames.map(sheetName => {
        const ws = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 })
        const headers = (json[0] || []).map((h, i) => ({ id: `col_${Date.now()}_${i}`, label: h || `Column ${i + 1}`, index: i, hidden: false }))
        return { name: sheetName, headers, rows: json.slice(1) }
      })
      const newFile = { id: `file_${Date.now()}`, name: file.name, sheets }
      setFiles(prev => [...prev, newFile])
      setExpandedFiles(prev => { const next = new Set(prev); next.add(newFile.id); return next })
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // ── Column visibility ────────────────────────────────────────
  function hideColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.map(h => h.id === colId ? { ...h, hidden: true } : h) }) }))
  }
  function deleteColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.filter(h => h.id !== colId) }) }))
    setCanvasColumns(prev => prev.filter(c => c.colId !== colId))
  }
  function restoreColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.map(h => h.id === colId ? { ...h, hidden: false } : h) }) }))
  }

  // ── Sidebar multi-select ─────────────────────────────────────
  function toggleSidebarSelect(e, colId) {
    e.stopPropagation()
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelectedSidebarCols(prev => prev.includes(colId) ? prev.filter(id => id !== colId) : [...prev, colId])
    } else {
      setSelectedSidebarCols(prev => prev.includes(colId) && prev.length === 1 ? [] : [colId])
    }
  }

  // ── Add to canvas ────────────────────────────────────────────
  function addColumnsToCanvas(colInfos, atIndex = null) {
    const newCols = colInfos
      .filter(({ col }) => !canvasColumns.some(c => c.colId === col.id))
      .map(({ fileId, fileName, sheetName, col }) => {
        const file = files.find(f => f.id === fileId)
        const sheet = file?.sheets.find(s => s.name === sheetName)
        return { canvasId: `canvas_${Date.now()}_${Math.random()}`, colId: col.id, label: col.label, fileName, sheetName, rows: sheet?.rows.map(row => row[col.index]) || [] }
      })
    if (!newCols.length) return
    setCanvasColumns(prev => {
      if (atIndex === null) return [...prev, ...newCols]
      const next = [...prev]; next.splice(atIndex, 0, ...newCols); return next
    })
    setMode('canvas'); setSelectedSidebarCols([])
  }

  // ── Drag helpers ─────────────────────────────────────────────
  function setNativeDragImage(e, label) {
    const el = document.createElement('div')
    el.textContent = label
    el.style.cssText = `position:fixed;top:-999px;left:-999px;padding:5px 12px;background:${accent};color:#fff;border-radius:6px;font:600 12px 'DM Sans',sans-serif;white-space:nowrap;`
    document.body.appendChild(el)
    e.dataTransfer.setDragImage(el, 0, 0)
    setTimeout(() => document.body.removeChild(el), 0)
  }
  function handleSidebarDragStart(e, fileId, fileName, sheetName, col) {
    const colsToAdd = selectedSidebarCols.length > 1 && selectedSidebarCols.includes(col.id)
      ? selectedSidebarCols.map(id => { const f = files.find(f => f.id === fileId); const c = f?.sheets[0]?.headers.find(h => h.id === id); return c ? { fileId, fileName, sheetName, col: c } : null }).filter(Boolean)
      : [{ fileId, fileName, sheetName, col }]
    dragData.current = { type: 'sidebar', cols: colsToAdd, sourceFileId: fileId }
    setNativeDragImage(e, colsToAdd.length > 1 ? `${colsToAdd.length} columns` : col.label)
    e.dataTransfer.effectAllowed = 'copy'
  }
  function handleCanvasDragStart(e, canvasId) {
    dragData.current = { type: 'canvas', canvasId }
    draggingCanvasIdRef.current = canvasId; setDraggingCanvasId(canvasId)
    const col = canvasColumns.find(c => c.canvasId === canvasId)
    setNativeDragImage(e, col?.label || ''); e.dataTransfer.effectAllowed = 'move'
  }
  function handleCanvasDragEnd() {
    draggingCanvasIdRef.current = null; setDraggingCanvasId(null)
    setInsertAt(null); lastInsert.current = null; dragData.current = null
  }
  const handleThDragOver = useCallback((e, index) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width * 0.35 ? 'left' : 'right'
    const key = `${index}-${side}`
    if (lastInsert.current === key) return
    lastInsert.current = key; setInsertAt({ index, side })
  }, [])
  function handleThDrop(e, index) {
    e.preventDefault(); e.stopPropagation()
    if (!dragData.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    const dropIndex = side === 'right' ? index + 1 : index
    if (dragData.current.type === 'sidebar') {
      addColumnsToCanvas(dragData.current.cols, dropIndex)
    } else if (dragData.current.type === 'canvas') {
      const fromId = dragData.current.canvasId
      setCanvasColumns(prev => {
        const fromIdx = prev.findIndex(c => c.canvasId === fromId)
        if (fromIdx === -1) return prev
        const next = [...prev]; const [moved] = next.splice(fromIdx, 1)
        next.splice(fromIdx < dropIndex ? dropIndex - 1 : dropIndex, 0, moved); return next
      })
    }
    setInsertAt(null); setDraggingCanvasId(null); lastInsert.current = null; dragData.current = null
  }
  function handleCanvasZoneDragOver(e) { e.preventDefault() }
  function handleCanvasZoneDrop(e) {
    e.preventDefault()
    if (!dragData.current) return
    if (dragData.current.type === 'sidebar') addColumnsToCanvas(dragData.current.cols, null)
    dragData.current = null; setInsertAt(null); lastInsert.current = null
  }
  function handleCanvasDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) { setInsertAt(null); lastInsert.current = null }
  }

  // ── Rename ───────────────────────────────────────────────────
  function startEdit(canvasId, label) { setEditingColId(canvasId); setEditingLabel(label); setTimeout(() => editInputRef.current?.select(), 30) }
  function commitEdit(canvasId) {
    if (editingLabel.trim()) setCanvasColumns(prev => prev.map(c => c.canvasId === canvasId ? { ...c, label: editingLabel.trim() } : c))
    setEditingColId(null)
  }

  // ── Pin ──────────────────────────────────────────────────────
  function togglePin(canvasId) { setPinnedColIds(prev => prev.includes(canvasId) ? prev.filter(id => id !== canvasId) : [...prev, canvasId]) }
  function removeCanvasColumn(canvasId) { setCanvasColumns(prev => prev.filter(c => c.canvasId !== canvasId)); setPinnedColIds(prev => prev.filter(id => id !== canvasId)) }

  // ── Pan ──────────────────────────────────────────────────────
  function handleCanvasMouseDown(e) {
    if (e.button !== 2) return
    if (e.target.closest('button,input')) return
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const startLeft = canvasScrollRef.current?.scrollLeft || 0
    const startTop  = canvasScrollRef.current?.scrollTop  || 0
    function onMove(ev) {
      if (!canvasScrollRef.current) return
      canvasScrollRef.current.scrollLeft = startLeft - (ev.clientX - startX)
      canvasScrollRef.current.scrollTop  = startTop  - (ev.clientY - startY)
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); if (canvasScrollRef.current) canvasScrollRef.current.style.cursor = '' }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
    canvasScrollRef.current.style.cursor = 'grabbing'
  }
  function closeContextMenu() { setContextMenu(null) }

  useEffect(() => {
    const el = canvasScrollRef.current
    if (!el) return
    const handler = (e) => {
      if (e.ctrlKey) { e.preventDefault(); setCanvasZoom(prev => Math.min(2, Math.max(0.4, Math.round((prev + (e.deltaY > 0 ? -0.1 : 0.1)) * 10) / 10))); return }
      if (e.shiftKey) { e.preventDefault(); el.scrollLeft += e.deltaY * 0.8; return }
      el.scrollLeft += e.deltaX; el.scrollTop += e.deltaY * 0.8; e.preventDefault()
    }
  el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [canvasScrollRef.current])
  // ── Tool functions ───────────────────────────────────────────
 function openCCWizard() {
    setShowCCWizard(true)
    setCCStep(1)
    setCCLiveRows([])
    setCCResults(null)
    setCCConfirmed(new Set())
    setCCRejected(new Set())
    setCrosscheckConfig({ colAId: '', colBId: '', threshold: 85 })
    setActiveTool(null)
  }

  function runCrosscheck() {
    const colA = canvasColumns.find(c => c.canvasId === crosscheckConfig.colAId)
    const colB = canvasColumns.find(c => c.canvasId === crosscheckConfig.colBId)
    if (!colA || !colB) return
    setCrosscheckRunning(true)
    setCCStep(3)
    setCCLiveRows([])
    if (!ccWorkerRef.current) ccWorkerRef.current = new Worker('/crosscheck.worker.js')
    ccWorkerRef.current.onmessage = (e) => {
      const { results, summary } = e.data
      const matched = results.map((r, i) => ({ ...r, original: colA.rows[i] })).filter(r => r.decision === 'matched' || r.decision === 'maybe')
      const unmatched = results.map((r, i) => ({ ...r, original: colA.rows[i] })).filter(r => r.decision === 'unmatched')
      setCCResults({ matched, unmatched, summary, colALabel: colA.label, colBLabel: colB.label })
      setCCLiveRows(matched.slice(0, 8))
      setCrosscheckRunning(false)
      setCCStep(4)
    }
    ccWorkerRef.current.postMessage({ rowsA: colA.rows, rowsB: colB.rows, threshold: 95, maybeThreshold: crosscheckConfig.threshold })
  }

  function addCCToCanvas() {
    if (!ccResults) return
    const colA = canvasColumns.find(c => c.canvasId === crosscheckConfig.colAId)
    if (!colA) return
    const allRows = canvasColumns[0]?.rows.length ? Array.from({ length: maxRows }) : []
    const matchMap = {}
    ccResults.matched.forEach(r => {
      if (r.decision === 'matched' || ccConfirmed.has(r.original)) {
        matchMap[String(r.original ?? '')] = { match: r.bestMatch, score: r.score }
      }
    })
    const ts = Date.now()
    const statusRows = colA.rows.map(v => {
      const key = String(v ?? '')
       if (matchMap[key]) return matchMap[key].match
      if (ccRejected.has(key)) return '✕ rejected'
      return ''
    })
    setCanvasColumns(prev => {
      const idx = prev.findIndex(c => c.canvasId === crosscheckConfig.colAId)
      const newCol = { canvasId: `cc_${ts}`, colId: `cc_${ts}`, label: `${ccResults.colALabel} — matched`, fileName: 'Crosscheck', sheetName: '', rows: statusRows }
      const next = [...prev]
      next.splice(idx + 1, 0, newCol)
      return next
    })
  }
  function runTrim() {
    const { spaces, casing } = trimOptions
    setCanvasColumns(prev => prev.map(col => ({ ...col, rows: col.rows.map(val => {
      if (val === undefined || val === null) return val
      let s = String(val)
      if (spaces) s = s.trim().replace(/\s+/g, ' ')
      if (casing === 'lower') s = s.toLowerCase()
      if (casing === 'upper') s = s.toUpperCase()
      if (casing === 'title') s = s.replace(/\b\w/g, c => c.toUpperCase())
      return s
    })})))
    setToolResult({ type: 'trim', message: 'Trim & Clean applied to all columns.' }); setActiveTool(null)
  }
  function runHighlightEmpty() { setHighlightEmpty(h => !h); setActiveTool(null) }
  function runDuplicates() {
    const map = {}
    canvasColumns.forEach(col => {
      const counts = {}
      col.rows.forEach(val => { if (val === undefined || val === null || val === '') return; const k = String(val).trim().toLowerCase(); counts[k] = (counts[k] || 0) + 1 })
      map[col.canvasId] = new Set(Object.keys(counts).filter(k => counts[k] > 1))
    })
    setDuplicateMap(map)
    const total = Object.values(map).reduce((sum, s) => sum + s.size, 0)
    setToolResult({ type: 'duplicates', message: `Found ${total} duplicate value${total !== 1 ? 's' : ''} across ${canvasColumns.length} column${canvasColumns.length !== 1 ? 's' : ''}.` }); setActiveTool(null)
  }
 function runStats() {
  const cards = canvasColumns.map((col, i) => {
    const vals = col.rows.filter(v => v !== undefined && v !== null && v !== '')
    const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n))
    const unique = new Set(vals.map(v => String(v).trim().toLowerCase())).size
    return {
      id: col.canvasId,
      label: col.label,
      total: col.rows.length,
      filled: vals.length,
      empty: col.rows.length - vals.length,
      unique,
      min: nums.length ? Math.min(...nums) : '—',
      max: nums.length ? Math.max(...nums) : '—',
      sum: nums.length ? nums.reduce((a, b) => a + b, 0) : '—',
      x: 80 + i * 28,
      y: 100 + i * 28,
    }
  })
  setStatCards(cards)
  setActiveTool(null)
}

function moveStatCard(id, x, y) {
  setStatCards(prev => prev.map(c => c.id === id ? { ...c, x, y } : c))
}

  // ── Cell editing ─────────────────────────────────────────────
  function startCellEdit(canvasId, rowIndex, currentVal) {
    setSelectedCell({ canvasId, rowIndex })
    setEditingCell({ canvasId, rowIndex })
    setEditingCellVal(currentVal === undefined || currentVal === null ? '' : String(currentVal))
  }

  function commitCellEdit() {
    if (!editingCell) return
    const { canvasId, rowIndex } = editingCell
    setCanvasColumns(prev => prev.map(col => {
      if (col.canvasId !== canvasId) return col
      const newRows = [...col.rows]
      newRows[rowIndex] = editingCellVal
      return { ...col, rows: newRows }
    }))
    setEditingCell(null)
  }

  function commitAndMove(direction) {
    if (!editingCell) return
    const { canvasId, rowIndex } = editingCell
    setCanvasColumns(prev => prev.map(col => {
      if (col.canvasId !== canvasId) return col
      const newRows = [...col.rows]
      newRows[rowIndex] = editingCellVal
      return { ...col, rows: newRows }
    }))
    setEditingCell(null)
    const colIdx = sortedCanvasCols.findIndex(c => c.canvasId === canvasId)
    if (direction === 'down') {
      const nextRow = rowIndex + 1
      if (nextRow < maxRows) {
        const nextVal = sortedCanvasCols[colIdx]?.rows[nextRow]
        setTimeout(() => startCellEdit(canvasId, nextRow, nextVal), 0)
      }
    } else if (direction === 'right') {
      const nextColIdx = colIdx + 1
      if (nextColIdx < sortedCanvasCols.length) {
        const nextCol = sortedCanvasCols[nextColIdx]
        const nextVal = nextCol?.rows[rowIndex]
        setTimeout(() => startCellEdit(nextCol.canvasId, rowIndex, nextVal), 0)
      }
    } else if (direction === 'left') {
      const prevColIdx = colIdx - 1
      if (prevColIdx >= 0) {
        const prevCol = sortedCanvasCols[prevColIdx]
        const prevVal = prevCol?.rows[rowIndex]
        setTimeout(() => startCellEdit(prevCol.canvasId, rowIndex, prevVal), 0)
      }
    } else if (direction === 'up') {
      const prevRow = rowIndex - 1
      if (prevRow >= 0) {
        const prevVal = sortedCanvasCols[colIdx]?.rows[prevRow]
        setTimeout(() => startCellEdit(canvasId, prevRow, prevVal), 0)
      }
    }
  }

  function handleCellKeyDown(e) {
    if (['Enter','Tab','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Enter') { commitAndMove('down') }
    if (e.key === 'Tab') { commitAndMove(e.shiftKey ? 'left' : 'right') }
    if (e.key === 'Escape') { setEditingCell(null) }
    if (e.key === 'ArrowDown' && !e.shiftKey) { commitAndMove('down') }
    if (e.key === 'ArrowUp' && !e.shiftKey) { commitAndMove('up') }
    if (e.key === 'ArrowRight' && !e.shiftKey) { commitAndMove('right') }
    if (e.key === 'ArrowLeft' && !e.shiftKey) { commitAndMove('left') }
  }
  function deleteRow(rowIndex) { setCanvasColumns(prev => prev.map(col => { const newRows = [...col.rows]; newRows.splice(rowIndex, 1); return { ...col, rows: newRows } })); setEditingCell(null) }
  function copyRow(rowIndex) { const snap = {}; canvasColumns.forEach(col => { snap[col.canvasId] = col.rows[rowIndex] }); setCopiedRow(snap) }
  function pasteRow(atIndex, position) {
    if (!copiedRow) return
    const insertIdx = position === 'below' ? atIndex + 1 : atIndex
    setCanvasColumns(prev => prev.map(col => { const val = copiedRow[col.canvasId] ?? ''; const newRows = [...col.rows]; newRows.splice(insertIdx, 0, val); return { ...col, rows: newRows } }))
  }
  function hideRow(rowIndex) { setHiddenRows(prev => new Set([...prev, rowIndex])) }
  function showAllRows() { setHiddenRows(new Set()) }
  function addCanvas() {
  const id = `canvas_${Date.now()}`
  const name = `Canvas ${canvases.length + 1}`
  setCanvases(prev => [...prev, makeCanvas(id, name)])
  setActiveCanvasId(id)
  setActiveSheet(id)
}

function deleteCanvas(id) {
  if (canvases.length === 1) return
  const msg = `Delete "${canvases.find(c => c.id === id)?.name}"? This cannot be undone.`
  if (!window.confirm(msg)) return
  setCanvases(prev => {
    const next = prev.filter(c => c.id !== id)
    if (activeCanvasId === id) {
      setActiveCanvasId(next[0].id)
      setActiveSheet(next[0].id)
    }
    return next
  })
}
function cleanColumn(canvasId) {
  setCanvasColumns(prev => prev.map(col => {
    if (col.canvasId !== canvasId) return col
    return { ...col, rows: col.rows.map(val => {
      if (val === undefined || val === null) return val
      return String(val).trim().replace(/\s+/g, ' ')
    })}
  }))
}

function sortCanvasByCol(canvasId, dir) {
  setCanvasColumns(prev => {
    const col = prev.find(c => c.canvasId === canvasId)
    if (!col) return prev
    const rowCount = Math.max(...prev.map(c => c.rows.length))
    const indices = Array.from({ length: rowCount }, (_, i) => i)
    indices.sort((a, b) => {
      const av = col.rows[a] ?? '', bv = col.rows[b] ?? ''
      const an = parseFloat(av), bn = parseFloat(bv)
      const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv))
      return dir === 'asc' ? cmp : -cmp
    })
    return prev.map(c => ({ ...c, rows: indices.map(i => c.rows[i]) }))
  })
}

function clearColumn(canvasId) {
  setCanvasColumns(prev => prev.map(col =>
    col.canvasId !== canvasId ? col : { ...col, rows: col.rows.map(() => '') }
  ))
}

function duplicateColumn(canvasId) {
  setCanvasColumns(prev => {
    const idx = prev.findIndex(c => c.canvasId === canvasId)
    if (idx === -1) return prev
    const original = prev[idx]
    const copy = { ...original, canvasId: `canvas_${Date.now()}_copy`, label: original.label + ' (copy)', rows: [...original.rows] }
    const next = [...prev]
    next.splice(idx + 1, 0, copy)
    return next
  })
}
function moveColBetweenFiles(sourceFileId, sourceSheetName, sourceColId, targetFileId, targetColId, side) {
    const sourceFile = files.find(f => f.id === sourceFileId)
    const sourceSheet = sourceFile?.sheets.find(s => s.name === sourceSheetName)
    const sourceHeader = sourceSheet?.headers.find(h => h.id === sourceColId)
    if (!sourceHeader || !sourceSheet) return
    const colRows = sourceSheet.rows.map(row => row[sourceHeader.index] ?? '')
    const newColId = `col_${Date.now()}_moved`
    setFiles(prev => prev.map(f => {
      if (f.id === sourceFileId) {
        return { ...f, sheets: f.sheets.map(s => s.name !== sourceSheetName ? s : {
          ...s,
          headers: s.headers.filter(h => h.id !== sourceColId).map((h, i) => ({ ...h, index: i })),
          rows: s.rows.map(row => {
            const newRow = [...row]
            newRow.splice(sourceHeader.index, 1)
            return newRow
          })
        })}
      }
      if (f.id === targetFileId) {
        return { ...f, sheets: f.sheets.map((s, si) => {
          if (si !== 0) return s
          const visible = s.headers.filter(h => !h.hidden)
          let insertIdx = visible.length
          if (targetColId) {
            const targetPos = visible.findIndex(h => h.id === targetColId)
            if (targetPos !== -1) insertIdx = side === 'before' ? targetPos : targetPos + 1
          }
          const newHeader = { id: newColId, label: sourceHeader.label, index: insertIdx, hidden: false }
          const updatedHeaders = [
            ...visible.slice(0, insertIdx),
            newHeader,
            ...visible.slice(insertIdx)
          ].map((h, i) => ({ ...h, index: i }))
          const maxLen = Math.max(s.rows.length, colRows.length)
          const newRows = Array.from({ length: maxLen }, (_, ri) => {
            const row = ri < s.rows.length ? [...s.rows[ri]] : Array(insertIdx).fill('')
            row.splice(insertIdx, 0, colRows[ri] ?? '')
            return row
          })
          return { ...s, headers: updatedHeaders, rows: newRows }
        })}
      }
      return f
    }))
    setDragOverFileId(null)
    setDragOverSidebarCol(null)
    dragData.current = null
  }
function sendCanvasColToFile(canvasId, fileId, insertAtColId, side) {
    const col = canvasColumns.find(c => c.canvasId === canvasId)
    if (!col) return
    const newColId = `col_${Date.now()}_pushed`
    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f
      return {
        ...f, sheets: f.sheets.map((s, si) => {
          if (si !== 0) return s
          const visibleHeaders = s.headers.filter(h => !h.hidden)
          let insertIdx = visibleHeaders.length
          if (insertAtColId) {
            const targetPos = visibleHeaders.findIndex(h => h.id === insertAtColId)
            if (targetPos !== -1) insertIdx = side === 'before' ? targetPos : targetPos + 1
          }
          const newHeader = { id: newColId, label: col.label, index: insertIdx, hidden: false }
          const updatedHeaders = [
            ...visibleHeaders.slice(0, insertIdx),
            newHeader,
            ...visibleHeaders.slice(insertIdx)
          ].map((h, i) => ({ ...h, index: i }))
          const newRows = s.rows.map((row, ri) => {
            const newRow = [...row]
            newRow.splice(insertIdx, 0, col.rows[ri] ?? '')
            return newRow
          })
          if (newRows.length < col.rows.length) {
            for (let i = newRows.length; i < col.rows.length; i++) {
              const emptyRow = Array(updatedHeaders.length).fill('')
              emptyRow[insertIdx] = col.rows[i] ?? ''
              newRows.push(emptyRow)
            }
          }
          return { ...s, headers: updatedHeaders, rows: newRows }
        })
      }
    }))
    setCanvasColumns(prev => prev.filter(c => c.canvasId !== canvasId))
    setPinnedColIds(prev => prev.filter(id => id !== canvasId))
    setDragOverFileId(null)
    setDragOverSidebarCol(null)
    dragData.current = null
  }
  function addBlankColumn() {
    const newCol = { canvasId: `canvas_${Date.now()}_new`, colId: `new_${Date.now()}`, label: 'New Column', fileName: 'manual', sheetName: '', rows: Array(maxRows).fill('') }
    setCanvasColumns(prev => [...prev, newCol])
    setTimeout(() => { setEditingColId(newCol.canvasId); setEditingLabel('New Column') }, 50)
  }

  // ── Folder & Notebook management ─────────────────────────────
  function createFolder() {
    const id = `folder_${Date.now()}`
    setFolders(prev => [...prev, { id, name: 'New Folder', collapsed: false, itemIds: [] }])
    setTimeout(() => { setRenamingFolderId(id); setRenamingFolderLabel('New Folder') }, 30)
  }
  function toggleFolder(folderId) {
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, collapsed: !f.collapsed } : f))
  }
  function commitFolderRename(folderId) {
    if (renamingFolderLabel.trim()) setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: renamingFolderLabel.trim() } : f))
    setRenamingFolderId(null)
  }
  function deleteFolder(folderId) {
    setFolders(prev => prev.filter(f => f.id !== folderId))
  }
  function moveToFolder(itemId, folderId) {
    setFolders(prev => prev.map(f => {
      if (f.id === folderId) return { ...f, itemIds: f.itemIds.includes(itemId) ? f.itemIds : [...f.itemIds, itemId] }
      return { ...f, itemIds: f.itemIds.filter(id => id !== itemId) }
    }))
  }
  function removeFromFolder(itemId, folderId) {
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, itemIds: f.itemIds.filter(id => id !== itemId) } : f))
  }
 function createNotebook() {
    const id = `notebook_${Date.now()}`
    const sheetId = `sheet_${Date.now()}`
    setNotebooks(prev => [...prev, { id, name: 'Untitled Notebook', sheets: [{ id: sheetId, name: 'Sheet 1', blocks: [] }], activeSheetId: sheetId }])
    setActiveNotebookId(id)
  }
  function renameNotebook(nbId, name) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, name }))
  }
  function _getActiveSheetId(n) { return n.activeSheetId || n.sheets?.[0]?.id }
  function addNotebookBlock(nbId, type, x, y, customHeaders, customRows) {
    const id = `block_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const block = type === 'text'
      ? { id, type: 'text', x, y, w: 280, name: '', content: '' }
      : type === 'kanban'
      ? { id, type: 'kanban', x, y, name: '', lanes: [
          { id: `lane_${Date.now()}_1`, name: 'Lane 1', cards: [] },
          { id: `lane_${Date.now()}_2`, name: 'Lane 2', cards: [] },
          { id: `lane_${Date.now()}_3`, name: 'Lane 3', cards: [] },
        ]}
      : { id, type: 'table', x, y, name: '',
          headers: customHeaders || ['Column 1'],
          rows: customRows || Array(8).fill(null).map(() => ['']) }
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, blocks: [...s.blocks, block] } : s) }
    }))
  }
  function updateNotebookBlock(nbId, blockId, patch) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, blocks: s.blocks.map(b => b.id === blockId ? { ...b, ...patch } : b) } : s) }
    }))
  }
  function deleteNotebookBlock(nbId, blockId) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, blocks: s.blocks.filter(b => b.id !== blockId) } : s) }
    }))
  }
  function addNotebookSheet(nbId) {
    const id = `sheet_${Date.now()}`
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, sheets: [...(n.sheets || []), { id, name: `Sheet ${(n.sheets || []).length + 1}`, blocks: [] }], activeSheetId: id }))
  }
  function deleteNotebookSheet(nbId, sheetId) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const newSheets = (n.sheets || []).filter(s => s.id !== sheetId)
      return { ...n, sheets: newSheets, activeSheetId: newSheets[0]?.id || null }
    }))
  }
  function renameNotebookSheet(nbId, sheetId, name) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, sheets: (n.sheets || []).map(s => s.id === sheetId ? { ...s, name } : s) }))
  }
  function setNotebookActiveSheet(nbId, sheetId) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, activeSheetId: sheetId }))
  }
  function deleteNotebook(nbId) {
    setNotebooks(prev => prev.filter(n => n.id !== nbId))
  }
  function makeDragHandle(itemId, itemType, displayName) {
    return (
      <span
        draggable
        onDragStart={e => {
          e.stopPropagation()
          setSidebarItemDrag({ itemId, itemType })
          e.dataTransfer.effectAllowed = 'move'
          const el = document.createElement('div')
          el.textContent = displayName
          el.style.cssText = `position:fixed;top:-999px;padding:4px 10px;background:${accent};color:#fff;border-radius:5px;font:12px 'DM Sans',sans-serif;white-space:nowrap;`
          document.body.appendChild(el)
          e.dataTransfer.setDragImage(el, 0, 0)
          setTimeout(() => document.body.removeChild(el), 0)
        }}
        onDragEnd={() => setSidebarItemDrag(null)}
        onClick={e => e.stopPropagation()}
        title="Drag into a folder"
        style={{ fontSize: 10, color: text3, cursor: 'grab', padding: '0 2px', flexShrink: 0, userSelect: 'none', opacity: 0.45 }}>⠿</span>
    )
  }
  function renderNotebookInSidebar(nb, folderId) {
    return (
      <div key={nb.id} className="nb-row"
        style={{ padding: '5px 8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', background: 'transparent' }}
        onClick={() => setActiveNotebookId(nb.id)}>
        {makeDragHandle(nb.id, 'notebook', nb.name)}
        <span style={{ fontSize: 13, flexShrink: 0 }}>📓</span>
        <span style={{ flex: 1, fontSize: 12, color: text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nb.name}</span>
        <div className="nb-actions" style={{ opacity: 0, display: 'flex', gap: 2 }}>
          {folderId && (
            <button onClick={e => { e.stopPropagation(); removeFromFolder(nb.id, folderId) }}
              title="Remove from folder"
              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 10, padding: '1px 3px', borderRadius: 3 }}
              onMouseEnter={e => e.currentTarget.style.color = accent}
              onMouseLeave={e => e.currentTarget.style.color = text3}>↑</button>
          )}
          <button onClick={e => { e.stopPropagation(); if (window.confirm(`Delete "${nb.name}"?`)) deleteNotebook(nb.id) }}
            style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 10, padding: '1px 3px', borderRadius: 3 }}
            onMouseEnter={e => e.currentTarget.style.color = red}
            onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
        </div>
      </div>
    )
  }
  function renderFileInSidebar(file, folderId) {
    return (
      <div key={file.id} style={{ marginBottom: 6 }}>
        <div className="file-row"
          onClick={() => setExpandedFiles(prev => { const next = new Set(prev); next.has(file.id) ? next.delete(file.id) : next.add(file.id); return next })}
          onDragOver={e => {
            if (window.__nbTableDrag) { e.preventDefault(); setDragOverFileId(file.id); return }
            const d = dragData.current
            if (!d) return
            if (d.type === 'canvas' || (d.type === 'sidebar' && d.sourceFileId !== file.id)) { e.preventDefault(); setDragOverFileId(file.id) }
          }}
          onDragLeave={() => setDragOverFileId(null)}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation()
            if (window.__nbTableDrag) {
              const block = window.__nbTableDrag
              window.__nbTableDrag = null
              setFiles(prev => prev.map(f => {
                if (f.id !== file.id) return f
                return { ...f, sheets: f.sheets.map((s, si) => {
                  if (si !== 0) return s
                  const existingVisible = s.headers.filter(h => !h.hidden)
                  const insertIdx = existingVisible.length
                  const newHeaders = block.headers.map((h, hi) => ({ id: `col_${Date.now()}_nb_${hi}_${Math.random().toString(36).slice(2)}`, label: h, index: insertIdx + hi, hidden: false }))
                  const updatedHeaders = [...existingVisible, ...newHeaders].map((h, i) => ({ ...h, index: i }))
                  const maxLen = Math.max(s.rows.length, block.rows.length)
                  const newRows = Array.from({ length: maxLen }, (_, ri) => {
                    const existing = ri < s.rows.length ? [...s.rows[ri]] : Array(insertIdx).fill('')
                    const newCells = block.headers.map((_, hi) => String(block.rows[ri]?.[hi] ?? ''))
                    return [...existing, ...newCells]
                  })
                  return { ...s, headers: updatedHeaders, rows: newRows }
                })}
              }))
              setDragOverFileId(null)
              setExpandedFiles(prev => { const next = new Set(prev); next.add(file.id); return next })
              return
            }
            const d = dragData.current
            if (!d) return
            if (d.type === 'canvas') {
              sendCanvasColToFile(d.canvasId, file.id, null, null)
            } else if (d.type === 'sidebar' && d.sourceFileId !== file.id) {
              addColumnsToCanvas(d.cols.map(c => ({ ...c, targetFileId: file.id })), null)
              d.cols.forEach(({ fileId: srcId, sheetName, col: c }) => {
                setFiles(prev => prev.map(f => f.id !== srcId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.filter(h => h.id !== c.id) }) }))
              })
              setDragOverFileId(null)
              dragData.current = null
            }
          }}
          style={{ padding: '6px 8px', borderRadius: 6, fontSize: 12, color: text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, background: dragOverFileId === file.id ? accentDim : undefined, border: dragOverFileId === file.id ? `1px solid ${accent}` : '1px solid transparent' }}>
          {makeDragHandle(file.id, 'file', file.name)}
          <span style={{ fontSize: 13 }}>📄</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          {folderId && (
            <button onClick={e => { e.stopPropagation(); removeFromFolder(file.id, folderId) }}
              title="Remove from folder"
              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 9, padding: '1px 3px', borderRadius: 3, opacity: 0 }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0'}>↑</button>
          )}
          <span style={{ color: text3, fontSize: 10, flexShrink: 0 }}>{expandedFiles.has(file.id) ? '▾' : '▸'}</span>
        </div>
        {expandedFiles.has(file.id) && file.sheets[0] && (
          <>
            {selectedSidebarCols.length > 1 && (
              <div style={{ padding: '4px 8px 6px 24px' }}>
                <button onClick={() => { const colInfos = selectedSidebarCols.map(id => { const col = file.sheets[0].headers.find(h => h.id === id); return col ? { fileId: file.id, fileName: file.name, sheetName: file.sheets[0].name, col } : null }).filter(Boolean); addColumnsToCanvas(colInfos, null) }} style={{ background: accentDim, border: `1px solid ${accent}44`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: accent, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>
                  + Add {selectedSidebarCols.length} to canvas
                </button>
              </div>
            )}
            {visibleHeaders(file.sheets[0]).map(col => {
              const onCanvas = canvasColumns.some(c => c.colId === col.id)
              const isSelected = selectedSidebarCols.includes(col.id)
              return (
                <div key={col.id} className="col-row" draggable
                  onDragStart={e => handleSidebarDragStart(e, file.id, file.name, file.sheets[0].name, col)}
                  onClick={e => toggleSidebarSelect(e, col.id)}
                  onDragOver={e => {
                    if (dragData.current?.type !== 'canvas') return
                    e.preventDefault(); e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const side = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                    setDragOverSidebarCol({ colId: col.id, side, fileId: file.id })
                    setDragOverFileId(null)
                  }}
                  onDragLeave={() => setDragOverSidebarCol(null)}
                  onDrop={e => {
                    e.preventDefault(); e.stopPropagation()
                    const d = dragData.current
                    if (!d || d.type !== 'canvas') return
                    sendCanvasColToFile(d.canvasId, file.id, col.id, dragOverSidebarCol?.side || 'after')
                  }}
                  style={{ padding: '4px 8px 4px 24px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 5, opacity: onCanvas ? 0.4 : 1, background: isSelected ? accentDim : 'transparent', borderLeft: isSelected ? `1px solid ${accent}44` : '1px solid transparent', borderRight: isSelected ? `1px solid ${accent}44` : '1px solid transparent', borderTop: dragOverSidebarCol?.colId === col.id && dragOverSidebarCol?.side === 'before' ? `2px solid ${accent}` : isSelected ? `1px solid ${accent}44` : '1px solid transparent', borderBottom: dragOverSidebarCol?.colId === col.id && dragOverSidebarCol?.side === 'after' ? `2px solid ${accent}` : isSelected ? `1px solid ${accent}44` : '1px solid transparent' }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: onCanvas ? text3 : accent, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 11, color: isSelected ? accent : onCanvas ? text3 : text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
                  <span style={{ fontSize: 9, color: text3 }}>{file.sheets[0].rows.length}</span>
                  {onCanvas && <span style={{ fontSize: 9, color: accent, fontWeight: 700 }}>✓</span>}
                  {!onCanvas && (
                    <div className="col-actions">
                      <button style={{ color: text3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 3 }} onClick={e => { e.stopPropagation(); hideColumn(file.id, file.sheets[0].name, col.id) }}>◌</button>
                      <button style={{ color: red, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 3 }} onClick={e => { e.stopPropagation(); deleteColumn(file.id, file.sheets[0].name, col.id) }}>✕</button>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    )
  }

  // ── Helpers ──────────────────────────────────────────────────
  const allHiddenCols = files.flatMap(f => f.sheets.flatMap(s => s.headers.filter(h => h.hidden).map(h => ({ fileId: f.id, fileName: f.name, sheetName: s.name, col: h }))))
  const visibleHeaders = (sheet) => sheet.headers.filter(h => !h.hidden)
  const maxRows = useMemo(() => canvasColumns.length > 0 ? Math.max(...canvasColumns.map(c => c.rows.length)) : 0, [canvasColumns])
  const sortedCanvasCols = useMemo(() => [...canvasColumns.filter(c => pinnedColIds.includes(c.canvasId)), ...canvasColumns.filter(c => !pinnedColIds.includes(c.canvasId))], [canvasColumns, pinnedColIds])

  useEffect(() => { setVisibleRowCount(200) }, [activeCanvasId, canvasColumns.length])

  useEffect(() => {
    const sentinel = bottomSentinelRef.current
    if (!sentinel || maxRows === 0) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleRowCount(prev => Math.min(prev + 200, maxRows)) },
      { root: canvasScrollRef.current, threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [maxRows, activeCanvasId])
    // ── PreviewActionPanel — filter/sort/group dropdown ──────────
  function PreviewActionPanel({ action, sheet, visible, file, si, previewSortMap, setPreviewSortMap, previewFilterMap, setPreviewFilterMap, onClose }) {
    const col = visible.find(c => c.id === action.colId)
    if (!col) return null
    const sortKey = `${file.id}-${si}-sort`
    const fKey = `${file.id}-${si}-${col.id}`
    const currentFilter = previewFilterMap[fKey] || new Set()
    const uniqueVals = [...new Set(sheet.rows.map(row => String(row[col.index] ?? '').trim()))].sort()

    if (action.type === 'sort') return (
      <div style={{ margin: '0 14px 8px', background: raised, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: text }}>Sort by <span style={{ color: accent }}>{col.label}</span></span>
        {[['asc','↑ A → Z'],['desc','↓ Z → A']].map(([dir, lbl]) => (
          <button key={dir} onClick={() => { setPreviewSortMap(prev => ({ ...prev, [sortKey]: { colId: col.id, colIndex: col.index, dir } })); onClose() }}
            style={{ padding: '4px 12px', borderRadius: 5, border: `1px solid ${previewSortMap[sortKey]?.dir === dir ? accent : border}`, background: previewSortMap[sortKey]?.dir === dir ? accentDim : 'transparent', color: previewSortMap[sortKey]?.dir === dir ? accent : text2, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>{lbl}</button>
        ))}
        {previewSortMap[sortKey] && (
          <button onClick={() => { setPreviewSortMap(prev => { const n = { ...prev }; delete n[sortKey]; return n }); onClose() }}
            style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${red}44`, background: 'transparent', color: red, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>✕ Clear sort</button>
        )}
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>
    )

    if (action.type === 'filter') return (
      <div style={{ margin: '0 14px 8px', background: raised, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text }}>Filter <span style={{ color: accent }}>{col.label}</span></span>
          <span style={{ fontSize: 11, color: text3 }}>Uncheck values to hide them</span>
          <button onClick={() => { setPreviewFilterMap(prev => { const n = { ...prev }; delete n[fKey]; return n }) }}
            style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${border}`, background: 'transparent', color: text3, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Clear</button>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 110, overflowY: 'auto' }}>
          {uniqueVals.slice(0, 120).map(val => {
            const hidden = currentFilter.has(val.toLowerCase())
            return (
              <button key={val} onClick={() => setPreviewFilterMap(prev => {
                const cur = new Set(prev[fKey] || [])
                hidden ? cur.delete(val.toLowerCase()) : cur.add(val.toLowerCase())
                return { ...prev, [fKey]: cur }
              })} style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${hidden ? red + '44' : border}`, background: hidden ? `${red}11` : 'transparent', color: hidden ? red : text2, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textDecoration: hidden ? 'line-through' : 'none' }}>
                {val || '(empty)'}
              </button>
            )
          })}
          {uniqueVals.length > 120 && <span style={{ fontSize: 11, color: text3, alignSelf: 'center' }}>+{uniqueVals.length - 120} more</span>}
        </div>
      </div>
    )

    if (action.type === 'group') {
      const counts = {}
      sheet.rows.forEach(row => { const v = String(row[col.index] ?? '').trim() || '(empty)'; counts[v] = (counts[v] || 0) + 1 })
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
      return (
        <div style={{ margin: '0 14px 8px', background: raised, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: text }}>Group by <span style={{ color: accent }}>{col.label}</span></span>
            <span style={{ fontSize: 11, color: text3 }}>{sorted.length} unique values</span>
            <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 100, overflowY: 'auto' }}>
            {sorted.slice(0, 60).map(([val, count]) => (
              <div key={val} style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${border}`, background: surface, fontSize: 11, color: text2, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>{val}</span>
                <span style={{ background: accent + '22', color: accent, borderRadius: 3, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  // ── Small reusable toggle button for Format bar ──────────────
  function StatCard({ card }) {
  function handleMouseDown(e) {
    if (e.target.closest('button')) return
    e.preventDefault()
    const startX = e.clientX - card.x
    const startY = e.clientY - card.y
    function onMove(ev) { moveStatCard(card.id, ev.clientX - startX, ev.clientY - startY) }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const rows = [
    { label: 'Total',  value: card.total,  color: text2 },
    { label: 'Filled', value: card.filled, color: green },
    { label: 'Empty',  value: card.empty,  color: card.empty > 0 ? red : text3 },
    { label: 'Unique', value: card.unique, color: text2 },
    { label: 'Min',    value: typeof card.min === 'number' ? card.min.toLocaleString() : card.min, color: text2 },
    { label: 'Max',    value: typeof card.max === 'number' ? card.max.toLocaleString() : card.max, color: text2 },
    { label: 'Sum',    value: typeof card.sum === 'number' ? card.sum.toLocaleString() : card.sum, color: accent },
  ]
  const fillPct = card.total > 0 ? Math.round((card.filled / card.total) * 100) : 0
  return (
    <div onMouseDown={handleMouseDown} style={{ position: 'fixed', top: card.y, left: card.x, zIndex: 8000, width: 210, background: surface, border: `1px solid ${border}`, borderRadius: 10, boxShadow: `0 8px 32px #00000055`, fontFamily: "'DM Sans',sans-serif", cursor: 'grab', userSelect: 'none' }}>
      {/* Header */}
      <div style={{ padding: '9px 12px 8px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 7, background: accentDim, borderRadius: '10px 10px 0 0' }}>
        <span style={{ fontSize: 13, color: accent }}>▦</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.label}</span>
        <button onClick={() => setStatCards(prev => prev.filter(c => c.id !== card.id))} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
      </div>
      {/* Fill bar */}
      <div style={{ padding: '8px 12px 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: text3, marginBottom: 4 }}>
          <span>Fill rate</span><span style={{ color: fillPct === 100 ? green : fillPct < 50 ? red : amber }}>{fillPct}%</span>
        </div>
        <div style={{ height: 4, borderRadius: 3, background: raised, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${fillPct}%`, background: fillPct === 100 ? green : fillPct < 50 ? red : amber, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      </div>
      {/* Stats rows */}
      <div style={{ padding: '4px 0 8px' }}>
        {rows.map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 12px' }}>
            <span style={{ fontSize: 11, color: text3 }}>{label}</span>
            <span style={{ fontSize: 11, color, fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
  function FmtBtn({ active, onClick, title, children }) {
    return (
      <button onClick={onClick} title={title} style={{ padding: '3px 9px', borderRadius: 5, border: `1px solid ${active ? accent : border}`, background: active ? accentDim : 'transparent', color: active ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
        {children}
      </button>
    )
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${border}; border-radius: 4px; }
        .tool-btn { transition: background 0.15s, color 0.15s, border-color 0.15s; }
        .tool-btn:hover { background: ${raised} !important; color: ${text} !important; }
        .tool-btn.active { background: ${accentDim} !important; color: ${accent} !important; border-color: ${accent} !important; }
        .import-btn:hover { opacity: 0.88; }
        .file-row:hover { background: ${raised} !important; }
        .col-row { transition: background 0.1s; cursor: grab; user-select: none; }
        .col-row:hover { background: ${raised} !important; }
        .col-row:hover .col-actions { opacity: 1 !important; }
        .col-row:active { cursor: grabbing; }
        .col-actions { opacity: 0; transition: opacity 0.15s; display: flex; gap: 3px; }
        .tab-btn { transition: background 0.15s, color 0.15s; }
        .canvas-row:hover td { background: ${raised}66 !important; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .fadein { animation: fadeUp 0.4s ease both; }
        .canvas-th { cursor: grab; position: relative; transition: opacity 0.1s; }
        .canvas-th:active { cursor: grabbing; }
        .canvas-th:hover .th-pin { opacity: 1 !important; }
        .col-label-click { cursor: text; border-radius: 3px; padding: 1px 3px; transition: background 0.1s; }
        .col-label-click:hover { background: ${raised}; }
        .export-item:hover { background: ${raised} !important; }
        .fmt-chip:hover { border-color: ${accent} !important; color: ${accent} !important; }
        .folder-row:hover { background: ${raised} !important; }
        .folder-row:hover .folder-actions { opacity: 1 !important; }
        .nb-row:hover { background: ${raised} !important; }
        .nb-row:hover .nb-actions { opacity: 1 !important; }
        .kanban-card:hover .card-del { opacity: 1 !important; }
      `}</style>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Context menu */}
      {contextMenu && (
        <div style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: `0 8px 24px #00000044`, zIndex: 9999, minWidth: 160, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>
          <div style={{ padding: '4px 0' }}>
            {[
              { label: 'Delete row',  icon: '✕', color: red,   action: () => { deleteRow(contextMenu.rowIndex); closeContextMenu() } },
              { label: 'Hide row',    icon: '◌', color: text2, action: () => { hideRow(contextMenu.rowIndex); closeContextMenu() } },
              { label: 'Copy row',    icon: '⊞', color: text2, action: () => { copyRow(contextMenu.rowIndex); closeContextMenu() } },
              ...(copiedRow ? [
                { label: 'Paste above', icon: '↑', color: accent, action: () => { pasteRow(contextMenu.rowIndex, 'above'); closeContextMenu() } },
                { label: 'Paste below', icon: '↓', color: accent, action: () => { pasteRow(contextMenu.rowIndex, 'below'); closeContextMenu() } },
              ] : []),
            ].map((item, i) => (
              <button key={i} onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: item.color, fontSize: 13, fontFamily: "'DM Sans',sans-serif", cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = raised}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <span style={{ fontSize: 12, width: 14, textAlign: 'center' }}>{item.icon}</span>{item.label}
              </button>
            ))}
          </div>
        </div>
      )}
{colContextMenu && (
  <div style={{ position: 'fixed', top: colContextMenu.y, left: colContextMenu.x, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: `0 8px 24px #00000044`, zIndex: 9999, minWidth: 180, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}
    onMouseLeave={() => setColContextMenu(null)}>
    <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: text3 }}>{colContextMenu.label}</div>
    <div style={{ padding: '4px 0 4px' }}>
      {[
        { label: 'Sort A → Z',     icon: '↑', color: text2,  action: () => { sortCanvasByCol(colContextMenu.canvasId, 'asc');  setColContextMenu(null) } },
        { label: 'Sort Z → A',     icon: '↓', color: text2,  action: () => { sortCanvasByCol(colContextMenu.canvasId, 'desc'); setColContextMenu(null) } },
        { label: 'Clean column',   icon: '✦', color: accent, action: () => { cleanColumn(colContextMenu.canvasId);             setColContextMenu(null) } },
        { label: 'Duplicate',      icon: '⊞', color: text2,  action: () => { duplicateColumn(colContextMenu.canvasId);         setColContextMenu(null) } },
        { label: 'Clear values',   icon: '□', color: amber,  action: () => { clearColumn(colContextMenu.canvasId);             setColContextMenu(null) } },
      ].map((item, i) => (
        <button key={i} onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: item.color, fontSize: 13, fontFamily: "'DM Sans',sans-serif", cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={e => e.currentTarget.style.background = raised}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}>
          <span style={{ fontSize: 12, width: 14, textAlign: 'center' }}>{item.icon}</span>{item.label}
        </button>
      ))}
    </div>
  </div>
)}
      <div
        style={{ display: 'flex', flex: 1, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}
       onMouseDown={e => { if (contextMenu) setContextMenu(null); if (colContextMenu) setColContextMenu(null); if (editingCell && !e.target.closest('td input')) commitCellEdit(); if (!e.target.closest('td')) setSelectedCell(null) }}
        onDragOver={e => { if (dragData.current) e.preventDefault() }}
        onDrop={e => { e.preventDefault(); if (!dragData.current) return; if (dragData.current.type === 'sidebar') addColumnsToCanvas(dragData.current.cols, null); setInsertAt(null); lastInsert.current = null }}
      >

       {/* ── Sidebar ── */}
        <div style={{ width: 220, background: surface, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 12px 6px' }}>
            <button className="import-btn" onClick={handleImportClick} style={{ width: '100%', padding: '9px 0', background: accent, color: '#fff', border: 'none', borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ fontSize: 15 }}>+</span> Import File
            </button>
            <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
              <button onClick={createFolder}
                style={{ flex: 1, padding: '5px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                📁 Folder
              </button>
              <button onClick={createNotebook}
                style={{ flex: 1, padding: '5px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                📓 Notebook
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>

            {/* Folders */}
            {folders.map(folder => {
              const folderFiles = files.filter(f => folder.itemIds.includes(f.id))
              const folderNotebooks = notebooks.filter(n => folder.itemIds.includes(n.id))
              const isDragOver = folderDragOver === folder.id
              return (
                <div key={folder.id} style={{ marginBottom: 2 }}>
                  <div className="folder-row"
                    onDragOver={e => { if (sidebarItemDrag) { e.preventDefault(); setFolderDragOver(folder.id) } }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFolderDragOver(null) }}
                    onDrop={e => { e.preventDefault(); if (sidebarItemDrag) { moveToFolder(sidebarItemDrag.itemId, folder.id); setSidebarItemDrag(null); setFolderDragOver(null) } }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 6px', borderRadius: 6, border: isDragOver ? `1px solid ${accent}` : '1px solid transparent', background: isDragOver ? accentDim : 'transparent' }}>
                    <span onClick={() => toggleFolder(folder.id)} style={{ fontSize: 9, color: text3, cursor: 'pointer', flexShrink: 0, width: 10 }}>{folder.collapsed ? '▸' : '▾'}</span>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>📁</span>
                    {renamingFolderId === folder.id ? (
                      <input autoFocus value={renamingFolderLabel}
                        onChange={e => setRenamingFolderLabel(e.target.value)}
                        onBlur={() => commitFolderRename(folder.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, outline: 'none', minWidth: 0 }} />
                    ) : (
                      <span onClick={() => toggleFolder(folder.id)} style={{ flex: 1, fontSize: 12, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{folder.name}</span>
                    )}
                    <div className="folder-actions" style={{ opacity: 0, display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button onClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenamingFolderLabel(folder.name) }}
                        style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '1px 3px', borderRadius: 3, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = accent}
                        onMouseLeave={e => e.currentTarget.style.color = text3}>✎</button>
                      <button onClick={e => { e.stopPropagation(); deleteFolder(folder.id) }}
                        style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '1px 3px', borderRadius: 3, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = red}
                        onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
                    </div>
                  </div>
                  {!folder.collapsed && (
                    <div style={{ paddingLeft: 10 }}>
                      {folderFiles.map(file => renderFileInSidebar(file, folder.id))}
                      {folderNotebooks.map(nb => renderNotebookInSidebar(nb, folder.id))}
                      {folderFiles.length === 0 && folderNotebooks.length === 0 && (
                        <div style={{ padding: '5px 8px 6px', fontSize: 10, color: text3, fontStyle: 'italic' }}>Drag files or notebooks here</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Uncategorized files */}
            {files.filter(f => !folders.some(folder => folder.itemIds.includes(f.id))).map(file => renderFileInSidebar(file, null))}

            {/* Uncategorized notebooks */}
            {notebooks.filter(n => !folders.some(folder => folder.itemIds.includes(n.id))).map(nb => renderNotebookInSidebar(nb, null))}

            {/* Empty state */}
            {files.length === 0 && notebooks.length === 0 && folders.length === 0 && (
              <div style={{ margin: '16px 6px', padding: '14px 12px', borderRadius: 8, border: `1px dashed ${border}`, textAlign: 'center', color: text3, fontSize: 12, lineHeight: 1.7 }}>
                No files yet.<br /><span style={{ color: text2 }}>Supports .xlsx .xls .csv</span>
              </div>
            )}
          </div>

          {allHiddenCols.length > 0 && (
            <div style={{ borderTop: `1px solid ${border}`, padding: '8px 10px' }}>
              <button onClick={() => setShowHidden(!showHidden)} style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: text3 }}>
                <span style={{ fontSize: 10 }}>{showHidden ? '▾' : '▸'}</span> Hidden ({allHiddenCols.length})
              </button>
              {showHidden && allHiddenCols.map(({ fileId, sheetName, col }) => (
                <div key={col.id} style={{ padding: '4px 4px 4px 16px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: border, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 11, color: text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{col.label}</span>
                  <button onClick={() => restoreColumn(fileId, sheetName, col.id)} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 4, cursor: 'pointer', color: accent, fontSize: 11, padding: '2px 6px', fontFamily: "'DM Sans',sans-serif" }}>↩</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ padding: '8px 12px 12px', borderTop: `1px solid ${border}` }}>
            <button onClick={() => setDark(!dark)} style={{ background: 'none', border: 'none', padding: '4px 2px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {dark ? '☀️' : '🌙'} {dark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </div>
        {/* ── Main ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tabs bar */}
          {activeNotebookId && notebooks.find(n => n.id === activeNotebookId) && (
            <NotebookCanvas
              nb={notebooks.find(n => n.id === activeNotebookId)}
              dark={dark}
              colors={{ surface, raised, border, text, text2, text3, accent, accentDim, red, base, green, amber }}
              onBack={() => setActiveNotebookId(null)}
              onAddBlock={(type, x, y) => addNotebookBlock(activeNotebookId, type, x, y)}
              onUpdateBlock={(blockId, patch) => updateNotebookBlock(activeNotebookId, blockId, patch)}
              onDeleteBlock={(blockId) => deleteNotebookBlock(activeNotebookId, blockId)}
              onRenameNotebook={(name) => renameNotebook(activeNotebookId, name)}
               onSendColToCanvas={(block, colIdx) => {
                const label = block.headers[colIdx]
                const rows = block.rows.map(r => r[colIdx] ?? '')
                const ts = Date.now()
                const nb = notebooks.find(n => n.id === activeNotebookId)
                const newCol = { canvasId: `nb_col_${ts}_${colIdx}`, colId: `nb_col_${ts}_${colIdx}`, label, fileName: nb?.name || 'Notebook', sheetName: '', rows }
                setCanvasColumns(prev => [...prev, newCol])
                setToolResult({ type: 'trim', message: `Column "${label}" added to canvas from notebook.` })
              }}
              onDropColumn={(x, y) => {
                const d = dragData.current
                if (!d || d.type !== 'sidebar') return
                const cols = d.cols
                const headers = cols.map(c => c.col.label)
                const maxLen = Math.max(...cols.map(c => { const f = files.find(f => f.id === c.fileId); const s = f?.sheets.find(sh => sh.name === c.sheetName); return s?.rows.length || 0 }))
                const rows = Array.from({ length: maxLen }, (_, ri) => cols.map(c => { const f = files.find(f => f.id === c.fileId); const s = f?.sheets.find(sh => sh.name === c.sheetName); return String(s?.rows[ri]?.[c.col.index] ?? '') }))
                addNotebookBlock(activeNotebookId, 'table', Math.max(0, x - 160), Math.max(0, y - 20), headers, rows)
                dragData.current = null
              }}
              onAddSheet={() => addNotebookSheet(activeNotebookId)}
              onDeleteSheet={(sheetId) => deleteNotebookSheet(activeNotebookId, sheetId)}
              onRenameSheet={(sheetId, name) => renameNotebookSheet(activeNotebookId, sheetId, name)}
              onSetActiveSheet={(sheetId) => setNotebookActiveSheet(activeNotebookId, sheetId)}
            />
          )}
          {!activeNotebookId && <>
          {/* Tabs bar */}
          <div style={{ background: surface, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 4, height: 42, flexShrink: 0 }}>
            {[{ id: 'preview', label: 'Preview' }, { id: 'canvas', label: `Canvas${canvasColumns.length > 0 ? ` (${canvasColumns.length})` : ''}` }].map(m => (
              <button key={m.id} className="tab-btn" onClick={() => setMode(m.id)} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: mode === m.id ? accentDim : 'transparent', color: mode === m.id ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: mode === m.id ? 600 : 400, cursor: 'pointer' }}>{m.label}</button>
            ))}
            <span style={{ marginLeft: 8, fontSize: 12, color: text3 }}>{mode === 'preview' ? 'View & edit raw file data' : 'Build your custom sheet'}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* Export dropdown */}
              {(canvasColumns.length > 0 || files.length > 0) && (
                <div ref={exportDropdownRef} style={{ position: 'relative' }}>
                  <button onClick={() => setExportDropdownOpen(o => !o)} style={{ background: exportDropdownOpen ? accentDim : 'none', border: `1px solid ${exportDropdownOpen ? accent : border}`, borderRadius: 6, padding: '4px 11px', fontSize: 12, color: exportDropdownOpen ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 13 }}>↓</span> Export <span style={{ fontSize: 9, marginLeft: 1 }}>▾</span>
                  </button>
                  {exportDropdownOpen && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: surface, border: `1px solid ${border}`, borderRadius: 9, boxShadow: `0 8px 28px #00000055`, zIndex: 9999, minWidth: 250, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>
                      <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: text3 }}>Canvas</div>
                      {[
                        { label: 'Export as CSV',  icon: '📄', sub: 'Comma-separated values',     action: exportCanvasCSV  },
                        { label: 'Export as XLSX', icon: '📊', sub: 'Excel workbook with styles', action: exportCanvasXLSX },
                      ].map((item, i) => (
                        <button key={i} className="export-item" onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                          <span style={{ fontSize: 16 }}>{item.icon}</span>
                          <div>
                            <div style={{ fontSize: 13, color: text, fontWeight: 500 }}>{item.label}</div>
                            <div style={{ fontSize: 11, color: text3 }}>{item.sub}</div>
                          </div>
                        </button>
                      ))}
                      <div style={{ padding: '6px 14px 10px', fontSize: 11, color: text3, borderTop: `1px solid ${border}`, marginTop: 4 }}>
                        Tip: use ◈ Format to style before export
                      </div>
                    </div>
                  )}
                </div>
              )}
              {mode === 'canvas' && canvasColumns.length > 0 && (
                <>
                  <button onClick={addBlankColumn} style={{ background: accentDim, border: `1px solid ${accent}44`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: accent, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>+ Column</button>
                  <button onClick={() => { setCanvasColumns([]); setPinnedColIds([]) }} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Clear</button>
                </>
              )}
            </div>
          </div>

          {/* ── PREVIEW ── */}
          {mode === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Action bar */}
              <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '5px 12px', display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: text3, marginRight: 4 }}>
                  {selectedPreviewCols.length > 0
                    ? <span style={{ color: accent }}>✓ {selectedPreviewCols.length} column{selectedPreviewCols.length > 1 ? 's' : ''} selected</span>
                    : 'Click a column header to select it, then:'}
                </span>
                {['Filter', 'Sort', 'Group'].map(a => {
                  const isActive = previewAction?.type === a.toLowerCase() && previewAction?.colId === selectedPreviewCol?.colId
                  return (
                    <button key={a}
                      className="tool-btn"
                      disabled={!selectedPreviewCol}
                      onClick={() => {
                        if (!selectedPreviewCol) return
                        setPreviewAction(isActive ? null : { type: a.toLowerCase(), ...selectedPreviewCol })
                      }}
                      style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${isActive ? accent : border}`, background: isActive ? accentDim : 'transparent', color: selectedPreviewCol ? (isActive ? accent : text2) : text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: selectedPreviewCol ? 'pointer' : 'default', opacity: selectedPreviewCol ? 1 : 0.5 }}
                    >{a}</button>
                  )
                })}
                {(selectedPreviewCols.length > 0 || previewAction || Object.keys(previewSortMap).length > 0 || Object.keys(previewFilterMap).length > 0) && (
                  <button onClick={() => { setSelectedPreviewCol(null); setSelectedPreviewCols([]); setPreviewAction(null); setPreviewSortMap({}); setPreviewFilterMap({}); setPreviewGroupMap({}) }}
                    style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '3px 9px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                    ↺ Clear all
                  </button>
                )}
              </div>

              {/* Scrollable table area */}
              <div
                style={{ flex: 1, overflow: 'auto' }}
                onClick={e => {
                  // Click on non-header area clears selection
                  if (!e.target.closest('th') && !e.ctrlKey && !e.metaKey) {
                    setSelectedPreviewCol(null)
                    setSelectedPreviewCols([])
                  }
                }}
              >
                {files.length === 0 ? (
                  <div className="fadein" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: text3, fontSize: 13 }}>Import a file to preview it here.</div>
                ) : files.map(file => file.sheets.map((sheet, si) => {
                  const sheetKey = `${file.id}-${si}`
                  // Only show the active sheet tab (default to first)
                  const activeKey = activePreviewSheet ? `${activePreviewSheet.fileId}-${activePreviewSheet.si}` : `${files[0]?.id}-0`
                  if (sheetKey !== activeKey) return null

                  const visible = visibleHeaders(sheet)
                  let displayRows = sheet.rows.slice(0, 500)

                  const sortKey = `${file.id}-${si}-sort`
                  const sortState = previewSortMap[sortKey]
                  if (sortState) {
                    const { colIndex, dir } = sortState
                    displayRows = [...displayRows].sort((a, b) => {
                      const av = a[colIndex] ?? '', bv = b[colIndex] ?? ''
                      const an = parseFloat(av), bn = parseFloat(bv)
                      const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv))
                      return dir === 'asc' ? cmp : -cmp
                    })
                  }
                  visible.forEach(col => {
                    const fKey = `${file.id}-${si}-${col.id}`
                    const hidden = previewFilterMap[fKey]
                    if (hidden && hidden.size > 0) {
                      displayRows = displayRows.filter(row => !hidden.has(String(row[col.index] ?? '').trim().toLowerCase()))
                    }
                  })

                  const activeDropdown = previewAction && previewAction.fileId === file.id && previewAction.sheetIdx === si ? previewAction : null

                  return (
                    <div key={sheetKey} className="fadein">
                      {activeDropdown && (
                        <PreviewActionPanel
                          action={activeDropdown}
                          sheet={sheet}
                          visible={visible}
                          file={file}
                          si={si}
                          previewSortMap={previewSortMap}
                          setPreviewSortMap={setPreviewSortMap}
                          previewFilterMap={previewFilterMap}
                          setPreviewFilterMap={setPreviewFilterMap}
                          onClose={() => setPreviewAction(null)}
                          surface={surface} raised={raised} border={border}
                          text={text} text2={text2} text3={text3} accent={accent} accentDim={accentDim}
                          red={red}
                        />
                      )}

                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
                        <thead>
                          <tr style={{ background: surface, position: 'sticky', top: 0, zIndex: 5 }}>
                            <th style={{ width: 36, padding: '7px 10px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, color: text3, fontSize: 10, textAlign: 'center', fontWeight: 500, background: surface }}>#</th>
                            {visible.map(col => {
                              const isSelCol = selectedPreviewCols.includes(col.id)
                              const sortKey2 = `${file.id}-${si}-sort`
                              const isSorted = previewSortMap[sortKey2]?.colId === col.id
                              const isFiltered = previewFilterMap[`${file.id}-${si}-${col.id}`]?.size > 0
                              return (
                                <th key={col.id}
                                  onClick={e => {
                                    e.stopPropagation()
                                    if (e.ctrlKey || e.metaKey) {
                                      // Ctrl+click: toggle this column in multi-select
                                      setSelectedPreviewCols(prev =>
                                        prev.includes(col.id) ? prev.filter(id => id !== col.id) : [...prev, col.id]
                                      )
                                      // Keep selectedPreviewCol as the last clicked for actions
                                      setSelectedPreviewCol({ fileId: file.id, sheetIdx: si, colId: col.id, colIndex: col.index })
                                    } else {
                                      // Normal click: select only this one
                                      setSelectedPreviewCols(isSelCol && selectedPreviewCols.length === 1 ? [] : [col.id])
                                      setSelectedPreviewCol(isSelCol && selectedPreviewCols.length === 1 ? null : { fileId: file.id, sheetIdx: si, colId: col.id, colIndex: col.index })
                                    }
                                  }}
                                  style={{ padding: '7px 12px', borderBottom: `1px solid ${isSelCol ? accent : border}`, borderRight: `1px solid ${border}`, color: isSelCol ? accent : text, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: 12, background: isSelCol ? accentDim : surface, cursor: 'pointer', userSelect: 'none', position: 'relative' }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span>{col.label}</span>
                                    {isSorted && <span style={{ fontSize: 10, color: accent }}>{previewSortMap[sortKey2]?.dir === 'asc' ? '↑' : '↓'}</span>}
                                    {isFiltered && <span style={{ fontSize: 10, color: amber }}>▼</span>}
                                    <div style={{ display: 'flex', gap: 3, opacity: 0, marginLeft: 'auto' }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0} onClick={e => e.stopPropagation()}>
                                      <button style={{ color: text3, background: raised, border: `1px solid ${border}`, borderRadius: 3, fontSize: 10, padding: '1px 5px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }} onClick={() => hideColumn(file.id, sheet.name, col.id)}>Hide</button>
                                      <button style={{ color: red, background: redDim, border: `1px solid ${red}44`, borderRadius: 3, fontSize: 10, padding: '1px 5px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }} onClick={() => deleteColumn(file.id, sheet.name, col.id)}>Del</button>
                                    </div>
                                  </div>
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.map((row, ri) => (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : `${surface}55` }}>
                              <td style={{ padding: '5px 10px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 10 }}>{ri + 1}</td>
                              {visible.map(col => {
                                const val = row[col.index]
                                const isEmpty = val === undefined || val === null || val === ''
                                const isSelCol = selectedPreviewCols.includes(col.id)
                                return (
                                  <td key={col.id} style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: isEmpty ? text3 : text2, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', background: isSelCol ? `${accentDim}55` : 'transparent' }}>
                                    {isEmpty ? <span style={{ fontSize: 10 }}>—</span> : String(val)}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {sheet.rows.length > 500 && <div style={{ padding: '8px 14px', fontSize: 11, color: text3 }}>Showing 500 of {sheet.rows.length} rows</div>}
                    </div>
                  )
                }))}
              </div>

              {/* Preview sheet tabs — bottom bar */}
              <div style={{ borderTop: `1px solid ${border}`, background: surface, display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto' }}>
                  {files.flatMap(file =>
                    file.sheets.map((sheet, si) => {
                      const key = `${file.id}-${si}`
                      const activeKey = activePreviewSheet ? `${activePreviewSheet.fileId}-${activePreviewSheet.si}` : `${files[0]?.id}-0`
                      const isActive = key === activeKey
                      return (
                        <button key={key}
                          onClick={() => { setActivePreviewSheet({ fileId: file.id, si }); setSelectedPreviewCol(null); setSelectedPreviewCols([]); setPreviewAction(null) }}
                          style={{ padding: '6px 16px', border: 'none', borderRight: `1px solid ${border}`, borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`, background: isActive ? base : surface, color: isActive ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: text3, fontSize: 10 }}>📄</span>
                          {file.sheets.length > 1 ? `${file.name} — ${sheet.name}` : file.name}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── CANVAS ── */}
          {mode === 'canvas' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

              {/* ══ TOOLBAR or FORMAT BAR ══ */}
              {activeTool === 'format' ? (
                <div style={{ background: dark ? '#15152a' : '#f4f0ff', borderBottom: `1px solid ${accent}44`, padding: '8px 14px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Row 1: title + column chips */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: accent, display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>◈ Format</span>
                    <span style={{ fontSize: 11, color: text3 }}>Apply to:</span>
                    {/* All chip */}
                    <button className="fmt-chip" onClick={() => setFormatSelectedCols(allSelected ? [] : canvasColumns.map(c => c.canvasId))}
                      style={{ padding: '2px 12px', borderRadius: 20, border: `1px solid ${allSelected ? accent : border}`, background: allSelected ? accentDim : 'transparent', color: allSelected ? accent : text2, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: allSelected ? 700 : 400, transition: 'all 0.12s' }}>
                      All
                    </button>
                    {canvasColumns.map(col => {
                      const sel = formatSelectedCols.includes(col.canvasId)
                      const hasFmt = !!colFormats[col.canvasId]
                      return (
                        <button key={col.canvasId} className="fmt-chip" onClick={() => toggleFormatColSelect(col.canvasId)}
                          style={{ padding: '2px 12px', borderRadius: 20, border: `1px solid ${sel ? accent : hasFmt ? accent + '55' : border}`, background: sel ? accentDim : 'transparent', color: sel ? accent : text2, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all 0.12s', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {col.label}{hasFmt && !sel && <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent, display: 'inline-block' }} />}
                        </button>
                      )
                    })}
                    <button onClick={() => { setColFormats({}); setGlobalFormat(defaultGlobalFormat()) }} style={{ marginLeft: 4, background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '2px 9px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>↺ Reset all</button>
                    <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16 }}>✕</button>
                  </div>

                  {/* Row 2: controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>

                    {/* Font size */}
                    <span style={{ fontSize: 11, color: text3 }}>Size</span>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button onClick={() => updateColFormat(formatSelectedCols, { fontSize: Math.max(8, ((getFormatValue('fontSize') === '—' ? 12 : getFormatValue('fontSize')) - 1)) })}
                        style={{ padding: '3px 8px', background: raised, border: `1px solid ${border}`, borderRadius: '5px 0 0 5px', color: text2, cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>−</button>
                      <div style={{ padding: '3px 10px', background: raised, border: `1px solid ${border}`, borderLeft: 'none', borderRight: 'none', fontSize: 12, color: text, minWidth: 30, textAlign: 'center', fontFamily: "'DM Mono',monospace" }}>
                        {getFormatValue('fontSize') === '—' ? '—' : getFormatValue('fontSize')}
                      </div>
                      <button onClick={() => updateColFormat(formatSelectedCols, { fontSize: Math.min(24, ((getFormatValue('fontSize') === '—' ? 12 : getFormatValue('fontSize')) + 1)) })}
                        style={{ padding: '3px 8px', background: raised, border: `1px solid ${border}`, borderRadius: '0 5px 5px 0', borderLeft: 'none', color: text2, cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>+</button>
                    </div>

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Alignment */}
                    <span style={{ fontSize: 11, color: text3 }}>Align</span>
                    {[['left','L'],['center','C'],['right','R']].map(([val, lbl]) => (
                      <FmtBtn key={val} active={getFormatValue('align') === val} onClick={() => updateColFormat(formatSelectedCols, { align: val })}>{lbl}</FmtBtn>
                    ))}

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Text options */}
                    <FmtBtn active={getFormatValue('bold') === true} onClick={() => updateColFormat(formatSelectedCols, { bold: getFormatValue('bold') !== true })} title="Bold cells"><b style={{ fontSize: 13 }}>B</b></FmtBtn>
                    <FmtBtn active={getFormatValue('wrap') === true} onClick={() => updateColFormat(formatSelectedCols, { wrap: getFormatValue('wrap') !== true })} title="Wrap text">↵ Wrap</FmtBtn>

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Global toggles */}
                    <FmtBtn active={globalFormat.boldHeader} onClick={() => updateGlobalFormat({ boldHeader: !globalFormat.boldHeader })} title="Make header row bold">Bold header</FmtBtn>
                    <FmtBtn active={globalFormat.banding} onClick={() => updateGlobalFormat({ banding: !globalFormat.banding })} title="Alternate row shading (every 2nd row)">▤ Banding</FmtBtn>
                    <FmtBtn active={globalFormat.exportAsTable} onClick={() => updateGlobalFormat({ exportAsTable: !globalFormat.exportAsTable })} title="Export with Excel auto-filter / table structure">⊞ As Table</FmtBtn>
                    <FmtBtn active={globalFormat.freezeHeader} onClick={() => updateGlobalFormat({ freezeHeader: !globalFormat.freezeHeader })} title="In Excel: header row stays visible when scrolling">❄ Freeze header (XLSX)</FmtBtn>

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Border — export only */}
                    <span style={{ fontSize: 11, color: text3 }}>Cell borders (XLSX)</span>
                    {[['none','None'],['thin','Thin'],['medium','Medium']].map(([val, lbl]) => (
                      <FmtBtn key={val} active={globalFormat.borderStyle === val} onClick={() => updateGlobalFormat({ borderStyle: val })}>{lbl}</FmtBtn>
                    ))}

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Header row color */}
                    <span style={{ fontSize: 11, color: text3 }}>Header row color</span>
                    {['#5B5FE8','#1D9E75','#E8B85B','#f87171','#6b7280','#0f172a'].map(c => (
                      <button key={c} onClick={() => updateGlobalFormat({ headerColor: c })}
                        style={{ width: 18, height: 18, borderRadius: 4, background: c, border: globalFormat.headerColor === c ? `2px solid ${text}` : `1px solid transparent`, cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'border 0.1s' }} />
                    ))}
                    {/* Debounced custom color — only commits on pointer up to avoid lag */}
                    <input
                      type="color"
                      value={colorDraft !== null ? colorDraft : globalFormat.headerColor}
                      onChange={e => setColorDraft(e.target.value)}
                      onPointerUp={e => { if (colorDraft !== null) { updateGlobalFormat({ headerColor: colorDraft }); setColorDraft(null) } }}
                      style={{ width: 22, height: 22, border: `1px solid ${border}`, borderRadius: 4, cursor: 'pointer', padding: 1, background: 'none' }}
                      title="Custom header color — drag to pick, release to apply"
                    />
                  </div>
                </div>
              ) : (
                <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '6px 12px', display: 'flex', gap: 3, flexWrap: 'wrap', flexShrink: 0 }}>
                  {tools.map(tool => (
                    <button key={tool.id}
                      className={`tool-btn${activeTool === tool.id ? ' active' : ''}`}
                      onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
                      title={tool.desc}
                      style={{ padding: '5px 11px', borderRadius: 6, border: `1px solid ${tool.id === 'format' && hasAnyFormat ? accent + '77' : border}`, background: tool.id === 'format' && hasAnyFormat ? accentDim : 'transparent', color: text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
                    >
                      <span style={{ fontSize: 13 }}>{tool.icon}</span>
                      <span>{tool.label}</span>
                      {tool.id === 'format' && hasAnyFormat && <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent }} />}
                    </button>
                  ))}
                </div>
              )}

              {/* Tool result banner */}
              {toolResult && !activeTool && (
                <div style={{ background: dark ? '#0d2a1a' : '#dcfce7', borderBottom: `1px solid #4ade8044`, padding: '8px 16px', fontSize: 12, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span>✓</span>
                  <span>{toolResult.type === 'stats' ? 'Col Stats — see below' : toolResult.message}</span>
                  <button onClick={() => setToolResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
              )}

              {/* Tool panels */}
              {activeTool === 'trim' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Trim & Clean</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: text2, cursor: 'pointer' }}><input type="checkbox" checked={trimOptions.spaces} onChange={e => setTrimOptions(p => ({ ...p, spaces: e.target.checked }))} /> Strip extra spaces</label>
                  <label style={{ fontSize: 12, color: text2, display: 'flex', alignItems: 'center', gap: 5 }}>Casing:
                    <select value={trimOptions.casing} onChange={e => setTrimOptions(p => ({ ...p, casing: e.target.value }))} style={{ background: raised, border: `1px solid ${border}`, borderRadius: 4, padding: '2px 6px', color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer' }}>
                      <option value="none">Keep as-is</option><option value="lower">lowercase</option><option value="upper">UPPERCASE</option><option value="title">Title Case</option>
                    </select>
                  </label>
                  <button onClick={runTrim} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Run</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
              {activeTool === 'empty' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Highlight Empty</span>
                  <span style={{ fontSize: 12, color: text2 }}>Empty cells will be highlighted in red. Click any red cell to fill it in.</span>
                  <button onClick={runHighlightEmpty} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{highlightEmpty ? 'Turn Off' : 'Turn On'}</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
              {activeTool === 'duplicates' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Duplicates</span>
                  <span style={{ fontSize: 12, color: text2 }}>Scans all canvas columns and highlights duplicate values in amber.</span>
                  <button onClick={runDuplicates} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Run</button>
                  <button onClick={() => { setDuplicateMap({}); setActiveTool(null) }} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 6, padding: '5px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text2, cursor: 'pointer' }}>Clear</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
              {activeTool === 'stats' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Col Stats</span>
                  <span style={{ fontSize: 12, color: text2 }}>Shows count, unique, empty, min, max for each column.</span>
                  <button onClick={runStats} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Run</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
             {activeTool === 'crosscheck' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>⚡ Crosscheck</span>
                  <span style={{ fontSize: 12, color: text2 }}>Fuzzy match company names across two lists</span>
                  <button onClick={openCCWizard} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 16px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Open Crosscheck →</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
              {activeTool && !['trim','empty','duplicates','stats','format','crosscheck'].includes(activeTool) && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '9px 16px', fontSize: 13, color: accent, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600 }}>{tools.find(t => t.id === activeTool)?.label}</span>
                  <span style={{ color: text2, fontWeight: 400 }}>— {tools.find(t => t.id === activeTool)?.desc}</span>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}

              {/* Canvas scroll area */}
              <div ref={canvasScrollRef} onDragOver={handleCanvasZoneDragOver} onDrop={handleCanvasZoneDrop} onDragLeave={handleCanvasDragLeave} onMouseDown={handleCanvasMouseDown} onContextMenu={e => { e.preventDefault() }}
                style={{ flex: 1, overflow: 'auto', background: base, position: 'relative', cursor: 'default', userSelect: 'none' }}>
                {canvasColumns.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
                    <div className="fadein" style={{ textAlign: 'center', maxWidth: 340 }}>
                      <div style={{ width: 60, height: 60, borderRadius: 14, background: raised, border: `1px dashed ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 18px' }}>📊</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: text, marginBottom: 8, fontFamily: "'Syne',sans-serif" }}>Canvas is empty</div>
                      <div style={{ fontSize: 13, color: text2, lineHeight: 1.8, marginBottom: 22 }}>Drag columns from the sidebar to build your sheet.</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, textAlign: 'left' }}>
                        {[{ icon: '⚡', text: 'Drag Company Name from two files → run Crosscheck' }, { icon: '◎', text: 'Drag two columns → find gaps between them' }, { icon: '✦', text: 'Shift+click columns in sidebar to select multiple' }].map((h, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 7, background: surface, border: `1px solid ${border}`, fontSize: 12, color: text2 }}>
                            <span style={{ color: accent, fontSize: 14, flexShrink: 0 }}>{h.icon}</span>{h.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'inline-block', minWidth: '100%' }}>
                    <div style={{ zoom: canvasZoom, willChange: 'zoom' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
                        <thead>
                          <tr style={{ background: globalFormat.boldHeader ? globalFormat.headerColor + '22' : surface }}>
                            <th style={{ width: 42, padding: '8px 10px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, color: text3, fontSize: 10, textAlign: 'center', fontWeight: 500, background: globalFormat.boldHeader ? globalFormat.headerColor + '22' : surface, position: 'sticky', top: 0, zIndex: 5 }}>#</th>
                            {sortedCanvasCols.map((col, idx) => {
                              const isPinned = pinnedColIds.includes(col.canvasId)
                              const isDraggingThis = draggingCanvasId === col.canvasId
                              const isInsertBefore = insertAt?.index === idx && insertAt?.side === 'left'
                              const isInsertAfter  = insertAt?.index === idx && insertAt?.side === 'right'
                              const fmt = getColFormat(col.canvasId)
                              return (
                                <th key={col.canvasId} className="canvas-th" draggable
                                  onDragStart={e => handleCanvasDragStart(e, col.canvasId)}
                                  onDragEnd={handleCanvasDragEnd}
                                  onDragOver={e => handleThDragOver(e, idx)}
                                  onDrop={e => handleThDrop(e, idx)}
                                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setColContextMenu({ x: e.clientX, y: e.clientY, canvasId: col.canvasId, label: col.label }) }}
                                  style={{ padding: '8px 12px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, textAlign: fmt.align || 'left', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: fmt.fontSize || 12, fontWeight: globalFormat.boldHeader ? 700 : 600, background: isPinned ? (dark ? '#1a1f4a' : '#e8f5ee') : globalFormat.boldHeader ? globalFormat.headerColor + '22' : surface, color: globalFormat.boldHeader ? globalFormat.headerColor : text, opacity: isDraggingThis ? 0.3 : 1, position: 'sticky', top: 0, zIndex: 4, overflow: 'visible' }}
                                >
                                  {isInsertBefore && <div style={{ position: 'absolute', left: -1, top: 0, bottom: 0, width: 3, background: accent, borderRadius: 2, zIndex: 10, pointerEvents: 'none' }}><div style={{ position: 'absolute', top: -3, left: -2, width: 7, height: 7, borderRadius: '50%', background: accent }} /></div>}
                                  {isInsertAfter  && <div style={{ position: 'absolute', right: -2, top: 0, bottom: 0, width: 3, background: accent, borderRadius: 2, zIndex: 10, pointerEvents: 'none' }}><div style={{ position: 'absolute', top: -3, left: -2, width: 7, height: 7, borderRadius: '50%', background: accent }} /></div>}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {editingColId === col.canvasId ? (
                                      <input ref={editInputRef} value={editingLabel} onChange={e => setEditingLabel(e.target.value)} onBlur={() => commitEdit(col.canvasId)} onKeyDown={e => { if (e.key === 'Enter') commitEdit(col.canvasId); if (e.key === 'Escape') setEditingColId(null) }} style={{ background: raised, border: `1px solid ${accent}`, borderRadius: 4, padding: '2px 6px', color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, width: 120, outline: 'none' }} autoFocus onClick={e => e.stopPropagation()} />
                                    ) : (
                                      <div>
                                        <div className="col-label-click" onClick={() => startEdit(col.canvasId, col.label)} title="Click to rename" style={{ display: 'inline-block' }}>{col.label}</div>
                                        <div style={{ color: text3, fontSize: 10, fontWeight: 400, marginTop: 1 }}>{col.fileName}</div>
                                      </div>
                                    )}
                                    <button className="th-pin" title={isPinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(col.canvasId)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px', color: isPinned ? accent : text3, opacity: isPinned ? 1 : 0, marginLeft: 'auto', flexShrink: 0 }}>📌</button>
                                    <button onClick={() => removeCanvasColumn(col.canvasId)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: text3, fontSize: 11, padding: '0 2px', lineHeight: 1, flexShrink: 0, opacity: 0.5, marginLeft: 2 }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.5}>✕</button>
                                  </div>
                                </th>
                              )
                            })}
                            <th onClick={addBlankColumn} style={{ padding: '8px 14px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, background: surface, position: 'sticky', top: 0, zIndex: 4, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text3 }}
                              onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = accent }}
                              onMouseLeave={e => { e.currentTarget.style.background = surface; e.currentTarget.style.color = text3 }}>+ col</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: Math.min(visibleRowCount, maxRows) }).map((_, ri) => {
                            if (hiddenRows.has(ri)) return null
                            const isBandedRow = globalFormat.banding && ri % 2 === 0
                            return (
                              <tr key={ri}>
                                <td onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: ri }) }}
                                  style={{ padding: '5px 10px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 10, cursor: 'context-menu', userSelect: 'none' }}
                                  onMouseEnter={e => { e.currentTarget.style.background = raised }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>{ri + 1}</td>
                                {sortedCanvasCols.map((col, idx) => {
                                  const val = col.rows[ri]
                                  const isEmpty = val === undefined || val === null || val === ''
                                  const isPinned = pinnedColIds.includes(col.canvasId)
                                  const isEditing = editingCell?.canvasId === col.canvasId && editingCell?.rowIndex === ri
                                  const isDup = duplicateMap[col.canvasId]?.has(String(val ?? '').trim().toLowerCase())
                                  const isEmptyHighlight = highlightEmpty && isEmpty
                                  const fmt = getColFormat(col.canvasId)
                                 const ccDec = col.label === 'CC Decision' ? String(val || '').toLowerCase() : null
                                  const isSelected = selectedCell?.canvasId === col.canvasId && selectedCell?.rowIndex === ri && !isEditing
                                  let bg = ri % 2 === 1 ? `${surface}55` : 'transparent'
                                  if (isPinned) bg = dark ? '#1a1f4a33' : '#e8f5ee88'
                                  if (isBandedRow) bg = dark ? globalFormat.headerColor + '22' : globalFormat.headerColor + '11'
                                  if (isDup) bg = dark ? '#2a1f0d' : '#fef3c7'
                                  if (isEmptyHighlight) bg = dark ? '#2a0d0d' : '#fee2e2'
                                  if (ccDec === 'matched')   bg = dark ? '#0d2a1a' : '#dcfce7'
                                  if (ccDec === 'maybe')     bg = dark ? '#2a1f0d' : '#fef3c7'
                                  if (ccDec === 'unmatched') bg = dark ? '#2a0d0d' : '#fee2e2'
                                  return (
                                    <td key={col.canvasId}
                                      onDragOver={e => handleThDragOver(e, idx)}
                                      onDrop={e => handleThDrop(e, idx)}
                                      onClick={() => !isEditing && startCellEdit(col.canvasId, ri, val)}
                                     style={{ padding: isEditing ? '0' : '5px 14px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, outline: isSelected ? `2px solid ${accent}` : 'none', outlineOffset: '-2px', color: ccDec === 'matched' ? green : ccDec === 'maybe' ? amber : ccDec === 'unmatched' ? red : isEmptyHighlight ? '#f87171' : isDup ? '#E8B85B' : isEmpty ? text3 : text2, whiteSpace: fmt.wrap ? 'normal' : 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', background: bg, cursor: isEditing ? 'text' : 'default', fontSize: fmt.fontSize || 12, fontWeight: fmt.bold ? 700 : 400, textAlign: fmt.align || 'left' }}
                                    >
                                      {isEditing ? (
                                        <input autoFocus value={editingCellVal} onChange={e => setEditingCellVal(e.target.value)} onBlur={commitCellEdit} onKeyDown={handleCellKeyDown} style={{ width: '100%', padding: '5px 14px', border: 'none', borderBottom: `2px solid ${accent}`, background: raised, color: text, fontFamily: "'DM Mono',monospace", fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                                      ) : isEmptyHighlight ? (
                                        <span style={{ fontSize: 11, color: '#f87171', fontStyle: 'italic' }}>empty — click to fill</span>
                                      ) : isEmpty ? (
                                        <span style={{ fontSize: 10 }}>—</span>
                                      ) : String(val)}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                  <div ref={bottomSentinelRef} style={{ height: 1 }} />
                    </div>
                  </div>
                )}
              </div>

            
              {/* Hidden rows banner */}
              {hiddenRows.size > 0 && (
                <div style={{ padding: '5px 16px', background: dark ? '#2a1f0d' : '#fef3c7', borderTop: `1px solid ${amber}44`, fontSize: 11, color: amber, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span>◌ {hiddenRows.size} row{hiddenRows.size !== 1 ? 's' : ''} hidden</span>
                  <button onClick={showAllRows} style={{ background: 'none', border: `1px solid ${amber}44`, borderRadius: 4, padding: '2px 8px', color: amber, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Show all</button>
                </div>
              )}

              {/* Sheets bar */}
              <div style={{ borderTop: `1px solid ${border}`, background: surface, display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto' }}>
                  {canvases.map(canvas => {
  const isActive = activeSheet === canvas.id
  return (
    <div key={canvas.id} style={{ display: 'flex', alignItems: 'stretch', position: 'relative', flexShrink: 0 }}
      onMouseEnter={e => e.currentTarget.querySelector('.del-canvas').style.opacity = '1'}
      onMouseLeave={e => e.currentTarget.querySelector('.del-canvas').style.opacity = '0'}>
      <button
        onClick={() => { setActiveSheet(canvas.id); setActiveCanvasId(canvas.id) }}
        onDoubleClick={() => { setRenamingCanvasId(canvas.id); setRenamingCanvasLabel(canvas.name) }}
        style={{ padding: '6px 16px', border: 'none', borderRight: 'none', borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`, background: isActive ? base : surface, color: isActive ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
        {renamingCanvasId === canvas.id ? (
          <input autoFocus value={renamingCanvasLabel}
            onChange={e => setRenamingCanvasLabel(e.target.value)}
            onBlur={() => { setCanvases(prev => prev.map(c => c.id === canvas.id ? { ...c, name: renamingCanvasLabel || canvas.name } : c)); setRenamingCanvasId(null) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
            onClick={e => e.stopPropagation()}
            style={{ background: 'transparent', border: 'none', color: accent, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, outline: 'none', width: Math.max(60, renamingCanvasLabel.length * 8) }} />
        ) : canvas.name}
      </button>
      {canvases.length > 1 && (
        <button className="del-canvas" onClick={() => deleteCanvas(canvas.id)}
          style={{ opacity: 0, transition: 'opacity 0.15s', padding: '0 6px', border: 'none', borderRight: `1px solid ${border}`, borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`, background: isActive ? base : surface, color: text3, cursor: 'pointer', fontSize: 11 }}>✕</button>
      )}
      {!canvases.length > 1 && <div style={{ width: 1, background: border, borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent` }} />}
    </div>
  )
})}
                  {files.flatMap(file => file.sheets.map(sheet => { const key = `${file.id}::${sheet.name}`; const isActive = activeSheet === key; return (
                    <button key={key} onClick={() => { 
  setActiveSheet(key)
  setMode('preview')
  setActivePreviewSheet({ fileId: file.id, si: file.sheets.indexOf(sheet) })
}} style={{ padding: '6px 16px', border: 'none', borderRight: `1px solid ${border}`, borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`, background: isActive ? base : surface, color: isActive ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: text3, fontSize: 10 }}>📄</span>{file.sheets.length > 1 ? `${file.name} — ${sheet.name}` : file.name}
                    </button>
                  )}))}
                  <button onClick={addCanvas} style={{ padding: '6px 12px', border: 'none', borderRight: `1px solid ${border}`, borderTop: '2px solid transparent', background: 'transparent', color: text3, cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>+</button>
                </div>
                <div style={{ padding: '0 14px', fontSize: 11, color: text3, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, borderLeft: `1px solid ${border}` }}>
                  <span style={{ color: green, fontSize: 8 }}>●</span>
                  <span>{maxRows.toLocaleString()} rows</span><span>·</span><span>{canvasColumns.length} cols</span>
                  {maxRows > 500 && <span style={{ color: amber }}>· 500 shown</span>}
                  <span style={{ marginLeft: 6, borderLeft: `1px solid ${border}`, paddingLeft: 8 }}>
                    <button onClick={() => setCanvasZoom(prev => Math.min(2, Math.round((prev + 0.1) * 10) / 10))} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 13, padding: '0 3px' }}>+</button>
                    <span style={{ minWidth: 36, textAlign: 'center', display: 'inline-block', cursor: 'pointer' }} onClick={() => setCanvasZoom(1)}>{Math.round(canvasZoom * 100)}%</span>
                    <button onClick={() => setCanvasZoom(prev => Math.max(0.5, Math.round((prev - 0.1) * 10) / 10))} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 13, padding: '0 3px' }}>−</button>
                  </span>
                </div>
              </div>
            </div>
          )}
        </>}
      </div>
    </div>
      {/* Floating stat cards */}
      {statCards.map(card => <StatCard key={card.id} card={card} />)}

      {showCCWizard && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setShowCCWizard(false) }}
          style={{ position: 'fixed', inset: 0, background: '#00000077', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif" }}>
          <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 16, width: 720, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ padding: '20px 28px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 18, color: accent }}>⚡</span>
              <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 17, fontWeight: 800, color: accent, letterSpacing: '-0.3px' }}>Crosscheck</span>
              <span style={{ fontSize: 12, color: text3, marginLeft: 4 }}>Fuzzy match company names across two lists</span>
              <button onClick={() => setShowCCWizard(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}
                onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
            </div>

            {/* Step bar */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '18px 28px 0', gap: 0, flexShrink: 0 }}>
              {[['1', 'Your check list'], ['2', 'Master list'], ['3', 'Running'], ['4', 'Results']].map(([num, label], i) => {
                const n = i + 1
                const isDone = ccStep > n
                const isActive = ccStep === n
                return (
                  <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 0, flex: n < 4 ? 1 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: isDone || isActive ? accent : raised, border: `1px solid ${isDone || isActive ? accent : border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: isDone || isActive ? '#fff' : text3, outline: isActive ? `3px solid ${accentDim}` : 'none', flexShrink: 0 }}>
                        {isDone ? '✓' : num}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? text : isDone ? text2 : text3, whiteSpace: 'nowrap' }}>{label}</span>
                    </div>
                    {n < 4 && <div style={{ flex: 1, height: 1, background: border, margin: '0 12px' }} />}
                  </div>
                )
              })}
            </div>

            {/* Body */}
            <div style={{ flex: 1, padding: '20px 28px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Step 1 — Pick check list */}
              {ccStep === 1 && (
                <>
                  <div style={{ background: accentDim, border: `1px solid ${accent}33`, borderLeft: `4px solid ${accent}`, borderRadius: 8, padding: '14px 18px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: accent, marginBottom: 5 }}>Which list do you want to check?</div>
                    <div style={{ fontSize: 12, color: text2, lineHeight: 1.7 }}>
                      This is your <strong style={{ color: text }}>incoming list</strong> — the names you're not sure about. For example: a list of event exhibitors, new leads, or contacts from a trade show. These are the names Crosscheck will try to find inside your master list.
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {canvasColumns.map(col => {
                      const sel = crosscheckConfig.colAId === col.canvasId
                      return (
                        <div key={col.canvasId} onClick={() => setCrosscheckConfig(p => ({ ...p, colAId: col.canvasId }))}
                          style={{ border: `1.5px solid ${sel ? accent : border}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', background: sel ? accentDim : raised, transition: 'all 0.12s' }}
                          onMouseEnter={e => { if (!sel) e.currentTarget.style.borderColor = accent + '66' }}
                          onMouseLeave={e => { if (!sel) e.currentTarget.style.borderColor = border }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: sel ? accent : text3, marginTop: 4, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: sel ? accent : text, fontFamily: "'DM Sans',sans-serif" }}>{col.label}</div>
                              <div style={{ fontSize: 11, color: text3, marginTop: 3 }}>{col.rows.length.toLocaleString()} rows · {col.fileName}</div>
                              {sel && <div style={{ fontSize: 10, color: accent, fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>✓ selected as check list</div>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {canvasColumns.length === 0 && <div style={{ fontSize: 13, color: text3, textAlign: 'center', padding: '20px 0' }}>No columns on canvas yet — drag columns from the sidebar first.</div>}
                </>
              )}

              {/* Step 2 — Pick master list */}
              {ccStep === 2 && (
                <>
                  <div style={{ background: dark ? '#0d2a1a' : '#dcfce7', border: `1px solid #4ade8033`, borderLeft: `4px solid #4ade80`, borderRadius: 8, padding: '14px 18px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: green, marginBottom: 5 }}>Which is your master list?</div>
                    <div style={{ fontSize: 12, color: text2, lineHeight: 1.7 }}>
                      This is your <strong style={{ color: text }}>source of truth</strong> — your CRM export, your account database, your existing client list. Crosscheck will search through every name here to find the closest match to each name in your check list.
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {canvasColumns.filter(c => c.canvasId !== crosscheckConfig.colAId).map(col => {
                      const sel = crosscheckConfig.colBId === col.canvasId
                      return (
                        <div key={col.canvasId} onClick={() => setCrosscheckConfig(p => ({ ...p, colBId: col.canvasId }))}
                          style={{ border: `1.5px solid ${sel ? green : border}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', background: sel ? (dark ? '#0d2a1a' : '#dcfce7') : raised, transition: 'all 0.12s' }}
                          onMouseEnter={e => { if (!sel) e.currentTarget.style.borderColor = green + '66' }}
                          onMouseLeave={e => { if (!sel) e.currentTarget.style.borderColor = border }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: sel ? green : text3, marginTop: 4, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: sel ? green : text }}>{col.label}</div>
                              <div style={{ fontSize: 11, color: text3, marginTop: 3 }}>{col.rows.length.toLocaleString()} rows · {col.fileName}</div>
                              {sel && <div style={{ fontSize: 10, color: green, fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>✓ selected as master list</div>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: text3 }}>Sensitivity:</span>
                    {[[75, 'Lenient — catches more'], [85, 'Medium — recommended'], [90, 'Strict — high confidence only']].map(([val, lbl]) => (
                      <button key={val} onClick={() => setCrosscheckConfig(p => ({ ...p, threshold: val }))}
                        style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${crosscheckConfig.threshold === val ? accent : border}`, background: crosscheckConfig.threshold === val ? accentDim : 'transparent', color: crosscheckConfig.threshold === val ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer' }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Step 3 — Running */}
              {ccStep === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: text }}>Finding matches...</div>
                      <div style={{ fontSize: 12, color: text3, marginTop: 2 }}>{ccLiveRows.length} matches found so far</div>
                    </div>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid ${accent}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: raised, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: accent, borderRadius: 2, width: crosscheckRunning ? '70%' : '100%', transition: 'width 2s ease' }} />
                  </div>
                  <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', background: raised, borderBottom: `1px solid ${border}`, padding: '6px 0' }}>
                      <div style={{ flex: 2, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your name</div>
                      <div style={{ flex: 2, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Match found</div>
                      <div style={{ flex: 1, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Confidence</div>
                    </div>
                    {ccLiveRows.map((r, i) => {
                      const isReview = r.decision === 'maybe'
                      const scoreColor = isReview ? amber : green
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${border}22`, background: isReview ? (dark ? '#2a1f0d33' : '#fef3c755') : 'transparent' }}>
                          <div style={{ flex: 2, padding: '8px 14px', fontSize: 12, color: text, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r.original ?? '')}</div>
                          <div style={{ flex: 2, padding: '8px 14px', fontSize: 12, color: text2, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.bestMatch}</div>
                          <div style={{ flex: 1, padding: '8px 14px' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor, fontFamily: "'DM Mono',monospace" }}>{r.score}%</div>
                            <div style={{ height: 3, borderRadius: 2, background: raised, marginTop: 3, width: 48, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${r.score}%`, background: scoreColor, borderRadius: 2 }} />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {ccLiveRows.length === 0 && <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: text3 }}>Starting...</div>}
                  </div>
                  <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
                </div>
              )}

              {/* Step 4 — Results */}
              {ccStep === 4 && ccResults && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[
                      { label: 'Matched', value: ccResults.summary.matched, color: green, bg: dark ? '#0d2a1a' : '#dcfce7' },
                      { label: 'Need review', value: ccResults.summary.maybe, color: amber, bg: dark ? '#2a1f0d' : '#fef3c7' },
                      { label: 'Not found', value: ccResults.summary.unmatched, color: red, bg: dark ? '#2a0d0d' : '#fee2e2' },
                    ].map(({ label, value, color, bg }) => (
                      <div key={label} style={{ flex: 1, background: bg, borderRadius: 10, padding: '12px 16px', textAlign: 'center', border: `1px solid ${color}33` }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "'Syne',sans-serif" }}>{value.toLocaleString()}</div>
                        <div style={{ fontSize: 11, color, marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['matched', `Matched & review (${ccResults.matched.length})`], ['unmatched', `Not found (${ccResults.unmatched.length})`]].map(([tab, label]) => (
                      <button key={tab} onClick={() => setCCActiveTab(tab)}
                        style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${ccActiveTab === tab ? accent : border}`, background: ccActiveTab === tab ? accentDim : 'transparent', color: ccActiveTab === tab ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: ccActiveTab === tab ? 600 : 400, cursor: 'pointer' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', background: raised, borderBottom: `1px solid ${border}`, padding: '6px 0', position: 'sticky', top: 0 }}>
                      <div style={{ flex: 2, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your name</div>
                      {ccActiveTab === 'matched' && <div style={{ flex: 2, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Best match</div>}
                      {ccActiveTab === 'matched' && <div style={{ flex: 1, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Confidence</div>}
                      {ccActiveTab === 'matched' && <div style={{ width: 110, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Status</div>}
                    </div>
                    {ccActiveTab === 'matched' && ccResults.matched.map((r, i) => {
                      const isReview = r.decision === 'maybe'
                      const key = String(r.original ?? '')
                      const confirmed = ccConfirmed.has(key)
                      const rejected = ccRejected.has(key)
                      const scoreColor = confirmed ? green : isReview ? amber : green
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${border}22`, background: rejected ? (dark ? '#2a0d0d55' : '#fee2e255') : isReview && !confirmed ? (dark ? '#2a1f0d33' : '#fef3c755') : 'transparent' }}>
                          <div style={{ flex: 2, padding: '8px 14px', fontSize: 12, color: rejected ? text3 : text, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: rejected ? 'line-through' : 'none' }}>{String(r.original ?? '')}</div>
                          <div style={{ flex: 2, padding: '8px 14px', fontSize: 12, color: text2, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.bestMatch}</div>
                          <div style={{ flex: 1, padding: '8px 14px' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor, fontFamily: "'DM Mono',monospace" }}>{r.score}%</div>
                            <div style={{ height: 3, borderRadius: 2, background: raised, marginTop: 3, width: 48, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${r.score}%`, background: scoreColor, borderRadius: 2 }} />
                            </div>
                          </div>
                          <div style={{ width: 110, padding: '8px 14px', display: 'flex', gap: 5, alignItems: 'center' }}>
                            {isReview && !confirmed && !rejected ? (
                              <>
                                <button onClick={() => setCCConfirmed(prev => new Set([...prev, key]))}
                                  style={{ background: dark ? '#0d2a1a' : '#dcfce7', border: `1px solid ${green}44`, borderRadius: 4, color: green, fontSize: 11, padding: '2px 7px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>✓ Yes</button>
                                <button onClick={() => setCCRejected(prev => new Set([...prev, key]))}
                                  style={{ background: dark ? '#2a0d0d' : '#fee2e2', border: `1px solid ${red}44`, borderRadius: 4, color: red, fontSize: 11, padding: '2px 7px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>✕</button>
                              </>
                            ) : confirmed ? (
                              <span style={{ fontSize: 10, color: green, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>✓ confirmed</span>
                            ) : rejected ? (
                              <span style={{ fontSize: 10, color: red, fontWeight: 700 }}>✕ rejected</span>
                            ) : (
                              <span style={{ fontSize: 10, color: green, fontWeight: 700, background: dark ? '#0d2a1a' : '#dcfce7', padding: '2px 7px', borderRadius: 4 }}>matched</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {ccActiveTab === 'unmatched' && ccResults.unmatched.map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${border}22` }}>
                        <div style={{ flex: 1, padding: '8px 14px', fontSize: 12, color: text3, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r.original ?? '')}</div>
                        <div style={{ padding: '8px 14px' }}><span style={{ fontSize: 10, color: red, fontWeight: 700, background: dark ? '#2a0d0d' : '#fee2e2', padding: '2px 7px', borderRadius: 4 }}>not found</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 28px', borderTop: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              {ccStep === 1 && (
                <>
                  <span style={{ fontSize: 11, color: text3 }}>Step 1 of 3</span>
                  <button onClick={() => { if (crosscheckConfig.colAId) setCCStep(2) }}
                    disabled={!crosscheckConfig.colAId}
                    style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: crosscheckConfig.colAId ? 'pointer' : 'default', opacity: crosscheckConfig.colAId ? 1 : 0.4 }}>
                    Next — pick master list →
                  </button>
                </>
              )}
              {ccStep === 2 && (
                <>
                  <button onClick={() => setCCStep(1)} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, padding: '9px 16px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: text2, cursor: 'pointer' }}>← Back</button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: text3 }}>
                      Checking <strong style={{ color: text }}>{canvasColumns.find(c => c.canvasId === crosscheckConfig.colAId)?.label}</strong> against <strong style={{ color: text }}>{crosscheckConfig.colBId ? canvasColumns.find(c => c.canvasId === crosscheckConfig.colBId)?.label : '—'}</strong>
                    </span>
                    <button onClick={runCrosscheck} disabled={!crosscheckConfig.colBId}
                      style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: crosscheckConfig.colBId ? 'pointer' : 'default', opacity: crosscheckConfig.colBId ? 1 : 0.4 }}>
                      Run Crosscheck ⚡
                    </button>
                  </div>
                </>
              )}
              {ccStep === 3 && (
                <span style={{ fontSize: 12, color: text3, width: '100%', textAlign: 'center' }}>Matching in progress — please wait...</span>
              )}
              {ccStep === 4 && (
                <>
                  <button onClick={() => { setCCStep(1); setCCResults(null); setCCLiveRows([]); setCrosscheckConfig({ colAId: '', colBId: '', threshold: 85 }) }}
                    style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, padding: '9px 16px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: text2, cursor: 'pointer' }}>← Start over</button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, padding: '9px 16px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: text2, cursor: 'pointer' }}>Export CSV</button>
                    <button onClick={addCCToCanvas}
                      style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Add to canvas ✓
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </>
  )
}