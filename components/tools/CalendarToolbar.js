'use client'
import Icon from '../ui/Icon'

/*
  components/tools/CalendarToolbar.js
  --------------------------------------------------------------------------
  Which sources a calendar reads from.

  The whole feature is "point this at something dated". So the rail's real job
  is one list: every table in the sheet that has a column looking like dates,
  offered as a toggle. That's the interaction from the original note — a
  Customers table with a renewal date becomes a calendar with no data entry.

  Tables with no date-shaped column are listed and disabled rather than
  hidden: "why isn't my table here" is a worse question than "oh, that column
  isn't dates".
  -------------------------------------------------------------------------- */

import { parseDate } from '../../lib/tasks'

/**
 * Columns that look like dates.
 * Sampled rather than exhaustive: a 5,000-row table shouldn't be walked to
 * populate a menu. A column counts if most of its non-empty sample parses.
 */
export function dateColumns(block, sample = 25) {
  if (block?.type !== 'table') return []
  const headers = block.headers || []
  const rows = (block.rows || []).slice(0, sample)
  const out = []
  for (let c = 0; c < headers.length; c++) {
    let filled = 0, dated = 0
    for (const r of rows) {
      const v = r?.[c]
      if (v === undefined || v === null || String(v).trim() === '') continue
      filled++
      if (parseDate(v) !== null) dated++
    }
    if (filled > 0 && dated / filled >= 0.6) {
      out.push({ index: c, name: headers[c] || `Column ${c + 1}`, confidence: dated / filled })
    }
  }
  return out
}

/* One height for every control in the column, like SheetToolbar. The rail had
   28px source toggles above 24px column rows above nothing at all, so the
   stack had no rhythm and the two kinds of row read as unrelated rather than
   as a heading and its items. */
const ROW_H = 28
const GROUP_GAP = 14

export default function CalendarToolbar({ block, blocks, dark, colors, onUpdateBlock }) {
  if (!block) return null
  const { surface, border, text2, text3 } = colors

  const sources = block.sources?.length ? block.sources : [{ kind: 'tasks' }]
  const hasTasks = sources.some(s => s.kind === 'tasks')
  const tables = (blocks || []).filter(b => b.type === 'table')

  const setSources = next => onUpdateBlock(block.id, { sources: next })

  const toggleTasks = () => setSources(
    hasTasks ? sources.filter(s => s.kind !== 'tasks') : [...sources, { kind: 'tasks' }]
  )

  const toggleTable = (tbl, col) => {
    const existing = sources.find(s => s.kind === 'table' && s.blockId === tbl.id)
    if (existing && existing.dateCol === col.index) {
      setSources(sources.filter(s => s !== existing))
    } else {
      const without = sources.filter(s => !(s.kind === 'table' && s.blockId === tbl.id))
      /* The title column is guessed as the first column that ISN'T the date.
         Wrong occasionally, obvious when it is, and it saves a second picker
         on the most common shape of table by far. */
      const titleCol = (tbl.headers || []).findIndex((_, i) => i !== col.index)
      setSources([...without, {
        kind: 'table', blockId: tbl.id,
        dateCol: col.index, titleCol: titleCol < 0 ? col.index : titleCol,
      }])
    }
  }

  return (
    <div
      data-island-rail
      data-kbd-zone
      style={{
        position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
        zIndex: 96, width: 178,
        display: 'flex', flexDirection: 'column', gap: 3, padding: 8,
        maxHeight: 'calc(100% - 120px)', overflowY: 'auto',
        background: `${surface}dd`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
        fontFamily: 'var(--ds-font-body)',
        animation: 'dsRailIn 0.18s cubic-bezier(.34,1.3,.64,1)',
      }}>
      <style>{`
        @keyframes dsRailIn {
          from { opacity: 0; transform: translateY(-50%) translateX(8px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
      `}</style>

      <div style={{
        fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase',
        letterSpacing: 0.9, color: text3,
        padding: '2px 6px 7px', borderBottom: `1px solid ${border}`, marginBottom: 3,
      }}>
        Calendar
      </div>

      <Label colors={colors}>Sources</Label>

      <button onClick={toggleTasks} aria-pressed={hasTasks}
        title="Every task with a deadline"
        className={`ds-tbtn${hasTasks ? ' is-on' : ''}`}
        style={{ width: '100%', height: ROW_H, padding: '0 9px', fontSize: 'var(--ds-fs-sm)', justifyContent: 'flex-start' }}>
        <Icon name="text-checklist" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>Task deadlines</span>
        {hasTasks && <Icon name="action-check" size={12} />}
      </button>

      {/* Manual events: lib/calendar.js already resolves them and the block
          already stores them, but nothing here can create one. Declared and
          disabled rather than absent, the way SheetToolbar declares Simulate
          and Statistics — a rail that names what's coming is a roadmap, an
          empty one is just a stub. */}
      <button disabled title="Type an event straight into the calendar — not built yet"
        className="ds-tbtn"
        style={{
          width: '100%', height: ROW_H, padding: '0 9px', fontSize: 'var(--ds-fs-sm)',
          justifyContent: 'flex-start', opacity: 0.38, cursor: 'not-allowed',
        }}>
        <Icon name="action-add" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>Own events</span>
        <span style={{
          fontSize: 7.5, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.4,
          color: text3, border: `1px solid ${border}`,
          borderRadius: 3, padding: '1px 3px', flexShrink: 0,
        }}>SOON</span>
      </button>

      {tables.length === 0 && (
        <div style={{ fontSize: 'var(--ds-fs-xs)', color: text3, lineHeight: 1.55, padding: '7px 3px 3px' }}>
          No tables on this sheet yet. Import a spreadsheet with a date column
          and it can feed this calendar.
        </div>
      )}

      {tables.map(tbl => {
        const cols = dateColumns(tbl)
        const active = sources.find(s => s.kind === 'table' && s.blockId === tbl.id)
        return (
          <div key={tbl.id} style={{ marginTop: GROUP_GAP }}>
            {/* The table name is the GROUP and the columns are its items, so
                the name gets the rail's own caption treatment. It used to be
                9.5px body text one step above the 10px rows under it, which
                made a heading and its contents look like siblings. */}
            <Label colors={colors} style={{ color: text2, padding: '0 2px 4px' }}>
              <span title={tbl.name || 'Untitled table'} style={{
                display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {tbl.name || 'Untitled table'}
              </span>
            </Label>
            {cols.length === 0 ? (
              <div style={{ fontSize: 'var(--ds-fs-xs)', color: text3, padding: '0 3px', lineHeight: 1.5 }}>
                No date column found.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {cols.map(col => {
                  const on = active?.dateCol === col.index
                  return (
                    <button key={col.index} onClick={() => toggleTable(tbl, col)} aria-pressed={on}
                      title={`Use "${col.name}" as the date`}
                      className={`ds-tbtn${on ? ' is-on' : ''}`}
                      style={{
                        width: '100%', height: ROW_H, padding: '0 9px',
                        fontSize: 'var(--ds-fs-sm)', justifyContent: 'flex-start',
                      }}>
                      <Icon name="block-table" size={13} />
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {col.name}
                      </span>
                      {on && <Icon name="action-check" size={12} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <div style={{
        marginTop: 10, paddingTop: 8, borderTop: `1px solid ${border}`,
        fontSize: 'var(--ds-fs-xs)', lineHeight: 1.55, color: text3, display: 'flex', gap: 6,
      }}>
        <Icon name="status-info" size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Click any event to jump to where its information lives.</span>
      </div>
    </div>
  )
}

function Label({ children, colors, style }) {
  return (
    <div style={{
      fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.9,
      textTransform: 'uppercase', color: colors.text3, padding: '0 2px 4px', ...style,
    }}>
      {children}
    </div>
  )
}
