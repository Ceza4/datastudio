/*
  lib/docformat.js
  --------------------------------------------------------------------------
  The Document block's formatting commands that execCommand does not have,
  or has wrong: change case, clear formatting, the format painter, list
  styles and nesting, Word's autoformat (smart quotes, "- " lists, "# "
  headings), tables and pictures.

  All of them act on the live DOM and the live selection; the caller records
  an undo step and repaginates afterwards (DocumentBlock's `changed`).
  -------------------------------------------------------------------------- */

import { rangeIn, setRange, caretElement, paragraphsIn, applyInlineStyle } from './docedit.js'

/* ── text runs in a selection ──────────────────────────────────────────── */

function splitRuns(root, r) {
  const startC = r.startContainer, startO = r.startOffset, endC = r.endContainer, endO = r.endOffset
  const base = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer
  const w = document.createTreeWalker(base, NodeFilter.SHOW_TEXT)
  const list = []
  let n
  while ((n = w.nextNode())) if (n.length && r.intersectsNode(n)) list.push(n)
  if (!list.length && r.commonAncestorContainer.nodeType === 3) list.push(r.commonAncestorContainer)
  const out = []
  for (const t0 of list) {
    if (t0.parentElement?.closest?.('[contenteditable="false"],[data-ds-gap]')) continue
    let t = t0
    const s = t === startC ? startO : 0
    const e = t === endC ? endO : t.length
    if (s >= e) continue
    if (e < t.length) t.splitText(e)
    if (s > 0) t = t.splitText(s)
    out.push(t)
  }
  return out
}

/* ── change case (Word's Aa, and Shift+F3) ─────────────────────────────── */

export const CASES = [
  { id: 'sentence', label: 'Sentence case.' },
  { id: 'lower', label: 'lowercase' },
  { id: 'upper', label: 'UPPERCASE' },
  { id: 'title', label: 'Capitalize Each Word' },
  { id: 'toggle', label: 'tOGGLE cASE' },
]

export function caseText(s, mode, atSentenceStart = true) {
  if (mode === 'lower') return s.toLowerCase()
  if (mode === 'upper') return s.toUpperCase()
  if (mode === 'toggle') return [...s].map(c => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')
  if (mode === 'title') return s.toLowerCase().replace(/(^|[\s\-–—(“"'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  /* sentence */
  let start = atSentenceStart
  let out = ''
  for (const c of s.toLowerCase()) {
    if (start && /\p{L}/u.test(c)) { out += c.toUpperCase(); start = false; continue }
    if (/[.!?]/.test(c)) start = true
    out += c
  }
  return out
}

/** Change the case of the selection (or the word at the caret). */
export function changeCase(root, mode) {
  let r = rangeIn(root)
  if (!r) return false
  if (r.collapsed) {
    const sel = window.getSelection()
    sel.modify('move', 'backward', 'word'); sel.modify('extend', 'forward', 'word')
    r = rangeIn(root)
    if (!r || r.collapsed) return false
  }
  const runs = splitRuns(root, r)
  if (!runs.length) return false
  /* Sentence case needs to know whether the selection starts a sentence. */
  const pre = document.createRange()
  const para = paragraphsIn(root, r)[0]
  let startsSentence = true
  if (para) {
    pre.setStart(para, 0); pre.setEnd(runs[0], 0)
    startsSentence = /(^|[.!?]\s*)$/.test(pre.toString().trim())
  }
  let first = true
  for (const t of runs) {
    t.data = caseText(t.data, mode, first ? startsSentence : false)
    if (mode === 'sentence' && /[.!?]\s*$/.test(t.data)) first = true
    else first = false
  }
  const nr = document.createRange()
  nr.setStart(runs[0], 0); nr.setEnd(runs[runs.length - 1], runs[runs.length - 1].length)
  setRange(nr)
  return true
}

/** The next mode in Word's Shift+F3 cycle, from the selection's text. */
export function nextCase(text) {
  const t = text.replace(/[^\p{L}]/gu, '')
  if (!t) return 'upper'
  if (t === t.toUpperCase()) return 'lower'
  if (t === t.toLowerCase()) return 'title'
  return 'upper'
}

/* ── clear formatting (Ctrl+Space) ─────────────────────────────────────── */

const INLINE_FORMAT_TAGS = 'b,strong,i,em,u,s,strike,sub,sup,mark,font,code'

export function clearFormatting(root) {
  const r = rangeIn(root)
  if (!r) return false
  if (!r.collapsed) {
    document.execCommand('removeFormat')
    const r2 = rangeIn(root)
    if (r2) applyInlineStyle(root, { fontSize: '', fontFamily: '', color: '', backgroundColor: '', fontVariant: '', textTransform: '', letterSpacing: '' }, r2)
    const r3 = rangeIn(root)
    if (r3) {
      root.querySelectorAll(INLINE_FORMAT_TAGS).forEach(el => { if (r3.intersectsNode(el) && r3.toString().includes(el.textContent)) el.replaceWith(...el.childNodes) })
    }
  }
  /* The paragraph back to Normal, as Word's Clear All Formatting does. */
  for (const p of paragraphsIn(root, rangeIn(root))) {
    for (const prop of ['text-align', 'line-height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'text-indent']) p.style.removeProperty(prop)
    if (!p.getAttribute('style')) p.removeAttribute('style')
    p.removeAttribute('data-ds-style')
    p.removeAttribute('data-ds-dropcap')
    if (/^H[1-6]$/.test(p.tagName) || p.tagName === 'BLOCKQUOTE') {
      const np = document.createElement('p')
      while (p.firstChild) np.appendChild(p.firstChild)
      p.replaceWith(np)
    }
  }
  return true
}

/* ── format painter ────────────────────────────────────────────────────── */

/** The character and paragraph format at the caret. */
export function readFormat(root) {
  const el = caretElement(root)
  if (!el) return null
  const cs = getComputedStyle(el)
  const para = el.closest('p,div,h1,h2,h3,h4,h5,h6,li,blockquote') || el
  const q = c => { try { return document.queryCommandState(c) } catch { return false } }
  return {
    char: {
      fontFamily: el.closest('[style*="font-family"]') && root.contains(el.closest('[style*="font-family"]')) ? cs.fontFamily : '',
      fontSize: el.closest('[style*="font-size"]') && root.contains(el.closest('[style*="font-size"]')) ? cs.fontSize : '',
      color: el.closest('[style*="color"]') && root.contains(el.closest('[style*="color"]')) ? cs.color : '',
      backgroundColor: el.closest('[style*="background"]') && root.contains(el.closest('[style*="background"]')) ? cs.backgroundColor : '',
    },
    marks: { bold: q('bold'), italic: q('italic'), underline: q('underline'), strikeThrough: q('strikeThrough') },
    para: { tag: para.tagName, textAlign: para.style.textAlign || '', lineHeight: para.style.lineHeight || '' },
  }
}

/** Put a format read with readFormat on the current selection. */
export function applyFormat(root, fmt) {
  const r = rangeIn(root)
  if (!r || !fmt) return false
  if (!r.collapsed) {
    for (const [cmd, on] of Object.entries(fmt.marks)) {
      let cur = false
      try { cur = document.queryCommandState(cmd) } catch { cur = false }
      if (cur !== on) document.execCommand(cmd)
    }
    const r2 = rangeIn(root)
    if (r2) applyInlineStyle(root, fmt.char, r2)
  }
  for (const p of paragraphsIn(root, rangeIn(root))) {
    if (fmt.para.textAlign) p.style.textAlign = fmt.para.textAlign; else p.style.removeProperty('text-align')
    if (fmt.para.lineHeight) p.style.lineHeight = fmt.para.lineHeight; else p.style.removeProperty('line-height')
  }
  return true
}

/* ── lists ─────────────────────────────────────────────────────────────── */

export const BULLET_STYLES = [
  { id: 'disc', label: '●', title: 'Filled round bullets' },
  { id: 'circle', label: '○', title: 'Hollow round bullets' },
  { id: 'square', label: '■', title: 'Square bullets' },
]
export const NUMBER_STYLES = [
  { id: 'decimal', label: '1. 2. 3.', title: 'Numbers' },
  { id: 'lower-alpha', label: 'a. b. c.', title: 'Lowercase letters' },
  { id: 'upper-alpha', label: 'A. B. C.', title: 'Uppercase letters' },
  { id: 'lower-roman', label: 'i. ii. iii.', title: 'Lowercase Roman numerals' },
  { id: 'upper-roman', label: 'I. II. III.', title: 'Uppercase Roman numerals' },
]

/** Make the caret's paragraphs a list of this style (creating it if needed). */
export function setListStyle(root, ordered, style) {
  let at = caretElement(root)
  let list = at?.closest?.(ordered ? 'ol' : 'ul')
  if (!list || !root.contains(list)) {
    document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList')
    at = caretElement(root)
    list = at?.closest?.(ordered ? 'ol' : 'ul')
  }
  if (!list) return false
  if (style) list.style.listStyleType = style
  else list.style.removeProperty('list-style-type')
  if (!list.getAttribute('style')) list.removeAttribute('style')
  return true
}

/** Chrome's indent inside a list makes <ul><li>a</li><ul>…</ul></ul> — a list
 *  directly inside a list. Move each such list into the item before it. */
export function fixListNesting(root) {
  let moved = false
  root.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol').forEach(inner => {
    const prev = inner.previousElementSibling
    if (prev && prev.tagName === 'LI') { prev.appendChild(inner); moved = true }
  })
  return moved
}

/* ── autoformat as you type ────────────────────────────────────────────── */

/** Word's typographic quotes: opening after a space, bracket or line start. */
export function smartQuote(ch, before) {
  const opening = !before || /[\s([{—–-]$/.test(before)
  if (ch === '"') return opening ? '“' : '”'
  if (ch === "'") return opening ? '‘' : '’'
  return ch
}

/**
 * After a space typed at the start of a paragraph: does the text so far ask
 * for a list, a heading or a quote? Returns the command, or null.
 */
export function autoformatFor(textBefore) {
  const t = textBefore.replace(/ /g, ' ')
  if (/^[-*•] $/.test(t)) return { kind: 'ul' }
  if (/^1[.)] $/.test(t)) return { kind: 'ol' }
  if (/^a[.)] $/.test(t)) return { kind: 'ol', style: 'lower-alpha' }
  if (/^i[.)] $/.test(t)) return { kind: 'ol', style: 'lower-roman' }
  const h = /^(#{1,3}) $/.exec(t)
  if (h) return { kind: 'h' + h[1].length }
  if (/^> $/.test(t)) return { kind: 'blockquote' }
  return null
}

/** Enter after a line of three or more -, _ or = draws a rule. */
export function isRuleLine(text) {
  return /^\s*(-{3,}|_{3,}|={3,}|\*{3,})\s*$/.test(text.replace(/ /g, ' '))
}

/* ── tables ────────────────────────────────────────────────────────────── */

export function cellAtCaret(root) {
  const c = caretElement(root)?.closest?.('td,th')
  return c && root.contains(c) ? c : null
}

function gridOf(table) {
  return [...table.rows].filter(r => !r.hasAttribute('data-ds-gap'))
}

export function tableOp(root, op) {
  const cell = cellAtCaret(root)
  if (!cell) return false
  const row = cell.parentElement
  const table = cell.closest('table')
  const rows = gridOf(table)
  const col = [...row.cells].indexOf(cell)
  const blank = tag => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c }
  if (op === 'rowAbove' || op === 'rowBelow') {
    const tr = document.createElement('tr')
    for (let i = 0; i < row.cells.length; i++) tr.appendChild(blank('td'))
    row.parentNode.insertBefore(tr, op === 'rowAbove' ? row : row.nextSibling)
    placeIn(tr.cells[Math.min(col, tr.cells.length - 1)])
  } else if (op === 'colLeft' || op === 'colRight') {
    for (const r of rows) {
      const ref = r.cells[Math.min(col, r.cells.length - 1)]
      const c = blank(ref?.tagName === 'TH' ? 'th' : 'td')
      r.insertBefore(c, op === 'colLeft' ? ref : ref?.nextSibling || null)
    }
    placeIn(row.cells[op === 'colLeft' ? col : col + 1])
  } else if (op === 'delRow') {
    if (rows.length <= 1) { removeTable(table); return true }
    const next = row.nextElementSibling || row.previousElementSibling
    row.remove()
    if (next?.cells?.length) placeIn(next.cells[Math.min(col, next.cells.length - 1)])
  } else if (op === 'delCol') {
    if (row.cells.length <= 1) { removeTable(table); return true }
    for (const r of rows) r.cells[Math.min(col, r.cells.length - 1)]?.remove()
    placeIn(row.cells[Math.max(0, col - 1)])
  } else if (op === 'delTable') {
    removeTable(table)
  } else if (op === 'headerRow') {
    const first = rows[0]
    const toTh = ![...first.cells].every(c => c.tagName === 'TH')
    for (const c of [...first.cells]) {
      const n = document.createElement(toTh ? 'th' : 'td')
      while (c.firstChild) n.appendChild(c.firstChild)
      c.replaceWith(n)
    }
  } else if (op.startsWith('borders:')) {
    const mode = op.slice(8)
    table.setAttribute('data-ds-borders', mode)
    if (mode === 'all') table.removeAttribute('data-ds-borders')
  } else if (op.startsWith('shade:')) {
    const v = op.slice(6)
    if (v) cell.style.backgroundColor = v; else { cell.style.removeProperty('background-color'); if (!cell.getAttribute('style')) cell.removeAttribute('style') }
  } else return false
  return true
}

function removeTable(table) {
  const p = document.createElement('p')
  p.innerHTML = '<br>'
  table.replaceWith(p)
  placeIn(p)
}

function placeIn(el) {
  if (!el) return
  const r = document.createRange()
  r.selectNodeContents(el); r.collapse(true)
  setRange(r)
}

/* ── pictures ──────────────────────────────────────────────────────────── */

export const IMAGE_LAYOUTS = [
  { id: 'inline', label: 'In line with text' },
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Centre' },
  { id: 'right', label: 'Right' },
  { id: 'wrapLeft', label: 'Wrap text, picture left' },
  { id: 'wrapRight', label: 'Wrap text, picture right' },
]

export function setImageLayout(img, id) {
  for (const p of ['float', 'margin-left', 'margin-right', 'display', 'margin']) img.style.removeProperty(p)
  if (id === 'center') { img.style.display = 'block'; img.style.marginLeft = 'auto'; img.style.marginRight = 'auto' }
  else if (id === 'right') { img.style.display = 'block'; img.style.marginLeft = 'auto' }
  else if (id === 'left') { img.style.display = 'block' }
  else if (id === 'inline') { img.style.display = 'inline-block' }
  else if (id === 'wrapLeft') { img.style.float = 'left'; img.style.marginRight = '12px' }
  else if (id === 'wrapRight') { img.style.float = 'right'; img.style.marginLeft = '12px' }
  img.setAttribute('data-ds-layout', id)
}

export function imageLayoutOf(img) {
  return img?.getAttribute('data-ds-layout') || 'left'
}

/** Word's caption: "Figure N." under the picture, numbered by order. */
export function captionHtml(n) {
  return `<p data-ds-caption="1">Figure ${n}. </p>`
}

export function renumberCaptions(root) {
  let n = 0
  root.querySelectorAll('[data-ds-caption]').forEach(c => {
    n += 1
    const first = c.firstChild
    if (first && first.nodeType === 3) {
      const m = /^(Figure|Table)\s+\d+/.exec(first.data)
      if (m) { const next = first.data.replace(/^(Figure|Table)\s+\d+/, `${m[1]} ${n}`); if (next !== first.data) first.data = next }
    }
  })
}

/* ── symbols, dates, equations ─────────────────────────────────────────── */

export const SYMBOLS = [
  '©', '®', '™', '€', '£', '¥', '¢', '§', '¶', '†', '‡', '•', '…', '—', '–', '°',
  '±', '×', '÷', '≈', '≠', '≤', '≥', '∞', '√', '∑', '∏', '∫', '∂', '∆', '∇', 'µ',
  'α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'π', 'σ', 'φ', 'ω', 'Ω', 'Σ', 'Φ', 'Ψ', 'Γ',
  '→', '←', '↑', '↓', '↔', '⇒', '⇔', '½', '¼', '¾', '²', '³', '¹', '‰', '✓', '✗',
  '★', '☆', '♠', '♥', '♦', '♣', '«', '»', '‹', '›', '„', '“', '”', '‘', '’', '¿',
]

export const MATH_SYMBOLS = ['±', '×', '÷', '·', '≈', '≠', '≡', '≤', '≥', '∞', '√', '∛', '∑', '∏', '∫', '∮', '∂', '∇', '∆', '∈', '∉', '⊂', '⊆', '∪', '∩', '∀', '∃', '¬', '∧', '∨', '→', '⇒', '⇔', 'α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ω', 'Ω', 'Σ', '½', '⅓', '¼', '²', '³', 'ⁿ', '₀', '₁', '₂']

export function dateFormats(d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  const long = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return [
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    long,
    d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    `${long}, ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  ]
}

export const EQUATION_HTML = '<p data-ds-eq="1"><br></p>'
