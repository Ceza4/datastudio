'use client'
import { useState, useEffect, memo } from 'react'
import { UNITS, ZERO, decompose, visibleUnits, pad, toLocalInput, fromLocalInput } from '../../lib/countdown'

/*
  components/notebook/CountdownBlock.js
  --------------------------------------------------------------------------
  A live countdown to a date, as a block on the canvas.

  THE DATE ARITHMETIC IS NOT HERE. It lives in lib/countdown.js — calendar-unit
  stepping for years/months/days, milliseconds only below a day, and the
  reasoning for both — so it can be unit-tested in bare Node
  (tests/countdown.test.mjs) instead of through a render. This file is the
  chrome: what ticks, what is on screen, and when to stop.

  LEADING UNITS ARE HIDDEN, NOT ZEROED
  A three-day countdown reading "0 YR 0 MO 3 DAY" is noise. visibleUnits()
  drops everything above the largest non-zero unit, so the block narrows as the
  date approaches, with minutes and seconds as the floor.

  WIDTH IS CONTENT-DRIVEN
  No stored w/h and no resize handle — see `resizable: null` in
  blockRegistry.js. Six units and two units want very different widths and the
  right one is always computable, so a drag handle here would only let you
  disagree with the contents.

  EXPIRED IS RED ZEROS, NOT A WORD
  It freezes at 00 00 in `colors.red` and stops its own timer. "elapsed" swaps
  to a count-up since the target, in normal text colour, which is the one state
  that keeps ticking after zero.
  -------------------------------------------------------------------------- */

function CountdownBlockInner({ block, colors, isSelected, onUpdateBlock }) {
  const { raised, border, text, text2, text3, red } = colors

  const target = block.target ? new Date(block.target).getTime() : NaN
  const valid = !Number.isNaN(target)

  const [now, setNow] = useState(() => Date.now())
  const [showElapsed, setShowElapsed] = useState(false)

  const expired = valid && now >= target

  /* ONE TIMER, AND IT STOPS WHEN THERE IS NOTHING LEFT TO COUNT.

     A frozen 00 00 does not need a heartbeat, so the timer is torn down the
     moment the block expires unless the elapsed view is open. That matters at
     canvas scale: a workspace with twenty finished countdowns should cost
     nothing, not twenty wakeups a second forever.

     A SELF-SCHEDULING TIMEOUT ALIGNED TO THE SECOND, not setInterval(1000).
     An interval started at some arbitrary moment fires 400ms after the wall
     clock rolls over and stays that way, so the digit changes visibly late and
     — worse on a canvas holding several — every countdown ticks at its own
     private offset. Re-arming with `1000 - (now % 1000)` puts every block on
     the same edge as the system clock, and re-reading Date.now() each time
     means a tab that was throttled in the background comes back to the right
     number rather than to however far the interval drifted.

     The first arm is 0ms, which is what makes a restarted timer correct
     itself on the next macrotask instead of a second later: `now` is stale by
     however long the block sat frozen, so the alternative is one visible frame
     of nonsense every time somebody re-dates an expired countdown. */
  const running = valid && (!expired || showElapsed)
  useEffect(() => {
    if (!running) return
    let id
    const tick = () => {
      const t = Date.now()
      setNow(t)
      id = setTimeout(tick, 1000 - (t % 1000))
    }
    id = setTimeout(tick, 0)
    return () => clearTimeout(id)
  }, [running])

  /* Coming back to a tab that slept through the deadline must not wait a whole
     second to notice, and a browser that suspended the interval entirely must
     not leave a stale number on screen. */
  useEffect(() => {
    const sync = () => setNow(Date.now())
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  /* A NEW TARGET CLOSES THE ELAPSED VIEW, DURING RENDER RATHER THAN IN AN
     EFFECT.

     A count-up makes no sense against a date that has not happened yet, and
     the target can change from outside this component — an undo, or a sync
     from another device — so the reset cannot live only in the input's own
     handler. Adjusting state during render re-runs the component immediately
     without painting the stale pass, where an effect would paint first and fix
     second. React documents this exact pattern for "a component needs to reset
     state when a prop changes":
     https://react.dev/learn/you-might-not-need-an-effect

     No Date.now() in here. Render must be pure — calling it would make two
     renders of the same state disagree — so the clock is refreshed by the
     0ms arm in the timer above and, for the common path, by the picker's own
     onChange below. */
  const [prevTarget, setPrevTarget] = useState(block.target)
  if (prevTarget !== block.target) {
    setPrevTarget(block.target)
    setShowElapsed(false)
  }

  const counting = expired && showElapsed
  const parts = !valid ? { ...ZERO }
    : expired ? (showElapsed ? decompose(target, now) : { ...ZERO })
    : decompose(now, target)

  const cells = expired && !showElapsed ? UNITS.filter(u => u.min) : visibleUnits(parts)
  const digitColor = expired && !showElapsed ? red : text

  return (
    <div style={{ padding: '12px 14px 12px', fontFamily: 'var(--ds-font-body)' }}>

      {/* THE DIGITS.
          Explicit px, not a --ds-fs- token: the scale tops out at 15px because
          it exists for UI chrome, and this is the one piece of content in the
          block. `tabular-nums` so the row does not twitch as 9 becomes 10. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        {cells.map(u => (
          <div key={u.key} style={{
            background: raised, borderRadius: 6, padding: '7px 9px 6px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            minWidth: 40,
          }}>
            <div style={{
              fontFamily: 'var(--ds-font-mono)', fontSize: 24, fontWeight: 300,
              lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
              color: digitColor,
            }}>{pad(parts[u.key])}</div>
            <div style={{
              fontFamily: 'var(--ds-font-mono)', fontSize: 11, letterSpacing: 0.8,
              lineHeight: 1, color: text3,
            }}>{u.label}</div>
          </div>
        ))}
      </div>

      {/* Status line. Carries the elapsed toggle once there is one, and the
          target date the rest of the time — which is the question you actually
          have when you look at a countdown that still has months on it. */}
      <div style={{
        marginTop: 9, display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 'var(--ds-fs-xs)', color: text2, minHeight: 15,
      }}>
        {!valid ? (
          <span style={{ color: text3 }}>No date set</span>
        ) : expired ? (
          <button
            type="button"
            onClick={() => setShowElapsed(v => !v)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              font: 'inherit', color: text2, textDecoration: 'underline',
              textUnderlineOffset: 3, textDecorationColor: border,
            }}
          >{counting ? 'countdown' : 'elapsed'}</button>
        ) : (
          <span style={{ fontFamily: 'var(--ds-font-mono)', color: text3 }}>
            {new Date(target).toLocaleString(undefined, {
              day: 'numeric', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}
        {counting && <span style={{ color: text3 }}>since target</span>}
      </div>

      {/* THE PICKER APPEARS ON SELECTION, exactly like the task block's date
          field. A countdown is read far more often than it is set, and a form
          control sitting in every block on the canvas is the "too much
          happening" that the calm pass was about. */}
      {isSelected && (
        <input
          type="datetime-local"
          value={valid ? toLocalInput(block.target) : ''}
          /* setNow first: an expired block has a frozen clock, and re-dating it
             must not paint one frame of the old, stale remainder. An event
             handler is allowed to read the time; render is not. */
          onChange={e => {
            setNow(Date.now())
            onUpdateBlock(block.id, { target: fromLocalInput(e.target.value) })
          }}
          onMouseDown={e => e.stopPropagation()}
          style={{
            marginTop: 9, width: '100%', boxSizing: 'border-box',
            background: 'transparent', color: text,
            border: `1px solid ${border}`, borderRadius: 6, padding: '4px 6px',
            fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-sm)',
            outline: 'none',
          }}
        />
      )}
    </div>
  )
}

/* memo for the same reason TaskBlock has it: NotebookCanvas re-renders on every
   frame of a pan or zoom, and this component owns a 1Hz timer of its own. Every
   prop it takes is stable by construction — `colors` is a frozen module object,
   `onUpdateBlock` is cached per block id by blockCb(), and `block` only changes
   identity when the block actually changes. */
export default memo(CountdownBlockInner)
