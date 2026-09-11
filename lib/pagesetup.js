/*
  lib/pagesetup.js
  --------------------------------------------------------------------------
  PAGE GEOMETRY FOR THE DOCUMENT BLOCK — one implementation, three consumers.

  The ribbon's Layout tab, the ruler's draggable margin markers and the dashed
  page-guide overlay all need the same numbers: how wide the page is, where the
  margins fall, how much content height fits between them. Three copies of that
  arithmetic is three copies that can disagree, and the symptom would be a ruler
  whose markers do not line up with the text they are supposed to be controlling
  — which is the one bug a ruler cannot survive.

  ── PAGINATION IS COMPUTED, NOT LAID OUT ───────────────────────────────────

  This module deliberately contains no reflow. The editing surface is one
  continuous scroll, exactly like Notes; page boundaries are drawn as thin
  dashed guides at every multiple of one number, which is what `contentHeightPx`
  below returns. No content moves, nothing reflows, and the whole cost is one
  division of scroll position by a constant.

  That is what makes "it must feel right at every zoom level" achievable
  without a layout engine fighting the canvas's own transform. And it comes with
  a consequence worth stating plainly rather than discovering: THE GUIDE IS AN
  ESTIMATE. The exported document is the source of truth for exact page breaks,
  because the exporting library does the real page-breaking with real font
  metrics. A table or an image near a boundary may export onto the next page
  even where the guide suggested otherwise — the same way Word's own live view
  and print preview can differ by a line. An honest tradeoff, not a bug to fix.

  ── UNITS ──────────────────────────────────────────────────────────────────

  INCHES throughout, and CSS pixels only at the very edge, because inches are
  what Word's margin dialog uses and what people type into it. 96 CSS px to the
  inch is the CSS specification's own definition, not an approximation — it is
  what `1in` means in a stylesheet.

  All pure, so the parts most likely to be quietly wrong get asserted.
  -------------------------------------------------------------------------- */

/** CSS pixels per inch. Fixed by the CSS spec: `1in === 96px`. */
export const PX_PER_IN = 96

/* Page sizes in INCHES, portrait. Landscape swaps them at use site rather than
   being listed twice — two entries per size is two places to get a size wrong. */
export const PAGE_SIZES = Object.freeze({
  a4:     { id: 'a4',     label: 'A4',        w: 8.27,  h: 11.69 },
  letter: { id: 'letter', label: 'Letter',    w: 8.5,   h: 11 },
  legal:  { id: 'legal',  label: 'Legal',     w: 8.5,   h: 14 },
  a3:     { id: 'a3',     label: 'A3',        w: 11.69, h: 16.54 },
  a5:     { id: 'a5',     label: 'A5',        w: 5.83,  h: 8.27 },
})

export const PAGE_SIZE_IDS = Object.keys(PAGE_SIZES)
export const ORIENTATIONS = ['portrait', 'landscape']

/* Word's four standard margin presets, with their real values — shown inline in
   the dropdown, because "Moderate" means nothing without them. */
export const MARGIN_PRESETS = Object.freeze([
  { id: 'normal',   label: 'Normal',   margins: { top: 1,    bottom: 1,    left: 1,    right: 1 } },
  { id: 'narrow',   label: 'Narrow',   margins: { top: 0.5,  bottom: 0.5,  left: 0.5,  right: 0.5 } },
  { id: 'moderate', label: 'Moderate', margins: { top: 1,    bottom: 1,    left: 0.75, right: 0.75 } },
  { id: 'wide',     label: 'Wide',     margins: { top: 1,    bottom: 1,    left: 2,    right: 2 } },
])

/** The spinner step in the Custom Margins dialog. Word's own increment. */
export const MARGIN_STEP = 0.25

/* A margin cannot be negative, and it cannot be so large that the two opposing
   margins leave no page between them. Clamped to a half-inch of content
   minimum, which is narrow enough never to fight a legitimate value and wide
   enough that the result is still a page. */
const MIN_CONTENT_IN = 0.5

export const normalizeSize = id => (PAGE_SIZES[id] ? id : 'a4')
export const normalizeOrientation = o => (ORIENTATIONS.includes(o) ? o : 'portrait')

/** One margin value, coerced. Two decimals, matching the dialog's precision. */
export function normalizeMargin(v, fallback = 1) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.round(n * 100) / 100
}

/**
 * The page, in inches, after orientation.
 * @returns {{w:number,h:number,label:string}}
 */
export function pageInches(sizeId, orientation) {
  const size = PAGE_SIZES[normalizeSize(sizeId)]
  const landscape = normalizeOrientation(orientation) === 'landscape'
  return {
    w: landscape ? size.h : size.w,
    h: landscape ? size.w : size.h,
    label: size.label,
  }
}

/**
 * Everything the ribbon, the ruler and the guides need, from one call.
 *
 * Margins are clamped AGAINST THE PAGE here rather than at each caller: a 2"
 * left margin is Wide on A4 and impossible on A5, and the clamp belongs where
 * the page size is already known.
 *
 * @param {{pageSize?:string, orientation?:string, margins?:object}} block
 * @param {number} [zoom]  the canvas zoom, if the caller wants screen pixels
 */
export function pageMetrics(block, zoom = 1) {
  const page = pageInches(block?.pageSize, block?.orientation)
  const m = block?.margins || {}

  let top = normalizeMargin(m.top)
  let bottom = normalizeMargin(m.bottom)
  let left = normalizeMargin(m.left)
  let right = normalizeMargin(m.right)

  /* Opposing pairs clamped together, proportionally, so an over-wide pair
     shrinks in the ratio the user asked for rather than one of them being
     arbitrarily blamed for the overflow. */
  const fitPair = (a, b, extent) => {
    const room = extent - MIN_CONTENT_IN
    if (a + b <= room) return [a, b]
    if (room <= 0) return [0, 0]
    const k = room / (a + b)
    return [Math.round(a * k * 100) / 100, Math.round(b * k * 100) / 100]
  }
  ;[left, right] = fitPair(left, right, page.w)
  ;[top, bottom] = fitPair(top, bottom, page.h)

  const contentWIn = Math.max(MIN_CONTENT_IN, page.w - left - right)
  const contentHIn = Math.max(MIN_CONTENT_IN, page.h - top - bottom)
  const scale = PX_PER_IN * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1)

  return {
    page,
    margins: { top, bottom, left, right },
    inches: { contentW: contentWIn, contentH: contentHIn },
    px: {
      pageW: page.w * scale,
      pageH: page.h * scale,
      contentW: contentWIn * scale,
      contentH: contentHIn * scale,
      top: top * scale,
      bottom: bottom * scale,
      left: left * scale,
      right: right * scale,
    },
  }
}

/**
 * The height of one page's content area, in CSS px — the ONE number the guide
 * overlay divides scroll position by.
 */
export function contentHeightPx(block, zoom = 1) {
  return pageMetrics(block, zoom).px.contentH
}

/**
 * How many guide lines to draw for a document of `docHeightPx`, and where.
 *
 * Returns offsets from the top of the content flow, NOT including 0 — a line
 * at the very start is not a page boundary, it is the top of page one, and
 * drawing it there is the single most common way this reads as broken.
 *
 * Capped: a very long document at a very small page size could ask for
 * thousands of lines, and a thousand absolutely-positioned divs is a real
 * performance problem for a purely decorative overlay.
 */
export function pageGuides(block, docHeightPx, zoom = 1, { max = 200 } = {}) {
  const step = contentHeightPx(block, zoom)
  if (!(step > 0) || !(docHeightPx > 0)) return []
  const n = Math.min(max, Math.floor(docHeightPx / step))
  const out = []
  for (let i = 1; i <= n; i++) out.push({ page: i + 1, top: i * step })
  return out
}

/** "Page 2 of 4", for the status bar. Always at least page 1 of 1. */
export function pageCount(block, docHeightPx, zoom = 1) {
  const step = contentHeightPx(block, zoom)
  if (!(step > 0) || !(docHeightPx > 0)) return 1
  return Math.max(1, Math.ceil(docHeightPx / step))
}

/**
 * Which preset a set of margins matches, or 'custom'.
 *
 * Derived rather than stored, so the ribbon's label can never disagree with the
 * numbers — typing Normal's exact values into the Custom dialog should read as
 * Normal again, not stay stuck on "Custom" because a flag was set once.
 */
export function marginPresetFor(margins) {
  const m = {
    top: normalizeMargin(margins?.top), bottom: normalizeMargin(margins?.bottom),
    left: normalizeMargin(margins?.left), right: normalizeMargin(margins?.right),
  }
  for (const p of MARGIN_PRESETS) {
    const q = p.margins
    if (m.top === q.top && m.bottom === q.bottom && m.left === q.left && m.right === q.right) return p.id
  }
  return 'custom'
}

/* ── WORD COUNT ───────────────────────────────────────────────────────────
   Counted off PLAIN TEXT stripped from the stored HTML, with no DOM — this has
   to run in the test harness, and a DOM-dependent word count is a word count
   nobody asserts.

   Block-level tags become spaces before stripping, so `<p>one</p><p>two</p>`
   is two words rather than the one word "onetwo" — which is the bug every
   naive `replace(/<[^>]*>/g, '')` has. */
const BLOCK_TAG = /<\/?(p|div|br|h[1-6]|li|ul|ol|tr|td|th|table|blockquote|pre|hr|section)[^>]*>/gi

export function plainTextOf(html) {
  return String(html || '')
    .replace(BLOCK_TAG, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function wordCount(html) {
  const t = plainTextOf(html)
  return t ? t.split(' ').filter(Boolean).length : 0
}

export function charCount(html) {
  return plainTextOf(html).length
}

/* ── THE FONT LIBRARY ─────────────────────────────────────────────────────
   A curated set rather than an open-ended "how many fonts" question, covering
   serif, sans and monospace. INTER IS THE DEFAULT, because introducing a second
   default typographic identity in one app is a worse outcome than a slightly
   unadventurous document font.

   Every entry has a real fallback stack: only Inter and DM Mono are actually
   shipped by the app (via next/font), so the rest resolve to whatever the
   reader's system has — and a font that silently falls back to the browser
   default serif is a font that changes the document's look on someone else's
   machine without saying so. The stacks keep that within a family. */
export const DOC_FONTS = Object.freeze([
  { name: 'Inter',           stack: "var(--ds-font-body)", group: 'Sans' },
  { name: 'Helvetica',       stack: "Helvetica, Arial, sans-serif", group: 'Sans' },
  { name: 'Arial',           stack: "Arial, Helvetica, sans-serif", group: 'Sans' },
  { name: 'Verdana',         stack: "Verdana, Geneva, sans-serif", group: 'Sans' },
  { name: 'Tahoma',          stack: "Tahoma, Geneva, sans-serif", group: 'Sans' },
  { name: 'Trebuchet MS',    stack: "'Trebuchet MS', Tahoma, sans-serif", group: 'Sans' },
  { name: 'Georgia',         stack: "Georgia, 'Times New Roman', serif", group: 'Serif' },
  { name: 'Times New Roman', stack: "'Times New Roman', Times, serif", group: 'Serif' },
  { name: 'Garamond',        stack: "Garamond, Georgia, serif", group: 'Serif' },
  { name: 'Palatino',        stack: "'Palatino Linotype', Palatino, Georgia, serif", group: 'Serif' },
  { name: 'Cambria',         stack: "Cambria, Georgia, serif", group: 'Serif' },
  { name: 'Book Antiqua',    stack: "'Book Antiqua', Palatino, serif", group: 'Serif' },
  { name: 'DM Mono',         stack: "var(--ds-font-mono)", group: 'Mono' },
  { name: 'Courier New',     stack: "'Courier New', Courier, monospace", group: 'Mono' },
  { name: 'Consolas',        stack: "Consolas, 'Courier New', monospace", group: 'Mono' },
])

export const DEFAULT_DOC_FONT = 'Inter'

export function fontStack(name) {
  return DOC_FONTS.find(f => f.name === name)?.stack || DOC_FONTS[0].stack
}

/** Word's common size range, for the size combo's preset list. */
export const FONT_SIZES = Object.freeze([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36])

export const LINE_SPACINGS = Object.freeze([
  { id: 1,    label: 'Single' },
  { id: 1.15, label: '1.15' },
  { id: 1.5,  label: '1.5' },
  { id: 2,    label: 'Double' },
])
