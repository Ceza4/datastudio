'use client'
import { useRef, useEffect, useState, useCallback } from 'react'
import TextBlockToolbar from './TextBlockToolbar'
import SlashMenu, { filterCommands } from './SlashMenu'

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

export default function TextBlockContent({
  blockId,
  initialContent,
  onSave,
  text,
  colors,
  onEditStart,
  onEditEnd,
  minHeight = 80,
  showRail = false,
}) {
  const ref = useRef(null)
  const savedContent = useRef(initialContent || '')
  const [menuPos, setMenuPos] = useState(null)
  // { x, y, filter, idx } — idx lives here, not in SlashMenu, because this
  // component owns the caret and therefore has to own the arrow keys too.
  const [slashMenu, setSlashMenu] = useState(null)
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

  /* Load content when the block identity changes. initialContent is
     deliberately not a dependency: this is an uncontrolled contentEditable, so
     re-writing innerHTML on every prop change would fight the user's caret
     mid-typing. Only a genuinely different block should reload. */
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialContent || ''
      savedContent.current = initialContent || ''
      checkEmpty()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, checkEmpty])

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
    applyCommand(cmdId)
    ref.current?.focus()
    persistContent()
    checkEmpty()
  }

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

  function handleInput() {
    checkEmpty()
    detectSlash()
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
      window.open(e.target.href, '_blank')
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
    [data-ds-text] pre {
      background: rgba(0,0,0,0.06); border-left: 3px solid #5B5FE8;
      padding: 14px 16px; border-radius: 0 8px 8px 0;
      font-family: var(--ds-font-mono); font-size: 13px; line-height: 1.7;
      overflow-x: auto; margin: 10px 0; white-space: pre-wrap;
      position: relative;
    }
    @media (prefers-color-scheme: dark) {
      [data-ds-text] pre { background: rgba(255,255,255,0.06); }
    }
    [data-ds-text] code { font-family: var(--ds-font-mono); }
    [data-ds-text] [data-type="checklist"] {
      display: flex; align-items: flex-start; gap: 8px; padding: 4px 0;
    }
    [data-ds-text] [data-type="checklist"] input[type="checkbox"] {
      margin-top: 5px; cursor: pointer; accent-color: #5B5FE8;
      width: 16px; height: 16px; flex-shrink: 0;
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
          onFocus={() => onEditStart?.()}
          onBlur={e => {
            if (menuPos || slashMenu) return
            persistContent()
            checkEmpty()
            onEditEnd?.()
          }}
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
