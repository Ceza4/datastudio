/*
  lib/markdown.js
  --------------------------------------------------------------------------
  Markdown -> HTML, for importing a .md file into a text block.

  WHY THIS EXISTS: DataStudio already EXPORTS Markdown (lib/exporters.js,
  blocksToMarkdown, its own entry in the export panel) and could not read it
  back. You could export a notebook to .md and then not drag it into
  DataStudio. That asymmetry is the whole brief, and it also settles the scope
  question that otherwise never ends: the importer has to handle what
  blocksToMarkdown emits, plus the basics everyone writes by hand. Not
  footnotes, not definition lists, not raw HTML.

  THREE RULES, IN ORDER, AND THE ORDER IS THE SECURITY MODEL

  1. ESCAPE FIRST. Every character of the source is HTML-escaped before a
     single tag is generated. Raw HTML in a .md file is therefore inert by
     construction: it renders as the text it looks like rather than as markup.
     A deliberate departure from CommonMark, which passes raw HTML through.
     An imported file is content from outside the app; the CommonMark
     behaviour is a feature for a static site generator and a hole for a
     notebook.

  2. GENERATE. Only this file's own tags contain real angle brackets.

  3. VERIFY, do not re-transform. The obvious third rule was "run it through
     lib/sanitize.js as well", and it is wrong here — provably, not
     arguably. sanitizeHtml escapes every ampersand in a text node, because it
     is built to receive RAW html and make it safe. Feeding it output that is
     already escaped turns &lt; into &amp;lt; and &#9745; into &amp;#9745;:
     every entity and every code block comes out visibly broken. It is not
     idempotent, and nothing that is not idempotent belongs at the end of a
     generator.

     So the second defence is a CHECK rather than another transform:
     assertKnownTags() walks the finished html and fails if a single tag
     appears that this file does not itself emit. On failure the whole
     document falls back to escaped plain text — loud, and safe. A check is a
     genuinely independent defence in a way that running the same class of
     escaping twice never was.

  Every URL passes lib/urls.js as well. A markdown link can carry a
  javascript: scheme, and that is code in a browser, not a link.
  -------------------------------------------------------------------------- */

import { safeLinkUrl } from './urls.js'

export const MARKDOWN_EXTS = ['.md', '.markdown', '.mdown', '.mkd']

/* Numeric entities rather than literal glyphs, so this file stays ASCII-clean
   and cannot be mangled by a toolchain guessing at encoding. */
const BOX_DONE = '&#9745;'
const BOX_OPEN = '&#9744;'

/* Placeholder delimiter for extracted code spans. Built with fromCharCode
   rather than written literally: any placeholder made of ordinary characters
   can itself be matched by the emphasis rules below, and NUL cannot occur in
   the escaped source. */
const NUL = String.fromCharCode(0)
const SPAN_RE = new RegExp(NUL + '(\\d+)' + NUL, 'g')

/* Every tag this file can produce, and nothing else. If a tag outside this
   set ever reaches the output, escaping has failed somewhere upstream and the
   document is not trustworthy — see assertKnownTags. */
const EMITTED = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 's', 'code', 'pre',
  'ul', 'ol', 'li', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a',
])

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)/g

function assertKnownTags(html) {
  TAG_RE.lastIndex = 0
  let m
  while ((m = TAG_RE.exec(html)) !== null) {
    if (!EMITTED.has(m[1].toLowerCase())) return false
  }
  return true
}

const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* Undo esc() for one value. Ampersand LAST, or an encoded entity inside the
   string decodes twice and turns &amp;lt; into a real angle bracket. */
const unesc = str => String(str)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/* Every link this file emits, built in one place.

   target and rel are NOT decoration. These links come out of a file someone
   else wrote, and an anchor that opens in the same tab hands the imported
   document control of the workspace; without noopener the opened page gets a
   window.opener handle back into this origin. lib/sanitize.js adds both when
   it processes an anchor — this file no longer runs through it (see rule 3
   above), so the same guarantee has to be made here rather than assumed. */
function anchor(url, label, title) {
  return '<a href="' + esc(url) + '"' +
    (title ? ' title="' + esc(title) + '"' : '') +
    ' target="_blank" rel="noopener noreferrer nofollow">' + label + '</a>'
}

/* ── inline ───────────────────────────────────────────────────────────── */

/**
 * Inline formatting for ONE already-escaped run of text.
 *
 * Code spans are pulled out first and put back last. Without that, bold
 * markers inside backticks become bold, and the one place a reader expects
 * characters to mean themselves is the one place they stop doing so.
 */
function inline(escaped) {
  const spans = []
  let out = String(escaped).replace(/`([^`]+)`/g, (_, code) => {
    spans.push(code)
    return NUL + (spans.length - 1) + NUL
  })

  /* Links before emphasis: a label may contain emphasis, a URL must not be
     touched by it. A path with two underscores in it is not italic. */
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, label, href, title) => {
    /* safeLinkUrl has to judge the string a BROWSER will act on, not a
       display form of it, so the href is unescaped before the check and
       re-escaped after. */
    const url = safeLinkUrl(unesc(href))
    /* Refused: hand back the ENTIRE match, not just the label. Returning the
       label alone drops the opening bracket and the url but leaves whatever
       followed the closing one, so a refused link came out as "bad)" — the
       text visibly damaged by a check that was supposed to be invisible. */
    if (!url) return m
    return anchor(url, label, title)
  })

  /* Autolinks. The angle brackets are already escaped by the time we see them. */
  out = out.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, (m, href) => {
    const url = safeLinkUrl(href)
    return url ? anchor(url, esc(url)) : m
  })

  out = out
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    /* A single * or _ is emphasis only when it is not part of a word.
       snake_case names are far more common in these notebooks than mid-word
       emphasis, and turning half a variable name italic is the classic
       naive-markdown tell. */
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')

  return out.replace(SPAN_RE, (_, n) => '<code>' + spans[Number(n)] + '</code>')
}

/* ── blocks ───────────────────────────────────────────────────────────── */

const RE = {
  fence: /^\s*(```|~~~)\s*([\w+-]*)\s*$/,
  heading: /^(#{1,6})\s+(.*)$/,
  rule: /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/,
  quote: /^\s*>\s?(.*)$/,
  ul: /^(\s*)[-*+]\s+(.*)$/,
  ol: /^(\s*)(\d+)[.)]\s+(.*)$/,
  task: /^\[([ xX])\]\s+(.*)$/,
  tableRow: /^\s*\|(.+)\|\s*$/,
  tableSep: /^\s*\|?[\s:|-]+\|[\s:|-]*$/,
}

const cells = row => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())

/**
 * @param {string} src  raw markdown
 * @returns {string}    sanitised HTML, ready for a text block's content
 */
export function markdownToHtml(src) {
  if (typeof src !== 'string' || !src.trim()) return ''
  const html = blocks(src)
  /* Fail CLOSED and fail VISIBLY. If an unexpected tag got through, the
     document is shown as the plain text it started as rather than rendered
     and hoped about. A silent partial render is the worst of both. */
  if (!assertKnownTags(html)) return '<pre><code>' + esc(src) + '</code></pre>'
  return html
}

/* The generator, without the sanitiser. Blockquotes recurse through THIS, not
   through markdownToHtml: sanitising an already-sanitised fragment at every
   nesting level is repeated work, and the single outer pass covers all of it. */
function blocks(src) {
  /* Tabs become spaces before anything measures indentation, or a
     tab-indented list nests differently from a space-indented one purely
     because of how the file happened to be saved. */
  const lines = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  const out = []
  const buf = []
  let i = 0

  /* Paragraph lines are joined with a SPACE, per CommonMark, so hard-wrapped
     prose reflows instead of arriving as a column of fragments. Two trailing
     spaces or a trailing backslash is the explicit hard break. */
  const para = () => {
    if (!buf.length) return
    const html = buf.map((l, n) => {
      const hard = /(\s{2,}|\\)$/.test(l)
      return inline(esc(l.replace(/(\s{2,}|\\)$/, ''))) + (hard && n < buf.length - 1 ? '<br>' : '')
    }).join(' ').replace(/<br> /g, '<br>')
    out.push('<p>' + html + '</p>')
    buf.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]

    /* Fenced code. Escaped and NOT inline-processed: the entire point of a
       code block is that its characters mean themselves. */
    const fence = RE.fence.exec(line)
    if (fence) {
      para()
      const close = fence[1]
      const body = []
      i++
      while (i < lines.length && !(lines[i].trim().startsWith(close) && RE.fence.test(lines[i]))) {
        body.push(lines[i]); i++
      }
      i++   // the closing fence, or off the end if it was never closed
      out.push('<pre><code>' + esc(body.join('\n')) + '</code></pre>')
      continue
    }

    if (!line.trim()) { para(); i++; continue }

    /* A rule must be tested BEFORE a list: three dashes also match the
       unordered-list pattern, so a horizontal rule would become an empty
       bullet instead. */
    if (RE.rule.test(line)) { para(); out.push('<hr>'); i++; continue }

    const h = RE.heading.exec(line)
    if (h) {
      para()
      out.push('<h' + h[1].length + '>' + inline(esc(h[2].trim())) + '</h' + h[1].length + '>')
      i++; continue
    }

    if (RE.quote.test(line)) {
      para()
      const body = []
      while (i < lines.length && RE.quote.test(lines[i])) { body.push(RE.quote.exec(lines[i])[1]); i++ }
      out.push('<blockquote>' + blocks(body.join('\n')) + '</blockquote>')
      continue
    }

    /* Tables. A row counts as a table only when the NEXT line is a separator,
       or any sentence containing pipes becomes a one-cell table. */
    if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      para()
      const head = cells(line)
      i += 2
      const body = []
      while (i < lines.length && RE.tableRow.test(lines[i])) { body.push(cells(lines[i])); i++ }
      out.push(
        '<table><thead><tr>' +
        head.map(c => '<th>' + inline(esc(c)) + '</th>').join('') +
        '</tr></thead><tbody>' +
        body.map(r => '<tr>' + head.map((_, n) => '<td>' + inline(esc(r[n])) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>')
      continue
    }

    if (RE.ul.test(line) || RE.ol.test(line)) {
      para()
      /* Called ONCE and destructured. Calling it twice, once for the html and
         once for the next index, parses the whole list twice and only ever
         shows up as a mysteriously slow import of a long document. */
      const built = list(lines, i, 0)
      out.push(built.html)
      i = built.next
      continue
    }

    buf.push(line)
    i++
  }
  para()
  return out.join('\n')
}

/**
 * One list, possibly nested. Returns its html and the index after it.
 *
 * Nesting is by INDENT, which is why tabs were expanded before we got here.
 * A deeper item opens a sublist INSIDE the current li rather than a sibling
 * list after it: the two render almost identically and export completely
 * differently.
 */
function list(lines, start, indent) {
  const ordered = RE.ol.test(lines[start])
  const items = []
  let i = start

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) break
    const m = ordered ? RE.ol.exec(line) : RE.ul.exec(line)
    if (!m) break
    const pad = m[1].length
    if (pad < indent) break
    if (pad > indent) {
      const sub = list(lines, i, pad)
      if (items.length) items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, sub.html + '</li>')
      else items.push('<li>' + sub.html + '</li>')
      i = sub.next
      continue
    }
    const text = ordered ? m[3] : m[2]
    /* Task list items. A real checkbox would be an <input>, which the
       sanitiser drops, and rightly: it is a form control in a note. A glyph
       says the same thing, survives export to every format, and cannot be
       clicked into a false sense of being interactive. */
    const task = RE.task.exec(text)
    items.push(task
      ? '<li>' + (task[1].toLowerCase() === 'x' ? BOX_DONE : BOX_OPEN) + ' ' + inline(esc(task[2])) + '</li>'
      : '<li>' + inline(esc(text)) + '</li>')
    i++
  }

  const tag = ordered ? 'ol' : 'ul'
  return { html: '<' + tag + '>' + items.join('') + '</' + tag + '>', next: i }
}

/** The first ATX heading, for naming the block after the document it came
 *  from. Only counts when it is the FIRST thing in the file: a heading three
 *  screens down is a section, not a title. */
export function markdownTitle(src, fallback = '') {
  if (typeof src !== 'string') return fallback
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    const h = RE.heading.exec(line)
    if (h) return h[2].trim().slice(0, 120) || fallback
    if (line.trim()) break
  }
  return fallback
}
