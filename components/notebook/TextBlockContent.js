'use client'
import { useRef, useEffect, useState } from 'react'
import TextBlockToolbar from './TextBlockToolbar'
import SlashMenu from './SlashMenu'

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
}) {
  const ref = useRef(null)
  const savedContent = useRef(initialContent || '')
  const [menuPos, setMenuPos] = useState(null)
  const [slashMenu, setSlashMenu] = useState(null)
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialContent || ''
      savedContent.current = initialContent || ''
      checkEmpty()
    }
  }, [blockId])

  /* ── Empty detection (fixed) ────────────────────────────── */

  function checkEmpty() {
    if (!ref.current) return
    const html = ref.current.innerHTML || ''
    const stripped = html.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim()
    const hasStructure = /<(h[1-6]|ul|ol|li|hr|pre|div\s[^>]*data-type|img)/i.test(html)
    setIsEmpty(!stripped && !hasStructure)
  }

  function persistContent() {
    if (!ref.current) return
    const html = ref.current.innerHTML
    if (html !== savedContent.current) {
      savedContent.current = html
      onSave(html)
    }
  }

  /* ── Slash menu ─────────────────────────────────────────── */

  function detectSlash() {
    const sel = window.getSelection()
    if (!sel?.rangeCount) { setSlashMenu(null); return }

    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) { setSlashMenu(null); return }

    const textBefore = node.textContent.substring(0, range.startOffset)
    const match = textBefore.match(/(^|\s)\/(\S*)$/)

    if (match) {
      const rect = range.getBoundingClientRect()
      setSlashMenu({ x: rect.left, y: rect.bottom, filter: match[2] })
    } else {
      setSlashMenu(null)
    }
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

    applyCommand(cmdId)
    setSlashMenu(null)
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
    }
  }

  function insertChecklist() {
    document.execCommand('insertHTML', false,
      '<div data-type="checklist" style="display:flex;align-items:flex-start;gap:8px;padding:3px 0;">' +
      '<input type="checkbox" style="margin-top:5px;cursor:pointer;accent-color:#5B5FE8;width:15px;height:15px;flex-shrink:0;">' +
      '<span></span></div><div><br></div>'
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
          newItem.innerHTML = '<input type="checkbox" style="margin-top:5px;cursor:pointer;accent-color:#5B5FE8;width:15px;height:15px;flex-shrink:0;"><span></span>'
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
    setMenuPos(null)
    persistContent()
    checkEmpty()
  }

  /* ── Scoped styles ──────────────────────────────────────── */

  const scopedStyles = `
    [data-ds-text] h1 { font-size: 26px; font-weight: 700; font-family: 'Syne',sans-serif; margin: 14px 0 6px; line-height: 1.3; }
    [data-ds-text] h2 { font-size: 20px; font-weight: 700; font-family: 'Syne',sans-serif; margin: 12px 0 4px; line-height: 1.3; }
    [data-ds-text] h3 { font-size: 16px; font-weight: 600; font-family: 'Syne',sans-serif; margin: 10px 0 3px; line-height: 1.4; }
    [data-ds-text] ul, [data-ds-text] ol { padding-left: 24px; margin: 6px 0; }
    [data-ds-text] li { margin: 3px 0; line-height: 1.7; }
    [data-ds-text] hr { border: none; border-top: 2px solid rgba(128,128,128,0.2); margin: 18px 0; }
    [data-ds-text] pre {
      background: rgba(0,0,0,0.06); border-left: 3px solid #5B5FE8;
      padding: 14px 16px; border-radius: 0 8px 8px 0;
      font-family: 'DM Mono',monospace; font-size: 13px; line-height: 1.7;
      overflow-x: auto; margin: 10px 0; white-space: pre-wrap;
      position: relative;
    }
    @media (prefers-color-scheme: dark) {
      [data-ds-text] pre { background: rgba(255,255,255,0.06); }
    }
    [data-ds-text] code { font-family: 'DM Mono',monospace; }
    [data-ds-text] [data-type="checklist"] {
      display: flex; align-items: flex-start; gap: 8px; padding: 4px 0;
    }
    [data-ds-text] [data-type="checklist"] input[type="checkbox"] {
      margin-top: 5px; cursor: pointer; accent-color: #5B5FE8;
      width: 16px; height: 16px; flex-shrink: 0;
    }
    [data-ds-text] [data-type="checklist"] input[type="checkbox"]:checked + span {
      text-decoration: line-through; opacity: 0.45;
    }
    [data-ds-text] a { color: #5B5FE8; text-decoration: underline; }
    [data-ds-text] a:hover { opacity: 0.75; }
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
            fontFamily: "'DM Sans',sans-serif",
            pointerEvents: 'none', userSelect: 'none', lineHeight: 1.7,
          }}>
            Type <span style={{
              fontFamily: "'DM Mono',monospace", fontSize: 12,
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
            fontFamily: "'DM Sans',sans-serif",
            cursor: 'text',
            userSelect: 'text',
          }}
        />
      </div>

      {slashMenu && colors && (
        <SlashMenu
          x={slashMenu.x}
          y={slashMenu.y}
          filter={slashMenu.filter}
          colors={colors}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenu(null)}
        />
      )}

      {menuPos && colors && (
        <TextBlockToolbar
          x={menuPos.x}
          y={menuPos.y}
          colors={colors}
          onClose={handleToolbarClose}
        />
      )}
    </>
  )
}
