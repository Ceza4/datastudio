'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NODE_H, nodeWidth } from '../../lib/mindmap'

/*
  components/visuals/ShapeTextEditor.js
  --------------------------------------------------------------------------
  Editing the words on a shape or a mind-map topic. Rendered INSIDE the
  canvas's zoomed world at the box's own world coordinates, so it scales,
  pans and rotates with the thing it edits and never has to be re-placed on
  a camera move.

  Keys, following Miro:
    · shape / sticky / text: Enter is a new line (notes are paragraphs);
      Esc or Ctrl/⌘+Enter finishes; clicking away finishes
    · topic: Enter finishes and adds a sibling, Tab finishes and adds a
      child, Esc finishes. Handed back through onDone(text, key).
  -------------------------------------------------------------------------- */

export default function ShapeTextEditor({ box, rot, value, initialChar, node, isRoot, big, sticky, onDone }) {
  const ref = useRef(null)
  const [text, setText] = useState(initialChar != null ? initialChar : (value || ''))
  const done = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    if (initialChar != null) el.setSelectionRange(el.value.length, el.value.length)
    else el.select()
  }, [])

  /* Auto-height for boxes: the textarea is centred by its wrapper and grows
     with its lines, which is how the rendered label sits too. */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || node) return
    el.style.height = '0px'
    el.style.height = Math.min(box.h, el.scrollHeight) + 'px'
  }, [text, node, box.h])

  const finish = key => {
    if (done.current) return
    done.current = true
    onDone(text, key)
  }

  const onKeyDown = e => {
    e.stopPropagation()
    if (e.nativeEvent.isComposing) return
    if (node && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { e.preventDefault(); finish(e.key); return }
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finish('Escape') }
  }

  const common = {
    ref, value: text, 'aria-label': node ? 'Topic text' : 'Shape text', 'data-ds-shape-editor': '',
    onChange: e => setText(e.target.value),
    onKeyDown, onBlur: () => finish('blur'),
    onMouseDown: e => e.stopPropagation(), onClick: e => e.stopPropagation(), onDoubleClick: e => e.stopPropagation(),
    spellCheck: true,
  }

  if (node) {
    const w = Math.max(box.w, nodeWidth(text, isRoot) + 4)
    return (
      <textarea {...common} rows={1}
        style={{
          position: 'absolute', left: box.x, top: box.y, width: w, height: NODE_H, zIndex: 8,
          boxSizing: 'border-box', padding: '0 12px', margin: 0, resize: 'none', overflow: 'hidden', whiteSpace: 'nowrap',
          lineHeight: `${NODE_H - 4}px`, fontFamily: 'var(--ds-font-body)', fontSize: 13, fontWeight: isRoot ? 600 : 500,
          color: 'var(--ds-text)', background: 'var(--ds-paper)', border: '2px solid var(--ds-accent)', borderRadius: 8, outline: 'none',
        }} />
    )
  }

  return (
    <div style={{
      position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transform: rot ? `rotate(${rot}deg)` : undefined, transformOrigin: 'center',
    }} onMouseDown={e => e.stopPropagation()}>
      <textarea {...common} rows={1}
        style={{
          width: '100%', maxHeight: box.h, boxSizing: 'border-box', padding: big ? '2px 4px' : '0 8px', margin: 0,
          resize: 'none', overflow: 'hidden', background: 'transparent', border: 'none', outline: 'none', textAlign: 'center',
          fontFamily: 'var(--ds-font-body)', fontSize: big ? 16 : 13, fontWeight: big ? 600 : 500, lineHeight: 1.35,
          color: sticky ? 'var(--ds-sticky-text)' : 'var(--ds-text)', caretColor: 'var(--ds-accent)',
        }} />
    </div>
  )
}
