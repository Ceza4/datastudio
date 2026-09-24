/*
  lib/codeblock.js
  --------------------------------------------------------------------------
  The Notes code block: header bar (language + Copy), syntax highlighting,
  line numbers, and deleting like any other block. Rebuilt 24 Sep 2026.

  ── THE SHAPE ────────────────────────────────────────────────────────────
  <div data-type="code" data-lang="js">
    <div data-type="code-head" contenteditable="false">
      <span data-type="code-lang"></span><span data-type="code-copy"></span>
    </div>
    <pre><code><span data-type="code-line"><span data-type="tk-kw">const</span> a = 1</span><span data-type="code-line"><br></span></code></pre>
  </div>

  · One <span data-type="code-line"> per line, display:block. Line numbers are
    a CSS counter on those spans (::before), so they are never part of the
    text: not copied, not exported, not in the saved content.
  · The header's labels ("JavaScript", "Copy") are CSS content too, driven by
    data-lang, for the same reason: they must not become text in the note.
  · Every marker is a data-type attribute (or data-lang), which is what the
    editor sanitizer keeps. Nothing depends on class.

  ── THE MODEL ────────────────────────────────────────────────────────────
  The TEXT is the truth: the lines' text joined with "\n". Typing inside a line
  is left to the browser. Anything that changes lines (Enter, Backspace or
  Delete across a line edge, paste) goes through the model: read the text and
  caret offset, change the string, render again, put the caret back. Highlighting
  re-renders after every input the same way. The caret is kept as a
  character offset, not a DOM position, so a re-render cannot lose it.
  -------------------------------------------------------------------------- */

export const CODE_LANGS = [
  { id: 'plain', label: 'Plain text' },
  { id: 'js', label: 'JavaScript' },
  { id: 'ts', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'sql', label: 'SQL' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'bash', label: 'Shell' },
]
const LANG_IDS = new Set(CODE_LANGS.map(l => l.id))
export const normalizeLang = l => (LANG_IDS.has(l) ? l : 'plain')

/* ── tokenizer ─────────────────────────────────────────────────────────────
   Small on purpose. Comments, strings, numbers, keywords and function calls
   cover what makes code readable at a glance. A full grammar per language is
   a dependency, and a wrong-but-confident colour is worse than none. */

const KW = {
  js: 'const let var function return if else for while do break continue switch case default new this class extends super import export from as async await try catch finally throw typeof instanceof in of null undefined true false yield delete void',
  python: 'def return if elif else for while break continue pass class import from as with try except finally raise lambda yield global nonlocal assert del in is not and or None True False async await self',
  sql: 'select from where and or not insert into values update set delete create table drop alter add join left right inner outer full on as group by order having limit offset distinct union all case when then else end null is in like between exists primary key foreign references index view asc desc count sum avg min max',
  json: 'true false null',
  css: 'important',
  bash: 'if then else elif fi for in do done while until case esac function return export local echo exit cd ls cat grep sudo',
  html: '',
}
KW.ts = KW.js + ' interface type enum implements private public protected readonly declare namespace abstract keyof never unknown any string number boolean void'
const kwSets = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.split(/\s+/).filter(Boolean))]))

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tk = (t, s) => `<span data-type="tk-${t}">${esc(s)}</span>`

function lineComment(lang) {
  if (lang === 'python' || lang === 'bash') return '#'
  if (lang === 'sql') return '--'
  if (lang === 'js' || lang === 'ts' || lang === 'css') return '//'
  return null
}

/**
 * Highlight `text` and return one HTML string per line. Multi-line comments
 * and strings are carried across lines, so each line is still one closed
 * element (no span ever straddles a line break).
 */
export function highlightLines(text, lang) {
  lang = normalizeLang(lang)
  const lines = String(text).split('\n')
  if (lang === 'plain') return lines.map(esc)
  const kws = kwSets[lang] || new Set()
  const lc = lineComment(lang)
  const block = (lang === 'js' || lang === 'ts' || lang === 'css' || lang === 'sql') ? ['/*', '*/']
    : lang === 'html' ? ['<!--', '-->'] : null
  let inBlock = false
  let inTpl = false // JS template literal spanning lines
  const out = []
  for (const line of lines) {
    let html = '', i = 0
    const n = line.length
    while (i < n) {
      if (inBlock) {
        const end = line.indexOf(block[1], i)
        if (end < 0) { html += tk('com', line.slice(i)); i = n; break }
        html += tk('com', line.slice(i, end + block[1].length)); i = end + block[1].length; inBlock = false; continue
      }
      if (inTpl) {
        const end = line.indexOf('`', i)
        if (end < 0) { html += tk('str', line.slice(i)); i = n; break }
        html += tk('str', line.slice(i, end + 1)); i = end + 1; inTpl = false; continue
      }
      const rest = line.slice(i)
      if (block && rest.startsWith(block[0])) { inBlock = true; continue }
      if (lc && rest.startsWith(lc) && !(lang === 'bash' && i > 0 && /\S/.test(line[i - 1]))) { html += tk('com', rest); i = n; break }
      const c = line[i]
      if (lang === 'html') {
        const m = /^<\/?[a-zA-Z][\w-]*/.exec(rest)
        if (m) { html += esc('<' + (m[0][1] === '/' ? '/' : '')) + tk('kw', m[0].replace(/^<\/?/, '')); i += m[0].length; continue }
        const a = /^([a-zA-Z-:]+)(=)/.exec(rest)
        if (a) { html += tk('fn', a[1]) + '='; i += a[0].length; continue }
      }
      if (c === '"' || c === "'" || c === '`') {
        if (c === '`' && (lang === 'js' || lang === 'ts')) {
          const end = line.indexOf('`', i + 1)
          if (end < 0) { html += tk('str', rest); inTpl = true; i = n; break }
          html += tk('str', line.slice(i, end + 1)); i = end + 1; continue
        }
        let j = i + 1
        while (j < n && line[j] !== c) { if (line[j] === '\\') j++; j++ }
        html += tk(lang === 'json' && /^\s*:/.test(line.slice(j + 1)) ? 'fn' : 'str', line.slice(i, j + 1)); i = j + 1; continue
      }
      const num = /^(0x[\da-fA-F]+|\d+(\.\d+)?([eE][-+]?\d+)?)/.exec(rest)
      if (num && !/[\w$]/.test(line[i - 1] || '')) { html += tk('num', num[0]); i += num[0].length; continue }
      const word = /^[A-Za-z_$][\w$]*/.exec(rest)
      if (word) {
        const w = word[0]
        const kwHit = lang === 'sql' ? kws.has(w.toLowerCase()) : kws.has(w)
        if (kwHit) html += tk('kw', w)
        else if (line[i + w.length] === '(' && lang !== 'css') html += tk('fn', w)
        else if (lang === 'css' && line[i + w.length] === ':' && /^\s*$/.test(line.slice(0, i))) html += tk('fn', w)
        else html += esc(w)
        i += w.length; continue
      }
      html += esc(c); i++
    }
    out.push(html)
  }
  return out
}

/* ── markup ──────────────────────────────────────────────────────────────── */

const HEAD = '<div data-type="code-head" contenteditable="false"><span data-type="code-lang"></span><span data-type="code-copy"></span></div>'

export function linesHtml(text, lang) {
  return highlightLines(text, lang)
    .map(h => `<span data-type="code-line">${h || '<br>'}</span>`)
    .join('')
}

/** A fresh, empty code block. */
export function codeBlockHtml(lang = 'plain', text = '') {
  lang = normalizeLang(lang)
  return `<div data-type="code" data-lang="${lang}">${HEAD}<pre><code>${linesHtml(text, lang)}</code></pre></div>`
}

export const isCodeBlock = el => el?.closest?.('[data-type="code"]') || null

/** The text of a code block: its lines joined with "\n". */
export function codeText(block) {
  const code = block.querySelector('code') || block.querySelector('pre')
  if (!code) return ''
  const lines = code.querySelectorAll(':scope > [data-type="code-line"]')
  if (!lines.length) return (code.innerText ?? code.textContent ?? '').replace(/\n$/, '')
  return Array.from(lines, l => l.textContent).join('\n')
}

/* ── caret as a character offset ─────────────────────────────────────────── */

function lineEls(block) {
  return Array.from(block.querySelectorAll('code > [data-type="code-line"]'))
}

/** Character offset of (node, offset) within the block's text, or -1. */
export function offsetOf(block, node, offset) {
  const lines = lineEls(block)
  let base = 0
  for (const line of lines) {
    if (line === node || line.contains(node)) {
      const r = (block.ownerDocument || document).createRange()
      r.setStart(line, 0)
      try { r.setEnd(node, offset) } catch { return base }
      return base + r.toString().length
    }
    base += line.textContent.length + 1
  }
  /* The caret is on the <code> or <pre> itself, between lines. */
  const code = block.querySelector('code')
  if (node === code) {
    let b = 0
    for (let i = 0; i < offset && i < lines.length; i++) b += lines[i].textContent.length + 1
    return Math.max(0, b - (offset > 0 ? 1 : 0))
  }
  return -1
}

export function setCaretOffset(block, off, sel = window.getSelection()) {
  const doc = block.ownerDocument || document
  const lines = lineEls(block)
  let rem = Math.max(0, off)
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const len = line.textContent.length
    if (rem <= len || li === lines.length - 1) {
      rem = Math.min(rem, len)
      const walker = doc.createTreeWalker(line, 4)
      let t
      while ((t = walker.nextNode())) {
        if (rem <= t.textContent.length) {
          const r = doc.createRange(); r.setStart(t, rem); r.collapse(true)
          sel.removeAllRanges(); sel.addRange(r); return
        }
        rem -= t.textContent.length
      }
      const r = doc.createRange(); r.setStart(line, 0); r.collapse(true)
      sel.removeAllRanges(); sel.addRange(r); return
    }
    rem -= len + 1
  }
}

/** Re-render a block's lines from `text`, keeping the caret at `caret` (an
 *  offset) when given. */
export function renderCode(block, text, caret, sel) {
  const lang = normalizeLang(block.getAttribute('data-lang'))
  const code = block.querySelector('code')
  if (!code) return
  const html = linesHtml(text, lang)
  if (code.innerHTML !== html) code.innerHTML = html
  if (caret != null && caret >= 0) setCaretOffset(block, caret, sel)
}

/* ── repair ──────────────────────────────────────────────────────────────── */

/**
 * Bring every code block under `root` to the one legal shape. Upgrades the
 * old bare `<pre><code>` blocks (and their "// your code here" placeholder,
 * which was real text), restores a header the browser deleted, and
 * re-highlights. Returns true if anything changed.
 */
export function normalizeCodeBlocks(root) {
  if (!root?.querySelectorAll) return false
  const doc = root.ownerDocument || document
  let changed = false
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    if (pre.closest('[data-type="code"]')) continue
    let text = (pre.innerText ?? pre.textContent ?? '').replace(/\n$/, '')
    if (text.trim() === '// your code here') text = ''
    const wrap = doc.createElement('div')
    wrap.innerHTML = codeBlockHtml('plain', text)
    pre.replaceWith(wrap.firstChild)
    changed = true
  }
  for (const block of Array.from(root.querySelectorAll('[data-type="code"]'))) {
    const lang = normalizeLang(block.getAttribute('data-lang'))
    if (block.getAttribute('data-lang') !== lang) { block.setAttribute('data-lang', lang); changed = true }
    let head = block.querySelector(':scope > [data-type="code-head"]')
    let pre = block.querySelector(':scope > pre')
    if (!pre) {
      /* The browser dissolved the <pre> (select-all + type does this).
         Whatever text is left becomes the code. */
      const text = Array.from(block.childNodes).filter(n => n !== head).map(n => n.textContent).join('')
      block.innerHTML = HEAD + `<pre><code>${linesHtml(text, lang)}</code></pre>`
      changed = true
      continue
    }
    if (!head || block.firstElementChild !== head) {
      head?.remove()
      const t = doc.createElement('div'); t.innerHTML = HEAD
      block.insertBefore(t.firstChild, block.firstChild)
      changed = true
    }
    for (const n of Array.from(block.childNodes)) {
      if (n !== block.firstElementChild && n !== pre) { n.remove(); changed = true }
    }
    if (!pre.querySelector(':scope > code')) {
      const text = (pre.innerText ?? pre.textContent ?? '').replace(/\n$/, '')
      pre.innerHTML = `<code>${linesHtml(text, lang)}</code>`
      changed = true
    }
    const text = codeText(block)
    const html = linesHtml(text, lang)
    const code = pre.querySelector('code')
    if (code.innerHTML !== html) {
      /* Keep the caret if it was in here. */
      const sel = doc.getSelection?.()
      let caret = -1
      if (sel?.rangeCount && block.contains(sel.anchorNode)) caret = offsetOf(block, sel.anchorNode, sel.anchorOffset)
      code.innerHTML = html
      if (caret >= 0) setCaretOffset(block, caret, sel)
      changed = true
    }
  }
  return changed
}

/* ── keys ────────────────────────────────────────────────────────────────── */

function paraAfter(block, doc) {
  let next = block.nextElementSibling
  if (!next || next.matches('[data-type="code"], hr, table, [contenteditable="false"]')) {
    next = doc.createElement('div'); next.innerHTML = '<br>'; block.after(next)
  }
  return next
}

function caretTo(el, atEnd, sel, doc) {
  const r = doc.createRange()
  r.selectNodeContents(el)
  const onlyBr = el.childNodes.length === 1 && el.firstChild.nodeName === 'BR'
  r.collapse(!atEnd || onlyBr)
  sel.removeAllRanges(); sel.addRange(r)
}

/**
 * Keys inside a code block. Returns { handled, changed }.
 *
 *  Enter        new line, keeping the current line's indent
 *  Backspace    at the very start: an EMPTY block is removed (becomes an
 *               empty paragraph); a non-empty one is left alone rather than
 *               merged into the paragraph above
 *               at a line start: joins with the line above
 *  Delete       at the very end: an empty block is removed; otherwise nothing
 *               (never pulls the next paragraph into the code)
 *               at a line end: joins with the line below
 *  Escape / ArrowDown on the last line  leaves the block (a line is made
 *               below it if there is none)
 */
export function handleCodeKeyDown(e, sel = window.getSelection()) {
  const none = { handled: false, changed: false }
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return none
  if (!sel?.rangeCount) return none
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  const el = node.nodeType === 3 ? node.parentElement : node
  const block = isCodeBlock(el)
  if (!block) return none
  const doc = block.ownerDocument || document
  const stop = r => { e.preventDefault(); e.stopPropagation?.(); return r }

  const text = codeText(block)
  const start = offsetOf(block, range.startContainer, range.startOffset)
  const end = range.collapsed ? start : offsetOf(block, range.endContainer, range.endOffset)
  if (start < 0 || end < 0) return none

  if (e.key === 'Enter' && !e.shiftKey) {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const indent = /^[ \t]*/.exec(text.slice(lineStart))[0]
    const next = text.slice(0, start) + '\n' + indent + text.slice(end)
    renderCode(block, next, start + 1 + indent.length, sel)
    return stop({ handled: true, changed: true })
  }
  if (e.key === 'Tab') {
    const next = text.slice(0, start) + '  ' + text.slice(end)
    renderCode(block, next, start + 2, sel)
    return stop({ handled: true, changed: true })
  }
  if (!range.collapsed) {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      renderCode(block, text.slice(0, start) + text.slice(end), start, sel)
      return stop({ handled: true, changed: true })
    }
    return none
  }
  if (e.key === 'Backspace') {
    if (start === 0) {
      if (!text.length) {
        const p = doc.createElement('div'); p.innerHTML = '<br>'
        block.replaceWith(p); caretTo(p, false, sel, doc)
        return stop({ handled: true, changed: true })
      }
      return stop({ handled: true, changed: false })
    }
    if (text[start - 1] === '\n') {
      renderCode(block, text.slice(0, start - 1) + text.slice(start), start - 1, sel)
      return stop({ handled: true, changed: true })
    }
    return none
  }
  if (e.key === 'Delete') {
    if (start === text.length) {
      if (!text.length) {
        const p = doc.createElement('div'); p.innerHTML = '<br>'
        block.replaceWith(p); caretTo(p, false, sel, doc)
        return stop({ handled: true, changed: true })
      }
      return stop({ handled: true, changed: false })
    }
    if (text[start] === '\n') {
      renderCode(block, text.slice(0, start) + text.slice(start + 1), start, sel)
      return stop({ handled: true, changed: true })
    }
    return none
  }
  if (e.key === 'Escape' || (e.key === 'ArrowDown' && !e.shiftKey && text.indexOf('\n', start) < 0)) {
    const p = paraAfter(block, doc)
    caretTo(p, false, sel, doc)
    return stop({ handled: true, changed: p.previousElementSibling === block && !p.textContent })
  }
  return none
}

/** Paste inside a code block: always plain text, through the model. */
export function handleCodePaste(e, sel = window.getSelection()) {
  if (!sel?.rangeCount) return false
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  const block = isCodeBlock(node.nodeType === 3 ? node.parentElement : node)
  if (!block) return false
  const paste = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n')
  const text = codeText(block)
  const start = offsetOf(block, range.startContainer, range.startOffset)
  const end = range.collapsed ? start : offsetOf(block, range.endContainer, range.endOffset)
  if (start < 0 || end < 0) return false
  e.preventDefault()
  renderCode(block, text.slice(0, start) + paste + text.slice(end), start + paste.length, sel)
  return true
}

/** After an input inside a code block: re-highlight, keep the caret. */
export function rehighlightAtCaret(sel = window.getSelection()) {
  if (!sel?.rangeCount) return false
  const node = sel.anchorNode
  const block = isCodeBlock(node?.nodeType === 3 ? node.parentElement : node)
  if (!block) return false
  const caret = offsetOf(block, sel.anchorNode, sel.anchorOffset)
  renderCode(block, codeText(block), caret, sel)
  return true
}

/** Set a block's language and re-highlight. */
export function setCodeLang(block, lang) {
  block.setAttribute('data-lang', normalizeLang(lang))
  renderCode(block, codeText(block), null)
}
