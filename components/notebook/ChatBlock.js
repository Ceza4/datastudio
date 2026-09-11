'use client'
import { useEffect, useRef, useState, useCallback, memo } from 'react'
import {
  onThread, threadFor, groupThread, isMine, authorLabel, authorHue,
  timeLabel, isUnsent, wasEdited, carriesBlock, UNSENT_TEXT, draftProblem, MAX_BODY,
} from '../../lib/chatstore'
import BlockRefCard from './BlockRefCard'

/*
  components/notebook/ChatBlock.js
  --------------------------------------------------------------------------
  THE CONVERSATION, ON THE CANVAS.

  Messages come from `chat_messages` (migration 0009), not from the document.
  blockRegistry's entry for `chat` explains why at length; the short version is
  that a thread inside `doc` would be rewritten on every keystroke, forgeable
  by anyone who can save the sheet, and unwritable by exactly the person you
  shared the sheet with so they could reply.

  ── EVERY BODY IS PLAIN TEXT, AND THAT IS LOAD-BEARING ─────────────────────

  0009 does not sanitise `body`, on the stated condition that nothing ever
  hands it to an HTML parser. This file honours that by rendering message text
  as a React child — never `dangerouslySetInnerHTML`, never a template string
  into innerHTML. tests/chat.test.mjs asserts the store grows no html helper,
  and this comment is the other half of that contract.

  ── WHY THE NETWORK LIVES IN A PROP ────────────────────────────────────────

  This component takes `onSend`, `onEdit`, `onUnsend` rather than importing
  lib/chat.js. That is not ceremony: importing the network half anywhere in the
  render tree pulls supabaseClient.js into the graph, and the browser harness
  fails to mount the whole thing with `process is not defined`.

  The first attempt moved the import up into NotebookCanvas and broke the
  harness anyway — the canvas is mounted by it too. So the line is drawn one
  level higher again and enforced rather than described:
  app/app/page.js owns the network, everything below it owns pixels, and
  `npm run check:tree` walks the harness's import graph to prove it.
  -------------------------------------------------------------------------- */

function ChatBlock({
  block, colors, dark, dropping,
  onSend, onEdit, onUnsend, onOpenRef, refLabel,
  /* THE REFERENCED BLOCK'S DATA, resolved by the host.

     `refLabel` gave a name and that was enough for a flat chip. A card with a
     real preview needs the block itself — and only the layer above can find it:
     it may be a block on this canvas, or one that arrived through
     lib/shares.js's fetchSharedBlocks from somebody else's document. Passing a
     resolver keeps this component free of both the canvas and the network,
     which is the boundary check:tree enforces. Returning null is fine and
     expected; the card degrades to its chip. */
  refBlock,
  /* Resolved image thumbnails, same reasoning — the bytes are in IndexedDB and
     only the host can reach them. */
  refThumb,
}) {
  const [, bump] = useState(0)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const scrollRef = useRef(null)
  const stickRef = useRef(true)

  const { text, text2, text3, border, borderDim, raised, base, accent, accentText, red } = colors

  /* Re-render when ANY thread changes. Cheap: this component only exists while
     a chat block is on screen, and threads are small. Subscribing per-block id
     would mean re-subscribing every time the id prop changed for no gain. */
  useEffect(() => onThread(() => bump(n => n + 1)), [])

  const messages = groupThread(threadFor(block.id))

  /* STICK TO THE BOTTOM, BUT ONLY IF YOU WERE ALREADY THERE.
     Scrolling someone back down while they are reading history is the most
     irritating thing a chat can do, and it happens to every implementation
     that just calls scrollTop = scrollHeight on every render. */
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const send = useCallback(async () => {
    const problem = draftProblem(draft)
    if (problem === 'empty') return
    if (problem) { setError(problem); return }
    setError(null)
    setBusy(true)
    const res = await onSend?.(draft.trim())
    setBusy(false)
    if (res && res.ok === false) { setError(res.reason); return }
    setDraft('')
    stickRef.current = true
  }, [draft, onSend])

  const commitEdit = useCallback(async (id) => {
    const next = editDraft.trim()
    setEditing(null)
    if (!next) return
    const res = await onEdit?.(id, next)
    if (res && res.ok === false) setError(res.reason)
  }, [editDraft, onEdit])

  const over = draft.length - MAX_BODY

  return (
    <div style={{
      width: block.w || 340, height: block.h || 380,
      display: 'flex', flexDirection: 'column', minHeight: 0,
      background: base, borderRadius: 10,
      /* The drop state is a ring rather than a fill: a chat with a block
         hovering over it still has to be readable, and tinting the whole
         surface hides the conversation at exactly the moment somebody is
         deciding whether this is the right thread to put it in. */
      border: `1px solid ${dropping ? accent : border}`,
      boxShadow: dropping ? `0 0 0 3px ${accentText}22` : 'none',
      overflow: 'hidden', fontFamily: 'var(--ds-font-body)',
      transition: 'border-color 0.14s ease, box-shadow 0.14s ease',
    }}>
      {dropping && (
        <div style={{
          padding: '6px 12px', fontSize: 11, fontWeight: 600, color: accentText,
          borderBottom: `1px solid ${borderDim}`, textAlign: 'center',
        }}>Drop to share — the block stays where it is</div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-chat-thread
        style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
        {messages.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: text3, fontSize: 12, lineHeight: 1.5, padding: '0 12px' }}>
            No messages yet.<br />
            Anyone you share this sheet with can read and reply here.
          </div>
        )}
        {messages.map(m => (
          <Message
            key={m.id}
            m={m}
            colors={colors}
            editing={editing === m.id}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            onStartEdit={() => { setEditing(m.id); setEditDraft(m.body || '') }}
            onCancelEdit={() => setEditing(null)}
            onCommitEdit={() => commitEdit(m.id)}
            onUnsend={() => onUnsend?.(m.id)}
            onOpenRef={onOpenRef}
            refLabel={refLabel}
            refBlock={refBlock}
            refThumb={refThumb}
          />
        ))}
      </div>

      {error && (
        <div role="alert" style={{
          padding: '6px 12px', fontSize: 11, color: red,
          borderTop: `1px solid ${borderDim}`, lineHeight: 1.4,
        }}>{error}</div>
      )}

      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 6,
        padding: '8px 10px', borderTop: `1px solid ${borderDim}`, background: raised,
      }}>
        <textarea
          data-chat-composer
          value={draft}
          rows={1}
          onChange={e => { setDraft(e.target.value); if (error) setError(null) }}
          /* Enter sends, Shift+Enter breaks the line — the convention every
             chat has trained people into. Stopping propagation matters more
             than usual here: the canvas binds bare keys to block creation, so
             an unguarded keystroke in this box would spawn a table. */
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          onPointerDown={e => e.stopPropagation()}
          placeholder="Message…"
          style={{
            flex: 1, minWidth: 0, resize: 'none', maxHeight: 80,
            fontFamily: 'var(--ds-font-body)', fontSize: 13, lineHeight: 1.45,
            padding: '6px 8px', borderRadius: 6,
            border: `1px solid ${over > 0 ? red : border}`,
            background: base, color: text, outline: 'none',
          }} />
        <button
          onClick={send}
          disabled={busy || !draft.trim() || over > 0}
          onPointerDown={e => e.stopPropagation()}
          style={{
            flexShrink: 0, padding: '6px 10px', borderRadius: 6,
            border: `1px solid ${accent}`, background: accent, color: '#fff',
            fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: 600,
            cursor: busy || !draft.trim() ? 'default' : 'pointer',
            opacity: busy || !draft.trim() || over > 0 ? 0.5 : 1,
          }}>{busy ? '…' : 'Send'}</button>
      </div>
      {over > 0 && (
        <div style={{ padding: '0 11px 6px', fontSize: 11, color: red, background: raised }}>
          {over} character{over === 1 ? '' : 's'} over the limit
        </div>
      )}
    </div>
  )
}

/* Module scope, and memoised. A component defined during render is a new type
   every render, so React tears every message down and rebuilds it instead of
   updating — the note in ConfirmDialog.js is about the same bug remounting
   seventeen toolbar buttons per drag frame, and a thread has more rows than a
   toolbar has buttons. */
const Message = memo(function Message({
  m, colors, editing, editDraft, setEditDraft,
  onStartEdit, onCancelEdit, onCommitEdit, onUnsend, onOpenRef, refLabel,
  refBlock, refThumb,
}) {
  const { text, text2, text3, border, borderDim, raised, base, accent, accentText } = colors
  const mine = isMine(m)
  const unsent = isUnsent(m)
  const hue = authorHue(m)
  /* The author's colour, computed the same way lib/attribution.js computes a
     block flag's — so the person who edited that block and the person talking
     about it are visibly the same person. */
  const who = `hsl(${hue} 62% 42%)`

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: mine ? 'flex-end' : 'flex-start',
      marginTop: m.startsRun ? 8 : 1,
      opacity: m.pending ? 0.55 : 1,
    }}>
      {m.startsRun && (
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2,
          fontSize: 11, maxWidth: '100%',
        }}>
          <span style={{ fontWeight: 600, color: mine ? text2 : who }}>{authorLabel(m)}</span>
          <span style={{ color: text3 }}>{timeLabel(m.created_at)}</span>
        </div>
      )}

      <div
        onDoubleClick={() => { if (mine && !unsent) onStartEdit() }}
        title={mine && !unsent ? 'Double-click to edit' : undefined}
        style={{
          maxWidth: '86%',
          padding: '6px 10px', borderRadius: 8,
          background: unsent ? 'transparent' : (mine ? raised : base),
          border: `1px solid ${unsent ? 'transparent' : borderDim}`,
          fontSize: 13, lineHeight: 1.45,
          color: unsent ? text3 : text,
          fontStyle: unsent ? 'italic' : 'normal',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
        {editing ? (
          <textarea
            autoFocus
            value={editDraft}
            onChange={e => setEditDraft(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') { e.preventDefault(); onCancelEdit() }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommitEdit() }
            }}
            onBlur={onCommitEdit}
            onPointerDown={e => e.stopPropagation()}
            rows={2}
            style={{
              width: 180, resize: 'none', border: `1px solid ${accent}`,
              borderRadius: 6, padding: '4px 6px', background: base, color: text,
              fontFamily: 'var(--ds-font-body)', fontSize: 13, outline: 'none',
            }} />
        ) : (
          /* A React child, never innerHTML. See the file header — 0009 stores
             this text unsanitised on the explicit promise that it never meets
             an HTML parser. */
          unsent ? UNSENT_TEXT : m.body
        )}
      </div>

      {/* WAS a flat name-and-"open" chip. A chip is a filename: it tells you a
          block was shared and nothing about which block, and — the part that
          actually mattered — it could not be applied anywhere, so the likely
          outcome was that it got read once and ignored.

          BlockRefCard carries a real sampled preview of the block's own data and
          drags out onto the canvas as a genuine copy. `open` is still there, as
          a button inside it, for the case where you just want to go and look. */}
      {carriesBlock(m) && (
        <BlockRefCard
          blockId={m.ref_block_id}
          block={refBlock?.(m.ref_block_id) || null}
          thumbUrl={refThumb?.(m.ref_block_id) || null}
          label={refLabel?.(m.ref_block_id)}
          senderName={authorLabel(m)}
          colors={colors}
          onOpen={onOpenRef}
        />
      )}

      {mine && !unsent && !editing && (
        <button
          onClick={onUnsend}
          onPointerDown={e => e.stopPropagation()}
          style={{
            marginTop: 1, background: 'none', border: 'none', padding: '0 2px',
            color: text3, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', fontSize: 11,
          }}>
          {wasEdited(m) ? 'edited · unsend' : 'unsend'}
        </button>
      )}
    </div>
  )
})

export default memo(ChatBlock)
