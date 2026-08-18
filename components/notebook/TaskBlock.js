'use client'
import { useState, useEffect } from 'react'
import Icon from '../ui/Icon'
import {
  PRIORITY_COLOR, PRIORITY_LABEL, STATUS_LABEL, DEADLINE_COLOR,
  deadlineState, effectiveStatus, blockersOf, toDateInput,
} from '../../lib/tasks'
import { msUntilNextLocalMidnight } from '../../lib/calendar'

/*
  components/notebook/TaskBlock.js
  --------------------------------------------------------------------------
  A task, as a block on the canvas.

  COMPACT BY DEFAULT
  Most of the time a task needs to say three things from across the room: how
  urgent, when it's due, and whether it's done. That's a dot, a chip and a
  checkbox — and a canvas holding thirty of them stays readable. Notes, links
  and the date picker only appear once it's selected, because a wall of open
  forms is unreadable at any size.

  BLOCKED IS SHOWN, NEVER SET
  There's no "blocked" option anywhere in this component. A task is blocked
  because something it depends on isn't finished, which lib/tasks.js derives
  from the connections. Offering it as a status would let the two disagree,
  and the stored one would win — so a task could claim to be blocked by
  nothing, or claim to be fine while waiting on three things.
  -------------------------------------------------------------------------- */

/* ONE TEXT COLUMN.
   The headline is checkbox · dot · title, so the title starts at
   17 + 8 + 7 + 8. The chip row and the expanded panel below were both indented
   25 — the left edge of the DOT — so every line under the title hung fifteen
   pixels to its left and the card had two ragged text columns instead of one.
   Derived here so it can't drift again when a size changes. */
const BOX = 17
const DOT = 7
const GAP = 8
const INDENT = BOX + GAP + DOT + GAP

export default function TaskBlock({ block, blocks, connections, colors, dark, onUpdateBlock, isSelected, onTeleport }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim, green } = colors
  const [editingTitle, setEditingTitle] = useState(false)

  /* `deadlineState` is computed at render, and nothing re-renders a task at
     midnight — so a card left open overnight kept yesterday's answer: "Due
     today" on a task that is now a day overdue, and no red. One timer per
     card, scheduled off calendar arithmetic rather than +86_400_000, which is
     an hour wrong on the two days a year the clocks move.

     No dependency array on purpose: the effect re-arms after every render at
     the same absolute instant, so no path through the component can leave the
     card holding a timer that has already fired. */
  const [, setDayTick] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setDayTick(n => n + 1), msUntilNextLocalMidnight())
    return () => clearTimeout(id)
  })

  const status = effectiveStatus(block, blocks, connections) || 'todo'
  const dl = deadlineState(block)
  const blockers = blockersOf(block.id, blocks, connections)
  const done = status === 'done'
  const priority = block.priority || 'med'

  const set = patch => onUpdateBlock(block.id, patch)
  const toggleDone = () => set({ status: done ? 'todo' : 'done' })

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 7,
      padding: '10px 11px', height: '100%', boxSizing: 'border-box',
      background: surface, fontFamily: 'var(--ds-font-body)',
      /* A finished task recedes rather than disappearing. It's still evidence
         that the work happened, which on a research canvas is worth keeping. */
      opacity: done ? 0.62 : 1,
      transition: 'opacity .18s ease',
    }}>

      {/* ── headline row ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: GAP }}>
        <button
          onClick={e => { e.stopPropagation(); toggleDone() }}
          onMouseDown={e => e.stopPropagation()}
          role="checkbox"
          aria-checked={done}
          aria-label={done ? 'Mark as not done' : 'Mark as done'}
          title={done ? 'Mark as not done' : 'Mark as done'}
          style={{
            width: BOX, height: BOX, flexShrink: 0, marginTop: 1,
            borderRadius: 5, cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1.5px solid ${done ? green : border}`,
            background: done ? green : 'transparent',
            color: '#fff',
            /* The most-clicked control on the card had no hover and no
               transition: it was a square that changed colour instantly and
               never acknowledged the pointer beforehand. */
            transition: 'background var(--ds-transition), border-color var(--ds-transition)',
          }}
          onMouseEnter={e => { if (!done) e.currentTarget.style.borderColor = green }}
          onMouseLeave={e => { if (!done) e.currentTarget.style.borderColor = border }}>
          {done && <Icon name="action-check" size={11} />}
        </button>

        {/* Priority is a dot, not a word. It has to be readable at a glance
            across a canvas, and four words in four colours is noise. */}
        <span
          title={`${PRIORITY_LABEL[priority]} priority`}
          style={{
            width: DOT, height: DOT, borderRadius: '50%', flexShrink: 0, marginTop: 6,
            background: PRIORITY_COLOR[priority],
            /* Urgent gets a halo so it reads as different in kind, not just
               in hue — which also keeps it legible for colour-blind users. */
            boxShadow: priority === 'urgent' ? `0 0 0 3px ${PRIORITY_COLOR.urgent}33` : 'none',
          }} />

        {editingTitle ? (
          <input
            autoFocus
            defaultValue={block.title || ''}
            onBlur={e => { set({ title: e.target.value }); setEditingTitle(false) }}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
            }}
            onMouseDown={e => e.stopPropagation()}
            placeholder="What needs doing?"
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none',
              borderBottom: `1px solid ${accent}`, color: text, outline: 'none',
              fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-lg)',
              fontWeight: 600, padding: 0,
            }} />
        ) : (
          <span
            onDoubleClick={e => { e.stopPropagation(); setEditingTitle(true) }}
            /* Double-click to rename is invisible without being told. */
            title={block.title ? 'Double-click to rename' : 'Double-click to name this task'}
            style={{
              flex: 1, minWidth: 0, fontSize: 'var(--ds-fs-lg)', fontWeight: 600, lineHeight: 1.35,
              color: block.title ? text : text3,
              textDecoration: done ? 'line-through' : 'none',
              fontStyle: block.title ? 'normal' : 'italic',
              cursor: 'text', wordBreak: 'break-word',
            }}>
            {block.title || 'Untitled task'}
          </span>
        )}
      </div>

      {/* ── chips ──
          Was four chips at one size, one weight, one radius and one padding —
          deadline, blocked, doing and the assignee's name all typographically
          identical, so the row had no subject. It now runs deadline → status →
          assignee, loudest to quietest, and the assignee loses its box
          entirely: a name is metadata, not a peer of "3d overdue". */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: INDENT }}>
        {/* `done` is deliberately not shown here. deadlineState returns the
            label 'Done', and the checkbox, the strikethrough and the card's
            own dimming already say it three times. */}
        {dl.state !== 'none' && dl.state !== 'done' && (
          <span
            title={`Due ${toDateInput(block.deadline)}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              /* A step above every other chip. This is the reason the card
                 exists on a canvas rather than in a list. */
              fontSize: 'var(--ds-fs-sm)', fontFamily: 'var(--ds-font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: dl.state === 'overdue' ? 600 : 500,
              padding: '2px 7px', borderRadius: 'var(--ds-radius-sm)', lineHeight: 1.4,
              color: DEADLINE_COLOR[dl.state],
              /* Overdue and soon are filled, later is bare text — different in
                 kind, so the three don't rely on hue alone to be told apart. */
              border: dl.state === 'later' ? '1px solid transparent' : `1px solid ${DEADLINE_COLOR[dl.state]}`,
              background: dl.state === 'overdue' ? 'var(--ds-red-bg)'
                : dl.state === 'soon' ? 'var(--ds-amber-bg)' : 'transparent',
            }}>
            <Icon name={dl.state === 'overdue' ? 'status-warning' : 'status-info'} size={11} />
            {dl.label}
          </span>
        )}

        {status === 'blocked' && (
          /* Says WHAT it's waiting on, not just that it's waiting. "Blocked"
             on its own sends you hunting through the diagram. */
          <span
            title={`Waiting on: ${blockers.map(b => b.title || 'Untitled').join(', ')}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-body)',
              fontWeight: 600, letterSpacing: 0.2,
              padding: '2px 7px', borderRadius: 'var(--ds-radius-sm)', lineHeight: 1.5,
              color: 'var(--ds-amber)', background: 'var(--ds-amber-bg)',
            }}>
            <Icon name="state-lock" size={10} />
            {/* Title case, like every other status in the app. The lowercase
                'blocked' was the only one of the four spelled its own way. */}
            {blockers.length === 1 ? STATUS_LABEL.blocked : `${STATUS_LABEL.blocked} ×${blockers.length}`}
          </span>
        )}

        {status === 'doing' && !done && (
          <span style={{
            fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-body)',
            fontWeight: 600, letterSpacing: 0.2,
            padding: '2px 7px', borderRadius: 'var(--ds-radius-sm)', lineHeight: 1.5,
            color: accent, background: accentDim,
          }}>
            {STATUS_LABEL.doing}
          </span>
        )}

        {block.assignee && (
          <span title={`Assigned to ${block.assignee}`} style={{
            display: 'flex', alignItems: 'center', gap: 4, minWidth: 0,
            fontSize: 'var(--ds-fs-xs)', color: text3, lineHeight: 1.5,
            /* No border and no fill. Whitespace does what a box was doing. */
          }}>
            <Icon name="share-people" size={11} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {block.assignee}
            </span>
          </span>
        )}
      </div>

      {/* ── expanded ── */}
      {isSelected && (
        <div style={{ paddingLeft: INDENT, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <textarea
            defaultValue={block.notes || ''}
            /* One handler: committing and un-highlighting are the same event,
               and splitting them across onBlur/onBlurCapture would leave two
               places to remember. */
            onBlur={e => { e.currentTarget.style.borderColor = border; set({ notes: e.target.value }) }}
            onFocus={e => { e.currentTarget.style.borderColor = accent }}
            onKeyDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            placeholder="Notes…"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              background: raised, border: `1px solid ${border}`,
              borderRadius: 'var(--ds-radius-sm)',
              padding: '7px 9px', color: text2, outline: 'none',
              fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-sm)', lineHeight: 1.55,
              transition: 'border-color var(--ds-transition)',
            }} />

          {blockers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{
                fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.8,
                textTransform: 'uppercase', color: text3,
              }}>
                Waiting on
              </span>
              {blockers.map(b => (
                <button key={b.id}
                  onClick={e => { e.stopPropagation(); onTeleport?.(b.id) }}
                  onMouseDown={e => e.stopPropagation()}
                  title={`Open ${b.title || 'this task'}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    minHeight: 26, padding: '4px 7px',
                    borderRadius: 'var(--ds-radius-sm)', textAlign: 'left',
                    background: 'transparent', border: `1px solid ${border}`,
                    color: text2, cursor: 'pointer',
                    fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-sm)',
                    transition: 'background var(--ds-transition), border-color var(--ds-transition), color var(--ds-transition)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = accent
                    e.currentTarget.style.color = accent
                    e.currentTarget.style.background = accentDim
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = border
                    e.currentTarget.style.color = text2
                    e.currentTarget.style.background = 'transparent'
                  }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                    background: PRIORITY_COLOR[b.priority || 'med'],
                  }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.title || 'Untitled task'}
                  </span>
                  <Icon name="share-link" size={11} style={{ flexShrink: 0 }} />
                </button>
              ))}
            </div>
          )}

          {/* Two labelled facts rather than one orphan line of the smallest,
              faintest text on the card. Same caption treatment as the group
              labels in the rails, so it reads as a footer and not as content
              that got left behind. */}
          <div style={{
            display: 'flex', gap: 14,
            fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)',
            letterSpacing: 0.4, color: text3,
          }}>
            <span>Status <b style={{ color: text2, fontWeight: 600 }}>{STATUS_LABEL[status]}</b></span>
            <span>Priority <b style={{ color: text2, fontWeight: 600 }}>{PRIORITY_LABEL[priority]}</b></span>
          </div>
        </div>
      )}
    </div>
  )
}
