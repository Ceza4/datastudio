/*
  lib/docxextras.js
  --------------------------------------------------------------------------
  WHAT THE .docx EXPORT CARRIES BEYOND TEXT — an add-on to lib/docexport.js.

  The exporter turns the Document's HTML into paragraphs and runs. This module
  adds the parts of a Word file that are not paragraphs, and teaches the
  exporter's parser the Document's own markup for them:

    · FOOTNOTES   <sup data-ds-fn>          → word/footnotes.xml + references
    · COMMENTS    <span data-ds-comment>    → word/comments.xml + ranges
                  (replies travel inside the comment, "Name: reply")
    · TRACKED     <ins>/<del data-ds-uid>   → real <w:ins>/<w:del> revisions,
      CHANGES                                 with author and time
    · HEADERS /   block.hf                  → header/footer parts, {page} and
      FOOTERS                                 {pages} as live PAGE / NUMPAGES
                                              fields, left/centre/right by
                                              margin-relative tabs
    · SECTIONS    data-ds-sectionbreak      → a sectPr per section: its
                                              orientation, page-number
                                              restart and format
    · TABS        <span data-ds-tab> and    → <w:tab/> and the paragraph's
                  data-ds-tabs                <w:tabs>
    · MIRROR      block.mirror / gutter     → settings.xml mirrorMargins,
      MARGINS                                 pgMar gutter

  It is a separate file so the exporter stays small and the two can change
  independently; the exporter calls it through a handful of hooks
  (docxExtras(block) → { hooks, pPr, wrapRun, runXml, paraXml, sectPr,
  parts, types, rels, docNs }).

  Section order, in Word's model: a section's properties are written at its
  END (in the last paragraph, or the body for the last section). The
  Document's break describes the section AFTER it — so break k closes section
  k−1 with section k−1's properties.
  -------------------------------------------------------------------------- */

import { xmlEscape } from './zip.js'
import { pageInches } from './pagesetup.js'
import { parseStops } from './doctabs.js'

const TW = 1440
const tw = inches => Math.round((Number(inches) || 0) * TW)
const attr = (attrs, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs || '')
  return m ? (m[2] ?? m[3] ?? '') : null
}
const WORD_FMT = { decimal: 'decimal', 'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman', 'lower-alpha': 'lowerLetter' }
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const CT = t => `application/vnd.openxmlformats-officedocument.wordprocessingml.${t}+xml`
const REL = t => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`
const iso = s => { const d = new Date(s || Date.now()); return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 19) + 'Z' : d.toISOString().slice(0, 19) + 'Z' }
const initials = s => String(s || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase() || '?'

/* A header/footer line: l ⇥ c ⇥ r, with tokens as fields. Positioned tabs
   (w:ptab) are relative to the margins, so the same part works on portrait
   and landscape sections alike. */
function hfParagraph(slot, title) {
  const seg = s => String(s || '').split(/(\{page\}|\{pages\}|\{title\})/).filter(Boolean).map(t => {
    if (t === '{page}') return '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
    if (t === '{pages}') return '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
    return `<w:r><w:t xml:space="preserve">${xmlEscape(t === '{title}' ? title : t)}</w:t></w:r>`
  }).join('')
  const s = slot || {}
  let body = seg(s.l)
  if (s.c) body += `<w:r><w:ptab w:relativeTo="margin" w:alignment="center" w:leader="none"/></w:r>${seg(s.c)}`
  if (s.r) body += `<w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/></w:r>${seg(s.r)}`
  return `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${body}</w:p>`
}
const has = s => !!(s && (s.l || s.c || s.r))

export function docxExtras(block) {
  const b = block || {}
  const notes = b.footnotes || {}
  const threads = (b.comments || []).filter(c => c && c.id)

  /* ── parsing state ── */
  const fnIds = new Map()          // our id → Word id (1…)
  const cmIds = new Map()          // comment id → Word id (0…)
  const spanStack = []             // per <span>: comment id, 'tab', or null
  const trackStack = []            // per <ins>/<del>: pushed or not
  let skipDepth = 0                // inside a footnote mark's <sup>
  const sections = [{ orient: b.orientation === 'landscape' ? 'landscape' : 'portrait', restart: true, start: Number(b.pageStart) || 1, numfmt: b.numFmt || 'decimal' }]

  const hooks = {
    /** @returns true when the tag was handled here */
    tag(tag, attrs, closing, ctx) {
      if (tag === 'sup') {
        if (!closing && skipDepth === 0 && attr(attrs, 'data-ds-fn') != null) {
          const id = attr(attrs, 'data-ds-fn')
          if (!fnIds.has(id)) fnIds.set(id, fnIds.size + 1)
          ctx.pushRun({ fn: fnIds.get(id) })
          skipDepth = 1; ctx.skip = true
          return true
        }
        if (skipDepth > 0) {
          skipDepth += closing ? -1 : 1
          if (skipDepth === 0) ctx.skip = false
          return true
        }
        return false
      }
      if (skipDepth > 0) return true
      if (tag === 'div' && !closing && attr(attrs, 'data-ds-sectionbreak') != null) {
        ctx.endPara()
        const sec = {
          orient: attr(attrs, 'data-orient') === 'landscape' ? 'landscape' : 'portrait',
          restart: attr(attrs, 'data-restart') === '1',
          start: Number(attr(attrs, 'data-start')) || 1,
          numfmt: attr(attrs, 'data-numfmt') || 'decimal',
        }
        sections.push(sec)
        ctx.out.push({ kind: 'section', runs: [], index: sections.length - 2 })
        return true
      }
      if (tag === 'span') {
        if (closing) {
          const top = spanStack.pop()
          if (top === 'tab') { ctx.skip = false; return true }
          if (top) { ctx.pushRun({ commentEnd: top.comment }); return true }
          return false
        }
        if (attr(attrs, 'data-ds-tab') != null) { ctx.pushRun({ tab: true }); spanStack.push('tab'); ctx.skip = true; return true }
        const cid = attr(attrs, 'data-ds-comment')
        if (cid && threads.some(t => t.id === cid)) {
          if (!cmIds.has(cid)) { cmIds.set(cid, cmIds.size); ctx.pushRun({ commentStart: cmIds.get(cid) }) }
          spanStack.push({ comment: cmIds.get(cid) })
          return true
        }
        spanStack.push(null)
        return false
      }
      if ((tag === 'ins' || tag === 'del')) {
        if (closing) {
          const t = trackStack.pop()
          if (t) { ctx.extra = t.prev; return true }
          return false
        }
        if (attr(attrs, 'data-ds-uid') == null) { trackStack.push(null); return false }
        trackStack.push({ prev: ctx.extra })
        ctx.extra = { ...(ctx.extra || {}), track: { type: tag, by: attr(attrs, 'data-ds-by') || 'Someone', at: attr(attrs, 'data-ds-at') } }
        return true
      }
      return false
    },
  }

  /* Only the LAST end of a comment counts (a comment over bold and plain
     text is several spans with one id). */
  const tidy = paras => {
    const last = new Map()
    paras.forEach((p, i) => p.runs?.forEach((r, j) => { if (r.commentEnd != null) last.set(r.commentEnd, `${i}:${j}`) }))
    paras.forEach((p, i) => { if (p.runs) p.runs = p.runs.filter((r, j) => r.commentEnd == null || last.get(r.commentEnd) === `${i}:${j}`) })
    return paras
  }

  /* ── writing ── */
  let revId = 1000
  const runXml = r => {
    if (r.fn != null) return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${r.fn}"/></w:r>`
    if (r.commentStart != null) return `<w:commentRangeStart w:id="${r.commentStart}"/>`
    if (r.commentEnd != null) return `<w:commentRangeEnd w:id="${r.commentEnd}"/><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:commentReference w:id="${r.commentEnd}"/></w:r>`
    if (r.tab) return wrapRun('<w:r><w:tab/></w:r>', r)
    return null
  }
  function wrapRun(xml, r) {
    const t = r?.track
    if (!t) return xml
    const a = `w:id="${revId++}" w:author="${xmlEscape(t.by)}" w:date="${iso(t.at)}"`
    if (t.type === 'del') return `<w:del ${a}>${xml.replace(/<w:t\b/g, '<w:delText').replace(/<\/w:t>/g, '</w:delText>')}</w:del>`
    return `<w:ins ${a}>${xml}</w:ins>`
  }
  const pPr = p => {
    const stops = parseStops(attr(p.attrs, 'data-ds-tabs'))
    if (!stops.length) return ''
    return `<w:tabs>${stops.map(s => `<w:tab w:val="${s.kind === 'c' ? 'center' : s.kind === 'r' ? 'right' : 'left'}" w:pos="${tw(s.at)}"/>`).join('')}</w:tabs>`
  }

  const hf = b.hf || { footer: { c: 'Page {page} of {pages}' } }
  const title = b.name || 'Document'
  const hfParts = []
  const hfRefs = []
  const addHf = (kind, type, slot) => {
    if (!has(slot)) return
    const n = hfParts.length + 1
    const rid = `rIdX${n}`
    const tag = kind === 'header' ? 'hdr' : 'ftr'
    hfParts.push({
      path: `word/${kind}${n}.xml`, type: CT(kind), rel: REL(kind), rid,
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${W_NS} ${R_NS}>${hfParagraph(slot, title)}</w:${tag}>`,
    })
    hfRefs.push(`<w:${kind}Reference w:type="${type}" r:id="${rid}"/>`)
  }
  addHf('header', 'default', hf.header)
  addHf('footer', 'default', hf.footer)
  if (hf.firstDifferent) {
    /* An empty first-page header must still exist, or Word shows the default. */
    const empty = { l: '', c: ' ', r: '' }
    addHf('header', 'first', has(hf.firstHeader) ? hf.firstHeader : empty)
    addHf('footer', 'first', has(hf.firstFooter) ? hf.firstFooter : empty)
  }

  const m = b.margins || { top: 1, bottom: 1, left: 1, right: 1 }
  const gutter = Math.max(0, Math.min(2, Number(b.gutter) || 0))
  /* "Different first page" is the DOCUMENT's first page, so only the first
     section gets titlePg (in Word it is per section). */
  const sectPr = i => {
    const s = sections[i] || sections[0]
    const pg = pageInches(b.pageSize, s.orient, b.pageCustom)
    const num = `<w:pgNumType w:fmt="${WORD_FMT[s.numfmt] || 'decimal'}"${i === 0 || s.restart ? ` w:start="${Math.max(0, Number(s.start) || 1)}"` : ''}/>`
    return `<w:sectPr>${hfRefs.join('')}<w:type w:val="nextPage"/>`
      + `<w:pgSz w:w="${tw(pg.w)}" w:h="${tw(pg.h)}"${s.orient === 'landscape' ? ' w:orient="landscape"' : ''}/>`
      + `<w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="${tw(Math.min(0.5, m.top / 2))}" w:footer="${tw(Math.min(0.5, m.bottom / 2))}" w:gutter="${tw(gutter)}"/>`
      + num + (hf.firstDifferent && i === 0 ? '<w:titlePg/>' : '') + '</w:sectPr>'
  }
  const paraXml = p => (p.kind === 'section' ? `<w:p><w:pPr>${sectPr(p.index)}</w:pPr></w:p>` : null)

  /** The parts, rels and content types, once the body has been parsed. */
  const finish = () => {
    const parts = [...hfParts]
    const usedNotes = [...fnIds.entries()]
    if (usedNotes.length) {
      parts.push({
        path: 'word/footnotes.xml', type: CT('footnotes'), rel: REL('footnotes'), rid: 'rIdXfn',
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${W_NS}>`
          + '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>'
          + '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
          + usedNotes.map(([id, n]) => `<w:footnote w:id="${n}"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> ${xmlEscape(notes[id] || '')}</w:t></w:r></w:p></w:footnote>`).join('')
          + '</w:footnotes>',
      })
    }
    const usedComments = threads.filter(t => cmIds.has(t.id))
    if (usedComments.length) {
      const para = t => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r></w:p>`
      parts.push({
        path: 'word/comments.xml', type: CT('comments'), rel: REL('comments'), rid: 'rIdXcm',
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${W_NS}>`
          + usedComments.map(t => `<w:comment w:id="${cmIds.get(t.id)}" w:author="${xmlEscape(t.by || 'Someone')}" w:date="${iso(t.at)}" w:initials="${xmlEscape(initials(t.by))}">`
            + para((t.resolved ? '[Resolved] ' : '') + (t.text || ''))
            + (t.replies || []).map(r => para(`${r.by || 'Someone'}: ${r.text || ''}`)).join('')
            + '</w:comment>').join('')
          + '</w:comments>',
      })
    }
    if (b.mirror) {
      parts.push({
        path: 'word/settings.xml', type: CT('settings'), rel: REL('settings'), rid: 'rIdXst',
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ${W_NS}><w:mirrorMargins/></w:settings>`,
      })
    }
    return {
      parts,
      types: parts.map(p => `<Override PartName="/${p.path}" ContentType="${p.type}"/>`).join('\n'),
      rels: parts.map(p => `<Relationship Id="${p.rid}" Type="${p.rel}" Target="${p.path.slice(5)}"/>`).join('\n'),
      finalSectPr: sectPr(sections.length - 1),
    }
  }

  return { hooks, tidy, runXml, wrapRun, pPr, paraXml, finish, docNs: R_NS }
}
