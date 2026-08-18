/*
  lib/pdfspace.js
  --------------------------------------------------------------------------
  The only place PDF coordinates become screen coordinates, and back.

  THE PROBLEM
  Three coordinate systems have to agree, and they disagree in three ways:

    · PDF user space — origin BOTTOM-left, y increases UP, units are points
      (1/72"). Also offset: a page's viewBox rarely starts at 0,0.
    · Canvas / DOM — origin TOP-left, y increases DOWN, units are CSS px.
    · The block — everything again multiplied by the block's own zoom.

  Plus /Rotate. A page can declare 90, 180 or 270 degrees, which swaps the
  displayed width and height and shuffles which corner is the origin. Scanned
  documents carry it constantly.

  Get any of that wrong and a highlight sits an inch below the sentence, or a
  white-out rectangle covers the wrong paragraph — and it will look correct on
  the unrotated A4 test file you're developing against.

  WHY THIS MIRRORS pdf.js RATHER THAN DERIVING ITS OWN MATHS
  The transform below is a direct port of pdf.js's own PageViewport
  constructor, read out of node_modules/pdfjs-dist/build/pdf.mjs rather than
  reconstructed from the specification. It has to be identical, not merely
  equivalent: pdf.js paints the page with ITS matrix, and anything drawn on
  top with a slightly different one drifts. Matching the implementation means
  they cannot disagree, including on edge cases neither of us thought about.

  Keeping our own copy — rather than calling page.getViewport() — is what
  lets every one of these functions be unit-tested with no PDF, no worker and
  no browser, which is most of why this file exists separately at all.
  -------------------------------------------------------------------------- */

/** A 2×3 affine matrix, in the same [a,b,c,d,e,f] order pdf.js and canvas use. */
export const applyMatrix = (m, x, y) => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

/** Inverse of a 2×3 affine. Returns null when the matrix is degenerate. */
export function invertMatrix(m) {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det || !Number.isFinite(det)) return null
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ]
}

export const VALID_ROTATIONS = [0, 90, 180, 270]

/** Normalise any rotation to one of 0/90/180/270. Bad input falls back to 0. */
export function normalizeRotation(r) {
  const n = Number(r)
  if (!Number.isFinite(n)) return 0
  const m = ((n % 360) + 360) % 360
  return VALID_ROTATIONS.includes(m) ? m : 0
}

/**
 * Build a viewport. Port of pdf.js's PageViewport.
 *
 * @param viewBox  [x0, y0, x1, y1] from the page, in PDF units
 * @param scale    zoom, 1 = 100%
 * @param rotation 0 | 90 | 180 | 270
 * @param userUnit rarely anything but 1, but CAD exports use it
 * @returns { width, height, transform, scale, rotation, viewBox }
 */
export function makeViewport({ viewBox, scale = 1, rotation = 0, userUnit = 1, offsetX = 0, offsetY = 0 } = {}) {
  const vb = Array.isArray(viewBox) && viewBox.length === 4 && viewBox.every(Number.isFinite)
    ? viewBox
    : [0, 0, 612, 792]                    // US Letter, so a malformed page still renders
  const s = (Number.isFinite(scale) && scale > 0 ? scale : 1) * (Number.isFinite(userUnit) && userUnit > 0 ? userUnit : 1)
  const rot = normalizeRotation(rotation)

  const centerX = (vb[2] + vb[0]) / 2
  const centerY = (vb[3] + vb[1]) / 2

  let a, b, c, d
  switch (rot) {
    case 180: a = -1; b = 0; c = 0; d = 1; break
    case 90:  a = 0; b = 1; c = 1; d = 0; break
    case 270: a = 0; b = -1; c = -1; d = 0; break
    default:  a = 1; b = 0; c = 0; d = -1; break   // 0 — the y-flip lives here
  }

  let offCanvasX, offCanvasY, width, height
  if (a === 0) {
    // 90 / 270: the page is displayed on its side, so width and height swap.
    offCanvasX = Math.abs(centerY - vb[1]) * s + offsetX
    offCanvasY = Math.abs(centerX - vb[0]) * s + offsetY
    width = (vb[3] - vb[1]) * s
    height = (vb[2] - vb[0]) * s
  } else {
    offCanvasX = Math.abs(centerX - vb[0]) * s + offsetX
    offCanvasY = Math.abs(centerY - vb[1]) * s + offsetY
    width = (vb[2] - vb[0]) * s
    height = (vb[3] - vb[1]) * s
  }

  const transform = [
    a * s, b * s, c * s, d * s,
    offCanvasX - a * s * centerX - c * s * centerY,
    offCanvasY - b * s * centerX - d * s * centerY,
  ]

  return { width, height, transform, scale: s, rotation: rot, viewBox: vb }
}

/* ── the two functions every tool must go through ────────────────────── */

/**
 * PDF point → screen point, relative to the page's top-left corner.
 * @returns {{x:number, y:number}}
 */
export function toScreenSpace(point, viewport) {
  if (!point || !viewport?.transform) return { x: 0, y: 0 }
  const [x, y] = applyMatrix(viewport.transform, num(point.x), num(point.y))
  return { x, y }
}

/**
 * Screen point → PDF point. Every annotation is STORED in PDF space, so this
 * runs on every mouse event that creates or moves one.
 *
 * Storing PDF-space coordinates rather than screen ones is the whole reason
 * an annotation survives zooming, resizing the block and rotating the page:
 * the point doesn't move, only the matrix that displays it does.
 */
export function toPdfSpace(point, viewport) {
  if (!point || !viewport?.transform) return { x: 0, y: 0 }
  const inv = invertMatrix(viewport.transform)
  if (!inv) return { x: 0, y: 0 }
  const [x, y] = applyMatrix(inv, num(point.x), num(point.y))
  return { x, y }
}

/**
 * A rectangle, converted corner-to-corner and re-normalised.
 * Under 90° and 180° rotation the corners swap, so a naive width/height
 * conversion produces negative sizes that silently render as nothing.
 */
export function rectToScreen(rect, viewport) {
  const p1 = toScreenSpace({ x: rect.x, y: rect.y }, viewport)
  const p2 = toScreenSpace({ x: rect.x + rect.w, y: rect.y + rect.h }, viewport)
  return normalizeRect(p1, p2)
}

export function rectToPdf(rect, viewport) {
  const p1 = toPdfSpace({ x: rect.x, y: rect.y }, viewport)
  const p2 = toPdfSpace({ x: rect.x + rect.w, y: rect.y + rect.h }, viewport)
  return normalizeRect(p1, p2)
}

function normalizeRect(p1, p2) {
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  }
}

/* ── fitting ─────────────────────────────────────────────────────────── */

/**
 * The scale that fits a page into a box.
 * @param mode 'width' | 'page' | 'actual'
 */
export function fitScale(pageW, pageH, boxW, boxH, mode = 'width') {
  if (!(pageW > 0) || !(pageH > 0)) return 1
  if (mode === 'actual') return 1
  if (mode === 'page') return Math.min(boxW / pageW, boxH / pageH)
  return boxW / pageW
}

/** Clamp a zoom to something a human and a canvas can both cope with. */
export const MIN_SCALE = 0.15
export const MAX_SCALE = 6
export const clampScale = s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(s) ? s : 1))

/**
 * Device-pixel-ratio-aware canvas size.
 * Rendering at CSS size on a retina screen produces visibly soft text — which
 * on a document viewer reads as "this tool is low quality" more than almost
 * anything else. Capped, because a 4× ratio on an A3 page at 400% is a canvas
 * big enough for the browser to refuse to allocate.
 */
export const MAX_CANVAS_PIXELS = 16_777_216     // 4096² — the safe floor across browsers

export function canvasSizeFor(viewport, dpr = 1) {
  const ratio = Math.min(Math.max(Number.isFinite(dpr) ? dpr : 1, 1), 3)
  let w = Math.floor(viewport.width * ratio)
  let h = Math.floor(viewport.height * ratio)
  const px = w * h
  if (px > MAX_CANVAS_PIXELS) {
    const k = Math.sqrt(MAX_CANVAS_PIXELS / px)
    w = Math.floor(w * k)
    h = Math.floor(h * k)
  }
  return { width: Math.max(1, w), height: Math.max(1, h), ratio: viewport.width ? w / viewport.width : 1 }
}

/* ── text items ──────────────────────────────────────────────────────── */

/**
 * Where a pdf.js text item sits, in PDF space.
 *
 * getTextContent() returns each run with a full transform [a,b,c,d,e,f] where
 * e,f is the text origin — the BASELINE left, not the top-left of a box. The
 * height reported alongside it is the font's, so the visual box runs from the
 * baseline up. Treating e,f as a top-left corner puts every highlight one
 * line-height too low, which is the single most common way to get this wrong.
 */
export function textItemRect(item) {
  if (!item?.transform) return null
  const [, , , , e, f] = item.transform
  const h = num(item.height) || Math.abs(num(item.transform[3])) || 0
  const w = num(item.width)
  return { x: e, y: f, w, h, baselineY: f, topY: f + h }
}

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
