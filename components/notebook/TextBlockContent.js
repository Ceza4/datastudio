'use client'
import { useRef, useEffect, useState, useCallback, memo } from 'react'
import TextBlockToolbar from './TextBlockToolbar'
import SlashMenu, { filterCommands } from './SlashMenu'
import BlockPicker from './BlockPicker'
import {
  LINK_ATTR, DANGLING_ATTR, DANGLING_MESSAGE,
  linkHtml, parseAddress, resolveTarget,
} from '../../lib/teleport'
import { safeLinkUrl } from '../../lib/urls'
import { sanitizeEditorHtml } from '../../lib/sanitize'

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
  const savedContent = useRef(initialContent || '')
  /** Pending trailing save from handleInput. Cleared on flush and on unmount. */
  const inputSaveRef = useRef(null)
  const [menuPos, setMenuPos] = useState(null)
  // { x, y, filter, idx } — idx lives here, not in SlashMenu, because this
  // component owns the caret and therefore has to own the arrow keys too.
  const [slashMenu, setSlashMenu] = useState(null)
  const [linkPicker, setLinkPicker] = useState(null)
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
    const hasStructure = /<(h[1-6]|ul|ol|li|hr|pre|div\s[^>]*data-type|img)/i.test(html)
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
      if (clean === savedContent.current) return
      if (document.activeElement === ref.current) return
      ref.current.innerHTML = clean
      savedContent.current = clean
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
      if (el) {
        const html = el.innerHTML
        if (html !== savedContent.current) { savedContent.current = html; onSave(html) }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId])

  function persistContent() {
    if (!ref.current) return
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

    /* Nor does this one produce markup: it asks the canvas for a new block,
       beside this one. The "/" text has already been deleted above, so the
       paragraph is left exactly as it was rather than carrying a stray
       command nobody typed on purpose. */
    if (cmdId === 'database') {
      persistContent()
      checkEmpty()
      onInsertBlock?.('database')
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
        el.setAttribute('title', 'Go to this block')
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

  function insertQuote() {
    document.execCommand('formatBlock', false, 'blockquote')
  }

  function insertChecklist() {
    document.execCommand('insertHTML', false,
      '<div data-type="checklist" style="display:flex;align-items:flex-start;gap:8px;padding:3px 0;">' +
      '<input type="checkbox" style="margin-top:5px;cursor:pointer;accent-color:#5B5FE8;width:15px;height:15px;flex-shrink:0;" contenteditable="false">' +
      '<span style="flex:1;min-height:1em;outline:none;"></span></div><div><br></div>'
    )
  }

  function insertDivider() {
    document.execCommand('insertHTML', false, '<hr><div><br></div>')
  }

  function insertCodeBlock() {
    document.execCommand('insertHTML', false,
      '<pre><code>// your code here</code></pre><div><br></div>'
    )
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
          newItem.innerHTML = '<input type="checkbox" style="margin-top:5px;cursor:pointer;accent-color:#5B5FE8;width:15px;height:15px;flex-shrink:0;" contenteditable="false"><span style="flex:1;min-height:1em;outline:none;"></span>'
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
  function handleInput() {
    checkEmpty()
    detectSlash()
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
    if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
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
    [data-ds-text] a { color: #5B5FE8; text-decoration: underline; }
    [data-ds-text] a:hover { opacity: 0.75; }
    [data-ds-text] blockquote {
      margin: 10px 0; padding: 4px 0 4px 14px;
      border-left: 3px solid rgba(128,128,128,0.35);
      font-style: italic; opacity: 0.9;
    }
  `

  /* ── Render ─────────────────────────────────────────────── */

  const text3Color = colors?.text3 || '#5A5955'

  return (
    <>
      <style>{scopedStyles}</style>
      <div style={{ position: 'relative' }}>
        {isEmpty && !slashMenu && (
          <div style={{
            position: 'absolute', top: 10, left: 12,
            color: text3Color, fontSize: 13,
            fontFamily: 'var(--ds-font-body)',
            pointerEvents: 'none', userSelect: 'none', lineHeight: 1.7,
          }}>
            Type <span style={{
              fontFamily: 'var(--ds-font-mono)', fontSize: 12,
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
          onMouseDown={e => e.stopPropagation()}
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

      {/* The format rail is shown whenever this text block is the active one,
          not only after a right-click. A formatting toolbar you have to
          summon is a toolbar most people never find — and now that it's
          docked on the right instead of popping up at the cursor, there's no
          reason to hide it. Right-click still opens it, for anyone used to
          that. */}
      {(showRail || menuPos) && colors && (
        <TextBlockToolbar
          colors={colors}
          onClose={handleToolbarClose}
        />
      )}
    </>
  )
}

export default memo(TextBlockContentInner)
