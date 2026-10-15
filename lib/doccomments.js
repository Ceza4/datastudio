/*
  lib/doccomments.js
  --------------------------------------------------------------------------
  COMMENTS on a Document block, Word and Google Docs style.

  The commented text is marked in the content with
  <span data-ds-comment="c_…">, so the mark moves with the text as you edit
  and survives sync; the thread itself (text, author, time, replies,
  resolved) lives on the block as `block.comments`. One span per text run —
  a selection across bold and plain text becomes several spans with the same
  id, and a second comment over the same words nests inside the first.

  Deleting all of a comment's text leaves the thread without an anchor; it
  is kept (undo brings the text back) and listed at the end of the rail as
  "on deleted text", where it can be deleted for good.
  -------------------------------------------------------------------------- */

export const COMMENT_ATTR = 'data-ds-comment'

export function newCommentId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** Wrap the range's text in anchor spans for `id`. A collapsed caret takes
 *  the word it sits in. Returns false when there is no text to comment on. */
export function anchorComment(root, range, id) {
  let r = range.cloneRange()
  if (r.collapsed) {
    const sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(r)
    sel.modify('move', 'backward', 'word')
    sel.modify('extend', 'forward', 'word')
    r = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : r
    if (!root.contains(r.commonAncestorContainer)) return false
  }
  const startC = r.startContainer, startO = r.startOffset, endC = r.endContainer, endO = r.endOffset
  const base = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer
  const w = document.createTreeWalker(base, NodeFilter.SHOW_TEXT)
  const list = []
  let n
  while ((n = w.nextNode())) if (n.length && r.intersectsNode(n)) list.push(n)
  if (!list.length && r.commonAncestorContainer.nodeType === 3) list.push(r.commonAncestorContainer)
  let any = false
  let first = null, last = null
  for (const t0 of list) {
    if (t0.parentElement?.closest?.('[data-ds-gap],[contenteditable="false"]')) continue
    let t = t0
    const s = t === startC ? startO : 0
    const e = t === endC ? endO : t.length
    if (s >= e) continue
    if (!t.data.slice(s, e).trim() && list.length > 1) continue
    if (e < t.length) t.splitText(e)
    if (s > 0) t = t.splitText(s)
    const span = document.createElement('span')
    span.setAttribute(COMMENT_ATTR, id)
    t.parentNode.insertBefore(span, t)
    span.appendChild(t)
    first = first || span; last = span
    any = true
  }
  if (any) {
    const nr = document.createRange()
    nr.setStartBefore(first); nr.setEndAfter(last)
    const sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(nr)
  }
  return any
}

export function anchorsOf(root, id) {
  return root ? [...root.querySelectorAll(`[${COMMENT_ATTR}="${CSS.escape(id)}"]`)] : []
}

export function removeAnchors(root, id) {
  anchorsOf(root, id).forEach(s => s.replaceWith(...s.childNodes))
  root?.normalize?.()
}

/** Comment ids the node sits inside, innermost first. */
export function commentIdsAt(node, root) {
  const out = []
  let el = node?.nodeType === 3 ? node.parentElement : node
  while (el && el !== root) {
    const id = el.getAttribute?.(COMMENT_ATTR)
    if (id && !out.includes(id)) out.push(id)
    el = el.parentElement
  }
  return out
}

/** The quoted text of a comment's anchor, for the card. */
export function anchorText(root, id) {
  return anchorsOf(root, id).map(s => s.textContent).join('').replace(/​/g, '').trim()
}

/* ── Thread data (pure; tested in node) ───────────────────────────────── */

export function addThread(list, { id, text, author, at = new Date().toISOString() }) {
  return [...(list || []), { id, text: text || '', by: author?.name || 'You', uid: author?.id || 'anon', at, resolved: false, replies: [] }]
}

export function editThread(list, id, text) {
  /* Posting a new thread's first words is not an edit. */
  return (list || []).map(c => (c.id === id ? { ...c, text, edited: c.edited || !!c.text } : c))
}

export function replyTo(list, id, { text, author, at = new Date().toISOString() }) {
  return (list || []).map(c => (c.id === id
    ? { ...c, replies: [...(c.replies || []), { id: newCommentId(), text, by: author?.name || 'You', uid: author?.id || 'anon', at }] }
    : c))
}

export function setResolved(list, id, resolved) {
  return (list || []).map(c => (c.id === id ? { ...c, resolved: !!resolved } : c))
}

export function removeThread(list, id) {
  return (list || []).filter(c => c.id !== id)
}

/**
 * Stack cards down the rail: each wants to sit level with its anchor, none
 * may overlap, and the ACTIVE card sits exactly level with its text — the
 * others make room above and below it, as in Google Docs.
 * @param {{id, y, h}[]} items  y = anchor top, h = card height
 * @returns {Map<string, number>} id → card top
 */
export function stackCards(items, activeId, gap = 8) {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  const out = new Map()
  const ai = sorted.findIndex(c => c.id === activeId)
  if (ai < 0) {
    let bottom = -Infinity
    for (const c of sorted) { const top = Math.max(c.y, bottom + gap); out.set(c.id, top); bottom = top + c.h }
    return out
  }
  out.set(sorted[ai].id, sorted[ai].y)
  let bottom = sorted[ai].y + sorted[ai].h
  for (let i = ai + 1; i < sorted.length; i++) {
    const top = Math.max(sorted[i].y, bottom + gap)
    out.set(sorted[i].id, top); bottom = top + sorted[i].h
  }
  let topEdge = sorted[ai].y
  for (let i = ai - 1; i >= 0; i--) {
    const top = Math.min(sorted[i].y, topEdge - gap - sorted[i].h)
    out.set(sorted[i].id, top); topEdge = top
  }
  return out
}

/* Formatters are built once and labels cached: toLocale…String with options
   builds a new Intl formatter per call, and a rail of 200 cards re-rendered
   on every keystroke spent most of its time there. */
let fmtTime = null, fmtDay = null
const labels = new Map()
export function timeLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date().toDateString()
  const key = today + '|' + iso
  const hit = labels.get(key)
  if (hit) return hit
  fmtTime ||= new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
  fmtDay ||= new Intl.DateTimeFormat([], { day: 'numeric', month: 'short' })
  const out = d.toDateString() === today ? fmtTime.format(d) : fmtDay.format(d)
  if (labels.size > 2000) labels.clear()
  labels.set(key, out)
  return out
}
