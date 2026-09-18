'use client'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { sanitizeEditorHtml } from '../../lib/sanitize'
import {
  PX_PER_IN, pageMetrics, pageGuides, pageCount, wordCount, charCount,
  fontStack, normalizeMargin, MARGIN_STEP,
} from '../../lib/pagesetup'
import {
  isColumnsRow, isColumnBody, isCaretAtColumnStart, isColumnsRowEmpty,
  readWidths, writeWidths,
} from '../../lib/columns'

/*
  components/notebook/DocumentBlock.js
  --------------------------------------------------------------------------
  THE HEAVIER WRITING SURFACE. Notes is quick capture; this is the document.

  ── CONTINUOUS SCROLL, WITH A PAGE-GUIDE OVERLAY ───────────────────────────

  The editing surface is ONE continuous scroll, exactly like Notes. There is no
  reflow engine, no page-break logic fighting the canvas's own zoom and pan, and
  nothing new in the render path while typing.

  Page boundaries are COMPUTED, NOT LAID OUT. Given the page size and margins,
  lib/pagesetup.js returns one number — the content height of a page — and a thin
  dashed guide is drawn at every multiple of it. No content moves. It is one
  arithmetic division, redrawn on resize.

  That is what makes "it must feel right at every zoom level" achievable without
  the engineering risk real reflow carries: you get the sense of where page four
  starts while writing, which is the experiential goal, without needing a layout
  engine to guarantee it stays true as you edit above it.

  AND THE CONSEQUENCE, STATED PLAINLY: the guide is an ESTIMATE. The exported
  document is the source of truth for exact breaks, because the exporting library
  does the real page-breaking with real font metrics. A table or image near a
  boundary may export onto the next page even where the guide suggested
  otherwise — the same way Word's own live view and print preview can differ by a
  line. An honest tradeoff, not a bug to fix later.

  Insert → Page Break is different: a marker the user places deliberately, which
  IS honoured exactly at export. See the PAGE_BREAK note below.

  ── WHY THIS IS NOT TextBlockContent WITH MORE BUTTONS ─────────────────────

  It shares the contentEditable + execCommand foundation and nothing else. Notes
  has no page, no margins, no ruler, no ribbon and a selection-anchored toolbar;
  this has a fixed page width in real inches, a pinned ribbon, draggable margin
  markers and a status bar. Bolting all of that onto TextBlockContent behind
  conditionals would make the file that owns the app's primary quick-capture
  surface responsible for page geometry it never uses.
  -------------------------------------------------------------------------- */

/* A deliberate page break, as content.

   A marked element rather than a magic comment or a zero-width character: it has
   to survive sanitizeEditorHtml, be selectable and deletable like any other
   block-level thing, and be findable by the exporter with one querySelectorAll.
   `contenteditable=false` so the caret cannot land inside it and leave someone
   editing the inside of a page break. */
export const PAGE_BREAK_HTML =
  '<div data-ds-pagebreak="1" contenteditable="false"></div><div><br></div>'

/* The scroller's own inset. Horizontal was 0, which put the page flush against
   both block edges and hid the border and the two-layer shadow that are what
   make it read as a sheet resting on something. */
const SCROLL_PAD_TOP = 18
const SCROLL_PAD_X = 24

function DocumentBlockInner({
  block, colors, onSave, onEditStart, onEditEnd, onUpdateBlock,
}) {
  /* NO `zoom` PROP, deliberately, and do not add one back.

     This component used to accept `zoom` and then call pageMetrics(block, 1),
     pageGuides(…, 1) and pageCount(…, 1) with a hardcoded literal. The literal
     is CORRECT: the page renders inside the canvas's own
     `transform: scale(nbZoom)`, so it is already scaled, and feeding the real
     zoom in here would apply it twice. The unused parameter was an open
     invitation to "fix" that and break the page at every zoom level. The
     Ruler has the same property for the same reason — it derives its px-per-
     inch from its own measured width, so it never needs to know the zoom. */
  const { surface, base, raised, paper, border, text, text2, text3, accent } = colors
  const ref = useRef(null)
  const scrollRef = useRef(null)
  /* What we have written into the DOM. `null` until the first write, for exactly
     the reason TextBlockContent documents at length: seeded with the initial
     content, the load effect's "this is our own save coming back" check is TRUE
     on first mount for any content the sanitiser leaves untouched, so the
     element is never populated — and then the first blur reads '' out of it and
     saves the empty string over the user's document. */
  const savedContent = useRef(null)
  const [docHeight, setDocHeight] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)

  const metrics = useMemo(() => pageMetrics(block, 1), [block])

  /* docHeight is the editable's scrollHeight, which INCLUDES its own top and
     bottom margin padding. pageGuides and pageCount divide by the per-page
     CONTENT height (the page minus those same margins), so feeding them the
     padded height compared two different quantities and overcounted by
     roughly one page: an empty A4 document measured 1122px against a 930px
     content page and reported "Page 1 of 2", with a page-2 guide drawn across
     blank paper. Subtract the padding first so both sides are content. */
  const contentHeight = Math.max(0, docHeight - metrics.px.top - metrics.px.bottom)

  const guides = useMemo(
    () => (block.showGuides === false ? [] : pageGuides(block, contentHeight, 1)),
    [block, contentHeight],
  )
  const pages = pageCount(block, contentHeight, 1)
  const words = useMemo(() => wordCount(block.content), [block.content])
  const chars = useMemo(() => charCount(block.content), [block.content])

  /* Which page the caret's viewport is showing, for "Page 2 of 4". Derived from
     scroll position rather than from the selection: a caret-based answer would
     need a measurement on every keystroke, and the status bar's job is telling
     you roughly where you are. */
  /* Measured from the top of the TEXT, not the top of the scroller: the
     scroller opens with 18px of its own padding and the page then adds a full
     top margin before the first line, so dividing the raw offset flipped the
     counter early. */
  const currentPage = Math.min(
    pages,
    Math.max(1, Math.floor(Math.max(0, scrollTop - SCROLL_PAD_TOP - metrics.px.top) / Math.max(1, metrics.px.contentH)) + 1),
  )

  /* ── Load ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const clean = sanitizeEditorHtml(block.content || '')
    if (clean === savedContent.current) return
    el.innerHTML = clean
    savedContent.current = clean
  }, [block.content])

  /* ── Measure ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setDocHeight(el.scrollHeight))
    ro.observe(el)
    setDocHeight(el.scrollHeight)
    return () => ro.disconnect()
  }, [])

  const persist = useCallback(() => {
    const el = ref.current
    /* Never save from an element we have not loaded into: whatever is in it is
       not the user's work yet. The same guard TextBlockContent needs. */
    if (!el || savedContent.current === null) return
    const clean = sanitizeEditorHtml(el.innerHTML)
    if (clean === savedContent.current) return
    savedContent.current = clean
    onSave?.(clean)
  }, [onSave])

  /* Same collapse-when-empty shape TextBlockContent.js uses: runs after
     every input, cheap in the common case (one closest() call), catches a
     columns row emptied out through ordinary typing/backspacing inside a
     column rather than at its boundary. Declared BEFORE handleInput below
     (not just before it's used) — handleInput's own dependency array
     references this by name, and a `const` declared later in the same
     function body is still in its temporal dead zone at the point that
     array is evaluated, not just at the point the callback body runs. */
  const maybeCollapseEmptyColumns = useCallback(() => {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return
    const node = sel.getRangeAt(0).startContainer
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
    const row = isColumnsRow(el)
    if (!row || !isColumnsRowEmpty(row)) return
    const para = document.createElement('div')
    para.innerHTML = '<br>'
    row.replaceWith(para)
    const r = document.createRange()
    r.selectNodeContents(para)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  }, [])

  /* Trailing save, so typing a paragraph is one write rather than one per
     keystroke. Flushed on blur and on unmount. */
  const saveTimer = useRef(null)
  const handleInput = useCallback(() => {
    maybeCollapseEmptyColumns()
    setDocHeight(ref.current?.scrollHeight || 0)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, 500)
  }, [persist, maybeCollapseEmptyColumns])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    persist()
  }, [persist])

  const handleKeyDown = useCallback(e => {
    /* Ctrl+. / Ctrl+, for superscript and subscript — the convention most
       editors use, and the only two formatting commands in this block with no
       browser-native shortcut. Cmd on macOS via metaKey.

       These ARE modifier shortcuts, and lib/shortcuts.js's "no shortcut needs a
       modifier" rule is about CANVAS shortcuts: single keys that must not fire
       while typing. Inside a text editor the rule inverts — an unmodified key
       has to be the character. Neither combination is in RESERVED_COMBOS. */
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === '.') { e.preventDefault(); document.execCommand('superscript'); return }
      if (e.key === ',') { e.preventDefault(); document.execCommand('subscript'); return }
    }
    /* Tab indents rather than leaving the document. In a writing surface the
       expectation is an indent; tabbing out of a half-written paragraph to the
       next focusable thing on the canvas is never what anyone means. */
    if (e.key === 'Tab') {
      e.preventDefault()
      document.execCommand(e.shiftKey ? 'outdent' : 'indent')
    }

    /* Backspace at a column boundary — same reasoning and same shape as
       TextBlockContent.js's own handling of this (see that file's comment):
       a custom data-type div structure has no native "this is a real
       boundary" semantics, so an unhandled Backspace at column-start is
       undefined behaviour against a CSS grid track. First column no-ops;
       any later column moves the caret to the end of the previous one
       rather than letting native contentEditable attempt a cross-track
       merge. Kept in this file rather than shared with TextBlockContent's
       handler because the two files' keydown handlers have entirely
       different shapes (this one is a single useCallback switch, that one
       owns slash-menu key interception too) — the LOGIC is shared, via
       lib/columns.js's isColumnBody/isCaretAtColumnStart; only the wiring
       is written twice, which is the same division DocumentBlock and
       TextBlockContent already use for everything else. */
    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (!sel?.rangeCount) return
      const range = sel.getRangeAt(0)
      if (!range.collapsed) return
      const node = range.startContainer
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
      const colBody = isColumnBody(el)
      if (!colBody || !isCaretAtColumnStart(colBody, range)) return
      e.preventDefault()
      const prevCol = colBody.previousElementSibling?.previousElementSibling
      if (prevCol && prevCol.classList?.contains('ds-col')) {
        const r = document.createRange()
        r.selectNodeContents(prevCol)
        r.collapse(false)
        sel.removeAllRanges()
        sel.addRange(r)
      }
    }
  }, [])

  /* Column-divider resize — see TextBlockContent.js's startColumnResize for
     the full reasoning (no existing internal-gutter-drag code anywhere in
     the codebase to lean on; window-level mousemove/mouseup because the
     pointer routinely leaves the divider's own narrow hit area mid-drag).
     Written twice rather than shared for the same reason the Backspace
     handling above is: these two files don't share a component to hang a
     shared hook off, only the pure math in lib/columns.js. */
  const startColumnResize = useCallback((divider, startEvent) => {
    const row = isColumnsRow(divider)
    if (!row) return
    const cols = Array.from(row.children).filter(c => c.classList?.contains('ds-col'))
    const dividers = Array.from(row.children).filter(c => c.dataset?.type === 'col-divider')
    const idx = dividers.indexOf(divider)
    if (idx < 0) return
    const rowRect = row.getBoundingClientRect()
    const startX = startEvent.clientX
    const startWidths = readWidths(row)
    if (startWidths.length !== cols.length) return

    document.body.style.cursor = 'col-resize'
    divider.setAttribute('data-dragging', 'true')

    function onMove(ev) {
      const dxPct = ((ev.clientX - startX) / rowRect.width) * 100
      const w = startWidths.slice()
      w[idx] = startWidths[idx] + dxPct
      w[idx + 1] = startWidths[idx + 1] - dxPct
      writeWidths(row, w)
    }
    function onUp() {
      document.body.style.cursor = ''
      divider.removeAttribute('data-dragging')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      /* A resize doesn't fire a contentEditable 'input' event (it's a plain
         style write, not a DOM edit inside the editable in the way the
         browser tracks), so the usual onInput → persist path never runs.
         Call both explicitly, same as onInput normally would. */
      setDocHeight(ref.current?.scrollHeight || 0)
      persist()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [persist])

  const handlePaste = useCallback(e => {
    /* Pasted HTML goes through the sanitiser before it touches the document.
       execCommand('insertHTML') with clipboard HTML is a direct route from
       someone else's page into stored content, which is the whole reason
       lib/sanitize.js exists. */
    const html = e.clipboardData?.getData('text/html')
    if (!html) return
    e.preventDefault()
    document.execCommand('insertHTML', false, sanitizeEditorHtml(html))
  }, [])

  const pageW = metrics.px.pageW
  const padTop = metrics.px.top

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      background: base, fontFamily: 'var(--ds-font-body)',
    }}>
      <style>{`
        [data-ds-doc] h1 { font-size: 2em; font-weight: 700; margin: 0.6em 0 0.3em; line-height: 1.25; }
        [data-ds-doc] h2 { font-size: 1.5em; font-weight: 700; margin: 0.6em 0 0.25em; line-height: 1.3; }
        [data-ds-doc] h3 { font-size: 1.2em; font-weight: 600; margin: 0.5em 0 0.2em; line-height: 1.35; }
        [data-ds-doc] p, [data-ds-doc] div { margin: 0 0 0.55em; }
        [data-ds-doc] ul, [data-ds-doc] ol { padding-left: 1.6em; margin: 0.4em 0 0.6em; }
        [data-ds-doc] li { margin: 0.15em 0; }
        [data-ds-doc] blockquote {
          margin: 0.7em 0; padding: 0.2em 0 0.2em 0.9em;
          border-left: 3px solid var(--ds-border); font-style: italic; opacity: 0.92;
        }
        [data-ds-doc] table { border-collapse: collapse; margin: 0.6em 0; }
        [data-ds-doc] td, [data-ds-doc] th { border: 1px solid var(--ds-border); padding: 0.25em 0.5em; }
        [data-ds-doc] img { max-width: 100%; height: auto; }
        [data-ds-doc] sup, [data-ds-doc] sub { line-height: 0; font-size: 0.72em; }
        [data-ds-doc] a { color: var(--ds-accent-text); text-decoration: underline; }
        /* A DELIBERATE page break, drawn as one. Distinct from the automatic
           dashed guides — solid, labelled, and part of the content — because
           this one is a promise the export keeps and those are estimates. */
        [data-ds-doc] [data-ds-pagebreak] {
          height: 0; margin: 1.1em 0;
          border-top: 1.5px solid var(--ds-accent);
          position: relative;
        }
        [data-ds-doc] [data-ds-pagebreak]::after {
          content: 'PAGE BREAK';
          position: absolute; right: 0; top: -0.55em;
          background: var(--ds-base); padding: 0 5px;
          font-family: var(--ds-font-mono); font-size: 11px; letter-spacing: 0.6px;
          color: var(--ds-accent);
        }
        [data-ds-doc] { caret-color: var(--ds-accent); }
      `}</style>

      {/* ── RULER ──
          Inside the scrollable document area, above the page — not inside the
          ribbon, because it has to line up with the page's own left edge and the
          ribbon is full-width chrome. Behind View → Ruler, as one toggle for
          both rulers: Word ships them as a single checkbox, so the vertical one
          costs nothing extra to build once the horizontal exists and can simply
          be dropped from the toggle later if it does not earn its place. */}
      {block.showRuler && (
        <Ruler
          block={block}
          metrics={metrics}
          colors={colors}
          onUpdateBlock={onUpdateBlock}
        />
      )}

      {/* ── The page ── */}
      <div
        ref={scrollRef}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: `${SCROLL_PAD_TOP}px ${SCROLL_PAD_X}px 28px` }}>
        <div style={{
          width: pageW, maxWidth: '100%', margin: '0 auto', position: 'relative',
          background: paper,
          /* A page resting on the canvas: a tight contact shadow plus the soft
             ambient one, the same stacked pair the calendar block uses. A single
             shadow reads as a flat panel with a blur under it. */
          boxShadow: 'var(--ds-shadow-sm), var(--ds-shadow-md)',
          border: `1px solid ${border}`,
        }}>

          {/* PAGE GUIDES, under the text. `pointerEvents: none` because a
              decorative line that swallows a click in the middle of a paragraph
              would be a genuinely baffling bug. */}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {guides.map(g => (
              <div key={g.page} style={{
                position: 'absolute', left: 0, right: 0,
                top: padTop + g.top,
                borderTop: `1px dashed ${border}`,
              }}>
                <span style={{
                  position: 'absolute', right: 6, top: 2,
                  fontFamily: 'var(--ds-font-mono)', fontSize: 11, letterSpacing: 0.5,
                  color: text3,
                }}>
                  PAGE {g.page}
                </span>
              </div>
            ))}
          </div>

          <div
            ref={ref}
            data-ds-doc=""
            data-ds-text=""
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Document body"
            onFocus={() => onEditStart?.()}
            onBlur={() => { persist(); onEditEnd?.() }}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            /* The canvas drags a block from a mousedown anywhere on it; without
               this, clicking to place the caret drags the document. Divider
               hit is checked first — same delegated idiom as everywhere else
               a column divider is wired, since dividers come and go with the
               content and a per-node listener would silently stop working
               the moment contentEditable recreates one (undo, retyping). */
            onMouseDown={e => {
              const divider = e.target.closest?.('[data-type="col-divider"]')
              if (divider) { e.preventDefault(); e.stopPropagation(); startColumnResize(divider, e); return }
              e.stopPropagation()
            }}
            style={{
              /* Margins as PADDING, so the page is the box and the margins are
                 inside it.

                 HORIZONTAL MARGINS ARE PERCENTAGES, and that is the whole point.
                 The page carries `maxWidth: 100%`, so in any block narrower than
                 A4 (the default block is, at 880 against 794 plus gutters — and
                 every block the user drags smaller) the page box is CLAMPED while
                 an absolute 96px padding is not. The ruler draws its margin
                 markers at `margins.left / page.w` as a percentage of its own
                 measured width, so the two drifted apart: at a 710px page the
                 marker sat at 86px and the text started at 96px. The ruler was
                 lying about where the margin was, in a block whose entire pitch
                 is that the ruler tells the truth.

                 Expressed as the same percentage the ruler uses, they agree at
                 every width by construction. Vertical padding stays in px —
                 clamping is horizontal only, and the page-height arithmetic
                 (guides, page count) is in px. */
              paddingTop: padTop,
              paddingBottom: metrics.px.bottom,
              paddingLeft: `${(metrics.margins.left / metrics.page.w) * 100}%`,
              paddingRight: `${(metrics.margins.right / metrics.page.w) * 100}%`,
              minHeight: metrics.px.pageH,
              outline: 'none',
              color: text,
              fontFamily: fontStack(block.font),
              /* pt → px. A 11pt document font is 11 × 96/72 CSS px, and getting
                 this wrong is how a document looks right on screen and wrong on
                 paper. */
              fontSize: (block.fontSize || 11) * (96 / 72),
              lineHeight: block.lineSpacing || 1.5,
              textIndent: (block.indentFirst || 0) * PX_PER_IN,
              cursor: 'text',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}
          />
        </div>
      </div>

      {/* ── STATUS BAR ──
          Under the page, docked along the bottom — where Word has always put
          this information, rather than leaving it to live in the ribbon.

          NO ZOOM SLIDER. See the note in DocumentRibbon.js: the canvas already
          owns zoom, and a second differently-scoped one on the same block is a
          question the user would have to learn the answer to. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        padding: '4px 12px', borderTop: `1px solid ${border}`, background: raised,
        fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3,
      }}>
        <span title="Estimated from the page-guide arithmetic — the export is the source of truth">
          Page {currentPage} of {pages}
        </span>
        {block.showWordCount !== false && (
          <>
            <span>{words} {words === 1 ? 'word' : 'words'}</span>
            <span>{chars} chars</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        {/* Margins only. The page size and orientation are already stated in
            the ribbon's top-right corner as "A4 · Portrait"; printing
            "A4 · 1″/1″" here as well put the same fact on screen twice, in two
            different formats, 450px apart. The ribbon keeps the page, the
            status bar keeps the margins, and neither repeats the other. */}
        <span title="Top / left margin — change them on the Layout tab or by dragging the ruler">
          Margins {metrics.margins.top}″ / {metrics.margins.left}″
        </span>
      </div>
    </div>
  )
}

/* ── The ruler ────────────────────────────────────────────────────────────
   Tick marks in the page's real units, shaded regions outside the margins, and
   DRAGGABLE MARGIN MARKERS.

   ONE VALUE, TWO WAYS TO CHANGE IT. Dragging a marker writes the same
   `block.margins` the ribbon's Margins dropdown and its Custom Margins dialog
   read and write. Not a parallel copy that could disagree — the same discipline
   SharePanel.js applies to visibility settings, and the reason the ribbon's
   preset LABEL is derived from the numbers rather than stored beside them.

   Indent markers live here too, tied to the Paragraph group's indent controls
   the same way. */
function Ruler({ block, metrics, colors, onUpdateBlock }) {
  const { border, raised, text3, accent, base } = colors
  const barRef = useRef(null)
  const [drag, setDrag] = useState(null)   // 'left' | 'right' | 'indentFirst'

  const pageWpx = metrics.px.pageW
  const inches = Math.ceil(metrics.page.w)

  /* ONE place that clamps and writes a marker, because there are now two ways
     to move one. Each caller hands it a value in that marker's own frame:
     distance from the left page edge for `left`, from the right edge for
     `right`, from the left margin for the indent — the same frames the drag
     already worked in. */
  const writeMarker = (which, inches) => {
    if (which === 'left') {
      /* Clamped so the two margins can never cross: half an inch of content
         minimum, which lib/pagesetup.js enforces again on read — belt and
         braces, because a drag can produce values a dialog cannot. */
      const max = metrics.page.w - metrics.margins.right - 0.5
      onUpdateBlock?.(block.id, {
        margins: { ...metrics.margins, left: normalizeMargin(Math.min(max, Math.max(0, inches)), metrics.margins.left) },
      })
    } else if (which === 'right') {
      const max = metrics.page.w - metrics.margins.left - 0.5
      onUpdateBlock?.(block.id, {
        margins: { ...metrics.margins, right: normalizeMargin(Math.min(max, Math.max(0, inches)), metrics.margins.right) },
      })
    } else {
      /* First-line indent, measured from the left margin — which is where Word
         measures it from, and the only origin that keeps the marker under the
         cursor when the margin itself moves. */
      onUpdateBlock?.(block.id, {
        indentFirst: normalizeMargin(Math.max(0, Math.min(metrics.inches.contentW - 0.25, inches)), 0),
      })
    }
  }

  /* ARROW KEYS MOVE A MARKER TOO.

     These are real <button>s: focusable, in the tab order, and announced as
     "Left margin". They were also drag-only, so a keyboard reached them and
     then could do nothing with them — a control that answers when you call it
     and not when you speak to it. Word's ruler is mouse-only and gets away
     with it because Word's markers are not buttons.

     0.05″ per press, because normalizeMargin keeps two decimals and placing a
     margin is a precision job; Shift gives the 0.25″ the ribbon's spinners and
     Word's own increment use, for crossing the page quickly. */
  const FINE_STEP = 0.05
  const nudgeMarker = (which, dir, coarse) => {
    const step = (coarse ? MARGIN_STEP : FINE_STEP) * dir
    const at = which === 'left' ? metrics.margins.left
      : which === 'right' ? metrics.margins.right
      : (block.indentFirst || 0)
    /* The right marker's frame runs inward from the right edge, so a press
       towards the page's left edge GROWS it. Anything else moves the handle
       the opposite way from the arrow. */
    writeMarker(which, at + (which === 'right' ? -step : step))
  }

  /* A drag is in SCREEN pixels and a margin is in inches, and the canvas may be
     zoomed — so the conversion has to come from the element's measured width
     against the page's known width in inches, not from a constant. Measuring the
     bar is how this stays correct at every zoom level without knowing the zoom. */
  const startDrag = (which, e) => {
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const pxPerInch = rect.width / metrics.page.w
    setDrag(which)

    function move(ev) {
      const xIn = (ev.clientX - rect.left) / pxPerInch
      if (which === 'left') writeMarker('left', xIn)
      else if (which === 'right') writeMarker('right', metrics.page.w - xIn)
      else writeMarker(which, xIn - metrics.margins.left)
    }
    function up() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const pctL = (metrics.margins.left / metrics.page.w) * 100
  const pctR = (metrics.margins.right / metrics.page.w) * 100
  const pctIndent = ((metrics.margins.left + (block.indentFirst || 0)) / metrics.page.w) * 100

  const marker = (which, leftPct, title, label) => (
    <button
      type="button"
      onMouseDown={e => startDrag(which, e)}
      onKeyDown={e => {
        const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        if (!dir) return
        /* Stopped here, not left to bubble: the canvas's toolbar mode reads
           arrows as spatial moves between island buttons, and both handlers
           acting on one press would nudge the margin AND move focus off it. */
        e.preventDefault()
        e.stopPropagation()
        nudgeMarker(which, dir, e.shiftKey)
      }}
      title={title}
      aria-label={label}
      style={{
        position: 'absolute', top: 0, left: `${leftPct}%`,
        transform: 'translateX(-50%)',
        width: 11, height: 11, padding: 0,
        border: 'none', background: 'none',
        cursor: 'ew-resize',
        color: drag === which ? accent : text3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      {/* A triangle, the shape Word uses for exactly these handles. */}
      <span aria-hidden="true" style={{
        width: 0, height: 0,
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderTop: `7px solid currentColor`,
      }} />
      <span style={{ position: 'absolute', clip: 'rect(0 0 0 0)', width: 1, height: 1, overflow: 'hidden' }}>{label}</span>
    </button>
  )

  return (
    <div style={{
      /* SAME horizontal inset as the page scroller, and that is load-bearing.
         Both this track and the page are `width: pageW; maxWidth: 100%`, so
         whenever the block is narrower than the page they each clamp to THEIR
         OWN container's width. Give the two containers different padding and
         the ruler ends up a different width from the page it is measuring —
         which is how a 662px page came to be measured by a 718px ruler, with
         the left-margin marker sitting 17px away from where the text actually
         started. They must share this number. */
      flexShrink: 0, padding: `4px ${SCROLL_PAD_X}px 0`, background: base,
      borderBottom: `1px solid ${border}`,
    }}>
      <div style={{ width: pageWpx, maxWidth: '100%', margin: '0 auto', position: 'relative' }}>
        {/* The tick bar. Shaded outside the margins, which is the part that
            makes at-a-glance sense of where the text can go. */}
        {/* 20px, not 15. The inch numerals used to be 7px — below the 11px
            floor and unreadable — and at 11px they collided with the 9px inch
            ticks inside a 15px bar. Growing the bar is the right fix; shrinking
            type back under the floor is not. */}
        <div ref={barRef} style={{
          position: 'relative', height: 20,
          background: raised, border: `1px solid ${border}`, borderRadius: 4,
          overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pctL}%`, background: border, opacity: 0.55 }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${pctR}%`, background: border, opacity: 0.55 }} />
          {Array.from({ length: inches * 4 + 1 }, (_, i) => {
            const isInch = i % 4 === 0
            const isHalf = i % 2 === 0
            return (
              <span key={i} aria-hidden="true" style={{
                position: 'absolute', bottom: 0,
                left: `${(i / 4 / metrics.page.w) * 100}%`,
                width: 1, height: isInch ? 9 : isHalf ? 5 : 3,
                background: text3, opacity: isInch ? 0.85 : 0.5,
              }} />
            )
          })}
          {Array.from({ length: inches }, (_, i) => (
            <span key={`n${i}`} aria-hidden="true" style={{
              position: 'absolute', top: 2, lineHeight: 1,
              left: `${((i + 0.06) / metrics.page.w) * 100}%`,
              fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3,
            }}>{i}</span>
          ))}
        </div>
        {/* The handles, below the bar so they can overhang it without being
            clipped by its overflow:hidden. */}
        <div style={{ position: 'relative', height: 12 }}>
          {/* The tooltips name BOTH ways to move a marker. A drag handle that
              also answers the arrow keys is not something anyone guesses. */}
          {marker('left', pctL, 'Left margin — drag, or nudge with ← →', 'Left margin')}
          {marker('indentFirst', pctIndent, 'First-line indent — drag, or nudge with ← →', 'First-line indent')}
          {marker('right', 100 - pctR, 'Right margin — drag, or nudge with ← →', 'Right margin')}
        </div>
      </div>
    </div>
  )
}

/* memo, for the reason every block component has one: this is a child of
   NotebookCanvas, which re-renders on every frame of a pan or a zoom. */
export default memo(DocumentBlockInner)
