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

/* ── detectTable / extractTable ARE GONE ──────────────────────────────────
   They clustered column x-positions out of raw text-run coordinates with a 6px
   tolerance and guessed a header row by typographic distinctness — which this
   file's own header already described honestly as "a good guess on ordinary
   documents that will sometimes be wrong". That guess is what people
   experienced as extraction being sloppy: not a separate silent auto-extract
   feature (there never was one — extraction has always required an explicit
   "Add block" click through PdfExtractPanel), but the Auto/Table modes in that
   panel resolving to a table shape the page did not really have.

   Paragraph and line grouping from geometry, which extractText uses, is a much
   safer inference and stays. Column-clustering into a table shape is cut.

   DELETED RATHER THAN LEFT UNREACHABLE. Once PdfExtractPanel stopped calling
   them, keeping several hundred lines of table-guessing logic in the file would
   just be an invitation for someone to wire it back up without knowing why it
   was switched off. This note is the record instead.

   Nothing else is affected: public/crosscheck.worker.js takes generic
   { rowsA, rowsB } arrays and has no reference to this module or to anything
   PDF-related, so Crosscheck's fuzzy matching is untouched. Verified by
   grepping the worker for any import of this file — there is none.

   OCR is still not here and this does not change that. The "no text on this
   page — it's almost certainly a scan" notice is an honest limitation message,
   not part of what was cut. */

/* The rectangle a set of lines occupies, in PDF space. Shared, not part of the
   removed table code — it is what gives an extracted block its `source.bbox`,
   which is how clicking the provenance chip scrolls back to the exact region of
   the page the content came from. */
function bboxOf(lines) {
  if (!lines?.length) return null
  return {
    x: Math.min(...lines.map(l => l.x0)),
    y: Math.min(...lines.map(l => l.baseline)),
    w: Math.max(...lines.map(l => l.x1)) - Math.min(...lines.map(l => l.x0)),
    h: Math.max(...lines.map(l => l.top)) - Math.min(...lines.map(l => l.baseline)),
  }
}

/* ── the one thing the UI asks for ───────────────────────────────────── */

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

/**
 * A short description of what a page contains, for the preview.
 * Cheap enough to run on every page change.
 */
export function summarisePage(items, opts = {}) {
  const lines = groupIntoLines(items, opts)
  if (!lines.length) return { empty: true, label: 'No text — this page is probably a scan' }
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0)
  /* No `table` field and no "a 4×3 table looks extractable" label any more.
     Both were reports on detectTable's guess, and promising a table in the
     panel's header was the most misleading part of it — it made an inference
     sound like a finding before the user had seen a single cell. */
  return {
    empty: false,
    lines: lines.length,
    words,
    label: `${lines.length} lines · ${words} words`,
  }
}
