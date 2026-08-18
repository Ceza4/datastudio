'use client'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react'

/* SheetGrid — the spreadsheet inside a notebook table block.
   --------------------------------------------------------------------------
   Aims at the muscle memory people already have, not at formula power. Every
   interaction below is the one Excel would give you.

   NAVIGATION
     arrows            move one cell
     Enter             next row · Shift+Enter previous row
     Tab               next column · Shift+Tab previous column
     Ctrl+arrows       jump to the edge of the current data block
     Home / End        first / last column of the row
     Ctrl+Home         A1 · Ctrl+End last cell containing data
     PageUp / PageDown one screen
   The cursor is always scrolled back into view, and the sheet takes focus the
   moment you click a cell, so you can start typing without a second click.

   EDITING
     type              replaces the cell
     F2 / double-click edit in place
     Delete            clear the selection
     Esc               abandon the edit
     Ctrl+C/X/V        TSV, so ranges move in and out of real Excel
     Ctrl+Z / Ctrl+Y   full undo/redo history
     Ctrl+A            select everything
     right-click       insert / delete / duplicate rows and columns

   SELECTION
     drag or Shift+click for a block, Shift+arrows to extend, Ctrl+click to add
     a separate cell or range, and clicking a row/column header takes the whole
     row or column. The active cell, its row and its column are all highlighted
     so you never lose your place.

   SIZING
     drag a column or row header edge to resize; double-click that edge to fit
     the content.

   INFINITE SHEET
     Rows and columns both extend past the data: enough to fill the block, and
     more as you scroll. That's what stops a short table leaving a dead gap
     above the status bar, and it means there's always somewhere to type.
     Everything past the real data is virtual until written to, at which point
     writeCells() materialises the rows/headers in between.

   RENDERING
     Both axes are windowed off prefix-sum offsets (so per-row and per-column
     sizes still work), and only one <input> exists at a time — the editor for
     the active cell. A 5,000-row import costs the same to render as 20 rows.
   -------------------------------------------------------------------------- */

const ROW_H = 24
const HEAD_H = 26
const GUTTER_W = 48
const DEFAULT_COL_W = 130
const MIN_COL_W = 48
const MIN_ROW_H = 18
const OVERSCAN_R = 6
const OVERSCAN_C = 2
const AHEAD_COLS = 6
const AHEAD_ROWS = 40
const MAX_HISTORY = 60
const EMPTY_SIZES = {}   // stable identity, so derived colW/rowH don't churn
const EMPTY_ROWS = []    // ditto for rows/headers — `x || []` mints a new
const EMPTY_HEADERS = [] // array every render, invalidating the memos below
const STATS_CELL_CAP = 50000

/* Compact number formatting for the status bar: keep it readable without
   letting a long decimal push the aggregates off the edge. */
function fmtNum(v) {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (Number.isInteger(v)) return v.toLocaleString()
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function colName(i) {
  let s = ''
  i += 1
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

const normR = (r) => ({
  r1: Math.min(r.r1, r.r2), r2: Math.max(r.r1, r.r2),
  c1: Math.min(r.c1, r.c2), c2: Math.max(r.c1, r.c2),
})
const inR = (r, row, col) => {
  const n = normR(r)
  return row >= n.r1 && row <= n.r2 && col >= n.c1 && col <= n.c2
}

function SheetGridInner({ block, colors, maxHeight, onUpdateBlock, editingRef }) {
  const { border, text, text2, text3, accent, accentDim, raised, surface } = colors

  const rows = block.rows || EMPTY_ROWS
  const headers = block.headers || EMPTY_HEADERS
  const nRows = rows.length
  const nCols = headers.length

  const [sel, setSel] = useState({ r1: 0, c1: 0, r2: 0, c2: 0 })
  const [ranges, setRanges] = useState([])          // extra Ctrl+click ranges
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [viewport, setViewport] = useState({ w: 600, h: maxHeight })
  /* Column widths and row heights live ON THE BLOCK so they persist with the
     notebook. A drag needs to feel instant without writing to notebook state
     on every mousemove, so it holds a local override that shadows the block
     value until mouse-up commits it.

     This used to be two pieces of state kept in sync with the block by two
     effects (`useEffect(() => setColW(block.colWidths || {}), [...])`). That's
     the classic prop-mirror antipattern: every prop change caused a second
     render pass, and a commit landing mid-drag could clobber the drag. The
     override is simply derived instead — null except while dragging. */
  const [dragColW, setDragColW] = useState(null)
  const [dragRowH, setDragRowH] = useState(null)
  const colW = dragColW ?? block.colWidths ?? EMPTY_SIZES
  const rowH = dragRowH ?? block.rowHeights ?? EMPTY_SIZES
  const [extraCols, setExtraCols] = useState(0)
  const [extraRows, setExtraRows] = useState(0)
  const [menu, setMenu] = useState(null)            // { x, y, r, c }

  const scrollRef = useRef(null)
  const editorRef = useRef(null)
  const dragSel = useRef(false)
  const undoStack = useRef([])
  const redoStack = useRef([])

  const commitColW = useCallback(m => onUpdateBlock(block.id, { colWidths: m }), [block.id, onUpdateBlock])
  const commitRowH = useCallback(m => onUpdateBlock(block.id, { rowHeights: m }), [block.id, onUpdateBlock])

  useEffect(() => { editingRef.current = !!editing }, [editing, editingRef])
  useEffect(() => { if (editing && editorRef.current) editorRef.current.focus() }, [editing])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setViewport({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const widthOf = useCallback(c => colW[c] ?? DEFAULT_COL_W, [colW])
  const heightOf = useCallback(r => rowH[r] ?? ROW_H, [rowH])

  /* Both axes run past the data so the grid always fills the block. */
  const displayCols = useMemo(() => {
    const fit = Math.ceil(Math.max(0, viewport.w - GUTTER_W) / DEFAULT_COL_W) + 1
    return Math.max(nCols, fit) + extraCols
  }, [viewport.w, nCols, extraCols])

  const displayRows = useMemo(() => {
    const fit = Math.ceil(Math.max(0, viewport.h - HEAD_H) / ROW_H) + 1
    return Math.max(nRows, fit) + extraRows
  }, [viewport.h, nRows, extraRows])

  const colOff = useMemo(() => {
    const o = new Array(displayCols + 1); o[0] = 0
    for (let i = 0; i < displayCols; i++) o[i + 1] = o[i] + widthOf(i)
    return o
  }, [displayCols, widthOf])

  const rowOff = useMemo(() => {
    const o = new Array(displayRows + 1); o[0] = 0
    for (let i = 0; i < displayRows; i++) o[i + 1] = o[i] + heightOf(i)
    return o
  }, [displayRows, heightOf])

  const totalW = colOff[displayCols]
  const totalH = rowOff[displayRows]

  const headerLabel = c => (c < nCols ? headers[c] : '')
  const cellAt = (r, c) => (rows[r] && rows[r][c] != null ? String(rows[r][c]) : '')

  /* ── history ──────────────────────────────────────────────────────── */
  function snapshot() {
    undoStack.current.push({ rows: block.rows, headers: block.headers })
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
    redoStack.current = []
  }
  function undo() {
    const p = undoStack.current.pop(); if (!p) return
    redoStack.current.push({ rows: block.rows, headers: block.headers })
    setEditing(null); onUpdateBlock(block.id, { rows: p.rows, headers: p.headers })
    refocus()
  }
  function redo() {
    const n = redoStack.current.pop(); if (!n) return
    undoStack.current.push({ rows: block.rows, headers: block.headers })
    setEditing(null); onUpdateBlock(block.id, { rows: n.rows, headers: n.headers })
    refocus()
  }

  /* ── mutation ─────────────────────────────────────────────────────── */
  function writeCells(edits, minRows = 0, minCols = 0) {
    snapshot()
    let hdrs = headers
    const wantCols = Math.max(nCols, minCols)
    if (wantCols > nCols) {
      hdrs = headers.slice()
      // Blank, not the column letter — the grid already renders that above
      // every header, so filling it in duplicated the label.
      while (hdrs.length < wantCols) hdrs.push('')
    }
    const tc = hdrs.length
    let next = rows.map(r => (r.length < tc ? r.concat(Array(tc - r.length).fill('')) : r))
    while (next.length < Math.max(nRows, minRows)) next.push(Array(tc).fill(''))
    const touched = new Set()
    for (const { r, c, v } of edits) {
      if (r < 0 || c < 0 || !next[r]) continue
      if (!touched.has(r)) { next[r] = next[r].slice(); touched.add(r) }
      next[r][c] = v
    }
    const patch = { rows: next }
    if (hdrs !== headers) patch.headers = hdrs
    onUpdateBlock(block.id, patch)
  }

  /* Materialise the grid out to at least minRows × minCols.
     ------------------------------------------------------------------
     The sheet renders further than its data: a table with one real column
     still shows A through K so there's always somewhere to type. Those extra
     columns are virtual until written to.

     Every mutator below used to operate on the REAL arrays while taking an
     index from the VIRTUAL grid. Right-clicking column E on a one-column
     table called insertCols(4), and `splice(4, 0, …)` on a length-1 array
     silently clamps to the end — so the new column appeared at B, four
     columns away from where it was asked for. Same class of bug on rows.

     Padding first means the index always refers to something real, and insert
     lands exactly where the user pointed. */
  function materialise(minRows, minCols) {
    const hdrs = headers.slice()
    while (hdrs.length < minCols) hdrs.push('')
    const width = Math.max(hdrs.length, 1)
    const out = rows.map(r => (r.length < width ? r.concat(Array(width - r.length).fill('')) : r.slice()))
    while (out.length < minRows) out.push(Array(width).fill(''))
    return { hdrs, rows: out }
  }

  function insertRows(at, count = 1) {
    snapshot()
    const { hdrs, rows: base } = materialise(at, nCols)
    const width = Math.max(hdrs.length, 1)
    for (let i = 0; i < count; i++) base.splice(at, 0, Array(width).fill(''))
    onUpdateBlock(block.id, { headers: hdrs, rows: base })
  }

  function deleteRows(from, to) {
    // Deleting virtual rows is a no-op — there's nothing there to remove.
    if (from >= nRows) return
    snapshot()
    const next = rows.slice()
    next.splice(from, Math.min(to, nRows - 1) - from + 1)
    onUpdateBlock(block.id, { rows: next.length ? next : [Array(Math.max(nCols, 1)).fill('')] })
  }

  function duplicateRows(from, to) {
    if (from >= nRows) return
    snapshot()
    const hi = Math.min(to, nRows - 1)
    const next = rows.slice()
    const copy = rows.slice(from, hi + 1).map(r => r.slice())
    next.splice(hi + 1, 0, ...copy)
    onUpdateBlock(block.id, { rows: next })
  }

  function insertCols(at, count = 1) {
    snapshot()
    const { hdrs, rows: base } = materialise(nRows, at)
    for (let i = 0; i < count; i++) hdrs.splice(at, 0, '')
    const next = base.map(r => {
      const row = r.slice()
      for (let i = 0; i < count; i++) row.splice(at, 0, '')
      return row
    })
    onUpdateBlock(block.id, { headers: hdrs, rows: next })
  }

  function deleteCols(from, to) {
    if (from >= nCols) return
    snapshot()
    const hi = Math.min(to, nCols - 1)
    const hdrs = headers.slice(); hdrs.splice(from, hi - from + 1)
    const next = rows.map(r => { const row = r.slice(); row.splice(from, hi - from + 1); return row })
    onUpdateBlock(block.id, {
      headers: hdrs.length ? hdrs : [''],
      rows: hdrs.length ? next : rows.map(() => ['']),
    })
  }
  /* Committing an edit unmounts the <input>. Focus then falls back to
     document.body, which is why typing stopped after every Enter and why
     Ctrl+Z appeared broken — the keydown handler lives on the scroll
     container, and nothing was focused to deliver keys to it. Every exit path
     out of edit mode now hands focus back to the grid. */
  const refocus = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Synchronous focus would land before React removes the input, and the
    // unmounting input's blur would immediately steal it back.
    requestAnimationFrame(() => {
      if (document.activeElement !== el) el.focus({ preventScroll: true })
    })
  }, [])

  /* Set the moment an edit is abandoned, cleared by the next commit attempt.
     cancelEdit() unmounts the input, and some engines (Firefox reliably) fire
     a blur on the way out — which lands in onBlur → commitEdit and writes back
     the value Escape just discarded. `editing` doesn't protect against it: the
     onBlur closure was built on the previous render, where it was still set. */
  const cancelledRef = useRef(false)

  function commitEdit(value, move) {
    if (cancelledRef.current) { cancelledRef.current = false; return }
    if (!editing) return
    const { r, c } = editing
    if (cellAt(r, c) !== value || r >= nRows || c >= nCols) {
      writeCells([{ r, c, v: value }], r + 1, c + 1)
    }
    setEditing(null)
    refocus()
    if (move) moveTo(r + move.dr, c + move.dc)
  }

  function cancelEdit() {
    cancelledRef.current = true
    setEditing(null)
    refocus()
  }

  function clearSelection() {
    const all = [normR(sel), ...ranges.map(normR)]
    const edits = []
    all.forEach(n => {
      for (let r = n.r1; r <= Math.min(n.r2, nRows - 1); r++)
        for (let c = n.c1; c <= Math.min(n.c2, nCols - 1); c++) edits.push({ r, c, v: '' })
    })
    if (edits.length) writeCells(edits)
  }

  /* ── movement ─────────────────────────────────────────────────────── */
  const clampR = r => Math.max(0, Math.min(displayRows - 1, r))
  const clampC = c => Math.max(0, Math.min(displayCols - 1, c))

  function moveTo(r, c, extend = false) {
    const nr = clampR(r), nc = clampC(c)
    setSel(prev => extend ? { ...prev, r2: nr, c2: nc } : { r1: nr, c1: nc, r2: nr, c2: nc })
    if (!extend) setRanges([])
    scrollCellIntoView(nr, nc)
  }

  function scrollCellIntoView(r, c) {
    const el = scrollRef.current
    if (!el) return
    const top = rowOff[r] ?? 0, h = heightOf(r)
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + h > el.scrollTop + el.clientHeight - HEAD_H)
      el.scrollTop = top + h - el.clientHeight + HEAD_H
    const x = colOff[c] ?? 0, w = widthOf(c)
    if (x < el.scrollLeft) el.scrollLeft = x
    else if (x + w > el.scrollLeft + el.clientWidth - GUTTER_W)
      el.scrollLeft = x + w - el.clientWidth + GUTTER_W
  }

  function lastDataCell() {
    let lr = 0, lc = 0
    for (let r = 0; r < nRows; r++)
      for (let c = 0; c < nCols; c++)
        if (cellAt(r, c) !== '') { if (r > lr) lr = r; if (c > lc) lc = c }
    return { r: lr, c: lc }
  }

  function jump(dr, dc, extend) {
    const { r2: r, c2: c } = sel
    const filled = (rr, cc) => cellAt(rr, cc) !== ''
    if (dr) {
      let nr = r
      if (filled(r, c) && filled(r + dr, c)) { while (filled(nr + dr, c) && nr + dr >= 0 && nr + dr < nRows) nr += dr }
      else { nr = r + dr; while (nr >= 0 && nr < nRows && !filled(nr, c)) nr += dr }
      moveTo(clampR(nr), c, extend)
    } else {
      let nc = c
      if (filled(r, c) && filled(r, c + dc)) { while (filled(r, nc + dc) && nc + dc >= 0 && nc + dc < nCols) nc += dc }
      else { nc = c + dc; while (nc >= 0 && nc < nCols && !filled(r, nc)) nc += dc }
      moveTo(r, clampC(nc), extend)
    }
  }

  /* ── keyboard ─────────────────────────────────────────────────────── */
  function onKeyDown(e) {
    if (editing) return
    const { r2: r, c2: c } = sel
    const ext = e.shiftKey
    const meta = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()

    if (meta && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
    if (meta && k === 'y') { e.preventDefault(); redo(); return }
    if (meta && k === 'd') { e.preventDefault(); fillDown(); return }
    if (meta && k === 'a') {
      e.preventDefault(); setRanges([])
      setSel({ r1: 0, c1: 0, r2: Math.max(nRows - 1, 0), c2: Math.max(nCols - 1, 0) })
      return
    }

    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); meta ? jump(-1, 0, ext) : moveTo(r - 1, c, ext); return
      case 'ArrowDown':  e.preventDefault(); meta ? jump(1, 0, ext)  : moveTo(r + 1, c, ext); return
      case 'ArrowLeft':  e.preventDefault(); meta ? jump(0, -1, ext) : moveTo(r, c - 1, ext); return
      case 'ArrowRight': e.preventDefault(); meta ? jump(0, 1, ext)  : moveTo(r, c + 1, ext); return
      case 'Tab':        e.preventDefault(); moveTo(r, c + (ext ? -1 : 1)); return
      case 'Enter':      e.preventDefault(); moveTo(r + (ext ? -1 : 1), c); return
      case 'F2':         e.preventDefault(); beginEdit(r, c, cellAt(r, c), 'edit'); return
      case 'Home':       e.preventDefault(); meta ? moveTo(0, 0, ext) : moveTo(r, 0, ext); return
      case 'End': {
        e.preventDefault()
        if (meta) { const d = lastDataCell(); moveTo(d.r, d.c, ext) }
        else moveTo(r, Math.max(nCols - 1, 0), ext)
        return
      }
      case 'PageDown':   e.preventDefault(); moveTo(r + Math.floor(viewport.h / ROW_H), c, ext); return
      case 'PageUp':     e.preventDefault(); moveTo(r - Math.floor(viewport.h / ROW_H), c, ext); return
      case 'Delete':
      case 'Backspace':  e.preventDefault(); clearSelection(); return
      /* Escape backs out one level at a time, the way Excel does. This branch
         only ever runs with no cell open — line 400 returns early while
         `editing` is set, so the editor's own handler owns that level.

         Level 2: a range is selected → collapse it to the active cell.
         Level 3: nothing left here → DON'T claim the key. The canvas listener
         then takes focus back, which is the only way out of the grid.

         Claiming it unconditionally is the obvious-looking version and it's
         wrong: Escape dead-ends inside the sheet forever, because the canvas
         handler sees the flag and bails every time. */
      case 'Escape': {
        const hasRange = ranges.length > 0 || sel.r1 !== sel.r2 || sel.c1 !== sel.c2
        if (!hasRange) return
        e.nativeEvent.__dsConsumed = true
        setRanges([])
        setSel(p => ({ r1: p.r2, c1: p.c2, r2: p.r2, c2: p.c2 }))
        return
      }
      default: break
    }
    if (!meta && !e.altKey && e.key.length === 1) { e.preventDefault(); beginEdit(r, c, e.key, 'type') }
  }

  /* Excel distinguishes two states. "type" mode is entered by typing over a
     cell: arrow keys commit and move, because you're still navigating. "edit"
     mode is entered with F2 or a double-click: arrows move the caret inside
     the text. Conflating the two is why arrow keys felt wrong mid-entry. */
  function beginEdit(r, c, initial, kind = 'edit') {
    cancelledRef.current = false
    setDraft(initial)
    setEditing({ r, c, kind })
  }

  /* Ctrl+D — fill the selection down from its top row. One of the handful of
     Excel shortcuts people reach for without thinking. */
  function fillDown() {
    const m = normR(sel)
    if (m.r2 <= m.r1) return
    const edits = []
    for (let c = m.c1; c <= m.c2; c++) {
      const src = cellAt(m.r1, c)
      for (let r = m.r1 + 1; r <= m.r2; r++) edits.push({ r, c, v: src })
    }
    if (edits.length) writeCells(edits, m.r2 + 1, m.c2 + 1)
  }

  /* ── clipboard ────────────────────────────────────────────────────── */
  function onCopy(e) {
    if (editing) return
    const n = normR(sel)
    const out = []
    for (let r = n.r1; r <= n.r2; r++) {
      const line = []
      for (let c = n.c1; c <= n.c2; c++) line.push(cellAt(r, c))
      out.push(line.join('\t'))
    }
    e.preventDefault()
    e.clipboardData.setData('text/plain', out.join('\n'))
  }
  function onCut(e) { onCopy(e); clearSelection() }
  function onPaste(e) {
    if (editing) return
    e.preventDefault()
    const txt = e.clipboardData.getData('text/plain')
    if (!txt) return
    const grid = txt.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t'))
    const n = normR(sel)
    const edits = []
    let maxR = 0, maxC = 0
    grid.forEach((line, dr) => line.forEach((v, dc) => {
      const r = n.r1 + dr, c = n.c1 + dc
      edits.push({ r, c, v }); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c)
    }))
    writeCells(edits, maxR + 1, maxC + 1)
    setSel({ r1: n.r1, c1: n.c1, r2: maxR, c2: maxC })
  }

  /* ── resizing ─────────────────────────────────────────────────────── */
  function startColResize(e, ci) {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sw = widthOf(ci)
    const start = colW
    let latest = start
    const move = ev => {
      latest = { ...start, [ci]: Math.max(MIN_COL_W, sw + ev.clientX - sx) }
      setDragColW(latest)
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      commitColW(latest)
      setDragColW(null)   // block value takes over again
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  function startRowResize(e, ri) {
    e.preventDefault(); e.stopPropagation()
    const sy = e.clientY, sh = heightOf(ri)
    const start = rowH
    let latest = start
    const move = ev => {
      latest = { ...start, [ri]: Math.max(MIN_ROW_H, sh + ev.clientY - sy) }
      setDragRowH(latest)
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      commitRowH(latest)
      setDragRowH(null)
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  function autoFitCol(ci) {
    let longest = String(headerLabel(ci) || '').length
    for (let r = 0; r < nRows; r++) longest = Math.max(longest, cellAt(r, ci).length)
    commitColW({ ...colW, [ci]: Math.max(MIN_COL_W, Math.min(460, longest * 7.4 + 26)) })
  }
  function autoFitRow(ri) {
    const next = { ...rowH }; delete next[ri]
    commitRowH(next)
  }

  /* ── selection helpers ────────────────────────────────────────────── */
  const isSelected = (r, c) => inR(sel, r, c) || ranges.some(g => inR(g, r, c))

  function selectCell(r, c, e) {
    scrollRef.current?.focus()
    if (e.shiftKey) { setSel(p => ({ ...p, r2: r, c2: c })); return }
    if (e.ctrlKey || e.metaKey) { setRanges(p => [...p, sel]); setSel({ r1: r, c1: c, r2: r, c2: c }); return }
    setRanges([])
    setSel({ r1: r, c1: c, r2: r, c2: c })
  }

  /* ── scroll / windowing ───────────────────────────────────────────── */
  const onScroll = useCallback(ev => {
    const el = ev.currentTarget
    setScroll({ top: el.scrollTop, left: el.scrollLeft })
    setViewport({ w: el.clientWidth, h: el.clientHeight })
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 40) setExtraCols(n => n + AHEAD_COLS)
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setExtraRows(n => n + AHEAD_ROWS)
  }, [])

  let firstRow = 0
  while (firstRow < displayRows - 1 && rowOff[firstRow + 1] <= scroll.top) firstRow++
  firstRow = Math.max(0, firstRow - OVERSCAN_R)
  let lastRow = firstRow
  while (lastRow < displayRows && rowOff[lastRow] < scroll.top + viewport.h + 40) lastRow++
  lastRow = Math.min(displayRows, lastRow + OVERSCAN_R)

  let firstCol = 0
  while (firstCol < displayCols - 1 && colOff[firstCol + 1] <= scroll.left) firstCol++
  firstCol = Math.max(0, firstCol - OVERSCAN_C)
  let lastCol = firstCol
  while (lastCol < displayCols && colOff[lastCol] < scroll.left + viewport.w + 40) lastCol++
  lastCol = Math.min(displayCols, lastCol + OVERSCAN_C)

  const visRows = []; for (let r = firstRow; r < lastRow; r++) visRows.push(r)
  const visCols = []; for (let c = firstCol; c < lastCol; c++) visCols.push(c)

  const n = normR(sel)
  const cur = { r: sel.r2, c: sel.c2 }

  /* Live aggregates over the selection, for the status bar. Capped so that
     Ctrl+A on a 200k-row import can't stall a render — past the cap we still
     report the cell count, just not the maths. */
  const stats = useMemo(() => {
    const m = normR(sel)
    const cells = (m.r2 - m.r1 + 1) * (m.c2 - m.c1 + 1)
    let sum = 0, count = 0
    if (cells > 1 && cells <= STATS_CELL_CAP) {
      const rMax = Math.min(m.r2, nRows - 1)
      const cMax = Math.min(m.c2, nCols - 1)
      for (let r = m.r1; r <= rMax; r++) {
        const row = rows[r]
        if (!row) continue
        for (let c = m.c1; c <= cMax; c++) {
          const raw = row[c]
          if (raw == null || raw === '') continue
          const num = Number(String(raw).replace(/[\s,]/g, ''))
          if (Number.isFinite(num)) { sum += num; count++ }
        }
      }
    }
    return { cells, sum, count }
  }, [sel, rows, nRows, nCols])

  const headBase = {
    boxSizing: 'border-box', background: raised,
    borderRight: `1px solid ${border}`, borderBottom: `1px solid ${border}`,
    fontFamily: 'var(--ds-font-body)', fontSize: 11, fontWeight: 600,
    color: text2, display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', userSelect: 'none',
  }

  function ctxMenu(e, r, c) {
    e.preventDefault(); e.stopPropagation()
    if (!isSelected(r, c)) { setRanges([]); setSel({ r1: r, c1: c, r2: r, c2: c }) }
    setMenu({ x: e.clientX, y: e.clientY, r, c })
  }

  /* Menu items are plain data — a label and an action name — rather than
     closures. Building closures here put a path from render to the undo
     stack's ref (menuItems → fillDown → writeCells → snapshot →
     undoStack.current), which React's lint correctly flags: anything
     reachable during render must not read a ref. Dispatch happens in the
     click handler below, where reading refs is legal. */
  const menuItems = menu ? (() => {
    const m = normR(sel)
    const multiR = m.r2 > m.r1 ? 's' : ''
    const multiC = m.c2 > m.c1 ? 's' : ''
    return [
      { label: 'Insert row above', act: 'rowAbove', icon: 'grid-row-insert-above' },
      { label: 'Insert row below', act: 'rowBelow', icon: 'grid-row-insert-below' },
      { label: `Duplicate row${multiR}`, act: 'rowDup', icon: 'grid-row-duplicate' },
      { label: `Delete row${multiR}`, act: 'rowDel', icon: 'grid-row-delete', danger: true },
      { sep: true },
      { label: 'Insert column left', act: 'colLeft', icon: 'grid-col-insert-left' },
      { label: 'Insert column right', act: 'colRight', icon: 'grid-col-insert-right' },
      { label: `Delete column${multiC}`, act: 'colDel', icon: 'grid-col-delete', danger: true },
      { sep: true },
      { label: 'Fill down', act: 'fillDown', icon: 'grid-fill-down' },
      { label: 'Clear contents', act: 'clear', icon: 'grid-clear' },
    ]
  })() : []

  function runMenuAction(act) {
    const m = normR(sel)
    switch (act) {
      case 'rowAbove':  insertRows(m.r1, 1); break
      case 'rowBelow':  insertRows(m.r2 + 1, 1); break
      case 'rowDup':    duplicateRows(m.r1, Math.min(m.r2, nRows - 1)); break
      case 'rowDel':    deleteRows(m.r1, Math.min(m.r2, nRows - 1)); break
      case 'colLeft':   insertCols(m.c1, 1); break
      case 'colRight':  insertCols(m.c2 + 1, 1); break
      case 'colDel':    deleteCols(m.c1, Math.min(m.c2, nCols - 1)); break
      case 'fillDown':  fillDown(); break
      case 'clear':     clearSelection(); break
      default: break
    }
    refocus()
  }

  return (
    <div style={{ height: maxHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: surface }}>
      <div
        ref={scrollRef}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={() => { dragSel.current = false }}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', outline: 'none', position: 'relative', cursor: 'cell' }}>

        <div style={{ width: GUTTER_W + totalW, height: HEAD_H + totalH, position: 'relative' }}>

          {/* corner */}
          <div style={{
            ...headBase, position: 'sticky', top: 0, left: 0, zIndex: 6,
            width: GUTTER_W, height: HEAD_H, float: 'left', cursor: 'pointer',
          }}
            title="Select all"
            onMouseDown={e => { e.preventDefault(); setRanges([]); setSel({ r1: 0, c1: 0, r2: Math.max(nRows - 1, 0), c2: Math.max(nCols - 1, 0) }) }} />

          {/* column headers */}
          <div style={{ position: 'sticky', top: 0, zIndex: 5, height: HEAD_H, marginLeft: GUTTER_W }}>
            {visCols.map(c => {
              const active = c >= n.c1 && c <= n.c2
              const label = headerLabel(c)
              return (
                <div key={c}
                  style={{
                    ...headBase, position: 'absolute', left: colOff[c], top: 0,
                    width: widthOf(c), height: HEAD_H,
                    background: active ? accentDim : raised,
                    color: active ? accent : text2,
                    cursor: 'pointer', flexDirection: 'column', gap: 0, padding: '0 6px',
                    borderBottom: active ? `2px solid ${accent}` : `1px solid ${border}`,
                  }}
                  title={label || colName(c)}
                  onMouseDown={ev => { ev.preventDefault(); setRanges([]); setSel({ r1: 0, c1: c, r2: Math.max(displayRows - 1, 0), c2: c }) }}
                  onContextMenu={ev => ctxMenu(ev, 0, c)}>
                  <span style={{ fontSize: 9, lineHeight: '10px', color: active ? accent : text3, fontWeight: 600, opacity: 0.7 }}>
                    {colName(c)}
                  </span>
                  <span style={{ fontSize: 11, lineHeight: '12px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: label ? 1 : 0.3 }}>
                    {label}
                  </span>
                  <div
                    onMouseDown={ev => startColResize(ev, c)}
                    onDoubleClick={ev => { ev.stopPropagation(); autoFitCol(c) }}
                    title="Drag to resize · double-click to fit"
                    style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 7 }} />
                </div>
              )
            })}
          </div>

          {/* row gutter */}
          <div style={{ position: 'sticky', left: 0, zIndex: 4, width: GUTTER_W, float: 'left', height: totalH }}>
            {visRows.map(r => {
              const active = r >= n.r1 && r <= n.r2
              return (
                <div key={r}
                  onMouseDown={ev => { ev.preventDefault(); setRanges([]); setSel({ r1: r, c1: 0, r2: r, c2: Math.max(displayCols - 1, 0) }) }}
                  onContextMenu={ev => ctxMenu(ev, r, 0)}
                  style={{
                    ...headBase, position: 'absolute', top: rowOff[r], left: 0,
                    width: GUTTER_W, height: heightOf(r),
                    background: active ? accentDim : raised,
                    color: active ? accent : text3,
                    fontSize: 10.5, fontWeight: active ? 700 : 500,
                    fontVariantNumeric: 'tabular-nums',
                    borderRight: active ? `2px solid ${accent}` : `1px solid ${border}`,
                    cursor: 'pointer',
                  }}>
                  {r + 1}
                  <div
                    onMouseDown={ev => startRowResize(ev, r)}
                    onDoubleClick={ev => { ev.stopPropagation(); autoFitRow(r) }}
                    title="Drag to resize · double-click to fit"
                    style={{ position: 'absolute', bottom: -3, left: 0, height: 6, width: '100%', cursor: 'row-resize', zIndex: 7 }} />
                </div>
              )
            })}
          </div>

          {/* cells */}
          <div style={{ position: 'absolute', left: GUTTER_W, top: HEAD_H, width: totalW, height: totalH }}>
            {visRows.map(r => visCols.map(c => {
              const selected = isSelected(r, c)
              const isCur = r === cur.r && c === cur.c
              const isEditing = editing && editing.r === r && editing.c === c
              const w = widthOf(c), h = heightOf(r)
              const value = cellAt(r, c)
              const numeric = value !== '' && !isNaN(Number(value.replace(/,/g, '')))
              // Cross-highlight: the active row and column get a wash so you
              // can always see where the cursor is on a wide sheet.
              const cross = !selected && (r === cur.r || c === cur.c)

              if (isEditing) {
                return (
                  <input key={`${r}:${c}`}
                    ref={editorRef}
                    value={draft}
                    onChange={ev => setDraft(ev.target.value)}
                    onBlur={() => commitEdit(draft, null)}
                    onKeyDown={ev => {
                      ev.stopPropagation()
                      const m = ev.ctrlKey || ev.metaKey
                      if (ev.key === 'Enter') { ev.preventDefault(); commitEdit(draft, { dr: ev.shiftKey ? -1 : 1, dc: 0 }) }
                      else if (ev.key === 'Tab') { ev.preventDefault(); commitEdit(draft, { dr: 0, dc: ev.shiftKey ? -1 : 1 }) }
                      /* Always claimed here — there IS an edit to back out of,
                         so the canvas must not also act on this press. */
                      else if (ev.key === 'Escape') { ev.preventDefault(); ev.nativeEvent.__dsConsumed = true; cancelEdit() }
                      // Undo mid-edit abandons the edit rather than typing into it.
                      else if (m && ev.key.toLowerCase() === 'z') { ev.preventDefault(); cancelEdit() }
                      // In type mode the arrows are still navigation, as in Excel.
                      else if (editing.kind === 'type' && ev.key === 'ArrowDown') { ev.preventDefault(); commitEdit(draft, { dr: 1, dc: 0 }) }
                      else if (editing.kind === 'type' && ev.key === 'ArrowUp') { ev.preventDefault(); commitEdit(draft, { dr: -1, dc: 0 }) }
                    }}
                    style={{
                      position: 'absolute', left: colOff[c] - 1, top: rowOff[r] - 1,
                      width: Math.max(w, 170) + 2, height: h + 2, zIndex: 10, boxSizing: 'border-box',
                      border: `2px solid ${accent}`, outline: 'none', background: surface, color: text,
                      fontFamily: 'var(--ds-font-body)', fontSize: 12.5, padding: '0 5px',
                    }} />
                )
              }

              return (
                <div key={`${r}:${c}`}
                  onMouseDown={ev => { ev.preventDefault(); dragSel.current = true; selectCell(r, c, ev) }}
                  onMouseEnter={() => { if (dragSel.current) setSel(p => ({ ...p, r2: r, c2: c })) }}
                  onDoubleClick={() => beginEdit(r, c, value)}
                  onContextMenu={ev => ctxMenu(ev, r, c)}
                  style={{
                    position: 'absolute', left: colOff[c], top: rowOff[r],
                    width: w, height: h, boxSizing: 'border-box',
                    borderRight: `1px solid ${border}`, borderBottom: `1px solid ${border}`,
                    background: selected && !isCur ? accentDim : cross ? `${accent}0d` : surface,
                    boxShadow: isCur ? `inset 0 0 0 2px ${accent}` : 'none',
                    color: text, fontFamily: 'var(--ds-font-body)', fontSize: 12.5,
                    fontVariantNumeric: 'tabular-nums', padding: '0 6px',
                    display: 'flex', alignItems: 'center',
                    justifyContent: numeric ? 'flex-end' : 'flex-start',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    userSelect: 'none',
                  }}>{value}</div>
              )
            }))}
          </div>
        </div>
      </div>

      {/* Status bar.
          Was: a cell ref, a "2104 × 4" dimension glyph, then a long trailing
          string of shortcut hints strung together with · and ⌘ symbols. It
          read as decoration, cost a third of the bar's width, and told a
          returning user nothing they didn't already know.
          Now: labelled facts on the left, and — like Excel — live aggregates
          for the current selection on the right, which is the thing you
          actually want a status bar for. */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, height: 22, padding: '0 10px',
        background: raised, borderTop: `1px solid ${border}`,
        fontFamily: 'var(--ds-font-body)', fontSize: 10.5,
        fontVariantNumeric: 'tabular-nums', color: text3, userSelect: 'none',
      }}>
        <span style={{ color: accent, fontWeight: 700, minWidth: 34 }}>{colName(cur.c)}{cur.r + 1}</span>
        <span>{nRows.toLocaleString()} rows</span>
        <span>{nCols} cols</span>
        {stats.cells > 1 && <span>{stats.cells.toLocaleString()} selected</span>}
        {ranges.length > 0 && <span>{ranges.length + 1} ranges</span>}

        {stats.count > 0 && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
            <span>Sum <b style={{ color: text2, fontWeight: 600 }}>{fmtNum(stats.sum)}</b></span>
            <span>Avg <b style={{ color: text2, fontWeight: 600 }}>{fmtNum(stats.sum / stats.count)}</b></span>
            <span>Count <b style={{ color: text2, fontWeight: 600 }}>{stats.count.toLocaleString()}</b></span>
          </span>
        )}
      </div>

      {/* Context menu.

          PORTALLED to <body>, and it has to be — this is not a preference.
          The canvas renders every block inside `transform: scale()`, and a
          transformed element becomes the containing block for `position:
          fixed` descendants. So `fixed; left: e.clientX` inside the canvas is
          positioned against the CANVAS rather than the viewport, and then
          scaled on top: the menu appears somewhere near the cursor at 100%
          zoom and progressively further away at any other.

          No arithmetic fixes it. The element has to leave the transformed
          subtree, which is what a portal does. Same reason BlockPicker and the
          slash menu portal. See lib/canvasgeom.js. */}
      {menu && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: menu.y, left: menu.x, zIndex: 10000,
          background: surface, border: `1px solid ${border}`, borderRadius: 8,
          boxShadow: 'var(--ds-shadow-lg)', overflow: 'hidden', minWidth: 180,
          fontFamily: 'var(--ds-font-body)', padding: '4px 0',
        }}
          onMouseDown={e => e.stopPropagation()}>
          {menuItems.map((it, i) => it.sep
            ? <div key={i} style={{ height: 1, background: border, margin: '4px 0' }} />
            : (
              <button key={i}
                onClick={() => { runMenuAction(it.act); setMenu(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '7px 14px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--ds-font-body)', fontSize: 12,
                  color: it.danger ? 'var(--ds-red)' : text2,
                }}
                onMouseEnter={e => e.currentTarget.style.background = raised}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <Icon name={it.icon} size={14} />
                {it.label}
              </button>
            ))}
        </div>,
        document.body
      )}
    </div>
  )
}

export default memo(SheetGridInner, (a, b) =>
  a.block.rows === b.block.rows &&
  a.block.headers === b.block.headers &&
  a.block.colWidths === b.block.colWidths &&
  a.block.rowHeights === b.block.rowHeights &&
  a.block.id === b.block.id &&
  a.maxHeight === b.maxHeight &&
  a.colors === b.colors
)
