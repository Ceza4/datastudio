/*
  lib/highlight.js
  --------------------------------------------------------------------------
  The Notes highlighter: a marker pen for text, toggled on the selection.

  STORAGE IS THE DOCUMENT BLOCK'S, ON PURPOSE
  A highlight is a span with an inline `background-color`, using the exact
  hex values the Document ribbon already writes (its HIGHLIGHTS table). So a
  highlighted line copied from a Document into Notes, or the other way round,
  is still a highlight in the colour it was, and every exporter that already
  understands an inline background understands this. A second markup for the
  same idea (a <mark data-hl> of our own) would have meant two formats that
  look identical and behave differently on paste.

  DISPLAY IS THE THEME'S
  Those hex values are pastels chosen for a white page. On the dark canvas a
  #FFF176 band under light text is unreadable. The stored value is therefore
  only an IDENTITY: the Notes stylesheet (TextBlockContent's scopedStyles)
  matches each known value and repaints it with a --ds-hl-* token, translucent
  and tuned per theme, with !important — the same render-time override the
  checklist accent already uses, and for the same reason: it beats an inline
  style without migrating anyone's stored notes. A background that is not one
  of ours (pasted from a web page) is left exactly as it came.

  WRITTEN BY execCommand('hiliteColor')
  So it is on the browser's undo stack — see toggleHighlight. hiliteColor
  cannot take a theme variable, which is exactly why the stored value is an
  identity and the stylesheet does the painting.
  -------------------------------------------------------------------------- */

/* The Document ribbon's first four, by value. Names match it too, so the
   same colour is called the same thing on both surfaces. */
export const NOTE_HIGHLIGHTS = Object.freeze([
  { id: 'yellow', name: 'Yellow', value: '#FFF176' },
  { id: 'green',  name: 'Green',  value: '#B9F6CA' },
  { id: 'cyan',   name: 'Cyan',   value: '#B3E5FC' },
  { id: 'pink',   name: 'Pink',   value: '#F8BBD0' },
])

/* Every stored value the Notes stylesheet knows how to repaint: the four
   above plus the Document's other two, which arrive by paste. */
export const KNOWN_HIGHLIGHTS = Object.freeze([
  ...NOTE_HIGHLIGHTS,
  { id: 'orange', name: 'Orange', value: '#FFD180' },
  { id: 'grey',   name: 'Grey',   value: '#E0E0E0' },
])

/** '#FFF176' → '255, 241, 118' — the form a browser serialises it in. */
export function rgbTriplet(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim())
  if (!m) return null
  return [m[1], m[2], m[3]].map(h => parseInt(h, 16)).join(', ')
}

/** Any CSS colour string a browser or the sanitiser produces → '#rrggbb'
 *  (lower-case), or null for transparent / unparseable. */
export function normColor(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v || v === 'transparent' || v === 'initial' || v === 'inherit') return null
  let m = /^#([0-9a-f]{6})$/.exec(v)
  if (m) return '#' + m[1]
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (m) return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v)
  if (m) {
    if (m[4] != null && Number(m[4]) === 0) return null
    return '#' + [m[1], m[2], m[3]].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
  }
  return null
}

export const sameColor = (a, b) => {
  const x = normColor(a)
  return !!x && x === normColor(b)
}

/**
 * The CSS that repaints stored highlights for the canvas.
 *
 * Generated rather than hand-typed so the list of values it matches can never
 * drift from KNOWN_HIGHLIGHTS. Each value is matched in both spellings it can
 * be stored in: the browser's `rgb(r, g, b)` and a raw hex (paste, import).
 * The `background-color` half of each selector is what keeps a TEXT colour
 * that happened to share a value from being treated as a highlight.
 */
export function highlightCss(scope = '[data-ds-text]') {
  const rules = KNOWN_HIGHLIGHTS.map(h => {
    const sel = [
      `${scope} [style*="background-color"][style*="${rgbTriplet(h.value)}"]`,
      `${scope} [style*="background-color"][style*="${h.value}" i]`,
    ].join(',\n    ')
    return `${sel} { background-color: var(--ds-hl-${h.id}) !important; }`
  })
  /* A pasted <mark> with no colour of its own: the browser's default is a
     saturated #ff0 that ignores the theme. It is the yellow highlighter. */
  rules.push(`${scope} mark { background-color: var(--ds-hl-yellow); color: inherit; }`)
  /* Rounded ends and no gap where a highlight wraps onto the next line. */
  rules.push(`${scope} [style*="background-color"], ${scope} mark { border-radius: 2px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }`)
  return rules.join('\n    ')
}

/* ── last-used colour ─────────────────────────────────────────────────────
   The split button's one-click half and Ctrl+Shift+H both apply this. It is
   a per-person habit, not workspace data, so it lives in localStorage rather
   than in prefs (which travel with the workspace to whoever opens it). */
const LAST_KEY = 'datastudio-last-highlight'
let lastMem = null
export function lastHighlight() {
  if (lastMem) return lastMem
  try {
    const v = localStorage.getItem(LAST_KEY)
    if (NOTE_HIGHLIGHTS.some(h => h.value === v)) lastMem = v
  } catch { /* private mode: fall through to the default */ }
  return lastMem || NOTE_HIGHLIGHTS[0].value
}
export function setLastHighlight(value) {
  if (!NOTE_HIGHLIGHTS.some(h => h.value === value)) return
  lastMem = value
  try { localStorage.setItem(LAST_KEY, value) } catch { /* ignore */ }
}

/* ── the DOM half ─────────────────────────────────────────────────────── */

/* Inline elements a highlight can sit on. The walk up from a text node stops
   at the first thing that is not one of these — a paragraph with a background
   is not a highlight. */
const INLINE = /^(SPAN|MARK|B|STRONG|I|EM|U|S|STRIKE|DEL|INS|SUB|SUP|SMALL|FONT|A)$/

/** The background an element itself paints as a highlight, or null. */
function ownHighlight(el) {
  if (el.tagName === 'MARK') return normColor(el.style?.backgroundColor) || '#fff176'
  return normColor(el.style?.backgroundColor)
}

/** Innermost highlighting ancestor of `node` below `root`, or null. */
function highlightAncestor(node, root) {
  let el = node.nodeType === 3 ? node.parentElement : node
  while (el && el !== root && INLINE.test(el.tagName)) {
    if (ownHighlight(el)) return el
    el = el.parentElement
  }
  return null
}

/* Text a highlight must not touch. A code block re-renders its own text on
   every keystroke (lib/codeblock.js) and would drop the spans anyway. */
const inCode = n => !!(n.nodeType === 3 ? n.parentElement : n)?.closest?.('[data-type="code"], pre')

/** Read-only: which highlight the selected text carries.
 *  @returns {'#rrggbb'|null|'mixed'} the colour if every selected character
 *  has the same one, null if none of it is highlighted, 'mixed' otherwise. */
export function selectionHighlight(root, r) {
  if (!root || !r || r.collapsed) return null
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let seen, n
  while ((n = w.nextNode())) {
    if (!n.length || !r.intersectsNode(n) || inCode(n)) continue
    /* Judge only the SELECTED part. A double-click selects "lazy " — the
       word plus the space after it, which lies in the next, unhighlighted
       text node; that space must not make the word read as "mixed", or
       pressing the pen again would re-apply instead of lifting it off. */
    const s = n === r.startContainer ? r.startOffset : 0
    const e = n === r.endContainer ? r.endOffset : n.length
    if (s >= e || !n.data.slice(s, e).trim()) continue
    const h = highlightAncestor(n, root)
    const c = h ? ownHighlight(h) : null
    if (seen === undefined) seen = c
    else if (seen !== c) return 'mixed'
  }
  return seen === undefined ? null : seen
}

/* A double-click on Windows selects the word AND its trailing space, and a
   highlight that runs on into the gap after a word looks like a mistake. Word
   trims it the same way. Only the two ends move; a space between highlighted
   words stays highlighted. Returns a new Range, or the same one. */
function trimRange(r) {
  const t = r.cloneRange()
  const sc = t.startContainer, ec = t.endContainer
  if (sc.nodeType === 3) {
    let i = t.startOffset
    while (i < sc.length && /\s/.test(sc.data[i]) && !(sc === ec && i >= t.endOffset)) i++
    if (i < sc.length && !(sc === ec && i >= t.endOffset)) t.setStart(sc, i)
  }
  if (ec.nodeType === 3) {
    let j = t.endOffset
    while (j > 0 && /\s/.test(ec.data[j - 1]) && !(sc === ec && j <= t.startOffset)) j--
    if (j > 0 && !(t.startContainer === ec && j <= t.startOffset)) t.setEnd(ec, j)
  }
  return t.collapsed ? r : t
}

/**
 * Highlight the selection in `color`, or remove it when every selected
 * character already has exactly that colour (a toggle — the marker pen run
 * over the same words again). `color` null always removes.
 *
 * Goes through execCommand('hiliteColor'), so the change is ONE entry on the
 * browser's own undo stack: Ctrl+Z inside the note takes the highlight off,
 * as it takes off bold. Chrome does the hard part correctly — recolouring
 * or clearing the middle of a highlighted run splits the run around it and
 * leaves no empty spans behind — and fires 'input', which is the path every
 * save already takes. (A first version did this as DOM surgery, the way the
 * Document ribbon applies its character styles; it worked until Ctrl+Z, which
 * then undid an unrelated earlier edit, because the browser's undo stack had
 * never seen the highlight.)
 *
 * @returns {'on'|'off'|null} what happened, or null for no usable selection.
 */
export function toggleHighlight(root, color, r) {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  r = r || (sel?.rangeCount ? sel.getRangeAt(0) : null)
  if (!root || !sel || !r || r.collapsed || !root.contains(r.commonAncestorContainer)) return null
  if (inCode(r.commonAncestorContainer)) return null

  const current = selectionHighlight(root, r)
  const want = color && !(current && current !== 'mixed' && sameColor(current, color)) ? color : null
  const target = want ? trimRange(r) : r

  /* Focus first, then the range — a range set into an unfocused element is
     not a selection execCommand will act on (same order as commitLink). */
  if (document.activeElement !== root && !root.contains(document.activeElement)) root.focus({ preventScroll: true })
  sel.removeAllRanges()
  sel.addRange(target)

  /* A pasted <mark> paints from the UA stylesheet, not an inline style, so
     hiliteColor cannot clear it. Unwrapping is the one DOM edit here; it only
     ever happens to markup that came from somewhere else. */
  if (!want) {
    root.querySelectorAll('mark').forEach(m => { if (target.intersectsNode(m)) m.replaceWith(...m.childNodes) })
  }

  document.execCommand('hiliteColor', false, want || 'transparent')
  return want ? 'on' : 'off'
}
