'use client'
import { useRef, useEffect } from 'react'

/* Stable text editing — ref-based, no dangerouslySetInnerHTML re-renders.
   Lives outside React's render cycle so typing in contentEditable doesn't get cancelled. */
export default function TextBlockContent({ blockId, initialContent, onSave, text, onEditStart, onEditEnd, minHeight = 80 }) {
  const ref = useRef(null)
  const savedContent = useRef(initialContent || '')

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialContent || ''
      savedContent.current = initialContent || ''
    }
  }, [blockId])

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onFocus={() => onEditStart?.()}
      onBlur={e => {
        const html = e.currentTarget.innerHTML
        if (html !== savedContent.current) {
          savedContent.current = html
          onSave(html)
        }
        onEditEnd?.()
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
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
  )
}
