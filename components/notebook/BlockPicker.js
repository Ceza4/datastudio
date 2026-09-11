'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { searchBlocks } from '../../lib/teleport'
import { BLOCK_TYPES } from './blockRegistry'
import { Z } from '../../lib/theme'

/*
  components/notebook/BlockPicker.js
  --------------------------------------------------------------------------
  "Which block should this link point at?"

  Searches every block in every sheet of every notebook — not just the current
  sheet. The point of a teleporter is to cross those boundaries; a picker
  scoped to what's already on screen would only ever produce links you could
  have made by pointing.

  Keyboard-first, because it's opened from a slash command and the user's
  hands are already on the keys: type to filter, arrows to move, Enter to
  pick, Esc to cancel without inserting anything.
  -------------------------------------------------------------------------- */

const TYPE_LABELS = Object.fromEntries(
  Object.entries(BLOCK_TYPES).map(([k, v]) => [k, v.label])
)

export default function BlockPicker({ notebooks, currentBlockId, onPick, onCancel, colors }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  const results = useMemo(
    () => searchBlocks(notebooks, query, { exclude: currentBlockId, typeLabels: TYPE_LABELS }),
    [notebooks, query, currentBlockId]
  )

  // Filtering can shrink the list under the cursor; clamp rather than letting
  // the highlight point at nothing.
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, results.length - 1))) }, [results.length])

  useEffect(() => { inputRef.current?.focus() }, [])

  // Keep the active row visible without hijacking the page scroll.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[active]
      if (r) onPick(r)
      return
    }
    if (e.key === 'Escape') {
      /* Stopped here so the canvas's document-level Escape doesn't also fire
         and deselect the block behind the picker. */
      e.preventDefault(); e.stopPropagation()
      onCancel()
    }
  }

  const { surface, raised, border, text, text2, text3, accent, accentText, accentDim } = colors

  if (typeof document === 'undefined') return null

  const panel = (
    <div
      data-kbd-zone
      onMouseDown={e => e.stopPropagation()}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-label="Link to a block"
      style={{
        /* Fixed and portalled to <body>, like the slash menu and the format
           rail. The canvas applies `transform: scale()` for zoom, and an
           absolutely positioned child of a transformed ancestor is scaled with
           it — at 40% zoom this picker would render 136px wide with unreadable
           text. Fixed positioning inside the transform doesn't escape it
           either; only leaving the subtree does. */
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: Z.popover,
        width: 340, maxHeight: 380, display: 'flex', flexDirection: 'column',
        background: surface, border: `1px solid ${border}`, borderRadius: 'var(--ds-radius-pan)',
        boxShadow: 'var(--ds-shadow-lg)', overflow: 'hidden',
        fontFamily: 'var(--ds-font-body)',
      }}>

      {/* Same .ds-searchrow object as the Add menu. The leading icon keeps the
          accent tint — it is the one thing that differs between the two, and it
          differs on purpose. */}
      <div className="ds-searchrow">
        <Icon name="share-link" size="sm" style={{ color: accentText }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0) }}
          placeholder="Link to a block…"
          aria-label="Search blocks"
        />
        <kbd className="ds-kbd">esc</kbd>
      </div>

      <div ref={listRef} role="listbox" style={{ overflowY: 'auto', padding: 5 }}>
        {results.length === 0 && (
          <div style={{ padding: '18px 12px', textAlign: 'center', color: text2, fontSize: 13, lineHeight: 1.6 }}>
            {query
              ? <>Nothing matches “{query}”.</>
              : <>No other blocks yet.<br />Links point at blocks, so make one first.</>}
          </div>
        )}

        {results.map((r, i) => {
          const on = i === active
          const def = BLOCK_TYPES[r.block.type]
          return (
            <button
              key={`${r.addr.sheetId}:${r.addr.blockId}`}
              role="option"
              aria-selected={on}
              data-active={on ? 'true' : 'false'}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '8px 10px', border: 'none', borderRadius: 6, cursor: 'pointer',
                background: on ? accentDim : 'transparent',
                color: on ? accent : text,
                textAlign: 'left', fontFamily: 'var(--ds-font-body)',
              }}>
              <span style={{
                width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: on ? accent : raised, color: on ? '#fff' : text2,
              }}>
                <Icon name={def?.icon || 'block-text'} size={14} />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.label}
                </span>
                {/* The path matters here in a way it wouldn't in a same-sheet
                    picker: two blocks can legitimately share a name across
                    sheets, and this is the only thing telling them apart. */}
                <span style={{
                  display: 'block', fontSize: 11, marginTop: 1,
                  color: on ? accent : text3, opacity: on ? 0.8 : 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {r.notebookName} › {r.sheetName}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div style={{
        borderTop: `1px solid ${border}`, padding: '6px 12px',
        fontSize: 11, fontFamily: 'var(--ds-font-mono)', color: text3,
        display: 'flex', gap: 10,
      }}>
        <span>↑↓ move</span><span>⏎ link</span><span>esc cancel</span>
      </div>
    </div>
  )

  return createPortal(
    <>
      {/* A click anywhere else cancels. Without it the only way out is Esc,
          and a modal with no dismiss target traps anyone reaching for the
          mouse. */}
      <div onMouseDown={onCancel}
        style={{ position: 'fixed', inset: 0, zIndex: Z.popoverScrim, background: 'transparent' }} />
      {panel}
    </>,
    document.body
  )
}
