'use client'
import { useRef, useEffect, useState, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '../../lib/theme'
import TextBlockToolbar from './TextBlockToolbar'
import SlashMenu, { filterCommands, SLASH_BLOCK_IDS, COLUMNS_COMMAND_N } from './SlashMenu'
import BlockPicker from './BlockPicker'
import {
  LINK_ATTR, DANGLING_ATTR, DANGLING_MESSAGE,
  linkHtml, parseAddress, resolveTarget,
} from '../../lib/teleport'
import { safeLinkUrl } from '../../lib/urls'
import { sanitizeEditorHtml } from '../../lib/sanitize'
import {
  columnsHtml, isColumnsRow, columnsOf, readWidths, writeWidths, evenWidths,
  resizePair, normalizeColumnRows, handleColumnKeyDown, DIVIDER_PX,
} from '../../lib/columns'
import { CHECKLIST_HTML, normalizeChecklists, caretIntoChecklist } from '../../lib/checklist'
import { insertBlockAtCaret, elementFrom } from '../../lib/insertblock'
import {
  CODE_LANGS, codeBlockHtml, codeText, isCodeBlock, normalizeCodeBlocks,
  handleCodeKeyDown, handleCodePaste, setCaretOffset, setCodeLang,
} from '../../lib/codeblock'
import { addressKind } from '../../lib/teleport'

/* TextBlockContent — SESSION A (FIXED)
   --------------------------------------------------------------------------
   Bug fixes from v1:
   1. PLACEHOLDER — now checks for structural HTML (ul, ol, h1, hr, pre,
      checklist divs), not just text. Inserting a bullet no longer shows
      placeholder on top of it.
   2. POSITIONING — toolbar and slash menu use React portals (inside their
      own components), so CSS transforms on the notebook canvas don't affect them.
   3. MARKDOWN SHORTCUTS — now fire on keyDown BEFORE the space is inserted,
      which is far more reliable than onInput (browser can reshuffle text nodes
      between keypress and input event).
   4. CODE BLOCKS — more visually distinct with left accent border and label.
   -------------------------------------------------------------------------- */


/* memo, for the same reason every other block component has one: this is a
   child of NotebookCanvas, which re-renders on every frame of a pan or a zoom.

   The comparator is a plain shallow compare, which only holds because every
   prop is stable by construction — `colors` is a frozen module object,
   `onSave`/`onInsertBlock` are cached per block id by blockCb() in the canvas,
   and onEditStart/onEditEnd are shared useCallbacks. `notebooks` changes
   identity whenever anything in the workspace changes, which is correct: this
   component renders backlink labels from it. */
function TextBlockContentInner({
  blockId,
  initialContent,
  onSave,
  text,
  colors,
  onEditStart,
  onEditEnd,
  minHeight = 80,
  showRail = false,
  /* Teleporters. All optional — a text block still works standalone, which
     keeps this component testable and reusable outside the canvas. */
  notebooks,
  linkShape,
  onFollowLink,
  /* "Put a block of this type on the canvas, near this one."
     ------------------------------------------------------------------
     Deliberately generic rather than one prop per type: the slash menu is
     meant to become the central way of inserting modular components, so the
     NEXT type that wants an entry adds one row to SlashMenu.COMMANDS and
     nothing else. Optional, like the teleport props — a text block rendered
     outside the canvas simply has nowhere to put a block, and the command
     stays out of its way rather than throwing. */
  onInsertBlock,
}) {
  const ref = useRef(null)
  /* WHAT WE HAVE WRITTEN INTO THE DOM — `null` until we have written anything.

     THIS USED TO BE SEEDED WITH `initialContent`, AND THAT BLANKED BLOCKS.

     The load effect below skips its write when the sanitised content already
     equals this ref, on the reasoning that "this is our own save coming back".
     Seeded with the raw initial content, that comparison is TRUE on the very
     first mount for any content the sanitiser leaves untouched — which is
     essentially all of it: `hello`, `<div>hello</div>`, `<b>bold</b>`,
     `<h1>Title</h1><div>body</div>` and `<ul><li>one</li></ul>` all come back
     byte-for-byte identical.

     So the effect returned early, `ref.current.innerHTML` was never set, and a
     freshly mounted block rendered EMPTY. Then the first blur, the first
     visibilitychange or the unmount cleanup read `''` out of the DOM, found it
     different from the stored text, and called `onSave('')` — writing the
     empty string over the user's paragraph. Every remount is a page reload, a
     sheet switch, or the canvas windowing recycling a row.

     `null` is a value no sanitiser output can ever equal, so the first pass
     always writes. It also gives the save paths a way to say "nothing has been
     loaded into this element yet, so whatever is in it is not the user's
     work" — see persistContent. */
  const savedContent = useRef(null)
  /** Pending trailing save from handleInput. Cleared on flush and on unmount. */
  const inputSaveRef = useRef(null)
  const [menuPos, setMenuPos] = useState(null)
  // { x, y, filter, idx } — idx lives here, not in SlashMenu, because this
  // component owns the caret and therefore has to own the arrow keys too.
  const [slashMenu, setSlashMenu] = useState(null)
  const [linkPicker, setLinkPicker] = useState(null)
  /* { block, left, top } while a code block's language menu is open. */
  const [codeLangMenu, setCodeLangMenu] = useState(null)
  const [isEmpty, setIsEmpty] = useState(true)
  // Mirror of slashMenu for the keydown handler. handleKeyDown is attached via
  // React's synthetic system and reads state from the render closure; during
  // fast typing that closure can be a frame behind, which previously let a
  // keystroke slip past the open menu.
  const slashRef = useRef(null)
  useEffect(() => { slashRef.current = slashMenu }, [slashMenu])

  /* Dismiss on any click that isn't the menu itself. SlashMenu preventDefaults
     its own mousedown, so selecting an item never reaches this. */
  useEffect(() => {
    if (!slashMenu) return
    function onDown(e) {
      if (e.target.closest?.('[role="listbox"]')) return
      slashRef.current = null
      setSlashMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [slashMenu])

  /* Scrolling or panning the canvas leaves the menu stranded at stale
     coordinates, because it's positioned from a caret rect measured once. */
  useEffect(() => {
    if (!slashMenu) return
    function bail() { slashRef.current = null; setSlashMenu(null) }
    window.addEventListener('wheel', bail, { passive: true })
    window.addEventListener('resize', bail)
    return () => {
      window.removeEventListener('wheel', bail)
      window.removeEventListener('resize', bail)
    }
  }, [slashMenu])

  /* ── Empty detection ────────────────────────────────────── */

  /* Declared before the mount effect that calls it. Function declarations
     hoist, so the old order worked at runtime, but React's compiler analyses
     use-before-declare as a real ordering hazard and flagged it. */
  const checkEmpty = useCallback(() => {
    if (!ref.current) return
    const html = ref.current.innerHTML || ''
    const stripped = html.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim()
    /* blockquote, table and input were missing, so a note holding only an
       empty Quote still showed "Type / for commands" over it. */
    const hasStructure = /<(h[1-6]|ul|ol|li|hr|pre|blockquote|table|input|div\s[^>]*data-type|img)/i.test(html)
    setIsEmpty(!stripped && !hasStructure)
  }, [])

  /* Load content when the block changes, or when its content changes from
     somewhere other than this editor (an undo, a template, a future sync). */
  useEffect(() => {
    if (ref.current) {
      /* SANITISED ON LOAD, NOT ONLY ON EXPORT.

         sanitizeHtml ran when a notebook was exported and nowhere else, so
         stored content went straight into innerHTML unchecked. Setting
         innerHTML does not run <script>, but it does fire <img onerror> and
         <svg onload>, and today the only thing keeping a payload out of
         `content` is that browsers strip handlers when pasting into a
         contentEditable. That is the BROWSER's guarantee, not the app's, and
         it stops applying the moment content arrives from anywhere else —
         Supabase sync and shared templates are both on the roadmap.

         Sanitising here also disinfects whatever is ALREADY sitting in a
         user's IndexedDB, which an onPaste handler alone cannot do.

         sanitizeEditorHtml, NOT sanitizeHtml. The export profile drops
         `input`, every data-* except data-ds-link, and all inline styles — run
         it over stored content and every checkbox in every checklist is
         deleted on load. The two profiles exist because they have opposite
         jobs; see lib/sanitize.js. */
      const clean = sanitizeEditorHtml(initialContent || '')
      /* ADOPT AN EXTERNAL CHANGE, BUT NEVER FIGHT THE CARET.

         initialContent used to be excluded from the deps entirely, with the
         reasoning that rewriting innerHTML on every prop change would fight the
         user's typing. That was right about typing and wrong about everything
         else: with an undo stack, Ctrl+Z now reverts a text block's content in
         state and the DOM carried on showing the old text, so undo appeared to
         do nothing to the one block type where people most expect it.

         Two guards make it safe. If the incoming content already matches what
         we last wrote, this is our OWN save coming back and there is nothing to
         do. If this element has focus, the user is mid-sentence and their DOM is
         the truth — an undo aimed at a block you are actively typing in is not
         a case worth breaking the caret for. */
      /* OUR OWN SAVE COMING BACK, compared RAW as well. persistContent saves
         the raw innerHTML, and the sanitizer re-serialises it slightly
         differently (a style's trailing ";" for one), so comparing only the
         sanitised copy said "changed" for our own save. The editor then
         rewrote innerHTML the moment it lost focus. Clicking a checkbox takes
         focus, so the box was replaced mid-click and the first tick did
         nothing (reproduced 24 Sep 2026). */
      if (initialContent === savedContent.current) return
      if (clean === savedContent.current) return
      /* The focus guard is deliberately AFTER the equality check and applies
         only once something has been loaded. On a first mount this element
         cannot already hold the caret, and skipping the initial write because
         of it would reintroduce the blanking above by a different route. */
      if (savedContent.current !== null && document.activeElement === ref.current) return
      ref.current.innerHTML = clean
      savedContent.current = clean
      /* Repair columns rows saved before the 24 Sep rebuild (their structure
         was stripped by the sanitizer) and any row an edit left malformed.
         If it changes anything, the next save writes the repaired version. */
      normalizeColumnRows(ref.current)
      /* Same for checklists and code blocks (lib/checklist.js,
         lib/codeblock.js): repairs broken items and upgrades old
         <pre><code> blocks to the new code block. */
      normalizeChecklists(ref.current)
      normalizeCodeBlocks(ref.current)
      checkEmpty()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, initialContent, checkEmpty])

  /* A pending 300ms save must not be able to outlive the component.

     Switching sheets, closing a notebook or deleting the block unmounts this
     while a timer is in flight. React does not fire blur when a focused
     element is removed from the DOM, so without this the last few hundred
     milliseconds of typing had no route to disk at all. */
  useEffect(() => {
    const el = ref.current
    function flush() {
      if (inputSaveRef.current) { clearTimeout(inputSaveRef.current); inputSaveRef.current = null }
      persistContent()
    }
    /* pagehide rather than beforeunload: it fires on the bfcache path too, and
       it is the last point at which a synchronous read of innerHTML is
       guaranteed to see what the user typed. */
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      /* ref.current is already null by the time a cleanup runs on unmount, so
         persistContent would no-op. Read the node captured on the way in. */
      if (inputSaveRef.current) { clearTimeout(inputSaveRef.current); inputSaveRef.current = null }
      /* `savedContent.current === null` means the load effect never ran for
         this element, so its innerHTML is not the user's work — it is an empty
         div we would otherwise save over their paragraph. Belt to the braces
         of the seeding fix above: this is the exact line that turned a
         rendering bug into a data-loss one. */
      if (el && savedContent.current !== null) {
        const html = el.innerHTML
        if (html !== savedContent.current) { savedContent.current = html; onSave(html) }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId])

  function persistContent() {
    if (!ref.current) return
    /* Never save out of an element the load effect has not filled yet. */
    if (savedContent.current === null) return
    const html = ref.current.innerHTML
    if (html !== savedContent.current) {
      savedContent.current = html
      onSave(html)
    }
  }

  /* ── Slash menu ─────────────────────────────────────────── */

  function closeSlash() {
    slashRef.current = null
    setSlashMenu(null)
  }

  function detectSlash() {
    const sel = window.getSelection()
    if (!sel?.rangeCount) { closeSlash(); return }

    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) { closeSlash(); return }

    const textBefore = node.textContent.substring(0, range.startOffset)
    // Allow spaces in the query ("/bullet l") but bail once it's clearly prose.
    const match = textBefore.match(/(^|\s)\/([^/]{0,20})$/)

    if (match) {
      const filter = match[2]
      // Nothing matches and the query is getting long — the user is writing a
      // path or a date, not invoking a command. Get out of the way.
      if (filter.length > 0 && filterCommands(filter).length === 0) { closeSlash(); return }
      const rect = range.getBoundingClientRect()
      const next = {
        x: rect.left, y: rect.bottom, filter,
        // Reset the highlight whenever the query changes, clamp otherwise.
        idx: slashRef.current && slashRef.current.filter === filter
          ? Math.min(slashRef.current.idx, Math.max(0, filterCommands(filter).length - 1))
          : 0,
      }
      slashRef.current = next
      setSlashMenu(next)
    } else {
      closeSlash()
    }
  }

  function moveSlash(delta) {
    const cur = slashRef.current
    if (!cur) return
    const n = filterCommands(cur.filter).length
    if (n === 0) return
    // Wraps, so holding ArrowDown cycles instead of dead-ending. Guard the
    // arithmetic: an undefined idx would make this NaN and blank the menu.
    const from = Number.isFinite(cur.idx) ? cur.idx : 0
    const idx = (((from + delta) % n) + n) % n
    const next = { ...cur, idx }
    slashRef.current = next
    setSlashMenu(next)
  }

  function handleSlashSelect(cmdId) {
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0)
      const node = range.startContainer
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent
        const offset = range.startOffset
        let slashPos = -1
        for (let i = offset - 1; i >= 0; i--) {
          if (t[i] === '/') { slashPos = i; break }
        }
        if (slashPos >= 0) {
          const delRange = document.createRange()
          delRange.setStart(node, slashPos)
          delRange.setEnd(node, offset)
          sel.removeAllRanges()
          sel.addRange(delRange)
          document.execCommand('delete')
        }
      }
    }

    closeSlash()

    /* `link` isn't a formatting command — it needs a target before it can
       insert anything. Opening the picker moves focus out of the editor and
       the caret is lost with it, so the range is captured HERE, while the
       selection is still ours, and restored when the pick comes back. */
    if (cmdId === 'link') {
      const s2 = window.getSelection()
      setLinkPicker({ range: s2?.rangeCount ? s2.getRangeAt(0).cloneRange() : null })
      return
    }

    /* Nor do these produce markup: they ask the canvas for a new block, beside
       this one. The "/" text has already been deleted above, so the paragraph is
       left exactly as it was rather than carrying a stray command nobody typed
       on purpose. */
    /* Any registry type flagged `inSlashMenu`, not a hardcoded 'database'.

       The id IS the block type for these rows (SLASH_BLOCK_ITEMS aliases it),
       so one branch handles every one of them and adding another type to the
       slash menu needs no change here at all — which is the point of deriving
       the list rather than typing it twice. */
    if (SLASH_BLOCK_IDS.has(cmdId)) {
      persistContent()
      checkEmpty()
      onInsertBlock?.(cmdId)
      return
    }

    applyCommand(cmdId)
    ref.current?.focus()
    persistContent()
    checkEmpty()
  }

  /* ── Teleport links ─────────────────────────────────────── */

  function insertLink(result) {
    const { range } = linkPicker || {}
    setLinkPicker(null)
    if (!result || !ref.current) return

    ref.current.focus()
    if (range) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
    document.execCommand('insertHTML', false, linkHtml(result.addr, result.label))
    persistContent()
    checkEmpty()
  }

  function cancelLink() {
    setLinkPicker(null)
    ref.current?.focus()
  }

  /* Click-to-follow. Delegated from the editor rather than bound per span:
     spans come and go as the user types, and contenteditable recreates nodes
     on undo, so per-node listeners would silently stop working. */
  function handleLinkClick(e) {
    const el = e.target.closest?.(`[${LINK_ATTR}]`)
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    const addr = parseAddress(el.getAttribute(LINK_ATTR))
    if (addr) onFollowLink?.(addr)
  }

  /* What the pass below is allowed to re-run on. Which links exist here is
     `initialContent`; whether each one still RESOLVES is decided by the set of
     block addresses in the workspace, and by nothing else. `notebooks` carries
     both, but it is re-minted on every frame of a block drag — so keying on it
     re-ran the querySelectorAll and the setAttribute writes, for every text
     block on the sheet, sixty times a second, to write back exactly the
     attributes it had just written.

     `linkShape` is that address set as a string, built once per canvas render:
     equal by value while a block is only being moved, different the instant
     one is created, deleted or moved to another sheet. Absent — a text block
     rendered outside the canvas, with nobody to build it — this falls back to
     the tree itself and behaves as it always did. */
  const linkScope = linkShape ?? notebooks

  /* Mark links whose target no longer exists. Done as a DOM pass rather than
     by rewriting the stored HTML — the content is the user's text, and a
     deleted target is not a reason to edit what they wrote. Struck through in
     CSS; the link stays exactly where it is and can still be read. */
  useEffect(() => {
    const root = ref.current
    if (!root || !notebooks) return
    for (const el of root.querySelectorAll(`[${LINK_ATTR}]`)) {
      const addr = parseAddress(el.getAttribute(LINK_ATTR))
      const res = resolveTarget(notebooks, addr)
      if (res.ok) {
        el.removeAttribute(DANGLING_ATTR)
        const kind = addressKind(addr)
        el.setAttribute('title', kind === 'sheet' ? 'Go to this sheet' : kind === 'notebook' ? 'Go to this notebook' : 'Go to this block')
      } else {
        el.setAttribute(DANGLING_ATTR, res.reason)
        el.setAttribute('title', DANGLING_MESSAGE[res.reason] || 'This link no longer resolves.')
      }
    }
    /* `notebooks` is read above but deliberately not a dependency — linkScope
       is its resolution-relevant projection, and that is the whole point. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkScope, initialContent, linkPicker])

  /* ── Commands ───────────────────────────────────────────── */

  function applyCommand(cmdId) {
    /* Columns aren't a switch-case here because their count is data
       (COLUMNS_COMMAND_N), not a fixed id per command — four ids, one
       function, same discipline SLASH_BLOCK_IDS already uses to avoid a
       hardcoded id check per type. */
    if (COLUMNS_COMMAND_N[cmdId]) { insertColumns(COLUMNS_COMMAND_N[cmdId]); return }
    switch (cmdId) {
      case 'h1': document.execCommand('formatBlock', false, 'h1'); break
      case 'h2': document.execCommand('formatBlock', false, 'h2'); break
      case 'h3': document.execCommand('formatBlock', false, 'h3'); break
      case 'bullet': document.execCommand('insertUnorderedList'); break
      case 'numbered': document.execCommand('insertOrderedList'); break
      case 'checklist': insertChecklist(); break
      case 'divider': insertDivider(); break
      case 'code': insertCodeBlock(); break
      case 'quote': insertQuote(); break
    }
  }

  /* A fresh N-column row at the caret — same shape as insertChecklist/
     insertDivider/insertCodeBlock: one execCommand('insertHTML'), a trailing
     empty paragraph so there's always somewhere sensible for the caret to
     land after. HTML construction itself lives in lib/columns.js — the one
     piece genuinely shared with DocumentBlock.js. */
  function insertColumns(n) {
    /* Built by hand (lib/insertblock.js), with the caret in the first
       column: insertHTML left it on the line below the new row. */
    const row = insertBlockAtCaret(ref.current, elementFrom(columnsHtml(n)))
    const first = row?.querySelector('[data-type="col"] > *')
    if (first) {
      const r = document.createRange(); r.setStart(first, 0); r.collapse(true)
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r)
    }
  }

  /* "Turn into N columns" is NOT implemented here. It acts on a real
     multi-paragraph selection, which by definition can't coexist with the
     slash menu (that only ever fires at a collapsed caret — see
     detectSlash() above). It lives in TextBlockToolbar.js's selection rail
     instead, operating on the same `editableRef` this component hands it —
     see the comment there for why that's the better home, not a
     workaround. */

  /* ── Column-divider resize ──────────────────────────────────────────
     No existing internal-gutter-drag code anywhere in this codebase to
     lean on — ResizeHandle.js resizes the whole floating block from the
     outside, a different concept entirely. mousemove/mouseup listen on
     `window`, not the divider itself, because the pointer routinely leaves
     the 18px hit area mid-drag; `document.body.style.cursor` is forced for
     the same reason ResizeHandle.js's own eight grips have to fight this —
     losing the resize cursor the instant the pointer strays off a narrow
     target reads as broken. */
  function startColumnResize(divider, startEvent) {
    const row = isColumnsRow(divider)
    if (!row) return
    const cols = columnsOf(row)
    const dividers = Array.from(row.children).filter(c => c.dataset?.type === 'col-divider')
    const idx = dividers.indexOf(divider)
    if (idx < 0) return
    /* Double-click a divider: back to an even split. */
    if (startEvent.detail >= 2) { writeWidths(row, evenWidths(cols.length)); persistContent(); return }

    /* Percentages are of the CONTENT width. The dividers are fixed px and
       take no part in the split, so measuring against the whole row made
       every drag run slightly ahead of the pointer. */
    const rowRect = row.getBoundingClientRect()
    const contentW = Math.max(1, rowRect.width - DIVIDER_PX * (cols.length - 1) * (rowRect.width / (row.offsetWidth || rowRect.width)))
    const startX = startEvent.clientX
    const startWidths = readWidths(row)
    if (startWidths.length !== cols.length) return // malformed row, bail rather than corrupt it

    document.body.style.cursor = 'col-resize'
    divider.setAttribute('data-dragging', 'true')

    function onMove(ev) {
      const dPct = ((ev.clientX - startX) / contentW) * 100
      writeWidths(row, resizePair(startWidths, idx, dPct))
    }
    function onUp() {
      document.body.style.cursor = ''
      divider.removeAttribute('data-dragging')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      persistContent()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* Runs after every input. Cheap in the common case — one closest() call —
     and it's what catches a columns row being emptied out through ORDINARY
     typing/backspacing inside a column, as opposed to the boundary case
     handleKeyDown's Backspace branch intercepts explicitly. Same collapse
     shape the checklist's own empty-item handling already uses. */
  function maybeCollapseEmptyColumns() {
    /* Was: dissolve the whole row the moment every column had no text, which
       also fired when you cleared a column to retype it. Columns now go one
       at a time, on purpose (Backspace in an empty column; see
       lib/columns.js). What runs after every input is the repair pass, which
       puts back any structure the browser broke (a merged column, a lost
       divider, a stray text node in the grid). */
    normalizeColumnRows(ref.current)
  }

  function insertQuote() {
    document.execCommand('formatBlock', false, 'blockquote')
  }

  /* The caret goes INTO the new item, ready to type. insertHTML leaves it
     after the inserted markup, i.e. on the empty line below the item, and the
     old empty <span> could not hold a caret at all. A one-off marker finds
     the item just inserted; it is removed before anything can save it. */
  function insertChecklist() {
    /* Built by hand, not insertHTML: see lib/insertblock.js. insertHTML
       stripped the item's text span in this editor and it vanished. */
    const item = insertBlockAtCaret(ref.current, elementFrom(CHECKLIST_HTML))
    if (item) caretIntoChecklist(item, window.getSelection())
  }

  function insertDivider() {
    document.execCommand('insertHTML', false, '<hr><div><br></div>')
  }

  /* The new code block (lib/codeblock.js): header with language and Copy,
     highlighting, line numbers. Starts empty with the caret on line 1. The
     old one started with "// your code here" as REAL text, which you had to
     delete before you could type. */
  function insertCodeBlock() {
    document.execCommand('insertHTML', false,
      codeBlockHtml('plain').replace('data-type="code"', 'data-type="code" data-ds-new="1"') + '<div><br></div>')
    const block = ref.current?.querySelector('[data-ds-new]')
    if (!block) return
    block.removeAttribute('data-ds-new')
    setCaretOffset(block, 0)
  }

  /* ── Keyboard handler (markdown shortcuts + checklist Enter) ── */

  function handleKeyDown(e) {
    /* Slash menu owns these keys while it's open, and it must claim them
       before the browser gets a chance to move the caret — moving the caret
       is what used to break the "/query" match and close the menu.
       stopPropagation as well as preventDefault, so the canvas keymap
       underneath doesn't also act on them. */
    const sm = slashRef.current
    if (sm) {
      const n = filterCommands(sm.filter).length
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault(); e.stopPropagation(); moveSlash(1); return
        case 'ArrowUp':
          e.preventDefault(); e.stopPropagation(); moveSlash(-1); return
        case 'Enter':
        case 'Tab': {
          if (n === 0) { closeSlash(); return }
          e.preventDefault(); e.stopPropagation()
          const cmd = filterCommands(sm.filter)[Math.min(sm.idx, n - 1)]
          if (cmd) handleSlashSelect(cmd.id)
          return
        }
        case 'Escape':
          e.preventDefault(); e.stopPropagation(); closeSlash(); return
        case 'ArrowLeft':
        case 'ArrowRight':
          // Horizontal movement is a genuine caret action; let it through and
          // re-evaluate whether we're still inside a slash query afterwards.
          setTimeout(detectSlash, 0)
          return
        default:
          break
      }
    }

    /* ── Code blocks own their keys ──────────────────────────────────
       Enter, Tab, and Backspace/Delete across a line edge go through the
       code block's text model (lib/codeblock.js). An empty block is removed
       by Backspace or Delete, like any empty block. Everything else typed in
       a code block is plain typing: no markdown shortcuts, no ``` trigger,
       so "# " in a Python comment stays a comment. */
    {
      const sel = window.getSelection()
      const n = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
      if (n && isCodeBlock(n.nodeType === Node.TEXT_NODE ? n.parentElement : n)) {
        const r = handleCodeKeyDown(e)
        if (r.changed) { persistContent(); checkEmpty() }
        return
      }
    }

    /* Markdown shortcuts: fire BEFORE the space is inserted.
       User types "# " — we catch the space keydown, check that
       the text before cursor is "#", prevent the space, delete
       the "#", and apply the heading format. */
    if (e.key === ' ' && !slashMenu) {
      if (tryMarkdownShortcut()) {
        e.preventDefault()
        return
      }
    }

    /* Backtick code block: ``` triggers immediately on third backtick */
    if (e.key === '`' && !slashMenu) {
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel?.rangeCount) return
        const node = sel.getRangeAt(0).startContainer
        if (node.nodeType !== Node.TEXT_NODE) return
        const t = node.textContent.substring(0, sel.getRangeAt(0).startOffset)
        if (/^```$/.test(t) || /\s```$/.test(t)) {
          const start = t.lastIndexOf('```')
          const range = document.createRange()
          range.setStart(node, start)
          range.setEnd(node, sel.getRangeAt(0).startOffset)
          sel.removeAllRanges()
          sel.addRange(range)
          document.execCommand('delete')
          insertCodeBlock()
          persistContent()
          checkEmpty()
        }
      }, 0)
    }

    /* Enter inside checklists */
    if (e.key === 'Enter') {
      const sel = window.getSelection()
      if (!sel?.rangeCount) return

      const node = sel.getRangeAt(0).startContainer
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
      const checklistItem = el?.closest?.('[data-type="checklist"]')

      if (checklistItem) {
        e.preventDefault()
        e.stopPropagation()

        const textSpan = checklistItem.querySelector('span')
        const itemText = (textSpan?.textContent || '').trim()

        if (!itemText) {
          const br = document.createElement('div')
          br.innerHTML = '<br>'
          checklistItem.replaceWith(br)
          const range = document.createRange()
          range.selectNodeContents(br)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
        } else {
          const newItem = document.createElement('div')
          newItem.setAttribute('data-type', 'checklist')
          newItem.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:3px 0;'
          newItem.innerHTML = '<input type="checkbox" style="margin-top:5px;cursor:pointer;width:15px;height:15px;flex-shrink:0;" contenteditable="false"><span style="flex:1;min-height:1em;outline:none;"><br></span>'
          checklistItem.after(newItem)
          const span = newItem.querySelector('span')
          if (span) {
            const range = document.createRange()
            range.selectNodeContents(span)
            range.collapse(true)
            sel.removeAllRanges()
            sel.addRange(range)
          }
        }
        persistContent()
        checkEmpty()
        return
      }
    }

    /* ── Column edges ───────────────────────────────────────────────────
       Arrows, Backspace and Delete at a column's edge hop to the neighbour,
       leave the row, or remove an empty column. Handled only AT an edge;
       everywhere else in a column the browser does its normal thing. All
       of it lives in lib/columns.js, shared with the Document block. */
    {
      const col = handleColumnKeyDown(e)
      if (col.handled) {
        if (col.changed) { persistContent(); checkEmpty() }
        return
      }
    }

    /* ── Backspace inside checklists ────────────────────────────────────
       There was NO Backspace case in this handler at all, so backspace at a
       checklist boundary fell straight through to native contentEditable —
       which for a custom `data-type="checklist"` div structure means whatever
       the browser happens to do at that exact DOM boundary. In practice: it
       merges items unpredictably, sometimes deletes the checkbox <input> and
       leaves the text stranded, sometimes does nothing. That is not a
       browser quirk to work around, it is the absence of any logic.

       WHY NATIVE LISTS ARE LEFT ALONE. <ul>/<ol>/<li> are real list elements
       and browsers already implement backspace on them correctly. Duplicating
       that here imperfectly is how a fix becomes a second bug, so this branch
       returns early for anything that is not one of our custom checklist divs.

       Position 0 is the only case handled. Backspace anywhere else in the text
       is ordinary deletion and already works; intercepting it would be the
       change most likely to break something that currently behaves. */
    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (!sel?.rangeCount) return
      const range = sel.getRangeAt(0)
      /* A selection, not a caret: this is "replace the selected text", which
         native handling gets right. */
      if (!range.collapsed) return

      const node = range.startContainer
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
      const checklistItem = el?.closest?.('[data-type="checklist"]')

      /* Column edges are handled above, by handleColumnKeyDown. */
      if (!checklistItem) return

      const textSpan = checklistItem.querySelector('span')
      if (!textSpan) return

      /* AT THE START? Measured with a Range rather than by comparing offsets,
         because the span can hold several text nodes (a bold run, a link) and
         `startOffset === 0` is true at the start of ANY of them, not only the
         first. A range from the span's start to the caret having no text in it
         is the real question. */
      const probe = document.createRange()
      probe.setStart(textSpan, 0)
      probe.setEnd(range.startContainer, range.startOffset)
      if (probe.toString().length > 0) return   // ordinary mid-text deletion

      e.preventDefault()
      e.stopPropagation()

      const itemText = textSpan.textContent || ''
      const prev = checklistItem.previousElementSibling

      if (!itemText.trim()) {
        /* EMPTY ITEM → exit the checklist, become a plain paragraph. Exactly
           what Enter already does to an empty item a few lines above; reusing
           that shape rather than inventing a second way to do the same thing
           is the point. */
        const para = document.createElement('div')
        para.innerHTML = '<br>'
        checklistItem.replaceWith(para)
        const r = document.createRange()
        r.selectNodeContents(para)
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
      } else if (!prev) {
        /* FIRST ITEM IN THE DOCUMENT, with text in it. There is nothing above
           to merge into, so unwrap: keep the words, drop the checkbox. Deleting
           the item outright here would silently eat the user's text, which is
           the worst of the outcomes native handling currently produces. */
        const para = document.createElement('div')
        while (textSpan.firstChild) para.appendChild(textSpan.firstChild)
        checklistItem.replaceWith(para)
        const r = document.createRange()
        r.setStart(para, 0)
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
      } else {
        /* NON-EMPTY ITEM → merge its text onto the end of whatever is above
           (another checklist item, a paragraph, a heading) and remove this
           item's own checkbox and wrapper. Standard list-editing behaviour.

           The caret is placed at the JOIN before the text moves, so it ends up
           between the old content and the merged content — where the user
           expects it after a merge, not at the end of the combined line. */
        const prevIsChecklist = prev.getAttribute?.('data-type') === 'checklist'
        const target = prevIsChecklist ? prev.querySelector('span') : prev
        if (!target) return

        const r = document.createRange()
        /* An empty target has no child nodes to address by index, so anchor to
           the element itself at offset 0 rather than to a last child that
           isn't there. */
        if (target.lastChild) {
          r.setStartAfter(target.lastChild)
        } else {
          r.setStart(target, 0)
        }
        r.collapse(true)

        while (textSpan.firstChild) target.appendChild(textSpan.firstChild)
        checklistItem.remove()

        sel.removeAllRanges()
        sel.addRange(r)
      }

      persistContent()
      checkEmpty()
      return
    }

    /* Tab in code blocks: insert 2 spaces */
    if (e.key === 'Tab') {
      const sel = window.getSelection()
      if (sel?.rangeCount) {
        const node = sel.getRangeAt(0).startContainer
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
        if (el?.closest?.('pre')) {
          e.preventDefault()
          document.execCommand('insertText', false, '  ')
          return
        }
      }
    }
  }

  function tryMarkdownShortcut() {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return false

    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return false

    const el = node.parentElement
    if (el?.closest?.('h1,h2,h3,pre,[data-type="checklist"]')) return false

    const textBeforeCursor = node.textContent.substring(0, range.startOffset)

    const patterns = [
      { regex: /^###$/, cmd: 'h3' },
      { regex: /^##$/, cmd: 'h2' },
      { regex: /^#$/, cmd: 'h1' },
      { regex: /^[-*]$/, cmd: 'bullet' },
      { regex: /^1\.$/, cmd: 'numbered' },
      { regex: /^\[\]$/, cmd: 'checklist' },
      { regex: /^---$/, cmd: 'divider' },
    ]

    for (const p of patterns) {
      if (p.regex.test(textBeforeCursor)) {
        const delRange = document.createRange()
        delRange.setStart(node, 0)
        delRange.setEnd(node, range.startOffset)
        sel.removeAllRanges()
        sel.addRange(delRange)
        document.execCommand('delete')
        applyCommand(p.cmd)
        persistContent()
        checkEmpty()
        return true
      }
    }
    return false
  }

  /* ── Input handler ──────────────────────────────────────── */

  /* TYPING NOW SAVES. It did not.

     This function was `checkEmpty(); detectSlash()` and nothing else, and
     persistContent() was reached only from blur, the format toolbar, slash
     commands, link insert, checkbox clicks and markdown shortcuts. Plain
     prose — letters, spaces, Enter — triggered none of them. Type for an hour
     without clicking away, reload, and the hour was gone: no error, no
     warning, and no way to get it back, because this is a local-first app and
     the DOM was the only copy.

     300ms rather than immediately: persistContent walks innerHTML and hands
     the result up to a setState that re-renders the notebook, and doing that
     per keystroke is its own performance bug. persistContent is already
     idempotent — it early-returns when the html has not changed — so a
     trailing call that lands after the user has stopped is free. */
  function handleInput(e) {
    /* Mid-composition (IME) the text is provisional; repairing or
       re-highlighting now would fight the composition. */
    if (e?.nativeEvent?.isComposing) return
    maybeCollapseEmptyColumns()
    normalizeChecklists(ref.current)
    normalizeCodeBlocks(ref.current)   // also re-highlights, keeping the caret
    checkEmpty()
    {
      /* "/" in code is a character, not a command. */
      const sel = window.getSelection()
      const n = sel?.anchorNode
      if (!(n && isCodeBlock(n.nodeType === Node.TEXT_NODE ? n.parentElement : n))) detectSlash()
    }
    if (inputSaveRef.current) clearTimeout(inputSaveRef.current)
    inputSaveRef.current = setTimeout(() => {
      inputSaveRef.current = null
      persistContent()
    }, 300)
  }

  /* ── Paste ──────────────────────────────────────────────────
     There was no paste handler at all, so the browser inserted its own
     normalisation of the clipboard's text/html and the result was persisted
     verbatim. Two things were wrong with that. The obvious one is that the
     app was trusting the browser to be its sanitiser. The quieter one is that
     pasting from a web page dragged in that page's fonts, colours and margins,
     so a paste never looked like the document it landed in.

     execCommand('insertHTML') rather than a Range: it is what every other
     formatting path in this file already uses, so paste lands in the same
     undo stack as everything else and Ctrl+Z inside the block still works. */
  function handlePaste(e) {
    const cd = e.clipboardData
    if (!cd) return
    /* Into a code block: always plain text, as lines. */
    if (handleCodePaste(e)) { persistContent(); return }
    e.preventDefault()

    const html = cd.getData('text/html')
    if (html) {
      document.execCommand('insertHTML', false, sanitizeEditorHtml(html))
    } else {
      /* Plain text is inserted as text, deliberately — insertHTML would make
         `<b>` in copied source code render as bold rather than show as the
         characters the user copied. */
      const text = cd.getData('text/plain')
      if (text) document.execCommand('insertText', false, text)
    }
    persistContent()
    checkEmpty()
  }

  /* ── Click handler ──────────────────────────────────────── */

  function handleClick(e) {
    e.stopPropagation()
    /* Code block header: Copy, and the language picker. Delegated, like the
       teleport links, because blocks come and go with the content. */
    const copyBtn = e.target.closest?.('[data-type="code-copy"]')
    if (copyBtn) {
      const block = isCodeBlock(copyBtn)
      if (block) {
        navigator.clipboard?.writeText(codeText(block)).then(() => {
          copyBtn.setAttribute('data-copied', '')
          setTimeout(() => copyBtn.removeAttribute('data-copied'), 1400)
        }).catch(() => {})
      }
      return
    }
    const langBtn = e.target.closest?.('[data-type="code-lang"]')
    if (langBtn) {
      const block = isCodeBlock(langBtn)
      if (block) {
        const r = langBtn.getBoundingClientRect()
        setCodeLangMenu({ block, left: r.left, top: r.bottom + 4 })
      }
      return
    }
    if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
      /* A ticked box has to be written as the `checked` ATTRIBUTE. Ticking
         only changes the element's property, and innerHTML (what is saved)
         serialises attributes, so every tick was lost on the next load. */
      const box = e.target
      if (box.checked) box.setAttribute('checked', 'checked')
      else box.removeAttribute('checked')
      setTimeout(() => persistContent(), 0)
      return
    }
    if (e.target.tagName === 'A' && e.target.href && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      /* Two problems lived on this line. `javascript:` in the href executed
         here — the link prompt now refuses those, but content predating that
         check is already in IndexedDB, and pasted HTML never went through the
         prompt at all, so the href still cannot be trusted at click time.

         And `window.open(url, '_blank')` does NOT imply noopener the way
         `<a target="_blank">` does; without it the opened page gets a live
         `window.opener` and can navigate this tab somewhere else while the
         user is looking at the one they just opened. */
      const safe = safeLinkUrl(e.target.href)
      if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
    }
  }

  /* ── Context menu ───────────────────────────────────────── */

  function handleContextMenu(e) {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    onEditStart?.()
  }

  function handleToolbarClose() {
    // Only the right-click invocation is dismissable; the always-on rail is
    // controlled by selection, so closing it here would just make it flicker.
    setMenuPos(null)
    persistContent()
    checkEmpty()
  }

  /* ── Scoped styles ──────────────────────────────────────── */

  const scopedStyles = `
    /* The caret takes the accent.

       Flagged as blocked on "the actual accent hex" — it isn't: --ds-accent is
       #1D9E75 light / #5B5FE8 dark and has been for a while. Binding the token
       rather than either literal is what makes it correct in both themes with
       no JS, and it is the form the open question should be judged in: look at
       a 1-2px accent line against the body text in each theme and keep or drop
       this one line. */
    [data-ds-text] { caret-color: var(--ds-accent); }
    [data-ds-text] h1 { font-size: 26px; font-weight: 700; font-family: var(--ds-font-head); margin: 14px 0 6px; line-height: 1.3; }
    [data-ds-text] h2 { font-size: 20px; font-weight: 700; font-family: var(--ds-font-head); margin: 12px 0 4px; line-height: 1.3; }
    [data-ds-text] h3 { font-size: 16px; font-weight: 600; font-family: var(--ds-font-head); margin: 10px 0 3px; line-height: 1.4; }
    [data-ds-text] ul, [data-ds-text] ol { padding-left: 24px; margin: 6px 0; }
    [data-ds-text] li { margin: 3px 0; line-height: 1.7; }
    [data-ds-text] hr { border: none; border-top: 2px solid rgba(128,128,128,0.2); margin: 18px 0; }
    /* THE APP'S THEME, NOT THE OPERATING SYSTEM'S.

       This block used to switch on @media (prefers-color-scheme: dark) — the
       only such query in the whole codebase, sitting in the primary writing
       surface, while every other component switches on [data-theme]. A user on
       a light OS running the app in dark mode got an rgba(0,0,0,0.06) code
       block on a #201F1C ground: invisible. The inverse gave white on cream.

       And the accent was hardcoded to #5B5FE8 — the DARK accent — in both
       themes, so every link, checkbox tint and code rule inside a text block
       was indigo while the rest of the app was green. */
    [data-ds-text] pre {
      background: rgba(0,0,0,0.06); border-left: 3px solid var(--ds-accent);
      padding: 14px 16px; border-radius: 0 8px 8px 0;
      font-family: var(--ds-font-mono); font-size: 13px; line-height: 1.7;
      overflow-x: auto; margin: 10px 0; white-space: pre-wrap;
      position: relative;
    }
    [data-theme='dark'] [data-ds-text] pre { background: rgba(255,255,255,0.06); }
    [data-ds-text] code { font-family: var(--ds-font-mono); }
    [data-ds-text] [data-type="checklist"] {
      display: flex; align-items: flex-start; gap: 8px; padding: 4px 0;
    }
    /* !important, and that is load-bearing rather than lazy.

       Checklists created before this fix carry accent-color:#5B5FE8 as an
       INLINE style, written into the stored HTML — so a stylesheet rule alone
       could never win, and every checklist anyone has already made would keep
       the wrong accent forever. This overrides the stored value at render time
       and leaves the content untouched, which is much safer than migrating
       every user's notes. New checklists are written without the declaration
       at all (see the two innerHTML strings above).

       Sizing is here too, for the same reason: the old inline style said 15px
       while this rule said 16px, so the rule never applied and every checkbox
       in the app was a pixel smaller than intended. */
    [data-ds-text] [data-type="checklist"] input[type="checkbox"] {
      margin-top: 5px; cursor: pointer;
      accent-color: var(--ds-accent) !important;
      width: 16px !important; height: 16px !important; flex-shrink: 0;
    }
      [data-ds-text] [data-type="checklist"] span {
      flex: 1; min-height: 1em; outline: none;
    }
    [data-ds-text] [data-type="checklist"] input[type="checkbox"]:checked + span {
      text-decoration: line-through; opacity: 0.45;
    }
    /* A THIRD instance of the hardcoded dark accent, and the one that was
       actually rendering wrong: unlike the checkbox tint above there is no
       !important rule overriding this, so every link in every text block was
       indigo on the light theme.

       --ds-accent-TEXT, not --ds-accent: link text has to be read, and the
       plain accent token is a fill/border colour at 2.59:1 on raised. */
    [data-ds-text] a { color: var(--ds-accent-text); text-decoration: underline; }
    [data-ds-text] a:hover { opacity: 0.75; }
    [data-ds-text] blockquote {
      margin: 10px 0; padding: 4px 0 4px 14px;
      border-left: 3px solid rgba(128,128,128,0.35);
      font-style: italic; opacity: 0.9;
    }

    /* ── Code block (lib/codeblock.js), 24 Sep 2026 ──
       A rounded card: header bar with the language and Copy, then the code
       with line numbers. Every label here is CSS content, not text, so none
       of it is copied, saved or exported with the code. */
    [data-ds-text] [data-type="code"] {
      margin: 10px 0; border: 1px solid var(--ds-border); border-radius: 10px;
      overflow: hidden; background: var(--ds-code-bg);
    }
    [data-ds-text] [data-type="code-head"] {
      display: flex; align-items: center; justify-content: space-between;
      height: 30px; padding: 0 8px 0 12px; box-sizing: border-box;
      background: var(--ds-code-head); border-bottom: 1px solid var(--ds-border);
      font-family: var(--ds-font-mono); font-size: 11px; user-select: none;
    }
    [data-ds-text] [data-type="code-lang"],
    [data-ds-text] [data-type="code-copy"] {
      cursor: pointer; padding: 3px 6px; border-radius: 6px; color: var(--ds-text-2);
    }
    [data-ds-text] [data-type="code-lang"]:hover,
    [data-ds-text] [data-type="code-copy"]:hover { background: var(--ds-raised); color: var(--ds-text); }
    [data-ds-text] [data-type="code-lang"]::after { content: ' \\25BE'; opacity: 0.6; }
    [data-ds-text] [data-type="code-copy"]::before { content: 'Copy'; }
    [data-ds-text] [data-type="code-copy"][data-copied]::before { content: 'Copied'; color: var(--ds-green); }
    [data-ds-text] [data-type="code"][data-lang="plain"] [data-type="code-lang"]::before { content: 'Plain text'; }
    [data-ds-text] [data-type="code"][data-lang="js"] [data-type="code-lang"]::before { content: 'JavaScript'; }
    [data-ds-text] [data-type="code"][data-lang="ts"] [data-type="code-lang"]::before { content: 'TypeScript'; }
    [data-ds-text] [data-type="code"][data-lang="python"] [data-type="code-lang"]::before { content: 'Python'; }
    [data-ds-text] [data-type="code"][data-lang="sql"] [data-type="code-lang"]::before { content: 'SQL'; }
    [data-ds-text] [data-type="code"][data-lang="json"] [data-type="code-lang"]::before { content: 'JSON'; }
    [data-ds-text] [data-type="code"][data-lang="html"] [data-type="code-lang"]::before { content: 'HTML'; }
    [data-ds-text] [data-type="code"][data-lang="css"] [data-type="code-lang"]::before { content: 'CSS'; }
    [data-ds-text] [data-type="code"][data-lang="bash"] [data-type="code-lang"]::before { content: 'Shell'; }
    [data-ds-text] [data-type="code"] pre {
      margin: 0; padding: 10px 0; background: transparent; border: none; border-radius: 0;
      font-family: var(--ds-font-mono); font-size: 13px; line-height: 1.65;
      white-space: pre-wrap; overflow-x: auto;
    }
    [data-theme='dark'] [data-ds-text] [data-type="code"] pre { background: transparent; }
    [data-ds-text] [data-type="code"] code { counter-reset: ds-ln; display: block; }
    [data-ds-text] [data-type="code-line"] {
      display: block; position: relative; min-height: 1.65em;
      padding: 0 14px 0 3.6em; counter-increment: ds-ln;
    }
    [data-ds-text] [data-type="code-line"]::before {
      content: counter(ds-ln); position: absolute; left: 0; width: 2.6em;
      text-align: right; color: var(--ds-text-3); opacity: 0.55; user-select: none;
    }
    [data-ds-text] [data-type="tk-kw"] { color: var(--ds-code-kw); }
    [data-ds-text] [data-type="tk-str"] { color: var(--ds-code-str); }
    [data-ds-text] [data-type="tk-num"] { color: var(--ds-code-num); }
    [data-ds-text] [data-type="tk-fn"] { color: var(--ds-code-fn); }
    [data-ds-text] [data-type="tk-com"] { color: var(--ds-code-com); font-style: italic; }
  `

  /* ── Render ─────────────────────────────────────────────── */

  const text3Color = colors?.text3 || '#5A5955'

  return (
    <>
      <style>{scopedStyles}</style>
      {/* Code block language menu. Portalled and fixed, like the slash menu:
          the block sits under the canvas zoom transform. */}
      {codeLangMenu && typeof document !== 'undefined' && createPortal(
        <>
          <div onMouseDown={() => setCodeLangMenu(null)}
            style={{ position: 'fixed', inset: 0, zIndex: Z.popoverScrim }} />
          <div role="listbox" aria-label="Code language" data-kbd-zone
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setCodeLangMenu(null) } }}
            style={{
              position: 'fixed', left: codeLangMenu.left, top: codeLangMenu.top, zIndex: Z.popover,
              minWidth: 160, padding: 4, borderRadius: 10,
              background: 'var(--ds-surface)', border: '1px solid var(--ds-border)',
              boxShadow: 'var(--ds-shadow-lg)', fontFamily: 'var(--ds-font-body)',
            }}>
            {CODE_LANGS.map(l => {
              const on = codeLangMenu.block.getAttribute('data-lang') === l.id
              return (
                <button key={l.id} role="option" aria-selected={on}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setCodeLang(codeLangMenu.block, l.id)
                    setCodeLangMenu(null)
                    persistContent()
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none',
                    padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                    fontFamily: 'var(--ds-font-body)',
                    background: on ? 'var(--ds-accent-dim)' : 'transparent',
                    color: on ? 'var(--ds-accent)' : 'var(--ds-text-2)',
                  }}>
                  {l.label}
                </button>
              )
            })}
          </div>
        </>,
        document.body
      )}
      <div style={{ position: 'relative' }}>
        {isEmpty && !slashMenu && (
          <div style={{
            position: 'absolute', top: 10, left: 12,
            color: text3Color, fontSize: 13,
            fontFamily: 'var(--ds-font-body)',
            pointerEvents: 'none', userSelect: 'none', lineHeight: 1.7,
          }}>
            Type <span style={{
              fontFamily: 'var(--ds-font-mono)', fontSize: 13,
              background: 'rgba(128,128,128,0.12)', padding: '2px 6px', borderRadius: 4,
            }}>/</span> for commands or just start writing
          </div>
        )}

        <div
          ref={ref}
          data-ds-text=""
          contentEditable
          suppressContentEditableWarning
          /* Capture phase. A teleport link sits inside an editable region, so
             the default click would place a caret inside the link text before
             anything else ran — leaving the user editing the label of a link
             they meant to follow. Intercepting on the way down means the
             caret never lands there. */
          onClickCapture={handleLinkClick}
          onFocus={() => onEditStart?.()}
          onBlur={e => {
            /* PERSIST FIRST, ALWAYS.

               This used to return early when a menu was open, so opening the
               context menu and then clicking away on the canvas exited through
               neither this path nor handleToolbarClose — and took the edit
               with it. persistContent is idempotent, so saving here and again
               when the menu closes costs nothing.

               The menu check still gates onEditEnd, which is what it was
               actually for: reaching for the toolbar is not leaving. */
            persistContent()
            if (menuPos || slashMenu) return
            checkEmpty()
            onEditEnd?.()
          }}
          onPaste={handlePaste}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onMouseDown={e => {
            /* Divider hit is checked before the ordinary stopPropagation —
               same delegated-listener idiom handleLinkClick already uses for
               teleport links, for the same reason: dividers come and go as
               columns are inserted/removed, so a per-node listener would
               silently stop working the moment contentEditable recreates a
               node (undo, retyping). */
            const divider = e.target.closest?.('[data-type="col-divider"]')
            if (divider) { e.preventDefault(); e.stopPropagation(); startColumnResize(divider, e); return }
            e.stopPropagation()
          }}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          style={{
            minHeight,
            padding: '10px 14px',
            fontSize: 14,
            color: text,
            lineHeight: 1.7,
            outline: 'none',
            fontFamily: 'var(--ds-font-body)',
            cursor: 'text',
            userSelect: 'text',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            overflowY: 'auto',
          }}
        />
      </div>

      {/* Screen-centred rather than anchored to the caret. It portals itself
          out to <body>, so no positioned wrapper here — and it needs to,
          because the canvas is inside a CSS transform that would scale it with
          the zoom level. */}
      {linkPicker && colors && (
        <BlockPicker
          notebooks={notebooks}
          currentBlockId={blockId}
          colors={colors}
          onPick={insertLink}
          onCancel={cancelLink}
        />
      )}

      {slashMenu && colors && (
        <SlashMenu
          x={slashMenu.x}
          y={slashMenu.y}
          filter={slashMenu.filter}
          activeIdx={slashMenu.idx}
          colors={colors}
          onSelect={handleSlashSelect}
          /* Guarded. Spreading a null ref here produced `{ idx }` with no
             x/y/filter — a truthy menu positioned at NaN, i.e. one that
             vanishes. That's what happened when the list scrolled under a
             stationary cursor during keyboard looping and fired mouseenter
             against a ref that had just been cleared. */
          onHover={i => {
            const cur = slashRef.current
            if (!cur) return
            const next = { ...cur, idx: i }
            slashRef.current = next
            setSlashMenu(next)
          }}
        />
      )}

      {/* MOUNTED whenever this block is the active one; VISIBLE only when
          there is a non-collapsed text selection inside it. Those are two
          different questions now, and the toolbar answers the second one
          itself off `selectionchange` — see TextBlockToolbar v4.

          Keeping the mount tied to the block (rather than to the selection)
          is what lets the toolbar own its own show/hide without this
          component having to mirror the selection state as well. Right-click
          still forces it up via menuPos, for anyone used to that. */}
      {(showRail || menuPos) && colors && (
        <TextBlockToolbar
          colors={colors}
          editableRef={ref}
          onClose={handleToolbarClose}
        />
      )}
    </>
  )
}

export default memo(TextBlockContentInner)
