/*
  lib/doctrack.js
  --------------------------------------------------------------------------
  TRACK CHANGES for the Document block.

  With tracking on, what you type is wrapped in <ins> and what you delete is
  kept, struck through, in <del> — each carrying who made it and when
  (data-ds-by, data-ds-uid, data-ds-at). Nothing is lost until someone
  accepts or rejects it:

      accept an insertion  → keep the text, drop the mark
      accept a deletion    → remove the text
      reject an insertion  → remove the text
      reject a deletion    → keep the text, drop the mark

  Deleting text you inserted yourself, still unaccepted, removes it for real
  (Word does the same: there is nothing to review in your own typo). What is
  NOT tracked, deliberately: formatting and paragraph splits and joins. Word
  tracks those with a much heavier model; here they apply directly.

  Exports and the word count use the FINAL text (every change accepted).
  -------------------------------------------------------------------------- */

export const CHANGE_SEL = 'ins[data-ds-uid], del[data-ds-uid]'

export function markAttrs(el, author) {
  el.setAttribute('data-ds-by', author?.name || 'Someone')
  el.setAttribute('data-ds-uid', author?.id || 'anon')
  el.setAttribute('data-ds-at', new Date().toISOString())
}

const sameAuthor = (el, author) => el?.getAttribute?.('data-ds-uid') === (author?.id || 'anon')

/** The tracked <ins>/<del> a node sits inside, if any. */
export function changeOf(node, root) {
  const el = node?.nodeType === 3 ? node.parentElement : node
  const c = el?.closest?.(CHANGE_SEL)
  return c && (!root || root.contains(c)) ? c : null
}

/* Text nodes the range touches, split to the range's bounds. */
function splitTextNodesIn(root, r) {
  const startC = r.startContainer, startO = r.startOffset, endC = r.endContainer, endO = r.endOffset
  const base = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer
  const w = document.createTreeWalker(base, NodeFilter.SHOW_TEXT)
  const list = []
  let n
  while ((n = w.nextNode())) if (n.length && r.intersectsNode(n)) list.push(n)
  if (!list.length && r.commonAncestorContainer.nodeType === 3) list.push(r.commonAncestorContainer)
  const out = []
  for (const t0 of list) {
    if (t0.parentElement?.closest?.('[data-ds-gap],[contenteditable="false"]')) continue
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

/* Merge a mark into an identical neighbour (same kind, same author). */
function mergeNeighbours(el) {
  const same = x => x && x.nodeType === 1 && x.tagName === el.tagName && x.getAttribute('data-ds-uid') === el.getAttribute('data-ds-uid')
  const prev = el.previousSibling
  if (same(prev)) { while (el.firstChild) prev.appendChild(el.firstChild); el.remove(); el = prev }
  const next = el.nextSibling
  if (same(next)) { while (next.firstChild) el.appendChild(next.firstChild); next.remove() }
  return el
}

/**
 * Mark a range as deleted. Text inside your own pending insertion is removed
 * for real; text already deleted is left alone.
 * @returns {{ start: {node, offset}, end: {node, offset} } | null}  where
 *   the caret should go for a backward (start) or forward (end) delete
 */
export function trackDelete(root, range, author) {
  const texts = splitTextNodesIn(root, range)
  const imgs = [...root.querySelectorAll('img')].filter(im => range.intersectsNode(im) && !changeOf(im, root)?.matches('del'))
  if (!texts.length && !imgs.length) return null
  let first = null, last = null
  for (const t of texts) {
    const c = changeOf(t, root)
    if (c && c.tagName === 'DEL') { first = first || c; last = c; continue }
    if (c && c.tagName === 'INS' && sameAuthor(c, author)) {
      const parent = t.parentNode
      const marker = document.createTextNode('')
      parent.insertBefore(marker, t)
      t.remove()
      first = first || marker; last = marker
      continue
    }
    const del = document.createElement('del')
    markAttrs(del, author)
    t.parentNode.insertBefore(del, t)
    del.appendChild(t)
    const m = mergeNeighbours(del)
    first = first || m; last = m
  }
  for (const im of imgs) {
    const del = document.createElement('del')
    markAttrs(del, author)
    im.parentNode.insertBefore(del, im)
    del.appendChild(im)
    first = first || del; last = del
  }
  /* Empty insertions left behind by deleting your own typing. */
  root.querySelectorAll('ins[data-ds-uid]').forEach(i => { if (!i.textContent && !i.querySelector('img,br')) i.remove() })
  const pt = (el, after) => {
    if (!el.isConnected) return null
    if (el.nodeType === 3) return { node: el, offset: 0 }
    const p = el.parentNode
    const idx = [...p.childNodes].indexOf(el)
    return { node: p, offset: after ? idx + 1 : idx }
  }
  return { start: pt(first, false), end: pt(last, true) }
}

/**
 * Insert text as a tracked insertion at a collapsed range. Typing inside your
 * own pending insertion just extends it.
 * @returns {Range} a collapsed range after the new text
 */
export function trackInsertText(root, range, text, author) {
  const c = changeOf(range.startContainer, root)
  const r = range.cloneRange()
  if (c && c.tagName === 'INS' && sameAuthor(c, author)) {
    const tn = document.createTextNode(text)
    r.insertNode(tn)
    const after = document.createRange()
    after.setStart(tn, tn.length); after.collapse(true)
    tn.parentNode.normalize?.()
    return after
  }
  /* Never nest an insertion inside a deletion: step out of it first. */
  if (c && c.tagName === 'DEL') {
    const atStart = r.startContainer === c.firstChild && r.startOffset === 0
    r.setStart(c.parentNode, [...c.parentNode.childNodes].indexOf(c) + (atStart ? 0 : 1))
    r.collapse(true)
  }
  const ins = document.createElement('ins')
  markAttrs(ins, author)
  const tn = document.createTextNode(text)
  ins.appendChild(tn)
  r.insertNode(ins)
  const merged = mergeNeighbours(ins)
  const last = merged.lastChild
  const after = document.createRange()
  if (last && last.nodeType === 3) after.setStart(last, last.length)
  else after.setStart(merged, merged.childNodes.length)
  after.collapse(true)
  return after
}

/** Wrap every text node of an HTML fragment in <ins> — tracked paste. */
export function markFragmentInserted(html, author) {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT)
  const list = []
  let n
  while ((n = w.nextNode())) if (n.data.trim()) list.push(n)
  for (const t of list) {
    const ins = document.createElement('ins')
    markAttrs(ins, author)
    t.parentNode.insertBefore(ins, t)
    ins.appendChild(t)
  }
  return tpl.innerHTML
}

/* ── review ───────────────────────────────────────────────────────────── */

export function acceptChange(el) {
  if (!el?.parentNode) return
  if (el.tagName === 'INS') el.replaceWith(...el.childNodes)
  else el.remove()
}

export function rejectChange(el) {
  if (!el?.parentNode) return
  if (el.tagName === 'DEL') el.replaceWith(...el.childNodes)
  else el.remove()
}

export function acceptAll(root) { root.querySelectorAll(CHANGE_SEL).forEach(acceptChange) }
export function rejectAll(root) { root.querySelectorAll(CHANGE_SEL).forEach(rejectChange) }

/** Every pending change in document order, with a short label for the rail. */
export function listChanges(root) {
  return [...root.querySelectorAll(CHANGE_SEL)].map(el => ({
    el,
    kind: el.tagName === 'INS' ? 'ins' : 'del',
    by: el.getAttribute('data-ds-by') || 'Someone',
    uid: el.getAttribute('data-ds-uid') || '',
    at: el.getAttribute('data-ds-at') || '',
    text: (el.textContent || (el.querySelector('img') ? '[picture]' : '')).replace(/​/g, ''),
  }))
}

/** The document with every change accepted — what exports and counts see.
 *  Works on an HTML string, so it runs without a live editor. */
export function finalHtml(html) {
  if (!html || !/data-ds-uid/.test(html) || typeof document === 'undefined') return html
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll(CHANGE_SEL).forEach(acceptChange)
  return tpl.innerHTML
}

/** A stable hue per author, for the underline and strike colours. */
export function authorHue(uid) {
  let h = 0
  for (const ch of String(uid || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const HUES = [4, 28, 205, 262, 330, 150, 190, 45]
  return HUES[h % HUES.length]
}
