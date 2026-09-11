'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { Z } from '../../lib/theme'
import { personHue } from '../../lib/attribution'

/*
  components/ui/PeoplePanel.js
  --------------------------------------------------------------------------
  PEOPLE, AND THE CONVERSATIONS WITH THEM — one surface.

  ── WHY SHARING AND CHAT ARE THE SAME LIST ─────────────────────────────────

  They were two features with one shape: "which colleague, and what do they get
  to see." Splitting them means granting access in one dialog and then finding
  the person again in another place to tell them why — and the second half is
  the half people actually forget.

  So: click a person and both happen. They get access to this sheet if they did
  not have it, and the conversation opens. Drag a block onto a person's row and
  that specific block is shared plus a reference card lands in the thread.

  ── THE CHAT WINDOW FLOATS; IT IS NOT A CANVAS BLOCK ───────────────────────

  Confirmed and unchanged from the decision log. It still needs a real block id
  behind it, because `chat_messages` (migration 0009) keys on one — floating is
  presentation, not a data-model change. That id comes from the host, which
  owns the document; this component never invents one.

  It opens ADJACENT to the people list rather than covering it, so you can see
  who else is there while you are talking to somebody. On a narrow window it
  falls back to sitting over the list, because two panels side by side that do
  not fit are worse than one panel you can dismiss.

  ── WHAT THIS COMPONENT DOES NOT DO ────────────────────────────────────────

  It renders no messages of its own: the thread is ChatBlock, unchanged, handed
  in as `children`. This spec designs the CONTAINER and the people list; the
  message bubbles, the composer and the reference card are ChatBlock's and
  BlockRefCard's, and redesigning them here would be a second implementation of
  a surface that already exists.

  STILL OPEN, and deliberately not decided here: what the "Teams" affordance
  should do (an org member list? one-click group chat?), whether sharing one
  block with several people already produces a group thread for free through
  existing grants, and what the invite mechanism is — email, username, or a
  link. All three are flagged in the handoff as open and none is guessed at.
  -------------------------------------------------------------------------- */

const PANEL_W = 246
const CHAT_W = 320
const ROW_H = 46

export default function PeoplePanel({
  open,
  people = [],                 // [{ id, name, email?, shared?, chatBlockId? }]
  colors,
  activePersonId,
  onPickPerson,                // (person) => grants access if needed, opens chat
  onShareBlockWith,            // (person, blockId) => share + post a ref card
  onClose,
  children,                    // the thread for activePersonId — ChatBlock
}) {
  const { surface, raised, border, text, text2, text3, accent, accentText, accentDim } = colors
  const ref = useRef(null)
  /* Which row a block is currently hovering over. A ring on that row only —
     highlighting the whole list would say every person is a target. */
  const [dropOn, setDropOn] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose?.() }
    }
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(p => `${p.name || ''} ${p.email || ''}`.toLowerCase().includes(q))
  }, [people, query])

  if (!open || typeof document === 'undefined') return null

  const active = people.find(p => p.id === activePersonId) || null

  const panel = (
    <div
      ref={ref}
      data-kbd-zone
      role="dialog"
      aria-label="People"
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', right: 16, bottom: 72, zIndex: Z.panel,
        display: 'flex', alignItems: 'flex-end', gap: 10,
        /* Right-to-left in the DOM so the chat window renders to the LEFT of
           the people list without either needing a computed position. Reversed
           back for the reading order below. */
        flexDirection: 'row',
        fontFamily: 'var(--ds-font-body)',
        /* Wraps rather than overflowing when the window is too narrow for both.
           Two panels side by side that do not fit is a worse answer than one
           above the other. */
        flexWrap: 'wrap-reverse',
        maxWidth: 'calc(100vw - 32px)',
      }}>

      {/* ── The thread, adjacent rather than covering ── */}
      {active && (
        <div style={{
          width: CHAT_W, maxWidth: '100%', height: 420,
          display: 'flex', flexDirection: 'column', minHeight: 0,
          background: surface, border: `1px solid ${border}`,
          borderRadius: 'var(--ds-radius-lg)', boxShadow: 'var(--ds-shadow-lg)',
          overflow: 'hidden',
          animation: 'dsToolbarIn var(--ds-motion-enter) var(--ds-ease-overshoot)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            padding: '10px 12px', borderBottom: `1px solid ${border}`,
          }}>
            <Avatar person={active} />
            <span style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{active.name || 'Someone'}</span>
            <button
              onClick={() => onPickPerson?.(null)}
              aria-label="Close conversation"
              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', padding: '0 2px' }}
              onMouseEnter={e => (e.currentTarget.style.color = text2)}
              onMouseLeave={e => (e.currentTarget.style.color = text3)}>
              <Icon name="draw-exit" size={12} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {children}
          </div>
        </div>
      )}

      {/* ── The people list ── */}
      <div style={{
        width: PANEL_W, maxWidth: '100%', maxHeight: 420,
        display: 'flex', flexDirection: 'column', minHeight: 0,
        background: surface, border: `1px solid ${border}`,
        borderRadius: 'var(--ds-radius-lg)', boxShadow: 'var(--ds-shadow-lg)',
        overflow: 'hidden',
        animation: 'dsToolbarIn var(--ds-motion-enter) var(--ds-ease-overshoot)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          padding: '10px 12px', borderBottom: `1px solid ${border}`,
        }}>
          <Icon name="share-people" size={14} style={{ color: text3, flexShrink: 0 }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            placeholder="Find someone…"
            aria-label="Find someone"
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none',
              outline: 'none', color: text, caretColor: accent,
              fontFamily: 'var(--ds-font-body)', fontSize: 13,
            }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 5 }}>
          {shown.length === 0 && (
            <div style={{ padding: '12px 10px', fontSize: 12, color: text3, lineHeight: 1.55 }}>
              {people.length === 0
                ? 'Nobody else is in this workspace yet. Invite a colleague and they will appear here.'
                : `Nobody matches “${query}”.`}
            </div>
          )}

          {shown.map(p => {
            const on = p.id === activePersonId
            const dropping = dropOn === p.id
            return (
              <button
                key={p.id}
                /* HIT-TESTED BY THE CANVAS DRAG, not by HTML5 drag-and-drop.

                   A block on the canvas is moved by a mouse-down/move/up
                   gesture, not a native drag — so it carries no dataTransfer for
                   this row to read. The canvas's own mouseup does
                   elementFromPoint() and looks for this attribute, which is why
                   it is a data attribute rather than a ref: the panel is
                   portalled to <body> and the canvas has no handle on it.

                   The onDrop below stays for a real HTML5 drag arriving from
                   somewhere else (a reference card dragged back out of a
                   thread), so both gestures land in the same place. */
                data-ds-person-row={p.id}
                onClick={() => onPickPerson?.(p)}
                /* A BLOCK DROPPED ON A ROW shares that specific block with that
                   specific person and drops a reference card into the thread.
                   Same drag payload the chat card uses in the other direction,
                   which is what makes the gesture reversible in the user's head:
                   drag a block to a person, drag it back out onto a canvas. */
                onDragOver={e => { e.preventDefault(); setDropOn(p.id) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropOn(null) }}
                onDrop={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropOn(null)
                  let blockId = null
                  try { blockId = e.dataTransfer.getData('application/x-datastudio-block') } catch { /* not ours */ }
                  if (blockId) onShareBlockWith?.(p, blockId)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  height: ROW_H, padding: '0 8px', textAlign: 'left',
                  border: `1px solid ${dropping ? accent : 'transparent'}`,
                  borderRadius: 'var(--ds-radius-md)',
                  background: dropping ? accentDim : on ? raised : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--ds-font-body)',
                  transition: 'background var(--ds-transition), border-color var(--ds-transition)',
                }}
                onMouseEnter={e => { if (!on && !dropping) e.currentTarget.style.background = raised }}
                onMouseLeave={e => { if (!on && !dropping) e.currentTarget.style.background = 'transparent' }}>
                <Avatar person={p} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{
                    display: 'block', fontSize: 13, fontWeight: 500, color: text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p.name || p.email || 'Someone'}</span>
                  {/* The status line says what a click will DO, not what the
                      state is — "Shared" alone leaves the person guessing
                      whether tapping shares again. */}
                  <span style={{
                    display: 'block', fontSize: 11, marginTop: 1,
                    color: p.shared ? accentText : text3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.shared ? 'Shared · tap to open chat' : 'Tap to chat & share sheet'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {/* Two genuinely open questions, declared and disabled — the house
            convention CalendarToolbar uses for "Own events" and the calendar
            sidebar uses for "Add a calendar". A surface that names what is
            coming is a roadmap; one that omits it is a surprise later. */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${border}`, padding: 5 }}>
          <SoonRow icon="share-people" label="Teams" colors={colors}
            title="An org-wide list, or one-click group chat — not decided yet" />
          <SoonRow icon="action-add" label="Add a friend" colors={colors}
            title="Invite by email, username or link — not decided yet" />
        </div>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}

/* The SAME identity colour the presence dot and the attribution flag use.
   personHue, imported, not a second palette — a person is one colour
   everywhere in this app or the cue stops being a cue. */
function Avatar({ person }) {
  const hue = personHue(person?.id)
  const initial = (person?.name || person?.email || '?').trim().charAt(0).toUpperCase()
  return (
    <span
      aria-hidden="true"
      style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: hue, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 600, fontFamily: 'var(--ds-font-body)',
      }}>
      {initial}
    </span>
  )
}

function SoonRow({ icon, label, colors, title }) {
  const { border, text2, text3 } = colors
  return (
    <div
      title={title}
      aria-disabled="true"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        height: 28, padding: '0 8px',
        fontSize: 12, color: text2, opacity: 0.38, cursor: 'not-allowed',
      }}>
      <Icon name={icon} size={14} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <span style={{
        fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.4,
        color: text3, border: `1px solid ${border}`,
        borderRadius: 4, padding: '2px 4px', flexShrink: 0,
      }}>SOON</span>
    </div>
  )
}
