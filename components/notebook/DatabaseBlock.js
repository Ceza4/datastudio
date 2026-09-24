'use client'
import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { useToast } from '../ui/Toast'
import {
  PROPERTY_TYPES, PROPERTY_TYPE_IDS, OPTION_COLORS, VIEW_KINDS, FILTER_OPS,
  createDatabase, createProperty, createOption, createRow, createView,
  addProperty, removeProperty, changePropertyType, addOption, removeOption,
  addRow, removeRow, setCell, coerceValue,
  resolveView, activeView, addView, updateView, removeView,
  rowTitle, describeDatabase, isGroupable,
} from '../../lib/database'
import {
  monthGrid, dayKey, weekdayLabels, monthTitle, addMonths, isToday,
  WEEK_START_MONDAY, msUntilNextLocalMidnight,
} from '../../lib/calendar'
import { Z } from '../../lib/theme'

/*
  components/notebook/DatabaseBlock.js
  --------------------------------------------------------------------------
  §9.2 Builder — the database block, on the canvas.

    "They create a database called Companies, another called Contacts, another
     called Deals […] DataStudio can present the same information in different
     ways: as a table, kanban board, calendar, dashboard, or cards."

  ── THIS FILE OWNS NO DATA ──────────────────────────────────────────────

  Every question about what the rows ARE is answered by lib/database.js, and
  every answer arrives through ONE call:

      const { rows, groups } = resolveView(db, view)

  Filter, then sort, then group — in that order, once, for all four views. A
  view here is a renderer over that result and nothing else. The moment a view
  starts doing its own filtering, the board and the table disagree about which
  rows exist, and there is no way to tell which one is lying.

  The same applies in the other direction: every write goes through `setCell`,
  `addProperty`, `removeOption` and friends. Nothing here assigns into
  `row.values`. That is not fastidiousness — coercion lives in `coerceValue`,
  so one careless `values[id] = e.target.value` puts the string "12abc" in a
  number column, and every sort that touches it afterwards is wrong in a way
  no error message will ever mention.

  ── WHAT'S DELIBERATELY NOT HERE ────────────────────────────────────────

  RELATIONSHIP EDITING. `relation` is a property type since Builder Phase 1
  (24 Sep 2026; model in lib/database.js). The grid only shows a count
  ("2 linked"); linking and unlinking happen on the Record block, which can
  show the linked rows' names as chips. Two editors for the same list of ids
  would be two places to get the dedupe and the target switch wrong.

  ── THREE RULES THIS FILE IS ONE BAD EDIT AWAY FROM BREAKING ────────────

  1  NO HARDCODED COLOUR. Option colours are stored as token NAMES
     ('accent', 'amber', …) precisely so a chip cannot be invisible in the
     theme it was not picked in. `optionColor` below is the only place they
     resolve, against the live `colors` object.

  2  ANYTHING FLOATING IS PORTALLED. The canvas renders inside
     `transform: translate() scale()`, which makes itself the containing block
     for `position: fixed` descendants — a menu positioned at the pointer
     appears somewhere else entirely, and then scaled. Every dropdown here
     goes through <Popover>, which portals to document.body.
     `npm run check:geom` enforces it.

  3  AN INPUT OPENED FROM A CLICK NEEDS preventDefault ON THE OPENING
     POINTERDOWN — and, because of that, the cell it replaced can no longer
     rely on being blurred. Both halves are explained at `openOnPointerDown`
     and at `takePending`. Getting the first right and forgetting the second
     is how you build a grid that quietly eats the last thing you typed.
  -------------------------------------------------------------------------- */

/* A database block always ships with a `db` — blockRegistry builds one. But
   "always" is exactly the data that arrives from an older build, a partial
   write or a hand-edited export, and `db.properties.map` on undefined replaces
   the whole block with an error card. Built once at module scope rather than
   per render: `createDatabase` mints ids, so calling it during a render would
   hand React a different database every frame. */
const FALLBACK_DB = createDatabase({ name: 'Untitled' })

/* Option colours are token NAMES, never hex. Resolved here, against the live
   theme, because this is the only layer that has one — a '#4ade80' written
   into a document is invisible in whichever theme it was not picked in. */
function optionColor(name, colors) {
  const map = {
    accent: colors.accent, green: colors.green, amber: colors.amber,
    red: colors.red, 'text-2': colors.text2, 'text-3': colors.text3,
  }
  return map[name] || colors.text2
}

/* Which filter operators make sense for which type, and what to call them.
   Intersected with FILTER_OPS at use, so an operator renamed in the model can
   never leave a control here offering an id `applyFilters` does not know — it
   answers an unknown op by showing EVERY row, which reads as the filter having
   been ignored rather than as a bug. */
const OP_LABEL = {
  is: 'is', isNot: 'is not', contains: 'contains', notContains: 'excludes',
  isEmpty: 'is empty', isNotEmpty: 'is not empty', gt: 'more than', lt: 'less than',
  hasOption: 'has',
}
const OPS_BY_TYPE = {
  text: ['contains', 'notContains', 'is', 'isNot', 'isEmpty', 'isNotEmpty'],
  number: ['is', 'gt', 'lt', 'isEmpty', 'isNotEmpty'],
  date: ['is', 'gt', 'lt', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  multi: ['hasOption', 'isEmpty', 'isNotEmpty'],
  checkbox: ['is'],
  /* A relation is a list of row ids; only emptiness is meaningful here. */
  relation: ['isEmpty', 'isNotEmpty'],
}
const opsFor = type => (OPS_BY_TYPE[type] || OPS_BY_TYPE.text).filter(op => op in FILTER_OPS)
const opNeedsValue = op => op !== 'isEmpty' && op !== 'isNotEmpty'

const ROW_H = 30
const TITLE_COL_W = 190
const COL_W = 150
const GUTTER_W = 34
const colWidth = p => (p.type === 'title' ? TITLE_COL_W : COL_W)

/* A portalled menu's anchor, in SCREEN space.
   -------------------------------------------------------------------------
   getBoundingClientRect() returns the VISUALLY SCALED box, which is wrong for
   pointer maths inside the canvas — that is what lib/canvasgeom.js exists for
   — and exactly right here: the menu leaves the transformed subtree entirely,
   so it lives in the same screen space this rect is measured in. At 40% zoom
   the header cell is DRAWN small, and the menu has to appear over where it is
   drawn, not over where it would be at zoom 1. */
const anchorOf = el => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.bottom + 5 }
}

/**
 * The opening half of a click that reveals an input.
 *
 * Without the preventDefault: pointerdown opens the editor, autoFocus takes
 * focus, and then mousedown's DEFAULT focus behaviour moves focus back to
 * whatever was pressed — the input is blurred shut inside the same click, and
 * it looks exactly like the cell doing nothing. That bug shipped once, in the
 * PDF text editor; tests/browser/run.mjs documents the four-event sequence.
 */
const openOnPointerDown = handler => e => {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  handler(e)
}

/* ── the block ───────────────────────────────────────────────────────── */


/* memo, because this component is a child of NotebookCanvas and NotebookCanvas
   re-renders on every frame of a pan or a zoom. Without it, dragging the canvas
   re-rendered every block on screen sixty times a second; with it, React bails
   out at this boundary and the frame costs nothing but the transform.

   A plain shallow compare is enough because every prop it receives is stable by
   construction: `colors` is one of two frozen module objects (lib/theme.js),
   handlers are cached per block id by blockCb() in NotebookCanvas, and `block`
   only changes identity when the block actually changes. */
function DatabaseBlockInner({ block, colors, dark, onUpdateBlock, editingRef }) {
  const { surface, border, text3, accent, accentText } = colors
  const toast = useToast()

  const db = block?.db?.properties?.length ? block.db : FALLBACK_DB
  const view = activeView(db)

  /* One cell open at a time — { rowId, propId }. A grid where two cells can be
     open at once has to decide which one Enter commits, and there is no answer
     to that anybody would guess right. */
  const [editing, setEditing] = useState(null)
  /* One menu at a time, for the same reason. { kind, at, … } */
  const [menu, setMenu] = useState(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  /* What is typed but not yet written down. See takePending. */
  const pending = useRef(null)

  const resolved = useMemo(() => resolveView(db, view), [db, view])

  /* The canvas owns Delete, Escape and the bare-key block shortcuts, and it
     stands down while something inside a block is being edited. Without this,
     typing "t" into a cell creates a table block and Delete removes the whole
     database. SheetGrid holds the same ref for the same reason.

     Cleared on unmount as well as on change: a ref left reading `true` after
     the block is gone disables the canvas keymap for the rest of the session,
     and nothing about that failure points back here. */
  const busy = !!editing || !!menu
  useEffect(() => {
    if (!editingRef) return undefined
    editingRef.current = busy
    return () => { editingRef.current = false }
  }, [busy, editingRef])

  const commit = next => onUpdateBlock?.(block.id, { db: next })

  const hidden = view?.hidden || []
  const props = db.properties.filter(p => !hidden.includes(p.id))

  /**
   * Fold whatever is half-typed into a database, and forget it.
   *
   * The rule above — preventDefault on the pointerdown that opens an input —
   * has a consequence that is easy to miss: with no mousedown, focus never
   * moves, so clicking straight from one cell into another does NOT blur the
   * first one. React then unmounts that input, and a node removed while
   * focused does not reliably deliver a blur. The last thing typed disappears,
   * silently, and only when you move between cells quickly.
   *
   * So the open editor reports every keystroke into `pending` (a ref — no
   * re-render, no write per character), and every action that could replace it
   * folds that draft in FIRST, against the database it is holding right now.
   * Committing from inside the dying editor instead would use the `db` it
   * captured, which is one edit stale exactly when it matters.
   */
  function takePending(base) {
    const p = pending.current
    pending.current = null
    return p ? setCell(base, p.rowId, p.propId, p.value) : base
  }
  /** Flush, then do something else with the result. */
  function withPending(fn) {
    const next = takePending(db)
    const out = fn(next)
    commit(out === undefined ? next : out)
  }

  const write = (rowId, propId, raw) => { pending.current = null; commit(setCell(db, rowId, propId, raw)) }

  function openCell(target) {
    const next = takePending(db)
    if (next !== db) commit(next)
    setEditing(target)
  }
  function closeCell(save) {
    if (!save) pending.current = null
    const next = takePending(db)
    if (next !== db) commit(next)
    setEditing(null)
  }
  /* Menus are opened the same way. A select dropdown does not blur the text
     cell that was open either — same preventDefault, same consequence. */
  function openMenu(next) {
    const folded = takePending(db)
    if (folded !== db) commit(folded)
    setEditing(null)
    setMenu(next)
  }

  /* ── schema and row edits ───────────────────────────────────────────── */

  function newRow(values) {
    const base = takePending(db)
    const row = createRow(base, { values: values || {} })
    commit(addRow(base, row))
    /* Opened on its title immediately. A row that appears empty and waits to
       be clicked is one gesture too many for the thing you do most. */
    setEditing({ rowId: row.id, propId: base.titlePropId })
  }

  function newColumn(at) {
    const base = takePending(db)
    const prop = createProperty({ name: 'Property', type: 'text' })
    commit(addProperty(base, prop))
    setEditing(null)
    /* Straight into the editor: a column called "Property" of type Text is
       never what was wanted, and naming it later means finding it again. */
    setMenu({ kind: 'prop', propId: prop.id, at })
  }

  /* Deletes do not ask. They delete and offer the way back — the argument is
     in components/ui/Toast.js, and it is why ConfirmDialog is reserved for
     what undo cannot reach.

     The snapshot is the whole `db` rather than an inverse of removeProperty.
     Putting a property back means restoring the column, its value in every
     row, and every view groupBy/sortBy/filter/hidden entry that named it —
     re-deriving all of that is how you get an undo that half-works. The cost
     is that undo also reverts anything else done in the seven seconds the
     toast is up, which is the same trade KanbanBlock's lane delete makes. */
  function deleteProperty(prop) {
    const before = db
    commit(removeProperty(db, prop.id))
    setMenu(null)
    toast(`Property “${prop.name}” deleted`, { undo: () => commit(before) })
  }

  function deleteOption(prop, option) {
    const before = db
    commit(removeOption(db, prop.id, option.id))
    toast(`Option “${option.name}” deleted`, { undo: () => commit(before) })
  }

  function deleteRow(row) {
    const before = db
    pending.current = null
    commit(removeRow(db, row.id))
    setEditing(null)
    toast(`“${rowTitle(db, row)}” deleted`, { undo: () => commit(before) })
  }

  /* ── views ──────────────────────────────────────────────────────────── */

  function selectView(v) {
    withPending(base => ({ ...base, activeViewId: v.id }))
    setEditing(null)
  }

  function newView(kind) {
    withPending(base => {
      const v = createView(base, { kind })
      return { ...addView(base, v), activeViewId: v.id }
    })
    setMenu(null)
  }

  const patchView = patch => commit(updateView(db, view.id, patch))

  const shared = {
    db, view, colors, dark, editing,
    onOpenCell: openCell, onCloseCell: closeCell, onDraft: (rowId, propId, value) => { pending.current = { rowId, propId, value } },
    onWrite: write, openMenu,
  }

  return (
    <div
      data-ds-db={block?.id}
      style={{
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
        background: surface, fontFamily: 'var(--ds-font-body)',
      }}>

      <ViewBar
        db={db} view={view} colors={colors} onSelect={selectView} onOpenMenu={openMenu}
        sortCount={view?.sortBy ? 1 : 0} filterCount={(view?.filters || []).length}
      />

      <div
        data-ds-db-view={view?.kind || 'table'}
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {view?.kind === 'board' ? (
          <BoardView {...shared} groups={resolved.groups} rows={resolved.rows} onAddRow={newRow} />
        ) : view?.kind === 'gallery' ? (
          <GalleryView {...shared} rows={resolved.rows} onAddRow={newRow} />
        ) : view?.kind === 'calendar' ? (
          <CalendarView {...shared} rows={resolved.rows} />
        ) : (
          <TableView
            {...shared} rows={resolved.rows} props={props}
            onAddRow={newRow} onAddColumn={newColumn} onDeleteRow={deleteRow}
          />
        )}
      </div>

      {/* The summary the model already knows how to phrase, in the mono face
          because it is a count. */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderTop: `1px solid ${border}`,
        fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xs)',
        color: text3, letterSpacing: 0.3,
      }}>
        <span>{describeDatabase(db)}</span>
        {resolved.rows.length !== db.rows.length && (
          <span style={{ color: accentText }}>· {resolved.rows.length} shown</span>
        )}
      </div>

      {/* ── the floating layer ──
          One menu at a time, every one of them portalled. */}
      {menu?.kind === 'prop' && (
        <PropertyMenu
          db={db} propId={menu.propId} at={menu.at} colors={colors} dark={dark}
          onClose={closeMenu}
          onRename={(p, name) => commit({ ...db, properties: db.properties.map(x => (x.id === p.id ? { ...x, name } : x)) })}
          onRetype={(p, type) => commit(changePropertyType(db, p.id, type))}
          onAddOption={(p, name) => commit(addOption(db, p.id, createOption({
            name,
            /* Cycled by position, so a fresh set of options is legible rather
               than six shades of the same accent. */
            color: OPTION_COLORS[(p.options || []).length % OPTION_COLORS.length],
          })))}
          onRemoveOption={deleteOption}
          onDelete={deleteProperty}
        />
      )}
      {menu?.kind === 'cellSelect' && (
        <SelectMenu
          db={db} rowId={menu.rowId} propId={menu.propId} at={menu.at}
          colors={colors} dark={dark} onClose={closeMenu} onWrite={write}
        />
      )}
      {menu?.kind === 'addView' && (
        <AddViewMenu at={menu.at} colors={colors} dark={dark} onClose={closeMenu} onPick={newView} />
      )}
      {menu?.kind === 'view' && (
        <ViewMenu
          db={db} view={view} at={menu.at} colors={colors} dark={dark}
          onClose={closeMenu} onPatch={patchView}
          onDelete={() => {
            const before = db
            const name = view.name
            const after = removeView(db, view.id)
            setMenu(null)
            if (after === db) return          // the last view; the model refused
            commit(after)
            toast(`View “${name}” deleted`, { undo: () => commit(before) })
          }}
        />
      )}
      {menu?.kind === 'sort' && (
        <SortMenu db={db} view={view} at={menu.at} colors={colors} dark={dark}
          onClose={closeMenu} onPatch={patchView} />
      )}
      {menu?.kind === 'filter' && (
        <FilterMenu db={db} view={view} at={menu.at} colors={colors} dark={dark}
          onClose={closeMenu} onPatch={patchView} />
      )}
    </div>
  )
}

/* ── view bar ────────────────────────────────────────────────────────── */

function ViewBar({ db, view, colors, onSelect, onOpenMenu, sortCount, filterCount }) {
  const { raised, border, text3, accent, accentText, accentDim } = colors
  return (
    <div style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 8px', borderBottom: `1px solid ${border}`,
    }}>
      {/* One track, several positions — the same segmented control the
          calendar block uses, so switching a view reads like the same gesture
          wherever you meet it. */}
      <div style={{
        display: 'flex', gap: 2, padding: 2, minWidth: 0, overflowX: 'auto',
        background: raised, border: `1px solid ${border}`, borderRadius: 'var(--ds-radius-md)',
      }}>
        {db.views.map(v => {
          const on = v.id === view?.id
          return (
            <button key={v.id}
              data-ds-db-viewchip={v.id}
              aria-pressed={on}
              title={on ? `${v.name} — click again for view options` : `Switch to ${v.name}`}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                if (on) onOpenMenu({ kind: 'view', at: anchorOf(e.currentTarget) })
                else onSelect(v)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                height: 21, padding: '0 8px', cursor: 'pointer',
                border: 'none', borderRadius: 'var(--ds-radius-sm)',
                background: on ? accentDim : 'transparent',
                color: on ? accent : text3,
                fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-sm)',
                fontWeight: on ? 600 : 500, lineHeight: 1, whiteSpace: 'nowrap',
                transition: 'background var(--ds-transition), color var(--ds-transition)',
              }}>
              <Icon name={VIEW_KINDS[v.kind]?.icon || 'block-table'} size={12} />
              {v.name}
            </button>
          )
        })}
      </div>

      <button
        data-ds-db-addview
        aria-label="Add a view"
        title="Add a view"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onOpenMenu({ kind: 'addView', at: anchorOf(e.currentTarget) }) }}
        style={{
          width: 22, height: 22, flexShrink: 0, padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: `1px dashed ${border}`,
          borderRadius: 'var(--ds-radius-sm)', color: text3,
          transition: 'color var(--ds-transition), border-color var(--ds-transition)',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = accent; e.currentTarget.style.borderColor = accent }}
        onMouseLeave={e => { e.currentTarget.style.color = text3; e.currentTarget.style.borderColor = border }}>
        <Icon name="action-add" size={12} />
      </button>

      <span style={{ flex: 1 }} />

      <BarBtn label="Sort" icon={sortCount ? 'grid-sort-asc' : 'grid-sort-desc'} count={sortCount}
        colors={colors} onClick={e => onOpenMenu({ kind: 'sort', at: anchorOf(e.currentTarget) })} />
      <BarBtn label="Filter" icon="nav-search" count={filterCount}
        colors={colors} onClick={e => onOpenMenu({ kind: 'filter', at: anchorOf(e.currentTarget) })} />
    </div>
  )
}

function BarBtn({ label, icon, count, colors, onClick }) {
  const { raised, text2, accent, accentText, accentDim } = colors
  const on = count > 0
  return (
    <button
      data-ds-db-bar={label.toLowerCase()}
      title={on ? `${label} — ${count} active` : label}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick(e) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        height: 22, padding: '0 8px', cursor: 'pointer',
        border: '1px solid transparent', borderRadius: 'var(--ds-radius-sm)',
        background: on ? accentDim : 'transparent',
        color: on ? accent : text2,
        fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-sm)', lineHeight: 1,
        transition: 'background var(--ds-transition), color var(--ds-transition)',
      }}
      onMouseEnter={e => { if (!on) e.currentTarget.style.background = raised }}
      onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>
      <Icon name={icon} size={12} />
      {label}
      {on && (
        <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xs)', fontWeight: 600 }}>
          {count}
        </span>
      )}
    </button>
  )
}

/* ── table ───────────────────────────────────────────────────────────── */

function TableView({
  db, view, rows, props, colors, editing,
  onOpenCell, onCloseCell, onDraft, onWrite, openMenu,
  onAddRow, onAddColumn, onDeleteRow,
}) {
  const { raised, border, text2, text3, accent, accentText, red } = colors
  const template = `${props.map(p => `${colWidth(p)}px`).join(' ')} ${GUTTER_W}px`

  return (
    <div style={{ minWidth: 'max-content' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: template,
        position: 'sticky', top: 0, zIndex: 2,
        background: raised, borderBottom: `1px solid ${border}`,
      }}>
        {props.map(p => (
          <button key={p.id}
            data-ds-db-col={p.id}
            title={`${p.name} · ${PROPERTY_TYPES[p.type]?.label || p.type} — click to edit this column`}
            /* Opened on POINTERDOWN with preventDefault, because the panel
               autofocuses a name input. See openOnPointerDown. */
            onPointerDown={openOnPointerDown(e =>
              openMenu({ kind: 'prop', propId: p.id, at: anchorOf(e.currentTarget) }))}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              height: ROW_H, padding: '0 8px', minWidth: 0, cursor: 'pointer',
              background: 'transparent', border: 'none',
              borderRight: `1px solid ${border}`,
              color: text2, fontFamily: 'var(--ds-font-body)',
              fontSize: 'var(--ds-fs-sm)', fontWeight: 600, textAlign: 'left',
              transition: 'color var(--ds-transition)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = accent }}
            onMouseLeave={e => { e.currentTarget.style.color = text2 }}>
            <Icon name={PROPERTY_TYPES[p.type]?.icon || 'nav-notebook'} size={12}
              style={{ color: text3, flexShrink: 0 }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
            </span>
            {view?.sortBy?.propId === p.id && (
              <Icon name={view.sortBy.desc ? 'grid-sort-desc' : 'grid-sort-asc'} size={12}
                style={{ color: accentText, flexShrink: 0, marginLeft: 'auto' }} />
            )}
          </button>
        ))}

        <button
          data-ds-db-addcol
          aria-label="Add a column"
          title="Add a column"
          onPointerDown={openOnPointerDown(e => onAddColumn(anchorOf(e.currentTarget)))}
          style={{
            height: ROW_H, cursor: 'pointer', background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: text3,
            transition: 'color var(--ds-transition)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = accent }}
          onMouseLeave={e => { e.currentTarget.style.color = text3 }}>
          <Icon name="action-add" size={12} />
        </button>
      </div>

      {rows.map(row => (
        <div key={row.id} data-ds-db-row={row.id} style={{
          display: 'grid', gridTemplateColumns: template,
          borderBottom: `1px solid ${border}`,
        }}>
          {props.map(p => (
            <Cell key={p.id}
              row={row} prop={p} colors={colors}
              editing={editing?.rowId === row.id && editing?.propId === p.id}
              onOpen={at => (p.type === 'select' || p.type === 'multi'
                ? openMenu({ kind: 'cellSelect', rowId: row.id, propId: p.id, at })
                : onOpenCell({ rowId: row.id, propId: p.id }))}
              onClose={onCloseCell}
              onDraft={v => onDraft(row.id, p.id, v)}
              onWrite={raw => onWrite(row.id, p.id, raw)}
            />
          ))}
          <button
            data-ds-db-delrow={row.id}
            aria-label="Delete row"
            title="Delete row"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDeleteRow(row) }}
            style={{
              height: ROW_H, cursor: 'pointer', background: 'transparent', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: text3, opacity: 0.35,
              transition: 'opacity var(--ds-transition), color var(--ds-transition)',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = red }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.35'; e.currentTarget.style.color = text3 }}>
            <Icon name="action-delete" size={12} />
          </button>
        </div>
      ))}

      <button
        data-ds-db-addrow
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onAddRow() }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          height: ROW_H, padding: '0 9px', cursor: 'pointer',
          background: 'transparent', border: 'none',
          color: text3, fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-md)',
          textAlign: 'left', transition: 'color var(--ds-transition), background var(--ds-transition)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = accent }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text3 }}>
        <Icon name="action-add" size={12} />
        New row
      </button>

      {rows.length === 0 && db.rows.length > 0 && (
        <Empty colors={colors} icon="nav-search"
          title="Nothing matches this filter"
          body={`All ${db.rows.length} rows are still here — the filter on this view is hiding them.`} />
      )}
    </div>
  )
}

/* ── cells ───────────────────────────────────────────────────────────── */

/**
 * One cell, dispatched on its property's TYPE — which is the whole difference
 * between a database and a spreadsheet: the column decides how the value is
 * parsed, rendered and edited, not whatever happened to be typed into it.
 *
 * Every write leaves through `onWrite`, which is `setCell`. Nothing here
 * touches `row.values`.
 */
function Cell({ row, prop, colors, editing, onOpen, onClose, onDraft, onWrite }) {
  const { border, text, text3, accent, accentText } = colors
  const value = row.values[prop.id]

  const base = {
    display: 'flex', alignItems: 'center', gap: 6,
    height: ROW_H, padding: '0 8px', minWidth: 0, overflow: 'hidden',
    borderRight: `1px solid ${border}`,
    fontSize: 'var(--ds-fs-md)', color: text,
  }

  /* A checkbox is one gesture already. Wrapping it in click-to-edit would be
     two gestures to express one bit. */
  if (prop.type === 'checkbox') {
    return (
      <div data-ds-db-cell={`${row.id}:${prop.id}`} style={{ ...base, justifyContent: 'center' }}>
        <input type="checkbox"
          checked={value === true}
          aria-label={prop.name}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => onWrite(e.target.checked)}
          style={{ width: 14, height: 14, accentColor: accent, cursor: 'pointer' }} />
      </div>
    )
  }

  /* A relation (Builder, 24 Sep 2026) is edited on the Record block, where
     its chips can be opened. Here it is a read-only count: the linked rows
     can live in another database this block cannot see. */
  if (prop.type === 'relation') {
    const n = Array.isArray(value) ? value.length : 0
    return (
      <div data-ds-db-cell={`${row.id}:${prop.id}`} title="Open the row in a Record to edit links" style={{ ...base, color: n ? text : text3, fontSize: 'var(--ds-fs-sm)' }}>
        {n ? `${n} linked` : '—'}
      </div>
    )
  }

  /* Same argument: a native date input opens its own picker on the first
     click, so click-to-edit would cost a click to reach a control already one
     click away.

     Stored as a timestamp, shown as a LOCAL YYYY-MM-DD. `dayKey` is the same
     local formatter the calendar grid labels its cells with, and coerceValue
     reads the string back through `parseDate`, which knows a bare YYYY-MM-DD
     is end-of-day local. Formatting with toISOString here instead would shift
     the date by a day for everyone east of UTC, every time. */
  if (prop.type === 'date') {
    return (
      <div data-ds-db-cell={`${row.id}:${prop.id}`} style={base}>
        <input type="date"
          value={typeof value === 'number' ? dayKey(new Date(value)) : ''}
          aria-label={prop.name}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => onWrite(e.target.value)}
          style={{
            width: '100%', background: 'transparent', border: 'none', outline: 'none',
            color: typeof value === 'number' ? text : text3,
            fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-sm)',
            padding: 0, minWidth: 0, cursor: 'pointer',
          }} />
      </div>
    )
  }

  if (prop.type === 'select' || prop.type === 'multi') {
    const ids = prop.type === 'multi' ? (Array.isArray(value) ? value : []) : (value ? [value] : [])
    const chosen = ids.map(id => (prop.options || []).find(o => o.id === id)).filter(Boolean)
    return (
      <div data-ds-db-cell={`${row.id}:${prop.id}`}
        role="button"
        tabIndex={0}
        title={`${prop.name} — click to choose`}
        onPointerDown={openOnPointerDown(e => onOpen(anchorOf(e.currentTarget)))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOpen(anchorOf(e.currentTarget)) } }}
        style={{ ...base, gap: 4, cursor: 'pointer' }}>
        {chosen.length === 0
          ? <span style={{ color: text3 }}>—</span>
          : chosen.map(o => <OptionChip key={o.id} option={o} colors={colors} />)}
      </div>
    )
  }

  /* Everything text-shaped, plus number. Click to edit. */
  if (editing) {
    return (
      <div data-ds-db-cell={`${row.id}:${prop.id}`} style={{ ...base, padding: 0 }}>
        <TextCellEditor
          initial={value === null || value === undefined ? '' : String(value)}
          numeric={prop.type === 'number'}
          label={prop.name}
          colors={colors}
          onDraft={onDraft}
          onClose={onClose}
        />
      </div>
    )
  }

  const numeric = prop.type === 'number'
  const empty = value === null || value === undefined || value === ''
  return (
    <div data-ds-db-cell={`${row.id}:${prop.id}`}
      role="button"
      tabIndex={0}
      title={`${prop.name} — click to edit`}
      onPointerDown={openOnPointerDown(() => onOpen())}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOpen() } }}
      style={{
        ...base, cursor: 'text',
        /* Figures right-aligned and in the mono face. A column of numbers that
           does not line up is a column you have to read instead of scan — the
           house convention, and half of why the finished blocks look
           finished. */
        justifyContent: numeric ? 'flex-end' : 'flex-start',
        fontFamily: numeric ? 'var(--ds-font-mono)' : 'var(--ds-font-body)',
        fontVariantNumeric: numeric ? 'tabular-nums' : 'normal',
        fontWeight: prop.type === 'title' ? 600 : 400,
        color: empty ? text3 : text,
      }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {empty ? (prop.type === 'title' ? 'Untitled' : '') : String(value)}
      </span>
    </div>
  )
}

/**
 * The open cell.
 *
 * It reports keystrokes upward through `onDraft` rather than writing them, and
 * closing is the parent's decision — see `takePending`. Writing per keystroke
 * would clone the whole database sixty times a sentence and hand the autosave
 * a new document each time; writing only on blur loses the value when the next
 * click is on another cell, because that click never blurs this one.
 */
function TextCellEditor({ initial, numeric, label, colors, onDraft, onClose, height = '100%' }) {
  const { text, accent, accentText, surface } = colors
  const [v, setV] = useState(initial)
  /* Escape must not commit, and Escape also blurs — so the blur handler has to
     know which of the two ways out it is being called from. */
  const cancelled = useRef(false)

  return (
    <input
      autoFocus
      value={v}
      aria-label={label}
      /* NOT type="number". Chrome reports an empty string from `.value` for
         anything it considers invalid, so "12abc" would arrive here as "" and
         be stored as null for a reason nobody can see. Handing the raw text to
         coerceValue keeps the rule in one place: "12abc" is null because the
         COLUMN says so, not because the browser swallowed it. inputMode still
         raises the numeric keypad where there is one. */
      inputMode={numeric ? 'decimal' : undefined}
      onChange={e => { setV(e.target.value); onDraft(e.target.value) }}
      onMouseDown={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
        else if (e.key === 'Escape') {
          e.preventDefault()
          /* Claimed, so the canvas's document-level Escape does not ALSO fire
             and drop the block selection. SheetGrid marks the same flag. */
          e.nativeEvent.__dsConsumed = true
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={() => onClose(!cancelled.current)}
      style={{
        width: '100%', height, minWidth: 0,
        padding: '0 7px', background: surface,
        border: `1.5px solid ${accent}`, borderRadius: 4, outline: 'none',
        color: text,
        fontFamily: numeric ? 'var(--ds-font-mono)' : 'var(--ds-font-body)',
        fontSize: 'var(--ds-fs-md)',
        textAlign: numeric ? 'right' : 'left',
      }} />
  )
}

/**
 * A row's title inside a card — board, gallery or calendar.
 *
 * Editable in place, because the alternative is a card you can only look at:
 * "+ row" on a board column creates a row that needs a name THERE, and going
 * to the table view to give it one is exactly the kind of trip that makes a
 * tool feel slow.
 *
 * Opened by a DOUBLE click, and that is not arbitrary. A board card is
 * grabbable, so its single click has to stay free for the drag; and
 * double-click-to-rename is what BlockHandle and a section header already do,
 * so it is one rule rather than three. The same reason the opening pointerdown
 * is NOT defaultPrevented here: preventing it would suppress the native drag
 * this card depends on, and dblclick is the last event of its sequence anyway,
 * so nothing is left to steal focus from the input.
 */
function CardTitle({ db, row, colors, editing, onCloseCell, onDraft, style }) {
  if (editing) {
    const raw = row.values[db.titlePropId]
    return (
      <TextCellEditor
        initial={typeof raw === 'string' ? raw : ''}
        label={db.properties.find(p => p.id === db.titlePropId)?.name || 'Name'}
        colors={colors}
        height={22}
        onDraft={v => onDraft(row.id, db.titlePropId, v)}
        onClose={onCloseCell}
      />
    )
  }
  return <div style={style}>{rowTitle(db, row)}</div>
}

function OptionChip({ option, colors, onRemove }) {
  const c = optionColor(option.color, colors)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, maxWidth: '100%',
      padding: '2px 6px', borderRadius: 'var(--ds-radius-sm)',
      background: `${c}22`, border: `1px solid ${c}55`, color: c,
      fontSize: 'var(--ds-fs-xs)', fontWeight: 600, lineHeight: 1.7,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {option.name}
      {onRemove && (
        <button aria-label={`Remove ${option.name}`}
          data-ds-db-deloption={option.id}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onRemove() }}
          style={{
            display: 'flex', background: 'none', border: 'none', padding: 0,
            color: c, cursor: 'pointer', opacity: 0.7,
          }}>
          {/* There is no × in the icon set, and hand-adding one would bypass
              `npm run icons` and the spec it enforces. The bin says the same
              thing, and it is the glyph every other delete in the app uses. */}
          <Icon name="action-delete" size={12} />
        </button>
      )}
    </span>
  )
}

/* ── board ───────────────────────────────────────────────────────────── */

function BoardView({ db, view, groups, rows, colors, editing, onOpenCell, onCloseCell, onDraft, onWrite, onAddRow }) {
  const { surface, raised, border, text, text2, text3, accent, accentText, accentDim } = colors
  const [drag, setDrag] = useState(null)      // { rowId, fromKey }
  const [over, setOver] = useState(null)      // group key

  const prop = db.properties.find(p => p.id === view?.groupBy)

  /* `resolveView` hands back null groups when the view has no groupBy, or when
     the property it named has been deleted or has stopped being groupable —
     removeProperty and changePropertyType both clear it, which is why this is
     an empty state and not a crash. */
  if (!groups || !prop) {
    return (
      <Empty colors={colors} icon="block-kanban"
        title="This board has nothing to group by"
        body="A board arranges rows by a Select, Multi-select, Checkbox or Person column. Click the highlighted view chip above to pick one." />
    )
  }

  /* One drop is one statement about one property, so it goes through setCell
     like every other write. Nothing here moves a row: a row does not know
     which column it is in, it knows its Status — the board reads it. */
  function drop(toKey) {
    const d = drag
    setDrag(null); setOver(null)
    if (!d || d.fromKey === toKey) return
    if (prop.type === 'checkbox') { onWrite(d.rowId, prop.id, toKey === 'true'); return }
    if (prop.type === 'multi') {
      const cur = db.rows.find(r => r.id === d.rowId)?.values[prop.id] || []
      /* Dragged out of one column and into another: the option that put it
         where it was comes off, the target goes on. Keeping both would leave
         the card visibly in the column you dragged it out of, which reads as
         the drag having failed. */
      onWrite(d.rowId, prop.id, toKey === '__none__' ? [] : [...cur.filter(id => id !== d.fromKey), toKey])
      return
    }
    onWrite(d.rowId, prop.id, toKey === '__none__' ? null : toKey)
  }

  return (
    <div style={{ display: 'flex', gap: 8, padding: 10, alignItems: 'flex-start', minWidth: 'max-content' }}>
      {groups.map(g => {
        const c = optionColor(g.color, colors)
        const isOver = over === g.key
        return (
          <div key={g.key}
            data-ds-db-group={g.key}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(g.key) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null) }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(g.key) }}
            style={{
              width: 190, flexShrink: 0, padding: 7, borderRadius: 'var(--ds-radius-md)',
              background: isOver ? accentDim : raised,
              border: `1px solid ${isOver ? accent : border}`,
              transition: 'background var(--ds-transition), border-color var(--ds-transition)',
            }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7, padding: '0 2px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0 }} />
              <span style={{
                flex: 1, minWidth: 0, color: text2,
                fontSize: 'var(--ds-fs-sm)', fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {g.name}
              </span>
              <span style={{
                flexShrink: 0, fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xs)',
                fontVariantNumeric: 'tabular-nums', color: text3,
              }}>
                {g.rows.length}
              </span>
            </div>

            {g.rows.map(r => (
              <div key={r.id}
                data-ds-db-card={r.id}
                draggable
                onDragStart={e => { e.stopPropagation(); setDrag({ rowId: r.id, fromKey: g.key }) }}
                onDragEnd={() => { setDrag(null); setOver(null) }}
                onMouseDown={e => e.stopPropagation()}
                onDoubleClick={e => { e.stopPropagation(); onOpenCell({ rowId: r.id, propId: db.titlePropId }) }}
                title="Drag to another column · double-click to rename"
                style={{
                  background: surface, borderRadius: 'var(--ds-radius-sm)',
                  padding: '8px 10px', marginBottom: 5, cursor: 'grab',
                  border: `1px solid ${border}`, borderLeft: `3px solid ${c}`,
                  opacity: drag?.rowId === r.id ? 0.45 : 1,
                  transition: 'opacity var(--ds-transition)',
                }}>
                <CardTitle db={db} row={r} colors={colors}
                  editing={editing?.rowId === r.id && editing?.propId === db.titlePropId}
                  onCloseCell={onCloseCell} onDraft={onDraft}
                  style={{ fontSize: 'var(--ds-fs-md)', color: text, lineHeight: 1.4 }} />
                <CardMeta db={db} row={r} skip={[db.titlePropId, prop.id]} colors={colors} />
              </div>
            ))}

            <button
              data-ds-db-addcard={g.key}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                /* Created straight into this column. Adding a card to "Won" and
                   watching it land in "No status" is the board ignoring where
                   you pointed. */
                if (g.key === '__none__') { onAddRow({}); return }
                if (prop.type === 'checkbox') { onAddRow({ [prop.id]: g.key === 'true' }); return }
                onAddRow({ [prop.id]: prop.type === 'multi' ? [g.key] : g.key })
              }}
              style={{
                width: '100%', padding: '4px 6px', cursor: 'pointer',
                background: 'none', border: `1px dashed ${border}`,
                borderRadius: 'var(--ds-radius-sm)', color: text3,
                fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-sm)',
                transition: 'color var(--ds-transition), border-color var(--ds-transition)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
              + row
            </button>
          </div>
        )
      })}
      {rows.length === 0 && (
        <span style={{ padding: '10px 4px', color: text2, fontSize: 'var(--ds-fs-sm)' }}>
          No rows yet — add one to any column.
        </span>
      )}
    </div>
  )
}

/* The two or three properties worth showing under a title, skipping whichever
   ones the surrounding view already says. Empty values are dropped rather than
   rendered blank: three empty lines under every card is noise on every card
   you have. */
function CardMeta({ db, row, skip, colors, limit = 3 }) {
  const shown = db.properties
    .filter(p => !skip.includes(p.id))
    .map(p => ({ p, v: row.values[p.id] }))
    .filter(({ p, v }) => (p.type === 'multi'
      ? Array.isArray(v) && v.length > 0
      : p.type === 'checkbox' ? v === true : v !== null && v !== undefined && v !== ''))
    .slice(0, limit)

  if (!shown.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
      {shown.map(({ p, v }) => <MetaValue key={p.id} prop={p} value={v} colors={colors} />)}
    </div>
  )
}

function MetaValue({ prop, value, colors }) {
  const { text2, text3, accent, accentText } = colors
  const mono = { fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xs)', fontVariantNumeric: 'tabular-nums' }

  if (prop.type === 'select' || prop.type === 'multi') {
    const ids = prop.type === 'multi' ? value : [value]
    return ids.map(id => {
      const o = (prop.options || []).find(x => x.id === id)
      return o ? <OptionChip key={id} option={o} colors={colors} /> : null
    })
  }
  if (prop.type === 'checkbox') {
    return (
      <span title={prop.name} style={{ display: 'flex', alignItems: 'center', gap: 4, color: accentText, fontSize: 'var(--ds-fs-xs)' }}>
        <Icon name="action-check" size={12} />{prop.name}
      </span>
    )
  }
  if (prop.type === 'date') {
    return <span title={prop.name} style={{ ...mono, color: text3 }}>{dayKey(new Date(value))}</span>
  }
  if (prop.type === 'number') {
    return <span title={prop.name} style={{ ...mono, color: text2 }}>{value}</span>
  }
  if (prop.type === 'relation') {
    const n = Array.isArray(value) ? value.length : 0
    return n ? <span title={prop.name} style={{ ...mono, color: text3 }}>{n} linked</span> : null
  }
  return (
    <span title={prop.name} style={{
      fontSize: 'var(--ds-fs-xs)', color: text3, maxWidth: '100%',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {String(value)}
    </span>
  )
}

/* ── gallery ─────────────────────────────────────────────────────────── */

function GalleryView({ db, rows, colors, editing, onOpenCell, onCloseCell, onDraft, onAddRow }) {
  const { surface, border, text, text3, accent, accentText } = colors
  return (
    <div style={{
      display: 'grid', gap: 8, padding: 10,
      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', alignContent: 'start',
    }}>
      {rows.map(r => (
        <div key={r.id}
          data-ds-db-card={r.id}
          onMouseDown={e => e.stopPropagation()}
          onDoubleClick={e => { e.stopPropagation(); onOpenCell({ rowId: r.id, propId: db.titlePropId }) }}
          title="Double-click to rename"
          style={{
            background: surface, border: `1px solid ${border}`,
            borderRadius: 'var(--ds-radius-md)', padding: '10px 10px', cursor: 'pointer',
            transition: 'border-color var(--ds-transition)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = accent }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = border }}>
          <CardTitle db={db} row={r} colors={colors}
            editing={editing?.rowId === r.id && editing?.propId === db.titlePropId}
            onCloseCell={onCloseCell} onDraft={onDraft}
            style={{ fontSize: 'var(--ds-fs-lg)', fontWeight: 600, color: text, lineHeight: 1.35 }} />
          <CardMeta db={db} row={r} skip={[db.titlePropId]} colors={colors} />
        </div>
      ))}

      <button
        data-ds-db-addrow
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onAddRow() }}
        style={{
          minHeight: 54, cursor: 'pointer', background: 'none',
          border: `1px dashed ${border}`, borderRadius: 'var(--ds-radius-md)',
          color: text3, fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'color var(--ds-transition), border-color var(--ds-transition)',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
        <Icon name="action-add" size={12} /> New
      </button>
    </div>
  )
}

/* ── calendar ────────────────────────────────────────────────────────── */

function CalendarView({ db, view, rows, colors, dark, editing, onOpenCell, onCloseCell, onDraft }) {
  const { surface, base, raised, border, text, text2, text3, accent, accentText } = colors

  /* The month being LOOKED at, which is not the same as today, and is not a
     document property — persisting it would reopen the workspace six months in
     the past because that is where you last were. */
  const [cursor, setCursor] = useState(() => new Date())

  /* Nothing else re-renders this block at midnight, so `isToday` would keep
     answering with yesterday: a tab left open overnight holds the filled
     accent circle on the wrong date. One timer for the whole grid, re-armed
     after every render at the same absolute instant. CalendarBlock does this
     identically and explains it at length. */
  const [, setDayTick] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setDayTick(n => n + 1), msUntilNextLocalMidnight())
    return () => clearTimeout(id)
  })

  const dateProp = db.properties.find(p => p.id === view?.dateProp)

  /* Bucketed by LOCAL day key — the same function the grid labels its cells
     with, so a row cannot land one cell away from the date it reads. Values
     are timestamps; anything a date column could not hold has already been
     refused by coerceValue and is not a row this view can place. */
  const buckets = useMemo(() => {
    const m = new Map()
    if (!dateProp) return m
    for (const r of rows) {
      const at = r.values[dateProp.id]
      if (typeof at !== 'number') continue
      const k = dayKey(new Date(at))
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return m
  }, [rows, dateProp])

  if (!dateProp) {
    return (
      <Empty colors={colors} icon="status-info"
        title="This calendar has no date to place rows by"
        body="A calendar reads one Date column. Add one with the + at the right of the table header, then pick it from the view menu." />
    )
  }

  /* Calendar-unit arithmetic, never milliseconds: on the two days a year the
     clocks move, a month built by adding fixed milliseconds lands on the wrong
     day. lib/calendar.js settled that once, for everyone. */
  const weeks = monthGrid(cursor.getFullYear(), cursor.getMonth(), WEEK_START_MONDAY)
  const labels = weekdayLabels(WEEK_START_MONDAY)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderBottom: `1px solid ${border}`, flexShrink: 0,
      }}>
        <NavBtn label="Previous month" colors={colors} flip onClick={() => setCursor(c => addMonths(c, -1))} />
        <NavBtn label="Next month" colors={colors} onClick={() => setCursor(c => addMonths(c, 1))} />
        <span style={{
          flex: 1, minWidth: 0, marginLeft: 4,
          fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-md)',
          color: text, letterSpacing: 0.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {monthTitle(cursor)}
        </span>
        <span style={{ fontSize: 'var(--ds-fs-xs)', color: text3, flexShrink: 0 }}>by {dateProp.name}</span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        background: raised, borderBottom: `1px solid ${border}`, flexShrink: 0,
      }}>
        {labels.map(l => (
          <div key={l} style={{
            padding: '4px 0', textAlign: 'center',
            fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)',
            letterSpacing: 0.8, textTransform: 'uppercase', color: text3,
          }}>{l}</div>
        ))}
      </div>

      <div style={{
        flex: 1, minHeight: 0, display: 'grid',
        gridTemplateRows: `repeat(${weeks.length}, minmax(52px, 1fr))`,
      }}>
        {weeks.map((days, wi) => (
          <div key={days[0].key} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
            {days.map((day, di) => {
              const here = buckets.get(day.key) || []
              const now = isToday(day.date)
              /* Out-of-month recedes toward the page ground rather than being
                 washed with a literal rgba(): --ds-base is lighter than the
                 surface in one theme and darker in the other, so one token
                 moves it the right way in both. */
              const bg = now ? `${accent}${dark ? '1f' : '14'}` : day.inMonth ? surface : base
              return (
                <div key={day.key} data-ds-db-day={day.key} style={{
                  minWidth: 0, padding: '3px 4px 4px',
                  borderRight: di === 6 ? 'none' : `1px solid ${border}`,
                  borderBottom: wi === weeks.length - 1 ? 'none' : `1px solid ${border}`,
                  background: bg, overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}>
                  <span style={{
                    minWidth: 17, height: 17, padding: '0 4px', borderRadius: 8, alignSelf: 'flex-start',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xs)',
                    fontVariantNumeric: 'tabular-nums',
                    /* Today is a filled pill, and its label takes the SURFACE
                       colour rather than a literal white — on the light theme
                       that is near-white on green and on the dark one it is
                       near-black on indigo, which is the readable answer in
                       both. */
                    background: now ? accent : 'transparent',
                    color: now ? surface : day.inMonth ? text2 : text3,
                    fontWeight: now ? 600 : 400,
                  }}>
                    {day.date.getDate()}
                  </span>
                  {here.slice(0, 3).map(r => (
                    editing?.rowId === r.id && editing?.propId === db.titlePropId ? (
                      <CardTitle key={r.id} db={db} row={r} colors={colors} editing
                        onCloseCell={onCloseCell} onDraft={onDraft} />
                    ) : (
                      <button key={r.id}
                        data-ds-db-event={r.id}
                        title={`${rowTitle(db, r)} — double-click, or Enter, to rename`}
                        onMouseDown={e => e.stopPropagation()}
                        onDoubleClick={e => { e.stopPropagation(); onOpenCell({ rowId: r.id, propId: db.titlePropId }) }}
                        /* A <button> whose only action is a DOUBLE-click is a
                           button the keyboard cannot press: it is focusable and
                           announced, and Enter did nothing. Enter and Space do
                           what the double-click does. The mouse path is
                           untouched — a single click still belongs to the day
                           cell underneath, which is why mousedown is stopped
                           rather than turned into an onClick. */
                        onKeyDown={e => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          e.stopPropagation()
                          onOpenCell({ rowId: r.id, propId: db.titlePropId })
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                          background: `${accent}1f`, border: '1px solid transparent', color: text2,
                          fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-xs)', lineHeight: 1.35,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          transition: 'border-color var(--ds-transition)',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = accent }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent' }}>
                        {rowTitle(db, r)}
                      </button>
                    )
                  ))}
                  {here.length > 3 && (
                    <span style={{
                      fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xs)', color: text3,
                    }}>
                      +{here.length - 3}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function NavBtn({ label, onClick, colors, flip }) {
  const { raised, text, text2 } = colors
  return (
    <button onClick={e => { e.stopPropagation(); onClick() }} title={label} aria-label={label}
      onMouseDown={e => e.stopPropagation()}
      style={{
        width: 21, height: 21, padding: 0, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--ds-radius-sm)', border: '1px solid transparent',
        background: 'transparent', color: text2, cursor: 'pointer',
        transition: 'background var(--ds-transition), color var(--ds-transition)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}>
      <Icon name="nav-chevron-right" size={12} style={flip ? { transform: 'rotate(180deg)' } : undefined} />
    </button>
  )
}

/* ── the floating layer ──────────────────────────────────────────────── */

/**
 * Every menu in this file goes through here, and here portals.
 *
 * The canvas applies `transform: translate() scale()`, and a transformed
 * ancestor becomes the containing block for `position: fixed` descendants — so
 * a menu that stayed in place would be positioned against the canvas and then
 * scaled, and no arithmetic fixes it. Only leaving the subtree does.
 * `npm run check:geom` enforces the portal.
 */
function Popover({ at, width = 236, colors, dark, onClose, label, children }) {
  const { surface, border } = colors

  /* Escape closes, from wherever focus happens to be.
     -----------------------------------------------------------------------
     CAPTURE phase, and that is the whole point. The canvas listens for Escape
     on `document` too, and it stands down when it sees `__dsConsumed` on the
     event — but a bubble-phase listener registered later than the canvas's
     runs AFTER it, so the flag would arrive too late and Escape would close
     this menu AND drop the block selection behind it. Capture runs first.

     Narrow on purpose: one key, only while a menu is open. A capture-phase
     listener that claimed more than that is what the old slash menu did, and
     it raced the caret — see the header of SlashMenu.js.

     `onClose` is a stable useCallback in the parent, so this registers once
     rather than on every keystroke typed into the panel. */
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.__dsConsumed = true
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  if (typeof document === 'undefined') return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(at?.left ?? 0, vw - width - 8))
  const top = Math.max(8, Math.min(at?.top ?? 0, vh - 120))

  return createPortal(
    <>
      {/* A click anywhere else dismisses. Without it the only way out is
          Escape, and a menu with no dismiss target traps anyone reaching for
          the mouse. */}
      <div onMouseDown={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: Z.popoverScrim, background: 'transparent' }} />
      <div
        data-ds-db-menu={label}
        role="dialog"
        aria-label={label}
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'fixed', left, top, zIndex: Z.popover, width,
          maxHeight: Math.max(140, vh - top - 12), overflowY: 'auto',
          /* House chrome: frosted island. The same recipe as every rail and
             every toast, so a menu reads as part of the app rather than as
             something the block invented. */
          background: `${surface}dd`,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${border}`, borderRadius: 12,
          boxShadow: `0 12px 40px ${dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.18)'}`,
          padding: 6, fontFamily: 'var(--ds-font-body)',
        }}>
        {children}
      </div>
    </>,
    document.body,
  )
}

function MenuLabel({ children, colors }) {
  return (
    <div style={{
      padding: '6px 8px 4px', color: colors.text3,
      fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xs)',
      textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700,
    }}>{children}</div>
  )
}

function MenuRow({ icon, children, colors, onClick, tone, active, muted, title, ...rest }) {
  const { raised, text, text2, accent, accentText, accentDim, red } = colors
  const fg = tone === 'danger' ? red : active ? accent : text2
  return (
    <button
      title={title}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); if (!muted) onClick?.(e) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 8px', textAlign: 'left',
        cursor: muted ? 'default' : 'pointer', opacity: muted ? 0.35 : 1,
        background: active ? accentDim : 'transparent', border: 'none',
        borderRadius: 'var(--ds-radius-sm)', color: fg,
        fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-md)',
        transition: 'background var(--ds-transition), color var(--ds-transition)',
      }}
      onMouseEnter={e => {
        if (active || muted) return
        e.currentTarget.style.background = raised
        if (tone !== 'danger') e.currentTarget.style.color = text
      }}
      onMouseLeave={e => {
        if (active || muted) return
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = fg
      }}
      {...rest}>
      {icon && <Icon name={icon} size={12} style={{ flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        {children}
      </span>
    </button>
  )
}

const panelInput = colors => ({
  width: '100%', padding: '6px 8px', minWidth: 0,
  background: colors.surface, border: `1px solid ${colors.border}`,
  borderRadius: 'var(--ds-radius-sm)', outline: 'none', color: colors.text,
  fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-md)',
})

/* ── property editor ─────────────────────────────────────────────────── */

function PropertyMenu({
  db, propId, at, colors, dark, onClose,
  onRename, onRetype, onAddOption, onRemoveOption, onDelete,
}) {
  const { border, text3 } = colors
  const [newOption, setNewOption] = useState('')
  const prop = db.properties.find(p => p.id === propId)

  /* The column went away under the panel — an undo, or a delete from a second
     window. Closing beats rendering half a form about nothing. */
  if (!prop) return null

  const isTitle = prop.id === db.titlePropId
  const hasOptions = prop.type === 'select' || prop.type === 'multi'

  return (
    <Popover at={at} width={244} colors={colors} dark={dark} onClose={onClose} label="Edit column">
      <input
        autoFocus
        defaultValue={prop.name}
        aria-label="Column name"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => onRename(prop, e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onClose() }
          if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; onClose() }
        }}
        style={{ ...panelInput(colors), fontWeight: 600 }} />

      <MenuLabel colors={colors}>Type</MenuLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2 }}>
        {PROPERTY_TYPE_IDS.map(t => {
          /* The title names a row everywhere else in the app, so it cannot
             become a checkbox. removeProperty refuses to delete it for the same
             reason; refusing here as well means the control never offers
             something the model would silently ignore. */
          const locked = isTitle && t !== 'title'
          return (
            <MenuRow key={t} colors={colors} active={prop.type === t} muted={locked}
              icon={PROPERTY_TYPES[t].icon}
              data-ds-db-type={t}
              onClick={() => onRetype(prop, t)}
              title={locked ? 'The title column names every row — it stays a title' : PROPERTY_TYPES[t].label}>
              {PROPERTY_TYPES[t].label}
            </MenuRow>
          )
        })}
      </div>

      {hasOptions && (
        <>
          <MenuLabel colors={colors}>Options</MenuLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 8px 6px' }}>
            {(prop.options || []).length === 0 && (
              <span style={{ fontSize: 'var(--ds-fs-sm)', color: text2 }}>
                None yet — a select with no options can hold nothing.
              </span>
            )}
            {(prop.options || []).map(o => (
              <OptionChip key={o.id} option={o} colors={colors}
                onRemove={() => onRemoveOption(prop, o)} />
            ))}
          </div>
          <input
            value={newOption}
            aria-label="New option"
            placeholder="Add an option…"
            onMouseDown={e => e.stopPropagation()}
            onChange={e => setNewOption(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const name = newOption.trim()
              if (!name) return
              onAddOption(prop, name)
              setNewOption('')
            }}
            style={panelInput(colors)} />
        </>
      )}

      <div style={{ height: 1, background: border, margin: '7px 0 5px' }} />
      {isTitle ? (
        <div style={{ padding: '2px 8px 4px', fontSize: 'var(--ds-fs-sm)', color: text2, lineHeight: 1.5 }}>
          The title column cannot be deleted — a row with no title has no name.
        </div>
      ) : (
        <MenuRow colors={colors} icon="action-delete" tone="danger"
          data-ds-db-delcol={prop.id}
          onClick={() => onDelete(prop)}>
          Delete column
        </MenuRow>
      )}
    </Popover>
  )
}

/* ── option picker, for a select or multi cell ───────────────────────── */

function SelectMenu({ db, rowId, propId, at, colors, dark, onClose, onWrite }) {
  const { text3 } = colors
  const prop = db.properties.find(p => p.id === propId)
  const row = db.rows.find(r => r.id === rowId)
  if (!prop || !row) return null

  const current = row.values[propId]
  const multi = prop.type === 'multi'
  const chosen = multi ? (Array.isArray(current) ? current : []) : (current ? [current] : [])

  return (
    <Popover at={at} width={214} colors={colors} dark={dark} onClose={onClose} label={prop.name}>
      <MenuLabel colors={colors}>{prop.name}</MenuLabel>
      {(prop.options || []).length === 0 && (
        <div style={{ padding: '6px 8px 8px', fontSize: 'var(--ds-fs-sm)', color: text2, lineHeight: 1.5 }}>
          This column has no options yet. Click its header to add some.
        </div>
      )}
      {(prop.options || []).map(o => {
        const on = chosen.includes(o.id)
        return (
          <MenuRow key={o.id} colors={colors} active={on}
            data-ds-db-option={o.id}
            icon={on ? 'action-check' : undefined}
            onClick={() => {
              /* Both branches hand a raw value to setCell and let coerceValue
                 have the last word — which is what dedupes a multi and refuses
                 an option id that no longer exists. */
              if (multi) onWrite(rowId, propId, on ? chosen.filter(id => id !== o.id) : [...chosen, o.id])
              else { onWrite(rowId, propId, on ? null : o.id); onClose() }
            }}>
            <OptionChip option={o} colors={colors} />
          </MenuRow>
        )
      })}
      {chosen.length > 0 && (
        <MenuRow colors={colors} icon="grid-clear"
          onClick={() => { onWrite(rowId, propId, null); onClose() }}>
          Clear
        </MenuRow>
      )}
    </Popover>
  )
}

/* ── view menus ──────────────────────────────────────────────────────── */

function AddViewMenu({ at, colors, dark, onClose, onPick }) {
  return (
    <Popover at={at} width={190} colors={colors} dark={dark} onClose={onClose} label="Add a view">
      <MenuLabel colors={colors}>New view</MenuLabel>
      {Object.entries(VIEW_KINDS).map(([kind, def]) => (
        <MenuRow key={kind} colors={colors} icon={def.icon}
          data-ds-db-newview={kind}
          onClick={() => onPick(kind)}>
          {def.label}
        </MenuRow>
      ))}
    </Popover>
  )
}

function ViewMenu({ db, view, at, colors, dark, onClose, onPatch, onDelete }) {
  const { border, text3 } = colors
  const groupables = db.properties.filter(p => isGroupable(p.type))
  const dates = db.properties.filter(p => p.type === 'date')
  const last = db.views.length <= 1

  return (
    <Popover at={at} width={224} colors={colors} dark={dark} onClose={onClose} label="View options">
      <input
        autoFocus
        defaultValue={view.name}
        aria-label="View name"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => onPatch({ name: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onClose() }
          if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; onClose() }
        }}
        style={{ ...panelInput(colors), fontWeight: 600 }} />

      <MenuLabel colors={colors}>Shows as</MenuLabel>
      {Object.entries(VIEW_KINDS).map(([kind, def]) => (
        <MenuRow key={kind} colors={colors} icon={def.icon} active={view.kind === kind}
          data-ds-db-askind={kind}
          onClick={() => {
            /* Switching to a board or a calendar picks a column rather than
               opening empty and blaming the user — the same default createView
               applies to a brand new one. */
            const patch = { kind }
            if (kind === 'board' && !view.groupBy) patch.groupBy = groupables[0]?.id || null
            if (kind === 'calendar' && !view.dateProp) patch.dateProp = dates[0]?.id || null
            onPatch(patch)
          }}>
          {def.label}
        </MenuRow>
      ))}

      {view.kind === 'board' && (
        <>
          <MenuLabel colors={colors}>Group by</MenuLabel>
          {groupables.length === 0 && (
            <div style={{ padding: '2px 8px 6px', fontSize: 'var(--ds-fs-sm)', color: text2, lineHeight: 1.5 }}>
              Nothing to group by yet. Add a Select, Multi-select, Checkbox or Person column.
            </div>
          )}
          {groupables.map(p => (
            <MenuRow key={p.id} colors={colors} active={view.groupBy === p.id}
              icon={PROPERTY_TYPES[p.type].icon}
              data-ds-db-groupby={p.id}
              onClick={() => onPatch({ groupBy: p.id })}>
              {p.name}
            </MenuRow>
          ))}
        </>
      )}

      {view.kind === 'calendar' && (
        <>
          <MenuLabel colors={colors}>Date</MenuLabel>
          {dates.length === 0 && (
            <div style={{ padding: '2px 8px 6px', fontSize: 'var(--ds-fs-sm)', color: text2, lineHeight: 1.5 }}>
              No Date column yet. Add one and it appears here.
            </div>
          )}
          {dates.map(p => (
            <MenuRow key={p.id} colors={colors} active={view.dateProp === p.id}
              icon={PROPERTY_TYPES.date.icon}
              data-ds-db-dateprop={p.id}
              onClick={() => onPatch({ dateProp: p.id })}>
              {p.name}
            </MenuRow>
          ))}
        </>
      )}

      <div style={{ height: 1, background: border, margin: '7px 0 5px' }} />
      {last ? (
        <div style={{ padding: '2px 8px 4px', fontSize: 'var(--ds-fs-sm)', color: text2, lineHeight: 1.5 }}>
          The last view cannot be deleted — a database has to render something.
        </div>
      ) : (
        <MenuRow colors={colors} icon="action-delete" tone="danger"
          data-ds-db-delview onClick={onDelete}>
          Delete view
        </MenuRow>
      )}
    </Popover>
  )
}

/* ── sort ────────────────────────────────────────────────────────────── */

function SortMenu({ db, view, at, colors, dark, onClose, onPatch }) {
  const sort = view?.sortBy
  return (
    <Popover at={at} width={214} colors={colors} dark={dark} onClose={onClose} label="Sort">
      <MenuLabel colors={colors}>Sort by</MenuLabel>
      {db.properties.map(p => {
        const on = sort?.propId === p.id
        return (
          <MenuRow key={p.id} colors={colors} active={on}
            icon={PROPERTY_TYPES[p.type]?.icon}
            data-ds-db-sortby={p.id}
            /* Clicking the property that is already sorted flips the direction
               — which is what a second click on a column header means in every
               other grid anyone has used. */
            onClick={() => onPatch({ sortBy: { propId: p.id, desc: on ? !sort.desc : false } })}>
            {p.name}
            {on && (
              <Icon name={sort.desc ? 'grid-sort-desc' : 'grid-sort-asc'} size={12}
                style={{ marginLeft: 'auto', flexShrink: 0 }} />
            )}
          </MenuRow>
        )
      })}
      {sort && (
        <MenuRow colors={colors} icon="grid-clear" data-ds-db-nosort
          onClick={() => onPatch({ sortBy: null })}>
          No sort
        </MenuRow>
      )}
    </Popover>
  )
}

/* ── filter ──────────────────────────────────────────────────────────── */

function FilterMenu({ db, view, at, colors, dark, onClose, onPatch }) {
  const { border, text3, red } = colors
  const filters = view?.filters || []
  const set = next => onPatch({ filters: next })
  const patchAt = (i, patch) => set(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  return (
    <Popover at={at} width={268} colors={colors} dark={dark} onClose={onClose} label="Filter">
      <MenuLabel colors={colors}>Filters</MenuLabel>
      {filters.length === 0 && (
        <div style={{ padding: '2px 8px 6px', fontSize: 'var(--ds-fs-sm)', color: text2, lineHeight: 1.5 }}>
          No filters. Every row on this view is shown.
        </div>
      )}

      {filters.map((f, i) => {
        const prop = db.properties.find(p => p.id === f.propId)
        const ops = opsFor(prop?.type)
        return (
          <div key={`${f.propId}-${i}`} data-ds-db-filter={i}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '3px 6px 5px' }}>
            <select value={f.propId} aria-label="Filter column"
              onMouseDown={e => e.stopPropagation()}
              onChange={e => {
                const next = db.properties.find(p => p.id === e.target.value)
                /* The operator and the value belonged to the OLD column's type.
                   Carrying "contains" onto a checkbox leaves a filter that
                   quietly matches nothing. */
                patchAt(i, { propId: e.target.value, op: opsFor(next?.type)[0], value: null })
              }}
              style={{ ...panelInput(colors), width: 'auto', flex: '1 1 90px' }}>
              {db.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            <select value={f.op} aria-label="Filter operator"
              onMouseDown={e => e.stopPropagation()}
              onChange={e => patchAt(i, { op: e.target.value })}
              style={{ ...panelInput(colors), width: 'auto', flex: '1 1 80px' }}>
              {ops.map(op => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
            </select>

            {opNeedsValue(f.op) && (
              <FilterValue prop={prop} filter={f} colors={colors}
                onChange={v => patchAt(i, { value: v })} />
            )}

            <button aria-label="Remove filter"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); set(filters.filter((_, j) => j !== i)) }}
              style={{
                display: 'flex', alignItems: 'center', padding: '0 4px', cursor: 'pointer',
                background: 'none', border: 'none', color: text3,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = red }}
              onMouseLeave={e => { e.currentTarget.style.color = text3 }}>
              <Icon name="action-delete" size={12} />
            </button>
          </div>
        )
      })}

      <div style={{ height: 1, background: border, margin: '5px 0' }} />
      <MenuRow colors={colors} icon="action-add"
        data-ds-db-addfilter
        onClick={() => {
          const p = db.properties[0]
          if (!p) return
          set([...filters, { propId: p.id, op: opsFor(p.type)[0], value: null }])
        }}>
        Add a filter
      </MenuRow>
      {filters.length > 0 && (
        <MenuRow colors={colors} icon="grid-clear" onClick={() => set([])}>
          Clear all
        </MenuRow>
      )}
    </Popover>
  )
}

/* The value half of a filter row. Every one of these goes back through
   `coerceValue` rather than storing what was typed: a filter value parsed
   differently from the column it is compared against is a filter that matches
   nothing, and nothing about the result says why. */
function FilterValue({ prop, filter, colors, onChange }) {
  const style = { ...panelInput(colors), width: 'auto', flex: '1 1 90px' }

  if (prop?.type === 'select' || prop?.type === 'multi') {
    return (
      <select value={filter.value ?? ''} aria-label="Filter value"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => onChange(e.target.value || null)} style={style}>
        <option value="">—</option>
        {(prop.options || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    )
  }
  if (prop?.type === 'checkbox') {
    return (
      <select value={filter.value === true ? 'true' : 'false'} aria-label="Filter value"
        onMouseDown={e => e.stopPropagation()}
        /* A real boolean, not the string "true". FILTER_OPS.is is `a === b`
           against a stored `false`, and "false" === false is never true. */
        onChange={e => onChange(e.target.value === 'true')} style={style}>
        <option value="true">checked</option>
        <option value="false">unchecked</option>
      </select>
    )
  }
  if (prop?.type === 'date') {
    return (
      <input type="date" aria-label="Filter value"
        value={typeof filter.value === 'number' ? dayKey(new Date(filter.value)) : ''}
        onMouseDown={e => e.stopPropagation()}
        onChange={e => onChange(e.target.value ? coerceValue(prop, e.target.value) : null)}
        style={{ ...style, fontFamily: 'var(--ds-font-mono)' }} />
    )
  }
  return (
    <input aria-label="Filter value"
      value={filter.value ?? ''}
      inputMode={prop?.type === 'number' ? 'decimal' : undefined}
      onMouseDown={e => e.stopPropagation()}
      onChange={e => onChange(prop?.type === 'number'
        ? (e.target.value === '' ? null : coerceValue(prop, e.target.value))
        : e.target.value)}
      style={prop?.type === 'number' ? { ...style, fontFamily: 'var(--ds-font-mono)' } : style} />
  )
}

/* ── empty states ────────────────────────────────────────────────────── */

function Empty({ colors, icon, title, body }) {
  const { text, text3, accent, accentText, accentDim } = colors
  return (
    <div data-ds-db-empty style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 10, padding: '30px 26px', textAlign: 'center',
    }}>
      <span style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: accentDim, color: accentText,
      }}>
        <Icon name={icon} size={16} />
      </span>
      <span style={{ fontSize: 'var(--ds-fs-md)', fontWeight: 600, color: text }}>{title}</span>
      <span style={{ fontSize: 'var(--ds-fs-sm)', color: text3, lineHeight: 1.55, maxWidth: 280 }}>{body}</span>
    </div>
  )
}

export default memo(DatabaseBlockInner)
