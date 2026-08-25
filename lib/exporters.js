/*
  lib/exporters.js
  --------------------------------------------------------------------------
  Every export format DataStudio can emit, with no new dependencies.

  DESIGN NOTE — why formats are matched to block types
  A notebook sheet is heterogeneous: tables, prose, kanban boards, sections.
  "Export the canvas as Excel" is only meaningful for the table blocks;
  "export as Word" is only meaningful once prose is involved. So each exporter
  declares which block types it can carry, and the panel greys out the rest
  rather than silently producing an empty file. `formatsFor(blocks)` drives
  that.

  DESIGN NOTE — PDF via the print pipeline
  There is no bundled PDF writer. Rather than ship a 400KB library to produce
  a worse result, PDF export renders the document to a styled print window and
  hands off to the browser's own PDF engine. That yields real selectable,
  searchable text with proper font embedding — a file that stays editable in
  Acrobat or Word — instead of the rasterised or single-font output a
  hand-rolled writer would give. The user picks "Save as PDF" in the print
  dialog. Trade-off: one extra click, and no programmatic page control.
  -------------------------------------------------------------------------- */

import * as XLSX from 'xlsx'
import { createZip, xmlEscape } from './zip.js'
import { sanitizeHtml } from './sanitize.js'
import { makeColors } from './theme.js'
import { csvCell } from './csv.js'

/* ── shared helpers ──────────────────────────────────────────────────── */

export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke on the next tick; revoking synchronously cancels the download in
  // Safari and older Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const stamp = () => new Date().toISOString().slice(0, 10)
const safe = s => String(s || 'untitled').replace(/[^a-z0-9\-_ ]/gi, '_').trim().slice(0, 60) || 'untitled'

/** contentEditable HTML -> plain text, preserving block structure as newlines. */
export function htmlToText(html) {
  if (!html) return ''
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const blockTitle = (b, i) => b.name || `${b.type[0].toUpperCase()}${b.type.slice(1)} ${i + 1}`

/* Which formats make sense for a given selection of blocks. */
export const FORMATS = [
  { id: 'pdf',      label: 'PDF',          ext: 'pdf',  group: 'Documents', accepts: ['*'],       note: 'Selectable text, editable in Acrobat' },
  { id: 'docx',     label: 'Word',         ext: 'docx', group: 'Documents', accepts: ['*'],       note: 'Real .docx — fully editable' },
  { id: 'md',       label: 'Markdown',     ext: 'md',   group: 'Documents', accepts: ['*'],       note: 'Plain text, tables as pipes' },
  { id: 'xlsx',     label: 'Excel',        ext: 'xlsx', group: 'Data',      accepts: ['table'],   note: 'One worksheet per table' },
  { id: 'csv',      label: 'CSV',          ext: 'csv',  group: 'Data',      accepts: ['table'],   note: 'One file, or a zip if multiple' },
  { id: 'pptx',     label: 'PowerPoint',   ext: 'pptx', group: 'Slides',    accepts: ['*'],       note: 'One slide per block' },
  { id: 'png',      label: 'Image',        ext: 'png',  group: 'Visual',    accepts: ['*'],       note: 'PNG raster of the layout' },
  { id: 'html',     label: 'Embed / HTML', ext: 'html', group: 'Web',       accepts: ['*'],       note: 'Self-contained, paste anywhere' },
  { id: 'json',     label: 'JSON',         ext: 'json', group: 'Web',       accepts: ['*'],       note: 'Round-trips back into DataStudio' },
]

export function formatsFor(blocks) {
  const types = new Set(blocks.map(b => b.type))
  return FORMATS.map(f => ({
    ...f,
    enabled: f.accepts.includes('*') || [...types].some(t => f.accepts.includes(t)),
  }))
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

export function tableToCsv(block) {
  const headers = block.headers || []
  const lines = [headers.map(csvCell).join(',')]
  for (const row of (block.rows || [])) {
    // Skip fully blank trailing rows — the grid keeps virtual rows past the
    // data, and exporting them produces a file with hundreds of empty lines.
    if (!row?.some(c => c !== '' && c != null)) continue
    lines.push(headers.map((_, ci) => csvCell(row?.[ci])).join(','))
  }
  return lines.join('\r\n')   // CRLF: Excel on Windows requires it
}

export function exportCsv(blocks, name) {
  const tables = blocks.filter(b => b.type === 'table')
  if (tables.length === 0) throw new Error('No table blocks in the selection.')
  if (tables.length === 1) {
    download(new Blob([tableToCsv(tables[0])], { type: 'text/csv;charset=utf-8' }),
      `${safe(tables[0].name || name)}-${stamp()}.csv`)
    return
  }
  // Multiple tables can't share one CSV without losing their identity, so they
  // ship as a zip of separate files rather than being concatenated.
  const zip = createZip()
  const used = new Set()
  tables.forEach((t, i) => {
    let fn = `${safe(t.name || `table-${i + 1}`)}.csv`
    while (used.has(fn)) fn = `${safe(t.name || 'table')}-${i + 1}.csv`
    used.add(fn)
    zip.addFile(fn, tableToCsv(t))
  })
  download(zip.toBlob(), `${safe(name)}-csv-${stamp()}.zip`)
}

/* ── Excel ───────────────────────────────────────────────────────────── */

export function exportXlsx(blocks, name) {
  const tables = blocks.filter(b => b.type === 'table')
  if (tables.length === 0) throw new Error('No table blocks in the selection.')
  const wb = XLSX.utils.book_new()
  const used = new Set()
  tables.forEach((t, i) => {
    const aoa = [t.headers || [], ...(t.rows || [])]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // Column widths from content, so the file doesn't open with ####.
    ws['!cols'] = (t.headers || []).map((h, ci) => {
      let w = String(h ?? '').length
      for (const r of (t.rows || [])) w = Math.max(w, String(r?.[ci] ?? '').length)
      return { wch: Math.min(60, Math.max(9, w + 2)) }
    })
    // (Frozen header rows are a SheetJS Pro feature — not set here rather than
    // set and silently ignored.)
    // Excel sheet names: max 31 chars, no  : \ / ? * [ ]  and must be unique.
    let sn = (t.name || `Table ${i + 1}`).replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || `Table ${i + 1}`
    let n = 1
    while (used.has(sn.toLowerCase())) { sn = `${sn.slice(0, 27)} (${++n})` }
    used.add(sn.toLowerCase())
    XLSX.utils.book_append_sheet(wb, ws, sn)
  })
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safe(name)}-${stamp()}.xlsx`)
}

/* ── Markdown ────────────────────────────────────────────────────────── */

export function blocksToMarkdown(blocks, name) {
  const out = [`# ${name}`, '']
  blocks.forEach((b, i) => {
    out.push(`## ${blockTitle(b, i)}`, '')
    if (b.type === 'table') {
      const h = b.headers || []
      out.push('| ' + h.map(x => String(x ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |')
      out.push('| ' + h.map(() => '---').join(' | ') + ' |')
      for (const r of (b.rows || [])) {
        if (!r?.some(c => c !== '' && c != null)) continue
        out.push('| ' + h.map((_, ci) => String(r?.[ci] ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |')
      }
    } else if (b.type === 'text') {
      out.push(htmlToText(b.content) || '_empty_')
    } else if (b.type === 'kanban') {
      for (const lane of (b.lanes || [])) {
        out.push(`### ${lane.name || 'Lane'}`)
        for (const c of (lane.cards || [])) out.push(`- [ ] ${typeof c === 'string' ? c : (c.text || c.title || '')}`)
        out.push('')
      }
    } else if (b.type === 'image') {
      // Bytes live in IndexedDB, not in the block, so text formats reference
      // the image rather than embedding it. Alt text is the useful payload.
      out.push(`![${b.alt || b.name || 'Image'}](${b.name || 'image'})`)
      if (!b.alt) out.push('', '_(no alt text set)_')
    } else if (b.type === 'section') {
      out.push(`_Section: ${b.name || 'Section'}_`)
    }
    out.push('')
  })
  return out.join('\n')
}

export function exportMarkdown(blocks, name) {
  download(new Blob([blocksToMarkdown(blocks, name)], { type: 'text/markdown;charset=utf-8' }),
    `${safe(name)}-${stamp()}.md`)
}

/* ── JSON (round-trip / embed) ───────────────────────────────────────── */

export function exportJson(blocks, name) {
  const payload = {
    format: 'datastudio.blocks',
    version: 1,
    name,
    exportedAt: new Date().toISOString(),
    blocks: blocks.map(({ id, type, name: n, x, y, w, h, headers, rows, content, lanes, sectionColor }) => ({
      id, type, name: n, x, y, w, h, headers, rows, content, lanes, sectionColor,
    })),
  }
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `${safe(name)}-${stamp()}.json`)
}

/* ── HTML (also the source for PDF) ──────────────────────────────────── */

export function blocksToHtml(blocks, name, { forPrint = false } = {}) {
  const esc = xmlEscape
  const body = blocks.map((b, i) => {
    const title = `<h2>${esc(blockTitle(b, i))}</h2>`
    if (b.type === 'table') {
      const head = `<tr>${(b.headers || []).map(h => `<th>${esc(h)}</th>`).join('')}</tr>`
      const rows = (b.rows || [])
        .filter(r => r?.some(c => c !== '' && c != null))
        .map(r => `<tr>${(b.headers || []).map((_, ci) => `<td>${esc(r?.[ci] ?? '')}</td>`).join('')}</tr>`)
        .join('')
      return `<section>${title}<table>${head}${rows}</table></section>`
    }
    if (b.type === 'text') {
      /* Already HTML from the contentEditable, so it cannot be entity-escaped
         like every other branch here — it has to be PARSED and rebuilt. See
         lib/sanitize.js for why the two regexes that used to live on this line
         were worse than nothing: one of them could assemble a <script> tag out
         of input that contained none.

         This matters most for exportPdf, which document.writes the result into
         a window.open('') — same origin as the app, and therefore same reach
         into IndexedDB. */
      const clean = sanitizeHtml(b.content || '')
      return `<section>${title}<div class="prose">${clean || '<p><em>empty</em></p>'}</div></section>`
    }
    if (b.type === 'kanban') {
      const lanes = (b.lanes || []).map(l =>
        `<div class="lane"><h3>${esc(l.name || 'Lane')}</h3>${(l.cards || [])
          .map(c => `<div class="card">${esc(typeof c === 'string' ? c : (c.text || c.title || ''))}</div>`).join('')}</div>`
      ).join('')
      return `<section>${title}<div class="board">${lanes}</div></section>`
    }
    if (b.type === 'image') {
      return `<section>${title}<p class="muted">Image: ${esc(b.alt || b.name || 'untitled')}${b.alt ? '' : ' — no alt text set'}</p></section>`
    }
    return `<section>${title}<p class="muted">Section</p></section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(name)}</title>
<style>
  :root{--ink:#1A1917;--mut:#6B6860;--line:#D5D1C7;--accent:#1D9E75;--bg:#fff}
  *{box-sizing:border-box}
  body{margin:0;padding:40px;background:var(--bg);color:var(--ink);
    font:14px/1.65 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:900px}
  h1{font-size:26px;margin:0 0 4px;letter-spacing:-.4px}
  .meta{color:var(--mut);font-size:12px;margin-bottom:30px}
  section{margin:0 0 34px;break-inside:avoid}
  h2{font-size:16px;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid var(--accent)}
  h3{font-size:13px;margin:0 0 8px;color:var(--mut)}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th{background:#F1EFE9;text-align:left;font-weight:600;padding:7px 9px;border:1px solid var(--line)}
  td{padding:6px 9px;border:1px solid var(--line);font-variant-numeric:tabular-nums}
  tr:nth-child(even) td{background:#FAF9F6}
  .prose{font-size:13.5px}
  .prose h1{font-size:20px}.prose h2{font-size:17px;border:0;padding:0}
  .prose pre{background:#F1EFE9;padding:12px;border-left:3px solid var(--accent);overflow-x:auto}
  .prose blockquote{border-left:3px solid var(--line);margin:10px 0;padding-left:14px;font-style:italic}
  .board{display:flex;gap:14px;flex-wrap:wrap}
  .lane{flex:1;min-width:150px;background:#FAF9F6;border:1px solid var(--line);border-radius:8px;padding:10px}
  .card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:6px 9px;margin-bottom:6px;font-size:12px}
  .muted{color:var(--mut);font-style:italic}
  @page{margin:16mm}
  @media print{body{padding:0;max-width:none}section{break-inside:avoid}}
</style></head>
<body>
<h1>${esc(name)}</h1>
<div class="meta">DataStudio · ${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString()}</div>
${body}
${forPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>' : ''}
</body></html>`
}

export function exportHtml(blocks, name) {
  download(new Blob([blocksToHtml(blocks, name)], { type: 'text/html;charset=utf-8' }),
    `${safe(name)}-${stamp()}.html`)
}

/* ── PDF (browser print engine) ──────────────────────────────────────── */

export function exportPdf(blocks, name) {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) throw new Error('Pop-up blocked. Allow pop-ups for this site to export PDF.')
  w.document.write(blocksToHtml(blocks, name, { forPrint: true }))
  w.document.close()
}

/* ── Word (.docx, real OOXML) ────────────────────────────────────────── */

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function wPara(text, { bold, size, heading } = {}) {
  const sz = size ? `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>` : ''
  const b = bold ? '<w:b/>' : ''
  const style = heading ? `<w:pStyle w:val="Heading${heading}"/>` : ''
  const lines = String(text ?? '').split('\n')
  const runs = lines.map((ln, i) =>
    `<w:r><w:rPr>${b}${sz}</w:rPr>${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(ln)}</w:t></w:r>`
  ).join('')
  return `<w:p><w:pPr>${style}<w:spacing w:after="120"/></w:pPr>${runs}</w:p>`
}

function wTable(block) {
  const headers = block.headers || []
  const cell = (t, isHead) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${isHead ? '<w:shd w:val="clear" w:fill="F1EFE9"/>' : ''}</w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr>${isHead ? '<w:b/>' : ''}<w:sz w:val="18"/></w:rPr>` +
    `<w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r></w:p></w:tc>`
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map(h => cell(h, true)).join('')}</w:tr>`
  const body = (block.rows || [])
    .filter(r => r?.some(c => c !== '' && c != null))
    .map(r => `<w:tr>${headers.map((_, ci) => cell(r?.[ci] ?? '', false)).join('')}</w:tr>`).join('')
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>
    <w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="D5D1C7"/>`).join('')}</w:tblBorders>
    </w:tblPr>${head}${body}</w:tbl><w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>`
}

export function exportDocx(blocks, name) {
  const parts = [wPara(name, { bold: true, size: 20, heading: 1 })]
  blocks.forEach((b, i) => {
    parts.push(wPara(blockTitle(b, i), { bold: true, size: 13, heading: 2 }))
    if (b.type === 'table') parts.push(wTable(b))
    else if (b.type === 'text') parts.push(wPara(htmlToText(b.content) || '(empty)', { size: 11 }))
    else if (b.type === 'kanban') {
      for (const lane of (b.lanes || [])) {
        parts.push(wPara(lane.name || 'Lane', { bold: true, size: 11 }))
        for (const c of (lane.cards || [])) {
          parts.push(wPara('• ' + (typeof c === 'string' ? c : (c.text || c.title || '')), { size: 11 }))
        }
      }
    } else if (b.type === 'image') {
      parts.push(wPara(`[Image: ${b.alt || b.name || 'untitled'}]`, { size: 11 }))
    } else parts.push(wPara('(section)', { size: 11 }))
  })

  const zip = createZip()
  // [Content_Types].xml must be first in the archive.
  zip.addFile('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
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
</Relationships>`)
  zip.addFile('word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`)
  zip.addFile('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${parts.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`)

  download(zip.toBlob('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    `${safe(name)}-${stamp()}.docx`)
}

/* ── PowerPoint (.pptx, real OOXML) ──────────────────────────────────── */

const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const EMU = 12700   // EMUs per point
const SLIDE_W = 9144000, SLIDE_H = 6858000   // 10" x 7.5" (4:3)

function pptTextBox(id, name, x, y, w, h, lines, { size = 18, bold = false } = {}) {
  const paras = (lines.length ? lines : ['']).map(t =>
    `<a:p><a:pPr/><a:r><a:rPr lang="en-US" sz="${size * 100}" b="${bold ? 1 : 0}" dirty="0"/><a:t>${xmlEscape(t)}</a:t></a:r></a:p>`
  ).join('')
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`
}

function pptSlide(block, index) {
  const title = blockTitle(block, index)
  let lines = []
  if (block.type === 'table') {
    const h = block.headers || []
    lines.push(h.join('  |  '))
    for (const r of (block.rows || []).slice(0, 14)) {
      if (!r?.some(c => c !== '' && c != null)) continue
      lines.push(h.map((_, ci) => String(r?.[ci] ?? '')).join('  |  '))
    }
    const total = (block.rows || []).filter(r => r?.some(c => c !== '' && c != null)).length
    if (total > 14) lines.push(`… ${total - 14} more rows`)
  } else if (block.type === 'text') {
    lines = htmlToText(block.content).split('\n').slice(0, 16)
  } else if (block.type === 'kanban') {
    for (const lane of (block.lanes || [])) {
      lines.push(lane.name || 'Lane')
      for (const c of (lane.cards || [])) lines.push('  • ' + (typeof c === 'string' ? c : (c.text || c.title || '')))
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${P_NS}><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${pptTextBox(2, 'Title', 45 * EMU * 8, 30 * EMU * 8, SLIDE_W - 90 * EMU * 8, 50 * EMU * 8, [title], { size: 26, bold: true })}
${pptTextBox(3, 'Body', 45 * EMU * 8, 100 * EMU * 8, SLIDE_W - 90 * EMU * 8, SLIDE_H - 140 * EMU * 8, lines, { size: 13 })}
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`
}

export function exportPptx(blocks, name) {
  const zip = createZip()
  const n = blocks.length || 1

  const overrides = blocks.map((_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')

  zip.addFile('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${overrides}</Types>`)

  zip.addFile('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`)

  const sldIdList = blocks.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')
  zip.addFile('ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${P_NS}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${sldIdList}</p:sldIdLst>
<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/>
</p:presentation>`)

  const presRels = blocks.map((_, i) =>
    `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')
  zip.addFile('ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${presRels}
<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`)

  const emptyTree = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`

  zip.addFile('ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${P_NS}><p:cSld>${emptyTree}</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`)
  zip.addFile('ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`)

  zip.addFile('ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${P_NS} type="blank" preserve="1"><p:cSld name="Blank">${emptyTree}</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  zip.addFile('ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`)

  const dk = c => `<a:srgbClr val="${c}"/>`
  zip.addFile('ppt/theme/theme1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DataStudio">
<a:themeElements>
<a:clrScheme name="DataStudio"><a:dk1>${dk('1A1917')}</a:dk1><a:lt1>${dk('FFFFFF')}</a:lt1>
<a:dk2>${dk('6B6860')}</a:dk2><a:lt2>${dk('F5F3EE')}</a:lt2>
<a:accent1>${dk('1D9E75')}</a:accent1><a:accent2>${dk('5B5FE8')}</a:accent2><a:accent3>${dk('E8B85B')}</a:accent3>
<a:accent4>${dk('F87171')}</a:accent4><a:accent5>${dk('38BDF8')}</a:accent5><a:accent6>${dk('A78BFA')}</a:accent6>
<a:hlink>${dk('1D9E75')}</a:hlink><a:folHlink>${dk('6B6860')}</a:folHlink></a:clrScheme>
<a:fontScheme name="DataStudio">
<a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="DataStudio">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`)

  blocks.forEach((b, i) => {
    zip.addFile(`ppt/slides/slide${i + 1}.xml`, pptSlide(b, i))
    zip.addFile(`ppt/slides/_rels/slide${i + 1}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`)
  })

  download(zip.toBlob('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    `${safe(name)}-${stamp()}.pptx`)
}

/* ── PNG ─────────────────────────────────────────────────────────────── */
/*  Drawn with canvas 2D primitives rather than rasterising the live DOM.
    The usual trick — serialise the node into an <svg><foreignObject> and
    drawImage it — silently fails or drops all styling whenever a webfont or
    any cross-origin resource is involved, and taints the canvas. Redrawing
    the few block shapes by hand is more code but always produces the same
    output.                                                                  */

const PNG_SCALE = 2   // retina

export function exportPng(blocks, name, { dark = false } = {}) {
  if (!blocks.length) throw new Error('Nothing to export.')
  const PAD = 40, GAP = 28, W = 860
  /* Painted onto a canvas, so these must be literal colours rather than var()
     — but they come from the one palette all the same. `bg` and `head` stay
     overridden in light mode on purpose: an exported PNG is a document, and a
     document wants a white page rather than the app's cream surface. */
  const c = makeColors(dark)
  const ink = c.text
  const mut = c.text2
  const line = c.border
  const bg = dark ? c.base : '#FFFFFF'
  const head = dark ? c.raised : '#F1EFE9'
  const accent = c.accent

  // ── measure pass ──
  const meas = document.createElement('canvas').getContext('2d')
  const F = (s, w = 400) => `${w} ${s}px -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
  const ROW = 24, HEADH = 26

  function wrap(text, maxW, font) {
    meas.font = font
    const out = []
    for (const para of String(text).split('\n')) {
      let cur = ''
      for (const word of para.split(/\s+/)) {
        const t = cur ? cur + ' ' + word : word
        if (meas.measureText(t).width > maxW && cur) { out.push(cur); cur = word } else cur = t
      }
      out.push(cur)
    }
    return out
  }

  const plans = blocks.map((b, i) => {
    const title = blockTitle(b, i)
    if (b.type === 'table') {
      const rows = (b.rows || []).filter(r => r?.some(c => c !== '' && c != null))
      return { b, title, kind: 'table', rows, h: 30 + HEADH + rows.length * ROW }
    }
    const lines = b.type === 'text' ? wrap(htmlToText(b.content) || '(empty)', W - 2, F(14))
      : b.type === 'kanban' ? (b.lanes || []).flatMap(l => [l.name || 'Lane',
          ...(l.cards || []).map(c => '   • ' + (typeof c === 'string' ? c : (c.text || c.title || '')))])
      : ['(section)']
    return { b, title, kind: 'text', lines, h: 30 + lines.length * 21 }
  })

  const totalH = PAD * 2 + 46 + plans.reduce((n, p) => n + p.h + GAP, 0)
  const cv = document.createElement('canvas')
  cv.width = (W + PAD * 2) * PNG_SCALE
  cv.height = totalH * PNG_SCALE
  const ctx = cv.getContext('2d')
  ctx.scale(PNG_SCALE, PNG_SCALE)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W + PAD * 2, totalH)
  ctx.textBaseline = 'middle'

  let y = PAD
  ctx.fillStyle = ink; ctx.font = F(24, 700)
  ctx.fillText(name, PAD, y + 14); y += 28
  ctx.fillStyle = mut; ctx.font = F(11)
  ctx.fillText(`DataStudio · ${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString()}`, PAD, y + 8)
  y += 34

  for (const p of plans) {
    ctx.fillStyle = ink; ctx.font = F(14, 600)
    ctx.fillText(p.title, PAD, y + 9)
    ctx.strokeStyle = accent; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(PAD, y + 21); ctx.lineTo(PAD + W, y + 21); ctx.stroke()
    y += 32

    if (p.kind === 'table') {
      const cols = (p.b.headers || []).length || 1
      const cw = W / cols
      ctx.fillStyle = head; ctx.fillRect(PAD, y, W, HEADH)
      ctx.font = F(11, 600); ctx.fillStyle = mut
      ;(p.b.headers || []).forEach((h, ci) => {
        ctx.save(); ctx.beginPath(); ctx.rect(PAD + ci * cw + 6, y, cw - 12, HEADH); ctx.clip()
        ctx.fillText(String(h ?? ''), PAD + ci * cw + 8, y + HEADH / 2); ctx.restore()
      })
      y += HEADH
      ctx.font = F(11.5)
      p.rows.forEach((r, ri) => {
        if (ri % 2) { ctx.fillStyle = dark ? '#201F1C' : '#FAF9F6'; ctx.fillRect(PAD, y, W, ROW) }
        ctx.fillStyle = ink
        for (let ci = 0; ci < cols; ci++) {
          ctx.save(); ctx.beginPath(); ctx.rect(PAD + ci * cw + 6, y, cw - 12, ROW); ctx.clip()
          ctx.fillText(String(r?.[ci] ?? ''), PAD + ci * cw + 8, y + ROW / 2); ctx.restore()
        }
        y += ROW
      })
      // grid
      ctx.strokeStyle = line; ctx.lineWidth = 1
      const top = y - p.rows.length * ROW - HEADH
      for (let ci = 0; ci <= cols; ci++) {
        ctx.beginPath(); ctx.moveTo(PAD + ci * cw, top); ctx.lineTo(PAD + ci * cw, y); ctx.stroke()
      }
      for (let ri = 0; ri <= p.rows.length + 1; ri++) {
        const ly = top + (ri === 0 ? 0 : HEADH + (ri - 1) * ROW)
        ctx.beginPath(); ctx.moveTo(PAD, ly); ctx.lineTo(PAD + W, ly); ctx.stroke()
      }
    } else {
      ctx.font = F(13.5); ctx.fillStyle = ink
      for (const ln of p.lines) { ctx.fillText(ln, PAD, y + 10); y += 21 }
    }
    y += GAP
  }

  return new Promise((resolve, reject) => {
    cv.toBlob(blob => {
      if (!blob) return reject(new Error('Could not render the image.'))
      download(blob, `${safe(name)}-${stamp()}.png`)
      resolve()
    }, 'image/png')
  })
}

/* ── write into an existing sheet ────────────────────────────────────── */

/**
 * Build a patch that writes a column of values into an existing table block.
 *
 * The alternative — always spawning a new table — means every tool result
 * arrives as another floating block you then have to copy out of by hand. This
 * writes straight into the sheet you're already working in.
 *
 * @param {object} block     target table block
 * @param {number} colIdx    destination column; pass -1 to append a new one
 * @param {string[]} values  values to write, top to bottom
 * @param {object} opts      { startRow = 0, header, mode: 'overwrite'|'insert' }
 * @returns {{headers:string[], rows:string[][]}} patch for onUpdateBlock
 */
export function writeColumn(block, colIdx, values, opts = {}) {
  const { startRow = 0, header, mode = 'overwrite' } = opts
  const srcHeaders = block.headers || []
  const srcRows = block.rows || []

  let headers = srcHeaders.slice()
  let target = colIdx

  if (colIdx < 0 || colIdx >= headers.length || mode === 'insert') {
    // Append, or insert a new column at colIdx, shifting the rest right.
    target = colIdx < 0 || colIdx > headers.length ? headers.length : colIdx
    if (mode === 'insert' && colIdx >= 0 && colIdx < headers.length) {
      headers.splice(target, 0, header ?? '')
    } else {
      target = headers.length
      headers.push(header ?? '')
    }
  } else if (header != null) {
    headers[target] = header
  }

  const width = headers.length
  const needed = startRow + values.length
  const rows = []
  for (let r = 0; r < Math.max(srcRows.length, needed); r++) {
    const src = srcRows[r] || []
    const row = new Array(width)
    // Copy across, opening a gap when a column was inserted rather than
    // overwritten, so existing data shifts instead of being clobbered.
    for (let c = 0, s = 0; c < width; c++) {
      if (mode === 'insert' && c === target) { row[c] = ''; continue }
      row[c] = src[s] != null ? src[s] : ''
      s++
    }
    if (r >= startRow && r - startRow < values.length) {
      row[target] = String(values[r - startRow] ?? '')
    }
    rows.push(row)
  }

  return { headers, rows }
}

/** Flatten an exportable payload into { columns:[{header, values}] }. */
export function toColumns(blocks) {
  const out = []
  for (const b of blocks) {
    if (b.type !== 'table') continue
    const headers = b.headers || []
    headers.forEach((h, i) => {
      out.push({
        blockId: b.id,
        blockName: b.name || 'Table',
        header: h || '',
        index: i,
        values: (b.rows || []).map(r => r?.[i] ?? ''),
      })
    })
  }
  return out
}

/* ── dispatcher ──────────────────────────────────────────────────────── */

export async function runExport(formatId, blocks, name, opts = {}) {
  switch (formatId) {
    case 'csv':  return exportCsv(blocks, name)
    case 'xlsx': return exportXlsx(blocks, name)
    case 'md':   return exportMarkdown(blocks, name)
    case 'json': return exportJson(blocks, name)
    case 'html': return exportHtml(blocks, name)
    case 'pdf':  return exportPdf(blocks, name)
    case 'docx': return exportDocx(blocks, name)
    case 'pptx': return exportPptx(blocks, name)
    case 'png':  return exportPng(blocks, name, opts)
    default: throw new Error(`Unknown format: ${formatId}`)
  }
}
