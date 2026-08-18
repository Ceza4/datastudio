/*
  lib/pdfextract.js
  --------------------------------------------------------------------------
  Turning a page's text runs into structure: lines, paragraphs and tables.

  WHAT pdf.js ACTUALLY GIVES YOU
  Not paragraphs. Not even reliably words. `getTextContent()` returns a flat
  list of runs, each with a position, in whatever order the producer wrote
  them — which is frequently not reading order. A PDF has no idea what a
  paragraph is; it's a list of instructions for putting marks on paper.

  So everything below is inference from geometry, and the honest framing is
  that it's a heuristic that works well on ordinary documents and will
  sometimes be wrong on unusual ones. That's why the extract panel shows a
  preview before creating a block: the user confirms the guess rather than
  discovering it afterwards.

  WHY THIS IS A SEPARATE, PURE FILE
  It takes plain objects and returns plain objects. No pdf.js, no DOM, no
  canvas. Which means the part of the PDF feature that involves the most
  guesswork is also the part that can be tested most thoroughly — synthetic
  pages with known structure, asserted exactly. Given how much of this feature
  can't be run outside a browser, that trade is worth making deliberately.

  COORDINATES ARE PDF SPACE
  y increases UPWARD, so "the next line down" is a SMALLER y. Getting that
  backwards silently reverses every document, which is the kind of bug that
  looks like a parsing failure rather than a sign error.
  -------------------------------------------------------------------------- */

/**
 * A run of text with a position, as produced by lib/pdfdoc.js.
 * Returns null when the run has no usable position.
 *
 * The absent-transform case matters more than it looks. Defaulting to a zero
 * matrix gives x=0, y=0 — finite numbers that survive every downstream check,
 * so a positionless run is silently PLACED at the page origin instead of
 * dropped. It then anchors a phantom line at the bottom-left corner and drags
 * the paragraph grouping around it. The discriminator has to be "was a
 * transform supplied", not "is the position zero", because (0,0) is a legal
 * position that simply never occurs for real text.
 */
const itemGeom = it => {
  const t = it?.transform
  if (!Array.isArray(t) || t.length < 6) return null
  const size = Math.abs(t[3]) || Math.abs(it.height) || 10
  return {
    str: it.str ?? '',
    x: t[4],
    y: t[5],                       // BASELINE, not the top
    w: Number(it.width) || 0,
    h: Number(it.height) || size,
    size,
    font: it.fontName || '',
    hasEOL: !!it.hasEOL,
  }
}

/* ── lines ───────────────────────────────────────────────────────────── */

/**
 * Group runs onto shared baselines.
 *
 * The tolerance scales with font size rather than being fixed: 2pt is
 * generous for 8pt footnotes and far too tight for a 32pt heading whose runs
 * can sit a point or two apart from kerning adjustments.
 */
export function groupIntoLines(items, { tolerance = 0.5 } = {}) {
  const runs = (items || [])
    .map(itemGeom)
    .filter(r => r && r.str !== '' && Number.isFinite(r.x) && Number.isFinite(r.y))

  if (!runs.length) return []

  // Tallest first, so a line's tolerance is set by its dominant type size and
  // a stray superscript can't define the band.
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x)

  const lines = []
  for (const r of sorted) {
    const tol = Math.max(1, r.size * tolerance)
    const line = lines.find(l => Math.abs(l.baseline - r.y) <= Math.max(tol, l.size * tolerance))
    if (line) {
      line.runs.push(r)
      line.size = Math.max(line.size, r.size)
    } else {
      lines.push({ baseline: r.y, size: r.size, runs: [r] })
    }
  }

  for (const l of lines) {
    l.runs.sort((a, b) => a.x - b.x)      // reading order within the line
    l.text = joinRuns(l.runs)
    l.x0 = Math.min(...l.runs.map(r => r.x))
    l.x1 = Math.max(...l.runs.map(r => r.x + r.w))
    l.top = l.baseline + l.size
  }

  // Top of the page downward — descending y, because y increases upward.
  return lines.sort((a, b) => b.baseline - a.baseline)
}

/**
 * Join runs into a string, inserting spaces where the geometry implies one.
 *
 * PDFs routinely emit "Hello" as three runs with no spaces, positioning each
 * fragment absolutely. Concatenating naively gives "Hello"; concatenating with
 * spaces everywhere gives "H e llo". The gap has to be measured.
 *
 * A quarter of the font size is the threshold — comfortably wider than
 * kerning, comfortably narrower than a real space at any size.
 */
function joinRuns(runs) {
  let out = ''
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (i > 0) {
      const prev = runs[i - 1]
      const gap = r.x - (prev.x + prev.w)
      const needsSpace = gap > r.size * 0.25
      const alreadySpaced = /\s$/.test(out) || /^\s/.test(r.str)
      if (needsSpace && !alreadySpaced) out += ' '
    }
    out += r.str
  }
  return out.replace(/\s+/g, ' ').trim()
}

/* ── paragraphs ──────────────────────────────────────────────────────── */

/**
 * Group lines into paragraphs by comparing each gap to the document's own
 * typical line spacing.
 *
 * The modal gap is used rather than the mean: one large gap between sections
 * drags a mean far enough that every subsequent paragraph break is missed.
 */
export function groupIntoParagraphs(lines, { gapFactor = 1.6 } = {}) {
  if (!lines?.length) return []

  const gaps = []
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].baseline - lines[i].baseline)
  const typical = modal(gaps) || (lines[0].size * 1.2)

  const paras = []
  let cur = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const gap = i === 0 ? 0 : lines[i - 1].baseline - line.baseline
    /* An indent starts a paragraph even when the spacing doesn't change —
       that's how most printed prose marks them. */
    const indented = cur && line.x0 > cur.x0 + line.size * 0.8
    const bigGap = i > 0 && gap > typical * gapFactor

    if (!cur || bigGap || indented) {
      cur = { lines: [line], x0: line.x0, x1: line.x1, top: line.top, bottom: line.baseline }
      paras.push(cur)
    } else {
      cur.lines.push(line)
      cur.x0 = Math.min(cur.x0, line.x0)
      cur.x1 = Math.max(cur.x1, line.x1)
      cur.bottom = line.baseline
    }
  }

  for (const p of paras) {
    /* Joined with spaces, not newlines: a line break inside a paragraph is a
       typesetting artefact, not authored structure. De-hyphenate across
       breaks, since "manage-\nment" should come back as one word. */
    p.text = p.lines
      .map((l, i) => (i < p.lines.length - 1 && /[a-z]-$/.test(l.text) ? l.text.slice(0, -1) : l.text + ' '))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return paras
}

/** The most common value, rounded to the nearest point. */
function modal(values) {
  if (!values?.length) return 0
  const counts = new Map()
  for (const v of values) {
    const k = Math.round(v)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  let best = 0, bestN = 0
  for (const [k, n] of counts) if (n > bestN || (n === bestN && k < best)) { best = k; bestN = n }
  return best
}

/* ── tables ──────────────────────────────────────────────────────────── */

/**
 * Look for a tabular region.
 *
 * Ruling lines are NOT used. Plenty of tables have no borders at all, and
 * pdf.js reports rules as graphics operations rather than text, so relying on
 * them would fail on exactly the tables people most want extracted. Instead
 * the signal is alignment: a table is a set of rows whose runs start at the
 * same handful of x-positions.
 *
 * @returns {{ok:true, headers, rows, columns, bbox}|{ok:false, reason}}
 */
export function detectTable(lines, { minRows = 3, minCols = 2, tolerance = 6 } = {}) {
  if (!lines?.length) return { ok: false, reason: 'No text on this page.' }

  const candidates = lines.filter(l => l.runs.length >= minCols)
  if (candidates.length < minRows) {
    return { ok: false, reason: 'No rows with enough separate columns to look like a table.' }
  }

  /* Cluster the left edges of every run. A column shows up as an x-position
     many different rows share. */
  const starts = []
  for (const l of candidates) for (const r of l.runs) starts.push(r.x)
  const columns = clusterPositions(starts, tolerance)
    .filter(c => c.count >= Math.max(2, Math.floor(candidates.length * 0.5)))
    .sort((a, b) => a.value - b.value)

  if (columns.length < minCols) {
    return { ok: false, reason: 'Text on this page doesn’t line up into columns.' }
  }

  /* Only rows that actually populate the detected columns count. A paragraph
     that happens to sit above a table would otherwise become a row of one
     very wide cell. */
  const rows = []
  for (const l of candidates) {
    const cells = new Array(columns.length).fill('')
    let filled = 0
    for (const r of l.runs) {
      const idx = nearestColumn(columns, r.x, tolerance)
      if (idx < 0) continue
      cells[idx] = cells[idx] ? `${cells[idx]} ${r.str}`.replace(/\s+/g, ' ').trim() : r.str.trim()
    }
    filled = cells.filter(Boolean).length
    if (filled >= minCols) rows.push({ cells, line: l })
  }

  if (rows.length < minRows) {
    return { ok: false, reason: 'Not enough aligned rows to be a table.' }
  }

  /* The first row is treated as a header when it's typographically distinct —
     a different font or a larger size. Otherwise the table is all data and a
     header is invented, because a spreadsheet with a real data row as its
     header is worse than one with generic labels. */
  const first = rows[0].line
  const rest = rows.slice(1).map(r => r.line)
  const headerish =
    rest.length > 0 &&
    (first.runs[0]?.font !== rest[0]?.runs[0]?.font || first.size > rest[0].size + 0.5)

  const headers = headerish
    ? rows[0].cells.map((c, i) => c || `Column ${i + 1}`)
    : columns.map((_, i) => `Column ${i + 1}`)
  const body = (headerish ? rows.slice(1) : rows).map(r => r.cells)

  const usedLines = rows.map(r => r.line)
  return {
    ok: true,
    headers,
    rows: body,
    columns: columns.map(c => c.value),
    headerDetected: headerish,
    bbox: bboxOf(usedLines),
  }
}

/** One-dimensional clustering: values within `tolerance` become one column. */
function clusterPositions(values, tolerance) {
  const sorted = [...values].sort((a, b) => a - b)
  const out = []
  for (const v of sorted) {
    const last = out[out.length - 1]
    if (last && v - last.value <= tolerance) {
      // Running mean, so a cluster's centre reflects every member.
      last.value = (last.value * last.count + v) / (last.count + 1)
      last.count++
    } else {
      out.push({ value: v, count: 1 })
    }
  }
  return out
}

function nearestColumn(columns, x, tolerance) {
  let best = -1, bestD = Infinity
  for (let i = 0; i < columns.length; i++) {
    const d = Math.abs(columns[i].value - x)
    if (d < bestD) { bestD = d; best = i }
  }
  /* A generous window, because a right-aligned number sits well right of its
     column's left edge. Without it every numeric column is dropped. */
  return bestD <= Math.max(tolerance * 4, 24) ? best : -1
}

function bboxOf(lines) {
  if (!lines?.length) return null
  return {
    x: Math.min(...lines.map(l => l.x0)),
    y: Math.min(...lines.map(l => l.baseline)),
    w: Math.max(...lines.map(l => l.x1)) - Math.min(...lines.map(l => l.x0)),
    h: Math.max(...lines.map(l => l.top)) - Math.min(...lines.map(l => l.baseline)),
  }
}

/* ── the two things the UI asks for ──────────────────────────────────── */

/**
 * Everything readable on a page, as prose.
 * @returns {{text, paragraphs, lines, bbox, empty}}
 */
export function extractText(items, opts = {}) {
  const lines = groupIntoLines(items, opts)
  const paragraphs = groupIntoParagraphs(lines, opts)
  return {
    lines,
    paragraphs,
    text: paragraphs.map(p => p.text).join('\n\n'),
    bbox: bboxOf(lines),
    /* A page with no text runs is almost always a scan. Saying so is much more
       useful than an empty result, because the fix is different — it needs
       OCR, not a different extraction setting. */
    empty: lines.length === 0,
  }
}

/** Prose as the HTML a text block stores. */
export function paragraphsToHtml(paragraphs) {
  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (!paragraphs?.length) return ''
  return paragraphs.map(p => `<p>${esc(p.text)}</p>`).join('')
}

/** A table, ready for a table block. */
export function extractTable(items, opts = {}) {
  const lines = groupIntoLines(items, opts)
  return detectTable(lines, opts)
}

/**
 * A short description of what a page contains, for the preview.
 * Cheap enough to run on every page change.
 */
export function summarisePage(items, opts = {}) {
  const lines = groupIntoLines(items, opts)
  if (!lines.length) return { empty: true, label: 'No text — this page is probably a scan' }
  const table = detectTable(lines, opts)
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0)
  return {
    empty: false,
    lines: lines.length,
    words,
    table: table.ok ? { rows: table.rows.length, cols: table.headers.length } : null,
    label: table.ok
      ? `${lines.length} lines · a ${table.rows.length}×${table.headers.length} table looks extractable`
      : `${lines.length} lines · ${words} words`,
  }
}
