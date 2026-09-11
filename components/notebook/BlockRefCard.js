'use client'
import { useState } from 'react'
import Icon from '../ui/Icon'
import { getType, displayModeOf } from './blockRegistry'

/*
  components/notebook/BlockRefCard.js
  --------------------------------------------------------------------------
  A BLOCK, IN A CONVERSATION — and draggable out of it onto your own canvas.

  ── WHAT "AN ANIMATED BLOCK IN CHAT" TURNED OUT TO MEAN ────────────────────

  The note doc posed two options for a shared block appearing in a thread: a
  flat preview card (which "can't be applied anywhere" and would just get
  thrown away), or a live, editable, auto-updating linked block (a much bigger
  claim, needing NotebookCanvas's renderer switch extracted first).

  Asked directly, Matas said he "hoped we could have some sort of animated block
  in chat" — which is neither. Taken at face value it points at a third option:
  a card with enough REAL fidelity that it reads as that specific block rather
  than a generic file chip, which becomes a genuine native block when you drag
  it out. The life is in the preview and in the pickup, not in a promise of
  live data sync.

  SO THIS IS SNAPSHOT-ON-DROP, AND THAT IS AN HONEST SMALLER CLAIM, not a
  downgrade dressed up as a compromise:

    · lands as a real, editable, native block            — yes
    · buildable now, no NotebookCanvas refactor          — yes, reuses
                                                           createBlock/clonepatch
    · auto-updates when the source changes               — NO. It is a copy,
                                                           exactly like any
                                                           duplicate.

  If auto-updating turns out to be what is actually needed, that is a separate,
  bigger ask and NOTHING here builds toward it — it still needs the extraction
  the doc described. Say so explicitly rather than discovering it later.

  ── WHY THE PREVIEWS ARE REAL DATA AND NOT PLACEHOLDERS ────────────────────

  A card reading "Table · Q3 Renewals" is a filename. Two or three real rows of
  the actual data is a thing you recognise, and recognition is the entire job:
  the recipient has to decide whether this is worth pulling onto their canvas
  before they pull it. Each preview is deliberately SMALL — a sample, not a
  render — because rendering the block properly is the part that would need the
  extraction this design avoids.
  -------------------------------------------------------------------------- */

/** The drag payload's MIME type. Namespaced so nothing else claims it. */
export const REF_DRAG_TYPE = 'application/x-datastudio-blockref'

/* ── Per-type previews ────────────────────────────────────────────────────
   Each returns a small node, or null to fall back to the icon + label row.
   Null is a legitimate answer: a block whose data has not arrived yet, or a
   type with nothing worth sampling, should degrade to the chip rather than to
   a box of skeleton bars pretending something is loading. */

function TablePreview({ block, colors }) {
  const { border, text2, text3, raised } = colors
  const headers = (block.headers || []).slice(0, 3)
  const rows = (block.rows || []).slice(0, 3)
  if (!headers.length && !rows.length) return null
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, tableLayout: 'fixed' }}>
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={{
                  textAlign: 'left', padding: '4px 6px', background: raised, color: text2,
                  fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{typeof h === 'string' ? h : (h?.label ?? '')}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {(Array.isArray(r) ? r : []).slice(0, 3).map((c, j) => (
                <td key={j} style={{
                  padding: '4px 6px', color: text3, borderTop: `1px solid ${border}`,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{String(c ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KanbanPreview({ block, colors }) {
  const { border, text3, raised } = colors
  const lanes = (block.lanes || []).slice(0, 4)
  if (!lanes.length) return null
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {lanes.map(l => (
        <div key={l.id} style={{
          flex: 1, minWidth: 0, background: raised, border: `1px solid ${border}`,
          borderRadius: 4, padding: '4px 4px',
        }}>
          <div style={{
            fontSize: 11, color: text3, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3,
          }}>{l.name || 'Lane'}</div>
          {/* The lane's own card colours, at card-tag size — so a board you
              recognise by its colour scheme is recognisable here too. Capped at
              four dots plus a count, because a 30-card lane rendered as 30 dots
              is a texture, not information. */}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            {(l.cards || []).slice(0, 4).map(c => (
              <span key={c.id} style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: c.color || border,
              }} />
            ))}
            <span style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)' }}>
              {(l.cards || []).length}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function TextPreview({ block, colors }) {
  const { text3, border } = colors
  /* The stored content is HTML. It is stripped to text HERE rather than
     rendered — a chat thread must never hand block content to an HTML parser,
     which is the same contract ChatBlock's own header states for message
     bodies. DOM-free stripping so this works in the test harness too. */
  const plain = String(block.content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return null
  return (
    <div style={{
      fontSize: 11, lineHeight: 1.5, color: text3,
      borderLeft: `2px solid ${border}`, paddingLeft: 6,
      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
    }}>
      {plain.slice(0, 160)}
    </div>
  )
}

function CalendarPreview({ block, colors }) {
  const { border, text3, accent } = colors
  const today = new Date().getDate()
  /* A month GLYPH, not a real month: 28 cells and a dot on today. The real
     grid needs a size this card does not have, and the point is "this is a
     calendar, and it is current", which 28 squares say fine. */
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
      {Array.from({ length: 28 }, (_, i) => {
        const isToday = i + 1 === today
        return (
          <span key={i} style={{
            height: 5, borderRadius: 4,
            background: isToday ? accent : border,
            opacity: isToday ? 1 : 0.55,
          }} />
        )
      })}
      <span style={{ gridColumn: '1 / -1', fontSize: 11, color: text3, marginTop: 1 }}>
        {(block.sources?.length || 1)} source{(block.sources?.length || 1) === 1 ? '' : 's'}
      </span>
    </div>
  )
}

function TaskPreview({ block, colors }) {
  const { text2, text3, green, amber, red } = colors
  const p = block.priority || 'med'
  const hue = p === 'high' ? red : p === 'low' ? green : amber
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: hue, flexShrink: 0 }} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 11, color: text2,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{block.title || 'Untitled task'}</span>
      {block.deadline && (
        <span style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)', flexShrink: 0 }}>
          {block.deadline}
        </span>
      )}
    </div>
  )
}

function PdfPreview({ block, colors }) {
  const { border, text3, raised } = colors
  /* NO FIRST-PAGE THUMBNAIL. Rendering one means loading pdf.js and the
     document's bytes — which live in the SENDER's IndexedDB, not the
     recipient's — for a 40px picture in a chat bubble. The page count and the
     page shape are what is actually available and honest here; the real
     thumbnail belongs to whatever caches shared assets, which does not exist
     yet. Flagged rather than faked. */
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: 20, height: 26, borderRadius: 4, flexShrink: 0,
        background: raised, border: `1px solid ${border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="block-pdf" size={12} style={{ color: text3 }} />
      </span>
      <span style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)' }}>
        {block.pdfPages ? `${block.pdfPages} pages` : 'PDF document'}
      </span>
    </div>
  )
}

function ImagePreview({ block, colors, thumbUrl }) {
  const { border, text3, raised } = colors
  /* The REAL thumbnail when the host could resolve one — the bytes live in
     IndexedDB and only the canvas layer can reach them, so it arrives as a
     prop rather than being fetched here. Otherwise: the same chip an icon-mode
     image renders as, which is at least the truth. */
  if (thumbUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbUrl}
        alt={block.alt || ''}
        draggable={false}
        style={{
          width: '100%', maxHeight: 84, objectFit: 'cover',
          borderRadius: 6, border: `1px solid ${border}`, display: 'block',
        }}
      />
    )
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: raised, border: `1px solid ${border}`, borderRadius: 6, padding: '6px 8px',
    }}>
      <Icon name="format-image" size={14} style={{ color: text3, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: text3 }}>
        {block.natW && block.natH ? `${block.natW} × ${block.natH}` : 'Image'}
      </span>
    </div>
  )
}

function previewFor(block, colors, thumbUrl) {
  if (!block) return null
  switch (block.type) {
    case 'table':
    case 'database': return <TablePreview block={block} colors={colors} />
    case 'kanban':   return <KanbanPreview block={block} colors={colors} />
    case 'text':     return <TextPreview block={block} colors={colors} />
    case 'calendar': return <CalendarPreview block={block} colors={colors} />
    case 'task':     return <TaskPreview block={block} colors={colors} />
    case 'pdf':      return <PdfPreview block={block} colors={colors} />
    case 'image':    return <ImagePreview block={block} colors={colors} thumbUrl={thumbUrl} />
    default:         return null
  }
}

/**
 * @param {{
 *   block: object|null,       the referenced block's DATA, or null if not resolvable
 *   blockId: string,          always known, even when `block` is not
 *   label?: string,           fallback name
 *   senderName?: string,      whose share this was — travels with the drop
 *   colors: object,
 *   thumbUrl?: string,        resolved image thumbnail, host-supplied
 *   onOpen?: (blockId) => void
 * }}
 */
export default function BlockRefCard({ block, blockId, label, senderName, colors, thumbUrl, onOpen }) {
  const { border, text, text2, text3, accent, accentText, accentDim, base } = colors
  const [dragging, setDragging] = useState(false)

  const def = block ? getType(block.type) : null
  const name = block?.name || label || def?.label || 'a block'
  const icon = def?.icon || 'block-text'
  const preview = previewFor(block, colors, thumbUrl)

  /* An icon-mode image previews as its chip, not its pixels — the card should
     show what the sender is actually looking at, not a version of the block
     they have deliberately collapsed. */
  const previewNode = block?.type === 'image' && displayModeOf(block) === 'icon' ? null : preview

  return (
    <div
      /* NATIVE HTML5 DRAG, not a pointer-move gesture.

         The card lives in a scrollable message list inside a canvas block, and
         the drop target is the canvas itself — two scroll contexts and a CSS
         transform between the two. A hand-rolled pointer drag would have to
         reason about both; the browser's drag-and-drop already crosses them,
         and the canvas's drop handler already exists for desktop files. */
      draggable
      onDragStart={e => {
        setDragging(true)
        try {
          e.dataTransfer.setData(REF_DRAG_TYPE, JSON.stringify({ blockId, senderName: senderName || null }))
          /* A text/plain fallback so dropping this somewhere that is NOT the
             canvas — a text editor, another app — pastes something meaningful
             rather than nothing. */
          e.dataTransfer.setData('text/plain', name)
          e.dataTransfer.effectAllowed = 'copy'
        } catch { /* a browser that refuses setData simply cannot drag this */ }
      }}
      onDragEnd={() => setDragging(false)}
      /* The message list is inside a block that itself drags on pointerdown.
         Without this, starting a drag on the card drags the chat block. */
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      title="Drag onto your canvas to add a copy"
      style={{
        marginTop: 4, maxWidth: '92%',
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '8px 10px', borderRadius: 'var(--ds-radius-sm)',
        background: accentDim,
        /* Low-opacity accent border: the card should read as related to the
           thread's own chrome, not as an alert sitting in it. */
        border: `1px solid ${accent}66`,
        /* PICKING IT UP HAS WEIGHT. The shadow and the scale are the difference
           between dragging an object and dragging text — and they are the half
           of "animated" that the preview above does not cover. */
        boxShadow: dragging ? 'var(--ds-shadow-lg)' : 'none',
        transform: dragging ? 'scale(1.03)' : 'none',
        opacity: dragging ? 0.9 : 1,
        cursor: dragging ? 'grabbing' : 'grab',
        transition: 'box-shadow var(--ds-motion-hover) var(--ds-ease-standard), transform var(--ds-motion-hover) var(--ds-ease-overshoot)',
        /* Same enter as the slash menu and the Add menu. Consistency, not a new
           motion language for one card. */
        animation: 'dsToolbarIn var(--ds-motion-enter) var(--ds-ease-overshoot)',
      }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={12} style={{ color: accentText, flexShrink: 0 }} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</span>
        {onOpen && (
          <button
            onClick={e => { e.stopPropagation(); onOpen(blockId) }}
            onPointerDown={e => e.stopPropagation()}
            style={{
              flexShrink: 0, background: 'none', border: 'none', padding: '0 2px',
              color: text3, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', fontSize: 11,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = accentText)}
            onMouseLeave={e => (e.currentTarget.style.color = text3)}>
            open
          </button>
        )}
      </div>

      {previewNode}

      <div style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.3 }}>
        {/* Says exactly what a drop will do, including the part people get
            wrong about copies. A card that silently produced a non-updating
            duplicate would be a promise nobody made out loud. */}
        {block ? 'DRAG TO CANVAS · ADDS A COPY' : 'PREVIEW UNAVAILABLE'}
      </div>
    </div>
  )
}
