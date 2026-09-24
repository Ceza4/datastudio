'use client'
import { memo, useMemo, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import { stageSummary, moveRow, createRow, addRow, rowTitle } from '../../lib/database'

/*
  components/builder/PipelineBlock.js
  --------------------------------------------------------------------------
  Builder Phase 1 (24 Sep 2026). A pipeline board OVER a Database block.

  The data is not here. `block.sourceId` names a Database block, and every
  card is one of its rows, grouped by a Select property (`block.groupBy`) and
  optionally summed by a Number property (`block.valueProp`). Moving a card
  writes the row's stage back to that database, so the database's own table,
  board and calendar views change with it. See lib/database.js (stageSummary,
  moveRow) and the Builder plan doc.

  DRAG IS POINTER-BASED, NOT HTML5 drag-and-drop. The block lives inside the
  canvas's CSS transform and the canvas owns mousedown for moving blocks, so
  the native DnD ghost image comes out scaled and the canvas and the browser
  fight over the same press. Pointer events with a 4px threshold give a plain
  click (open the record) and a drag (move the card) from the same press.
  Hit-testing uses elementsFromPoint in SCREEN space, where the pointer is, so
  the canvas zoom never enters the maths.
  -------------------------------------------------------------------------- */

const tone = name => `var(--ds-${name || 'text-3'})`
const AVATAR = ['accent', 'green', 'amber', 'red']
const initials = s => String(s || '?').replace(/^Example:\s*/, '').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
const hashTone = id => AVATAR[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR.length]
const fmt = n => (typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '')

function PipelineBlockInner({ block, source, colors, onUpdateSource, onUpdateBlock, onOpenRecord, openRowId }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const db = source?.db || null
  const groupBy = block.groupBy
  const valueProp = block.valueProp || null
  const cols = useMemo(() => (db && groupBy ? stageSummary(db, groupBy, valueProp) : null), [db, groupBy, valueProp])
  const dateProp = db?.properties?.find(p => p.type === 'date')?.id || null

  const [drag, setDrag] = useState(null)   // { rowId, x, y, stage, before }
  const pressRef = useRef(null)
  const rootRef = useRef(null)

  if (!source || !db) {
    return <Empty colors={colors} title="No database to show" body="This pipeline's database was deleted, or it was never linked. Add a Pipeline again to start a new one." />
  }
  const selects = db.properties.filter(p => p.type === 'select')
  const numbers = db.properties.filter(p => p.type === 'number')
  if (!cols) {
    return (
      <Empty colors={colors} title="Pick the stages"
        body={selects.length ? 'Choose which Select field holds the stages.' : `“${db.name || 'This database'}” has no Select field yet. Add one (for example Stage) in the database, then pick it here.`}>
        {selects.length > 0 && (
          <select aria-label="Stages field" value="" onChange={e => onUpdateBlock({ groupBy: e.target.value })}
            onMouseDown={e => e.stopPropagation()}
            style={selectStyle(colors)}>
            <option value="" disabled>Choose a field…</option>
            {selects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </Empty>
    )
  }

  function onCardDown(e, rowId) {
    if (e.button !== 0) return
    e.stopPropagation()
    pressRef.current = { rowId, sx: e.clientX, sy: e.clientY, moved: false }
    const el = e.currentTarget
    el.setPointerCapture?.(e.pointerId)
  }
  function hit(e) {
    const stack = document.elementsFromPoint(e.clientX, e.clientY)
    const col = stack.map(n => n.closest?.('[data-stage]')).find(n => n && n.closest('[data-pipeline]') === rootRef.current)
    if (!col) return null
    const stage = col.getAttribute('data-stage')
    /* Before the first card whose middle is below the pointer. */
    const cards = Array.from(col.querySelectorAll('[data-card]')).filter(c => c.getAttribute('data-card') !== pressRef.current?.rowId)
    let before = null
    for (const c of cards) { const r = c.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = c.getAttribute('data-card'); break } }
    return { stage, before }
  }
  function onCardMove(e) {
    const p = pressRef.current
    if (!p) return
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 4) return
    p.moved = true
    const h = hit(e)
    setDrag({ rowId: p.rowId, x: e.clientX, y: e.clientY, stage: h?.stage ?? null, before: h?.before ?? null })
  }
  function onCardUp(e) {
    const p = pressRef.current
    pressRef.current = null
    if (!p) return
    if (!p.moved) { setDrag(null); onOpenRecord?.(p.rowId); return }
    const h = hit(e)
    setDrag(null)
    if (h) onUpdateSource(moveRow(db, p.rowId, groupBy, h.stage, h.before))
  }

  function addCard() {
    const first = cols[0]
    const values = { [db.titlePropId]: '' }
    if (first && first.key !== '__none__') values[groupBy] = first.key
    const row = createRow(db, { values })
    onUpdateSource(addRow(db, row))
    onOpenRecord?.(row.id)
  }

  const draggedRow = drag && db.rows.find(r => r.id === drag.rowId)
  const shownCols = cols.filter(c => c.key !== '__none__' || c.count > 0 || drag)

  return (
    <div ref={rootRef} data-pipeline style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      onMouseDown={e => e.stopPropagation()}>
      {/* Settings row. Native selects: this is configuration, touched once. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: `1px solid ${border}`, fontSize: 12, color: text3, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Stages
          <select aria-label="Stages field" value={groupBy} onChange={e => onUpdateBlock({ groupBy: e.target.value })} style={selectStyle(colors)}>
            {selects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Sum
          <select aria-label="Value field" value={valueProp || ''} onChange={e => onUpdateBlock({ valueProp: e.target.value || null })} style={selectStyle(colors)}>
            <option value="">None</option>
            {numbers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--ds-font-mono)' }}>{db.name || 'Untitled'}</span>
        <button type="button" onClick={addCard} className="ds-tbtn" style={{ height: 26, padding: '0 10px' }}>
          <Icon name="action-add" size={12} /> New
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 10, padding: 10, overflowX: 'auto' }}>
        {shownCols.map(col => {
          const over = drag && drag.stage === col.key
          return (
            <div key={col.key} data-stage={col.key}
              style={{
                flex: '1 1 0', minWidth: 170, maxWidth: 280, minHeight: 0, display: 'flex', flexDirection: 'column',
                background: over ? accentDim : raised, border: `1.5px solid ${over ? accent : border}`,
                borderRadius: 10, padding: 8, transition: 'background .15s ease, border-color .15s ease',
              }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '2px 4px 8px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 650, letterSpacing: 0.5, textTransform: 'uppercase', color: text2, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone(col.color), flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
                  <span style={{ color: text3, fontWeight: 500 }}>{col.count}</span>
                </span>
                {col.sum !== null && <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text2, fontVariantNumeric: 'tabular-nums' }}>{fmt(col.sum)}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', minHeight: 24 }}>
                {col.rows.map(r => (
                  <div key={r.id}>
                    {over && drag.before === r.id && <DropLine accent={accent} />}
                    <div data-card={r.id}
                      onPointerDown={e => onCardDown(e, r.id)} onPointerMove={onCardMove} onPointerUp={onCardUp}
                      role="button" tabIndex={0} aria-label={`Open ${rowTitle(db, r)}`}
                      onKeyDown={e => { if (e.key === 'Enter') onOpenRecord?.(r.id) }}
                      style={{
                        background: surface, border: `1.5px solid ${openRowId === r.id ? accent : border}`, borderRadius: 8,
                        padding: '8px 9px', cursor: 'grab', opacity: drag?.rowId === r.id ? 0.35 : 1, userSelect: 'none',
                        touchAction: 'none',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <Avatar row={r} db={db} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rowTitle(db, r)}</span>
                      </div>
                      {(valueProp || dateProp) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 11, color: text3 }}>
                          <span>{dateProp && typeof r.values[dateProp] === 'number' ? new Date(r.values[dateProp]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span>
                          {valueProp && <span style={{ fontFamily: 'var(--ds-font-mono)', color: text2, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.values[valueProp])}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {over && drag.before === null && <DropLine accent={accent} />}
                {!col.rows.length && !over && <div style={{ fontSize: 11, color: text3, padding: '6px 4px' }}>Nothing here</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* The card under the pointer while dragging. Fixed and in screen space,
          so it is not scaled by the canvas zoom. */}
      {drag && draggedRow && (
        <div style={{
          position: 'fixed', left: drag.x + 10, top: drag.y + 8, zIndex: 2000, pointerEvents: 'none',
          background: surface, border: `1.5px solid ${accent}`, borderRadius: 8, padding: '6px 9px',
          fontSize: 12, fontWeight: 600, color: text, boxShadow: 'var(--ds-shadow-lg)', maxWidth: 220,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{rowTitle(db, draggedRow)}</div>
      )}
    </div>
  )
}

function DropLine({ accent }) {
  return <div aria-hidden="true" style={{ height: 2, margin: '1px 2px 5px', borderRadius: 4, background: accent, boxShadow: `0 0 0 3px color-mix(in srgb, ${accent} 22%, transparent)` }} />
}

export function Avatar({ row, db, size = 20 }) {
  const t = rowTitle(db, row)
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: 6, flexShrink: 0, display: 'grid', placeItems: 'center',
      background: tone(hashTone(row.id)), color: '#fff', fontSize: Math.round(size * 0.45), fontWeight: 650,
    }}>{initials(t)}</span>
  )
}

function Empty({ colors, title, body, children }) {
  return (
    <div onMouseDown={e => e.stopPropagation()} style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center' }}>
      <div style={{ maxWidth: 320 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{title}</div>
        <div style={{ fontSize: 12, color: colors.text3, marginTop: 4, lineHeight: 1.5 }}>{body}</div>
        {children && <div style={{ marginTop: 10 }}>{children}</div>}
      </div>
    </div>
  )
}

export function selectStyle(colors) {
  return {
    height: 26, padding: '0 6px', borderRadius: 6, border: `1px solid ${colors.border}`,
    background: colors.surface, color: colors.text2, fontFamily: 'var(--ds-font-body)', fontSize: 12,
  }
}

export default memo(PipelineBlockInner)
