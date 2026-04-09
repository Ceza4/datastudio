'use client'
import { useState } from 'react'

const CARD_COLORS = ['#5B5FE8', '#4ade80', '#E8B85B', '#f87171', '#a78bfa', '#38bdf8', '#fb923c']

/* Kanban-style block with draggable cards across draggable lanes.
   Used inside notebook blocks of type 'kanban'. */
export default function KanbanBlock({ block, onUpdateBlock, colors, dark, editingRef }) {
  const { surface, raised, border, text, text3, accent, accentDim, red } = colors
  const [addingCard, setAddingCard] = useState({})
  const [newCardTitle, setNewCardTitle] = useState({})
  const [cardDrag, setCardDrag] = useState(null)
  const [cardDragOver, setCardDragOver] = useState(null)

  function addCard(laneId) {
    const title = (newCardTitle[laneId] || '').trim()
    if (!title) return
    const card = { id: `card_${Date.now()}`, title, tag: '', color: CARD_COLORS[0] }
    onUpdateBlock(block.id, {
      lanes: block.lanes.map(l => l.id === laneId ? { ...l, cards: [...l.cards, card] } : l)
    })
    setNewCardTitle(p => ({ ...p, [laneId]: '' }))
    setAddingCard(p => ({ ...p, [laneId]: false }))
  }

  function moveCard(cardId, fromLaneId, toLaneId) {
    if (fromLaneId === toLaneId) return
    let card
    const newLanes = block.lanes
      .map(l => {
        if (l.id === fromLaneId) {
          card = l.cards.find(c => c.id === cardId)
          return { ...l, cards: l.cards.filter(c => c.id !== cardId) }
        }
        return l
      })
      .map(l => l.id === toLaneId && card ? { ...l, cards: [...l.cards, card] } : l)

    onUpdateBlock(block.id, { lanes: newLanes })
  }

  function deleteCard(laneId, cardId) {
    onUpdateBlock(block.id, {
      lanes: block.lanes.map(l => l.id === laneId ? { ...l, cards: l.cards.filter(c => c.id !== cardId) } : l)
    })
  }

  function updateCard(laneId, cardId, patch) {
    onUpdateBlock(block.id, {
      lanes: block.lanes.map(l =>
        l.id === laneId
          ? { ...l, cards: l.cards.map(c => c.id === cardId ? { ...c, ...patch } : c) }
          : l
      )
    })
  }

  return (
    <div style={{ display: 'flex', gap: 8, padding: 10, alignItems: 'flex-start', overflowX: 'auto', maxWidth: '100%' }}>
      {block.lanes.map(lane => (
        <div
          key={lane.id}
          onDragOver={e => {
            e.preventDefault()
            e.stopPropagation()
            setCardDragOver({ laneId: lane.id, blockId: block.id })
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget)) setCardDragOver(null)
          }}
          onDrop={e => {
            e.preventDefault()
            e.stopPropagation()
            if (cardDrag?.blockId === block.id) {
              moveCard(cardDrag.cardId, cardDrag.fromLaneId, lane.id)
              setCardDrag(null)
              setCardDragOver(null)
            }
          }}
          style={{
            width: 200,
            background: cardDragOver?.laneId === lane.id && cardDragOver?.blockId === block.id ? accentDim : (dark ? '#1a1917' : '#DDD9CF'),
            borderRadius: 8,
            padding: 8,
            border: cardDragOver?.laneId === lane.id && cardDragOver?.blockId === block.id ? `1px solid ${accent}` : `1px solid ${border}`,
            transition: 'all 0.15s',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <input
              value={lane.name}
              onChange={e => onUpdateBlock(block.id, {
                lanes: block.lanes.map(l => l.id === lane.id ? { ...l, name: e.target.value } : l)
              })}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onFocus={() => { editingRef.current = true }}
              onBlur={() => { editingRef.current = false }}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                fontFamily: "'DM Sans',sans-serif",
                fontWeight: 700,
                fontSize: 12,
                color: text,
                outline: 'none',
                minWidth: 0
              }}
            />
            <span style={{ fontSize: 10, color: text3, background: raised, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
              {lane.cards.length}
            </span>
            <button
              onClick={e => {
                e.stopPropagation()
                if (window.confirm('Delete lane?')) {
                  onUpdateBlock(block.id, { lanes: block.lanes.filter(l => l.id !== lane.id) })
                }
              }}
              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = red}
              onMouseLeave={e => e.currentTarget.style.color = text3}
            >
              ✕
            </button>
          </div>

          {lane.cards.map(card => (
            <div
              key={card.id}
              draggable
              onDragStart={e => {
                e.stopPropagation()
                setCardDrag({ cardId: card.id, fromLaneId: lane.id, blockId: block.id })
              }}
              onDragEnd={() => {
                setCardDrag(null)
                setCardDragOver(null)
              }}
              onMouseDown={e => e.stopPropagation()}
              style={{
                background: surface,
                borderRadius: 7,
                padding: '8px 10px',
                marginBottom: 6,
                border: `1px solid ${border}`,
                borderLeft: `3px solid ${card.color}`,
                cursor: 'grab',
                position: 'relative'
              }}
            >
              <div style={{ fontSize: 12, color: text, fontFamily: "'DM Sans',sans-serif", lineHeight: 1.4, paddingRight: 16 }}>
                {card.title}
              </div>

              {card.tag && (
                <div style={{ fontSize: 10, color: card.color, fontWeight: 700, background: card.color + '22', borderRadius: 3, padding: '1px 6px', display: 'inline-block', marginTop: 4 }}>
                  {card.tag}
                </div>
              )}

              <button
                onClick={e => {
                  e.stopPropagation()
                  deleteCard(lane.id, card.id)
                }}
                style={{ position: 'absolute', top: 5, right: 5, background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '1px 3px' }}
                onMouseEnter={e => e.currentTarget.style.color = red}
                onMouseLeave={e => e.currentTarget.style.color = text3}
              >
                ✕
              </button>

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                {CARD_COLORS.map(c => (
                  <div
                    key={c}
                    onClick={e => {
                      e.stopPropagation()
                      updateCard(lane.id, card.id, { color: c })
                    }}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: c,
                      cursor: 'pointer',
                      border: card.color === c ? `2px solid ${text}` : '1px solid transparent',
                      flexShrink: 0
                    }}
                  />
                ))}
              </div>

              <input
                value={card.tag}
                onChange={e => updateCard(lane.id, card.id, { tag: e.target.value })}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                onFocus={() => { editingRef.current = true }}
                onBlur={() => { editingRef.current = false }}
                placeholder="tag..."
                style={{
                  width: '100%',
                  marginTop: 5,
                  background: 'transparent',
                  border: 'none',
                  borderTop: `1px solid ${border}33`,
                  color: text3,
                  fontFamily: "'DM Sans',sans-serif",
                  fontSize: 10,
                  outline: 'none',
                  padding: '3px 0',
                  fontStyle: card.tag ? 'normal' : 'italic'
                }}
              />
            </div>
          ))}

          {addingCard[lane.id] ? (
            <div style={{ background: surface, borderRadius: 7, padding: '7px 9px', border: `1px solid ${accent}` }}>
              <input
                autoFocus
                value={newCardTitle[lane.id] || ''}
                onChange={e => setNewCardTitle(p => ({ ...p, [lane.id]: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') addCard(lane.id)
                  if (e.key === 'Escape') setAddingCard(p => ({ ...p, [lane.id]: false }))
                }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                placeholder="Card title..."
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: text,
                  fontFamily: "'DM Sans',sans-serif",
                  fontSize: 12,
                  outline: 'none',
                  marginBottom: 6
                }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    addCard(lane.id)
                  }}
                  style={{ background: accent, border: 'none', borderRadius: 4, color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 11, padding: '3px 10px', cursor: 'pointer' }}
                >
                  Add
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setAddingCard(p => ({ ...p, [lane.id]: false }))
                  }}
                  style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 4, color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={e => {
                e.stopPropagation()
                setAddingCard(p => ({ ...p, [lane.id]: true }))
              }}
              onMouseDown={e => e.stopPropagation()}
              style={{ width: '100%', background: 'none', border: `1px dashed ${border}`, borderRadius: 6, padding: '5px', color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer' }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = accent
                e.currentTarget.style.color = accent
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = border
                e.currentTarget.style.color = text3
              }}
            >
              + card
            </button>
          )}
        </div>
      ))}

      <button
        onClick={e => {
          e.stopPropagation()
          onUpdateBlock(block.id, {
            lanes: [...block.lanes, { id: `lane_${Date.now()}`, name: `Lane ${block.lanes.length + 1}`, cards: [] }]
          })
        }}
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 36,
          minHeight: 60,
          background: 'none',
          border: `1px dashed ${border}`,
          borderRadius: 8,
          color: text3,
          cursor: 'pointer',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          alignSelf: 'flex-start',
          marginTop: 28
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = accent
          e.currentTarget.style.color = accent
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = border
          e.currentTarget.style.color = text3
        }}
      >
        +
      </button>
    </div>
  )
}
