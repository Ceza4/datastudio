/*
  lib/columns.js
  --------------------------------------------------------------------------
  REAL TEXT COLUMNS: one implementation, two editors (Notes and Document).

  TextBlockContent.js and DocumentBlock.js are both contentEditable +
  execCommand editors. Columns are the one structure they share, so everything
  that is not React wiring lives here: the markup, the width maths, the repair
  pass, removing a column, and the keyboard handling at column edges. Each
  editor calls handleColumnKeyDown() at the top of its keydown handler and
  normalizeColumnRows() after load and after every input.

  ── REBUILT 24 SEP 2026, AND WHY ─────────────────────────────────────────
  The old version did not survive a reload. Its column bodies were
  `<div class="ds-col">` and its widths were an inline grid-template-columns,
  and lib/sanitize.js's editor profile drops `class` and did not allow
  grid-template-columns. So on the next load, every row came back as an
  unstyled grid with no template: the columns stacked, lost their widths, and
  the caret logic (which looked for .ds-col) stopped recognising them. What
  was left looked like text pushed around by spacing, because that is all it
  was.

  It also sized tracks in % with fixed-px dividers between them, so a
  2-column row was 100% + 18px wide and overflowed its box.

  ── THE SHAPE ────────────────────────────────────────────────────────────
  <div data-type="columns" data-cols="3"
       style="grid-template-columns:minmax(0,1fr) 18px minmax(0,1fr) 18px minmax(0,1fr)">
    <div data-type="col">...editable content...</div>
    <div data-type="col-divider" contenteditable="false"></div>
    <div data-type="col">...</div>
    <div data-type="col-divider" contenteditable="false"></div>
    <div data-type="col">...</div>
  </div>

  · Everything the layout depends on is a data-type attribute (which the
    editor profile keeps) or grid-template-columns (which it now keeps too;
    see lib/sanitize.js). Nothing depends on class.
  · Tracks are `minmax(0, Nfr)`: fr divides what is LEFT after the dividers,
    so the row is exactly its container's width at any size, and minmax(0,…)
    lets a long unbroken word wrap instead of widening its track.
  · The row is the container. Columns are its only content children, with
    dividers strictly between them. normalizeColumnRows() enforces that after
    every edit, because contentEditable will happily delete a divider, merge
    two columns, or leave a stray text node in the grid.

  ── DECIDED (24 Sep 2026) ────────────────────────────────────────────────
  · No drag-and-drop of lines into or out of columns for now.
  · Resizing stops at MIN_COL_PCT. A column is removed by emptying it and
    pressing Backspace (or Delete) in it, never by dragging it shut.
  · Up on a column's first line / Down on its last line leaves the row.
  · Notes and Document behave identically: both use this file.
  -------------------------------------------------------------------------- */

/** Divider track width, in CSS px. The visible gutter line and the drag hit
 *  area are the same element; see [data-type="col-divider"] in globals.css. */
export const DIVIDER_PX = 18

/** A column can never be dragged narrower than this, as a percent of the
 *  row's content width (dividers excluded). */
export const MIN_COL_PCT = 10

export const MIN_COLS = 2
export const MAX_COLS = 5

/* Legacy rows used class="ds-col". Live ones in an open editor can still
   carry it until the next normalise, so both are recognised. */
const COL_SELECTOR = '[data-type="col"], .ds-col'

function clampCount(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return MIN_COLS
  return Math.max(MIN_COLS, Math.min(MAX_COLS, v))
}

const round2 = n => Math.round(n * 100) / 100

/** grid-template-columns from content-column weights (any scale; they are
 *  fr). One DIVIDER_PX track goes between each pair. */
export function buildTemplate(weights) {
  return weights.map(w => `minmax(0,${round2(Number(w) || 0)}fr)`).join(` ${DIVIDER_PX}px `)
}

/** Even split for a fresh N-column row, as percentages summing to 100. */
export function evenWidths(n) {
  n = clampCount(n)
  return Array.from({ length: n }, () => 100 / n)
}

const EMPTY_PARA = '<div><br></div>'

/** Fresh N-column row. `bodies`, if given, is one inner-HTML string per
 *  column (used by columnsFromNodes). */
export function columnsHtml(n, bodies) {
  n = clampCount(n)
  let inner = ''
  for (let i = 0; i < n; i++) {
    const body = (bodies && bodies[i] && bodies[i].length) ? bodies[i] : EMPTY_PARA
    inner += `<div data-type="col">${body}</div>`
    if (i < n - 1) inner += '<div data-type="col-divider" contenteditable="false"></div>'
  }
  return `<div data-type="columns" data-cols="${n}" style="grid-template-columns:${buildTemplate(evenWidths(n))}">${inner}</div>`
}

/** "Turn into columns": round-robin the given top-level nodes across N
 *  columns, the way Notion's turn-into does. */
export function columnsFromNodes(nodeHtmls, n) {
  n = clampCount(n)
  const buckets = Array.from({ length: n }, () => [])
  nodeHtmls.forEach((html, i) => buckets[i % n].push(html))
  return columnsHtml(n, buckets.map(b => b.join('')))
}

/** Direct children of `root` that the selection Range touches. */
export function nodesInRange(root, range) {
  if (!root || !range) return []
  return Array.from(root.children).filter(el => {
    try { return range.intersectsNode(el) } catch { return false }
  })
}

/* ── structure queries ─────────────────────────────────────────────────── */

export function isColumnsRow(el) {
  return el?.closest?.('[data-type="columns"]') || null
}

/** The column body containing `el`, or null. Always the NEAREST row's column:
 *  a row is never nested in another row (normalise unwraps that). */
export function isColumnBody(el) {
  return el?.closest?.(COL_SELECTOR) || null
}

const isDivider = el => el?.nodeType === 1 && el.getAttribute('data-type') === 'col-divider'
const isColEl = el => el?.nodeType === 1 && (el.getAttribute('data-type') === 'col' || el.classList.contains('ds-col'))

/** A row's column bodies, in order. */
export function columnsOf(row) {
  return row ? Array.from(row.children).filter(isColEl) : []
}

/** Content-column weights as percentages summing to 100, parsed from the
 *  row's own grid-template-columns. Reads the current `Nfr` form and the
 *  legacy `N%` form; the px divider tracks are skipped. */
export function readWidths(rowEl) {
  const raw = rowEl?.style?.gridTemplateColumns || ''
  const out = []
  const re = /(\d+(?:\.\d+)?)(fr|%)/g
  let m
  while ((m = re.exec(raw))) out.push(parseFloat(m[1]))
  const sum = out.reduce((a, b) => a + b, 0)
  if (!out.length || !(sum > 0)) return []
  return out.map(w => (w / sum) * 100)
}

/** Clamp each width to MIN_COL_PCT, renormalise to 100, write the template.
 *  Returns the widths written. */
export function writeWidths(rowEl, pcts) {
  const clamped = pcts.map(w => Math.max(MIN_COL_PCT, Number(w) || 0))
  const sum = clamped.reduce((a, b) => a + b, 0) || 1
  const norm = clamped.map(w => (w / sum) * 100)
  const tpl = buildTemplate(norm)
  if (rowEl.style.gridTemplateColumns !== tpl) rowEl.style.gridTemplateColumns = tpl
  rowEl.setAttribute('data-cols', String(norm.length))
  return norm
}

/** Move the divider between columns idx and idx+1 by dPct. Only that pair
 *  changes, their combined width is preserved, and each stays at or above
 *  MIN_COL_PCT, so dragging hard to one side stops at the minimum instead of
 *  squeezing the rest of the row. */
export function resizePair(widths, idx, dPct) {
  const w = widths.slice()
  if (idx < 0 || idx + 1 >= w.length) return w
  const total = w[idx] + w[idx + 1]
  const a = Math.min(total - MIN_COL_PCT, Math.max(MIN_COL_PCT, w[idx] + dPct))
  w[idx] = a
  w[idx + 1] = total - a
  return w
}

/* Anything that is content even with no text in it. */
const SOLID = 'img,hr,input,table,pre,video,iframe,[data-type="checklist"],[data-ds-pagebreak]'

/** True when a column has nothing in it: no text and no media. */
export function isColumnEmpty(col) {
  if (!col) return true
  if ((col.textContent || '').replace(/​/g, '').trim()) return false
  return !col.querySelector(SOLID)
}

/** True once every column in the row is empty. */
export function isColumnsRowEmpty(rowEl) {
  const cols = columnsOf(rowEl)
  return !cols.length || cols.every(isColumnEmpty)
}

/* ── repair ────────────────────────────────────────────────────────────────

   contentEditable does not know this structure exists. Select across two
   columns and press Delete and the browser merges them, drops the divider,
   or leaves a bare text node sitting directly in the grid. Paste can do the
   same. So after every input (and on load) each row is put back into its
   one legal shape. This is cheap when nothing is wrong: it reads children
   and only writes when something differs, so it never touches the caret in
   the normal case. */

function unwrapRow(row, doc) {
  const cols = columnsOf(row)
  const frag = doc.createDocumentFragment()
  for (const col of cols) while (col.firstChild) frag.appendChild(col.firstChild)
  if (!frag.childNodes.length) {
    const p = doc.createElement('div'); p.innerHTML = '<br>'; frag.appendChild(p)
  }
  const first = frag.firstChild
  row.replaceWith(frag)
  return first
}

function normalizeRow(row, doc) {
  let changed = false

  /* A row nested inside a column (a paste of a row into a row) is flattened
     into that column: nested grids are not a supported shape. */
  for (const inner of Array.from(row.querySelectorAll('[data-type="columns"]'))) {
    unwrapRow(inner, doc); changed = true
  }

  /* Adopt strays: any direct child that is neither a column nor a divider
     (a text node, a <div> the browser moved up a level) joins the column
     before it, or the first column if it came first. */
  let lastCol = null
  /* A LEGACY row (saved before the rebuild) lost class="ds-col" to the
     sanitizer, so its columns come back as plain <div>s with nothing marking
     them. Only in a row with NO recognised column is a plain <div> taken
     to be one. In a live row, a plain <div> is a paragraph the browser
     moved up a level, and it is adopted instead. */
  const legacy = !Array.from(row.children).some(isColEl)
  for (const node of Array.from(row.childNodes)) {
    if (isColEl(node)) {
      if (node.getAttribute('data-type') !== 'col') { node.setAttribute('data-type', 'col'); changed = true }
      if (node.classList.contains('ds-col')) { node.classList.remove('ds-col'); if (!node.className) node.removeAttribute('class'); changed = true }
      lastCol = node
      continue
    }
    if (isDivider(node)) continue
    if (node.nodeType === 3 && !node.textContent.trim()) { node.remove(); changed = true; continue }
    /* A legacy row's column lost its class to the sanitizer: a plain <div>
       directly in a row that has no recognised columns yet IS a column. */
    if (legacy && node.nodeType === 1 && node.tagName === 'DIV' && !node.getAttribute('data-type')) {
      node.setAttribute('data-type', 'col'); lastCol = node; changed = true; continue
    }
    let host = lastCol
    if (!host) {
      host = doc.createElement('div'); host.setAttribute('data-type', 'col')
      row.insertBefore(host, node); lastCol = host
    }
    host.appendChild(node); changed = true
  }

  const cols = columnsOf(row)
  if (cols.length < 2) {
    unwrapRow(row, doc)
    return true
  }

  /* Exactly one divider between each pair and none at the ends. */
  const want = []
  cols.forEach((c, i) => { want.push(c); if (i < cols.length - 1) want.push('div') })
  const have = Array.from(row.children)
  const shapeOk = have.length === want.length &&
    have.every((el, i) => (want[i] === 'div' ? isDivider(el) : el === want[i]))
  if (!shapeOk) {
    for (const d of Array.from(row.children)) if (isDivider(d)) d.remove()
    cols.forEach((c, i) => {
      if (i < cols.length - 1) {
        const d = doc.createElement('div')
        d.setAttribute('data-type', 'col-divider'); d.setAttribute('contenteditable', 'false')
        c.after(d)
      }
    })
    changed = true
  }

  /* Every column keeps somewhere for the caret to land. */
  for (const c of cols) {
    if (!c.firstChild) { c.innerHTML = EMPTY_PARA; changed = true }
  }

  let widths = readWidths(row)
  if (widths.length !== cols.length) { widths = evenWidths(cols.length); changed = true }
  const before = row.style.gridTemplateColumns
  writeWidths(row, widths)
  if (row.style.gridTemplateColumns !== before) changed = true
  return changed
}

/** Repair every columns row under `root`. Returns true if anything changed
 *  (the caller then persists). */
export function normalizeColumnRows(root) {
  if (!root?.querySelectorAll) return false
  const doc = root.ownerDocument || document
  let changed = false
  /* Outermost first; a nested row is handled by its parent's pass. */
  const rows = Array.from(root.querySelectorAll('[data-type="columns"]'))
    .filter(r => !r.parentElement?.closest?.('[data-type="columns"]'))
  for (const row of rows) if (normalizeRow(row, doc)) changed = true
  return changed
}

/* ── caret helpers ─────────────────────────────────────────────────────── */

/** Put the caret at the start or end of `node`'s contents. */
export function placeCaret(node, atEnd, sel = window.getSelection()) {
  if (!node || !sel) return
  const doc = node.ownerDocument || document
  const r = doc.createRange()
  /* Descend to the deepest first/last child, so the caret lands INSIDE the
     paragraph rather than between block elements, where typing would create
     an anonymous text node. */
  let target = node
  while (target.nodeType === 1 && target.childNodes.length && !['BR', 'IMG', 'HR', 'INPUT'].includes(target.tagName)) {
    const next = atEnd ? target.lastChild : target.firstChild
    if (next.nodeType === 1 && ['BR', 'IMG', 'HR', 'INPUT'].includes(next.tagName)) break
    target = next
  }
  r.selectNodeContents(target)
  /* An empty paragraph is <div><br></div>. After the <br> is a SECOND line
     in Chrome, so an empty line always takes the caret at its start. */
  const onlyBr = target.nodeType === 1 && target.childNodes.length === 1 && target.firstChild.nodeName === 'BR'
  r.collapse(!atEnd || onlyBr)
  sel.removeAllRanges()
  sel.addRange(r)
}

/** Caret at the very start of the column's text, measured with a Range so a
 *  bold run or a link at the start does not fool an offset check. */
export function isCaretAtColumnStart(colEl, range) {
  if (!colEl || !range || !range.collapsed) return false
  const probe = (colEl.ownerDocument || document).createRange()
  probe.setStart(colEl, 0)
  probe.setEnd(range.startContainer, range.startOffset)
  return probe.toString().length === 0
}

/** Mirror of isCaretAtColumnStart for the end. */
export function isCaretAtColumnEnd(colEl, range) {
  if (!colEl || !range || !range.collapsed) return false
  const probe = (colEl.ownerDocument || document).createRange()
  probe.setStart(range.endContainer, range.endOffset)
  probe.setEnd(colEl, colEl.childNodes.length)
  return probe.toString().length === 0
}

function caretRect(range) {
  const rects = range.getClientRects()
  if (rects.length) return rects[rects.length - 1]
  /* A caret on an empty line has no rects. Measure the line's element. */
  let n = range.startContainer
  if (n.nodeType === 1 && n.childNodes[range.startOffset]) n = n.childNodes[range.startOffset]
  if (n.nodeType !== 1) n = n.parentElement
  return n?.getBoundingClientRect?.() || null
}

function edgeTextRect(col, atStart) {
  const doc = col.ownerDocument || document
  const walker = doc.createTreeWalker(col, 4 /* SHOW_TEXT */, {
    acceptNode: t => (t.textContent.trim() ? 1 : 3),
  })
  let first = walker.nextNode(), last = first
  if (!atStart) { let t; while ((t = walker.nextNode())) last = t }
  const node = atStart ? first : last
  if (!node) return null
  const r = doc.createRange()
  const off = atStart ? 0 : node.textContent.length
  r.setStart(node, off); r.setEnd(node, off)
  const rects = r.getClientRects()
  return rects.length ? rects[0] : null
}

/** Is the caret on the first visual line of the column? Compared by position,
 *  because a wrapped paragraph is one node and several lines. */
export function isOnFirstLine(col, range) {
  const c = caretRect(range)
  const f = edgeTextRect(col, true)
  if (!c || !f) return true
  return c.top < f.top + Math.max(4, f.height / 2)
}

export function isOnLastLine(col, range) {
  const c = caretRect(range)
  const l = edgeTextRect(col, false)
  if (!c || !l) return true
  return c.bottom > l.bottom - Math.max(4, l.height / 2)
}

/* ── removing a column ─────────────────────────────────────────────────── */

/**
 * Remove `col` from its row and put the caret in a neighbour. The remaining
 * columns share the freed width in proportion to their widths. At one
 * column left, the row dissolves and its content becomes ordinary
 * paragraphs in place.
 *
 * @param {'prev'|'next'} prefer which neighbour gets the caret
 */
export function removeColumn(col, prefer = 'prev', sel = window.getSelection()) {
  const row = isColumnsRow(col)
  if (!row) return false
  const doc = row.ownerDocument || document
  const cols = columnsOf(row)
  const i = cols.indexOf(col)
  if (i < 0) return false
  const widths = readWidths(row)

  const prev = cols[i - 1], next = cols[i + 1]
  const target = prefer === 'next' ? (next || prev) : (prev || next)
  const atEnd = target === prev
  if (!target.firstChild) target.innerHTML = EMPTY_PARA
  const caretNode = atEnd ? target.lastChild : target.firstChild

  /* The divider that goes is the one on the removed column's left, or on its
     right when it is the first column. */
  const divider = isDivider(col.previousElementSibling) ? col.previousElementSibling
    : isDivider(col.nextElementSibling) ? col.nextElementSibling : null
  divider?.remove()
  col.remove()

  if (cols.length - 1 < 2) {
    unwrapRow(row, doc)
  } else {
    const w = widths.length === cols.length ? widths.filter((_, j) => j !== i) : evenWidths(cols.length - 1)
    writeWidths(row, w)
  }
  placeCaret(caretNode, atEnd, sel)
  return true
}

/* ── the keyboard ──────────────────────────────────────────────────────────

   The browser's caret movement knows nothing about a grid track. Left at the
   start of column 2 goes wherever the DOM order says, which can be the
   divider (uneditable), and Backspace there merges two columns into a mess.
   So every key that can cross a column edge is handled here explicitly,
   and ONLY at the edge. Everywhere else in a column the browser does what it
   always does. Modified keys (Shift for selection, Ctrl/Alt word jumps) are
   left to the browser.

   Returns { handled, changed }. `changed` means the DOM structure changed and
   the caller should persist. */

/* Something the caret can sit in as text. A rule, an image, another columns
   row, a page break or an uneditable island is not: the caret gets a fresh
   empty line next to the row instead. */
function caretable(el) {
  if (!el || el.nodeType !== 1) return false
  if (['HR', 'IMG', 'TABLE'].includes(el.tagName)) return false
  if (el.getAttribute('contenteditable') === 'false') return false
  if (el.matches('[data-type="columns"], [data-ds-pagebreak]')) return false
  return true
}

function paraBeside(row, side) {
  const doc = row.ownerDocument || document
  let sib = side === 'before' ? row.previousElementSibling : row.nextElementSibling
  if (!caretable(sib)) {
    sib = doc.createElement('div'); sib.innerHTML = '<br>'
    side === 'before' ? row.before(sib) : row.after(sib)
    return { el: sib, created: true }
  }
  return { el: sib, created: false }
}

export function handleColumnKeyDown(e, sel = window.getSelection()) {
  const none = { handled: false, changed: false }
  const key = e.key
  if (!['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return none
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return none
  if (!sel?.rangeCount) return none
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return none

  const node = range.startContainer
  const el = node.nodeType === 3 ? node.parentElement : node
  const col = isColumnBody(el)
  if (!col) return none
  const row = isColumnsRow(col)
  if (!row) return none
  /* A checklist item has its own Backspace handling in the editors. */
  if ((key === 'Backspace' || key === 'Delete') && el?.closest?.('[data-type="checklist"]') && !isColumnEmpty(col)) return none

  const cols = columnsOf(row)
  const i = cols.indexOf(col)
  const prev = cols[i - 1], next = cols[i + 1]
  const stop = r => { e.preventDefault(); e.stopPropagation?.(); return r }

  switch (key) {
    case 'Backspace': {
      if (!isCaretAtColumnStart(col, range)) return none
      if (isColumnEmpty(col)) { removeColumn(col, 'prev', sel); return stop({ handled: true, changed: true }) }
      /* Never merge across a column edge. Hop to the end of the previous
         column; in the first column there is nothing to do. */
      if (prev) placeCaret(prev, true, sel)
      return stop({ handled: true, changed: false })
    }
    case 'Delete': {
      if (!isCaretAtColumnEnd(col, range)) return none
      if (isColumnEmpty(col)) { removeColumn(col, 'next', sel); return stop({ handled: true, changed: true }) }
      if (next) placeCaret(next, false, sel)
      return stop({ handled: true, changed: false })
    }
    case 'ArrowLeft': {
      if (!isCaretAtColumnStart(col, range)) return none
      if (prev) { placeCaret(prev, true, sel); return stop({ handled: true, changed: false }) }
      const { el: p, created } = paraBeside(row, 'before')
      placeCaret(p, true, sel)
      return stop({ handled: true, changed: created })
    }
    case 'ArrowRight': {
      if (!isCaretAtColumnEnd(col, range)) return none
      if (next) { placeCaret(next, false, sel); return stop({ handled: true, changed: false }) }
      const { el: p, created } = paraBeside(row, 'after')
      placeCaret(p, false, sel)
      return stop({ handled: true, changed: created })
    }
    case 'ArrowUp': {
      if (!isOnFirstLine(col, range)) return none
      const { el: p, created } = paraBeside(row, 'before')
      placeCaret(p, true, sel)
      return stop({ handled: true, changed: created })
    }
    case 'ArrowDown': {
      if (!isOnLastLine(col, range)) return none
      const { el: p, created } = paraBeside(row, 'after')
      placeCaret(p, false, sel)
      return stop({ handled: true, changed: created })
    }
  }
  return none
}
