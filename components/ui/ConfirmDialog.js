'use client'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { Z } from '../../lib/theme'

/*
  components/ui/ConfirmDialog.js
  --------------------------------------------------------------------------
  The dialog for decisions undo cannot reach.

  WHEN TO USE THIS, AND WHEN NOT TO

  Not for deletes. A delete gets a toast with UNDO — see components/ui/Toast.js
  for why a confirmation that everyone clicks through has stopped preventing
  anything while still costing a click.

  This is for the two cases undo genuinely cannot cover:

  · IRREVERSIBLE. "Delete every notebook in this browser" has no way back, so
    the pause is real rather than ceremonial.
  · A CHOICE, NOT A CONFIRMATION. Deleting a section with blocks inside it used
    to read `OK = Delete all · Cancel = Keep blocks`, which crams three answers
    (delete all / keep the blocks / never mind) into a box with two buttons and
    then explains the mapping in prose. That is not a confirmation, and pretending
    it is one is how people lose work. `actions` takes as many as the decision
    genuinely has.

  WHY NOT window.confirm

  Beyond looking like a different product — an unstyled grey box captioned with
  your domain name — it blocks the entire tab, cannot be themed, cannot carry an
  icon, a destructive colour or a third option, and its line breaks are at the
  browser's discretion. There were fourteen of them in this app.

  PORTAL. Rule 2: `position: fixed` inside a CSS transform positions against the
  transform, not the viewport. These are opened from inside the canvas, so the
  whole thing renders to document.body. `npm run check:geom` enforces it.
  -------------------------------------------------------------------------- */

/**
 * @param {{
 *   open: boolean,
 *   title: string,
 *   body?: string,
 *   tone?: 'normal'|'danger',
 *   actions: Array<{label:string, value:any, tone?:'normal'|'danger'|'quiet', autoFocus?:boolean}>,
 *   onResolve: (value:any) => void,
 * }} props
 *
 * `onResolve` is called with the chosen action's `value`, or `null` for
 * Escape, a scrim click, or anything else that means "never mind". Callers
 * branch on the value rather than on a boolean, which is what lets a third
 * option exist at all.
 */
export default function ConfirmDialog({ open, title, body, tone = 'normal', actions = [], onResolve }) {
  const cardRef = useRef(null)

  /* Focus moves into the dialog on open and RETURNS to whatever opened it on
     close. Skipping the return is the accessibility bug people notice without
     being able to name: the dialog closes and the keyboard is back at the top
     of the document, so the next Tab starts from nowhere. */
  const openerRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    openerRef.current = document.activeElement
    const first = cardRef.current?.querySelector('[data-autofocus]') || cardRef.current?.querySelector('button')
    first?.focus()
    return () => { try { openerRef.current?.focus?.() } catch { /* the opener may be gone */ } }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onResolve(null); return }
      if (e.key !== 'Tab') return
      /* Trap. Without it Tab walks out of the dialog and into the canvas
         underneath, which is still there and still interactive — the user ends
         up typing into a block they cannot see behind the scrim. */
      const focusable = cardRef.current?.querySelectorAll('button:not([disabled])')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    /* Capture, so the canvas keymap does not see the Escape first and close
       something else instead. */
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onResolve])

  /* `open` is false on the server and on first paint, so there is no hydration
     mismatch to guard against and no need for a mount flag — see the same note
     in components/ui/Toast.js. */
  if (!open || typeof document === 'undefined') return null

  const danger = tone === 'danger'

  return createPortal(
    <div
      data-ds-dialog-scrim
      onPointerDown={e => { if (e.target === e.currentTarget) onResolve(null) }}
      style={{
        position: 'fixed', inset: 0, zIndex: Z.dialog,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--ds-space-5)',
        /* Deliberately not pure black: the canvas keeps its warmth through the
           scrim, so the dialog reads as being IN the app rather than over it. */
        background: 'rgba(26, 25, 23, 0.42)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        animation: 'dsScrimIn 0.14s ease',
      }}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-kbd-zone
        style={{
          width: 'min(420px, 100%)',
          /* Sized by its content, never by a fixed height. Handover rule 6:
             the card must fit what it says, or a long message is clipped and
             the most important screen in the app becomes unreadable. */
          background: 'var(--ds-glass)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--ds-border)',
          borderRadius: 'var(--ds-radius-lg)',
          boxShadow: 'var(--ds-shadow-lg)',
          padding: 'var(--ds-space-5)',
          fontFamily: 'var(--ds-font-body)',
          animation: 'dsDialogIn 0.18s cubic-bezier(.34,1.2,.64,1)',
        }}>
        <div style={{ display: 'flex', gap: 'var(--ds-space-3)', alignItems: 'flex-start' }}>
          <Icon
            name={danger ? 'status-warning' : 'status-info'}
            size={15}
            style={{ color: danger ? 'var(--ds-red)' : 'var(--ds-text-2)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--ds-font-head)', fontSize: 'var(--ds-fs-xl)',
              fontWeight: 700, color: 'var(--ds-text)', lineHeight: 1.3,
            }}>{title}</div>
            {body && (
              <div style={{
                marginTop: 'var(--ds-space-2)',
                fontSize: 'var(--ds-fs-lg)', lineHeight: 1.5,
                color: 'var(--ds-text-2)', whiteSpace: 'pre-line',
              }}>{body}</div>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap',
          gap: 'var(--ds-space-2)', marginTop: 'var(--ds-space-5)',
        }}>
          {actions.map(a => (
            <DialogButton key={a.label} action={a} onResolve={onResolve} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* Module scope, not declared inside ConfirmDialog. A component created during
   render is a new type every render, so React tears the buttons down and
   rebuilds them instead of updating — the same bug that was remounting all
   seventeen buttons of the text rail on every drag frame. */
function DialogButton({ action, onResolve }) {
  const danger = action.tone === 'danger'
  const quiet = action.tone === 'quiet'
  const base = {
    padding: 'var(--ds-btn-padding)',
    borderRadius: 'var(--ds-radius-md)',
    fontFamily: 'var(--ds-font-body)',
    fontSize: 'var(--ds-fs-lg)',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background var(--ds-transition), border-color var(--ds-transition), color var(--ds-transition)',
  }
  const style = danger
    ? { ...base, background: 'var(--ds-red)', border: '1px solid var(--ds-red)', color: 'var(--ds-base)' }
    : quiet
      ? { ...base, background: 'none', border: '1px solid transparent', color: 'var(--ds-text-3)' }
      : { ...base, background: 'var(--ds-raised)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }

  return (
    <button
      {...(action.autoFocus ? { 'data-autofocus': 'true' } : {})}
      onClick={() => onResolve(action.value)}
      style={style}
      onMouseEnter={e => {
        if (quiet) e.currentTarget.style.color = 'var(--ds-text)'
        else if (!danger) e.currentTarget.style.borderColor = 'var(--ds-text-3)'
        else e.currentTarget.style.opacity = '0.88'
      }}
      onMouseLeave={e => {
        if (quiet) e.currentTarget.style.color = 'var(--ds-text-3)'
        else if (!danger) e.currentTarget.style.borderColor = 'var(--ds-border)'
        else e.currentTarget.style.opacity = '1'
      }}
    >{action.label}</button>
  )
}
