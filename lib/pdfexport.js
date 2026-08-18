/*
  lib/pdfexport.js
  --------------------------------------------------------------------------
  Applies the overlay to a COPY of the original and produces new bytes.

  This is the file where the immutable-original decision has to hold. Nothing
  here writes to storage, nothing mutates its input, and the source array is
  copied before pdf-lib touches it. Export can be run a hundred times and the
  imported document is byte-identical afterwards.

  COORDINATES ARRIVE IN PDF SPACE AND ARE USED AS-IS
  Overlay entries store PDF-space coordinates (see lib/pdfspace.js), and
  pdf-lib's drawing API takes PDF-space coordinates — origin bottom-left, y
  increasing upward. So there is deliberately NO conversion in this file. Every
  transformation happens at input time, in the annotation layer, exactly once.

  If a tool ever stored screen coordinates "because it was easier", this is
  where it would surface: annotations correct on screen and wrong in the
  exported file, which is the worst place to find out.

  pdf-lib IS LOADED DYNAMICALLY
  ~350KB, needed only when someone actually exports. Nobody who just reads a
  document should download it.
  -------------------------------------------------------------------------- */

/* Static, unlike pdf-lib below: this is a few hundred bytes of pure arithmetic
   with no dependencies, and the exporter and the editor have to agree on it. */
import { fitSize } from './pdfreplace.js'

/** Cached module promise — repeated exports must not refetch the library. */
let libPromise = null
export function loadPdfLib() {
  if (!libPromise) libPromise = import(/* webpackChunkName: "pdflib" */ 'pdf-lib')
  return libPromise
}

/** '#rrggbb' or '#rgb' → pdf-lib's 0..1 triple. Falls back to black. */
export function parseColor(hex, rgb) {
  const s = String(hex || '').trim().replace(/^#/, '')
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  if (!/^[0-9a-f]{6}$/i.test(full)) return rgb(0, 0, 0)
  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255
  )
}

/**
 * Build the edited document.
 *
 * @param originalBytes  the imported file — never modified
 * @param edits          overlay entries, PDF-space coordinates
 * @returns {Promise<Uint8Array>} new bytes
 */
export async function applyEdits(originalBytes, edits = []) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await loadPdfLib()

  if (!originalBytes?.length) throw new Error('There is no document to export.')

  /* Copy before handing over. pdf-lib doesn't detach the buffer the way
     pdf.js's worker does, but the same array is the record in IndexedDB and
     the source for the next export, so it's not worth relying on that. */
  const doc = await PDFDocument.load(originalBytes.slice(), { ignoreEncryption: false })
  const pages = doc.getPages()

  /* Fonts are embedded lazily and cached. Embedding Helvetica once per text
     annotation would add a full font object to the file for every one. */
  const fontCache = new Map()
  const getFont = async name => {
    const key = name || StandardFonts.Helvetica
    if (!fontCache.has(key)) fontCache.set(key, await doc.embedFont(key))
    return fontCache.get(key)
  }

  /* Array order IS paint order — a white-out added after a highlight must
     cover it. Entries are applied in the order they were created. */
  for (const edit of edits || []) {
    const page = pages[edit.page]
    if (!page) continue          // the page was removed; skip rather than throw

    switch (edit.kind) {
      case 'whiteout': {
        if (!edit.rect) break
        page.drawRectangle({
          x: edit.rect.x, y: edit.rect.y, width: edit.rect.w, height: edit.rect.h,
          color: parseColor(edit.color || '#ffffff', rgb),
        })
        break
      }

      case 'highlight': {
        if (!edit.rect) break
        page.drawRectangle({
          x: edit.rect.x, y: edit.rect.y, width: edit.rect.w, height: edit.rect.h,
          color: parseColor(edit.color || '#ffe066', rgb),
          /* Translucent, so the text underneath stays readable. Without this
             a highlight is a redaction. */
          opacity: typeof edit.opacity === 'number' ? edit.opacity : 0.35,
        })
        break
      }

      case 'text': {
        if (!edit.text) break
        const font = await getFont(edit.font)
        const size = edit.size || 12
        /* edit.y is the BASELINE, matching how pdf.js reports text position
           and how pdf-lib draws it. Storing a top edge instead would make
           every exported line sit one line-height off. */
        page.drawText(String(edit.text), {
          x: edit.x, y: edit.y, size, font,
          color: parseColor(edit.color || '#000000', rgb),
          lineHeight: size * 1.2,
          rotate: edit.rotate ? degrees(edit.rotate) : undefined,
        })
        break
      }

      case 'replace': {
        if (!edit.rect) break
        /* Cover first, then draw — order matters, and pdf-lib paints in call
           order. The cover colour is sampled from the page by the editor, not
           assumed white: a white patch on a cream scan is exactly the artefact
           that makes an edited PDF look edited. */
        page.drawRectangle({
          x: edit.rect.x, y: edit.rect.y, width: edit.rect.w, height: edit.rect.h,
          color: parseColor(edit.cover || '#ffffff', rgb),
        })
        if (!edit.text) break          // deleting the text is a legitimate edit

        const rFont = await getFont(edit.font)
        /* Measured with the real font here, unlike the editor's estimate. If
           it still will not fit at the floor, the text is DROPPED rather than
           drawn over the line below. A replacement that silently overlaps the
           next line is a corrupted document that looks fine on screen and
           wrong on paper, which is the worst of both. The cover rectangle
           stays, so the result is visibly blank rather than quietly wrong. */
        const fitted = fitSize(
          { rect: edit.rect, size: edit.size || 12 },
          edit.text,
          { measure: (s, at) => rFont.widthOfTextAtSize(s, at) },
        )
        if (fitted === null) break

        page.drawText(String(edit.text), {
          x: edit.x, y: edit.y, size: fitted, font: rFont,
          color: parseColor(edit.color || '#000000', rgb),
          lineHeight: fitted * 1.2,
        })
        break
      }

      case 'ink': {
        const pts = edit.points || []
        if (pts.length < 2) break
        const color = parseColor(edit.color || '#5B5FE8', rgb)
        const thickness = edit.width || 2
        /* pdf-lib has no polyline primitive, so a stroke is a run of line
           segments. Round caps would need a custom graphics state; at these
           widths the joins aren't visible. */
        for (let i = 1; i < pts.length; i++) {
          page.drawLine({
            start: { x: pts[i - 1].x, y: pts[i - 1].y },
            end: { x: pts[i].x, y: pts[i].y },
            thickness,
            color,
            opacity: typeof edit.opacity === 'number' ? edit.opacity : 1,
          })
        }
        break
      }

      default:
        // An unknown kind is skipped, not thrown on. A document written by a
        // newer build must still export from an older one.
        break
    }
  }

  return doc.save()
}

/**
 * True when exporting would produce something different from the original.
 * Used to keep "Export edited copy" from offering a pointless duplicate.
 */
export const hasEdits = edits => Array.isArray(edits) && edits.length > 0

/** A filename for the edited copy that doesn't collide with the original. */
export function editedFilename(name) {
  const base = String(name || 'document').replace(/\.pdf$/i, '').trim() || 'document'
  return `${base} (edited).pdf`
}
