'use client'
import { createContext, useContext } from 'react'
import Icon from '../ui/Icon'
import { HOLD_MS } from '../../lib/focusmode'
import { Z } from '../../lib/theme'

/* ── FULL SCREEN, THE SHARED CHROME ───────────────────────────────────────
   One context for the canvas's full-screen state, so the block's title bar
   (BlockHandle, rendered by thirteen block types) can show "Full screen" and
   "Exit full screen" without thirteen call sites each being handed four more
   props. NotebookCanvas provides it; the default below is what a handle
   rendered outside the canvas sees, which is "not available". */
export const FocusCtx = createContext({
  focusId: null,
  hold: 'idle',
  storedDims: null,
  canFocus: () => false,
  enter: () => {},
  exit: () => {},
})
export const useFocusMode = () => useContext(FocusCtx)

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
export const focusShortcutLabel = () => (isMac() ? '⌘⇧F' : 'Ctrl+Shift+F')

/* The way out, as it sits in a block's title bar: the size the block keeps on
   the canvas, the Exit button, the Escape-hold progress bar under it and the
   hint that a tap shows. `floating` draws it as its own little island, for
   the block types that have no title bar (file, task). */
export function FocusExit({ colors, floating = false }) {
  const { hold, storedDims, exit } = useFocusMode()
  const { text2, text3, accent, accentText, border, raised, surface, base } = colors
  const holding = hold === 'holding'
  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        ...(floating ? {
          position: 'absolute', top: 18, right: 18, zIndex: Z.chromeTop,
          padding: '6px 6px 6px 12px', borderRadius: 10,
          background: `${surface}ee`, border: `1px solid ${border}`,
          boxShadow: 'var(--ds-shadow-md)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        } : null),
      }}>
      {storedDims && (
        <span
          title="Full screen is a view. The block keeps this size on the canvas."
          style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3, whiteSpace: 'nowrap' }}>
          {Math.round(storedDims.w)} × {Math.round(storedDims.h)} on canvas
        </span>
      )}
      <div style={{ position: 'relative' }}>
        <button
          data-ds-focus-exit
          onClick={e => { e.stopPropagation(); exit() }}
          onMouseDown={e => e.preventDefault()}
          title={`Exit full screen (${focusShortcutLabel()}, or hold Esc)`}
          aria-label="Exit full screen"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 22,
            padding: '0 6px 0 7px', borderRadius: 6, cursor: 'pointer',
            background: holding ? `${accent}1f` : base,
            border: `1px solid ${holding ? accent : border}`,
            color: holding ? accentText : text2,
            fontFamily: 'var(--ds-font-body)', fontSize: 12, whiteSpace: 'nowrap',
            transition: 'border-color .12s ease, color .12s ease, background .12s ease',
          }}
          onMouseEnter={e => { if (!holding) { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accentText } }}
          onMouseLeave={e => { if (!holding) { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text2 } }}>
          <Icon name="view-fullscreen-exit" size={12} />
          Exit full screen
          <kbd style={{
            fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3,
            border: `1px solid ${border}`, borderRadius: 4, padding: '0 4px', lineHeight: '14px',
          }}>{focusShortcutLabel()}</kbd>
        </button>

        {/* The Escape hold, made visible. Always mounted so the width can
            transition from 0: mounting it at 100% would skip the animation. */}
        <div aria-hidden="true" style={{
          position: 'absolute', left: 2, right: 2, bottom: -5, height: 3,
          borderRadius: '999px', background: raised, overflow: 'hidden',
          opacity: holding ? 1 : 0, transition: 'opacity .12s ease',
        }}>
          <div style={{
            height: '100%', borderRadius: '999px', background: accent,
            width: holding ? '100%' : '0%',
            transition: holding ? `width ${HOLD_MS}ms linear` : 'none',
          }} />
        </div>

        <div role="status" aria-live="polite" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 10px)', zIndex: Z.hint,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          padding: '5px 9px', borderRadius: 6,
          background: 'var(--ds-text)', color: 'var(--ds-base)',
          fontFamily: 'var(--ds-font-body)', fontSize: 12,
          boxShadow: 'var(--ds-shadow-md)',
          opacity: hold === 'idle' ? 0 : 1,
          transform: hold === 'idle' ? 'translateY(-4px)' : 'none',
          transition: 'opacity .16s ease, transform .16s ease',
        }}>
          {hold === 'holding' ? <>Keep holding <b>Esc</b> to exit</>
            : hold === 'hint' ? <>Hold <b>Esc</b> to exit full screen</> : ''}
        </div>
      </div>
    </div>
  )
}

/* The "go full screen" button for a block's title bar. */
export function FocusEnter({ block, colors }) {
  const { canFocus, enter } = useFocusMode()
  if (!canFocus(block)) return null
  const { text3, accent } = colors
  return (
    <button
      data-ds-focus-enter
      onClick={e => { e.stopPropagation(); enter(block.id) }}
      /* preventDefault keeps focus where it was: clicking this while typing
         in the block should open it full screen with the caret still there,
         not move focus to the button. */
      onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
      title={`Full screen (${focusShortcutLabel()})`}
      aria-label="Full screen"
      style={{
        background: 'none', border: 'none', color: text3, cursor: 'pointer',
        lineHeight: 1, padding: '0 2px', flexShrink: 0, display: 'flex', alignItems: 'center',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = accent)}
      onMouseLeave={e => (e.currentTarget.style.color = text3)}>
      <Icon name="view-fullscreen-enter" size={12} />
    </button>
  )
}
