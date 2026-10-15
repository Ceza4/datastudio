/*
  lib/docedit.js
  --------------------------------------------------------------------------
  THE DOCUMENT BLOCK'S EDITING AND PAGE LAYOUT, as DOM helpers.

  Two halves, both of which need a real layout engine (the browser's) and so
  live apart from the pure geometry in lib/pagesetup.js:

  1. SELECTION-SCOPED FORMATTING. Font, size, colour and line spacing used to
     be document-wide block fields: pick 20 pt with one word selected and the
     whole document grew. Word applies them to the selection, and so does this
     now — inline spans for character formats, paragraph styles for spacing
     and indents. The block fields stay as the document's DEFAULTS (Word's
     "Normal" style), which is what the ribbon edits when nothing is selected.

  2. REAL PAGES. The editor is still ONE contentEditable — typing, selection
     and undo across a page boundary all keep working natively — laid over a
     stack of separate white sheets. After every edit, `paginate` walks the
     flow and pushes any block that would cross a page's bottom margin down to
     the top of the next sheet, with a margin written on that element and
     marked `data-ds-pushed`. Pushes are cleared and recomputed from scratch
     each pass, and stripped before anything is saved, so they never reach
     storage, sync or export.

     Headings stay with the paragraph that follows them, captions with their
     table or figure, and a deliberate page break sends what follows to the
     next sheet. The layout pass itself lives in lib/docpages.js: long
     paragraphs continue on the next page line by line, long tables row by
     row, with Word's widow and orphan control.
  -------------------------------------------------------------------------- */

export { PAGE_GAP } from './docpages.js'
import { clearLayout } from './docpages.js'
import { stripTabWidths } from './doctabs.js'

/* A deliberate page break, as content. A marked element rather than a magic
   comment: it survives sanitizeEditorHtml, is selectable and deletable, and is
   found by the exporter with one querySelectorAll. `contenteditable=false` so
   the caret cannot land inside it. */
export const PAGE_BREAK_HTML =
  '<div data-ds-pagebreak="1" contenteditable="false"></div><p><br></p>'
export const INDENT_STEP_PX = 48                    // 0.5 in, Word's default tab stop
export const PT_TO_PX = 96 / 72

const BLOCK_SEL = 'p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre'

/* ── selection ─────────────────────────────────────────────────────────── */

export function rangeIn(root) {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  if (!root || !sel || !sel.rangeCount) return null
  const r = sel.getRangeAt(0)
  return root.contains(r.commonAncestorContainer) ? r : null
}

export function setRange(r) {
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
}

/** The element the caret (range start) sits in. */
export function caretElement(root, r = rangeIn(root)) {
  if (!r) return null
  let n = r.startContainer
  if (n.nodeType !== 3 && n.childNodes.length) {
    /* A range that starts BETWEEN children (what selecting a styled span
       leaves) is really in the child after it: descend to its first leaf so
       the ribbon reads that span's size and font, not the paragraph's. */
    n = n.childNodes[Math.min(r.startOffset, n.childNodes.length - 1)]
    while (n.nodeType === 1 && n.firstChild && n.tagName !== 'TABLE') n = n.firstChild
  }
  if (n.nodeType === 3) n = n.parentElement
  return n && root.contains(n) ? n : null
}

/** The paragraph-level element a node belongs to, inside `root`. */
export function blockOf(root, node) {
  let n = node?.nodeType === 3 ? node.parentElement : node
  while (n && n !== root) {
    if (n.matches?.(BLOCK_SEL) && !n.hasAttribute('data-ds-pagebreak') && !n.hasAttribute('data-ds-sectionbreak') && n.dataset?.type !== 'columns' && n.dataset?.type !== 'column') return n
    n = n.parentElement
  }
  return null
}

/** Paragraph-level elements the range touches, in document order. The
 *  innermost ones: a list's items, never the list; a paragraph inside a
 *  column, never the column. */
export function paragraphsIn(root, r = rangeIn(root)) {
  if (!r) return []
  const first = blockOf(root, r.startContainer)
  if (r.collapsed) return first ? [first] : []
  const out = []
  const all = root.querySelectorAll(BLOCK_SEL)
  for (const el of all) {
    if (el.hasAttribute('data-ds-pagebreak') || el.hasAttribute('data-ds-sectionbreak')) continue
    if (el.querySelector(BLOCK_SEL)) continue                    // not innermost
    if (r.intersectsNode(el)) out.push(el)
  }
  if (!out.length && first) out.push(first)
  return out
}

/* ── character formats on the selection ─────────────────────────────────── */

function textNodesIn(r) {
  const root = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const out = []
  let n
  while ((n = w.nextNode())) if (n.length && r.intersectsNode(n)) out.push(n)
  if (!out.length && r.commonAncestorContainer.nodeType === 3) out.push(r.commonAncestorContainer)
  return out
}

const cssName = k => k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())

/**
 * Apply inline CSS (`{ fontSize: '14pt' }`, `{ fontFamily: '' }` to clear)
 * to exactly the selected text. A collapsed caret gets an empty styled span
 * to type into, the way Word sets the format for what you type next.
 * @returns {Range|null} the range covering what was styled
 */
export function applyInlineStyle(root, css, r = rangeIn(root)) {
  if (!r) return null
  const set = el => {
    for (const k in css) {
      if (css[k] === '' || css[k] == null) el.style.removeProperty(cssName(k))
      else el.style[k] = css[k]
    }
    /* Nested spans inside the new one would override it — clear the same
       properties on them so the outer choice is what shows. */
    el.querySelectorAll('span[style]').forEach(x => { for (const k in css) x.style.removeProperty(cssName(k)) })
  }
  if (r.collapsed) {
    const span = document.createElement('span')
    set(span)
    span.textContent = '​'
    r.insertNode(span)
    const nr = document.createRange()
    nr.setStart(span.firstChild, 1); nr.collapse(true)
    setRange(nr)
    return nr
  }
  const startC = r.startContainer, startO = r.startOffset, endC = r.endContainer, endO = r.endOffset
  let first = null, last = null
  for (const t0 of textNodesIn(r)) {
    let t = t0
    const s = t === startC ? startO : 0
    const e = t === endC ? endO : t.length
    if (s >= e) continue
    if (e < t.length) t.splitText(e)
    if (s > 0) t = t.splitText(s)
    const p = t.parentElement
    let span
    if (p && p.tagName === 'SPAN' && p.childNodes.length === 1 && p !== root) span = p
    else { span = document.createElement('span'); t.parentNode.insertBefore(span, t); span.appendChild(t) }
    set(span)
    first = first || span
    last = span
  }
  if (!first) return null
  const nr = document.createRange()
  nr.setStartBefore(first); nr.setEndAfter(last)
  setRange(nr)
  cleanupSpans(root)
  return nr
}

/** Paragraph-level CSS on every paragraph the selection touches. */
export function applyParagraphStyle(root, fn, r = rangeIn(root)) {
  const paras = paragraphsIn(root, r)
  paras.forEach(fn)
  return paras.length
}

/** Word's Increase/Decrease Indent on paragraphs: 0.5in steps of left margin,
 *  never negative, never so far that less than 1in of text is left. */
export function indentParagraphs(root, dir, contentW, r = rangeIn(root)) {
  return applyParagraphStyle(root, p => {
    const cur = parseFloat(p.style.marginLeft) || 0
    const next = Math.max(0, Math.min(contentW - 96, cur + dir * INDENT_STEP_PX))
    if (next) p.style.marginLeft = next + 'px'
    else p.style.removeProperty('margin-left')
  }, r)
}

/* ── cleanup ───────────────────────────────────────────────────────────── */

/**
 * Chrome's contentEditable "preserves" the look of text it merges (Backspace
 * across two paragraphs, pasting) by writing the COMPUTED style inline —
 * which in this app is `font-family: var(--ds-font-body)` and the theme's
 * text colour. Those are not the user's choices and they pin the text to the
 * app's theme. Stripped after every edit; empty spans are unwrapped.
 */
export function cleanupSpans(root) {
  if (!root) return
  root.querySelectorAll('[style*="var(--ds"]').forEach(el => {
    const keep = []
    for (const d of el.getAttribute('style').split(';')) {
      /* Only a declaration that is NOTHING BUT a theme variable is Chrome's;
         a font the user picked names itself first ('Inter', var(...)). */
      const val = d.slice(d.indexOf(':') + 1).trim()
      if (d.trim() && !/^var\(--ds[-\w]*\)$/.test(val)) keep.push(d.trim())
    }
    if (keep.length) el.setAttribute('style', keep.join('; '))
    else el.removeAttribute('style')
  })
  root.querySelectorAll('span:not([style]):not([data-ds-link]):not([data-type])').forEach(el => {
    if (el.attributes.length === 0) el.replaceWith(...el.childNodes)
  })
}

/* ── real pages: see lib/docpages.js ───────────────────────────────────── */

export { paginate, pageOfElement, clearLayout, clearGapsIn, pageUnits, offsetIn, offsetLeftIn, pageIndexAt } from './docpages.js'

/** Remove every pagination move (pushes and gaps). Kept under its old name. */
export function clearPushes(root) { return clearLayout(root) }

/** The editor's HTML with layout removed, without touching the live DOM. */
export function htmlWithoutPushes(root) {
  const c = root.cloneNode(true)
  clearLayout(c)
  stripTabWidths(c)
  c.querySelectorAll('span').forEach(s => {
    /* The zero-width placeholder a collapsed-caret format leaves, once text
       has been typed next to it, is noise in storage. */
    if (s.childNodes.length === 1 && s.firstChild.nodeType === 3 && s.firstChild.data === '​') s.remove()
  })
  return c.innerHTML
}

/* ── paragraphs ────────────────────────────────────────────────────────── */

const INLINE_TAGS = /^(A|B|STRONG|I|EM|U|S|STRIKE|SPAN|SUB|SUP|CODE|MARK|SMALL|INS|DEL|IMG|BR)$/

/** Text or inline markup typed straight into the editor root (what Chrome
 *  does in an empty editor) goes into a paragraph, so every line is a block
 *  pagination and styles can reach. The live selection moves with the nodes
 *  (appendChild of a node keeps ranges inside it). @returns true if changed */
export function normalizeRoot(root) {
  if (!root) return false
  let changed = false
  let run = null
  for (const n of [...root.childNodes]) {
    const inline = n.nodeType === 3 ? n.data.length > 0 : (n.nodeType === 1 && INLINE_TAGS.test(n.tagName) && !n.hasAttribute('data-ds-gap'))
    if (inline) {
      if (!run) { run = document.createElement('p'); root.insertBefore(run, n); changed = true }
      const sel = window.getSelection()
      const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
      const caretHere = r && r.collapsed && (r.startContainer === n || n.contains?.(r.startContainer))
      const saved = caretHere ? { node: r.startContainer, off: r.startOffset } : null
      run.appendChild(n)
      if (saved) { const nr = document.createRange(); nr.setStart(saved.node, saved.off); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr) }
    } else if (n.nodeType === 3) {
      n.remove()
    } else run = null
  }
  return changed
}

/** A <p> can never contain a block (the parser would split it), but
 *  execCommand sometimes builds one: a list or heading inside a paragraph.
 *  Unwrap such paragraphs, keeping the selection by position.
 *  @returns true if changed */
export function unwrapBlockParagraphs(root) {
  const bad = root ? [...root.querySelectorAll('p')].filter(p => p.querySelector(':scope > ul, :scope > ol, :scope > p, :scope > div, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > table, :scope > blockquote')) : []
  if (!bad.length) return false
  const s = selectionIndex(root)
  for (const p of bad.reverse()) {
    /* Loose inline runs inside it become paragraphs of their own. */
    let run = null
    for (const n of [...p.childNodes]) {
      const block = n.nodeType === 1 && /^(UL|OL|P|DIV|H[1-6]|TABLE|BLOCKQUOTE)$/.test(n.tagName)
      if (block) { run = null; continue }
      if (n.nodeType === 3 && !n.data.trim()) { n.remove(); continue }
      if (!run) { run = document.createElement('p'); p.insertBefore(run, n) }
      run.appendChild(n)
    }
    p.replaceWith(...p.childNodes)
  }
  restoreSelectionIndex(root, s)
  return true
}

/** Chrome's own paragraphs are DIVs; Word's model is one <p> per paragraph.
 *  Bare root-level DIVs (no attributes: not a page break, not columns)
 *  become P on load. */
export function divsToParagraphs(root) {
  if (!root) return
  for (const d of [...root.children]) {
    if (d.tagName !== 'DIV' || d.attributes.length) continue
    if (d.querySelector(':scope > div, :scope > p, :scope > ul, :scope > ol, :scope > table, :scope > h1, :scope > h2, :scope > h3')) continue
    const p = document.createElement('p')
    while (d.firstChild) p.appendChild(d.firstChild)
    d.replaceWith(p)
  }
}

/* ── a selection that survives re-rendering ─────────────────────────────
   Undo puts back HTML, which makes new nodes; a DOM range into the old ones
   is useless. So a position is a COUNT: characters of text, plus one for
   every paragraph-level element entered and every atom (<br>, <img>, a
   non-editable page break or footnote mark). Empty paragraphs therefore
   have distinct positions. Layout spacers count nothing, so a position is
   the same with or without pagination applied. */
const ATOM_SEL = 'br,img,[contenteditable="false"]'
const COUNTED = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH|TR|TABLE|UL|OL|FIGURE|FIGCAPTION)$/

function walkCount(root, stop) {
  /* stop(node, count, phase) → return true to end. phase 'enter' before a
     node, 'text' for text. */
  let count = 0
  let done = false
  const visit = n => {
    if (done) return
    if (n.nodeType === 3) {
      if (stop(n, count, 'text')) { done = true; return }
      count += n.data.length
      return
    }
    if (n.nodeType !== 1) return
    if (n.hasAttribute('data-ds-gap')) return
    if (stop(n, count, 'enter')) { done = true; return }
    if (n.matches(ATOM_SEL)) { count += 1; return }
    if (COUNTED.test(n.tagName)) count += 1
    for (const c of n.childNodes) { visit(c); if (done) return }
    if (stop(n, count, 'leave')) { done = true }
  }
  for (const c of root.childNodes) { visit(c); if (done) break }
  return count
}

function pointIndex(root, node, offset) {
  if (node === root || node.nodeType === 1) {
    const kids = node.childNodes
    if (offset < kids.length) {
      const target = kids[offset]
      let at = 0
      walkCount(root, (n, c, phase) => { if (n === target && phase !== 'leave') { at = c; return true } return false })
      return at
    }
    if (node === root) return walkCount(root, () => false)
    let at = 0
    walkCount(root, (n, c, phase) => { if (n === node && phase === 'leave') { at = c; return true } return false })
    return at
  }
  let at = 0
  walkCount(root, (n, c) => { if (n === node) { at = c + offset; return true } return false })
  return at
}

function indexPoint(root, idx) {
  let out = null
  walkCount(root, (n, c, phase) => {
    if (phase === 'text') {
      if (idx >= c && idx <= c + n.data.length) { out = { node: n, offset: idx - c }; return true }
      return false
    }
    if (phase === 'enter' && c === idx) {
      out = { node: n.parentNode, offset: [...n.parentNode.childNodes].indexOf(n) }
      return true
    }
    if (phase === 'leave' && c === idx && n.nodeType === 1) {
      out = { node: n, offset: n.childNodes.length }
      return true
    }
    return false
  })
  return out || { node: root, offset: root.childNodes.length }
}

/** The selection inside `root` as { a, b } counts, or null. */
export function selectionIndex(root) {
  const r = rangeIn(root)
  if (!r) return null
  const a = pointIndex(root, r.startContainer, r.startOffset)
  const b = r.collapsed ? a : pointIndex(root, r.endContainer, r.endOffset)
  return { a, b }
}

export function restoreSelectionIndex(root, s) {
  if (!root || !s) return
  const A = indexPoint(root, s.a)
  const B = s.b === s.a ? A : indexPoint(root, s.b)
  try {
    const r = document.createRange()
    r.setStart(A.node, A.offset)
    r.setEnd(B.node, B.offset)
    setRange(r)
  } catch { /* the content changed under us; leave the caret where it is */ }
}

/* ── inserting ─────────────────────────────────────────────────────────── */

export function tableHtml(rows, cols) {
  const r = Math.max(1, Math.min(40, rows | 0)), c = Math.max(1, Math.min(20, cols | 0))
  const head = '<tr>' + '<th><br></th>'.repeat(c) + '</tr>'
  const body = ('<tr>' + '<td><br></td>'.repeat(c) + '</tr>').repeat(Math.max(0, r - 1))
  return `<table><tbody>${head}${body}</tbody></table><p><br></p>`
}

/** Read an image file, shrink it to at most `max` px on its long side, and
 *  return a data URL. Photos come back as JPEG, everything else as PNG. */
export function imageFileToDataUrl(file, max = 1600) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) { reject(new Error('Choose a PNG, JPEG, GIF or WebP image.')); return }
    const rd = new FileReader()
    rd.onerror = () => reject(new Error('Could not read that file.'))
    rd.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not an image the browser can open.'))
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
        if (k === 1 && file.size < 400 * 1024) { resolve({ src: rd.result, w: img.naturalWidth, h: img.naturalHeight }); return }
        const cv = document.createElement('canvas')
        cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k)
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
        const jpeg = /jpe?g/i.test(file.type)
        resolve({ src: cv.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.86), w: cv.width, h: cv.height })
      }
      img.src = rd.result
    }
    rd.readAsDataURL(file)
  })
}

/* ── page colour ───────────────────────────────────────────────────────── */

/** The page's own palette. White by default in BOTH app themes — a document
 *  is paper — with Dark and Follow-theme as the View options. Exports are
 *  always white. */
export function pagePalette(pageColor, appDark) {
  const dark = pageColor === 'dark' || (pageColor === 'theme' && appDark)
  return dark
    ? { dark: true, bg: '#232220', text: '#E8E6E1', mute: '#8F8C85', rule: '#3A3934', th: '#2B2A27', link: '#86A8FF', edge: 'rgba(255,255,255,0.07)', head: '#AFC6EC', head2: '#9DB4DB' }
    : { dark: false, bg: '#FFFFFF', text: '#1A1917', mute: '#8A877F', rule: '#D9D6CE', th: '#F3F1EC', link: '#1F5FBF', edge: 'rgba(0,0,0,0.06)', head: '#1F3A5F', head2: '#2B4C7E' }
}
