/*
  lib/pdfreplace.js
  --------------------------------------------------------------------------
  Editing text that is already in the PDF.

  WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT

  DATASTUDIO-PDF-PLAN.md scopes "text reflow" — genuinely re-laying out a
  paragraph so the following lines move — at 6 to 12 months, and says not to
  start it until there is evidence users are hitting the wall. That judgement
  still looks right. Reflow means resolving the embedded font, re-running line
  breaking, and rebuilding the content stream; get any of it wrong and you have
  silently destroyed someone's document.

  This is the other 80%, which is what people actually mean when they say "let
  me edit the text": change a name, fix a typo, correct a number, rewrite a
  line. Cover the original run with the page's own background colour and draw
  the replacement in its place, at the same baseline, at the same size.

  That is what Acrobat's edit tool does for a single line, and it is honest as
  long as the limits are visible rather than hidden:

  · A replacement is confined to the line it replaces. Nothing reflows.
  · Text longer than the original is shrunk to fit, down to a floor. Below that
    floor the edit reports that it does not fit, rather than overlapping the
    line beneath — an overlapping line is a corrupted document that looks fine
    until it is printed.
  · The cover colour is sampled from the page, not assumed to be white. A white
    rectangle on a cream page is the tell that gives cheap PDF editors away.

  NOTHING HERE MUTATES THE ORIGINAL. A replacement is one entry in the same
  edits array as every other annotation, so undo is free, revert is deleting a
  row, and the bytes on disk are still byte-identical afterwards. That property
  is asserted in tests/pdfedit.test.mjs and must not be traded away.
  -------------------------------------------------------------------------- */

import { makeEdit } from './pdfs.js'

/* How small a replacement may be scaled before it is refused. 0.6 keeps a 10pt
   line legible at 6pt; below that the fit is technically achieved and
   practically useless, and the honest answer is to say so. */
export const MIN_FIT_RATIO = 0.6

/* Average glyph advance as a fraction of font size, used only for the live
   preview while typing. Export measures with the real font metrics — this is a
   cheap approximation for the editor, not the source of truth. Helvetica's
   lowercase average is around 0.5em; 0.52 errs slightly wide, so the editor
   warns a shade before the export actually clips. */
const AVG_ADVANCE = 0.52

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * One editable run: a piece of text with a box, in PDF space.
 *
 * pdf.js reports `transform[4], transform[5]` as the text ORIGIN, which is the
 * baseline left — not the top-left of a box. The visual box runs from the
 * baseline UP by the font height. Treating the origin as a top-left corner
 * puts every cover rectangle one line-height too low, which is the single most
 * common way to get PDF geometry wrong (lib/pdfspace.js says the same thing
 * about highlights, for the same reason).
 */
function runFromItem(item, index) {
  const t = item?.transform
  if (!Array.isArray(t) || t.length < 6) return null
  const str = item.str ?? ''
  if (!str.trim()) return null            // whitespace-only runs carry line breaks

  const size = Math.abs(num(t[3])) || num(item.height) || 10
  const w = num(item.width)
  const h = num(item.height) || size

  return {
    index,
    str,
    /* Baseline origin — where drawText must start for the replacement to sit
       exactly where the original sat. */
    x: num(t[4]),
    baselineY: num(t[5]),
    /* The cover box. Descenders fall below the baseline, so it starts a little
       under it, otherwise the tail of a 'g' survives the whiteout. */
    rect: { x: num(t[4]), y: num(t[5]) - h * 0.24, w, h: h * 1.24 },
    size,
    font: item.fontName || '',
    /* A rotated or skewed run cannot be replaced by an axis-aligned rectangle
       plus horizontal text. Detected here and refused in the UI, rather than
       drawn wrong. */
    upright: Math.abs(num(t[1])) < 0.01 && Math.abs(num(t[2])) < 0.01,
  }
}

/**
 * Editable runs for a page, from `pageTextItems()` output.
 * @returns {Array} runs, in reading order as pdf.js supplied them
 */
export function editableRuns(items) {
  return (items || []).map(runFromItem).filter(Boolean)
}

/**
 * Merge runs that share a baseline into one editable line.
 *
 * This is not cosmetic. pdf.js splits a visual line wherever the font, size or
 * kerning changes, so "Invoice #4021 — due 12 August" can arrive as six runs.
 * Letting someone click and edit one of those fragments looks broken: they
 * click the middle of a sentence and get three characters. Editing operates on
 * the line a human sees.
 *
 * Only runs of the same size and font are merged — a bold word inside a
 * sentence genuinely is a separate thing to replace, and merging it would mean
 * redrawing it in the wrong weight.
 */
export function mergeRunsIntoLines(runs, { tolerance = 0.5 } = {}) {
  const sorted = [...(runs || [])].sort((a, b) =>
    Math.abs(a.baselineY - b.baselineY) > tolerance ? b.baselineY - a.baselineY : a.x - b.x)

  const lines = []
  for (const r of sorted) {
    const last = lines[lines.length - 1]
    const sameLine = last &&
      Math.abs(last.baselineY - r.baselineY) <= Math.max(tolerance, r.size * 0.15) &&
      last.font === r.font &&
      Math.abs(last.size - r.size) < 0.5 &&
      last.upright && r.upright &&
      /* A gap wider than roughly a space means a column boundary or a tab
         stop, not a continuation. Merging across one would let an edit to the
         left column silently blank the right one. */
      r.x - (last.rect.x + last.rect.w) < r.size * 0.9

    if (!sameLine) { lines.push({ ...r, parts: [r] }); continue }

    const right = Math.max(last.rect.x + last.rect.w, r.rect.x + r.rect.w)
    /* Re-derive the joining space from the geometry rather than assuming one:
       runs that abut with no gap are a single word split by a kerning pair, and
       inserting a space there corrupts the text. */
    const gap = r.x - (last.rect.x + last.rect.w)
    last.str += (gap > r.size * 0.12 ? ' ' : '') + r.str
    last.rect = { ...last.rect, w: right - last.rect.x }
    last.parts.push(r)
  }
  return lines
}

/**
 * The run under a point, in PDF space. Null when the point is over nothing.
 *
 * Hit boxes are padded outward because a baseline-anchored box is a tight fit
 * around the glyphs, and asking someone to click inside a 9pt box with no
 * margin is the kind of precision that makes a tool feel cheap.
 */
export function runAtPoint(runs, point, pad = 2) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  /* Last match wins: runs later in the array are drawn on top, so when boxes
     overlap the topmost is the one the user believes they clicked. */
  let hit = null
  for (const r of runs || []) {
    const { x, y, w, h } = r.rect
    if (point.x >= x - pad && point.x <= x + w + pad &&
        point.y >= y - pad && point.y <= y + h + pad) hit = r
  }
  return hit
}

/**
 * Will `text` fit the space `run` occupied, and at what size?
 *
 * Returns the size to draw at, or null when even MIN_FIT_RATIO is not enough.
 * The caller decides what to do about a null — the UI warns, and export skips
 * the edit rather than drawing over the following line.
 */
export function fitSize(run, text, { measure } = {}) {
  const width = run?.rect?.w || 0
  const size = run?.size || 12
  const s = String(text ?? '')
  if (!s) return size
  if (width <= 0) return size

  /* `measure(text, size)` is pdf-lib's widthOfTextAtSize when export calls
     this, and the estimate below when the editor does. Same function, two
     accuracies, so the editor's warning and the exporter's decision cannot
     drift apart in logic — only in precision. */
  const widthAt = measure || ((str, at) => str.length * at * AVG_ADVANCE)

  if (widthAt(s, size) <= width) return size

  /* Scale to fit, then verify rather than trusting the ratio: glyph advances
     are not linear in size for every font, and a hinted face can round up. */
  const scaled = size * (width / widthAt(s, size))
  const floor = size * MIN_FIT_RATIO
  if (scaled < floor) return widthAt(s, floor) <= width ? floor : null
  return scaled
}

/**
 * Build the edit that replaces `run` with `text`.
 *
 * `cover` is the colour painted over the original. Callers should sample it
 * from the rendered page — see samplePageColor in the annotation layer.
 * Defaulting to white is a last resort, and a visibly wrong one on any page
 * that is not white, which is most scanned documents.
 */
export function makeReplaceEdit(run, text, page, {
  cover = '#ffffff',
  color = '#000000',
  font,
} = {}) {
  if (!run) throw new Error('makeReplaceEdit needs the run being replaced')
  return makeEdit('replace', page, {
    rect: { ...run.rect },
    x: run.x,
    y: run.baselineY,
    size: run.size,
    text: String(text ?? ''),
    /* Kept so the edit can be reverted to exactly what the document said, and
       so a diff of the document is possible later without re-parsing the
       original bytes. */
    original: run.str,
    cover,
    color,
    font: font || undefined,
  })
}

/** True when the edit would change what the page says. */
export const changesText = edit =>
  !!edit && edit.kind === 'replace' && String(edit.text ?? '') !== String(edit.original ?? '')
