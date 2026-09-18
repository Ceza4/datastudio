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
  { id: 'home',   label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'layout', label: 'Layout' },
  { id: 'view',   label: 'View' },
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
        fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.6,
        textTransform: 'uppercase', color: 'var(--ds-text-3)',
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
              width: 11, height: 11, padding: 0, border: 'none', background: 'none',
              color: 'var(--ds-text-3)', cursor: 'pointer', lineHeight: 1, fontSize: 11,
            }}>
            ⌄
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

  /* Band overflow. The band scrolls rather than wraps (see its own comment),
     and 227px of the Home tab — the entire STYLES group — used to sit behind a
     raw browser scrollbar with nothing saying it was there. Measuring the
     scroll position lets a fade appear on whichever side still has content. */
  const bandRef = useRef(null)
  /* One ref per tab, so the arrow keys can move focus as well as selection. */
  const tabRefs = useRef([])
  const scrollWrapRef = useRef(null)
  const [overflow, setOverflow] = useState('')
  const measureOverflow = () => {
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
    return () => ro.disconnect()
  })

  /* The last selection range seen inside a document body. See the note on
     `exec` below for why this has to be remembered rather than read live. */
  const savedRange = useRef(null)
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      if (!sel?.rangeCount) return
      const r = sel.getRangeAt(0)
      if (docRootOf(r)) savedRange.current = r.cloneRange()
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

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
    return document.execCommand(cmd, false, value)
  }
  const patch = p => onUpdateBlock?.(block.id, p)

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
  const page = pageInches(block.pageSize, block.orientation)

  /* The BOX. Where it goes is <Pop>'s problem — see its comment. */
  const popover = {
    background: surface, border: `1px solid ${border}`,
    borderRadius: 'var(--ds-radius-md)', boxShadow: 'var(--ds-shadow-lg)',
    padding: 5, minWidth: 170,
  }

  /* ── Home ── */
  const homeBand = (
    <>
      <Group label="Font" launcher onLaunch={() => setMenu('font')}>
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
              {block.font || 'Inter'}
            </span>
            <Icon name="nav-chevron-down" size={12} style={{ flexShrink: 0, color: text3 }} />
          </button>
          {menu === 'font' && (
            <Pop style={popover}>
              {DOC_FONTS.map(f => (
                <button key={f.name} type="button"
                  {...pressProps(() => {
                    exec('fontName', f.name)
                    patch({ font: f.name })
                    setMenu(null)
                  })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', borderRadius: 'var(--ds-radius-sm)',
                    color: text2, cursor: 'pointer', padding: '6px 10px', fontSize: 13,
                    fontFamily: f.stack,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}>
                  <span style={{ flex: 1 }}>{f.name}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--ds-font-mono)', color: text3 }}>{f.group}</span>
                </button>
              ))}
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
              value={block.fontSize || 11}
              onChange={e => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n > 0) patch({ fontSize: Math.min(200, Math.max(6, n)) })
              }}
              onKeyDown={e => e.stopPropagation()}
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
                  {...pressProps(() => { patch({ fontSize: n }); setMenu(null) })}
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
        <RibbonBtn title="Bold" onClick={() => exec('bold')}><b style={{ fontSize: 13 }}>B</b></RibbonBtn>
        <RibbonBtn title="Italic" onClick={() => exec('italic')}><i style={{ fontSize: 13, fontFamily: 'var(--ds-font-body)' }}>I</i></RibbonBtn>
        <RibbonBtn title="Underline" onClick={() => exec('underline')}><u style={{ fontSize: 13 }}>U</u></RibbonBtn>
        <RibbonBtn title="Strikethrough" onClick={() => exec('strikeThrough')}><s style={{ fontSize: 13 }}>S</s></RibbonBtn>

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
      </Group>

      <Group label="Paragraph" launcher onLaunch={() => setMenu('spacing')}>
        {/* ALIGNMENT AS DRAWN GLYPHS, not four copies of one icon.

            There is no alignment icon in the 129-icon set, and the obvious
            fallback — reusing `text-bullet-list` four times — would be worse
            than nothing: four identical icons say the four controls do the same
            thing. Three stacked bars whose lengths and offsets actually differ
            per alignment is the universal shape for this and reads correctly at
            13px, so it stands in until the real four are drawn. */}
        <RibbonBtn title="Align left" onClick={() => exec('justifyLeft')}><AlignGlyph mode="left" /></RibbonBtn>
        <RibbonBtn title="Align centre" onClick={() => exec('justifyCenter')}><AlignGlyph mode="center" /></RibbonBtn>
        <RibbonBtn title="Align right" onClick={() => exec('justifyRight')}><AlignGlyph mode="right" /></RibbonBtn>
        <RibbonBtn title="Justify" onClick={() => exec('justifyFull')}><AlignGlyph mode="justify" /></RibbonBtn>
        <Sep />
        <RibbonBtn title="Bullet list" icon="text-bullet-list" onClick={() => exec('insertUnorderedList')} />
        <RibbonBtn title="Numbered list" icon="text-numbered-list" onClick={() => exec('insertOrderedList')} />
        <Sep />
        <RibbonBtn title="Decrease indent" onClick={() => exec('outdent')}>
          <span style={{ fontSize: 13 }}>⇤</span>
        </RibbonBtn>
        <RibbonBtn title="Increase indent" onClick={() => exec('indent')}>
          <span style={{ fontSize: 13 }}>⇥</span>
        </RibbonBtn>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <RibbonBtn wide title="Line spacing" label={`${block.lineSpacing || 1.5}×`}
            onClick={() => setMenu(m => (m === 'spacing' ? null : 'spacing'))} />
          {menu === 'spacing' && (
            <Pop style={{ ...popover, minWidth: 110 }}>
              {LINE_SPACINGS.map(sp => (
                <button key={sp.id} type="button"
                  {...pressProps(() => { patch({ lineSpacing: sp.id }); setMenu(null) })}
                  style={{
                    display: 'flex', width: '100%', gap: 8, background: 'transparent', border: 'none',
                    borderRadius: 'var(--ds-radius-sm)', color: (block.lineSpacing || 1.5) === sp.id ? accent : text2,
                    cursor: 'pointer', padding: '6px 10px', fontSize: 13, fontFamily: 'var(--ds-font-body)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <span style={{ flex: 1, textAlign: 'left' }}>{sp.label}</span>
                  <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11 }}>{sp.id}×</span>
                </button>
              ))}
            </Pop>
          )}
        </div>
      </Group>

      {/* A GALLERY, not four identical buttons with different labels. Each style
          is shown at its own weight and size, so picking one previews it — the
          way Word's Styles gallery always has. Four buttons reading H1 H2 H3 ¶
          in the same 11.5px type tell you the names and nothing about the
          result. */}
      <Group label="Styles">
        {[
          { cmd: 'h1',  label: 'H1',     size: 15, weight: 700 },
          { cmd: 'h2',  label: 'H2',     size: 13, weight: 700 },
          { cmd: 'h3',  label: 'H3',     size: 12, weight: 600 },
          { cmd: 'div', label: 'Normal', size: 11, weight: 400 },
        ].map(st => (
          <button key={st.cmd} type="button"
            {...pressProps(() => exec('formatBlock', st.cmd))}
            title={st.cmd === 'div' ? 'Normal paragraph' : `Heading ${st.cmd.slice(1)}`}
            style={{
              height: 26, padding: '0 8px', flexShrink: 0,
              border: `1px solid ${border}`, borderRadius: 'var(--ds-radius-xs)',
              background: raised, color: text, cursor: 'pointer',
              fontFamily: 'var(--ds-font-head)',
              fontSize: st.size, fontWeight: st.weight, lineHeight: 1,
              transition: 'background var(--ds-transition), border-color var(--ds-transition)',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = accent }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = border }}>
            {st.label}
          </button>
        ))}
      </Group>
    </>
  )

  /* ── Insert ── */
  const insertBand = (
    <>
      <Group label="Insert">
        <RibbonBtn wide title="Insert a table" icon="block-table" label="Table" onClick={() => onInsert?.('table')} />
        <RibbonBtn wide title="Insert an image" icon="block-image" label="Image" onClick={() => onInsert?.('image')} />
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
        {/* A REAL EXPORT DIRECTIVE, unlike the automatic guide lines.

            §4's guides are an arithmetic estimate and are explicitly not
            guaranteed to match the export. This one is: a marker the user
            places deliberately, honoured exactly at export, forcing a break
            regardless of where the estimate would have put one. That is what
            gives explicit control ("this section starts on a fresh page")
            without reintroducing live reflow — it is a typed position in the
            content, read once at export time. */}
        <RibbonBtn wide title="Force a page break here — honoured exactly on export"
          icon="text-divider" label="Page break" onClick={() => onInsert?.('pagebreak')} />
      </Group>
    </>
  )

  /* ── Layout ── */
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
              <button type="button"
                {...pressProps(() => {
                  setMarginDialog({ ...margins })
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

        <RibbonBtn wide title="Portrait" label="Portrait"
          on={(block.orientation || 'portrait') === 'portrait'}
          onClick={() => patch({ orientation: 'portrait' })} />
        <RibbonBtn wide title="Landscape" label="Landscape"
          on={block.orientation === 'landscape'}
          onClick={() => patch({ orientation: 'landscape' })} />

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
            </Pop>
          )}
        </div>
      </Group>
      <Group label="Export">
        <RibbonBtn wide title="Export as a Word document" icon="format-word" label=".docx" onClick={() => onExport?.('docx')} />
        <RibbonBtn wide title="Export as a PDF" icon="format-pdf" label=".pdf" onClick={() => onExport?.('pdf')} />
      </Group>
    </>
  )

  /* ── View ── */
  const viewBand = (
    <Group label="Show">
      <RibbonBtn wide dot title="Ruler — drag its markers to change the margins"
        label="Ruler" on={!!block.showRuler} onClick={() => patch({ showRuler: !block.showRuler })} />
      <RibbonBtn wide dot title="Dashed page-boundary guides"
        label="Page guides" on={block.showGuides !== false} onClick={() => patch({ showGuides: block.showGuides === false })} />
      <RibbonBtn wide dot title="Word count in the status bar"
        label="Word count" on={block.showWordCount !== false} onClick={() => patch({ showWordCount: block.showWordCount === false })} />
    </Group>
  )

  const band = tab === 'home' ? homeBand : tab === 'insert' ? insertBand : tab === 'layout' ? layoutBand : viewBand

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

      {/* ── QUICK ACCESS TOOLBAR ──
          A thin row above the tabs, exactly where Word puts it. Small, and one
          of the most recognisable pieces of Word's real chrome — and Undo/Redo
          have to live somewhere regardless, so it costs almost nothing. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '4px 8px', borderBottom: `1px solid ${border}`,
        background: raised,
      }}>
        <RibbonBtn title="Save" icon="action-check" onClick={() => onExport?.('save')} />
        <RibbonBtn title="Undo" icon="draw-undo" onClick={() => exec('undo')} />
        <RibbonBtn title="Redo" onClick={() => exec('redo')}>
          <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}>
            <Icon name="draw-undo" size={14} />
          </span>
        </RibbonBtn>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.5,
          color: text3, textTransform: 'uppercase',
        }}>
          {page.label} · {block.orientation === 'landscape' ? 'Landscape' : 'Portrait'}
        </span>
      </div>

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
      <div role="tablist" aria-label="Ribbon" style={{
        display: 'flex', gap: 2, padding: '4px 8px 0',
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
          onOk={() => { patch({ margins: { ...marginDialog } }); setMarginDialog(null) }}
        />,
        document.body,
      )}
    </div>
  )
}

/* ── The Custom Margins dialog ────────────────────────────────────────── */

function MarginDialog({ draft, setDraft, block, colors, onCancel, onOk }) {
  const { surface, raised, border, text, text2, text3, accent } = colors
  const page = pageInches(block.pageSize, block.orientation)

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

  const set = (k, v) => setDraft(d => ({ ...d, [k]: normalizeMargin(v, d[k]) }))
  const bump = (k, dir) => setDraft(d => ({
    ...d,
    [k]: Math.max(0, normalizeMargin((Number(d[k]) || 0) + dir * MARGIN_STEP, d[k])),
  }))

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
          zIndex: Z.dialog, width: 372,
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
              <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, textTransform: 'capitalize', color: text3, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.5 }}>
                  {k}
                </span>
                <span style={{
                  display: 'flex', alignItems: 'center', height: 28,
                  border: `1px solid ${border}`, borderRadius: 'var(--ds-radius-sm)',
                  background: raised, overflow: 'hidden',
                }}>
                  <input
                    type="number" step={MARGIN_STEP} min={0}
                    value={draft[k]}
                    onChange={e => set(k, e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') { e.preventDefault(); onOk() }
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
          </div>

          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: PREV_W, height: previewH, position: 'relative',
              background: raised, border: `1px solid ${border}`, borderRadius: 4,
            }}>
              <div style={{
                position: 'absolute',
                top: pct(draft.top, page.h), bottom: pct(draft.bottom, page.h),
                left: pct(draft.left, page.w), right: pct(draft.right, page.w),
                border: `1px dashed ${accent}`,
                background: `${accent}0f`,
              }} />
            </div>
            <span style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)' }}>{page.label}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '10px 14px', borderTop: `1px solid ${border}` }}>
          <button type="button" className="ds-btn" {...pressProps(() => onCancel())}>Cancel</button>
          <button type="button" className="ds-btn ds-btn-primary" {...pressProps(() => onOk())}>OK</button>
        </div>
      </div>
    </>
  )
}
