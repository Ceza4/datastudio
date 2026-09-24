/*
  lib/checklist.js
  --------------------------------------------------------------------------
  The Notes checklist item and its repair pass. 24 Sep 2026.

  <div data-type="checklist"><input type="checkbox" contenteditable="false"><span>text</span></div>

  WHY A REPAIR PASS (reproduced in Chromium before fixing)
  contentEditable does not know this is one unit. Two ordinary edits broke it:

    · Select the whole item and press Backspace. The browser removes the
      checkbox and the span and leaves the wrapper: an empty
      <div data-type="checklist" style="display:flex"> with nothing in it.
      Zero height, no text position, so the caret cannot enter it, clicking
      there does nothing, and anything inserted "on that line" (a divider)
      lands next to it instead of in it.
    · Triple-click the item and press Backspace. The browser merges the NEXT
      line into the item's span, and a divider inserted afterwards lands
      inside the flex row, beside the checkbox.

  So after every input each item is put back into its one legal shape: a
  checkbox, then one span. An item missing either becomes a plain paragraph
  holding whatever text it had. Block content (a rule, a list, another
  paragraph) that ended up inside an item moves out to just after it.
  -------------------------------------------------------------------------- */

export const CHECKLIST_HTML =
  '<div data-type="checklist" style="display:flex;align-items:flex-start;gap:8px;padding:3px 0;">' +
  '<input type="checkbox" style="margin-top:5px;cursor:pointer;width:15px;height:15px;flex-shrink:0;" contenteditable="false">' +
  /* <br>, not empty: an empty span has no line box in Chrome, so the caret
     cannot be put in it and seems to vanish. */
  '<span style="flex:1;min-height:1em;outline:none;"><br></span></div>'

const BLOCK_TAGS = new Set(['DIV', 'P', 'HR', 'PRE', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

function toParagraph(doc, nodes) {
  const p = doc.createElement('div')
  for (const n of nodes) p.appendChild(n)
  if (!p.textContent.trim() && !p.querySelector('img')) p.innerHTML = '<br>'
  return p
}

/** Returns true if anything changed. Keeps the caret where it was when the
 *  node it sat in survives, and puts it in the replacement otherwise. */
export function normalizeChecklists(root) {
  if (!root?.querySelectorAll) return false
  const doc = root.ownerDocument || document
  const sel = doc.getSelection?.()
  let changed = false

  for (const item of Array.from(root.querySelectorAll('[data-type="checklist"]'))) {
    if (!item.isConnected) continue
    /* Where the caret was. After a whole-item delete Chrome parks it at the
       start of the NEXT line, not in the dead wrapper, so that counts too:
       the caret belongs on the line that was just emptied. */
    const next = item.nextElementSibling
    const atNextStart = !!(sel?.rangeCount && next && next.contains(sel.anchorNode) && (() => {
      const r = doc.createRange(); r.setStart(next, 0)
      try { r.setEnd(sel.anchorNode, sel.anchorOffset) } catch { return false }
      return r.toString().length === 0
    })())
    const hadCaret = !!(sel?.rangeCount && item.contains(sel.anchorNode))
    const input = item.querySelector(':scope > input[type="checkbox"]')
    const spans = Array.from(item.querySelectorAll(':scope > span'))

    /* Checkbox there but the text span gone (Chrome drops an empty span):
       give it a new one rather than dissolving a perfectly good item. */
    if (input && !spans.length) {
      const sp = doc.createElement('span')
      sp.setAttribute('style', 'flex:1;min-height:1em;outline:none;')
      for (const n of Array.from(item.childNodes)) if (n !== input) sp.appendChild(n)
      if (!sp.firstChild) sp.innerHTML = '<br>'
      item.appendChild(sp)
      spans.push(sp)
      changed = true
    }
    /* No checkbox: it is not an item any more. Becomes a paragraph with its
       text. */
    if (!input) {
      const keep = Array.from(item.childNodes).filter(n => !(n.nodeType === 1 && n.tagName === 'INPUT'))
      const flat = []
      for (const n of keep) {
        if (n.nodeType === 1 && n.tagName === 'SPAN') flat.push(...Array.from(n.childNodes))
        else flat.push(n)
      }
      const outside = flat.filter(n => n.nodeType === 1 && BLOCK_TAGS.has(n.tagName))
      const inline = flat.filter(n => !outside.includes(n))
      const p = toParagraph(doc, inline)
      item.replaceWith(p)
      let at = p
      for (const b of outside) { at.after(b); at = b }
      if ((hadCaret || (atNextStart && !p.textContent.trim())) && sel) { const r = doc.createRange(); r.selectNodeContents(p); r.collapse(false); sel.removeAllRanges(); sel.addRange(r) }
      changed = true
      continue
    }

    const span = spans[0]
    /* Block-level content inside the item (in the span or beside it) moves
       out, in order, to just after the item. So does any second span: that
       is a line the browser merged in, and it becomes its own paragraph. */
    const movers = []
    for (const n of Array.from(item.childNodes)) {
      if (n === input || n === span) continue
      if (n.nodeType === 3 && !n.textContent.trim()) { n.remove(); changed = true; continue }
      if (n.nodeType === 3 || (n.nodeType === 1 && !BLOCK_TAGS.has(n.tagName) && n.tagName !== 'SPAN')) {
        /* Stray inline content beside the span belongs in the span. */
        span.appendChild(n); changed = true; continue
      }
      movers.push(n.tagName === 'SPAN' ? toParagraph(doc, Array.from(n.childNodes)) : n)
      if (n.tagName === 'SPAN') n.remove()
    }
    for (const n of Array.from(span.childNodes)) {
      if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) movers.push(n)
    }
    if (movers.length) {
      let at = item
      for (const m of movers) { at.after(m); at = m }
      changed = true
    }
    if (input !== item.firstChild) { item.insertBefore(input, item.firstChild); changed = true }
    if (!span.firstChild) { span.innerHTML = '<br>'; changed = true }
  }
  return changed
}

/** Put the caret at the start of the item's text. */
export function caretIntoChecklist(item, sel) {
  const span = item?.querySelector(':scope > span')
  if (!span || !sel) return
  const doc = item.ownerDocument || document
  const r = doc.createRange()
  r.selectNodeContents(span)
  r.collapse(true)
  sel.removeAllRanges(); sel.addRange(r)
}
