'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '../../../lib/theme'

/*
  components/notebook/doc/DocUi.js
  --------------------------------------------------------------------------
  Small shared pieces for the Document block's menus, popovers and dialogs.
  Everything that floats is PORTALLED to <body> and positioned in screen
  space: the document sits inside the canvas's CSS transform, where a fixed
  element would be placed against the canvas and scaled with it.
  -------------------------------------------------------------------------- */

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
export const K = k => `${isMac() ? '⌘' : 'Ctrl'}+${k}`

export function popStyle(extra) {
  return {
    background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 8,
    boxShadow: 'var(--ds-shadow-lg)', padding: 4, fontFamily: 'var(--ds-font-body)', ...extra,
  }
}

/** A menu row. Fires on mousedown so the document's selection survives. */
export function Item({ label, hint, onPick, disabled, on, danger }) {
  return (
    <button type="button" role="menuitem" disabled={disabled}
      onMouseDown={e => { e.preventDefault(); if (!disabled) onPick() }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!disabled) onPick() } }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--ds-raised)' }}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '7px 10px',
        border: 'none', background: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1, fontFamily: 'var(--ds-font-body)', fontSize: 13,
        color: danger ? 'var(--ds-red)' : on ? 'var(--ds-accent)' : 'var(--ds-text-2)', fontWeight: on ? 600 : 400,
      }}>
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: 'var(--ds-text-3)' }}>{hint}</span>}
    </button>
  )
}

export function Sep() {
  return <div style={{ height: 1, background: 'var(--ds-border)', margin: '4px 2px' }} />
}

/** A popover at a screen point, kept inside the window. */
export function FloatAt({ x, y, children, style, label, role = 'menu', onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const left = Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8))
    const top = y + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, y - el.offsetHeight - 12) : y
    setPos({ left, top, visibility: 'visible' })
  }, [x, y])
  /* React's autoFocus runs while the popover is still hidden for measuring,
     and a hidden input cannot take focus; focus once it is visible. */
  const shown = pos.visibility === 'visible'
  useEffect(() => { if (shown) ref.current?.querySelector('[data-autofocus]')?.focus() }, [shown])
  useEffect(() => {
    if (!onClose) return
    const down = e => { if (!ref.current?.contains(e.target)) onClose() }
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.__dsConsumed = true; onClose() } }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true) }
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={ref} data-ds-doc-pop="" role={role} aria-label={label}
      style={{ position: 'fixed', zIndex: Z.popover, ...pos, ...popStyle(style) }}>
      {children}
    </div>,
    document.body,
  )
}

/**
 * A modal dialog: portalled, focus moved in and trapped, Esc and the scrim
 * close it, focus goes back to whatever opened it.
 */
export function Dialog({ title, width = 420, onClose, children, footer }) {
  const card = useRef(null)
  const opener = useRef(null)
  useEffect(() => {
    opener.current = document.activeElement
    const f = card.current?.querySelector('input,textarea,select,button')
    f?.focus()
    return () => { try { opener.current?.focus?.({ preventScroll: true }) } catch { /* gone */ } }
  }, [])
  useEffect(() => {
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.__dsConsumed = true; onClose(); return }
      if (e.key !== 'Tab') return
      const f = card.current?.querySelectorAll('input,textarea,select,button:not([disabled])')
      if (!f?.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div data-ds-scrim onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: Z.dialogScrim, background: 'rgba(0,0,0,0.28)' }} />
      <div ref={card} role="dialog" aria-modal="true" aria-label={title} data-ds-dialog data-kbd-zone data-ds-doc-pop=""
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: Z.dialog,
          width, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column',
          background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 12,
          boxShadow: 'var(--ds-shadow-lg)', fontFamily: 'var(--ds-font-body)', overflow: 'hidden',
          animation: 'dsDialogIn var(--ds-motion-enter) var(--ds-ease-overshoot)',
        }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ds-border)', fontSize: 13, fontWeight: 650, color: 'var(--ds-text)' }}>{title}</div>
        <div style={{ padding: 14, overflowY: 'auto', minHeight: 0 }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', padding: '10px 14px', borderTop: '1px solid var(--ds-border)' }}>{footer}</div>}
      </div>
    </>,
    document.body,
  )
}

export function Btn({ children, primary, onClick, disabled, title }) {
  return (
    <button type="button" className={`ds-btn${primary ? ' ds-btn-primary' : ''}`} disabled={disabled} title={title}
      style={{ opacity: disabled ? 0.5 : 1 }} onClick={onClick}>{children}</button>
  )
}

export const fieldStyle = {
  height: 28, border: '1px solid var(--ds-border)', borderRadius: 6, background: 'var(--ds-base)', color: 'var(--ds-text)',
  padding: '0 8px', fontFamily: 'var(--ds-font-body)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', minWidth: 0,
}

export function Field({ label, children, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--ds-text-3)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ds-text-3)' }}>{hint}</span>}
    </label>
  )
}
