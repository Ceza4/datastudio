/*
  lib/docexport.js
  --------------------------------------------------------------------------
  EXPORTING A DOCUMENT BLOCK — .docx and .pdf, both required.

  ── THE ASSUMPTION THAT TURNED OUT TO BE WRONG ─────────────────────────────

  The handoff said "no writer library in the stack yet" for .docx and proposed
  evaluating the `docx` npm package. Grounding that against the code: there IS
  one. lib/exporters.js has had a real OOXML writer since the export panel
  shipped — `exportDocx`, `wPara`, `wTable`, a styles part and a sectPr — built
  on lib/zip.js, whose own header explains at length why 90 lines of ZIP writer
  beat a 200KB–1MB dependency.

  So no dependency is added and none needs evaluating. What this file does is
  extend that machinery from "one paragraph per block" to "a real document": the
  Document block's stored HTML becomes WordprocessingML paragraphs with runs that
  keep bold, italic, underline, strikethrough, superscript and subscript, its
  page setup becomes a real `sectPr`, and its deliberate page breaks become real
  `<w:br w:type="page"/>`.

  ── PDF GOES THROUGH THE BROWSER'S PRINT ENGINE, AND THAT IS THE RIGHT CALL ──

  The handoff flagged that pdf-lib is wired for editing existing PDFs and asked
  whether its from-scratch API covers this content model. It does not, usefully:
  pdf-lib draws text at coordinates. Flowing headings, wrapped paragraphs, lists
  and tables across pages with correct font metrics means writing a layout engine
  — the exact thing the whole continuous-scroll design exists to avoid.

  lib/exporters.js already exports PDF through the browser's print engine, and
  for this content that is strictly better: the browser has the real font
  metrics, does the real page-breaking, and honours `@page` size and margins and
  `break-before: page`. The guide lines in the editor are an estimate; this is
  the source of truth, and it is the source of truth precisely because something
  that actually knows the font metrics is doing the breaking.

  ── PAGINATION IS HONOURED HERE, NOT IN THE EDITOR ─────────────────────────

  Both paths read `pageSize`, `orientation` and `margins` — the same values the
  ruler drags and the Layout tab writes. And both honour `data-ds-pagebreak`
  exactly: unlike the automatic guides, a break the user placed is a promise.
  -------------------------------------------------------------------------- */

import { createZip, xmlEscape } from './zip.js'
import { sanitizeHtml } from './sanitize.js'
import { pageInches, fontStack, DEFAULT_DOC_FONT } from './pagesetup.js'

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** Twentieths of a point — OOXML's unit for page and margin dimensions. */
const TWIPS_PER_IN = 1440
const twips = inches => Math.round((Number(inches) || 0) * TWIPS_PER_IN)

const safe = s => String(s || 'document').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'document'
const stamp = () => new Date().toISOString().slice(0, 10)

/* ── HTML → a flat list of paragraphs ─────────────────────────────────────
   A tiny tag-stack parser rather than a DOM walk, for the same reason
   lib/sanitize.js is one: this has to be testable in Node without a DOM, and
   the export path must not depend on the document that produced it still being
   mounted.

   It produces a FLAT list on purpose. Word's model is flat too — a nested list
   is paragraphs with an indent level, not a tree — so flattening here means the
   OOXML writer below has no recursion in it at all. */

const HEADING = /^h([1-6])$/i
const INLINE_MARKS = {
  b: 'bold', strong: 'bold',
  i: 'italic', em: 'italic',
  u: 'underline',
  s: 'strike', strike: 'strike', del: 'strike',
  sup: 'sup', sub: 'sub',
  code: 'mono',
}

const decode = s => String(s)
  .replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')

/**
 * @returns {Array<{kind:'p'|'h'|'li'|'break', level?:number, ordered?:boolean,
 *                  indent?:number, runs:Array<{text:string,marks:object}>}>}
 */
export function parseDocHtml(html) {
  const src = String(html || '')
  const out = []
  /* Active inline marks, as a count per mark so `<b>a<b>b</b>c</b>` closes
     correctly rather than the inner tag ending the outer one. */
  const marks = {}
  let listDepth = 0
  let ordered = []
  let cur = null

  const startPara = (kind, extra = {}) => { cur = { kind, runs: [], ...extra } }
  const endPara = () => {
    if (cur && (cur.runs.length || cur.kind === 'break')) out.push(cur)
    cur = null
  }
  const pushText = t => {
    if (!t) return
    if (!cur) startPara('p')
    const active = {}
    for (const k of Object.keys(marks)) if (marks[k] > 0) active[k] = true
    cur.runs.push({ text: t, marks: active })
  }

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g
  let last = 0
  let m
  while ((m = re.exec(src)) !== null) {
    const between = src.slice(last, m.index)
    if (between) pushText(decode(between).replace(/\s+/g, ' '))
    last = re.lastIndex

    const closing = !!m[1]
    const tag = m[2].toLowerCase()
    const attrs = m[3] || ''

    /* A DELIBERATE page break. Emitted as its own entry so both writers can
       honour it exactly — the one thing about pagination that is a promise
       rather than an estimate. */
    if (!closing && /data-ds-pagebreak/i.test(attrs)) {
      endPara()
      out.push({ kind: 'break', runs: [] })
      continue
    }

    if (INLINE_MARKS[tag]) {
      const k = INLINE_MARKS[tag]
      marks[k] = (marks[k] || 0) + (closing ? -1 : 1)
      if (marks[k] < 0) marks[k] = 0
      continue
    }

    if (tag === 'br') { pushText('\n'); continue }

    if (HEADING.test(tag)) {
      endPara()
      if (!closing) startPara('h', { level: Number(tag.slice(1)) })
      continue
    }

    if (tag === 'ul' || tag === 'ol') {
      endPara()
      if (closing) { listDepth = Math.max(0, listDepth - 1); ordered.pop() }
      else { listDepth += 1; ordered.push(tag === 'ol') }
      continue
    }

    if (tag === 'li') {
      endPara()
      if (!closing) {
        startPara('li', {
          indent: Math.max(0, listDepth - 1),
          ordered: !!ordered[ordered.length - 1],
        })
      }
      continue
    }

    if (tag === 'p' || tag === 'div' || tag === 'blockquote' || tag === 'pre') {
      endPara()
      if (!closing) startPara(tag === 'blockquote' ? 'quote' : 'p')
      continue
    }

    /* Everything else — spans, tables, images — contributes its text and no
       structure. Tables in a Document are a v1 gap and flagged as one rather
       than silently exported as run-together prose: see documentToDocx. */
  }
  const tail = src.slice(last)
  if (tail) pushText(decode(tail).replace(/\s+/g, ' '))
  endPara()

  return out.filter(p => p.kind === 'break' || p.runs.some(r => r.text.trim()))
}

/* ── .docx ────────────────────────────────────────────────────────────── */

function wRuns(runs, baseSizePt) {
  return runs.map(r => {
    const mk = r.marks || {}
    const props = [
      mk.bold ? '<w:b/>' : '',
      mk.italic ? '<w:i/>' : '',
      mk.underline ? '<w:u w:val="single"/>' : '',
      mk.strike ? '<w:strike/>' : '',
      mk.sup ? '<w:vertAlign w:val="superscript"/>' : '',
      mk.sub ? '<w:vertAlign w:val="subscript"/>' : '',
      mk.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
      /* Half-points, which is OOXML's unit for w:sz. */
      `<w:sz w:val="${Math.round(baseSizePt * 2)}"/><w:szCs w:val="${Math.round(baseSizePt * 2)}"/>`,
    ].join('')
    /* A soft line break inside a run becomes a real <w:br/>, in order, rather
       than a literal newline character — which Word renders as a space. */
    const body = String(r.text).split('\n')
      .map((ln, i) => `${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(ln)}</w:t>`)
      .join('')
    return `<w:r><w:rPr>${props}</w:rPr>${body}</w:r>`
  }).join('')
}

function wDocPara(p, baseSizePt, lineSpacing) {
  if (p.kind === 'break') {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  }
  const pr = []
  if (p.kind === 'h') pr.push(`<w:pStyle w:val="Heading${Math.min(3, p.level || 1)}"/>`)
  if (p.kind === 'quote') pr.push('<w:pStyle w:val="Quote"/><w:ind w:left="454"/>')
  if (p.kind === 'li') {
    pr.push(`<w:numPr><w:ilvl w:val="${p.indent || 0}"/><w:numId w:val="${p.ordered ? 2 : 1}"/></w:numPr>`)
  }
  /* w:line is in 240ths of a line, `auto` meaning multiple-of-single. */
  pr.push(`<w:spacing w:after="120" w:line="${Math.round((lineSpacing || 1.5) * 240)}" w:lineRule="auto"/>`)
  return `<w:p><w:pPr>${pr.join('')}</w:pPr>${wRuns(p.runs, baseSizePt)}</w:p>`
}

/**
 * A Document block as a real, editable .docx.
 * @returns {{blob: Blob, filename: string, warnings: string[]}}
 */
export function documentToDocx(block) {
  const paras = parseDocHtml(block?.content)
  const page = pageInches(block?.pageSize, block?.orientation)
  const m = block?.margins || { top: 1, bottom: 1, left: 1, right: 1 }
  const sizePt = Number(block?.fontSize) || 11
  const fontName = block?.font || DEFAULT_DOC_FONT
  const name = block?.name || 'Document'

  const warnings = []
  /* Said out loud rather than silently degraded. A table exported as run-together
     prose is worse than a table the user knows did not come across, because the
     first one looks like it worked. */
  if (/<table[\s>]/i.test(String(block?.content || ''))) {
    warnings.push('Tables inside a Document export as plain text for now — their cell structure is not carried across.')
  }
  if (/<img[\s>]/i.test(String(block?.content || ''))) {
    warnings.push('Images inside a Document are not embedded in the .docx yet.')
  }

  const body = paras.length
    ? paras.map(p => wDocPara(p, sizePt, block?.lineSpacing)).join('')
    : `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`

  const sectPr =
    `<w:sectPr>` +
    `<w:pgSz w:w="${twips(page.w)}" w:h="${twips(page.h)}"${block?.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" w:header="0" w:footer="0" w:gutter="0"/>` +
    `</w:sectPr>`

  const zip = createZip()
  // [Content_Types].xml must be the FIRST entry in an OOXML archive.
  zip.addFile('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`)
  zip.addFile('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.addFile('word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`)
  /* The document's chosen font becomes the DEFAULT for the whole file, via
     docDefaults — so a Georgia document opens as Georgia rather than as
     Calibri with the run properties fighting it. */
  zip.addFile('word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="${xmlEscape(fontName)}" w:hAnsi="${xmlEscape(fontName)}" w:cs="${xmlEscape(fontName)}"/>
<w:sz w:val="${Math.round(sizePt * 2)}"/><w:szCs w:val="${Math.round(sizePt * 2)}"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(sizePt * 2 * 1.9)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(sizePt * 2 * 1.5)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(sizePt * 2 * 1.2)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`)
  /* Real numbering definitions, so bullets are bullets and numbered lists count
     — a <w:numPr> pointing at a numId that does not exist renders as an
     unindented paragraph with no marker at all. */
  zip.addFile('word/numbering.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}>
<w:abstractNum w:abstractNumId="1">${[0, 1, 2, 3].map(l => `
  <w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
  <w:pPr><w:ind w:left="${454 * (l + 1)}" w:hanging="284"/></w:pPr>
  <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl>`).join('')}
</w:abstractNum>
<w:abstractNum w:abstractNumId="2">${[0, 1, 2, 3].map(l => `
  <w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${l + 1}."/>
  <w:pPr><w:ind w:left="${454 * (l + 1)}" w:hanging="284"/></w:pPr></w:lvl>`).join('')}
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`)
  zip.addFile('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}${sectPr}</w:body></w:document>`)

  return {
    blob: zip.toBlob('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    filename: `${safe(name)}-${stamp()}.docx`,
    warnings,
  }
}

/* ── .pdf ─────────────────────────────────────────────────────────────── */

/**
 * The print-ready HTML for one Document block.
 *
 * Separate from the window-opening so it can be asserted without a browser —
 * the part most likely to be quietly wrong is the @page rule and the
 * page-break handling, and both are strings.
 */
export function documentPrintHtml(block) {
  const page = pageInches(block?.pageSize, block?.orientation)
  const m = block?.margins || { top: 1, bottom: 1, left: 1, right: 1 }
  const name = block?.name || 'Document'
  /* THE EXPORT PROFILE, not the editor one. Content leaving the app goes
     through the strict sanitiser: this HTML is written into another window, and
     an editor-profile allowance (inline styles, <input>) has no business
     crossing that boundary. */
  const body = sanitizeHtml(block?.content || '') || '<p></p>'

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${xmlEscape(name)}</title>
<style>
  /* @page is what makes the exported PDF the SOURCE OF TRUTH for page breaks:
     the browser's print engine has the real font metrics and does the real
     breaking, which is exactly what the editor's dashed guides only estimate. */
  @page {
    size: ${page.w}in ${page.h}in;
    margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in;
  }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body {
    font-family: ${fontStack(block?.font)};
    font-size: ${Number(block?.fontSize) || 11}pt;
    line-height: ${block?.lineSpacing || 1.5};
  }
  h1 { font-size: 1.9em; margin: 0.6em 0 0.3em; }
  h2 { font-size: 1.5em; margin: 0.6em 0 0.25em; }
  h3 { font-size: 1.2em; margin: 0.5em 0 0.2em; }
  /* Headings do not end a page alone, and a paragraph does not leave one line
     behind. The two rules that most separate a printed document from a web page
     that happened to be printed. */
  h1, h2, h3 { break-after: avoid-page; page-break-after: avoid; }
  p, li { orphans: 2; widows: 2; }
  ul, ol { padding-left: 1.6em; }
  blockquote { margin: 0.7em 0; padding-left: 0.9em; border-left: 2px solid #bbb; font-style: italic; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #bbb; padding: 0.25em 0.5em; }
  img { max-width: 100%; height: auto; }
  sup, sub { line-height: 0; font-size: 0.72em; }
  /* A DELIBERATE break is honoured EXACTLY, unlike the automatic guides.
     Both properties are set: break-before is the current spec, and
     page-break-before is what older print engines still read. */
  [data-ds-pagebreak] {
    break-before: page;
    page-break-before: always;
    height: 0; border: 0; margin: 0;
  }
</style></head>
<body>${body}</body></html>`
}

/**
 * Open the print dialog for a Document block.
 * Throws with a sentence for a person when the pop-up is blocked, matching
 * lib/exporters.js's own exportPdf.
 */
export function documentToPdf(block) {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) throw new Error('Pop-up blocked. Allow pop-ups for this site to export a PDF.')
  w.document.write(documentPrintHtml(block))
  w.document.close()
}
