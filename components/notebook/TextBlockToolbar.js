'use client'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { safeLinkUrl } from '../../lib/urls'
import { Z, SWATCHES, INK_SWATCH } from '../../lib/theme'
import { columnsFromNodes, nodesInRange } from '../../lib/columns'
import { CHECKLIST_HTML, caretIntoChecklist } from '../../lib/checklist'
import { elementFrom } from '../../lib/insertblock'

const COLUMN_COUNTS = [2, 3, 4, 5]

/* TextBlockToolbar — selection-anchored formatting pill.
   --------------------------------------------------------------------------
   v4. v3 was a 168px panel DOCKED TO THE RIGHT EDGE OF THE VIEWPORT
   (`position:fixed; right:16; top:50%`), shown whenever the block was
   selected — not when any text was selected. On an infinite, pannable canvas
   that put the controls a whole screen away from the words they act on, and it
   left "this block is in edit mode" chrome sitting there while you were
   reading rather than writing.

   Now: a horizontal pill anchored ABOVE THE ACTUAL TEXT SELECTION, following
   it as it moves, hidden the moment the selection collapses. Same model as
   Notion, Medium and Docs — and the standard pattern for any future block with
   inline text.

   WHAT CARRIED OVER UNCHANGED, DELIBERATELY
   The execCommand logic underneath is identical. The Link menu's saved-Range
   handling, the `safeLinkUrl` scheme check, and the `rel="noopener noreferrer"`
   patch on inserted links are all verbatim from v3 — they were correct, and
   only the chrome and layout are being redesigned. So are the letterform
   B/I/U/S glyphs: bold-as-a-bold-B beats a novel icon against thirty years of
   muscle memory, and that reasoning did not change with the layout.

   WHY THERE IS A rAF LOOP AND NOT A CANVAS SUBSCRIPTION
   The pill renders in SCREEN space (position:fixed, portalled to <body>) but
   anchors to a selection that lives in CANVAS space, inside a CSS transform
   the canvas rewrites on every frame of a pan or a zoom. `selectionchange`
   does not fire for either. Rather than reach into NotebookCanvas for its
   camera — which would couple a text toolbar to the canvas's internals and
   break the moment this is reused in the Document block — the loop re-measures
   `range.getBoundingClientRect()` each frame while the pill is visible and
   only writes state when the rect actually moved. It runs during a live text
   selection and nowhere else.

   CORE ROW vs. SECONDARY SECTION
   Normal (¶) is in the CORE row, not behind the chevron: the paragraph is
   where a person spends most of their time and the only way back out of a
   heading. H3 is the one that moved out — third-most-used of the three.
   -------------------------------------------------------------------------- */

const FONTS = [
  'Inter', 'DM Sans', 'Times New Roman', 'Georgia', 'Helvetica',
  'Arial', 'Courier New', 'Verdana',
]

/* Text colours are the SHARED swatch set, not a private array.

   v3's `COLORS` was 8 hardcoded hex values, and one of them was `#5B5FE8` —
   the DARK-THEME accent, as a literal. In light mode that swatch painted a
   blue corresponding to nothing in the light palette (`--ds-accent` is
   `#1D9E75` there), so a third of the picker was the other theme's identity.

   SWATCHES is the same eight the pen tool and the Kanban card tags already
   use, each chosen in lib/theme.js to clear 3.8:1 against BOTH canvas grounds.
   INK_SWATCH goes FIRST and is the theme-following option — a solid fill of
   var(--ds-text), which against this popover's own ground reads as "the
   current text colour" without needing a label. */
const COLOR_OPTIONS = [INK_SWATCH, ...SWATCHES]

/* Cell — one square control in the pill.

   Module scope, NOT declared inside TextBlockToolbar. A component created
   during render is a brand-new type every render, so React tears down all
   nineteen buttons and their icon subtrees and rebuilds them rather than
   updating them — and the hover highlight, written imperatively onto the node,
   falls off the button the cursor is still sitting on. That bug was visible in
   v3 on every frame of a drag; the fix is kept.

   MOUSEDOWN, NOT CLICK, AND preventDefault FIRST. execCommand acts on the
   DOCUMENT's selection. A click lets the browser collapse that selection to
   the press point before the command runs, so the format applies to nothing.
   Every control in this file — including the ones inside the popovers — must
   keep this. */
/* `active`: the selection already has this format (bold text, a heading
   line). Shown as the accent tint, so Bold visibly reads as on when the
   selected text is already bold (24 Sep 2026). Colour and tint only, never
   weight or size, so an active button cannot change the pill's width. */
const Cell = forwardRef(function Cell({ run, title, children, wide, disabled, colors, active, style: styleOverride, ...rest }, fwdRef) {
  const { raised, text, text2, text3, accent, accentDim } = colors
  const restBg = active ? accentDim : 'transparent'
  const restFg = disabled ? text3 : active ? accent : text2
  return (
    <button
      ref={fwdRef}
      type="button"
      onMouseDown={e => { e.preventDefault(); if (!disabled) run(e) }}
      title={title}
      aria-label={title}
      disabled={disabled}
      style={{
        height: 28,
        width: wide ? undefined : 28,
        padding: wide ? '0 8px' : 0,
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        background: restBg,
        border: 'none',
        borderRadius: 6,
        color: restFg,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--ds-font-body)',
        fontSize: wide ? 11 : 14,
        lineHeight: 1,
        transition: 'background var(--ds-motion-hover) var(--ds-ease-standard), color var(--ds-motion-hover) var(--ds-ease-standard)',
        ...styleOverride,
      }}
      aria-pressed={active === undefined ? undefined : !!active}
      onMouseEnter={e => { if (disabled) return; e.currentTarget.style.background = active ? accentDim : raised; e.currentTarget.style.color = active ? accent : text }}
      onMouseLeave={e => { if (disabled) return; e.currentTarget.style.background = restBg; e.currentTarget.style.color = restFg }}
      {...rest}
    >
      {children}
    </button>
  )
})

/* 1px group boundary. Replaces v3's uppercase group-label ROWS: one row has no
   vertical space for a text header per group, and a hairline says the same
   thing in 1px. */
function Sep() {
  return <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--ds-border)', margin: '0 4px', flexShrink: 0 }} />
}

/* How much clearance the pill needs above the selection before it flips below
   it. Its own 34px plus the 10px gap plus a little slack. */
const FLIP_CLEARANCE = 60
const GAP = 10
const EDGE = 8          // minimum distance from any viewport edge

export default function TextBlockToolbar({ colors, onClose, editableRef }) {
  const { surface, raised, border, text, text2, text3, accent } = colors
  const ref = useRef(null)
  const [menu, setMenu] = useState(null)   // null | 'font' | 'color' | 'link'
  const [expanded, setExpanded] = useState(false)
  /* What the current selection already is: which inline formats are on,
     and which block it sits in. Read from the browser (queryCommandState /
     queryCommandValue), the same source execCommand uses to decide whether
     a press turns a format on or off, so the button and the action agree. */
  const [active, setActive] = useState({})
  const readActive = useCallback(() => {
    const q = c => { try { return document.queryCommandState(c) } catch { return false } }
    let block = ''
    try { block = String(document.queryCommandValue('formatBlock') || '').toLowerCase() } catch { /* ignore */ }
    const next = {
      bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
      ul: q('insertUnorderedList'), ol: q('insertOrderedList'), block,
    }
    setActive(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [])
  /* The secondary section, measured so the pill is placed from its CORE
     width. See placeFrom. */
  const secondaryRef = useRef(null)
  const styleBtnRef = useRef(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState(null)
  /* Shown when Link is pressed with nothing selected. A hint, not an error:
     nothing has gone wrong, there is just a step missing. */
  const [hint, setHint] = useState(null)
  /* The text selection as it was when the link menu opened, because focusing
     the input below destroys it. */
  const savedRange = useRef(null)

  /* { left, top, flipped } in screen px, or null for "no selection, hidden".
     `null` is the whole visibility model — there is no separate open flag. */
  const [pos, setPos] = useState(null)
  /* Set once per appearance so the overshoot entry plays on the initial show
     and NOT on every re-centre as the selection is extended. */
  const [entryKey, setEntryKey] = useState(0)
  const visibleRef = useRef(false)

  /* The live Range, held so the rAF loop can re-measure it without going back
     through window.getSelection() (which may have moved into a popover input). */
  const anchorRange = useRef(null)
  const lastRect = useRef(null)

  /* Is this range inside THIS block's editable?

     Guarding on the specific element, not just "some [data-ds-text]", because
     several Notes blocks can be on screen at once and each mounts its own
     toolbar. Without the identity check every one of them would show a pill
     for a selection in any of the others. */
  const rangeIsOurs = useCallback(range => {
    if (!range) return false
    const node = range.commonAncestorContainer
    const el = node?.nodeType === 1 ? node : node?.parentElement
    const host = el?.closest?.('[data-ds-text]')
    if (!host) return false
    const ours = editableRef?.current
    return ours ? host === ours : true
  }, [editableRef])

  /* Place the pill from a measured selection rect. Clamped against the
     VIEWPORT, not any canvas-local container: the pill is position:fixed and
     portals to <body>, so it lives in screen space. */
  const placeFrom = useCallback(rect => {
    const el = ref.current
    const w = el?.offsetWidth || 240
    const h = el?.offsetHeight || 34
    const vw = window.innerWidth
    const vh = window.innerHeight

    /* CENTRED ON THE CORE ROW, NOT THE WHOLE PILL (24 Sep 2026).
       Centring on the full width meant opening the secondary section (about
       +420px) re-centred the pill: it jumped left by half the growth, and
       every core button moved with it. The core row's width is the pill minus
       the secondary section, measured live, so it is the same collapsed or
       expanded. The pill now grows to the right from a fixed left edge, and
       only moves if it would otherwise run off the screen. */
    const coreW = Math.max(0, w - (secondaryRef.current?.offsetWidth || 0))
    let left = rect.left + rect.width / 2 - coreW / 2
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE))

    const flipped = rect.top < FLIP_CLEARANCE
    let top = flipped ? rect.bottom + GAP : rect.top - h - GAP
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE))

    setPos(prev => (prev && prev.left === left && prev.top === top && prev.flipped === flipped)
      ? prev
      : { left, top, flipped })
  }, [])

  const hide = useCallback(() => {
    if (!visibleRef.current) return
    visibleRef.current = false
    anchorRange.current = null
    lastRect.current = null
    setPos(null)
    setMenu(null)
    setExpanded(false)
    setHint(null)
  }, [])

  /* ── Selection tracking ────────────────────────────────────────────────
     Show only for a NON-COLLAPSED selection inside our own editable. A
     collapsed caret, or a selection somewhere else entirely, hides the pill
     and closes any popover immediately.

     This is a real behaviour change from v3, which showed its panel whenever
     the BLOCK was selected regardless of text selection. It is intentional:
     there is no persistent "this block is in edit mode" chrome any more, only
     a toolbar that appears when there is something for it to act on. */
  useEffect(() => {
    function onSelectionChange() {
      /* While the Link input owns focus the document selection is inside that
         input, so re-reading it here would hide the pill out from under the
         URL being typed into it. The saved Range is the selection that
         matters at that point. */
      if (menu === 'link') return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hide(); return }
      const range = sel.getRangeAt(0)
      if (!rangeIsOurs(range)) { hide(); return }
      anchorRange.current = range.cloneRange()
      const rect = range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) { hide(); return }
      lastRect.current = rect
      if (!visibleRef.current) {
        visibleRef.current = true
        setEntryKey(k => k + 1)
      }
      placeFrom(rect)
      readActive()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    onSelectionChange()
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [hide, placeFrom, rangeIsOurs, menu, readActive])

  /* ── Follow the canvas ─────────────────────────────────────────────────
     Pan, zoom, a scroll inside the block, a window resize: none of these fire
     selectionchange, and all of them move the text under a pill that is
     positioned in screen space. Re-measure each frame while visible; write
     state only when the rect actually moved, so a still canvas costs one
     getBoundingClientRect per frame and zero renders. */
  useEffect(() => {
    if (!pos) return
    let raf = 0
    function tick() {
      raf = requestAnimationFrame(tick)
      const range = anchorRange.current
      if (!range) return
      const rect = range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return
      const prev = lastRect.current
      if (prev
        && Math.abs(prev.left - rect.left) < 0.5
        && Math.abs(prev.top - rect.top) < 0.5
        && Math.abs(prev.width - rect.width) < 0.5) return
      lastRect.current = rect
      placeFrom(rect)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pos, placeFrom])

  /* Opening the secondary section grows the pill by roughly +300px, which can
     push it past the right edge of the viewport. Re-clamp from the same
     measured rect rather than waiting for the next selection change. */
  useEffect(() => {
    if (!pos || !lastRect.current) return
    /* Two frames: one for the max-width transition to have started laying out,
       one to measure the new offsetWidth. */
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (lastRect.current) placeFrom(lastRect.current)
    }))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, menu])

  /* Click-outside and Escape. Verbatim in behaviour from v3: Esc closes the
     open popover FIRST and the toolbar second, because collapsing both at once
     means one stray Esc while picking a colour loses the whole thing. */
  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        hide()
        onClose?.()
      }
    }
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return
      if (menu) { setMenu(null); e.stopPropagation(); return }
      if (expanded) { setExpanded(false); e.stopPropagation(); return }
      hide()
      onClose?.()
    }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, menu, expanded, hide])

  /* `value` defaults to undefined, not null. execCommand stringifies what it
     is given, so insertHorizontalRule with null wrote <hr id="null"> into
     the note. After every command the active states are read again, so Bold
     flips the moment it is pressed. */
  function exec(cmd, value) {
    if (value === undefined) document.execCommand(cmd, false)
    else document.execCommand(cmd, false, value)
    readActive()
  }

  /* NORMAL TEXT: back to a plain paragraph AND no inline formatting.
     It only did formatBlock('div'), which un-heads a heading but leaves bold,
     italic, underline, strike, colour and font exactly as they were, so on
     bold text it looked like it did nothing. A list item comes out of its
     list too. Links are kept: they are content, not formatting. */
  function makeNormal() {
    if (safeState('insertUnorderedList')) document.execCommand('insertUnorderedList', false)
    if (safeState('insertOrderedList')) document.execCommand('insertOrderedList', false)
    document.execCommand('formatBlock', false, 'div')
    document.execCommand('removeFormat', false)
    /* removeFormat is unreliable on a MIXED selection (part bold, part not):
       Chrome left the <b> in place, and queryCommandState reports "not bold"
       for a mixed run, so toggling cannot catch it either. So every
       formatting element the selection touches is unwrapped by hand,
       keeping its text. Teleport links (span[data-ds-link]) and real links
       are content, not formatting, and are left alone. */
    const sel = window.getSelection()
    const root = editableRef?.current
    if (root && sel?.rangeCount) {
      const range = sel.getRangeAt(0)
      const els = Array.from(root.querySelectorAll('b,strong,i,em,u,s,strike,del,font,span:not([data-ds-link]):not([data-type])'))
        .filter(el => !el.closest('[data-type="checklist"]') || el.tagName !== 'SPAN' || el.parentElement?.getAttribute('data-type') !== 'checklist')
        .filter(el => { try { return range.intersectsNode(el) } catch { return false } })
      for (const el of els.reverse()) el.replaceWith(...Array.from(el.childNodes))
      if (els.length) root.dispatchEvent(new Event('input', { bubbles: true }))
    }
    readActive()
  }
  function safeState(c) { try { return document.queryCommandState(c) } catch { return false } }

  /* TURN THE SELECTED LINES INTO CHECKLIST ITEMS.
     This used insertHTML with an empty item, which REPLACED the selected text
     with the item (the text ended up gone or sitting behind the checkbox) and
     arrived broken the same way the / command's did (see lib/insertblock.js).
     Now every selected line becomes an item holding that line's own text, built
     by hand. A list's items each become a checklist item. An 'input' event is
     dispatched afterwards, because direct DOM edits do not fire one and the
     Notes autosave listens for it. */
  function turnIntoChecklist() {
    const root = editableRef?.current
    const sel = window.getSelection()
    if (!root || !sel?.rangeCount) return
    const range = sel.getRangeAt(0)
    let lines = nodesInRange(root, range)
    if (!lines.length) return
    const made = []
    for (const line of lines) {
      if (line.getAttribute?.('data-type') === 'checklist') { made.push(line); continue }
      const sources = (line.tagName === 'UL' || line.tagName === 'OL') ? Array.from(line.children) : [line]
      const items = sources.map(src => {
        const item = elementFrom(CHECKLIST_HTML)
        const span = item.querySelector('span')
        span.innerHTML = ''
        /* Headings and quotes give up their block, keep their words. */
        for (const n of Array.from(src.childNodes)) span.appendChild(n)
        if (!span.textContent.trim() && !span.querySelector('img')) span.innerHTML = '<br>'
        return item
      })
      line.replaceWith(...items)
      made.push(...items)
    }
    const last = made[made.length - 1]
    if (last) {
      const span = last.querySelector('span')
      const r = document.createRange(); r.selectNodeContents(span); r.collapse(false)
      root.focus(); sel.removeAllRanges(); sel.addRange(r)
    }
    root.dispatchEvent(new Event('input', { bubbles: true }))
    hide()
    onClose?.()
  }

  /* "Turn into N columns" — the one control in this pill that acts on a
     MULTI-paragraph selection rather than the character-level formatting
     every other button here applies. It lives here rather than the slash
     menu for a real reason, not convenience: the slash menu only ever fires
     at a collapsed caret (see TextBlockContent.js's detectSlash — it reads
     the caret's own text node), so it can never see a selection spanning
     several paragraphs in the first place. This pill already only renders
     when there IS a non-collapsed selection, which is exactly the condition
     this control needs — so no extra "is there a selection" check is needed
     here, unlike the ribbon's equivalent (DocumentRibbon.js), which has no
     such guarantee and disables its own Turn-into rows instead.

     Goes through execCommand('insertHTML'), NOT direct DOM surgery
     (insertAdjacentHTML + .remove()) — that would never fire the 'input'
     event TextBlockContent's autosave listens for, so the change would
     render but silently never be saved. Selecting the exact span of
     top-level nodes being replaced and handing that same selection to
     execCommand is what every other structural insert in this codebase
     already does; this reuses it rather than inventing a second path. */
  function turnIntoColumns(n) {
    const root = editableRef?.current
    const sel = window.getSelection()
    if (!root || !sel?.rangeCount || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const nodes = nodesInRange(root, range)
    if (!nodes.length) return
    const html = columnsFromNodes(nodes.map(el => el.outerHTML), n)
    const full = document.createRange()
    full.setStartBefore(nodes[0])
    full.setEndAfter(nodes[nodes.length - 1])
    /* Focus FIRST, then restore the Range — same order commitLink() above
       uses and documents: a range set into an unfocused element is not a
       selection execCommand will act on. */
    root.focus()
    sel.removeAllRanges()
    sel.addRange(full)
    document.execCommand('insertHTML', false, html)
    setMenu(null)
    hide()
    onClose?.()
  }

  /* Reached through Cell, which acts on mousedown and preventDefaults first —
     the rail's convention and the reason every other control works at all.

     Link is the one control that then deliberately takes focus AWAY, to the
     input below, which drops the selection. So the Range is cloned here and
     restored in commitLink. Deleting that restore makes the link apply to
     nothing at all, silently. */
  function openLinkMenu() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setHint('Select some text first, then press Link.')
      return
    }
    savedRange.current = sel.getRangeAt(0).cloneRange()
    setLinkUrl('https://')
    setLinkError(null)
    setMenu('link')
  }

  function commitLink() {
    /* createLink took the prompt string verbatim, so `javascript:…` typed here
       became a live href that executes on ctrl-click — and persists into block
       content, so a shared template could carry one behind plausible link
       text. Allow the three schemes a document link can legitimately use and
       refuse the rest. A bare `example.com` is treated as https rather than
       rejected, because that is what people type. */
    const safe = safeLinkUrl(linkUrl)
    if (!safe) {
      setLinkError('Only http, https and mailto links can be added.')
      return
    }
    /* execCommand acts on the DOCUMENT's selection, and the input above owns
       it right now. Focus the editable FIRST and then restore the Range — a
       range restored into an unfocused element is not a selection execCommand
       will touch, and the link would apply to nothing at all. */
    const r = savedRange.current
    if (r) {
      const node = r.commonAncestorContainer
      const el = node?.nodeType === 1 ? node : node?.parentElement
      el?.closest?.('[data-ds-text]')?.focus?.()
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
    }
    exec('createLink', safe)
    setMenu(null)
    setLinkError(null)
    setTimeout(() => {
      /* rel matters as much as target. `target="_blank"` alone hands the
         destination page a live `window.opener` pointing back at DataStudio,
         which is enough to redirect this tab to a lookalike while the user is
         reading the page they just opened. */
      document.querySelectorAll('[data-ds-text] a:not([target])').forEach(a => {
        a.setAttribute('target', '_blank')
        a.setAttribute('rel', 'noopener noreferrer')
      })
    }, 0)
  }

  if (typeof document === 'undefined') return null

  const TEXT_STYLES = [
    { id: 'normal', label: 'Normal text', css: { fontSize: 13 } },
    { id: 'h1', label: 'Heading 1', css: { fontSize: 20, fontWeight: 700, fontFamily: 'var(--ds-font-head)' } },
    { id: 'h2', label: 'Heading 2', css: { fontSize: 16, fontWeight: 700, fontFamily: 'var(--ds-font-head)' } },
    { id: 'h3', label: 'Heading 3', css: { fontSize: 14, fontWeight: 600, fontFamily: 'var(--ds-font-head)' } },
  ]
  const currentStyle = ['h1', 'h2', 'h3'].includes(active.block) ? active.block : 'normal'
  const styleLabel = TEXT_STYLES.find(t => t.id === currentStyle).label

  const cellColors = { raised, text, text2, text3, accent, accentDim: colors.accentDim || 'var(--ds-accent-dim)' }
  /* Collapsed secondary controls are removed from the tab order outright, not
     just clipped. `max-width:0; overflow:hidden` hides them visually but the
     buttons are still full-size elements in the layout tree, so they stay
     focusable and can still be announced depending on how the clip interacts
     with the AT tree. tabIndex -1 plus aria-hidden is the part that actually
     takes them out. */
  const hiddenWhenCollapsed = expanded ? {} : { tabIndex: -1, 'aria-hidden': 'true' }

  const popover = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    background: surface,
    border: `1px solid ${border}`,
    borderRadius: 'var(--ds-radius-md)',
    boxShadow: 'var(--ds-shadow-md)',
    zIndex: 10,
  }

  const toolbar = (
    <div
      ref={ref}
      key={entryKey}
      onMouseDown={e => e.stopPropagation()}
      /* Capture, so it runs BEFORE the button that is about to set it. Any
         press anywhere in the pill clears the hint — by then you have either
         acted on it or moved on, and advice that outstays the moment it was
         given reads as an error nobody can dismiss. */
      onMouseDownCapture={() => setHint(null)}
      onClick={e => e.stopPropagation()}
      className="ds-island"
      data-island-rail
      data-kbd-zone
      role="toolbar"
      aria-label="Text formatting"
      style={{
        position: 'fixed',
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        zIndex: Z.popover,
        /* .ds-island already carries the glass, border, shadow and font. Only
           the radius differs: 10px, because a 34px-tall pill at the island's
           own 12px reads as a lozenge rather than a control. */
        borderRadius: 10,
        height: 34,
        padding: '0 4px',
        display: 'flex', alignItems: 'center',
        /* NOT `visibility:hidden`. `pointer-events:none` is the part that
           matters: a hidden-but-hit-testable pill floating over the canvas
           swallows clicks meant for whatever is underneath it. */
        opacity: pos ? 1 : 0,
        pointerEvents: pos ? 'auto' : 'none',
        animation: pos ? 'dsToolbarIn var(--ds-motion-enter) var(--ds-ease-overshoot)' : 'none',
        transition: 'opacity var(--ds-motion-exit) var(--ds-ease-standard)',
      }}
    >
      {/* ── Core: Style ── */}
      <Cell colors={cellColors} active={active.bold}      run={() => exec('bold')}          title="Bold"><b style={{ fontSize: 14 }}>B</b></Cell>
      <Cell colors={cellColors} active={active.italic}    run={() => exec('italic')}        title="Italic"><i style={{ fontSize: 14, fontFamily: 'var(--ds-font-body)' }}>I</i></Cell>
      <Cell colors={cellColors} active={active.underline} run={() => exec('underline')}     title="Underline"><u style={{ fontSize: 14 }}>U</u></Cell>
      <Cell colors={cellColors} active={active.strike}    run={() => exec('strikeThrough')} title="Strikethrough"><s style={{ fontSize: 14 }}>S</s></Cell>

      <Sep />

      {/* ── Core: Text style (24 Sep 2026) ──
          Normal text and the headings are ONE dropdown now, labelled with the
          current style, the way Claude's editor does it. It replaced three
          icon buttons (H1, H2, Normal) here plus H3 behind the chevron. The
          button has a FIXED width, so switching from "Normal text" to
          "Heading 1" cannot change the pill's width and move everything. */}
      <Cell colors={cellColors} wide
        ref={styleBtnRef}
        run={() => setMenu(m => (m === 'style' ? null : 'style'))}
        title="Text style"
        aria-haspopup="listbox" aria-expanded={menu === 'style'}
        style={{ width: 112, justifyContent: 'space-between', padding: '0 8px', fontSize: 12 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{styleLabel}</span>
        <Icon name="nav-chevron-down" size={12} />
      </Cell>

      <Sep />

      {/* ── Core: Lists ── */}
      <Cell colors={cellColors} active={active.ul} run={() => exec('insertUnorderedList')} title="Bullet list"><Icon name="text-bullet-list" size={16} /></Cell>
      <Cell colors={cellColors} active={active.ol} run={() => exec('insertOrderedList')}   title="Numbered list"><Icon name="text-numbered-list" size={16} /></Cell>

      {/* ── Secondary section. Slides open SIDEWAYS on max-width, not width or
             flex-basis: a max-width transition animates without the contents
             reflowing at every intermediate size, so the eight buttons inside
             don't shuffle as the pill grows. ── */}
      <div
        ref={secondaryRef}
        style={{
          display: 'flex', alignItems: 'center',
          /* 340 → 420: the Columns control (Sep + one wide Cell) added
             roughly 80px of content to this row; unchanged otherwise. */
          maxWidth: expanded ? 420 : 0,
          overflow: 'hidden',
          transition: 'max-width 0.2s var(--ds-ease-standard)',
        }}
      >

        <Sep />
        {/* NO accent-color in the inserted markup at all.

            v3 baked `accent-color:#5B5FE8` — the dark-theme accent — into the
            stored HTML at insert time. TextBlockContent's scoped stylesheet
            already sets `accent-color: var(--ds-accent) !important` on these
            checkboxes, precisely so checklists created BEFORE that fix render
            correctly despite their stored inline value. So writing a token
            inline here would be dead weight the !important rule overrides
            anyway; omitting it is the honest fix, and it makes that rule's own
            comment ("new checklists are written without the declaration at
            all") true, which it wasn't. */}
        <Cell {...hiddenWhenCollapsed} colors={cellColors} title="Checklist" run={turnIntoChecklist}><Icon name="text-checklist" size={16} /></Cell>
        <Cell {...hiddenWhenCollapsed} colors={cellColors} active={active.block === 'blockquote'} run={() => exec('formatBlock', 'blockquote')} title="Quote"><Icon name="text-quote" size={16} /></Cell>

        <Sep />
        <Cell {...hiddenWhenCollapsed} colors={cellColors} run={() => exec('insertHorizontalRule')} title="Divider"><Icon name="text-divider" size={16} /></Cell>
        {/* Inline "Code" was removed here (24 Sep 2026): it replaced the
            selection with the literal word "code" instead of formatting it.
            Code blocks live in the / menu. */}
        <Cell {...hiddenWhenCollapsed} colors={cellColors} run={openLinkMenu} title="Insert hyperlink" wide>Link</Cell>

        <Sep />
        <Cell {...hiddenWhenCollapsed} colors={cellColors} run={() => setMenu(m => (m === 'font' ? null : 'font'))} title="Font family" wide>
          Font <Icon name="nav-chevron-down" size={12} />
        </Cell>
        <Cell {...hiddenWhenCollapsed} colors={cellColors} run={() => setMenu(m => (m === 'color' ? null : 'color'))} title="Text colour" wide>
          Colour <Icon name="nav-chevron-down" size={12} />
        </Cell>

        <Sep />
        {/* Turn the CURRENT SELECTION into N columns. Real columns — laid
            out inline in the text, not the old floating "columns" block —
            see lib/columns.js. This is deliberately the only place "turn
            into columns" appears for Notes/Text blocks: the slash menu's
            plain "N columns" (an empty insert) lives there instead, because
            the slash menu can only ever act on a collapsed caret. */}
        <Cell {...hiddenWhenCollapsed} colors={cellColors} run={() => setMenu(m => (m === 'columns' ? null : 'columns'))} title="Turn selection into columns" wide>
          Columns <Icon name="nav-chevron-down" size={12} />
        </Cell>
      </div>

      <Sep />

      {/* The chevron. `aria-expanded` because the glyph alone says nothing to a
          screen reader about what it does or what state it is in. */}
      <Cell
        colors={cellColors}
        run={() => { setExpanded(v => !v); setMenu(null) }}
        title={expanded ? 'Fewer formatting options' : 'More formatting options'}
        aria-label="More formatting options"
        aria-expanded={expanded}
      >
        <span style={{
          display: 'flex',
          /* Right when closed, left when open: the section opens SIDEWAYS, so
             the arrow points the way it will move (it pointed down/up). */
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform var(--ds-motion-enter) var(--ds-ease-standard)',
        }}>
          <Icon name="nav-chevron-right" size={12} />
        </span>
      </Cell>

      {/* ── Popovers. All three open BELOW, left-aligned to the pill.

             v3 opened them upward and leftward because it was docked at the
             right edge of the window with no room below. Once the pill floats
             above a selection in the middle of the canvas, "open toward free
             space" means downward. ── */}

      {menu === 'link' && (
        <div style={{ ...popover, left: 0, width: 236, padding: 8 }}>
          <input
            autoFocus
            value={linkUrl}
            aria-label="Link address"
            placeholder="https://example.com"
            onChange={e => { setLinkUrl(e.target.value); setLinkError(null) }}
            /* Both keys are handled here and stopped here. React attaches at
               the root container, so letting them bubble would hand Escape to
               this component's own document listener and Enter to the canvas
               keymap — a newline in the block, or the pill closing under the
               URL being typed into it. */
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitLink() }
              else if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); setLinkError(null) }
            }}
            className="ds-input"
            style={{ width: '100%', padding: '3px 0' }}
          />
          {linkError ? (
            <div role="alert" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45, color: 'var(--ds-red)' }}>
              {linkError}
            </div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 11, color: text2 }}>Enter to add · Esc to cancel</div>
          )}
        </div>
      )}

      {menu === 'style' && (
        <div role="listbox" aria-label="Text style"
          style={{ ...popover, left: styleBtnRef.current?.offsetLeft ?? 4, padding: 4, minWidth: 180 }}>
          {TEXT_STYLES.map(t => {
            const on = t.id === currentStyle
            return (
              <button key={t.id} type="button" role="option" aria-selected={on}
                /* "Normal text" also clears inline formatting (makeNormal). */
                onMouseDown={e => { e.preventDefault(); if (t.id === 'normal') makeNormal(); else exec('formatBlock', t.id); setMenu(null) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  width: '100%', textAlign: 'left', border: 'none', borderRadius: 'var(--ds-radius-sm)',
                  background: on ? (colors.accentDim || 'var(--ds-accent-dim)') : 'transparent',
                  color: on ? accent : text2, cursor: 'pointer', padding: '7px 10px',
                  fontFamily: 'var(--ds-font-body)', lineHeight: 1.2, ...t.css,
                }}
                onMouseEnter={e => { if (!on) { e.currentTarget.style.background = raised; e.currentTarget.style.color = text } }}
                onMouseLeave={e => { if (!on) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 } }}
              >
                <span>{t.label}</span>
                {on && <Icon name="action-check" size={12} />}
              </button>
            )
          })}
        </div>
      )}

      {menu === 'font' && (
        <div style={{ ...popover, right: 4, padding: 4, minWidth: 172, maxHeight: 300, overflowY: 'auto' }}>
          {FONTS.map(font => (
            <button
              key={font}
              type="button"
              onMouseDown={e => { e.preventDefault(); exec('fontName', font); setMenu(null) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                border: 'none', borderRadius: 'var(--ds-radius-sm)', color: text2, cursor: 'pointer',
                fontFamily: `'${font}', sans-serif`, fontSize: 13, padding: '8px 10px',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}
            >
              {font}
            </button>
          ))}
        </div>
      )}

      {menu === 'color' && (
        <div style={{
          ...popover, right: 4, padding: 9,
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
        }}>
          {COLOR_OPTIONS.map(sw => (
            <button
              key={sw.name}
              type="button"
              onMouseDown={e => { e.preventDefault(); exec('foreColor', sw.value); setMenu(null) }}
              title={sw.name}
              aria-label={`Text colour ${sw.name}`}
              style={{
                /* 18px, up from Kanban's 10px tag dots: this popover has room
                   and no card-tag density constraint. Same selected-state
                   convention as the Kanban tag picker — a 2px transparent ring
                   that goes to var(--ds-text) rather than a check glyph. */
                width: 18, height: 18, borderRadius: '50%',
                background: sw.value,
                border: '2px solid transparent',
                cursor: 'pointer', padding: 0, flexShrink: 0,
                transition: 'border-color var(--ds-transition), transform var(--ds-motion-hover) var(--ds-ease-standard)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = text; e.currentTarget.style.transform = 'scale(1.12)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'none' }}
            />
          ))}
        </div>
      )}

      {menu === 'columns' && (
        <div style={{ ...popover, right: 4, padding: 4, minWidth: 150 }}>
          {COLUMN_COUNTS.map(n => (
            <button
              key={n}
              type="button"
              onMouseDown={e => { e.preventDefault(); turnIntoColumns(n) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                border: 'none', borderRadius: 'var(--ds-radius-sm)', color: text2, cursor: 'pointer',
                fontFamily: 'var(--ds-font-body)', fontSize: 13, padding: '8px 10px',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}
            >
              {n} columns
            </button>
          ))}
        </div>
      )}

      {hint && (
        <div role="status" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, whiteSpace: 'nowrap',
          padding: '4px 8px', borderRadius: 'var(--ds-radius-sm)',
          background: surface, border: `1px solid ${border}`,
          fontSize: 11, lineHeight: 1.45, color: 'var(--ds-amber)',
        }}>{hint}</div>
      )}
    </div>
  )

  return createPortal(toolbar, document.body)
}

/* Exported for the tests, which assert the picker no longer contains the
   dark-theme accent as a literal. */
export const _COLOR_OPTIONS = COLOR_OPTIONS
export const _FONTS = FONTS
