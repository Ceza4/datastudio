/*
  lib/doctabs.js
  --------------------------------------------------------------------------
  TAB STOPS, the Word way.

  A tab in the text is an atom, <span data-ds-tab contenteditable="false">
  holding a real tab character (so copied text keeps it). Its WIDTH is layout:
  before pagination, each tab is stretched to reach the next stop —

    · the paragraph's own stops, set on the ruler and stored on the paragraph
      as data-ds-tabs="1.5:l,3:c,5.75:r" (inches from the left margin);
    · past the last one, Word's default stops every 0.5″.

  Left stops start the text there, right stops end it there, centre stops
  centre it there (the text measured up to the next tab or the line's end).
  Widths never reach storage: a saved tab is width-less and is laid out
  again on load.
  -------------------------------------------------------------------------- */

export const TAB_HTML = '<span data-ds-tab="1" contenteditable="false">\t</span>'
export const DEFAULT_STEP_IN = 0.5
export const TAB_KINDS = [
  { id: 'l', label: 'Left tab', glyph: '⌞' },
  { id: 'c', label: 'Centre tab', glyph: '⊥' },
  { id: 'r', label: 'Right tab', glyph: '⌟' },
]

/** "1.5:l,3:c" → [{ at: 1.5, kind: 'l' }, …], sorted. */
export function parseStops(s) {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const [a, k] = x.split(':')
    return { at: Math.round(Number(a) * 100) / 100, kind: ['l', 'c', 'r'].includes(k) ? k : 'l' }
  }).filter(x => Number.isFinite(x.at) && x.at > 0).sort((a, b) => a.at - b.at)
}

export function formatStops(list) {
  const seen = new Set()
  return list.filter(x => x.at > 0).sort((a, b) => a.at - b.at)
    .filter(x => { const k = x.at.toFixed(2); if (seen.has(k)) return false; seen.add(k); return true })
    .map(x => `${Math.round(x.at * 100) / 100}:${x.kind}`).join(',')
}

/** The next stop after position x (inches), stops first, then defaults. */
export function nextStop(x, stops, step = DEFAULT_STEP_IN) {
  const s = stops.find(st => st.at > x + 0.01)
  if (s) return s
  return { at: (Math.floor(x / step + 1e-6) + 1) * step, kind: 'l', dflt: true }
}

/**
 * Stretch every tab to its stop. Reads and writes alternate per tab (each
 * width moves the text after it), so this is linear in the number of tabs.
 * @param {HTMLElement} root  the editor
 * @param {number} contentLeft  px from the editor's left edge to the margin
 */
export function layoutTabs(root, contentLeft) {
  const tabs = root ? [...root.querySelectorAll('[data-ds-tab]')] : []
  if (!tabs.length) return 0
  const PX = 96
  const r0 = root.getBoundingClientRect()
  const s = root.offsetWidth ? r0.width / root.offsetWidth : 1
  tabs.forEach(t => { t.style.width = '0px' })
  const leftOf = el => {
    let x = 0, n = el
    while (n && n !== root) { x += n.offsetLeft; n = n.offsetParent }
    return x
  }
  const rg = document.createRange()
  for (const t of tabs) {
    const para = t.closest('p,li,h1,h2,h3,h4,h5,h6,div,td,th,blockquote') || root
    const stops = parseStops(para.getAttribute?.('data-ds-tabs'))
    const x = (leftOf(t) - contentLeft) / PX
    const stop = nextStop(x, stops)
    let w = (stop.at - x) * PX
    if (stop.kind !== 'l') {
      /* The text this tab positions: up to the next tab or the paragraph's end. */
      rg.setStartAfter(t)
      const nextTab = tabs.find(o => o !== t && para.contains(o) && (t.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING))
      if (nextTab) rg.setEndBefore(nextTab); else rg.setEnd(para, para.childNodes.length)
      const tw = rg.getBoundingClientRect().width / s
      w -= stop.kind === 'r' ? tw : tw / 2
      if (w < 2) {
        const d = nextStop(x, [])
        w = (d.at - x) * PX
      }
    }
    t.style.width = Math.max(2, Math.round(w * 10) / 10) + 'px'
  }
  return tabs.length
}

/** Strip layout widths from a clone before saving. */
export function stripTabWidths(root) {
  root?.querySelectorAll?.('[data-ds-tab]').forEach(t => { t.style.removeProperty('width'); if (!t.getAttribute('style')) t.removeAttribute('style') })
}
