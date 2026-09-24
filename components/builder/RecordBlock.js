'use client'
import { memo, useMemo, useState } from 'react'
import Icon from '../ui/Icon'
import { setCell, addActivity, rowTitle, pipelineOrder, updateProperty } from '../../lib/database'
import { relTime } from '../../lib/builder'
import { dayKey } from '../../lib/calendar'
import { Avatar, selectStyle } from './PipelineBlock'

/*
  components/builder/RecordBlock.js
  --------------------------------------------------------------------------
  Builder Phase 1 (24 Sep 2026). One row of a Database block, as a page:
  a header, highlight chips, every field editable in place, relationship chips,
  and an activity timeline with comments.

  Like the Pipeline it holds no data. `sourceId` + `rowId` point into a
  Database block; every edit is a new `db` handed to onUpdateDb(blockId, db).
  Stepping n-of-N, following a relationship chip, or picking from the Ctrl/⌘K
  palette RETARGETS this block (onRetarget) rather than opening another one,
  so a record never multiplies on the canvas.
  -------------------------------------------------------------------------- */

const tone = name => `var(--ds-${name || 'text-3'})`
const fmt = n => (typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '')

function RecordBlockInner({ block, source, databases, pipeline, colors, onUpdateDb, onRetarget }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const [tab, setTab] = useState('overview')
  const [draft, setDraft] = useState('')
  const db = source?.db || null
  const row = db?.rows.find(r => r.id === block.rowId) || null

  /* n-of-N: the pipeline's reading order when opened from one, the database's
     row order otherwise. */
  const order = useMemo(() => {
    if (!db) return []
    if (pipeline?.groupBy && pipeline.sourceId === source.id) return pipelineOrder(db, pipeline.groupBy)
    return db.rows.map(r => r.id)
  }, [db, pipeline, source])

  if (!db || !row) {
    return (
      <div onMouseDown={e => e.stopPropagation()} style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center', color: text3, fontSize: 12 }}>
        {!db ? 'The database this record came from was deleted.' : 'This row was deleted.'}
      </div>
    )
  }

  const write = next => onUpdateDb(source.id, next)
  const idx = order.indexOf(row.id)
  const step = d => { if (order.length) onRetarget({ rowId: order[(idx + d + order.length) % order.length] }) }

  const stageProp = db.properties.find(p => p.id === pipeline?.groupBy) || db.properties.find(p => p.type === 'select')
  const valueProp = db.properties.find(p => p.id === pipeline?.valueProp) || db.properties.find(p => p.type === 'number')
  const dateProp = db.properties.find(p => p.type === 'date')
  const stageOpt = stageProp ? (stageProp.options || []).find(o => o.id === row.values[stageProp.id]) : null
  const fields = db.properties.filter(p => p.id !== db.titlePropId)
  const activity = row.activity || []

  function sendComment() {
    const t = draft.trim()
    if (!t) return
    write(addActivity(db, row.id, { kind: 'comment', text: t }))
    setDraft('')
  }

  const chip = { flex: '1 1 90px', minWidth: 0, background: raised, border: `1px solid ${border}`, borderRadius: 8, padding: '6px 8px' }
  const chipLabel = { fontSize: 11, fontWeight: 650, letterSpacing: 0.6, textTransform: 'uppercase', color: text3, marginBottom: 2 }

  return (
    <div onMouseDown={e => e.stopPropagation()} style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* n-of-N */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: `1px solid ${border}`, fontSize: 11, color: text3 }}>
        <span style={{ fontFamily: 'var(--ds-font-mono)' }}>{idx + 1} of {order.length}</span>
        <span>in {pipeline ? (pipeline.name || 'Pipeline') : (source.name || db.name || 'database')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" aria-label="Previous record" onClick={() => step(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', ...navBtn(colors) }}>
          <Icon name="nav-chevron-down" size={12} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button type="button" aria-label="Next record" onClick={() => step(1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', ...navBtn(colors) }}>
          <Icon name="nav-chevron-down" size={12} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {/* Who */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Avatar row={row} db={db} size={34} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <input aria-label="Name" value={row.values[db.titlePropId] ?? ''} placeholder="Untitled"
              onChange={e => write(setCell(db, row.id, db.titlePropId, e.target.value))}
              style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', padding: 0, fontSize: 16, fontWeight: 650, color: text, fontFamily: 'var(--ds-font-body)' }} />
            <div style={{ fontSize: 11, color: text3 }}>{source.name || db.name || 'Database'}</div>
          </div>
        </div>

        {/* Highlights */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {stageProp && (
            <div style={chip}><div style={chipLabel}>{stageProp.name}</div>
              <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 16, background: stageOpt ? `color-mix(in srgb, ${tone(stageOpt.color)} 16%, transparent)` : 'transparent', color: stageOpt ? tone(stageOpt.color) : text3 }}>
                {stageOpt ? stageOpt.name : '—'}
              </span>
            </div>
          )}
          {valueProp && <div style={chip}><div style={chipLabel}>{valueProp.name}</div><div style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 12, color: text, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.values[valueProp.id]) || '—'}</div></div>}
          {dateProp && <div style={chip}><div style={chipLabel}>{dateProp.name}</div><div style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 12, color: text }}>{typeof row.values[dateProp.id] === 'number' ? dayKey(new Date(row.values[dateProp.id])) : '—'}</div></div>}
        </div>

        {/* Tabs */}
        <div role="tablist" style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${border}`, marginBottom: 10 }}>
          {[['overview', 'Overview'], ['activity', `Activity · ${activity.length}`]].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ds-font-body)', padding: '6px 8px', fontSize: 12, fontWeight: 600, color: tab === id ? text : text3, borderBottom: `2px solid ${tab === id ? accent : 'transparent'}`, marginBottom: -1 }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && fields.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: `1px solid ${border}` }}>
            <div style={{ width: 96, flexShrink: 0, fontSize: 12, color: text3, paddingTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{p.name}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FieldEditor db={db} row={row} prop={p} colors={colors} databases={databases} source={source}
                onWrite={raw => write(setCell(db, row.id, p.id, raw))}
                onSetTarget={target => write(updateProperty(db, p.id, { target }))}
                onOpen={(rowId, sourceId) => onRetarget(sourceId && sourceId !== source.id ? { rowId, sourceId, pipelineId: null } : { rowId })} />
            </div>
          </div>
        ))}
        {tab === 'overview' && !fields.length && <div style={{ fontSize: 12, color: text3 }}>This database has no fields besides the name yet.</div>}

        {tab === 'activity' && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <textarea aria-label="Add a note" rows={2} value={draft} placeholder="Add a note…"
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComment() } }}
                style={{ flex: 1, resize: 'none', padding: '7px 9px', borderRadius: 8, border: `1px solid ${border}`, background: surface, color: text, fontFamily: 'var(--ds-font-body)', fontSize: 12, outline: 'none' }} />
              <button type="button" onClick={sendComment} disabled={!draft.trim()} className="ds-tbtn" style={{ alignSelf: 'flex-start', opacity: draft.trim() ? 1 : 0.5 }}>Add</button>
            </div>
            {!activity.length && <div style={{ fontSize: 12, color: text3 }}>Nothing yet. Stage changes are logged here on their own.</div>}
            {activity.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 8, padding: '7px 0' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: a.kind === 'comment' ? accent : text3 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: a.kind === 'comment' ? text : text2, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.text}</div>
                  <div style={{ fontSize: 11, color: text3 }}>{[a.by, relTime(a.at)].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* One field, edited in place, by type. */
function FieldEditor({ db, row, prop, colors, databases, source, onWrite, onSetTarget, onOpen }) {
  const { surface, border, text, text3, accent } = colors
  const v = row.values[prop.id]
  const input = { width: '100%', border: `1px solid transparent`, borderRadius: 6, background: 'transparent', color: text, fontFamily: 'var(--ds-font-body)', fontSize: 12, padding: '4px 6px', outline: 'none' }
  const focus = e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.background = surface }
  const blur = e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent' }

  switch (prop.type) {
    case 'number':
      return <input aria-label={prop.name} inputMode="decimal" defaultValue={typeof v === 'number' ? v : ''} key={row.id + prop.id + v}
        onFocus={focus} onBlur={e => { blur(e); onWrite(e.target.value) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="Empty" style={{ ...input, fontFamily: 'var(--ds-font-mono)' }} />
    case 'date':
      return <input type="date" aria-label={prop.name} value={typeof v === 'number' ? dayKey(new Date(v)) : ''}
        onChange={e => onWrite(e.target.value)} style={{ ...input, fontFamily: 'var(--ds-font-mono)', color: typeof v === 'number' ? text : text3 }} />
    case 'checkbox':
      return <input type="checkbox" aria-label={prop.name} checked={v === true} onChange={e => onWrite(e.target.checked)} style={{ marginTop: 6, accentColor: accent }} />
    case 'select':
      return (
        <select aria-label={prop.name} value={v || ''} onChange={e => onWrite(e.target.value || null)} style={selectStyle(colors)}>
          <option value="">Empty</option>
          {(prop.options || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )
    case 'multi': {
      const on = new Set(Array.isArray(v) ? v : [])
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 2 }}>
          {(prop.options || []).map(o => (
            <button key={o.id} type="button" aria-pressed={on.has(o.id)}
              onClick={() => { const n = new Set(on); n.has(o.id) ? n.delete(o.id) : n.add(o.id); onWrite([...n]) }}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 16, border: `1px solid ${on.has(o.id) ? tone(o.color) : border}`, color: on.has(o.id) ? tone(o.color) : text3 }}>
              {o.name}
            </button>
          ))}
          {!prop.options?.length && <span style={{ fontSize: 12, color: text3, paddingTop: 2 }}>No options yet</span>}
        </div>
      )
    }
    case 'relation':
      return <RelationField db={db} row={row} prop={prop} colors={colors} databases={databases} source={source} onWrite={onWrite} onSetTarget={onSetTarget} onOpen={onOpen} />
    default:
      return <input aria-label={prop.name} defaultValue={v ?? ''} key={row.id + prop.id + v}
        type={prop.type === 'email' ? 'email' : prop.type === 'url' ? 'url' : 'text'}
        onFocus={focus} onBlur={e => { blur(e); if ((e.target.value || '') !== (v ?? '')) onWrite(e.target.value) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="Empty" style={input} />
  }
}

/* Relationship chips. The linked rows live in `prop.target` (another
   Database block on the sheet) or in this same database when it is null. */
function RelationField({ db, row, prop, colors, databases, source, onWrite, onSetTarget, onOpen }) {
  const { surface, border, text, text3, accent } = colors
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const targetBlock = prop.target ? databases.find(d => d.id === prop.target) : source
  const tdb = targetBlock?.db
  const ids = Array.isArray(row.values[prop.id]) ? row.values[prop.id] : []
  const linked = ids.map(id => tdb?.rows.find(r => r.id === id)).filter(Boolean)
  const candidates = tdb ? tdb.rows.filter(r => r.id !== row.id && !ids.includes(r.id) && rowTitle(tdb, r).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', paddingTop: 2 }}>
        {linked.map(r => (
          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 16, background: `color-mix(in srgb, ${accent} 14%, transparent)` }}>
            <button type="button" onClick={() => onOpen(r.id, targetBlock.id)} title={`Open ${rowTitle(tdb, r)}`}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ds-font-body)', fontSize: 11, fontWeight: 600, color: accent, padding: '2px 4px 2px 8px' }}>{rowTitle(tdb, r)} ↗</button>
            <button type="button" aria-label={`Unlink ${rowTitle(tdb, r)}`} onClick={() => onWrite(ids.filter(x => x !== r.id))}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ds-font-body)', fontSize: 11, color: accent, padding: '2px 7px 2px 2px', opacity: 0.7 }}>×</button>
          </span>
        ))}
        {!targetBlock && <span style={{ fontSize: 12, color: text3 }}>The linked database was deleted</span>}
        {targetBlock && (
          <button type="button" onClick={() => setPicking(p => !p)} aria-expanded={picking}
            style={{ fontSize: 11, color: text3, padding: '2px 6px', borderRadius: 16, border: `1px dashed ${border}`, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ds-font-body)' }}>+ Link</button>
        )}
        {/* Where links point: set while nothing is linked yet, so a switch
            can never strand existing links in the wrong database. */}
        {!ids.length && databases.length > 1 && (
          <select aria-label="Links to" value={prop.target || ''} onChange={e => onSetTarget(e.target.value || null)} style={{ ...selectStyle(colors), height: 22, fontSize: 11 }}>
            <option value="">in this database</option>
            {databases.filter(d => d.id !== source.id).map(d => <option key={d.id} value={d.id}>in {d.label}</option>)}
          </select>
        )}
      </div>
      {picking && tdb && (
        <div style={{ marginTop: 6, border: `1px solid ${border}`, borderRadius: 8, background: surface, padding: 4 }}>
          <input autoFocus aria-label="Find a row" value={q} onChange={e => setQ(e.target.value)} placeholder={`Find in ${targetBlock.name || tdb.name || 'database'}…`}
            onKeyDown={e => { if (e.key === 'Escape') setPicking(false); if (e.key === 'Enter' && candidates[0]) { onWrite([...ids, candidates[0].id]); setQ('') } }}
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', color: text, fontSize: 12, padding: '4px 6px', fontFamily: 'var(--ds-font-body)' }} />
          {candidates.map(r => (
            <button key={r.id} type="button" onClick={() => { onWrite([...ids, r.id]); setQ('') }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ds-font-body)', display: 'block', width: '100%', textAlign: 'left', fontSize: 12, color: text, padding: '5px 6px', borderRadius: 6 }}
              onMouseEnter={e => { e.currentTarget.style.background = colors.raised }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              {rowTitle(tdb, r)}
            </button>
          ))}
          {!candidates.length && <div style={{ fontSize: 11, color: text3, padding: '4px 6px' }}>No matching rows</div>}
        </div>
      )}
    </div>
  )
}

const navBtn = c => ({ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', color: c.text2 })

export default memo(RecordBlockInner)
