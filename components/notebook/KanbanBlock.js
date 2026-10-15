'use client'
import Icon from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useCallback, useLayoutEffect, useRef, useState, memo } from 'react'
import { createPortal } from 'react-dom'

/* The shared swatch set. This was a fourth private palette — one of four
   arrays doing the same job with eleven values between them and nothing in
   common — and its first entry was the DARK accent, so a card created in light
   mode came up indigo on a green-accented canvas. */
import { SWATCHES, Z, stablePick } from '../../lib/theme'
import { LANE_MIN, LANE_GAP, BOARD_PAD, ADD_LANE_W, kanbanMinDims } from '../../lib/kanban'
const CARD_COLORS = SWATCHES.map(s => s.value)

/** Every id in the app is `prefix_time_random`; these two were `prefix_time`. */
const newLocalId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`

/* Kanban-style block with draggable cards across draggable lanes.
   Used inside notebook blocks of type 'kanban'.

   ── POLISH PASS ──────────────────────────────────────────────────────────
   Three real interaction changes and three real bug fixes. Everything else —
   lane rename, lane delete + its undo toast, drag-and-drop between lanes, the
   typed tag input — is UNCHANGED production behaviour. "Polish pass" is not
   licence to redesign controls nobody asked about.

   WHAT CHANGED, AND WHY EACH ONE IS A FIX RATHER THAN A PREFERENCE

   1. Lane background was `dark ? '#1a1917' : '#DDD9CF'`. The dark value equals
      --ds-base by coincidence; the light one, #DDD9CF, matches NO TOKEN in
      globals.css — a private one-off, the same class of bug the comment above
      records for card colours. Now var(--ds-surface), which is also why the
      dark/light ternary is gone: a token is already theme-correct.

   2. Card delete had no undo; lane delete has had one for a while, two dozen
      lines away in this same file. Extending the established pattern, not
      inventing one.

   3. globals.css line 362 has carried `.kanban-card:hover .card-del { opacity:
      1 }` — grouped with the same pattern already working for .folder-row and
      .nb-row — and this file had ZERO className props, so that rule never
      matched anything and the delete button was permanently visible. Wiring up
      infrastructure that already existed rather than writing new CSS.

   4. New cards no longer force CARD_COLORS[0] onto themselves. `color: null` is
      the default and there is a "no colour" swatch to return to, because a
      board where every card is red-by-accident says nothing, and colour that
      cannot be unset is not a choice.

   NOT CARRIED OVER FROM THE PROTOTYPE: a coloured dot beside "Lane 2" in its
   static markup. No handler, no state, nothing wired to it — incidental
   prototype flavour demonstrating that a lane COULD carry a colour, not a
   specified feature. Real lane colour means a new `lane.color` field and a
   picker nothing has specified. Flagged, not built.
   ──────────────────────────────────────────────────────────────────────── */

/* memo, because this component is a child of NotebookCanvas and NotebookCanvas
   re-renders on every frame of a pan or a zoom. Without it, dragging the canvas
   re-rendered every block on screen sixty times a second; with it, React bails
   out at this boundary and the frame costs nothing but the transform.

   A plain shallow compare is enough because every prop it receives is stable by
   construction: `colors` is one of two frozen module objects (lib/theme.js),
   handlers are cached per block id by blockCb() in NotebookCanvas, and `block`
   only changes identity when the block actually changes. */
function KanbanBlockInner({ block, onUpdateBlock, colors, dark, editingRef }) {
  /* A board with no `lanes` is not supposed to exist — the registry always
     creates three. But "not supposed to" is exactly the data that reaches you
     from an older build, a partial write or a hand-edited export, and reading
     `.map` off undefined replaced the whole block with an error card. One
     derived value, used everywhere below, costs nothing and removes the
     entire class. */
  const lanes = block?.lanes || []

  const { surface, raised, border, text, text3, accent, accentDim, red } = colors
  const toast = useToast()
  const [addingCard, setAddingCard] = useState({})
  const [newCardTitle, setNewCardTitle] = useState({})
  const [cardDrag, setCardDrag] = useState(null)
  const [cardDragOver, setCardDragOver] = useState(null)
  /* The lane row, so adding a lane can scroll it into view. `scroll-behavior:
     smooth` on the element does the easing; this only has to say where. */
  const laneRowRef = useRef(null)

  function addCard(laneId) {
    const title = (newCardTitle[laneId] || '').trim()
    if (!title) return
    /* Salted, like every other id generator in the app. Date.now() alone has
       millisecond resolution, so two cards created in the same tick — a paste,
       a template instantiation, a fast double-click — shared an id. That is
       also a React key collision, which means the wrong card gets edited or
       deleted rather than merely looking odd. */
    /* color: null, NOT CARD_COLORS[0].

       Forcing the first swatch onto every new card meant every board arrived
       pre-coloured red with no way back — the swatch row had eight options and
       no ninth for "none", so the only reachable states were eight colours.
       Unset is now both the default and reachable again. */
    const card = { id: newLocalId('card'), title, tag: '', color: null }
    onUpdateBlock(block.id, {
      lanes: lanes.map(l => l.id === laneId ? { ...l, cards: [...l.cards, card] } : l)
    })
    setNewCardTitle(p => ({ ...p, [laneId]: '' }))
    /* The composer STAYS OPEN after a commit. Adding cards is a burst activity
       — you rarely add exactly one — and closing it means a click to reopen
       between every card. Escape or an empty blur is how you leave. */
  }

  function moveCard(cardId, fromLaneId, toLaneId) {
    if (fromLaneId === toLaneId) return
    let card
    const newLanes = lanes
      .map(l => {
        if (l.id === fromLaneId) {
          card = l.cards.find(c => c.id === cardId)
          return { ...l, cards: l.cards.filter(c => c.id !== cardId) }
        }
        return l
      })
      .map(l => l.id === toLaneId && card ? { ...l, cards: [...l.cards, card] } : l)

    onUpdateBlock(block.id, { lanes: newLanes })
  }

  function deleteCard(laneId, cardId) {
    /* UNDO, matching lane delete.

       The whole lanes array is captured and restored, exactly as lane delete
       already does: restoring just the card would append it to the end of its
       lane rather than putting it back where it was, and a card that comes back
       in the wrong place is only half an undo. */
    const before = lanes
    const card = lanes.find(l => l.id === laneId)?.cards?.find(c => c.id === cardId)
    onUpdateBlock(block.id, {
      lanes: lanes.map(l => l.id === laneId ? { ...l, cards: l.cards.filter(c => c.id !== cardId) } : l)
    })
    toast(card?.title ? `Card "${card.title}" deleted` : 'Card deleted', {
      undo: () => onUpdateBlock(block.id, { lanes: before }),
    })
  }

  function updateCard(laneId, cardId, patch) {
    onUpdateBlock(block.id, {
      lanes: lanes.map(l =>
        l.id === laneId
          ? { ...l, cards: l.cards.map(c => c.id === cardId ? { ...c, ...patch } : c) }
          : l
      )
    })
  }

  function addLane() {
    const next = [...lanes, { id: newLocalId('lane'), name: `Lane ${lanes.length + 1}`, cards: [] }]
    /* The block grows to fit the new lane rather than the board starting to
       scroll sideways: every lane keeps at least LANE_MIN. */
    const need = kanbanMinDims(next.length).w
    onUpdateBlock(block.id, { lanes: next, ...((block.w || 0) < need ? { w: need } : {}) })
    /* Next frame: the new lane does not exist in the DOM yet on this one, so
       scrollWidth is still the old width and the scroll would land short. */
    requestAnimationFrame(() => {
      const el = laneRowRef.current
      if (el) el.scrollLeft = el.scrollWidth
    })
  }

  /* Auto-grow, driven off scrollHeight. Reset to 'auto' first: without that the
     textarea can only ever grow, because scrollHeight of an element already
     tall enough to hold its content is just its own height. */
  const autoGrow = useCallback(el => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  const laneIsDragTarget = laneId =>
    cardDragOver?.laneId === laneId && cardDragOver?.blockId === block.id

  return (
    <>
      {/* Scoped, because inline styles cannot express ::-webkit-scrollbar or
          :hover. The lane row gets a thinner 6px bar than the app's global 8px
          default: it sits INSIDE a block rather than at the edge of a panel, so
          the default reads heavy against 200px lanes.

          Keyed to a data attribute rather than a class name, so it cannot
          collide with the global scrollbar rules or with another component's
          class. */}
      <style>{`
        [data-ds-kanban-lanes]::-webkit-scrollbar { height: 6px; }
        [data-ds-kanban-lanes]::-webkit-scrollbar-track { background: transparent; }
        [data-ds-kanban-lanes]::-webkit-scrollbar-thumb {
          background: var(--ds-border);
          border-radius: 3px;
        }
        [data-ds-kanban-lanes]::-webkit-scrollbar-thumb:hover { background: var(--ds-accent); }
        [data-ds-kanban-lanes] { scrollbar-width: thin; scroll-behavior: smooth; }
        [data-kanban-lane-body] { scrollbar-width: thin; }
        [data-kanban-lane-body]::-webkit-scrollbar { width: 6px; }
        [data-kanban-lane-body]::-webkit-scrollbar-thumb { background: var(--ds-border); border-radius: 3px; }
        /* Matches .import-btn:hover's convention already in globals.css rather
           than inventing a second "lift the fill slightly" number. */
        .kanban-add-card:hover { opacity: 0.88; }
        /* Cards (25 Sep 2026): a real border that answers the pointer, and
           the empty metadata pills only on hover or focus, so a quiet card
           stays quiet but adding an assignee is one click away. */
        .kanban-card { transition: border-color var(--ds-transition), box-shadow var(--ds-transition); }
        .kanban-card:hover { border-color: color-mix(in srgb, var(--ds-accent) 45%, var(--ds-border)) !important; }
        .kanban-card .kb-ghost, .kanban-card .kb-more { opacity: 0; transition: opacity var(--ds-transition); }
        .kanban-card:hover .kb-ghost, .kanban-card:focus-within .kb-ghost,
        .kanban-card:hover .kb-more, .kanban-card:focus-within .kb-more, .kanban-card .kb-more[aria-expanded="true"] { opacity: 1; }
      `}</style>

      <div
        ref={laneRowRef}
        data-ds-kanban-lanes
        /* Fills the block: lanes share its width and take its full height,
           so resizing the block resizes every lane. No sideways scrolling;
           the block's minimum width (lib/kanban.js) always fits the lanes. */
        style={{ display: 'flex', gap: LANE_GAP, padding: BOARD_PAD, alignItems: 'stretch', overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}
      >
        {lanes.map(lane => (
          <div
            key={lane.id}
            onDragOver={e => {
              e.preventDefault()
              e.stopPropagation()
              setCardDragOver({ laneId: lane.id, blockId: block.id })
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget)) setCardDragOver(null)
            }}
            onDrop={e => {
              e.preventDefault()
              e.stopPropagation()
              if (cardDrag?.blockId === block.id) {
                moveCard(cardDrag.cardId, cardDrag.fromLaneId, lane.id)
                setCardDrag(null)
                setCardDragOver(null)
              }
            }}
            style={{
              /* 260, not 200 (25 Sep 2026): a card needs room for its title on
                 two lines and a row of metadata pills without wrapping every
                 word. 200 is where the "cramped board" report came from. */
              flex: '1 1 0', minWidth: LANE_MIN,
              display: 'flex', flexDirection: 'column', minHeight: 0,
              /* var(--ds-surface), not a per-theme literal. See the header note
                 — #DDD9CF was a private colour matching no token, so the light
                 theme's lane background belonged to no one. */
              background: laneIsDragTarget(lane.id) ? accentDim : 'var(--ds-surface)',
              borderRadius: 10,
              padding: 10,
              border: laneIsDragTarget(lane.id) ? `1px solid ${accent}` : `1px solid ${border}`,
              transition: 'background var(--ds-transition), border-color var(--ds-transition)',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <input
                aria-label="Lane name"
                value={lane.name}
                onChange={e => onUpdateBlock(block.id, {
                  lanes: lanes.map(l => l.id === lane.id ? { ...l, name: e.target.value } : l)
                })}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                onFocus={() => { editingRef.current = true }}
                onBlur={() => { editingRef.current = false }}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  fontFamily: 'var(--ds-font-body)',
                  fontWeight: 700,
                  fontSize: 13,
                  color: text,
                  outline: 'none',
                  minWidth: 0
                }}
              />
              <span style={{ fontSize: 11, color: text3, background: raised, borderRadius: 4, padding: '2px 6px', flexShrink: 0 }}>
                {lane.cards.length}
              </span>
              <button
                onClick={e => {
                  e.stopPropagation()
                  /* The whole lanes array is what gets put back, so the lane
                     returns in its own column rather than tacked on the right —
                     and the cards it was holding come with it. */
                  const before = lanes
                  onUpdateBlock(block.id, { lanes: lanes.filter(l => l.id !== lane.id) })
                  toast(`Lane "${lane.name}" deleted`, {
                    undo: () => onUpdateBlock(block.id, { lanes: before }),
                  })
                }}
                style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = red}
                onMouseLeave={e => e.currentTarget.style.color = text3}
                aria-label="Delete lane"
              >
                <Icon name="action-delete" size={12} />
              </button>
            </div>

            <div data-kanban-lane-body style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
            {lane.cards.map(card => (
              <KanbanCard key={card.id} card={card} colors={colors} editingRef={editingRef}
                onUpdate={patch => updateCard(lane.id, card.id, patch)}
                onDelete={() => deleteCard(lane.id, card.id)}
                onDragStart={() => setCardDrag({ cardId: card.id, fromLaneId: lane.id, blockId: block.id })}
                onDragEnd={() => { setCardDrag(null); setCardDragOver(null) }} />
            ))}
            </div>
            {/* The composer / "+ card" stays pinned under the scrolling cards,
                so adding one never means scrolling to the bottom of a lane. */}
            <div style={{ flexShrink: 0, paddingTop: lane.cards.length ? 2 : 0 }}>

            {addingCard[lane.id] ? (
              /* SEAMLESS INLINE COMPOSER, not a boxed panel with Add/Cancel.

                 No border, no background of its own, no buttons: it sits in the
                 card list at card metrics and the only chrome is the caret.
                 Enter commits, Escape discards, blur-with-content commits (so
                 typing and then clicking elsewhere doesn't silently lose a
                 card), blur-empty cancels.

                 The onFocus/onBlur → editingRef wiring is KEPT VERBATIM from
                 the old title input. That is how the canvas knows text entry is
                 in progress — it suppresses single-key shortcuts and blocks
                 block-drag — and has nothing to do with the visual redesign.
                 Dropping it would be a regression dressed as a simplification. */
              <textarea
                autoFocus
                rows={1}
                value={newCardTitle[lane.id] || ''}
                ref={autoGrow}
                onChange={e => {
                  autoGrow(e.currentTarget)
                  setNewCardTitle(p => ({ ...p, [lane.id]: e.target.value }))
                }}
                onKeyDown={e => {
                  /* Shift+Enter falls through to the textarea's own newline, so
                     a card title can be more than one line if someone wants
                     that. Plain Enter commits. */
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    e.stopPropagation()
                    addCard(lane.id)
                    /* The value is cleared by addCard; the element has to be
                       told to shrink back, since scrollHeight only shrinks when
                       height is reset. */
                    requestAnimationFrame(() => autoGrow(e.target))
                  } else if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNewCardTitle(p => ({ ...p, [lane.id]: '' }))
                    setAddingCard(p => ({ ...p, [lane.id]: false }))
                  }
                }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                onFocus={() => { editingRef.current = true }}
                onBlur={() => {
                  editingRef.current = false
                  if ((newCardTitle[lane.id] || '').trim()) addCard(lane.id)
                  setAddingCard(p => ({ ...p, [lane.id]: false }))
                }}
                placeholder="Card title…"
                aria-label="New card title"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: text,
                  caretColor: accent,
                  fontFamily: 'var(--ds-font-body)',
                  fontSize: 13,
                  lineHeight: 1.4,
                  padding: '8px 10px',
                  margin: 0,
                  outline: 'none',
                  resize: 'none',
                  overflow: 'hidden',
                  display: 'block',
                }}
              />
            ) : (
              /* TINTED, not dashed-ghost. "+ card" is the most frequent action
                 on a board and it was the least visible control in it. Filled
                 accent-dim with an accent border reads as "press me" at rest
                 rather than only once the cursor is already on it.

                 "+ lane" below stays dashed-ghost on purpose — the prototype
                 elevated only this one, and two equally loud affordances in one
                 block is no hierarchy at all. */
              <button
                className="kanban-add-card"
                onClick={e => {
                  e.stopPropagation()
                  setAddingCard(p => ({ ...p, [lane.id]: true }))
                }}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  width: '100%',
                  background: accentDim,
                  border: `1px solid ${accent}`,
                  borderRadius: 6,
                  padding: '5px',
                  color: accent,
                  fontWeight: 600,
                  fontFamily: 'var(--ds-font-body)',
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'opacity var(--ds-transition)',
                }}
              >
                + card
              </button>
            )}
            </div>
          </div>
        ))}

        <button
          onClick={e => { e.stopPropagation(); addLane() }}
          onMouseDown={e => e.stopPropagation()}
          aria-label="Add lane"
          style={{
            width: ADD_LANE_W,
            minHeight: 60,
            background: 'none',
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: text3,
            cursor: 'pointer',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            alignSelf: 'flex-start',
            marginTop: 28
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = accent
            e.currentTarget.style.color = accent
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = border
            e.currentTarget.style.color = text3
          }}
        >
          +
        </button>
      </div>
    </>
  )
}

/* ── Cards ──────────────────────────────────────────────────────────────
   25 Sep 2026. A card was a line of text over a row of eight colour dots and
   an italic "tag…" input, all visible all the time: flat, borderless and
   tiny. Now it is a bordered paper card with real padding, a title you can
   edit (double-click), and metadata as PILLS: priority, assignee and tag.
   Colour and delete moved behind the card's ••• menu, where a rarely used
   control belongs.

   New optional fields on a card, all nullable, so every existing board
   renders unchanged: `priority` ('urgent' | 'high' | 'medium' | 'low') and
   `assignee` (a name). `tag` and `color` keep their meaning. */

export const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', color: 'var(--ds-red)' },
  { id: 'high',   label: 'High',   color: 'var(--ds-amber)' },
  { id: 'medium', label: 'Medium', color: 'var(--ds-code-num)' },
  { id: 'low',    label: 'Low',    color: 'var(--ds-text-3)' },
]
const priorityOf = id => PRIORITIES.find(p => p.id === id) || null
const initials = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?'

function Pill({ color, children, ghost, onClick, title, expanded }) {
  return (
    <button type="button" title={title} aria-label={title} aria-expanded={expanded}
      className={ghost ? 'kb-ghost' : undefined}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick?.(e) }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, maxWidth: '100%',
        padding: ghost ? '0 7px' : '0 8px', borderRadius: '999px', cursor: 'pointer', flexShrink: 0,
        fontFamily: 'var(--ds-font-body)', fontSize: 11, fontWeight: 600, lineHeight: 1,
        border: ghost ? '1px dashed var(--ds-border)' : '1px solid transparent',
        background: ghost ? 'transparent' : `color-mix(in srgb, ${color || 'var(--ds-text-2)'} 14%, transparent)`,
        color: ghost ? 'var(--ds-text-3)' : (color || 'var(--ds-text-2)'),
      }}>
      {children}
    </button>
  )
}

/* A menu that escapes the lane row's overflow clipping: portalled to <body>
   and placed from its anchor's screen rect, the same way the Document
   ribbon's Pop is. Inside the canvas transform a fixed element would be
   positioned against the transform, not the viewport. */
function CardMenu({ anchor, onClose, children, width = 200 }) {
  const [box, setBox] = useState(null)
  const ref = useRef(null)
  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    setBox({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: below > 240 ? r.bottom + 4 : undefined, bottom: below > 240 ? undefined : window.innerHeight - r.top + 4 })
    const away = e => { if (ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target)) onClose() }
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', away, true)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true) }
  }, [anchor])
  if (!box || typeof document === 'undefined') return null
  return createPortal(
    <div ref={ref} role="menu" onMouseDown={e => e.stopPropagation()} style={{
      position: 'fixed', zIndex: Z.popover, left: box.left, top: box.top, bottom: box.bottom, width,
      background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 10,
      boxShadow: 'var(--ds-shadow-lg)', padding: 6, fontFamily: 'var(--ds-font-body)',
    }}>{children}</div>,
    document.body,
  )
}

function MenuItem({ children, onClick, danger, active }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 30, padding: '0 8px',
        border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ds-font-body)', fontSize: 13,
        background: active ? 'var(--ds-accent-dim)' : 'transparent', color: danger ? 'var(--ds-red)' : 'var(--ds-text)',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--ds-raised)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      {children}
    </button>
  )
}

function InlineInput({ value, placeholder, onDone, editingRef, width = 120, label }) {
  const [v, setV] = useState(value || '')
  const done = useRef(false)
  const finish = commit => { if (done.current) return; done.current = true; editingRef.current = false; onDone(commit ? v.trim() : null) }
  return (
    <input autoFocus value={v} placeholder={placeholder} aria-label={label}
      onChange={e => setV(e.target.value)}
      onFocus={() => { editingRef.current = true }}
      onBlur={() => finish(true)}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true) } if (e.key === 'Escape') { e.preventDefault(); finish(false) } }}
      onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
      style={{
        width, height: 22, boxSizing: 'border-box', padding: '0 8px', borderRadius: '999px',
        border: '1px solid var(--ds-accent)', outline: 'none', background: 'var(--ds-paper)', color: 'var(--ds-text)',
        fontFamily: 'var(--ds-font-body)', fontSize: 11, fontWeight: 600,
      }} />
  )
}

function KanbanCard({ card, colors, editingRef, onUpdate, onDelete, onDragStart, onDragEnd }) {
  const { text, text3, border } = colors
  const [menu, setMenu] = useState(null)       // { kind: 'more' | 'priority', anchor }
  const [editing, setEditing] = useState(null)  // 'title' | 'assignee' | 'tag'
  const [title, setTitle] = useState(card.title)
  const pr = priorityOf(card.priority)
  /* The anchor is read NOW, not inside the updater: React clears
     currentTarget once the handler returns, and an updater can run later. */
  const open = (kind, e) => { const el = e.currentTarget; setMenu(m => (m?.kind === kind ? null : { kind, anchor: el })) }

  const commitTitle = () => {
    editingRef.current = false
    setEditing(null)
    const t = title.trim()
    if (t && t !== card.title) onUpdate({ title: t })
    else setTitle(card.title)
  }

  return (
    <div
      className="kanban-card"
      data-kanban-card={card.id}
      draggable={!editing}
      onDragStart={e => { e.stopPropagation(); onDragStart() }}
      onDragEnd={onDragEnd}
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => { e.stopPropagation(); if (!editing) { setTitle(card.title); setEditing('title') } }}
      style={{
        position: 'relative', marginBottom: 8, padding: '12px 14px', cursor: editing ? 'default' : 'grab',
        background: 'var(--ds-paper)', border: `1px solid ${border}`, borderRadius: 8,
        boxShadow: 'var(--ds-shadow-sm)', overflow: 'hidden',
      }}>
      {/* The card's colour as a 3px band along the top: visible at a glance
          down a lane, and it does not eat the card's text width the way a
          thick left border did. */}
      {card.color && <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: card.color }} />}

      {editing === 'title' ? (
        <textarea autoFocus value={title} aria-label="Card title" rows={3}
          /* Grows with what you type, so a long title is never edited
             through a two-line slot. */
          ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
          onChange={e => { setTitle(e.target.value); const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }}
          onFocus={e => { editingRef.current = true; e.target.select() }}
          onBlur={commitTitle}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === 'Escape') { e.preventDefault(); setTitle(card.title); e.currentTarget.blur() }
          }}
          onMouseDown={e => e.stopPropagation()}
          style={{
            /* Same metrics as the rendered title, plus a visible field: a
               tinted box bleeding 8px past the text so the words do not jump
               when editing starts. */
            display: 'block', width: 'calc(100% + 16px)', boxSizing: 'border-box', resize: 'none',
            margin: '-6px -8px', padding: '6px 8px', minHeight: 'calc(3em + 12px)', overflow: 'hidden',
            border: '1px solid var(--ds-accent)', borderRadius: 6, outline: 'none', background: 'var(--ds-surface)', color: text,
            fontFamily: 'var(--ds-font-body)', fontSize: 14, fontWeight: 500, lineHeight: 1.5,
          }} />
      ) : (
        /* 14px on two lines' worth of room (3em) at minimum: a title is the
           card, so it gets the space, and a short one does not leave the
           card looking like a sliver. */
        <div title="Double-click to edit" style={{ fontSize: 14, fontWeight: 500, color: text, lineHeight: 1.5, minHeight: '3em', paddingRight: 22, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
          {card.title}
        </div>
      )}

      {/* A card with no details yet keeps its empty pills on ONE line (they
          fit a 220px lane without their "+"; the dashed outline already says
          "add"), so an empty card is one row taller than its title, not two. */}
      <div style={{ display: 'flex', flexWrap: pr || card.assignee || card.tag ? 'wrap' : 'nowrap', overflow: 'hidden', gap: 6, marginTop: 12, minHeight: 22 }}>
        {pr ? (
          <Pill color={pr.color} title={`Priority: ${pr.label}`} expanded={menu?.kind === 'priority'} onClick={e => open('priority', e)}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: pr.color }} />{pr.label}
          </Pill>
        ) : (
          <Pill ghost title="Set priority" expanded={menu?.kind === 'priority'} onClick={e => open('priority', e)}>Priority</Pill>
        )}

        {editing === 'assignee' ? (
          <InlineInput value={card.assignee} placeholder="Name" label="Assignee" editingRef={editingRef}
            onDone={v => { setEditing(null); if (v !== null && v !== (card.assignee || '')) onUpdate({ assignee: v || null }) }} />
        ) : card.assignee ? (
          <Pill title={`Assigned to ${card.assignee} (click to change)`} onClick={() => setEditing('assignee')}>
            <span aria-hidden="true" style={{
              width: 16, height: 16, marginLeft: -5, borderRadius: 8, display: 'grid', placeItems: 'center',
              background: stablePick(card.assignee, SWATCHES).value, color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1,
            }}>{initials(card.assignee).slice(0, 1)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{card.assignee}</span>
          </Pill>
        ) : (
          <Pill ghost title="Assign someone" onClick={() => setEditing('assignee')}>Assign</Pill>
        )}

        {editing === 'tag' ? (
          <InlineInput value={card.tag} placeholder="Tag" label="Tag" width={100} editingRef={editingRef}
            onDone={v => { setEditing(null); if (v !== null && v !== (card.tag || '')) onUpdate({ tag: v }) }} />
        ) : card.tag ? (
          <Pill color={card.color || undefined} title={`Tag: ${card.tag} (click to change)`} onClick={() => setEditing('tag')}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>#{card.tag}</span>
          </Pill>
        ) : (
          <Pill ghost title="Add a tag" onClick={() => setEditing('tag')}>Tag</Pill>
        )}
      </div>

      {editing !== 'title' && <button type="button" className="kb-more" aria-label="Card options" aria-expanded={menu?.kind === 'more'}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); open('more', e) }}
        style={{
          position: 'absolute', top: 6, right: 6, width: 22, height: 22, display: 'grid', placeItems: 'center',
          border: 'none', borderRadius: 6, background: 'transparent', color: text3, cursor: 'pointer', fontSize: 14, lineHeight: 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--ds-raised)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
        ⋯
      </button>}

      {menu?.kind === 'priority' && (
        <CardMenu anchor={menu.anchor} onClose={() => setMenu(null)} width={170}>
          {PRIORITIES.map(p => (
            <MenuItem key={p.id} active={card.priority === p.id} onClick={() => { onUpdate({ priority: p.id }); setMenu(null) }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: p.color }} />{p.label}
            </MenuItem>
          ))}
          {card.priority && <MenuItem onClick={() => { onUpdate({ priority: null }); setMenu(null) }}><span style={{ color: text3 }}>No priority</span></MenuItem>}
        </CardMenu>
      )}
      {menu?.kind === 'more' && (
        <CardMenu anchor={menu.anchor} onClose={() => setMenu(null)} width={212}>
          <div style={{ padding: '4px 8px 6px', fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: text3 }}>Colour</div>
          <div role="group" aria-label="Card colour" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 8px 8px' }}>
            <button type="button" aria-label="No colour" title="No colour" onClick={() => onUpdate({ color: null })}
              style={{ width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', background: 'transparent', border: card.color ? `1px dashed ${text3}` : `2px solid ${text}` }} />
            {CARD_COLORS.map(c => (
              <button key={c} type="button" aria-label={`Card colour ${c}`} title={SWATCHES.find(s => s.value === c)?.name}
                onClick={() => onUpdate({ color: c })}
                style={{ width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', background: c, border: card.color === c ? `2px solid ${text}` : '2px solid transparent', boxShadow: card.color === c ? '0 0 0 1px var(--ds-surface) inset' : 'none' }} />
            ))}
          </div>
          <div style={{ height: 1, background: border, margin: '2px 0 4px' }} />
          <MenuItem onClick={() => { setMenu(null); setTitle(card.title); setEditing('title') }}>Edit title</MenuItem>
          <MenuItem danger onClick={() => { setMenu(null); onDelete() }}>Delete card</MenuItem>
        </CardMenu>
      )}
    </div>
  )
}

export default memo(KanbanBlockInner)
