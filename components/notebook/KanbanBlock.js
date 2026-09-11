'use client'
import Icon from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useCallback, useRef, useState, memo } from 'react'

/* The shared swatch set. This was a fourth private palette — one of four
   arrays doing the same job with eleven values between them and nothing in
   common — and its first entry was the DARK accent, so a card created in light
   mode came up indigo on a green-accented canvas. */
import { SWATCHES } from '../../lib/theme'
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
    onUpdateBlock(block.id, {
      lanes: [...lanes, { id: newLocalId('lane'), name: `Lane ${lanes.length + 1}`, cards: [] }]
    })
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
        /* Matches .import-btn:hover's convention already in globals.css rather
           than inventing a second "lift the fill slightly" number. */
        .kanban-add-card:hover { opacity: 0.88; }
      `}</style>

      <div
        ref={laneRowRef}
        data-ds-kanban-lanes
        style={{ display: 'flex', gap: 8, padding: 10, alignItems: 'flex-start', overflowX: 'auto', maxWidth: '100%' }}
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
              width: 200,
              /* var(--ds-surface), not a per-theme literal. See the header note
                 — #DDD9CF was a private colour matching no token, so the light
                 theme's lane background belonged to no one. */
              background: laneIsDragTarget(lane.id) ? accentDim : 'var(--ds-surface)',
              borderRadius: 8,
              padding: 8,
              border: laneIsDragTarget(lane.id) ? `1px solid ${accent}` : `1px solid ${border}`,
              transition: 'background var(--ds-transition), border-color var(--ds-transition)',
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <input
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

            {lane.cards.map(card => (
              <div
                key={card.id}
                /* THE CLASS THAT MAKES globals.css's DEAD RULE LIVE.
                   `.kanban-card:hover .card-del` has been in the stylesheet all
                   along with nothing to match. */
                className="kanban-card"
                draggable
                onDragStart={e => {
                  e.stopPropagation()
                  setCardDrag({ cardId: card.id, fromLaneId: lane.id, blockId: block.id })
                }}
                onDragEnd={() => {
                  setCardDrag(null)
                  setCardDragOver(null)
                }}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  background: surface,
                  borderRadius: 6,
                  padding: '8px 10px',
                  marginBottom: 6,
                  /* A 3px coloured left edge ONLY when a colour is actually set.
                     With `color: null` now the default, the old unconditional
                     `3px solid ${card.color}` would render `3px solid null` —
                     an invalid declaration the browser drops, leaving a card
                     with three borders and a gap where the fourth should be.
                     Unset cards get the same 1px all-round border every other
                     surface in the app has. */
                  border: card.color ? undefined : `1px solid ${border}`,
                  borderTop: card.color ? `1px solid ${border}` : undefined,
                  borderRight: card.color ? `1px solid ${border}` : undefined,
                  borderBottom: card.color ? `1px solid ${border}` : undefined,
                  borderLeft: card.color ? `3px solid ${card.color}` : undefined,
                  cursor: 'grab',
                  position: 'relative'
                }}
              >
                <div style={{ fontSize: 13, color: text, fontFamily: 'var(--ds-font-body)', lineHeight: 1.4, paddingRight: 16 }}>
                  {card.title}
                </div>

                {card.tag && (
                  <div style={{
                    fontSize: 11,
                    /* An uncoloured card's tag falls back to text3 rather than
                       rendering `color: null` (inherit) on a `null22`
                       background, which is a dropped declaration and a
                       transparent pill. */
                    color: card.color || text3,
                    fontWeight: 700,
                    background: card.color ? card.color + '22' : raised,
                    borderRadius: 4, padding: '2px 6px', display: 'inline-block', marginTop: 4,
                  }}>
                    {card.tag}
                  </div>
                )}

                <button
                  className="card-del"
                  onClick={e => {
                    e.stopPropagation()
                    deleteCard(lane.id, card.id)
                  }}
                  style={{
                    position: 'absolute', top: 5, right: 5,
                    background: 'none', border: 'none', color: text3,
                    cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '2px 4px',
                    /* Hover-revealed. The !important in globals.css's rule is
                       what beats this inline 0 — which is exactly why the rule
                       was written with one. */
                    opacity: 0,
                    transition: 'opacity var(--ds-transition)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = red}
                  onMouseLeave={e => e.currentTarget.style.color = text3}
                  aria-label="Delete card"
                >
                  <Icon name="action-delete" size={12} />
                </button>

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }} role="group" aria-label="Card colour">
                  {/* "No colour", FIRST. A dashed ring, which is the app's
                      existing convention for an unset state (the + card and
                      + lane affordances are both dashed). */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="No colour"
                    title="No colour"
                    onClick={e => { e.stopPropagation(); updateCard(lane.id, card.id, { color: null }) }}
                    onKeyDown={e => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault(); e.stopPropagation()
                      updateCard(lane.id, card.id, { color: null })
                    }}
                    style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: 'transparent',
                      cursor: 'pointer',
                      border: card.color ? `1px dashed ${text3}` : `2px solid ${text}`,
                      flexShrink: 0,
                    }}
                  />
                  {CARD_COLORS.map(c => (
                    <div
                      key={c}
                      role="button"
                      tabIndex={0}
                      aria-label={`Card colour ${c}`}
                      onClick={e => {
                        e.stopPropagation()
                        updateCard(lane.id, card.id, { color: c })
                      }}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault(); e.stopPropagation()
                        updateCard(lane.id, card.id, { color: c })
                      }}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: c,
                        cursor: 'pointer',
                        border: card.color === c ? `2px solid ${text}` : '1px solid transparent',
                        flexShrink: 0
                      }}
                    />
                  ))}
                </div>

                <input
                  value={card.tag}
                  onChange={e => updateCard(lane.id, card.id, { tag: e.target.value })}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                  onFocus={() => { editingRef.current = true }}
                  onBlur={() => { editingRef.current = false }}
                  placeholder="tag..."
                  style={{
                    width: '100%',
                    marginTop: 5,
                    background: 'transparent',
                    border: 'none',
                    borderTop: `1px solid ${border}33`,
                    color: text3,
                    fontFamily: 'var(--ds-font-body)',
                    fontSize: 11,
                    outline: 'none',
                    padding: '3px 0',
                    fontStyle: card.tag ? 'normal' : 'italic'
                  }}
                />
              </div>
            ))}

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
        ))}

        <button
          onClick={e => { e.stopPropagation(); addLane() }}
          onMouseDown={e => e.stopPropagation()}
          aria-label="Add lane"
          style={{
            width: 36,
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

export default memo(KanbanBlockInner)
