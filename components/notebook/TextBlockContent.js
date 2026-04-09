'use client'
import { useRef, useEffect, useState } from 'react'
import TextBlockToolbar from './TextBlockToolbar'

/* Stable text editing — ref-based, no dangerouslySetInnerHTML re-renders.
   Lives outside React's render cycle so typing in contentEditable doesn't get cancelled.

   POLISH UPDATE: now supports right-click → floating formatting toolbar
   (bold/italic/underline/font/color/link). The toolbar component lives
   in TextBlockToolbar.js. Right-click is captured here so it doesn't
   bubble up to the canvas's pan handler. */
export default function TextBlockContent({ blockId, initialContent, onSave, text, colors, onEditStart, onEditEnd, minHeight = 80 }) {
  const ref = useRef(null)
  const savedContent = useRef(initialContent || '')
  const [menuPos, setMenuPos] = useState(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialContent || ''
      savedContent.current = initialContent || ''
    }
  }, [blockId])

  function handleContextMenu(e) {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    onEditStart?.()
  }

  function handleToolbarClose() {
    setMenuPos(null)
    // Persist whatever was changed via execCommand
    if (ref.current) {
      const html = ref.current.innerHTML
      if (html !== savedContent.current) {
        savedContent.current = html
        onSave(html)
      }
    }
  }

  return (
    <>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onFocus={() => onEditStart?.()}
        onBlur={e => {
          // Don't fire onBlur close if we're interacting with the toolbar
          if (menuPos) return
          const html = e.currentTarget.innerHTML
          if (html !== savedContent.current) {
            savedContent.current = html
            onSave(html)
          }
          onEditEnd?.()
        }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        onContextMenu={handleContextMenu}
        style={{
          minHeight,
          padding: '10px 12px',
          fontSize: 13,
          color: text,
          lineHeight: 1.7,
          outline: 'none',
          fontFamily: "'DM Sans',sans-serif",
          cursor: 'text',
          userSelect: 'text',
        }}
      />
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
