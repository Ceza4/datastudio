/*
  lib/docimport.js
  --------------------------------------------------------------------------
  OPENING A WORD FILE (.docx) AS A DOCUMENT BLOCK.

  A .docx is a ZIP of XML parts. This reads the parts that carry the writing
  and maps them onto what the Document block already knows how to hold:

    word/document.xml   paragraphs → <p>, <h1–6>, Title; lists (numbering.xml
                        says bullet or number) → nested <ul>/<ol>; tables →
                        <table>; runs → bold, italic, underline, strike,
                        super/subscript, colour, highlight, size; tabs and
                        tab stops; page breaks; hyperlinks; pictures
                        (PNG/JPEG/GIF/WebP) as data URLs; section breaks
                        (orientation, page-number restart and format)
    word/footnotes.xml  → block.footnotes + footnote marks
    word/comments.xml   → block.comments + anchored ranges
    <w:ins>/<w:del>     → tracked changes, author and time kept
    header/footer parts → block.hf ({page} / {pages} from PAGE / NUMPAGES)
    settings.xml        → mirror margins
    sectPr              → page size, orientation, margins, gutter

  What does not come across is SAID (warnings), never silently dropped:
  shapes, text boxes, charts, equations (as their text), EMF/WMF pictures,
  endnotes, and fonts the Document does not offer.

  The ZIP is read with the browser's DecompressionStream('deflate-raw') —
  no library. The XML is read with DOMParser, so this runs in the browser;
  the round trip (export → import) is tested there.
  -------------------------------------------------------------------------- */

import { TAB_HTML, formatStops } from './doctabs.js'
import { sectionBreakHtml } from './docsections.js'
import { PAGE_SIZES, DOC_FONTS } from './pagesetup.js'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const TW = 1440
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const round2 = v => Math.round(v * 100) / 100

/* ── ZIP ─────────────────────────────────────────────────────────────── */

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw')
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds))
  return new Uint8Array(await out.arrayBuffer())
}

/** name → Uint8Array, from the central directory (sizes in local headers
 *  can be zero when a writer streamed the file). */
export async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let eocd = -1
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('This is not a Word file (no ZIP directory found).')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const files = new Map()
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const csize = dv.getUint32(p + 20, true)
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true)
    const off = dv.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen))
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true)
    const start = off + 30 + lnl + lxl
    files.set(name, { method, data: u8.subarray(start, start + csize) })
    p += 46 + nlen + xlen + clen
  }
  return {
    has: n => files.has(n),
    names: () => [...files.keys()],
    async bytes(n) {
      const f = files.get(n)
      if (!f) return null
      if (f.method === 0) return f.data
      if (f.method === 8) return inflateRaw(f.data)
      throw new Error(`Unsupported compression in ${n}.`)
    },
    async text(n) { const b = await this.bytes(n); return b ? new TextDecoder().decode(b) : null },
  }
}

/* ── XML helpers ─────────────────────────────────────────────────────── */

const kids = (el, name) => (el ? [...el.childNodes].filter(n => n.nodeType === 1 && n.namespaceURI === W && n.localName === name) : [])
const kid = (el, name) => kids(el, name)[0] || null
const wa = (el, name) => (el ? el.getAttributeNS(W, name) ?? el.getAttribute('w:' + name) : null)
const onOff = el => { if (!el) return false; const v = wa(el, 'val'); return v == null || !/^(0|false|off|none)$/i.test(v) }
const parseXml = s => (s ? new DOMParser().parseFromString(s, 'application/xml') : null)

function relsOf(xml) {
  const map = new Map()
  const d = parseXml(xml)
  d?.querySelectorAll('Relationship').forEach(r => map.set(r.getAttribute('Id'), { target: r.getAttribute('Target'), type: r.getAttribute('Type') || '', mode: r.getAttribute('TargetMode') }))
  return map
}

/* ── the importer ────────────────────────────────────────────────────── */

/**
 * @param {ArrayBuffer|Uint8Array} buf
 * @param {{ name?:string, author?:{name,id}, shrinkImage?:(blob)=>Promise<string> }} opts
 * @returns {Promise<{ patch: object, warnings: string[] }>}  patch = a Document block's fields
 */
export async function importDocx(buf, opts = {}) {
  const zip = await unzip(buf)
  const docXml = await zip.text('word/document.xml')
  if (!docXml) throw new Error('This file has no Word document inside it.')
  const warnings = new Set()
  const rels = relsOf(await zip.text('word/_rels/document.xml.rels'))
  const doc = parseXml(docXml)
  const body = doc.getElementsByTagNameNS(W, 'body')[0]

  /* Styles: heading levels and Title, by style id. */
  const styles = parseXml(await zip.text('word/styles.xml'))
  const styleKind = new Map()
  const styleNum = new Map()
  const basedOn = new Map()
  const numOfStyle = id => { for (let k = 0; id && k < 8; k++, id = basedOn.get(id)) if (styleNum.has(id)) return styleNum.get(id); return null }
  for (const st of styles ? [...styles.getElementsByTagNameNS(W, 'style')] : []) {
    const id = wa(st, 'styleId') || ''
    const name = (wa(kid(st, 'name'), 'val') || id).toLowerCase()
    const lvl = kid(kid(st, 'pPr'), 'outlineLvl')
    /* List styles ("List Bullet") carry their numbering on the style. */
    const snp = kid(kid(st, 'pPr'), 'numPr')
    if (snp) styleNum.set(id, { numId: wa(kid(snp, 'numId'), 'val'), ilvl: Number(wa(kid(snp, 'ilvl'), 'val')) || 0 })
    const based = wa(kid(st, 'basedOn'), 'val')
    if (based) basedOn.set(id, based)
    let m
    if (name === 'title') styleKind.set(id, { title: true })
    else if (name === 'subtitle') styleKind.set(id, { subtitle: true })
    else if ((m = /^heading\s*([1-6])$/.exec(name))) styleKind.set(id, { h: Number(m[1]) })
    else if (lvl && Number(wa(lvl, 'val')) < 6) styleKind.set(id, { h: Number(wa(lvl, 'val')) + 1 })
    else if (/quote/.test(name)) styleKind.set(id, { quote: true })
  }
  /* Default font and size. */
  let font = null, fontSize = null
  const dflt = styles?.getElementsByTagNameNS(W, 'rPrDefault')[0]
  if (dflt) {
    const rf = dflt.getElementsByTagNameNS(W, 'rFonts')[0]
    const f = rf && (wa(rf, 'ascii') || wa(rf, 'hAnsi'))
    if (f) font = f
    const sz = dflt.getElementsByTagNameNS(W, 'sz')[0]
    if (sz) fontSize = Number(wa(sz, 'val')) / 2
  }

  /* Numbering: numId → level → ordered? */
  const numXml = parseXml(await zip.text('word/numbering.xml'))
  const abstract = new Map()
  for (const a of numXml ? [...numXml.getElementsByTagNameNS(W, 'abstractNum')] : []) {
    const lv = new Map()
    for (const l of kids(a, 'lvl')) lv.set(Number(wa(l, 'ilvl')), (wa(kid(l, 'numFmt'), 'val') || 'bullet') !== 'bullet')
    abstract.set(wa(a, 'abstractNumId'), lv)
  }
  const nums = new Map()
  for (const n of numXml ? [...numXml.getElementsByTagNameNS(W, 'num')] : []) nums.set(wa(n, 'numId'), abstract.get(wa(kid(n, 'abstractNumId'), 'val')) || new Map())

  /* Footnotes and comments. */
  const footnotes = {}
  const fnMap = new Map()
  const fnDoc = parseXml(await zip.text('word/footnotes.xml'))
  for (const f of fnDoc ? [...fnDoc.getElementsByTagNameNS(W, 'footnote')] : []) {
    const t = wa(f, 'type')
    if (t === 'separator' || t === 'continuationSeparator') continue
    const id = 'fn_' + Math.random().toString(36).slice(2, 9)
    fnMap.set(wa(f, 'id'), id)
    footnotes[id] = textOf(f).trim()
  }
  const comments = []
  const cmMap = new Map()
  const cmDoc = parseXml(await zip.text('word/comments.xml'))
  for (const c of cmDoc ? [...cmDoc.getElementsByTagNameNS(W, 'comment')] : []) {
    const id = 'c_' + Math.random().toString(36).slice(2, 9)
    cmMap.set(wa(c, 'id'), id)
    const paras = kids(c, 'p').map(textOf).map(s => s.trim()).filter(Boolean)
    comments.push({ id, text: paras.join('\n'), by: wa(c, 'author') || 'Someone', uid: 'docx:' + (wa(c, 'author') || ''), at: wa(c, 'date') || new Date().toISOString(), resolved: false, replies: [] })
  }
  if (zip.has('word/endnotes.xml') && /<w:endnote [^>]*w:id="[1-9]/.test(await zip.text('word/endnotes.xml') || '')) warnings.add('Endnotes are not supported yet and were left out.')

  const settings = await zip.text('word/settings.xml')
  const mirror = /<w:mirrorMargins(\s|\/|>)/.test(settings || '') && !/<w:mirrorMargins\s+w:val="(0|false)"/.test(settings || '')

  /* Pictures, loaded as they are met. */
  const images = new Map()
  const picture = async rid => {
    if (images.has(rid)) return images.get(rid)
    const rel = rels.get(rid)
    let src = null
    if (rel && rel.mode !== 'External') {
      const path = 'word/' + rel.target.replace(/^\/?word\//, '').replace(/^\//, '')
      const ext = (path.split('.').pop() || '').toLowerCase()
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext]
      const bytes = await zip.bytes(path)
      if (!mime) warnings.add(`Pictures in .${ext} format (usually old Office drawings) could not be brought in.`)
      else if (bytes) {
        const blob = new Blob([bytes], { type: mime })
        if (opts.shrinkImage && bytes.length > 1.5 * 1024 * 1024) src = await opts.shrinkImage(blob).catch(() => null)
        else src = await blobToDataUrl(blob)
        if (src && src.length > 2.5 * 1024 * 1024) { src = null; warnings.add('A very large picture was left out.') }
      }
    }
    images.set(rid, src)
    return src
  }

  /* ── sections ── */
  const sectOf = sp => {
    if (!sp) return null
    const sz = kid(sp, 'pgSz'), mar = kid(sp, 'pgMar'), num = kid(sp, 'pgNumType')
    const w = Number(wa(sz, 'w')) / TW || 8.27, h = Number(wa(sz, 'h')) / TW || 11.69
    const orient = wa(sz, 'orient') === 'landscape' || w > h ? 'landscape' : 'portrait'
    const fmt = { decimal: 'decimal', lowerRoman: 'lower-roman', upperRoman: 'upper-roman', lowerLetter: 'lower-alpha', upperLetter: 'lower-alpha' }[wa(num, 'fmt') || 'decimal'] || 'decimal'
    const start = wa(num, 'start')
    return {
      w: Math.min(w, h), h: Math.max(w, h), orient,
      margins: mar ? { top: round2(Math.abs(Number(wa(mar, 'top'))) / TW), bottom: round2(Math.abs(Number(wa(mar, 'bottom'))) / TW), left: round2(Number(wa(mar, 'left')) / TW), right: round2(Number(wa(mar, 'right')) / TW) } : null,
      gutter: mar ? round2((Number(wa(mar, 'gutter')) || 0) / TW) : 0,
      restart: start != null, start: start != null ? Number(start) : 1, numfmt: fmt,
      titlePg: !!kid(sp, 'titlePg') && onOff(kid(sp, 'titlePg')),
      refs: [...kids(sp, 'headerReference').map(r => ({ kind: 'header', type: wa(r, 'type'), rid: r.getAttributeNS(R, 'id') || r.getAttribute('r:id') })),
        ...kids(sp, 'footerReference').map(r => ({ kind: 'footer', type: wa(r, 'type'), rid: r.getAttributeNS(R, 'id') || r.getAttribute('r:id') }))],
    }
  }
  const secs = []

  /* ── runs ── */
  const openComments = new Set()
  const runHtml = async (r, ctx) => {
    const rPr = kid(r, 'rPr')
    let html = ''
    for (const n of r.childNodes) {
      if (n.nodeType !== 1) continue
      const ln = n.localName
      if (ln === 't' || ln === 'delText') html += esc(n.textContent)
      else if (ln === 'tab' || ln === 'ptab') html += TAB_HTML
      else if (ln === 'br' || ln === 'cr') {
        if (wa(n, 'type') === 'page') ctx.pageBreak = true
        else html += '<br>'
      } else if (ln === 'noBreakHyphen') html += '‑'
      else if (ln === 'softHyphen') html += '­'
      else if (ln === 'sym') html += esc(String.fromCharCode(parseInt(wa(n, 'char') || '20', 16)))
      else if (ln === 'footnoteReference') {
        const id = fnMap.get(wa(n, 'id'))
        if (id) html += `<sup data-ds-fn="${id}" contenteditable="false">0</sup>`
      } else if (ln === 'endnoteReference') { /* warned above */ }
      else if (ln === 'drawing' || ln === 'pict') {
        const blip = n.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0]
        const rid = blip && (blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed'))
        const imData = !rid && n.getElementsByTagName('v:imagedata')[0]
        const vrid = imData && (imData.getAttributeNS(R, 'id') || imData.getAttribute('r:id'))
        const src = rid || vrid ? await picture(rid || vrid) : null
        if (src) {
          const ext = n.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0]
          const wpx = ext ? Math.round(Number(ext.getAttribute('cx')) / 9525) : 0
          const alt = n.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'docPr')[0]?.getAttribute('descr') || ''
          html += `<img src="${src}" alt="${esc(alt)}"${wpx ? ` style="width:${Math.min(wpx, 900)}px;max-width:100%"` : ''}>`
        } else if (!rid && !vrid) {
          const txt = textOf(n).trim()
          if (txt) html += esc(txt)
          warnings.add('Shapes, text boxes and charts are not supported — their text (if any) was kept, the drawing was not.')
        }
      } else if (ln === 'object') {
        warnings.add('Embedded objects (equations from old Word, OLE objects) were left out.')
      }
    }
    if (!html) return ''
    /* A footnote mark is its own superscript; no run formatting around it. */
    if (/^<sup data-ds-fn="[^"]+" contenteditable="false">0<\/sup>$/.test(html)) {
      for (const cid of openComments) html = `<span data-ds-comment="${cid}">${html}</span>`
      return html
    }
    /* Formatting, innermost first. */
    const css = []
    if (rPr) {
      const color = wa(kid(rPr, 'color'), 'val')
      if (color && /^[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== '000000') css.push(`color:#${color}`)
      const hl = wa(kid(rPr, 'highlight'), 'val')
      const HL = { yellow: '#fff59d', green: '#c8e6c9', cyan: '#b2ebf2', magenta: '#f8bbd0', blue: '#bbdefb', red: '#ffcdd2', lightGray: '#e0e0e0', darkYellow: '#ffe082' }
      if (hl && HL[hl]) css.push(`background-color:${HL[hl]}`)
      const shd = wa(kid(rPr, 'shd'), 'fill')
      if (!hl && shd && /^[0-9a-f]{6}$/i.test(shd) && shd.toLowerCase() !== 'ffffff') css.push(`background-color:#${shd}`)
      const sz = kid(rPr, 'sz')
      if (sz && !ctx.heading) {
        const pt = Number(wa(sz, 'val')) / 2
        if (pt && Math.abs(pt - (fontSize || 11)) > 0.4) css.push(`font-size:${pt}pt`)
      }
      if (onOff(kid(rPr, 'smallCaps'))) css.push('font-variant:small-caps')
      if (onOff(kid(rPr, 'caps'))) css.push('text-transform:uppercase')
      if (css.length) html = `<span style="${css.join(';')}">${html}</span>`
      const va = wa(kid(rPr, 'vertAlign'), 'val')
      if (va === 'superscript') html = `<sup>${html}</sup>`
      else if (va === 'subscript') html = `<sub>${html}</sub>`
      if (onOff(kid(rPr, 'strike')) || onOff(kid(rPr, 'dstrike'))) html = `<s>${html}</s>`
      const u = kid(rPr, 'u')
      if (u && wa(u, 'val') !== 'none') html = `<u>${html}</u>`
      if (onOff(kid(rPr, 'i'))) html = `<em>${html}</em>`
      if (onOff(kid(rPr, 'b')) && !ctx.heading) html = `<strong>${html}</strong>`
    }
    /* Comments: every run inside an open range is anchored. */
    for (const cid of openComments) html = `<span data-ds-comment="${cid}">${html}</span>`
    return html
  }

  const trackAttrs = el => {
    const by = wa(el, 'author') || 'Someone'
    const at = wa(el, 'date') || new Date().toISOString()
    return `data-ds-by="${esc(by)}" data-ds-uid="docx:${esc(by)}" data-ds-at="${esc(at)}"`
  }

  /* Inline content of a paragraph (runs, hyperlinks, revisions, fields). */
  const inlineHtml = async (parent, ctx) => {
    let out = ''
    for (const n of parent.childNodes) {
      if (n.nodeType !== 1 || n.namespaceURI !== W) continue
      const ln = n.localName
      if (ln === 'r') out += await runHtml(n, ctx)
      else if (ln === 'hyperlink') {
        const rid = n.getAttributeNS(R, 'id') || n.getAttribute('r:id')
        const rel = rid && rels.get(rid)
        const inner = await inlineHtml(n, ctx)
        out += rel?.mode === 'External' && /^(https?:|mailto:)/i.test(rel.target) ? `<a href="${esc(rel.target)}">${inner}</a>` : inner
      } else if (ln === 'ins' || ln === 'moveTo') { const inner = await inlineHtml(n, ctx); if (inner) out += `<ins ${trackAttrs(n)}>${inner}</ins>` }
      else if (ln === 'del' || ln === 'moveFrom') { const inner = await inlineHtml(n, ctx); if (inner) out += `<del ${trackAttrs(n)}>${inner}</del>` }
      else if (ln === 'commentRangeStart') { const id = cmMap.get(wa(n, 'id')); if (id) openComments.add(id) }
      else if (ln === 'commentRangeEnd') { const id = cmMap.get(wa(n, 'id')); if (id) { openComments.delete(id); ctx.anchored.add(id) } }
      else if (ln === 'fldSimple' || ln === 'smartTag' || ln === 'sdt' || ln === 'sdtContent' || ln === 'customXml') {
        out += await inlineHtml(ln === 'sdt' ? (kid(n, 'sdtContent') || n) : n, ctx)
      } else if (ln === 'oMath' || ln === 'oMathPara') {
        out += esc(textOf(n))
        warnings.add('Equations came across as plain text.')
      }
    }
    return out
  }

  /* The spacing after most paragraphs is the document's normal spacing, not
     a per-paragraph setting worth carrying. */
  const afters = new Map()
  for (const sp of body.getElementsByTagNameNS(W, 'spacing')) {
    const a = wa(sp, 'after')
    if (a != null) afters.set(Number(a), (afters.get(Number(a)) || 0) + 1)
  }
  const commonAfter = [...afters.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 160

  /* ── blocks ── */
  const parts = []                      // { kind:'p'|'li'|'raw', html, level?, ordered? }
  const anchored = new Set()
  const paraHtml = async p => {
    const pPr = kid(p, 'pPr')
    const styleId = wa(kid(pPr, 'pStyle'), 'val')
    const sk = styleKind.get(styleId) || {}
    const ctx = { heading: !!sk.h, pageBreak: false, anchored }
    const inner = await inlineHtml(p, ctx)
    if (onOff(kid(pPr, 'pageBreakBefore'))) parts.push({ kind: 'raw', html: '<div data-ds-pagebreak="1" contenteditable="false"></div>' })
    const css = []
    const attrs = []
    const jc = wa(kid(pPr, 'jc'), 'val')
    if (jc === 'center') css.push('text-align:center')
    else if (jc === 'right' || jc === 'end') css.push('text-align:right')
    else if (jc === 'both' || jc === 'distribute') css.push('text-align:justify')
    const ind = kid(pPr, 'ind')
    const ownNum = kid(pPr, 'numPr')
    const sNum = numOfStyle(styleId)
    const numPr = ownNum
      ? { numId: wa(kid(ownNum, 'numId'), 'val') ?? sNum?.numId, ilvl: Number(wa(kid(ownNum, 'ilvl'), 'val')) || 0 }
      : sNum
    if (ind && !numPr) {
      const left = Number(wa(ind, 'left') ?? wa(ind, 'start')) || 0
      const first = Number(wa(ind, 'firstLine')) || -(Number(wa(ind, 'hanging')) || 0)
      if (left) css.push(`margin-left:${round2(left / TW)}in`)
      if (first) css.push(`text-indent:${round2(first / TW)}in`)
    }
    const sp = kid(pPr, 'spacing')
    if (sp && !sk.h) {
      const before = wa(sp, 'before'), after = wa(sp, 'after')
      if (before != null && Number(before) > 0) css.push(`margin-top:${round2(Number(before) / 20)}pt`)
      if (after != null && Number(after) !== commonAfter) css.push(`margin-bottom:${round2(Number(after) / 20)}pt`)
    }
    const tabs = kids(kid(pPr, 'tabs'), 'tab').filter(t => wa(t, 'val') !== 'clear').map(t => ({
      at: round2(Number(wa(t, 'pos')) / TW), kind: wa(t, 'val') === 'center' ? 'c' : (wa(t, 'val') === 'right' || wa(t, 'val') === 'end') ? 'r' : 'l',
    })).filter(t => t.at > 0)
    if (tabs.length) attrs.push(`data-ds-tabs="${formatStops(tabs)}"`)
    const style = css.length ? ` style="${css.join(';')}"` : ''
    const at = attrs.length ? ' ' + attrs.join(' ') : ''
    const content = inner || '<br>'
    if (numPr && numPr.numId != null) {
      const lvl = numPr.ilvl || 0
      const ordered = !!nums.get(numPr.numId)?.get(lvl)
      if (numPr.numId !== '0') {
        parts.push({ kind: 'li', html: `<li${style}${at}>${content}</li>`, level: Math.min(lvl, 6), ordered })
        if (ctx.pageBreak) parts.push({ kind: 'raw', html: '<div data-ds-pagebreak="1" contenteditable="false"></div>' })
        return
      }
    }
    let tag = 'p'
    if (sk.h) tag = `h${sk.h}`
    else if (sk.quote) tag = 'blockquote'
    const ds = sk.title ? ' data-ds-style="title"' : sk.subtitle ? ' data-ds-style="subtitle"' : ''
    parts.push({ kind: 'p', html: `<${tag}${ds}${style}${at}>${content}</${tag}>` })
    if (ctx.pageBreak) parts.push({ kind: 'raw', html: '<div data-ds-pagebreak="1" contenteditable="false"></div>' })
  }
  const tableHtml = async tbl => {
    let h = '<table><tbody>'
    for (const tr of kids(tbl, 'tr')) {
      h += '<tr>'
      for (const tc of kids(tr, 'tc')) {
        const span = Number(wa(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val')) || 1
        const vm = kid(kid(tc, 'tcPr'), 'vMerge')
        if (vm && wa(vm, 'val') !== 'restart') { h += '<td></td>'; continue }
        const cellParts = []
        for (const p of kids(tc, 'p')) {
          const ctx = { heading: false, pageBreak: false, anchored }
          const inner = await inlineHtml(p, ctx)
          cellParts.push(inner || '')
        }
        const txt = cellParts.filter(Boolean).join('<br>') || '<br>'
        h += `<td${span > 1 ? ` colspan="${span}"` : ''}>${txt}</td>`
        if (kids(tc, 'tbl').length) warnings.add('Tables inside table cells were flattened.')
      }
      h += '</tr>'
    }
    return h + '</tbody></table>'
  }

  const walk = async container => {
    for (const n of container.childNodes) {
      if (n.nodeType !== 1 || n.namespaceURI !== W) continue
      if (n.localName === 'p') {
        await paraHtml(n)
        const sp = kid(kid(n, 'pPr'), 'sectPr')
        if (sp) {
          /* The paragraph that carries a section's properties is usually an
             empty one Word adds for the purpose. */
          const lastPart = parts[parts.length - 1]
          if (lastPart?.kind === 'p' && /^<p[^>]*><br><\/p>$/.test(lastPart.html)) parts.pop()
          secs.push(sectOf(sp)); parts.push({ kind: 'section', index: secs.length })
        }
      } else if (n.localName === 'tbl') parts.push({ kind: 'raw', html: await tableHtml(n) })
      else if (n.localName === 'sdt') await walk(kid(n, 'sdtContent') || n)
      else if (n.localName === 'customXml') await walk(n)
      else if (n.localName === 'sectPr') secs.push(sectOf(n))
    }
  }
  await walk(body)
  if (!secs.length) secs.push(sectOf(null) || { w: 8.27, h: 11.69, orient: 'portrait', margins: null, gutter: 0, restart: true, start: 1, numfmt: 'decimal', refs: [] })

  /* Lists: consecutive items become nested <ul>/<ol>. A section marker's
     break describes the section AFTER it (lib/docsections.js). */
  let html = ''
  let stack = []                        // [{ tag }]
  const closeTo = depth => { while (stack.length > depth) html += `</${stack.pop().tag}>` }
  for (const part of parts) {
    if (part.kind === 'li') {
      const want = part.level + 1
      const tag = part.ordered ? 'ol' : 'ul'
      if (stack.length > want) closeTo(want)
      if (stack.length === want && stack[want - 1].tag !== tag) closeTo(want - 1)
      while (stack.length < want) { html += `<${tag}>`; stack.push({ tag }) }
      html = html.replace(/<\/li>$/, '')   // nest inside the previous item when deeper
      html += part.html
      continue
    }
    closeTo(0)
    if (part.kind === 'section') {
      const next = secs[part.index]
      if (next) html += sectionBreakHtml({ orient: next.orient, restart: next.restart, start: next.start, numfmt: next.numfmt }).replace(/<p><br><\/p>$/, '')
      continue
    }
    html += part.html
  }
  closeTo(0)
  /* Every list item closed: a deeper list opened right after an item sits
     inside it (see the replace above), so close any item left open. */
  html = balanceLi(html)

  /* ── page setup from the first section ── */
  const s0 = secs[0]
  let pageSize = 'custom'
  for (const [id, z] of Object.entries(PAGE_SIZES)) if (Math.abs(z.w - s0.w) < 0.06 && Math.abs(z.h - s0.h) < 0.06) pageSize = id
  const patch = {
    name: opts.name || 'Document',
    content: html || '<p><br></p>',
    pageSize,
    ...(pageSize === 'custom' ? { pageCustom: { w: round2(s0.w), h: round2(s0.h) } } : {}),
    orientation: s0.orient,
    ...(s0.margins ? { margins: s0.margins } : {}),
    ...(s0.gutter ? { gutter: s0.gutter } : {}),
    ...(mirror ? { mirror: true } : {}),
    ...(s0.start !== 1 ? { pageStart: s0.start } : {}),
    ...(s0.numfmt !== 'decimal' ? { numFmt: s0.numfmt } : {}),
  }
  const known = font && DOC_FONTS.find(f => f.name.toLowerCase() === font.toLowerCase())
  if (known) patch.font = known.name
  else if (font) warnings.add(`The font "${font}" is not one the Document offers; it opens in the nearest default.`)
  if (fontSize && fontSize >= 8 && fontSize <= 24) patch.fontSize = fontSize
  if (Object.keys(footnotes).length) patch.footnotes = footnotes
  const used = comments.filter(c => anchored.has(c.id) || html.includes(c.id))
  if (used.length) patch.comments = used

  /* Headers and footers of the first section. */
  const hf = {}
  for (const ref of s0.refs || []) {
    const rel = rels.get(ref.rid)
    if (!rel) continue
    const xml = parseXml(await zip.text('word/' + rel.target.replace(/^\//, '')))
    const slot = hfSlot(xml)
    if (!slot) continue
    const key = ref.type === 'first' ? (ref.kind === 'header' ? 'firstHeader' : 'firstFooter') : ref.type === 'default' ? ref.kind : null
    if (key) hf[key] = slot
    if (ref.type === 'even') warnings.add('Different odd and even headers are not supported; the odd-page ones were kept.')
  }
  if (s0.titlePg) hf.firstDifferent = true
  patch.hf = Object.keys(hf).length ? hf : { footer: {} }

  if (zip.names().some(n => /^word\/charts\//.test(n))) warnings.add('Charts were left out.')
  return { patch, warnings: [...warnings] }
}

/** l / c / r from a header or footer part: split at tabs; PAGE and NUMPAGES
 *  fields become {page} and {pages}. */
function hfSlot(xml) {
  if (!xml) return null
  const p = xml.getElementsByTagNameNS(W, 'p')
  const segs = ['']
  let field = null            // collecting a complex field's instruction
  const walk = node => {
    for (const n of node.childNodes) {
      if (n.nodeType !== 1) continue
      const ln = n.localName
      if (ln === 'fldSimple') {
        const ins = (wa(n, 'instr') || '').trim().split(/\s+/)[0].toUpperCase()
        segs[segs.length - 1] += ins === 'PAGE' ? '{page}' : ins === 'NUMPAGES' || ins === 'SECTIONPAGES' ? '{pages}' : textOf(n)
        continue
      }
      if (ln === 'fldChar') {
        const t = wa(n, 'fldCharType')
        if (t === 'begin') field = { instr: '', result: false }
        else if (t === 'separate' && field) {
          field.result = true
          const ins = field.instr.trim().split(/\s+/)[0].toUpperCase()
          segs[segs.length - 1] += ins === 'PAGE' ? '{page}' : ins === 'NUMPAGES' || ins === 'SECTIONPAGES' ? '{pages}' : ''
          field.known = ['PAGE', 'NUMPAGES', 'SECTIONPAGES'].includes(ins)
        } else if (t === 'end') field = null
        continue
      }
      if (ln === 'instrText') { if (field) field.instr += n.textContent; continue }
      if (ln === 't') { if (!(field && field.result && field.known)) segs[segs.length - 1] += n.textContent; continue }
      if (ln === 'tab' || ln === 'ptab') { segs.push(''); continue }
      walk(n)
    }
  }
  for (const para of p) { walk(para); if (segs[segs.length - 1]) segs.push('') }
  const s = segs.map(x => x.trim()).filter((x, i, a) => x || i < a.length - 1)
  const parts = s.filter(Boolean)
  if (!parts.length) return null
  if (s.length === 1) return { l: s[0] }
  if (s.length === 2) return s[0] ? { l: s[0], r: s[1] } : { c: s[1] }
  return { l: s[0] || '', c: s[1] || '', r: s.slice(2).filter(Boolean).join(' ') }
}

function textOf(el) {
  let s = ''
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue
      if (c.localName === 't' || c.localName === 'delText') s += c.textContent
      else if (c.localName === 'tab') s += '\t'
      else if (c.localName === 'p' && s) { s += '\n'; walk(c) } else walk(c)
    }
  }
  walk(el)
  return s
}

/* A <li> that opened a nested list was left open by the list builder; close
   each one after the list it holds. Uses the DOM, which is here anyway. */
function balanceLi(html) {
  const t = document.createElement('template')
  t.innerHTML = html
  return t.innerHTML
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(fr.error)
    fr.readAsDataURL(blob)
  })
}
