/*
  lib/insertblock.js
  --------------------------------------------------------------------------
  Put a structural block (a checklist item, a columns row) at the caret by
  building the DOM directly, not with execCommand('insertHTML').

  WHY (reproduced in the real Notes editor, 24 Sep 2026)
  insertHTML is not a paste of the string you give it. Chrome "reconciles" the
  fragment with its surroundings: in the Notes editor it dropped the
  checklist's display:flex, treated the <br> in its text span as a spare
  placeholder and removed it, then removed the span for being empty. The item
  arrived without a text span and the repair pass turned it into an ordinary
  line, so choosing Checklist from the / menu produced nothing. The same call
  left the caret BELOW a new columns row rather than in its first column.

  Built by hand, the block arrives exactly as written, and the caret goes
  where it should.
  -------------------------------------------------------------------------- */

const isEmptyLine = el =>
  el && el.nodeType === 1 && !el.textContent.replace(/​/g, '').trim() &&
  !el.querySelector('img,hr,input,table,pre,[data-type]')

/**
 * Insert `node` (an element) as a block at the caret inside `root`.
 * An empty current line is replaced; otherwise the block goes after the
 * caret's line. A fresh empty line follows it, so there is always somewhere
 * to go next. Returns the inserted node, or null.
 */
export function insertBlockAtCaret(root, node, sel = window.getSelection()) {
  if (!root || !node) return null
  const doc = root.ownerDocument || document
  let anchor = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
  if (!anchor || !root.contains(anchor)) anchor = root

  /* The line the caret is on: the ancestor whose parent is the root or a
     column body (a block inserted inside a column stays in that column). */
  const container = (anchor.nodeType === 1 ? anchor : anchor.parentElement)
    ?.closest?.('[data-type="col"]') || root
  let line = anchor
  while (line && line.parentNode !== container && line !== container) line = line.parentNode
  if (!line || line === container) line = null

  const after = doc.createElement('div'); after.innerHTML = '<br>'

  if (line && line.nodeType === 1 && isEmptyLine(line)) {
    line.replaceWith(node)
  } else if (line && line.nodeType === 1) {
    line.after(node)
  } else {
    /* The caret is on bare inline content directly in the container (a
       note that is only text, or only a <br>). Clear a lone <br>; otherwise
       add the block at the end of that run. */
    const onlyBr = Array.from(container.childNodes).every(n => n.nodeName === 'BR' || (n.nodeType === 3 && !n.textContent.trim()))
    if (onlyBr) container.innerHTML = ''
    const at = line && line.nodeType === 3 ? line : null
    if (at) at.after(node); else container.appendChild(node)
  }

  const next = node.nextElementSibling
  if (!next || !isEmptyLine(next)) node.after(after)
  return node
}

/** Build an element from an HTML string (one root element). */
export function elementFrom(html, doc = document) {
  const t = doc.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}
