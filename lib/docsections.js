/*
  lib/docsections.js
  --------------------------------------------------------------------------
  SECTIONS, MIRROR MARGINS AND THE GUTTER: the page geometry of a Document.

  A section break (Layout → Breaks) starts a new page and can change what
  follows it:
    · orientation — a landscape page for a wide table inside a portrait
      thesis, the reason most people ever need sections;
    · page numbering — restart at 1 (or any number) and pick the format,
      1 2 3 / i ii iii / a b c — the front matter of every thesis.
  Margins, page size, headers and footers stay the document's own: a
  landscape section keeps top/bottom/left/right as set, like Word does
  when "apply to: this section" is not used.

  The break is content: <div data-ds-sectionbreak data-orient data-restart
  data-start data-numfmt contenteditable="false">. It describes the section
  AFTER it; the first section is the block's own settings.

  MIRROR MARGINS: odd pages have the INSIDE margin (left + gutter) on the
  left, even pages on the right. The text column is one flow, so instead of
  moving text per page, even pages are drawn shifted under it — on screen
  and in the PDF each page ends up with its text in the mirrored place.
  -------------------------------------------------------------------------- */

import { pageInches, pageMetrics } from './pagesetup.js'

export const NUM_FORMATS = [
  { id: 'decimal', label: '1, 2, 3' },
  { id: 'lower-roman', label: 'i, ii, iii' },
  { id: 'upper-roman', label: 'I, II, III' },
  { id: 'lower-alpha', label: 'a, b, c' },
]

export function sectionBreakHtml({ orient = 'portrait', restart = false, start = 1, numfmt = 'decimal' } = {}) {
  const a = [`data-ds-sectionbreak="1"`, `data-orient="${orient === 'landscape' ? 'landscape' : 'portrait'}"`, `data-numfmt="${NUM_FORMATS.some(f => f.id === numfmt) ? numfmt : 'decimal'}"`]
  if (restart) { a.push('data-restart="1"'); a.push(`data-start="${Math.max(0, Math.min(9999, Number(start) || 1))}"`) }
  return `<div ${a.join(' ')} contenteditable="false"></div><p><br></p>`
}

export const isSectionBreak = el => !!el?.hasAttribute?.('data-ds-sectionbreak')

/** The sections in document order: the block's settings, then one per break. */
export function sectionsOf(root, block) {
  const out = [{
    orient: block?.orientation === 'landscape' ? 'landscape' : 'portrait',
    restart: true, start: Number(block?.pageStart) || 1, numfmt: block?.numFmt || 'decimal', el: null,
  }]
  root?.querySelectorAll?.('[data-ds-sectionbreak]').forEach(el => {
    out.push({
      orient: el.getAttribute('data-orient') === 'landscape' ? 'landscape' : 'portrait',
      restart: el.getAttribute('data-restart') === '1',
      start: Number(el.getAttribute('data-start')) || 1,
      numfmt: el.getAttribute('data-numfmt') || 'decimal',
      el,
    })
  })
  return out
}

/** A signature of the section breaks — pagination re-renders when it changes. */
export function sectionKey(root) {
  const els = root?.querySelectorAll?.('[data-ds-sectionbreak]')
  if (!els || !els.length) return ''
  return [...els].map(el => ['data-orient', 'data-restart', 'data-start', 'data-numfmt'].map(a => el.getAttribute(a) || '').join(':')).join('|')
}

/**
 * Page geometry for a section, in editor px.
 * `left`/`right` are the margins on an ODD page; with mirror margins an
 * even page swaps them.
 */
export function sectionGeometry(block, orient) {
  const m = pageMetrics({ ...block, orientation: orient }, 1)
  const page = pageInches(block?.pageSize, orient, block?.pageCustom)
  const gutter = Math.max(0, Math.min(2, Number(block?.gutter) || 0)) * 96
  const w = page.w * 96, h = page.h * 96
  const left = m.px.left + gutter, right = m.px.right
  return { w, h, mt: m.px.top, mb: m.px.bottom, left, right, contentW: Math.max(48, w - left - right), mirror: !!block?.mirror }
}

/** The margin on the LEFT of page index k (0-based) for a geometry. */
export function leftMarginOf(geo, k) {
  return geo.mirror && k % 2 === 1 ? geo.right : geo.left
}

/* ── Page numbers ─────────────────────────────────────────────────────── */

export function toRoman(n) {
  if (n <= 0) return String(n)
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let s = ''
  for (const [v, r] of map) while (n >= v) { s += r; n -= v }
  return s
}

export function toAlpha(n) {
  if (n <= 0) return String(n)
  let s = ''
  while (n > 0) { n -= 1; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) }
  return s
}

export function formatNumber(n, fmt) {
  if (fmt === 'lower-roman') return toRoman(n)
  if (fmt === 'upper-roman') return toRoman(n).toUpperCase()
  if (fmt === 'lower-alpha') return toAlpha(n)
  return String(n)
}

/**
 * The printed number of every page.
 * @param {{sec:number}[]} pages  the page list from pagination
 * @param {{restart,start,numfmt}[]} sections
 * @returns {{label:string, n:number, secPages:number}[]}  secPages: pages
 *   in that numbering run, for "Page X of Y"
 */
export function pageLabels(pages, sections) {
  const out = []
  let n = 0
  let runStart = 0
  let lastSec = -1
  for (let i = 0; i < pages.length; i++) {
    const s = pages[i].sec ?? 0
    const sec = sections[s] || sections[0]
    if (s !== lastSec) {
      if (i === 0 || sec.restart) { n = (sec.start || 1) - 1; runStart = i }
      lastSec = s
    }
    n += 1
    out.push({ label: formatNumber(n, sec.numfmt), n, run: runStart })
  }
  /* Pages in each numbering run, for {pages}. */
  const runs = new Map()
  for (const p of out) runs.set(p.run, (runs.get(p.run) || 0) + 1)
  return out.map(p => {
    const firstN = out[p.run].n
    return { ...p, total: formatNumber(firstN + runs.get(p.run) - 1, (sections[pages[p.run].sec ?? 0] || sections[0]).numfmt) }
  })
}
