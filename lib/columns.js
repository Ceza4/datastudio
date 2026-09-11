/*
  lib/columns.js
  --------------------------------------------------------------------------
  REAL TEXT COLUMNS — one implementation, two editors.

  TextBlockContent.js and DocumentBlock.js are independent contentEditable
  implementations (DocumentBlock's own comment: "shares the contentEditable +
  execCommand foundation and nothing else"). Columns are the first structural
  element genuinely shared between both, so the HTML construction and width
  math live here once — same reasoning pagesetup.js gives for centralising
  page geometry: "Three copies of that arithmetic is three copies that can
  disagree." Each caller still does its own insertion (execCommand for a
  caret-relative insert, selection-range surgery for "turn into") — this
  module only owns building the HTML and reading/writing the width split.

  ── THE SHAPE ────────────────────────────────────────────────────────────
  <div data-type="columns" data-cols="3" style="grid-template-columns:...">
    <div class="ds-col">...editable content, no attribute needed...</div>
    <div data-type="col-divider" contenteditable="false"></div>
    <div class="ds-col">...</div>
    <div data-type="col-divider" contenteditable="false"></div>
    <div class="ds-col">...</div>
  </div>

  No nested contentEditable="true" region per column — this sits as a plain
  child of whichever single editable root already owns it (proven safe by
  TextBlockContent.js's own checklist insert, which already puts a
  contenteditable="false" checkbox inside the one editable root). The
  dividers are the only contenteditable="false" children, same idiom as that
  checkbox.

  grid-template-columns IS the stored width — no separate state field.
  Resizing writes directly to this inline style; it persists exactly the way
  every other structural insert already persists, through the ordinary
  innerHTML save path. Nothing else needs to know a resize happened.
  -------------------------------------------------------------------------- */

/** Divider track width, in CSS px. The visible gutter line and the drag hit
 *  area are the same element sized to this — see DIVIDER_PX in the shared
 *  globals.css rule for [data-type="col-divider"]. */
export const DIVIDER_PX = 18

/** A column can never be dragged narrower than this, as a percent of the
 *  row's content width (dividers excluded). Keeps a column from vanishing. */
export const MIN_COL_PCT = 10

export const MIN_COLS = 2
export const MAX_COLS = 5

function clampCount(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return MIN_COLS
  return Math.max(MIN_COLS, Math.min(MAX_COLS, v))
}

/** Build a grid-template-columns value from content-column percentages,
 *  inserting one DIVIDER_PX track between each pair. `pcts` are the CONTENT
 *  columns only — callers never pass a width for a divider track. */
export function buildTemplate(pcts) {
  return pcts
    .map((p, i) => (i < pcts.length - 1 ? `${p}% ${DIVIDER_PX}px` : `${p}%`))
    .join(' ')
}

/** Even split for a fresh N-column row. */
export function evenWidths(n) {
  n = clampCount(n)
  const base = 100 / n
  return Array.from({ length: n }, () => base)
}

/** The fresh-insert HTML for an N-column row. `bodies`, if given, is an
 *  array of inner-HTML strings (one per column) — used by columnsFromNodes
 *  below; a plain insert from the slash menu / ribbon omits it and gets N
 *  empty columns. */
export function columnsHtml(n, bodies) {
  n = clampCount(n)
  const widths = evenWidths(n)
  let inner = ''
  for (let i = 0; i < n; i++) {
    const body = (bodies && bodies[i] && bodies[i].length) ? bodies[i] : '<div><br></div>'
    inner += `<div class="ds-col">${body}</div>`
    if (i < n - 1) inner += '<div data-type="col-divider" contenteditable="false"></div>'
  }
  const template = buildTemplate(widths.map(w => w.toFixed(2)))
  return `<div data-type="columns" data-cols="${n}" style="grid-template-columns:${template}">${inner}</div>`
}

/** "Turn into columns": distribute an ordered list of top-level nodes'
 *  outerHTML across N columns, round-robin — node 1 → column 1, node 2 →
 *  column 2, wrapping back to column 1 after N. Matches how Notion's own
 *  turn-into actually behaves, and it's simpler than "split evenly by
 *  length," which has no good answer for one long paragraph and three short
 *  ones. Any bucket that ends up with nothing still gets a real empty
 *  paragraph (via columnsHtml's own bodies fallback) rather than being
 *  visually blank with no caret target. */
export function columnsFromNodes(nodeHtmls, n) {
  n = clampCount(n)
  const buckets = Array.from({ length: n }, () => [])
  nodeHtmls.forEach((html, i) => buckets[i % n].push(html))
  return columnsHtml(n, buckets.map(b => b.join('')))
}

/** Direct children of `root` that the selection Range touches — the
 *  "selected paragraphs" turn-into acts on. Deliberately tag-agnostic (not
 *  just <p>): a contentEditable root's top-level children are <div>s as
 *  often as <p>s depending on the browser, and a heading or a blockquote
 *  must round-trip through turn-into with its formatting intact, not get
 *  flattened to plain text. */
export function nodesInRange(root, range) {
  if (!root || !range) return []
  return Array.from(root.children).filter(el => {
    try { return range.intersectsNode(el) } catch { return false }
  })
}

export function isColumnsRow(el) {
  return el?.closest?.('[data-type="columns"]') || null
}

export function isColumnBody(el) {
  return el?.closest?.('.ds-col') || null
}

/** Parse the content-column percentages back out of a row's own
 *  grid-template-columns — the divider tracks (fixed px) are skipped. Used
 *  by the resize-drag handler to seed its starting widths. */
export function readWidths(rowEl) {
  const raw = (rowEl?.style?.gridTemplateColumns || '').trim()
  if (!raw) return []
  return raw
    .split(/\s+/)
    .filter(tok => tok.endsWith('%'))
    .map(tok => parseFloat(tok))
}

/** Clamp each width to MIN_COL_PCT and renormalise the set back to exactly
 *  100, then write the result to the row's grid-template-columns. Returns
 *  the normalised widths, in case the caller wants them (the drag handler
 *  doesn't need to — it recomputes from the pointer on every move — but a
 *  future "distribute evenly" reset button would). */
export function writeWidths(rowEl, pcts) {
  const clamped = pcts.map(w => Math.max(MIN_COL_PCT, w))
  const sum = clamped.reduce((a, b) => a + b, 0) || 1
  const norm = clamped.map(w => (w / sum) * 100)
  rowEl.style.gridTemplateColumns = buildTemplate(norm.map(w => w.toFixed(2)))
  return norm
}

/** Boundary probe for Backspace-at-start-of-column, same technique
 *  TextBlockContent.js already uses for the checklist case: measured with a
 *  Range rather than an offset comparison, because the column can hold
 *  several text nodes (a bold run, a link) and startOffset===0 is true at
 *  the start of ANY of them, not only the first. */
export function isCaretAtColumnStart(colEl, range) {
  if (!colEl || !range || !range.collapsed) return false
  const probe = document.createRange()
  probe.setStart(colEl, 0)
  probe.setEnd(range.startContainer, range.startOffset)
  return probe.toString().length === 0
}

/** True once every column in the row has no text left — the trigger to
 *  collapse the whole structure back to a single empty paragraph, the same
 *  shape the checklist's own empty-item collapse already uses. */
export function isColumnsRowEmpty(rowEl) {
  const cols = rowEl?.querySelectorAll?.(':scope > .ds-col')
  if (!cols || !cols.length) return true
  return Array.from(cols).every(col => !(col.textContent || '').trim())
}
