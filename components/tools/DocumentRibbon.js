'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { Z, SWATCHES, INK_SWATCH } from '../../lib/theme'
import {
  PAGE_SIZES, PAGE_SIZE_IDS, MARGIN_PRESETS, MARGIN_STEP,
  DOC_FONTS, FONT_SIZES, LINE_SPACINGS,
  marginPresetFor, normalizeMargin, pageInches,
} from '../../lib/pagesetup'
import { columnsHtml, columnsFromNodes, nodesInRange } from '../../lib/columns'
import {
  applyInlineStyle, applyParagraphStyle, indentParagraphs, caretElement, rangeIn, setRange,
  tableHtml, imageFileToDataUrl, PT_TO_PX, PAGE_BREAK_HTML,
} from '../../lib/docedit'
import { useToast } from '../ui/Toast'
import { docApi, runDoc, subscribeDoc } from '../../lib/docbridge'
import { CASES, BULLET_STYLES, NUMBER_STYLES, SYMBOLS, MATH_SYMBOLS, dateFormats } from '../../lib/docformat'
import { CITE_STYLES } from '../../lib/doccite'

const COLUMN_COUNTS = [2, 3, 4, 5]

/*
  components/tools/DocumentRibbon.js
  --------------------------------------------------------------------------
  THE WORD RIBBON, rebuilt in DataStudio's tokens.

  ── WHY A RIBBON AND NOT A SELECTION-ANCHORED PILL ─────────────────────────

  A first version of this WAS a selection-anchored toolbar with an
  expand-to-clusters popover, matching Notes exactly. Matas saw it built and
  asked to reverse it: he wants the literal Word ribbon — tabs, pinned to the
  block, not following the selection — plus a ruler. A genuine change of mind,
  not a reaction to something broken.

  SCOPED TO DOCUMENT ONLY, confirmed. Notes keeps its selection-anchored pill
  (TextBlockToolbar v4) and is not touched. Two blocks are allowed to have
  different toolbar interaction models: Notes is quick capture where chrome
  should get out of the way, a Document is a writing session where the controls
  being in the same place every time is worth the vertical space.

  ── THIS IS THE EXISTING RAIL MECHANISM, NOT A NEW ONE ─────────────────────

  blockRegistry.js's `rail` field already means "a contextual toolbar tied to a
  block type, shown while that block is selected" — pdf, calendar, sheet and
  image all use it. `document` declares `rail: 'document'` and this component is
  that rail's UI. Nothing new for the codebase to carry; it just happens to be a
  much bigger rail than PdfToolbar.

  ── ONE SOURCE OF TRUTH, EVERY TIME ────────────────────────────────────────

  The Margins dropdown, the Custom Margins dialog and the ruler's draggable
  markers all read and write `block.margins`. Not a preset id plus a copy of the
  numbers — the preset LABEL is derived from the numbers by marginPresetFor(), so
  typing Normal's values into the dialog reads as Normal again instead of staying
  stuck on "Custom". Same discipline SharePanel.js applies to visibility: one
  value, several ways to change it, never a flag beside a list that can drift.

  ── WHAT IS DELIBERATELY NOT COPIED FROM WORD ──────────────────────────────

  The zoom-percentage slider in Word's status bar. It scales the PAGE
  independently of everything else — and on an infinite canvas "how big does
  this block look" is already answered by the canvas's own zoom (0.25×–3×). A
  second, differently-scoped zoom on the same block creates a real question a
  user would have to learn the answer to (which one does pinch drive?), for a
  feature whose value here is much less obvious than in a fixed desktop window.
  "Word has one" is not sufficient justification for a control that undermines
  the thing the page-guide design works hard to keep unambiguous. Say so if
  there is a concrete use case; it is a recommendation, not a refusal.
  -------------------------------------------------------------------------- */

const TABS = [
  { id: 'file',   label: 'File' },
  { id: 'home',   label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'layout', label: 'Layout' },
  { id: 'refs',   label: 'References' },
  { id: 'review', label: 'Review' },
  { id: 'view',   label: 'View' },
]

/* Word's style gallery, previewed at each style's own look (scaled so the
   gallery row keeps one height). */
const STYLE_LIST = [
  { id: 'normal',   label: 'Normal',    size: 12, weight: 400, hint: 'Ctrl+Alt+0' },
  { id: 'title',    label: 'Title',     size: 16, weight: 300 },
  { id: 'subtitle', label: 'Subtitle',  size: 12, weight: 400, mute: true },
  { id: 'h1',       label: 'Heading 1', size: 14, weight: 600, head: true, hint: 'Ctrl+Alt+1' },
  { id: 'h2',       label: 'Heading 2', size: 13, weight: 600, head: true, hint: 'Ctrl+Alt+2' },
  { id: 'h3',       label: 'Heading 3', size: 12, weight: 600, head: true, hint: 'Ctrl+Alt+3' },
  { id: 'h4',       label: 'Heading 4', size: 12, weight: 600, italic: true, head: true },
  { id: 'quote',    label: 'Quote',     size: 12, weight: 400, italic: true },
]
const HIGHLIGHTS = [
  { name: 'Yellow', value: '#FFF176' }, { name: 'Green', value: '#B9F6CA' }, { name: 'Cyan', value: '#B3E5FC' },
  { name: 'Pink', value: '#F8BBD0' }, { name: 'Orange', value: '#FFD180' }, { name: 'Grey', value: '#E0E0E0' },
]

const COLOR_OPTIONS = [INK_SWATCH, ...SWATCHES]

/* ── pressProps ───────────────────────────────────────────────────────────
   Every control in this ribbon fires on MOUSEDOWN + preventDefault, and has
   to: execCommand acts on the document's selection, and letting the browser
   process a real click collapses that selection to the press point before the
   command can run. That is correct — and it is also why not one of these
   buttons worked from the keyboard.

   Keyboard activation arrives as a CLICK, never a mousedown: Enter or Space on
   a focused <button>, and the el.click() the canvas dispatches in toolbar mode
   (NotebookCanvas.js, kbMode === 'toolbar'). So every button here was
   focusable, announced, and inert — the ribbon was reachable by keyboard and
   could not be operated by one.

   Both paths, one handler, with a guard below so a real press cannot fire it
   twice.

   The selection survives the keyboard path too — exec() calls
   restoreDocSelection() first, which re-focuses the document host and puts the
   saved range back when focus has moved onto a button. */
let lastRibbonPress = 0

function pressProps(fn, disabled) {
  return {
    onMouseDown: e => {
      e.preventDefault()
      lastRibbonPress = e.timeStamp
      if (!disabled) fn(e)
    },
    onClick: e => {
      if (disabled) return
      /* Two ways to tell a click that FOLLOWS a press we already handled from
         one that stands alone. `detail` carries the click count on a real
         mouse press and 0 on a keyboard or programmatic one — but touch
         synthesises a click that reports 0 in some engines, and mousedown's
         preventDefault does not suppress it. So a recent press anywhere in the
         ribbon vetoes the click as well. A keyboard user has not just pressed
         a mouse button; a double-firing toolbar is the failure that matters. */
      if (e.detail > 0) return
      if (e.timeStamp - lastRibbonPress < 500) return
      fn(e)
    },
  }
}

/* ── Small shared pieces ──────────────────────────────────────────────── */

/* A pressed-state button, which is what every toggle in this ribbon is.

   NOT an <input type=checkbox>, including in the View tab. A literal checkbox
   reads as a settings form, not as ribbon chrome, and it would be inconsistent
   with Bold, the alignment buttons and orientation — all of which are already
   pressed-state buttons. A filled background plus a small on/off dot says the
   same thing in the ribbon's own vocabulary. */
function RibbonBtn({ on, onClick, title, label, icon, wide, disabled, dot, children }) {
  return (
    <button
      type="button"
      /* Mouse fires on mousedown so the document's selection survives the
         press; keyboard and toolbar-mode activation come through as a click.
         See pressProps above — it is the same reason TextBlockToolbar uses
         mousedown, plus the keyboard half that was missing. */
      {...pressProps(e => onClick?.(e), disabled)}
      title={title}
      aria-label={title}
      aria-pressed={on === undefined ? undefined : !!on}
      disabled={disabled}
      className={`ds-doc-btn${on ? ' is-on' : ''}`}
      style={{
        height: 26,
        minWidth: wide ? undefined : 26,
        padding: wide ? '0 8px' : 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        border: '1px solid transparent',
        borderRadius: 'var(--ds-radius-xs)',
        background: on ? 'var(--ds-accent-dim)' : 'transparent',
        /* A `dot` button is a SETTING (the View tab), not a formatting mark, so
           its off state has to keep an outline. With a transparent border it
           rendered as bare text sitting between two filled chips, and "Ruler"
           — the one you actually want to switch on — was the one that did not
           look like a control at all. Formatting marks keep the borderless off
           state: twelve outlined boxes in a row is a worse toolbar. */
        borderColor: on ? 'var(--ds-accent)' : dot ? 'var(--ds-border)' : 'transparent',
        color: on ? 'var(--ds-accent)' : 'var(--ds-text-2)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.38 : 1,
        fontFamily: 'var(--ds-font-body)', fontSize: 12, lineHeight: 1,
        flexShrink: 0,
        transition: 'background var(--ds-motion-hover) var(--ds-ease-standard), color var(--ds-motion-hover) var(--ds-ease-standard), border-color var(--ds-motion-hover) var(--ds-ease-standard)',
      }}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {label && <span>{label}</span>}
      {/* The on/off dot. Only on the View tab's toggles, where the state is a
          setting rather than a formatting mark and the fill alone reads as
          "currently selected" rather than "currently on". */}
      {dot && (
        <span aria-hidden="true" style={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
          background: on ? 'var(--ds-accent)' : 'var(--ds-text-3)',
          opacity: on ? 1 : 0.5,
        }} />
      )}
    </button>
  )
}

/* A labelled group inside a band, with Word's caption along the bottom and its
   dialog-launcher arrow when there is a fuller dialog behind it. */
/* ── Pop ──────────────────────────────────────────────────────────────────
   Every dropdown in this band has to LEAVE the band to be seen.

   The band is `overflow-x: auto` so it can scroll horizontally, and CSS will
   not let the other axis stay visible: `overflow-y: visible` beside a
   non-visible overflow-x computes to `auto`. The band is 56px tall. So the
   font list — 15 entries, 300px — rendered `position: absolute` inside it had
   **282px clipped**, and what you saw was the top 18px of a list that looked
   empty. It was never empty. Same for size, colour, line spacing, columns,
   margins and page size: all seven.

   Portalled to <body> and positioned `fixed` from the trigger's own rect.
   That escapes the band's clipping AND the canvas's CSS transform, which is
   the same reason MarginDialog is portalled — a fixed element inside a
   transformed ancestor positions against the transform, not the viewport.

   It anchors off its own parentElement, so a call site only wraps its content
   and passes no coordinates: the wrapper it already sat in IS the anchor. */
function Pop({ style, children }) {
  const mark = useRef(null)
  const [box, setBox] = useState(null)

  useLayoutEffect(() => {
    const anchor = mark.current?.parentElement
    if (!anchor || typeof window === 'undefined') return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - 14
      const above = r.top - 14
      /* Flip up when the trigger is near the bottom of the window. A ribbon
         pinned to a block low on the canvas is exactly where this happens. */
      const up = below < 200 && above > below
      const w = style?.minWidth || 170
      setBox({
        left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
        top: up ? undefined : Math.round(r.bottom + 5),
        bottom: up ? Math.round(window.innerHeight - r.top + 5) : undefined,
        maxHeight: Math.max(140, Math.round(up ? above : below)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [style?.minWidth])

  return (
    <>
      <span ref={mark} style={{ display: 'none' }} />
      {box && typeof document !== 'undefined' && createPortal(
        <div
          data-ds-ribbon-pop
          onMouseDown={e => e.stopPropagation()}
          style={{
            ...style,
            position: 'fixed', zIndex: Z.popover,
            left: box.left, top: box.top, bottom: box.bottom,
            maxHeight: box.maxHeight, overflowY: 'auto',
          }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}

const MIN_MARGIN = 0.25

/** What the ribbon shows for the caret: font, size (pt), line spacing,
 *  alignment, paragraph style and the pressed character formats. */
function readCaret(root, r) {
  const el = caretElement(root, r)
  if (!el) return null
  const cs = getComputedStyle(el)
  const fam = cs.fontFamily.split(',').map(f => f.trim().replace(/^["']|["']$/g, ''))
  const font = (DOC_FONTS.find(f => fam[0] === f.name) || DOC_FONTS.find(f => fam.some(x => x.toLowerCase().includes(f.name.toLowerCase()))) || DOC_FONTS[0]).name
  const size = Math.round((parseFloat(cs.fontSize) / PT_TO_PX) * 2) / 2
  const para = el.closest('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre') || el
  const pcs = getComputedStyle(para)
  const lh = parseFloat(pcs.lineHeight) / parseFloat(pcs.fontSize)
  const spacing = LINE_SPACINGS.reduce((best, s) => (Math.abs(s.id - lh) < Math.abs(best - lh) ? s.id : best), LINE_SPACINGS[0].id)
  const a = pcs.textAlign
  const q = c => { try { return document.queryCommandState(c) } catch { return false } }
  return {
    font, size, spacing: Number.isFinite(lh) ? spacing : null,
    align: a === 'start' || a === 'left' ? 'left' : a === 'end' ? 'right' : a,
    block: para.tagName.toLowerCase(),
    style: para.getAttribute?.('data-ds-style') || null,
    bold: q('bold'), italic: q('italic'),
    /* A tracked insertion is drawn underlined; that is markup, not a format. */
    underline: q('underline') && (!el.closest('ins[data-ds-uid]') || !!el.closest('u')),
    strike: q('strikeThrough') && (!el.closest('del[data-ds-uid]') || !!el.closest('s,strike')),
  }
}

/* Hover to size, click to insert — Word's grid. */
function TablePicker({ colors, onPick }) {
  const [at, setAt] = useState({ r: 0, c: 0 })
  const { border, accent, text2, base } = colors
  return (
    <div onMouseLeave={() => setAt({ r: 0, c: 0 })}>
      <div style={{ fontSize: 12, color: text2, fontFamily: 'var(--ds-font-body)', padding: '0 2px 6px' }}>
        {at.r ? `Table ${at.c} × ${at.r}` : 'Insert table'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 16px)', gap: 3 }}>
        {Array.from({ length: 48 }, (_, i) => {
          const r = Math.floor(i / 8) + 1, c = (i % 8) + 1
          const on = r <= at.r && c <= at.c
          return (
            <button key={i} type="button" aria-label={`${c} by ${r} table`}
              onMouseEnter={() => setAt({ r, c })} onFocus={() => setAt({ r, c })}
              {...pressProps(() => onPick(r, c))}
              style={{ width: 16, height: 16, padding: 0, borderRadius: 4, cursor: 'pointer', border: `1px solid ${on ? accent : border}`, background: on ? `${accent}33` : base }} />
          )
        })}
      </div>
    </div>
  )
}

/** The [data-ds-doc] element a range sits inside, or null. */
function docRootOf(range) {
  const node = range?.commonAncestorContainer
  const el = node?.nodeType === 1 ? node : node?.parentElement
  return el?.closest?.('[data-ds-doc]') || null
}

function Group({ label, launcher, onLaunch, children }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '0 9px', flexShrink: 0,
      borderRight: '1px solid var(--ds-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 26 }}>
        {children}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontFamily: 'var(--ds-font-body)',
        color: 'var(--ds-text-3)',
      }}>
        <span>{label}</span>
        {launcher && (
          /* Word's own signal that a fuller dialog exists behind a group's
             quick controls. Harmless as a static affordance until the Font and
             Paragraph dialogs are built; wired to open them when they are. */
          <button
            type="button"
            {...pressProps(() => onLaunch?.())}
            title={`${label} options`}
            aria-label={`${label} options`}
            style={{
              width: 20, height: 18, margin: '-4px -4px -4px 0', padding: 0, border: 'none', background: 'none',
              borderRadius: 4, color: 'var(--ds-text-3)', cursor: 'pointer', lineHeight: 1, fontSize: 11,
            }}>
            ↘
          </button>
        )}
      </div>
    </div>
  )
}

function Sep() {
  return <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--ds-border)', margin: '0 3px', flexShrink: 0 }} />
}

/* Three bars, whose widths and alignment differ per mode. currentColor so it
   picks up the button's pressed/hover state like a real icon would. */
const ALIGN_ROWS = {
  left:    [100, 62, 84],
  center:  [100, 62, 84],
  right:   [100, 62, 84],
  justify: [100, 100, 100],
}
function AlignGlyph({ mode }) {
  const items = ALIGN_ROWS[mode] || ALIGN_ROWS.left
  const align = mode === 'center' ? 'center' : mode === 'right' ? 'flex-end' : 'stretch'
  return (
    <span aria-hidden="true" style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      width: 13, alignItems: align,
    }}>
      {items.map((w, i) => (
        <span key={i} style={{ width: `${w}%`, height: 1.5, background: 'currentColor', borderRadius: 4 }} />
      ))}
    </span>
  )
}

/* ── The ribbon ───────────────────────────────────────────────────────── */

export default function DocumentRibbon({ block, colors, onUpdateBlock, onInsert, onExport }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const [tab, setTab] = useState('home')
  const [menu, setMenu] = useState(null)      // 'font' | 'size' | 'color' | 'margins' | 'pagesize' | 'spacing'
  const [marginDialog, setMarginDialog] = useState(null)  // a draft {top,bottom,left,right}
  /* Word's one-click repeat-last-colour behaviour: the split button's main half
     applies this without opening anything. */
  const [lastColor, setLastColor] = useState(INK_SWATCH.value)
  /* Whether the document had a real (non-collapsed) text selection at the
     moment the Columns dropdown was opened — decides whether its "Turn
     into" rows render enabled. Captured on open rather than read live on
     every render: this ribbon has no ref to the document's own editable (see
     getDocRoot() below, which finds it from the live selection instead), so
     there's nothing to subscribe to for a reactive answer, and the dropdown
     is only ever open for the few seconds between one mousedown and the
     next — recomputing at open time is precise enough for that window. */
  const [colHasSelection, setColHasSelection] = useState(false)
  const toast = useToast()
  const imageInputRef = useRef(null)
  const [, bumpDoc] = useState(0)
  useEffect(() => subscribeDoc(block?.id, () => bumpDoc(t => t + 1)), [block?.id])
  const [lastHighlight, setLastHighlight] = useState(HIGHLIGHTS[0].value)
  /* What the caret is sitting in: the font, size, spacing and pressed states
     the ribbon shows. Word's font box shows the font UNDER THE CARET, not a
     document setting; so does this now. */
  const [caret, setCaret] = useState(null)
  const [sizeDraft, setSizeDraft] = useState(null)

  /* Band overflow. The band scrolls rather than wraps (see its own comment),
     and 227px of the Home tab — the entire STYLES group — used to sit behind a
     raw browser scrollbar with nothing saying it was there. Measuring the
     scroll position lets a fade appear on whichever side still has content. */
  const bandRef = useRef(null)
  /* One ref per tab, so the arrow keys can move focus as well as selection. */
  const tabRefs = useRef([])
  const scrollWrapRef = useRef(null)
  const [overflow, setOverflow] = useState('')
  /* THE HOME TAB ADAPTS TO THE BLOCK'S WIDTH (25 Sep 2026).
     At full width it needs 962px: Font 430, Paragraph 328, Styles 204. The
     block spawns at 720, so the default Document showed Home with its right
     third scrolled out of sight, which read as a clipped toolbar. Word's own
     answer is to collapse groups as the window narrows, rightmost first:
       · under 972px the Styles gallery becomes one "Styles" dropdown
       · under 852px alignment and indent fold into one "Align" dropdown
     Measured from the band's CONTAINER, whose width does not depend on what
     is inside it, so a collapse can never feed back into the measurement. */
  const [bandW, setBandW] = useState(9999)
  const compact = bandW < 852 ? 2 : bandW < 972 ? 1 : 0
  const measureOverflow = () => {
    const wrap = scrollWrapRef.current
    if (wrap && Math.abs(wrap.clientWidth - bandW) > 1) setBandW(wrap.clientWidth)
    const el = bandRef.current
    if (!el) return
    const start = el.scrollLeft > 2
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setOverflow(`${start ? 'start' : ''} ${end ? 'end' : ''}`.trim())
  }
  useEffect(() => {
    measureOverflow()
    const el = bandRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measureOverflow)
    ro.observe(el)
    if (scrollWrapRef.current) ro.observe(scrollWrapRef.current)
    return () => ro.disconnect()
  })

  /* The last selection range seen inside a document body. See the note on
     `exec` below for why this has to be remembered rather than read live. */
  const savedRange = useRef(null)
  const blockId = block?.id
  /* THIS block's document body. Several documents can be on one canvas, and
     a command must never land in the wrong one (the page-break bug: it used
     the first [data-ds-doc] on the page). */
  const hostOf = () => (typeof document === 'undefined' ? null
    : document.querySelector(`[data-block-id="${CSS.escape(blockId || '')}"] [data-ds-doc]`))
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      if (!sel?.rangeCount) return
      const r = sel.getRangeAt(0)
      const root = docRootOf(r)
      if (!root || root !== hostOf()) return
      savedRange.current = r.cloneRange()
      setCaret(readCaret(root, r))
      setSizeDraft(null)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [blockId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Which document body, if any, a range sits in. Module-level rather than a
     closure so both the listener above and `exec` below can use it. */
  const ref = useRef(null)

  useEffect(() => {
    function onDown(e) {
      /* A popover is portalled to <body>, so it is NOT inside ref.current any
         more — without this it would count as an outside click and close
         itself before the item under the cursor could act. */
      if (e.target?.closest?.('[data-ds-ribbon-pop]')) return
      if (ref.current && !ref.current.contains(e.target)) setMenu(null)
    }
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (marginDialog) { setMarginDialog(null); e.stopPropagation(); return }
      if (menu) { setMenu(null); e.stopPropagation() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, marginDialog])

  if (!block) return null

  /* execCommand acts on whatever is selected RIGHT NOW, so every command here
     depends on the document's selection surviving a trip to the ribbon.

     RibbonBtn's onMouseDown+preventDefault handles most of that: the browser
     never moves focus, so the selection is never disturbed. But the font-size
     field is a real <input type="number"> — it HAS to take focus, because you
     type into it. The moment it does, the document's selection goes inactive:
     still there, but Chrome repaints it in its pale unfocused grey, which on
     this palette looks like it vanished, and any command run afterwards
     applies to the input instead of the document.

     So the last range seen inside a document is remembered, and restored
     before a command runs if focus has since moved out. (::selection in
     globals.css is the other half of this — without a rule there, even a live
     selection was nearly invisible.) */
  const restoreDocSelection = () => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (!sel) return
    if (docRootOf(sel.rangeCount ? sel.getRangeAt(0) : null)) return   // still in a doc
    const r = savedRange.current
    if (!r) return
    const host = docRootOf(r)
    if (!host || !document.contains(host)) return
    host.focus?.({ preventScroll: true })
    sel.removeAllRanges()
    sel.addRange(r)
  }

  const exec = (cmd, value = null) => {
    restoreDocSelection()
    const ok = document.execCommand(cmd, false, value)
    refresh()
    return ok
  }
  /* Commands the document runs itself (undo, find, comments, …). */
  const ds = docApi(block.id)?.state?.() || {}
  const doc = (cmd, arg) => { restoreDocSelection(); runDoc(block.id, cmd, arg); setMenu(null); refresh() }
  const menuRow = (key, label, onPick, extra = {}) => (
    <button key={key} type="button" {...pressProps(onPick, extra.disabled)} disabled={extra.disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent',
        border: 'none', borderRadius: 'var(--ds-radius-sm)', color: extra.on ? accent : text2, cursor: extra.disabled ? 'default' : 'pointer',
        opacity: extra.disabled ? 0.45 : 1, padding: '6px 10px', fontSize: 13, fontFamily: extra.font || 'var(--ds-font-body)', fontWeight: extra.on ? 600 : 400,
      }}
      onMouseEnter={e => { if (!extra.disabled) e.currentTarget.style.background = raised }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <span style={{ flex: 1 }}>{label}</span>
      {extra.hint && <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3 }}>{extra.hint}</span>}
    </button>
  )
  const dropBtn = (id, props, content) => (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <RibbonBtn wide on={menu === id} {...props} onClick={() => setMenu(m => (m === id ? null : id))} />
      {menu === id && content}
    </div>
  )
  const patch = p => onUpdateBlock?.(block.id, p)
  /* Tell the document an edit happened (save, repaginate): the same input
     event typing sends. */
  const changed = host => host?.dispatchEvent(new Event('input', { bubbles: true }))
  const refresh = () => {
    const host = hostOf()
    const r = rangeIn(host)
    if (host && r) { savedRange.current = r.cloneRange(); setCaret(readCaret(host, r)) }
  }
  /* A character format goes on the selection when the caret is in this
     document; with no caret here it sets the document's default. */
  const inDoc = () => { restoreDocSelection(); return !!rangeIn(hostOf()) }
  const applyChar = css => {
    const host = hostOf()
    if (!inDoc()) return false
    applyInlineStyle(host, css)
    changed(host); refresh()
    return true
  }
  const applyPara = fn => {
    const host = hostOf()
    if (!inDoc()) return false
    applyParagraphStyle(host, fn)
    changed(host); refresh()
    return true
  }
  const indent = dir => {
    const host = hostOf()
    if (!inDoc()) return
    if (caretElement(host)?.closest?.('li')) { document.execCommand(dir > 0 ? 'indent' : 'outdent'); changed(host); return }
    indentParagraphs(host, dir, metricsContentW())
    changed(host); refresh()
  }
  const metricsContentW = () => {
    const pg = pageInches(block.pageSize, block.orientation, block.pageCustom)
    const m = block.margins || {}
    return (pg.w - (Number(m.left ?? 1)) - (Number(m.right ?? 1))) * 96
  }
  /* Put the caret at the end of this document when there is none, so an
     Insert command has somewhere to go instead of nowhere. */
  const ensureCaret = () => {
    const host = hostOf()
    if (!host) return null
    restoreDocSelection()
    if (!rangeIn(host)) {
      host.focus({ preventScroll: true })
      const r = document.createRange(); r.selectNodeContents(host); r.collapse(false); setRange(r)
    }
    return host
  }
  const insertHtml = html => {
    const host = ensureCaret()
    if (!host) return
    document.execCommand('insertHTML', false, html)
    changed(host); refresh()
  }
  const onImageFile = async file => {
    if (!file) return
    try {
      const { src, w } = await imageFileToDataUrl(file)
      if (src.length > 2.5 * 1024 * 1024) { toast('That image is too large to place in a document, even after shrinking it.', { tone: 'warn' }); return }
      const alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[<>"&]/g, '')
      insertHtml(`<img src="${src}" alt="${alt}" width="${Math.min(w, 624)}"><p><br></p>`)
    } catch (err) {
      toast(err.message || 'Could not add that image.', { tone: 'warn' })
    }
  }
  const shownFont = caret?.font || block.font || 'Inter'
  const shownSize = caret?.size ?? block.fontSize ?? 11
  const shownSpacing = caret?.spacing ?? block.lineSpacing ?? 1.5

  /* Real columns — Word/Notion-style text layout inline in the document's own
     flow, NOT the old floating "columns" container block (removed from
     blockRegistry.js entirely; see that file's own note on the removal).
     This ribbon has no ref to the document's contentEditable — every other
     command here (`exec` above) doesn't need one either, because
     RibbonBtn's onMouseDown+preventDefault (unlike a plain onClick) never
     lets the browser move focus away from wherever it already was, so
     document.execCommand still lands in the document block the user was
     just typing in. getDocRoot() finds that same element from the live
     selection when the exact root node is needed (turn-into's "which
     top-level paragraphs are selected" question, execCommand alone can't
     answer). */
  function getDocRoot() {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return null
    const node = sel.getRangeAt(0).commonAncestorContainer
    const el = node?.nodeType === 1 ? node : node?.parentElement
    return el?.closest?.('[data-ds-doc]') || null
  }
  function hasSelectionInDoc() {
    const sel = window.getSelection()
    if (!sel?.rangeCount || sel.isCollapsed) return false
    return !!getDocRoot()
  }
  function insertColumnsHere(n) {
    exec('insertHTML', columnsHtml(n) + '<div><br></div>')
    setMenu(null)
  }
  function turnSelectionIntoColumnsHere(n) {
    const root = getDocRoot()
    const sel = window.getSelection()
    if (!root || !sel?.rangeCount || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const nodes = nodesInRange(root, range)
    if (!nodes.length) return
    const html = columnsFromNodes(nodes.map(el => el.outerHTML), n)
    const full = document.createRange()
    full.setStartBefore(nodes[0])
    full.setEndAfter(nodes[nodes.length - 1])
    sel.removeAllRanges()
    sel.addRange(full)
    exec('insertHTML', html)
    setMenu(null)
  }

  const margins = block.margins || { top: 1, bottom: 1, left: 1, right: 1 }
  const presetId = marginPresetFor(margins)
  const presetLabel = presetId === 'custom'
    ? 'Custom'
    : MARGIN_PRESETS.find(p => p.id === presetId)?.label || 'Normal'
  const page = pageInches(block.pageSize, block.orientation, block.pageCustom)

  /* The BOX. Where it goes is <Pop>'s problem — see its comment. */
  const popover = {
    background: surface, border: `1px solid ${border}`,
    borderRadius: 'var(--ds-radius-md)', boxShadow: 'var(--ds-shadow-lg)',
    padding: 5, minWidth: 170,
  }

  /* ── Home ── */
  const homeBand = (
    <>
      <Group label="Font" launcher onLaunch={() => doc('fontDialog')}>
        {/* A REAL COMBO, not a plain button: the current font's name in a field
            with a dropdown arrow, and each entry in the list rendered IN ITS OWN
            TYPEFACE — the way Word's font list has always worked, so picking a
            font is also previewing it. */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            {...pressProps(() => setMenu(m => (m === 'font' ? null : 'font')))}
            title="Font family"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 26, width: 118,
              padding: '0 7px', border: `1px solid ${border}`, borderRadius: 'var(--ds-radius-xs)',
              background: raised, color: text, cursor: 'pointer',
              fontFamily: 'var(--ds-font-body)', fontSize: 12, lineHeight: 1,
            }}>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shownFont}
            </span>
            <Icon name="nav-chevron-down" size={12} style={{ flexShrink: 0, color: text3 }} />
          </button>
          {menu === 'font' && (
            <Pop style={popover}>
              {DOC_FONTS.map(f => (
                <button key={f.name} type="button"
                  {...pressProps(() => {
                    setMenu(null)
                    /* The document default is inherited, so choosing it
                       CLEARS the span's own font instead of pinning a copy. */
                    const isDefault = f.name === (block.font || 'Inter')
                    /* The app's own fonts are CSS variables; a span names
                       the font first so it reads as a choice, not as the
                       theme value Chrome injects (see cleanupSpans). */
                    const stack = f.stack.startsWith('var(') ? `'${f.name}', ${f.stack}` : f.stack
                    if (!applyChar({ fontFamily: isDefault ? '' : stack })) patch({ font: f.name })
                  })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', borderRadius: 'var(--ds-radius-sm)',
                    color: text2, cursor: 'pointer', padding: '6px 10px', fontSize: 13,
                    fontFamily: f.stack,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}>
                  <span style={{ flex: 1, fontWeight: shownFont === f.name ? 600 : 400 }}>{f.name}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--ds-font-mono)', color: text3 }}>{f.name === (block.font || 'Inter') ? 'default' : f.group}</span>
                </button>
              ))}
              <div style={{ height: 1, background: border, margin: '4px 0' }} />
              <button type="button"
                {...pressProps(() => { patch({ font: shownFont }); setMenu(null) })}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 'var(--ds-radius-sm)', color: text2, cursor: 'pointer', padding: '6px 10px', fontSize: 12, fontFamily: 'var(--ds-font-body)' }}
                onMouseEnter={e => { e.currentTarget.style.background = raised }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                Make {shownFont} the document default
              </button>
            </Pop>
          )}
        </div>

        {/* Size: a matching combo. Type any number, or pick from the preset
            list — Word's own 8–36pt range. */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', height: 26, width: 54,
            border: `1px solid ${border}`, borderRadius: 'var(--ds-radius-xs)',
            background: raised, overflow: 'hidden',
          }}>
            <input
              type="number" min={6} max={200}
              value={sizeDraft ?? shownSize}
              onChange={e => setSizeDraft(e.target.value)}
              /* Applied on Enter or when you leave the box — applying on every
                 keystroke set 1 pt on the way to typing 14. */
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                if (e.key === 'Escape') { e.preventDefault(); setSizeDraft(null); e.currentTarget.blur() }
              }}
              onBlur={() => {
                if (sizeDraft == null) return
                const n = Number(sizeDraft)
                setSizeDraft(null)
                if (!Number.isFinite(n) || n <= 0) return
                const v = Math.min(200, Math.max(6, Math.round(n * 2) / 2))
                if (!applyChar({ fontSize: v + 'pt' })) patch({ fontSize: v })
              }}
              aria-label="Font size"
              style={{
                width: 30, background: 'transparent', border: 'none', outline: 'none',
                color: text, fontFamily: 'var(--ds-font-body)', fontSize: 12,
                textAlign: 'center', padding: 0, MozAppearance: 'textfield',
              }}
            />
            <button type="button"
              {...pressProps(() => setMenu(m => (m === 'size' ? null : 'size')))}
              title="Font size" aria-label="Font size presets"
              style={{ width: 20, height: '100%', border: 'none', background: 'none', color: text3, cursor: 'pointer', padding: 0 }}>
              <Icon name="nav-chevron-down" size={12} />
            </button>
          </div>
          {menu === 'size' && (
            <Pop style={{ ...popover, minWidth: 62 }}>
              {FONT_SIZES.map(n => (
                <button key={n} type="button"
                  {...pressProps(() => { setMenu(null); if (!applyChar({ fontSize: n + 'pt' })) patch({ fontSize: n }) })}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                    border: 'none', borderRadius: 'var(--ds-radius-sm)', color: text2,
                    cursor: 'pointer', padding: '6px 10px', fontSize: 13, fontFamily: 'var(--ds-font-body)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  {n}
                </button>
              ))}
            </Pop>
          )}
        </div>

        <Sep />

        {/* Letterform glyphs, same reasoning as Notes' toolbar and unchanged by
            the ribbon decision: bold-as-a-bold-B beats a novel icon against
            thirty years of muscle memory. */}
        <RibbonBtn title="Bold (Ctrl+B)" on={!!caret?.bold} onClick={() => exec('bold')}><b style={{ fontSize: 13 }}>B</b></RibbonBtn>
        <RibbonBtn title="Italic (Ctrl+I)" on={!!caret?.italic} onClick={() => exec('italic')}><i style={{ fontSize: 13, fontFamily: 'var(--ds-font-body)' }}>I</i></RibbonBtn>
        <RibbonBtn title="Underline (Ctrl+U)" on={!!caret?.underline} onClick={() => exec('underline')}><u style={{ fontSize: 13 }}>U</u></RibbonBtn>
        <RibbonBtn title="Strikethrough" on={!!caret?.strike} onClick={() => exec('strikeThrough')}><s style={{ fontSize: 13 }}>S</s></RibbonBtn>

        {/* REAL sup/sub markup, not a Unicode paste. ² and ₂ exist; most letters
            and multi-digit numbers have no precomposed superscript at all, which
            is exactly why raw paste cannot do real notation like x²⁺ⁿ or a
            citation marker. Ctrl+. / Ctrl+, are handled in the block, matching
            common editor convention. */}
        <RibbonBtn title="Superscript (Ctrl+.)" onClick={() => exec('superscript')}>
          <span style={{ fontSize: 13 }}>x<sup style={{ fontSize: 11 }}>2</sup></span>
        </RibbonBtn>
        <RibbonBtn title="Subscript (Ctrl+,)" onClick={() => exec('subscript')}>
          <span style={{ fontSize: 13 }}>x<sub style={{ fontSize: 11 }}>2</sub></span>
        </RibbonBtn>

        {/* A SPLIT BUTTON, not one swatch. The main "A" applies the last-used
            colour directly — Word's actual one-click repeat behaviour — and the
            arrow opens the palette. One click for the common case, two for
            anything else. */}
        <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <RibbonBtn title={`Apply ${lastColor === INK_SWATCH.value ? 'text colour' : lastColor}`}
            onClick={() => exec('foreColor', lastColor)}>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 12, lineHeight: 1 }}>A</span>
              <span style={{ width: 12, height: 3, borderRadius: 4, background: lastColor }} />
            </span>
          </RibbonBtn>
          <button type="button"
            {...pressProps(() => setMenu(m => (m === 'color' ? null : 'color')))}
            title="More text colours" aria-label="More text colours"
            style={{ width: 14, height: 26, border: 'none', background: 'none', color: text3, cursor: 'pointer', padding: 0, flexShrink: 0 }}>
            <Icon name="nav-chevron-down" size={12} />
          </button>
          {menu === 'color' && (
            <Pop style={{ ...popover, left: 0, minWidth: 0, padding: 9, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {COLOR_OPTIONS.map(sw => (
                <button key={sw.name} type="button"
                  {...pressProps(() => {
                    exec('foreColor', sw.value)
                    setLastColor(sw.value)
                    setMenu(null)
                  })}
                  title={sw.name} aria-label={`Text colour ${sw.name}`}
                  style={{
                    width: 18, height: 18, borderRadius: '50%', background: sw.value,
                    border: '2px solid transparent', cursor: 'pointer', padding: 0, flexShrink: 0,
                    transition: 'border-color var(--ds-transition)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = text }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent' }} />
              ))}
            </Pop>
          )}
        </div>

        {/* Highlight: the same split-button grammar as the text colour. */}
        <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <RibbonBtn title="Highlight" onClick={() => applyChar({ backgroundColor: lastHighlight })}>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 12, lineHeight: 1 }}>ab</span>
              <span style={{ width: 12, height: 3, borderRadius: 4, background: lastHighlight }} />
            </span>
          </RibbonBtn>
          <button type="button" {...pressProps(() => setMenu(m => (m === 'hl' ? null : 'hl')))} title="Highlight colours" aria-label="Highlight colours"
            style={{ width: 14, height: 26, border: 'none', background: 'none', color: text3, cursor: 'pointer', padding: 0, flexShrink: 0 }}>
            <Icon name="nav-chevron-down" size={12} />
          </button>
          {menu === 'hl' && (
            <Pop style={{ ...popover, minWidth: 0, padding: 9 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {HIGHLIGHTS.map(h => (
                  <button key={h.name} type="button" title={h.name} aria-label={`Highlight ${h.name}`}
                    {...pressProps(() => { applyChar({ backgroundColor: h.value }); setLastHighlight(h.value); setMenu(null) })}
                    style={{ width: 22, height: 18, borderRadius: 4, background: h.value, border: '1px solid var(--ds-border)', cursor: 'pointer', padding: 0 }} />
                ))}
              </div>
              <div style={{ height: 1, background: border, margin: '8px 0 4px' }} />
              {menuRow('nohl', 'No highlight', () => { applyChar({ backgroundColor: '' }); setMenu(null) })}
            </Pop>
          )}
        </div>
        {dropBtn('case', { title: 'Change case (Shift+F3)', label: 'Aa ▾' }, (
          <Pop style={{ ...popover, minWidth: 190 }}>
            {CASES.map(c => menuRow(c.id, c.label, () => doc('changeCase', c.id)))}
          </Pop>
        ))}
        <RibbonBtn title="Clear formatting (Ctrl+Space)" onClick={() => doc('clearFormat')}>
          <span style={{ fontSize: 13, position: 'relative' }}>A<span style={{ position: 'absolute', right: -5, bottom: -3, fontSize: 11, color: 'var(--ds-red)' }}>✕</span></span>
        </RibbonBtn>
      </Group>

      <Group label="Paragraph" launcher onLaunch={() => doc('paragraphDialog')}>
        {/* ALIGNMENT AS DRAWN GLYPHS, not four copies of one icon.

            There is no alignment icon in the 129-icon set, and the obvious
            fallback — reusing `text-bullet-list` four times — would be worse
            than nothing: four identical icons say the four controls do the same
            thing. Three stacked bars whose lengths and offsets actually differ
            per alignment is the universal shape for this and reads correctly at
            13px, so it stands in until the real four are drawn. */}
        {compact < 2 && <>
        <RibbonBtn title="Align left (Ctrl+L)" on={caret?.align === 'left'} onClick={() => exec('justifyLeft')}><AlignGlyph mode="left" /></RibbonBtn>
        <RibbonBtn title="Align centre (Ctrl+E)" on={caret?.align === 'center'} onClick={() => exec('justifyCenter')}><AlignGlyph mode="center" /></RibbonBtn>
        <RibbonBtn title="Align right (Ctrl+R)" on={caret?.align === 'right'} onClick={() => exec('justifyRight')}><AlignGlyph mode="right" /></RibbonBtn>
        <RibbonBtn title="Justify (Ctrl+J)" on={caret?.align === 'justify'} onClick={() => exec('justifyFull')}><AlignGlyph mode="justify" /></RibbonBtn>
        </>}
        {compact === 2 && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <RibbonBtn wide title="Alignment and indent" on={menu === 'align'}
              onClick={() => setMenu(m => (m === 'align' ? null : 'align'))}>
              <AlignGlyph mode="left" /><span aria-hidden="true" style={{ fontSize: 11 }}>▾</span>
            </RibbonBtn>
            {menu === 'align' && (
              <Pop style={{ ...popover, minWidth: 170 }}>
                {[
                  ['justifyLeft', 'Align left', 'left'], ['justifyCenter', 'Align centre', 'center'],
                  ['justifyRight', 'Align right', 'right'], ['justifyFull', 'Justify', 'justify'],
                  ['outdent', 'Decrease indent', null, '⇤'], ['indent', 'Increase indent', null, '⇥'],
                ].map(([cmd, label, mode, glyph]) => (
                  <button key={cmd} type="button" {...pressProps(() => { setMenu(null); if (cmd === 'indent' || cmd === 'outdent') indent(cmd === 'indent' ? 1 : -1); else exec(cmd) })}
                    style={{
                      display: 'flex', alignItems: 'center', width: '100%', gap: 10, background: 'transparent', border: 'none',
                      borderRadius: 'var(--ds-radius-sm)', color: text2, cursor: 'pointer', padding: '6px 10px',
                      fontSize: 13, fontFamily: 'var(--ds-font-body)', textAlign: 'left',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = raised }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                    <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{mode ? <AlignGlyph mode={mode} /> : glyph}</span>
                    {label}
                  </button>
                ))}
              </Pop>
            )}
          </div>
        )}
        <Sep />
        <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <RibbonBtn title="Bullet list (type - and a space)" icon="text-bullet-list" onClick={() => exec('insertUnorderedList')} />
          <button type="button" {...pressProps(() => setMenu(m => (m === 'bullets' ? null : 'bullets')))} title="Bullet styles" aria-label="Bullet styles"
            style={{ width: 12, height: 26, border: 'none', background: 'none', color: text3, cursor: 'pointer', padding: 0 }}><Icon name="nav-chevron-down" size={12} /></button>
          {menu === 'bullets' && (
            <Pop style={{ ...popover, minWidth: 200 }}>
              {BULLET_STYLES.map(b => menuRow(b.id, `${b.label}  ${b.title}`, () => doc('listStyle', { ordered: false, style: b.id })))}
            </Pop>
          )}
        </div>
        <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <RibbonBtn title="Numbered list (type 1. and a space)" icon="text-numbered-list" onClick={() => exec('insertOrderedList')} />
          <button type="button" {...pressProps(() => setMenu(m => (m === 'numbers' ? null : 'numbers')))} title="Numbering styles" aria-label="Numbering styles"
            style={{ width: 12, height: 26, border: 'none', background: 'none', color: text3, cursor: 'pointer', padding: 0 }}><Icon name="nav-chevron-down" size={12} /></button>
          {menu === 'numbers' && (
            <Pop style={{ ...popover, minWidth: 220 }}>
              {NUMBER_STYLES.map(b => menuRow(b.id, b.label, () => doc('listStyle', { ordered: true, style: b.id }), { hint: b.title }))}
              <div style={{ padding: '6px 10px 2px', fontSize: 11, color: text3 }}>Tab nests a level: 1 → a → i</div>
            </Pop>
          )}
        </div>
        <Sep />
        {compact < 2 && <>
        <RibbonBtn title="Decrease indent (Shift+Tab)" onClick={() => indent(-1)}>
          <span style={{ fontSize: 13 }}>⇤</span>
        </RibbonBtn>
        <RibbonBtn title="Increase indent (Tab)" onClick={() => indent(1)}>
          <span style={{ fontSize: 13 }}>⇥</span>
        </RibbonBtn>
        </>}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <RibbonBtn wide title="Line spacing — the selected paragraphs" label={`${shownSpacing}×`}
            onClick={() => setMenu(m => (m === 'spacing' ? null : 'spacing'))} />
          {menu === 'spacing' && (
            <Pop style={{ ...popover, minWidth: 110 }}>
              {LINE_SPACINGS.map(sp => (
                <button key={sp.id} type="button"
                  {...pressProps(() => {
                    setMenu(null)
                    if (!applyPara(p => { p.style.lineHeight = String(sp.id) })) patch({ lineSpacing: sp.id })
                  })}
                  style={{
                    display: 'flex', width: '100%', gap: 8, background: 'transparent', border: 'none',
                    borderRadius: 'var(--ds-radius-sm)', color: shownSpacing === sp.id ? accent : text2,
                    cursor: 'pointer', padding: '6px 10px', fontSize: 13, fontFamily: 'var(--ds-font-body)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <span style={{ flex: 1, textAlign: 'left' }}>{sp.label}</span>
                  <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11 }}>{sp.id}×</span>
                </button>
              ))}
              <div style={{ height: 1, background: border, margin: '4px 0' }} />
              {menuRow('sb', 'Add space before (12 pt)', () => doc('spacing', { before: 12 }))}
              {menuRow('sa0', 'Remove space after', () => doc('spacing', { after: 0 }))}
              {menuRow('sa8', 'Space after 8 pt', () => doc('spacing', { after: 8 }))}
              {menuRow('pd', 'Paragraph options…', () => doc('paragraphDialog'))}
            </Pop>
          )}
        </div>
      </Group>

      {/* A GALLERY, not identical buttons: each style is previewed at its
          own look, so picking one previews it — the way Word's gallery has
          always worked. The active style is pressed. */}
      <Group label="Styles">
        {(() => {
          const cur = !caret ? null
            : caret.style === 'title' || caret.style === 'subtitle' ? caret.style
            : /^h[1-4]$/.test(caret.block) ? caret.block : caret.block === 'blockquote' ? 'quote' : 'normal'
          const tile = st => (
            <button key={st.id} type="button" aria-pressed={cur === st.id}
              {...pressProps(() => { doc('style', st.id); setMenu(null) })}
              title={`${st.label}${st.hint ? ` (${st.hint})` : ''}`}
              style={{
                height: 26, padding: '0 8px', flexShrink: 0,
                border: `1px solid ${cur === st.id ? accent : border}`, borderRadius: 'var(--ds-radius-xs)',
                background: cur === st.id ? 'var(--ds-accent-dim)' : raised, cursor: 'pointer',
                color: st.head ? '#1F3A5F' : st.mute ? text3 : text,
                fontFamily: 'var(--ds-font-body)', fontSize: st.size, fontWeight: st.weight, fontStyle: st.italic ? 'italic' : 'normal', lineHeight: 1,
              }}>
              {st.label}
            </button>
          )
          return compact === 0
            ? <div style={{ display: 'flex', gap: 4 }}>{STYLE_LIST.slice(0, 6).map(tile)}{dropBtn('styles', { title: 'More styles', label: '▾' }, (
              <Pop style={{ ...popover, minWidth: 200 }}>
                {STYLE_LIST.map(st => menuRow(st.id, st.label, () => doc('style', st.id), { on: cur === st.id, hint: st.hint }))}
              </Pop>
            ))}</div>
            : dropBtn('styles', { title: 'Paragraph styles', label: `${STYLE_LIST.find(x => x.id === cur)?.label || 'Styles'} ▾` }, (
              <Pop style={{ ...popover, minWidth: 200 }}>
                {STYLE_LIST.map(st => menuRow(st.id, st.label, () => doc('style', st.id), { on: cur === st.id, hint: st.hint }))}
              </Pop>
            ))
        })()}
      </Group>

      <Group label="Editing">
        <RibbonBtn wide title="Find (Ctrl+F)" icon="nav-search" label="Find" onClick={() => doc('find')} />
        <RibbonBtn wide title="Replace (Ctrl+H)" label="Replace" onClick={() => doc('replace')} />
        <RibbonBtn wide title="Format painter — click to copy the caret's format onto the next selection; double-click to keep it on"
          label="Painter" on={!!ds.painter} onClick={e => doc('painter', e?.detail >= 2)} />
      </Group>
    </>
  )

  /* ── Insert ── */
  const insertBand = (
    <>
      <Group label="Insert">
        {/* INSIDE the document now. These used to add a separate Table or
            Image BLOCK beside the document on the canvas, which is not what
            "Insert → Table" means anywhere else. */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <RibbonBtn wide title="Insert a table at the cursor" icon="block-table" label="Table" on={menu === 'table'}
            onClick={() => setMenu(m => (m === 'table' ? null : 'table'))} />
          {menu === 'table' && (
            <Pop style={{ ...popover, minWidth: 0, padding: 8 }}>
              <TablePicker colors={colors} onPick={(r, c) => {
                setMenu(null)
                insertHtml(tableHtml(r, c))
                /* Into the first cell, ready to type — Word's behaviour. The
                   insert leaves the caret in the paragraph after the table. */
                const host = hostOf()
                const after = caretElement(host)?.closest?.('p,div')
                const t = after?.previousElementSibling
                const cell = t?.tagName === 'TABLE' ? t.querySelector('th,td') : null
                if (cell) { const rr = document.createRange(); rr.selectNodeContents(cell); rr.collapse(true); setRange(rr) }
              }} />
            </Pop>
          )}
        </div>
        <RibbonBtn wide title="Insert a picture at the cursor" icon="block-image" label="Image"
          onClick={() => { ensureCaret(); imageInputRef.current?.click() }} />
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; onImageFile(f) }} />
        <RibbonBtn wide title="Insert a link (Ctrl+K)" icon="share-link" label="Link"
          onClick={() => { const host = ensureCaret(); host?.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })) }} />
        {/* Real text columns now, not the old Notion-style container block —
            that type is gone from blockRegistry.js. Stays in Insert rather
            than Layout for the same reason the old block did: Layout is
            page-level and this is content-level, and that distinction didn't
            change just because the implementation did.

            Both lists in one dropdown — "N columns" (empty insert, always
            available) and "N columns · Turn into" (redistributes the current
            selection, enabled only when there is one) — because this ribbon,
            unlike the Notes selection-toolbar equivalent, has no guarantee a
            selection exists when it's opened; disabling rather than hiding
            the Turn-into half says so rather than leaving someone to wonder
            why half the menu is missing. */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <RibbonBtn wide title="Real text columns" icon="block-section" label="Columns"
            onClick={() => {
              setColHasSelection(hasSelectionInDoc())
              setMenu(m => (m === 'columns' ? null : 'columns'))
            }} />
          {menu === 'columns' && (
            <Pop style={{ ...popover, minWidth: 210 }}>
              <div style={{
                padding: '4px 9px 3px', fontSize: 11, fontFamily: 'var(--ds-font-mono)',
                textTransform: 'uppercase', letterSpacing: 0.6, color: text3,
              }}>Insert</div>
              {COLUMN_COUNTS.map(n => (
                <button key={`ins-${n}`} type="button"
                  {...pressProps(() => insertColumnsHere(n))}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                    border: 'none', borderRadius: 'var(--ds-radius-sm)', color: text2,
                    cursor: 'pointer', padding: '6px 10px', fontSize: 13, fontFamily: 'var(--ds-font-body)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  {n} columns
                </button>
              ))}
              <div style={{ height: 1, background: border, margin: '4px 0' }} />
              <div style={{
                padding: '4px 9px 3px', fontSize: 11, fontFamily: 'var(--ds-font-mono)',
                textTransform: 'uppercase', letterSpacing: 0.6, color: text3,
              }}>Turn into</div>
              {COLUMN_COUNTS.map(n => (
                <button key={`turn-${n}`} type="button" disabled={!colHasSelection}
                  {...pressProps(() => turnSelectionIntoColumnsHere(n), !colHasSelection)}
                  title={colHasSelection ? undefined : 'Select some text first'}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    textAlign: 'left', background: 'transparent', border: 'none',
                    borderRadius: 'var(--ds-radius-sm)',
                    color: colHasSelection ? text2 : text3,
                    cursor: colHasSelection ? 'pointer' : 'not-allowed',
                    opacity: colHasSelection ? 1 : 0.55,
                    padding: '6px 10px', fontSize: 13, fontFamily: 'var(--ds-font-body)',
                  }}
                  onMouseEnter={e => { if (colHasSelection) e.currentTarget.style.background = raised }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <span>{n} columns</span>
                  {!colHasSelection && (
                    <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11 }}>select text</span>
                  )}
                </button>
              ))}
            </Pop>
          )}
        </div>
      </Group>
      <Group label="Pages">
        <RibbonBtn wide title="Start a new page here (Ctrl+Enter)"
          icon="text-divider" label="Page break" onClick={() => doc('pagebreak')} />
      </Group>
      <Group label="Header and footer">
        <RibbonBtn wide title="Edit the header (or double-click the top of a page)" label="Header" onClick={() => doc('hf', 'header')} />
        <RibbonBtn wide title="Edit the footer (or double-click the bottom of a page)" label="Footer" onClick={() => doc('hf', 'footer')} />
        {dropBtn('pagenum', { title: 'Page numbers', label: 'Page number ▾' }, (
          <Pop style={{ ...popover, minWidth: 220 }}>
            {[['Bottom, centre', { footer: { c: '{page}' } }], ['Bottom, right', { footer: { r: '{page}' } }],
              ['Bottom: Page X of Y', { footer: { c: 'Page {page} of {pages}' } }], ['Top, right', { header: { r: '{page}' } }]].map(([l, v]) =>
              menuRow(l, l, () => { patch({ hf: { ...(block.hf || {}), ...v } }); setMenu(null) }))}
            {menuRow('nonum', 'Remove page numbers', () => {
              const strip = o => (o ? Object.fromEntries(Object.entries(o).map(([k, t]) => [k, String(t || '').replace(/Page \{page\} of \{pages\}|\{page\}|\{pages\}/g, '').trim()])) : o)
              patch({ hf: { ...(block.hf || {}), header: strip(block.hf?.header), footer: strip(block.hf?.footer || {}) } }); setMenu(null)
            })}
          </Pop>
        ))}
      </Group>
      <Group label="Text">
        {dropBtn('date', { title: 'Insert the date', label: 'Date ▾' }, (
          <Pop style={{ ...popover, minWidth: 250 }}>
            {dateFormats().map(d => menuRow(d, d, () => doc('insertText', d)))}
          </Pop>
        ))}
        {dropBtn('symbol', { title: 'Insert a symbol', label: 'Ω Symbol ▾' }, (
          <Pop style={{ ...popover, minWidth: 0, padding: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 26px)', gap: 2 }}>
              {SYMBOLS.map(ch => (
                <button key={ch} type="button" title={`U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`} {...pressProps(() => doc('insertText', ch))}
                  style={{ width: 26, height: 26, border: '1px solid transparent', borderRadius: 4, background: 'none', cursor: 'pointer', fontSize: 14, color: text }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accent }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent' }}>{ch}</button>
              ))}
            </div>
          </Pop>
        ))}
        {dropBtn('eq', { title: 'Insert an equation line', label: '∑ Equation ▾' }, (
          <Pop style={{ ...popover, minWidth: 0, padding: 8 }}>
            {menuRow('neweq', 'New equation line', () => doc('equation'))}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 26px)', gap: 2, marginTop: 4 }}>
              {MATH_SYMBOLS.map(ch => (
                <button key={ch} type="button" {...pressProps(() => doc('insertText', ch))}
                  style={{ width: 26, height: 26, border: '1px solid transparent', borderRadius: 4, background: 'none', cursor: 'pointer', fontSize: 14, color: text }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accent }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent' }}>{ch}</button>
              ))}
            </div>
          </Pop>
        ))}
        <RibbonBtn wide title="Horizontal line (or type --- and Enter)" label="Line" onClick={() => doc('hr')} />
        <RibbonBtn wide title="Drop cap on this paragraph" label="Drop cap" onClick={() => doc('dropcap')} />
      </Group>
      <Group label="Comments">
        <RibbonBtn wide title="New comment (Ctrl+Alt+M)" label="Comment" onClick={() => doc('comment')} />
      </Group>
    </>
  )

  /* ── Layout ── */
  const sec = ds.section || null
  const secIdx = sec?.index || 0
  const secCount = sec?.count || 1
  const secOrient = sec?.orient || block.orientation || 'portrait'
  const setOrient = o => { if (docApi(block.id)) doc('orient', o); else patch({ orientation: o }) }
  const layoutBand = (
    <>
      <Group label="Page setup">
        {/* A DROPDOWN showing the current preset's NAME, not a slider and not a
            bare input. Word's actual pattern, and the reason matters: margins
            are four independent values at sub-inch precision that people type
            exact numbers into, which a slider genuinely cannot do well. */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <RibbonBtn wide title="Margins" label={`Margins: ${presetLabel}`}
            onClick={() => setMenu(m => (m === 'margins' ? null : 'margins'))} />
          {menu === 'margins' && (
            <Pop style={{ ...popover, minWidth: 210 }}>
              {MARGIN_PRESETS.map(p => (
                <button key={p.id} type="button"
                  {...pressProps(() => { patch({ margins: { ...p.margins } }); setMenu(null) })}
                  style={{
                    display: 'flex', width: '100%', gap: 8, background: 'transparent', border: 'none',
                    borderRadius: 'var(--ds-radius-sm)', cursor: 'pointer', padding: '6px 10px',
                    color: presetId === p.id ? accent : text2,
                    fontSize: 13, fontFamily: 'var(--ds-font-body)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <span style={{ flex: 1, textAlign: 'left', fontWeight: presetId === p.id ? 600 : 400 }}>{p.label}</span>
                  {/* The actual inch values, inline — "Moderate" means nothing
                      without them, which is why Word shows them too. */}
                  <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3 }}>
                    {p.margins.top}″ / {p.margins.left}″
                  </span>
                </button>
              ))}
              <div style={{ height: 1, background: border, margin: '4px 0' }} />
              {menuRow('mirror', 'Mirror margins (facing pages)', () => { patch({ mirror: !block.mirror }); setMenu(null) }, { on: !!block.mirror, hint: block.mirror ? 'on' : '' })}
              <button type="button"
                {...pressProps(() => {
                  setMarginDialog({ ...margins, gutter: block.gutter || 0, mirror: !!block.mirror })
                  setMenu(null)
                })}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                  border: 'none', borderRadius: 'var(--ds-radius-sm)', color: text2,
                  cursor: 'pointer', padding: '6px 10px', fontSize: 13, fontFamily: 'var(--ds-font-body)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = raised }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                Custom Margins…
              </button>
            </Pop>
          )}
        </div>

        {/* Orientation is the CARET's section's (Layout → Breaks makes
            sections); with one section that is the whole document. */}
        <RibbonBtn wide title={secCount > 1 ? `Portrait — section ${secIdx + 1}` : 'Portrait'} label="Portrait"
          on={secOrient === 'portrait'}
          onClick={() => setOrient('portrait')} />
        <RibbonBtn wide title={secCount > 1 ? `Landscape — section ${secIdx + 1}` : 'Landscape'} label="Landscape"
          on={secOrient === 'landscape'}
          onClick={() => setOrient('landscape')} />

        <div style={{ position: 'relative', flexShrink: 0 }}>
          <RibbonBtn wide title="Page size" label={page.label}
            onClick={() => setMenu(m => (m === 'pagesize' ? null : 'pagesize'))} />
          {menu === 'pagesize' && (
            <Pop style={{ ...popover, minWidth: 150 }}>
              {PAGE_SIZE_IDS.map(id => {
                const sz = PAGE_SIZES[id]
                const on = (block.pageSize || 'a4') === id
                return (
                  <button key={id} type="button"
                    {...pressProps(() => { patch({ pageSize: id }); setMenu(null) })}
                    style={{
                      display: 'flex', width: '100%', gap: 8, background: 'transparent', border: 'none',
                      borderRadius: 'var(--ds-radius-sm)', cursor: 'pointer', padding: '6px 10px',
                      color: on ? accent : text2, fontSize: 13, fontFamily: 'var(--ds-font-body)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = raised }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                    <span style={{ flex: 1, textAlign: 'left', fontWeight: on ? 600 : 400 }}>{sz.label}</span>
                    <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3 }}>
                      {sz.w}″ × {sz.h}″
                    </span>
                  </button>
                )
              })}
              <div style={{ height: 1, background: border, margin: '4px 0' }} />
              {menuRow('custom', block.pageSize === 'custom' ? `Custom (${page.w}″ × ${page.h}″)…` : 'Custom size…', () => doc('pageSizeDialog'), { on: block.pageSize === 'custom' })}
            </Pop>
          )}
        </div>
      </Group>
      {/* Breaks: a page break, or a SECTION break — the next page starts a
          section that can turn landscape or restart its page numbers
          (lib/docsections.js). */}
      <Group label="Breaks">
        {dropBtn('breaks', { title: 'Page and section breaks', label: 'Breaks ▾' }, (
          <Pop style={{ ...popover, minWidth: 250 }}>
            {menuRow('pb', 'Page break', () => doc('pagebreak'), { hint: 'Ctrl+Enter' })}
            <div style={{ height: 1, background: border, margin: '4px 0' }} />
            {menuRow('sb', 'Section break (next page)', () => doc('sectionBreak'))}
            {menuRow('sbl', 'Section break — landscape pages', () => doc('sectionBreak', { orient: 'landscape' }))}
            {menuRow('sbp', 'Section break — back to portrait', () => doc('sectionBreak', { orient: 'portrait' }))}
            {menuRow('sbr', 'Section break — restart numbering at 1', () => doc('sectionBreak', { restart: true, start: 1, numfmt: 'decimal' }))}
          </Pop>
        ))}
        <RibbonBtn wide title={`Settings of the section the caret is in${secCount > 1 ? ` (section ${secIdx + 1} of ${secCount})` : ''} — orientation, page numbering`}
          label={secCount > 1 ? `Section ${secIdx + 1}…` : 'Section…'} onClick={() => doc('sectionDialog')} />
      </Group>
      <Group label="Paragraph" launcher onLaunch={() => doc('paragraphDialog')}>
        <RibbonBtn wide title="Space before the paragraph: 0 / 6 / 12 pt" label="Before ▾" on={menu === 'spb'} onClick={() => setMenu(m => (m === 'spb' ? null : 'spb'))} />
        {menu === 'spb' && (
          <Pop style={{ ...popover, minWidth: 140 }}>{[0, 6, 12, 18, 24].map(v => menuRow('b' + v, `${v} pt`, () => doc('spacing', { before: v })))}</Pop>
        )}
        <RibbonBtn wide title="Space after the paragraph: 0 / 8 / 12 pt" label="After ▾" on={menu === 'spa'} onClick={() => setMenu(m => (m === 'spa' ? null : 'spa'))} />
        {menu === 'spa' && (
          <Pop style={{ ...popover, minWidth: 140 }}>{[0, 6, 8, 12, 18].map(v => menuRow('a' + v, `${v} pt`, () => doc('spacing', { after: v })))}</Pop>
        )}
      </Group>
      <Group label="Design">
        <RibbonBtn wide title="Text across every page, like DRAFT" label={block.watermark ? `Watermark: ${block.watermark}` : 'Watermark…'} onClick={() => doc('watermark')} />
        {[['white', 'White'], ['dark', 'Dark'], ['theme', 'Follow theme']].map(([id, label]) => (
          <RibbonBtn key={id} wide title={id === 'white' ? 'White paper, in light and dark mode — like Word' : id === 'dark' ? 'Dark paper' : 'Paper follows the app theme'}
            label={label} on={(block.pageColor || 'white') === id} onClick={() => patch({ pageColor: id })} />
        ))}
      </Group>
    </>
  )

  /* ── View ── */
  const viewBand = (
    <>
      <Group label="Show">
        <RibbonBtn wide dot title="Ruler — margins and the caret paragraph's indents" label="Ruler" on={!!block.showRuler} onClick={() => patch({ showRuler: !block.showRuler })} />
        <RibbonBtn wide dot title="Navigation pane: the document's headings" label="Navigation" on={!!block.showNav} onClick={() => doc('nav')} />
        <RibbonBtn wide dot title="Show paragraph marks and page breaks (Ctrl+Shift+8)" label="¶ Marks" on={!!block.showMarks} onClick={() => doc('marks')} />
        <RibbonBtn wide dot title="Word count in the status bar" label="Word count" on={block.showWordCount !== false} onClick={() => patch({ showWordCount: block.showWordCount === false })} />
      </Group>
      <Group label="Zoom">
        {[['fit', 'Fit width'], ['page', 'Whole page'], [1, '100%']].map(([z, l]) => (
          <RibbonBtn key={String(z)} wide label={l} title={l} on={(block.zoom || 'fit') === z} onClick={() => doc('zoom', z)} />
        ))}
      </Group>
    </>
  )

  const fileBand = (
    <>
      <Group label="Export">
        <RibbonBtn wide title="Export as a Word document" icon="format-word" label="Word (.docx)" onClick={() => onExport?.('docx')} />
        <RibbonBtn wide title="Export as a PDF, page for page as on screen" icon="format-pdf" label="PDF" onClick={() => onExport?.('pdf')} />
        <RibbonBtn wide title="Print — the same pages as the PDF" label="Print" onClick={() => onExport?.('pdf')} />
      </Group>
      <Group label="Versions">
        <RibbonBtn wide title="Keep a copy of the document as it is now" icon="history-version" label="Save version" onClick={() => { doc('saveVersion'); toast('Version saved') }} />
        <RibbonBtn wide title="Earlier versions of this document, kept in this browser" label="Version history…" onClick={() => doc('versions')} />
      </Group>
      <Group label="Info">
        <RibbonBtn wide title="Words, characters, paragraphs, pages" label="Word count…" onClick={() => doc('stats')} />
      </Group>
    </>
  )

  const refsBand = (
    <>
      <Group label="Table of contents">
        <RibbonBtn wide title="Insert a table of contents built from the headings; it keeps itself up to date" label="Table of contents" onClick={() => doc('toc')} />
      </Group>
      <Group label="Footnotes">
        <RibbonBtn wide title="Insert a footnote (Ctrl+Alt+F)" label="Insert footnote" onClick={() => doc('footnote')} />
      </Group>
      <Group label="Citations and bibliography">
        <RibbonBtn wide title="Insert a citation from your sources" label="Insert citation" onClick={() => doc('sources')} />
        <RibbonBtn wide title="Add, edit and remove sources" label="Manage sources" onClick={() => doc('sources')} />
        {dropBtn('citestyle', { title: 'Citation style', label: `Style: ${CITE_STYLES.find(c => c.id === (block.citeStyle || 'apa'))?.label} ▾` }, (
          <Pop style={{ ...popover, minWidth: 150 }}>
            {CITE_STYLES.map(c => menuRow(c.id, c.label, () => { patch({ citeStyle: c.id }); setMenu(null) }, { on: (block.citeStyle || 'apa') === c.id }))}
          </Pop>
        ))}
        <RibbonBtn wide title="Insert a bibliography of every source; it keeps itself up to date" label="Bibliography" onClick={() => doc('bibliography')} />
      </Group>
      <Group label="Captions">
        <RibbonBtn wide title="Click a picture first, then Caption in its toolbar; or insert a table caption here" label="Table caption"
          onClick={() => doc('insertHtml', '<p data-ds-caption="1">Table 1. </p>')} />
      </Group>
    </>
  )

  const reviewBand = (
    <>
      <Group label="Comments">
        <RibbonBtn wide title="New comment (Ctrl+Alt+M)" label="New comment" onClick={() => doc('comment')} />
        <RibbonBtn title="Previous comment" onClick={() => doc('prevComment')}>↑</RibbonBtn>
        <RibbonBtn title="Next comment" onClick={() => doc('nextComment')}>↓</RibbonBtn>
        <RibbonBtn wide dot title="Show resolved comments" label="Resolved" on={!!block.showResolved} onClick={() => doc('showResolved')} />
      </Group>
      <Group label="Tracking">
        <RibbonBtn wide dot title="Track changes (Ctrl+Shift+E): your edits are marked for review" label="Track changes" on={!!block.trackChanges} onClick={() => doc('track')} />
        <RibbonBtn wide dot title="Show insertions and deletions; off shows the final text" label="Show markup" on={block.showMarkup !== false} onClick={() => doc('markup')} />
      </Group>
      <Group label="Changes">
        {dropBtn('accept', { title: 'Accept the change at the caret, then go to the next', label: '✓ Accept ▾' }, (
          <Pop style={{ ...popover, minWidth: 190 }}>
            {menuRow('a1', 'Accept and move to next', () => doc('accept', 'one'))}
            {menuRow('aa', 'Accept all changes', () => doc('accept', 'all'))}
          </Pop>
        ))}
        {dropBtn('reject', { title: 'Reject the change at the caret, then go to the next', label: '✕ Reject ▾' }, (
          <Pop style={{ ...popover, minWidth: 190 }}>
            {menuRow('r1', 'Reject and move to next', () => doc('reject', 'one'))}
            {menuRow('ra', 'Reject all changes', () => doc('reject', 'all'))}
          </Pop>
        ))}
        <RibbonBtn title="Previous change" onClick={() => doc('prevChange')}>↑</RibbonBtn>
        <RibbonBtn title="Next change" onClick={() => doc('nextChange')}>↓</RibbonBtn>
      </Group>
      <Group label="Proofing">
        <RibbonBtn wide title="Word count" label="Word count…" onClick={() => doc('stats')} />
        <RibbonBtn wide title="Version history" icon="history-version" label="Versions…" onClick={() => doc('versions')} />
      </Group>
    </>
  )

  const band = { file: fileBand, home: homeBand, insert: insertBand, layout: layoutBand, refs: refsBand, review: reviewBand, view: viewBand }[tab] || homeBand

  return (
    <div
      ref={ref}
      data-kbd-zone
      onMouseDown={e => e.stopPropagation()}
      style={{
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        background: surface, borderBottom: `1px solid ${border}`,
        fontFamily: 'var(--ds-font-body)',
        /* Sticky-header depth: the same directional shadow the calendar's
           weekday strip casts onto its grid, for the same reason — the ribbon
           has to read as sitting above the page rather than as its first line. */
        boxShadow: `0 3px 10px -6px rgba(0,0,0,0.14)`,
        position: 'relative', zIndex: 2,
      }}>

      {/* ── TABS ──
          A real tablist, which is a promise about the keyboard as much as a
          label for a screen reader: the arrow keys move between tabs, Home and
          End jump to the ends, and only the SELECTED tab sits in the page's tab
          order (WAI-ARIA's roving tabindex). Four tabs each holding their own
          Tab stop is a ribbon that costs four keystrokes before you reach a
          control.

          Activation follows focus, as Word's ribbon does — arrowing onto Insert
          shows the Insert band immediately. That is the right default when
          there is no panel to load and so nothing to make lazy.

          The arrow keys are stopped here rather than left to bubble: the
          canvas's toolbar mode (NotebookCanvas.js) reads arrows as spatial
          moves between island buttons, and both handlers acting on one press
          would move focus twice. ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '4px 8px 0' }}>
        {/* Quick access, where Word puts it: beside the tabs, not a row of
            its own — one strip less between the title and the page. */}
        <div style={{ display: 'flex', gap: 2, paddingBottom: 2 }}>
          <RibbonBtn title="Undo (Ctrl+Z)" icon="draw-undo" disabled={ds.canUndo === false} onClick={() => doc('undo')} />
          <RibbonBtn title="Redo (Ctrl+Y)" disabled={ds.canRedo === false} onClick={() => doc('redo')}>
            <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><Icon name="draw-undo" size={14} /></span>
          </RibbonBtn>
        </div>
        <span aria-hidden="true" style={{ width: 1, height: 18, background: border, marginBottom: 5 }} />
      <div role="tablist" aria-label="Ribbon" style={{
        display: 'flex', gap: 2, flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {TABS.map((t, i) => {
          const on = tab === t.id
          const goTab = j => {
            const n = TABS[(j + TABS.length) % TABS.length]
            setTab(n.id)
            setMenu(null)
            tabRefs.current[(j + TABS.length) % TABS.length]?.focus()
          }
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on}
              tabIndex={on ? 0 : -1}
              ref={el => { tabRefs.current[i] = el }}
              onKeyDown={e => {
                const j = e.key === 'ArrowRight' ? i + 1
                  : e.key === 'ArrowLeft' ? i - 1
                  : e.key === 'Home' ? 0
                  : e.key === 'End' ? TABS.length - 1
                  : null
                if (j === null) return
                e.preventDefault()
                e.stopPropagation()
                goTab(j)
              }}
              {...pressProps(() => { setTab(t.id); setMenu(null) })}
              style={{
                height: 24, padding: '0 12px', cursor: 'pointer',
                border: `1px solid ${on ? border : 'transparent'}`,
                borderBottom: on ? `1px solid ${surface}` : '1px solid transparent',
                borderRadius: '6px 6px 0 0',
                background: on ? surface : 'transparent',
                color: on ? accent : text2,
                fontFamily: 'var(--ds-font-body)', fontSize: 12,
                fontWeight: on ? 650 : 500, lineHeight: 1,
                position: 'relative', top: 1,
                transition: 'color var(--ds-transition), background var(--ds-transition)',
              }}>
              {t.label}
            </button>
          )
        })}
      </div>
        <button type="button" {...pressProps(() => { setTab('layout'); setMenu(null) })} title="Page setup — Layout tab"
          style={{ height: 24, padding: '0 8px', marginBottom: 2, border: 'none', borderRadius: 6, background: 'none', color: text3, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--ds-font-body)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {page.label} · {secOrient === 'landscape' ? 'Landscape' : 'Portrait'}{secCount > 1 ? ` · Section ${secIdx + 1} of ${secCount}` : ''}
        </button>
      </div>

      {/* ── BAND — the selected tab's groups, as a horizontal strip with the
             group captions along the bottom. Word's layout grammar, in this
             app's surfaces and type. Scrolls horizontally rather than wrapping:
             a ribbon whose groups reflow onto a second row moves every control
             the moment the block is resized, which is the one thing a pinned
             toolbar is for. ── */}
      <div ref={scrollWrapRef} className="ds-ribbon-scroll" data-overflow={overflow}
        style={{ borderTop: `1px solid ${border}` }}>
        <div
          ref={bandRef}
          className="ds-ribbon-band"
          onScroll={measureOverflow}
          style={{
            display: 'flex', alignItems: 'stretch', gap: 0,
            padding: '7px 0 6px',
            overflowX: 'auto', overflowY: 'visible',
          }}>
          {band}
        </div>
      </div>

      {/* ── CUSTOM MARGINS DIALOG ──
          Four labelled spinners plus a live page diagram. THIS is the manual
          numeric input that was asked for: a slider can approximate one value,
          and margins are four independent values at 0.25″ precision that people
          type exact numbers into.

          Portalled, because this rail sits inside the canvas's CSS transform and
          a fixed-position dialog inside a transform positions against the
          transform, not the viewport. `npm run check:geom` enforces that. */}
      {marginDialog && typeof document !== 'undefined' && createPortal(
        <MarginDialog
          draft={marginDialog}
          setDraft={setMarginDialog}
          block={block}
          colors={colors}
          onCancel={() => setMarginDialog(null)}
          onOk={(values, extra) => { patch({ margins: values, ...(extra || {}) }); setMarginDialog(null) }}
        />,
        document.body,
      )}
    </div>
  )
}

/* ── The Custom Margins dialog ────────────────────────────────────────── */

function MarginDialog({ draft, setDraft, block, colors, onCancel, onOk }) {
  const { surface, raised, border, text, text2, text3, accent } = colors
  const page = pageInches(block.pageSize, block.orientation, block.pageCustom)

  /* aria-modal="true" is a claim about focus, and it was the only part of this
     dialog that wasn't true. Focus stayed on the ribbon button behind the
     scrim, so opening Custom Margins from the keyboard meant tabbing through
     the page to reach a field, Tab walked straight back out into the canvas,
     and closing left focus nowhere.

     Same three pieces as components/ui/ConfirmDialog.js, for the same reasons:
     move focus in (the first margin field, because typing a number is what
     this dialog is for), trap Tab inside while it is open, and hand focus back
     to whatever opened it on the way out. */
  const cardRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    openerRef.current = document.activeElement
    const first = cardRef.current?.querySelector('input')
    first?.focus()
    first?.select?.()
    return () => { try { openerRef.current?.focus?.() } catch { /* the opener may be gone */ } }
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Tab') return
      const f = cardRef.current?.querySelectorAll('input, button:not([disabled])')
      if (!f?.length) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    /* Capture, so the canvas keymap does not see Tab first and move focus to
       an island button behind the scrim. */
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  /* The fields hold what you TYPE, validated as you go. They used to be
     normalised on every keystroke, so clearing a field to retype it wrote 0,
     and 20″ on an A4 page was accepted and then silently squashed. */
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const bump = (k, dir) => setDraft(d => ({
    ...d,
    [k]: Math.max(MIN_MARGIN, normalizeMargin((Number(d[k]) || 0) + dir * MARGIN_STEP, 1)),
  }))
  const num = k => (String(draft[k]).trim() === '' ? NaN : Number(draft[k]))
  const bad = {}
  let problem = ''
  for (const k of ['top', 'bottom', 'left', 'right']) {
    const v = num(k)
    if (!Number.isFinite(v)) { bad[k] = true; problem = problem || 'Enter a number for every side.' }
    else if (v < MIN_MARGIN) { bad[k] = true; problem = problem || `The smallest margin is ${MIN_MARGIN}″.` }
  }
  /* The gutter: extra room on the binding side (the left, or with mirror
     margins the inside of each spread). */
  const gutterN = String(draft.gutter ?? '').trim() === '' ? 0 : Number(draft.gutter)
  const gutterOk = Number.isFinite(gutterN) && gutterN >= 0 && gutterN <= 2
  if (!gutterOk) { bad.gutter = true; problem = problem || 'The gutter is 0–2″.' }
  if (!problem && num('left') + num('right') + gutterN > page.w - 1) { bad.left = bad.right = true; problem = `Left and right leave less than 1″ for text on a ${page.w}″ page.` }
  if (!problem && num('top') + num('bottom') > page.h - 1) { bad.top = bad.bottom = true; problem = `Top and bottom leave less than 1″ for text on a ${page.h}″ page.` }
  const ok = () => {
    if (problem) return
    onOk({ top: normalizeMargin(num('top')), bottom: normalizeMargin(num('bottom')), left: normalizeMargin(num('left')), right: normalizeMargin(num('right')) },
      { gutter: gutterOk ? Math.round(gutterN * 100) / 100 : 0, mirror: !!draft.mirror })
  }

  /* The preview is the PAGE's real aspect ratio with the draft margins drawn
     inside it, so a value that leaves no room for text looks like a page with
     no room for text before you press OK. */
  const PREV_W = 92
  const previewH = Math.round(PREV_W * (page.h / page.w))
  const pct = (inches, extent) => `${Math.max(0, Math.min(48, (inches / extent) * 100))}%`

  return (
    <>
      <div data-ds-scrim onMouseDown={onCancel}
        style={{ position: 'fixed', inset: 0, zIndex: Z.dialogScrim, background: 'rgba(0,0,0,0.28)' }} />
      <div
        ref={cardRef}
        role="dialog" aria-modal="true" aria-label="Custom margins"
        data-ds-dialog data-kbd-zone
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          zIndex: Z.dialog, width: 400, maxWidth: 'calc(100vw - 32px)',
          background: surface, border: `1px solid ${border}`,
          borderRadius: 'var(--ds-radius-lg)', boxShadow: 'var(--ds-shadow-lg)',
          fontFamily: 'var(--ds-font-body)', overflow: 'hidden',
          animation: 'dsDialogIn var(--ds-motion-enter) var(--ds-ease-overshoot)',
        }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${border}`, fontSize: 13, fontWeight: 650, color: text }}>
          Custom margins
        </div>

        <div style={{ display: 'flex', gap: 16, padding: 14 }}>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {['top', 'bottom', 'left', 'right'].map(k => (
              <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 11, textTransform: 'capitalize', color: text3, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.5 }}>
                  {draft.mirror && k === 'left' ? 'inside' : draft.mirror && k === 'right' ? 'outside' : k}
                </span>
                <span style={{
                  display: 'flex', alignItems: 'center', height: 28,
                  border: `1px solid ${bad[k] ? 'var(--ds-red)' : border}`, borderRadius: 'var(--ds-radius-sm)',
                  background: raised, overflow: 'hidden',
                }}>
                  <input
                    type="number" step={MARGIN_STEP} min={MIN_MARGIN}
                    aria-invalid={!!bad[k]}
                    value={draft[k]}
                    onChange={e => set(k, e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') { e.preventDefault(); ok() }
                    }}
                    aria-label={`${k} margin, inches`}
                    style={{
                      flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                      color: text, fontFamily: 'var(--ds-font-mono)', fontSize: 13,
                      padding: '0 8px', MozAppearance: 'textfield',
                    }}
                  />
                  <span style={{ fontSize: 11, color: text3, paddingRight: 4 }}>″</span>
                  {/* Spinner buttons, 0.25″ steps — Word's own increment. */}
                  <span style={{ display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${border}` }}>
                    <button type="button" {...pressProps(() => bump(k, 1))}
                      aria-label={`Increase ${k} margin`}
                      style={{ width: 18, height: 14, border: 'none', background: 'none', color: text2, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}>▲</button>
                    <button type="button" {...pressProps(() => bump(k, -1))}
                      aria-label={`Decrease ${k} margin`}
                      style={{ width: 18, height: 14, border: 'none', background: 'none', color: text2, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0, borderTop: `1px solid ${border}` }}>▼</button>
                  </span>
                </span>
              </label>
            ))}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.5 }}>Gutter</span>
              <input type="number" step={MARGIN_STEP} min={0} max={2} value={draft.gutter ?? 0} aria-invalid={!!bad.gutter}
                aria-label="Gutter, inches"
                onChange={e => set('gutter', e.target.value)}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ok() } }}
                style={{ height: 28, border: `1px solid ${bad.gutter ? 'var(--ds-red)' : border}`, borderRadius: 'var(--ds-radius-sm)', background: raised, color: text, fontFamily: 'var(--ds-font-mono)', fontSize: 13, padding: '0 8px', outline: 'none', minWidth: 0 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'end', height: 28, fontSize: 12, color: text2, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!draft.mirror} onChange={e => setDraft(d => ({ ...d, mirror: e.target.checked }))} />
              Mirror margins
            </label>
          </div>

          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: PREV_W, height: previewH, position: 'relative',
              background: raised, border: `1px solid ${border}`, borderRadius: 4,
            }}>
              <div style={{
                position: 'absolute',
                top: pct(num('top') || 0, page.h), bottom: pct(num('bottom') || 0, page.h),
                left: pct((num('left') || 0) + (gutterOk ? gutterN : 0), page.w), right: pct(num('right') || 0, page.w),
                border: `1px dashed ${accent}`,
                background: `${accent}0f`,
              }} />
            </div>
            <span style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)' }}>{page.label}</span>
          </div>
        </div>

        <div role="alert" style={{ minHeight: problem ? 'auto' : 0, padding: problem ? '0 14px 10px' : 0, fontSize: 12, color: 'var(--ds-red)' }}>{problem}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '10px 14px', borderTop: `1px solid ${border}` }}>
          <button type="button" className="ds-btn" {...pressProps(() => onCancel())}>Cancel</button>
          <button type="button" className="ds-btn ds-btn-primary" disabled={!!problem} style={{ opacity: problem ? 0.5 : 1 }} {...pressProps(() => ok(), !!problem)}>OK</button>
        </div>
      </div>
    </>
  )
}
