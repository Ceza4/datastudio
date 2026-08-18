'use client'
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

/*
  components/ui/Toast.js
  --------------------------------------------------------------------------
  Undo instead of "Are you sure?".

  WHY THIS REPLACES A CONFIRM DIALOG RATHER THAN RESTYLING ONE

  A confirmation is a tax every user pays, every time, to prevent a mistake
  almost none of them are about to make. It interrupts the person who meant it
  to protect the person who didn't, and after the third time nobody reads it —
  they just click OK, which means it has stopped preventing anything while
  still costing a click.

  Undo inverts that. The action happens immediately, and the cost of the rare
  mistake is one click on something already in front of you. It is faster for
  everyone AND safer for the person who slipped, which is the rare case where
  the premium option and the cheap option are the same option.

  So deletes here do not ask. They delete, and offer the way back.

  A CONFIRM DIALOG IS STILL RIGHT for anything undo cannot reach — wiping every
  notebook in the browser has no way back, so that one keeps a real dialog. See
  components/ui/ConfirmDialog.js.

  PORTAL, NOT position:fixed IN PLACE
  Rule 2 in the handover: `position: fixed` inside a CSS transform positions
  against the transform, not the viewport, and no arithmetic fixes it. Toasts
  are raised from inside the canvas, so they render through a portal to
  document.body. `npm run check:geom` enforces this.
  -------------------------------------------------------------------------- */

const ToastContext = createContext(null)

/* Long enough to read a sentence and move the mouse; short enough that a
   stack of them clears before it becomes wallpaper. Undo toasts get longer,
   because deciding to undo takes longer than reading a confirmation. */
const DEFAULT_MS = 4000
const UNDO_MS = 7000
const MAX_VISIBLE = 4

let seq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback(id => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    setToasts(list => list.filter(x => x.id !== id))
  }, [])

  /**
   * @param {string} message
   * @param {{tone?:'info'|'success'|'warn'|'error', undo?:Function, duration?:number}} opts
   */
  const toast = useCallback((message, { tone = 'info', undo, duration } = {}) => {
    const id = `t${++seq}`
    const ms = duration ?? (undo ? UNDO_MS : DEFAULT_MS)
    setToasts(list => [...list, { id, message, tone, undo }].slice(-MAX_VISIBLE))
    timers.current.set(id, setTimeout(() => dismiss(id), ms))
    return id
  }, [dismiss])

  /* Clearing on unmount matters: a pending timer that fires after the tree is
     gone calls setState on nothing and logs a warning nobody can act on. */
  const timersRef = timers
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); timersRef.current.clear() }, [timersRef])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/**
 * `const toast = useToast()` → `toast('Notebook deleted', { undo: restore })`
 * Returns a no-op outside a provider, so a component stays usable in tests and
 * in isolation rather than throwing.
 */
export function useToast() {
  return useContext(ToastContext) || (() => {})
}

function ToastHost({ toasts, onDismiss }) {
  /* No `mounted` flag. The usual SSR dance — render nothing, flip a state in an
     effect, portal on the second pass — exists to avoid a hydration mismatch,
     and there is nothing to mismatch here: the list is empty until a user
     action fills it, so this renders null on the server AND on first paint
     either way. The flag would only buy a guaranteed extra render on mount,
     which is what react-hooks/set-state-in-effect is warning about. */
  if (typeof document === 'undefined' || !toasts.length) return null

  return createPortal(
    <div
      data-ds-toasts
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)',
        zIndex: 100000,
        display: 'flex', flexDirection: 'column-reverse', alignItems: 'center',
        gap: 'var(--ds-space-2)',
        /* The stack must not eat clicks on the canvas behind it; each toast
           re-enables pointer events for itself. */
        pointerEvents: 'none',
      }}>
      {toasts.map(t => <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>,
    document.body,
  )
}

const TONE_COLOR = {
  info: 'var(--ds-text-2)',
  success: 'var(--ds-accent)',
  warn: 'var(--ds-amber)',
  error: 'var(--ds-red)',
}
const TONE_ICON = {
  info: 'status-info',
  success: 'status-success',
  warn: 'status-warning',
  error: 'status-error',
}

function ToastRow({ toast, onDismiss }) {
  return (
    <div
      data-ds-toast
      /* The row itself dismisses. There is no × button because the icon set has
         no close glyph, and hand-adding one would bypass `npm run icons` and
         the spec it enforces — but the real reason is that it is better this
         way: one fewer element, a target the size of the whole toast, and
         nothing to aim at. */
      onClick={() => onDismiss(toast.id)}
      style={{
        pointerEvents: 'auto', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 'var(--ds-space-3)',
        maxWidth: 520, padding: '9px 10px 9px 13px',
        /* House chrome: frosted island. Same recipe as every rail, so a toast
           reads as part of the app rather than as a notification. */
        background: 'var(--ds-glass)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--ds-border)',
        borderRadius: 'var(--ds-radius-lg)',
        boxShadow: 'var(--ds-shadow-lg)',
        fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-lg)',
        color: 'var(--ds-text)',
        animation: 'dsToastIn 0.22s cubic-bezier(.34,1.2,.64,1)',
      }}>
      <Icon name={TONE_ICON[toast.tone] || 'status-info'} size={13}
        style={{ color: TONE_COLOR[toast.tone] || 'var(--ds-text-2)', flexShrink: 0 }} />

      <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>

      {toast.undo && (
        <button
          onClick={e => { e.stopPropagation(); toast.undo(); onDismiss(toast.id) }}
          style={{
            flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
            padding: '3px 7px', borderRadius: 'var(--ds-radius-sm)',
            /* Mono, because it reads as a control rather than as more prose —
               same reason figures use it everywhere else in the app. */
            fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-sm)',
            fontWeight: 600, letterSpacing: 0.4,
            color: 'var(--ds-accent)',
            transition: 'background var(--ds-transition)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--ds-accent-dim)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
        >UNDO</button>
      )}

</div>
  )
}
