'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { SYNC_OFF, SYNC_SYNCED, SYNC_SYNCING, SYNC_QUEUED, SYNC_ERROR } from '../../lib/sync'

/*
  components/ui/SyncChip.js
  --------------------------------------------------------------------------
  Bottom right, small, and gone when there is nothing to say.

  WHAT CHANGED AND WHY

  The first version lived in the top-right island next to Builder and Settings,
  at the same size and weight as them, permanently. That was wrong twice over.
  It sat in the most valuable corner of the screen showing "Synced" — a word
  that is true 99% of the time and therefore carries no information — and its
  size implied it was a control you press rather than a state you glance at.
  Chrome that shouts when it is happy trains people to stop reading it.

  So: it appears while syncing, confirms briefly, and disappears.

  WHAT DOES *NOT* AUTO-DISMISS, AND THAT IS THE POINT

  Queued and error states stay until they resolve. "Waiting to sync" can last
  hours on a bad connection, and a message that vanished four seconds after
  appearing would be invisible for all but the first moment of exactly the
  situation somebody needs to know about. The backend plan's rule was that
  silence is not one of the four states; auto-dismissing the failure states
  would reintroduce silence through the back door.

  So the rule is: transient on success, persistent on trouble.
  -------------------------------------------------------------------------- */

/* Long enough to register as confirmation, short enough not to become
   furniture. Below about a second it reads as a flicker and people ask what it
   said. */
const CONFIRM_MS = 1600

export default function SyncChip({ status, colors, dark, onRetry }) {
  const state = status?.state || SYNC_OFF
  const pending = status?.pending || 0
  const { surface, border, text2, text3 } = colors

  const [visible, setVisible] = useState(false)
  /* The state being SHOWN, which lags the real one: when a sync finishes we
     keep rendering "Synced" for a moment after the engine has already moved
     on, otherwise the confirmation would never be seen at all. */
  const [shown, setShown] = useState(state)
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)

    if (state === SYNC_SYNCING || state === SYNC_QUEUED || state === SYNC_ERROR) {
      setShown(state)
      setVisible(true)
      return
    }

    if (state === SYNC_SYNCED) {
      /* Only confirm something that was actually watched happening. Mounting
         into an already-synced workspace should not flash "Synced" at someone
         who did nothing — the state has not changed, it was simply true when
         they arrived. */
      setShown(SYNC_SYNCED)
      setVisible(wasVisible => wasVisible)
      timer.current = setTimeout(() => setVisible(false), CONFIRM_MS)
      return
    }

    /* SYNC_OFF: unconfigured, signed out, or a Free account, which is
       local-only by design. Nothing to report, so nothing on screen. */
    setVisible(false)
  }, [state, pending])

  useEffect(() => () => clearTimeout(timer.current), [])

  const look = {
    [SYNC_SYNCED]:  { icon: 'sync-synced',  color: text3,               label: 'Synced' },
    [SYNC_SYNCING]: { icon: 'sync-syncing', color: text2,               label: 'Syncing' },
    [SYNC_QUEUED]:  { icon: 'sync-offline', color: 'var(--ds-amber)',   label: pending ? `${pending} waiting` : 'Waiting' },
    [SYNC_ERROR]:   { icon: 'sync-error',   color: 'var(--ds-red)',     label: 'Sync error' },
  }[shown] || { icon: 'sync-offline', color: text3, label: '' }

  const interactive = shown === SYNC_QUEUED || shown === SYNC_ERROR

  return (
    <div
      /* Kept mounted and faded rather than unmounted, so the exit is a fade
         rather than a disappearance. pointerEvents goes to none while hidden —
         an invisible element that still swallows clicks in the corner of the
         canvas is the kind of bug nobody thinks to look for. */
      aria-hidden={!visible}
      style={{
        position: 'fixed', right: 14, bottom: 14, zIndex: 60,
        display: 'flex', alignItems: 'center', gap: 6,
        /* Roughly half the old footprint: 11px type, 6px vertical padding. It
           is a status light, not a button. */
        padding: '6px 10px', borderRadius: 6,
        background: `${surface}e8`,
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        border: `1px solid ${shown === SYNC_ERROR ? 'var(--ds-red)' : border}`,
        boxShadow: `0 2px 10px ${dark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.07)'}`,
        fontFamily: 'var(--ds-font-body)', fontSize: 12,
        color: look.color,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity .22s ease, transform .22s ease',
        pointerEvents: visible && interactive ? 'auto' : 'none',
        cursor: interactive ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      title={status?.message || look.label}
      onClick={interactive ? onRetry : undefined}
    >
      <Icon name={look.icon} size={12} />
      {look.label}
    </div>
  )
}
