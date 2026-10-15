/*
  lib/docprint.js
  --------------------------------------------------------------------------
  PRINT / PDF FROM THE PAGES YOU SEE.

  The old export handed the document's HTML to the browser's print engine
  and let it break pages on its own, so the PDF broke pages somewhere else
  than the screen did, and had no headers, footers or footnotes at all.

  This builds the print from the LAID-OUT editor instead. Each printed page
  is a fixed-size sheet holding a slice of the flow: the blocks that touch
  that page, positioned exactly where the screen put them (pushes and line
  gaps included) and clipped to the sheet. Headers, footers, footnotes and
  the watermark are drawn on each sheet at the same positions as on screen.
  The result is the screen, page for page.

  The slice keeps list numbering right (an <ol> continuing from a previous
  page gets `start`), and a paragraph split across pages is sliced from its
  top, with the part above the sheet clipped away.
  -------------------------------------------------------------------------- */

import { offsetIn, pageUnits } from './docpages.js'
import { docCss } from './docstyle.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PRINT_FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap">'

/**
 * @param {HTMLElement} editor  the live [data-ds-doc]
 * @param {object} o  { pages:[{top,h,w,x}], editorW, editorLeft, editorRight,
 *   title, font, fontSizePx, lineHeight, palVars, overlays:(pageIndex)=>html }
 *   pages come from pagination: each sheet's own size (a landscape section
 *   prints landscape) and x, where it sits under the text column (mirror
 *   margins shift even pages).
 * @returns {string} a complete HTML document
 */
export function snapshotPrintHtml(editor, o) {
  const list = o.pages
  const units = pageUnits(editor).map(u => ({ el: u, top: offsetIn(u, editor), bottom: offsetIn(u, editor) + u.offsetHeight }))
  const sheets = []
  /* One named @page per sheet size, so mixed orientations print right. */
  const sizes = new Map()
  const sizeName = pg => {
    const k = `${Math.round(pg.w)}x${Math.round(pg.h)}`
    if (!sizes.has(k)) sizes.set(k, { name: 'sz' + sizes.size, w: pg.w, h: pg.h })
    return sizes.get(k).name
  }
  for (let p = 0; p < list.length; p++) {
    const pg = list[p]
    const y0 = pg.top, y1 = y0 + pg.h
    const on = units.filter(u => u.bottom > y0 + 0.5 && u.top < y1 - 0.5)
    let flow = ''
    if (on.length) {
      const first = on[0]
      const cs = getComputedStyle(first.el)
      const mt = parseFloat(cs.marginTop) || 0
      flow = `<div class="flow" style="position:absolute;top:${first.top - mt - y0}px;left:${-(pg.x || 0)}px;width:${o.editorW}px;padding:0 ${o.editorRight}px 0 ${o.editorLeft}px;box-sizing:border-box;display:flow-root">${sliceHtml(on.map(u => u.el))}</div>`
    }
    sheets.push(`<section class="sheet" style="page:${sizeName(pg)};width:${pg.w}px;height:${pg.h}px">${flow}${o.overlays ? o.overlays(p) : ''}</section>`)
  }
  const vars = Object.entries(o.palVars || {}).map(([k, v]) => `${k}:${v}`).join(';')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(o.title || 'Document')}</title>
${PRINT_FONTS}
<style>
  @page { size: ${list[0].w / 96}in ${list[0].h / 96}in; margin: 0; }
  ${[...sizes.values()].map(z => `@page ${z.name} { size: ${z.w / 96}in ${z.h / 96}in; margin: 0; }`).join('\n  ')}
  :root { --ds-font-body: Inter, 'Helvetica Neue', Arial, sans-serif; --ds-font-mono: 'DM Mono', Consolas, monospace; ${vars}; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { position: relative; overflow: hidden; break-after: page; page-break-after: always; background: var(--pg-bg); }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .flow { color: var(--pg-text); font-family: ${o.font}; font-size: ${cssNum(o.fontSizePx, 4, 400, 16)}px; line-height: ${cssNum(o.lineHeight, 0.5, 5, 1.5)}; word-break: break-word; overflow-wrap: break-word; text-indent: ${cssNum(o.textIndent, -2000, 2000, 0)}px; }
  .flow [data-ds-gap] { display: block; }
  .flow [data-ds-comment] { background: none; border: 0; }
  ${docCss('.flow')}
  @media screen { body { background: #888; } .sheet { margin: 16px auto; box-shadow: 0 2px 12px rgba(0,0,0,.25); } }
</style></head>
<body>${sheets.join('\n')}</body></html>`
}

/* Top-level blocks as HTML; list items re-wrapped in their list, with the
   numbering carried on. */
function sliceHtml(els) {
  let out = ''
  let i = 0
  while (i < els.length) {
    const el = els[i]
    if (el.tagName === 'LI' && el.parentElement && /^(UL|OL)$/.test(el.parentElement.tagName)) {
      const list = el.parentElement
      const items = []
      while (i < els.length && els[i].parentElement === list) { items.push(els[i]); i++ }
      const shell = list.cloneNode(false)
      if (list.tagName === 'OL') {
        const base = Number(list.getAttribute('start') || 1)
        const idx = [...list.children].filter(c => c.tagName === 'LI').indexOf(items[0])
        shell.setAttribute('start', String(base + Math.max(0, idx)))
      }
      /* The first item's own top margin must not collapse through the list. */
      shell.style.marginTop = '0px'
      items.forEach(li => shell.appendChild(li.cloneNode(true)))
      out += shell.outerHTML
      continue
    }
    out += el.outerHTML
    i++
  }
  return out
}

/* Numbers written into the print page's <style>. Block fields arrive through
   sync and templates unvalidated, and this page is written into a same-origin
   pop-up: `lineSpacing: "1}</style><script>…"` was a stored XSS for anyone
   who pressed Export PDF on a shared document. Only a finite number in range
   gets through. */
export function cssNum(v, lo, hi, dflt) {
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt
}

export function printDocument(html) {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) throw new Error('Pop-up blocked. Allow pop-ups for this site to export a PDF.')
  try { w.opener = null } catch { /* the print page never needs this window */ }
  w.document.write(html)
  w.document.close()
  const go = () => { try { w.focus(); w.print() } catch { /* closed */ } }
  const ready = w.document.fonts?.ready
  if (ready) Promise.race([ready, new Promise(r => setTimeout(r, 2500))]).then(() => setTimeout(go, 120))
  else setTimeout(go, 700)
}
