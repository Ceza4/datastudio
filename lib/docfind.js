/*
  lib/docfind.js
  --------------------------------------------------------------------------
  FIND AND REPLACE for the Document block (Ctrl+F, Ctrl+H).

  Matches are painted with the CSS Custom Highlight API (::highlight), which
  marks ranges WITHOUT touching the DOM — so finding never disturbs the
  caret, undo, pagination or what gets saved. Where the API is missing the
  search still works; it just cannot paint every match, only select the
  current one.

  Matching runs over each paragraph's text as one string, so a word split
  across formatting (half bold) is still found. Deleted text under track
  changes and page-layout spacers are skipped.
  -------------------------------------------------------------------------- */

const BLOCKS = 'p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,figcaption'

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** The text of one paragraph-level element, with a map back to DOM points. */
function textMap(el) {
  const nodes = []
  let text = ''
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => {
      const p = n.parentElement
      if (p?.closest?.('[data-ds-gap], del[data-ds-uid], [data-ds-fn]')) return NodeFilter.FILTER_REJECT
      /* A nested block is searched on its own. */
      if (p && p !== el && p.closest(BLOCKS) !== el) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let n
  while ((n = w.nextNode())) { nodes.push({ node: n, start: text.length }); text += n.data }
  return { text, nodes }
}

function pointAt(nodes, i) {
  for (let k = nodes.length - 1; k >= 0; k--) {
    if (nodes[k].start <= i) return { node: nodes[k].node, offset: Math.min(i - nodes[k].start, nodes[k].node.length) }
  }
  return null
}

/**
 * Every match of `query` in the editor, as Ranges in document order.
 * opts: { matchCase, wholeWord }
 */
export function findAll(root, query, opts = {}) {
  if (!root || !query) return []
  const flags = opts.matchCase ? 'g' : 'gi'
  const body = escapeRe(query)
  const re = new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, flags + 'u')
  const out = []
  const blocks = [...root.querySelectorAll(BLOCKS)].filter(b => !b.querySelector(BLOCKS) || b.childNodes.length)
  const seen = new Set()
  for (const b of blocks) {
    if (b.closest('[data-ds-toc]')) continue
    const { text, nodes } = textMap(b)
    if (!text) continue
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex++; continue }
      const a = pointAt(nodes, m.index), z = pointAt(nodes, m.index + m[0].length)
      if (!a || !z) continue
      const key = a.node.data + '|' + m.index + '|' + nodes.length + '|' + out.length
      if (seen.has(key)) continue
      seen.add(key)
      const r = document.createRange()
      /* An end exactly at a node's end must stay in that node. */
      r.setStart(a.node, a.offset)
      const zi = nodes.findIndex(x => x.node === z.node)
      if (z.offset === 0 && zi > 0) { const prev = nodes[zi - 1].node; r.setEnd(prev, prev.length) } else r.setEnd(z.node, z.offset)
      out.push(r)
    }
  }
  return out
}

const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined'

/** Paint the matches (all, and the current one stronger). */
export function paintMatches(ranges, current) {
  if (!HL) return
  CSS.highlights.set('ds-find', new Highlight(...ranges))
  if (current != null && ranges[current]) CSS.highlights.set('ds-find-current', new Highlight(ranges[current]))
  else CSS.highlights.delete('ds-find-current')
}

export function clearPaint() {
  if (!HL) return
  CSS.highlights.delete('ds-find')
  CSS.highlights.delete('ds-find-current')
}

/** Replace one match's text, keeping the formatting of its first character. */
export function replaceRange(range, text) {
  const r = range.cloneRange()
  r.deleteContents()
  if (text) {
    const tn = document.createTextNode(text)
    r.insertNode(tn)
    r.setStartAfter(tn)
  }
  r.collapse(true)
  return r
}

/** Which match to show first: the first one at or after the caret. */
export function firstAfter(ranges, caret) {
  if (!caret) return 0
  const i = ranges.findIndex(r => r.compareBoundaryPoints(Range.START_TO_START, caret) >= 0)
  return i < 0 ? 0 : i
}
