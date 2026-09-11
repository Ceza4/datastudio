'use client'
import { useState } from 'react'
import { attributionLabel, personHue } from '../../lib/attribution'
import { presenceLabel } from '../../lib/presence'
import Icon from '../ui/Icon'
import { Z } from '../../lib/theme'

/* Shared fallback for a handle rendered outside the canvas, which has nobody
   to build the index. Frozen because it is handed to every such handle at
   once — one stray push would give all of them a backlink they never had. */
const NO_BACKLINKS = Object.freeze([])

/* The grey title bar at the top of every notebook block (text, table, kanban).
   Holds the block name and a delete button. */
export default function BlockHandle({
  notebookId,
  block,
  label,
  colors,
  renaming,
  onStartRename,
  onStopRename,
  onRename,
  onDelete,
  onHeaderDragStart,
  /* Who links here, handed in already computed. This used to be a
     findBacklinks() scan of the entire workspace per handle, memoised on the
     notebook tree — and the memo never held during a drag, because moving a
     block re-mints that tree every frame. Six block types render a handle, so
     the scan ran once per visible block per frame. NotebookCanvas now walks
     the workspace once and passes each handle its own slice. */
  backlinks = NO_BACKLINKS,
  onTeleport,
  onGoToSource,
  /* { by, at, name } from lib/blocks.js, or null. Passed in rather than read
     here so this component stays presentational and one subscription serves
     every block on the canvas — six BlockHandles each opening their own would
     be six listeners per block. */
  attribution,
  /* { by, at, name } from lib/presence.js, or null — SOMEBODY ELSE IS IN THIS
     BLOCK RIGHT NOW. Same reasoning for passing it in rather than subscribing:
     one canvas-level subscription, not one per handle per block.

     LIVE REPLACES HISTORICAL in this slot when both exist. They are the same
     one piece of header chrome and "Mara is editing" strictly supersedes "Mara
     changed this" — showing both would be two dots saying almost the same thing
     about the same person, and it would double the width of the flag exactly
     when the header is busiest. */
  presence,
}) {
  const { raised, border, text2, text3, red, accent, accentText, accentDim, surface } = colors
  const [showBacklinks, setShowBacklinks] = useState(false)

  return (
    <div
      onMouseDown={e => {
        if (e.target.closest('input,button')) return
        onHeaderDragStart(e)
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        height: 30,
        background: raised,
        borderBottom: `1px solid ${border}`,
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      {/* THE TYPE CHIP IS GONE — the little uppercase TEXT / TABLE / PDF that
          sat in front of every title.

          It answered a question the block already answers: you can see it is a
          table, because it is a table. What it cost was the start of the title
          line on every block forever, so the header read 'TEXT Untitled'
          instead of 'Untitled' and the block's own name never got to be the
          first thing you read.

          `label` stays a prop rather than being removed: BlockPicker, the add
          menu and the keyboard hints all still use it, and the shape of this
          component should not change for a visual decision. */}

      {renaming ? (
        <input
          autoFocus
          value={block.name || ''}
          placeholder="Untitled"
          onChange={e => onRename(e.target.value)}
          onBlur={onStopRename}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          /* Matched to the resting title below, deliberately. A rename field
             that is a different size from the text it replaces makes the whole
             header jump the moment you double-click it. */
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: text2,
            fontFamily: 'var(--ds-font-body)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            outline: 'none',
            minWidth: 0,
            padding: 0,
          }}
        />
      ) : (
        <span
          onDoubleClick={e => {
            e.stopPropagation()
            onStartRename()
          }}
          /* PROMINENCE FROM SIZE AND WEIGHT, NOT FROM CONTRAST.

             The first attempt at "more popping" reached for the primary text
             colour, and against the raised header that read as harsh —
             near-black in light mode, near-white in dark. Secondary grey is
             back. The title is still comfortably the loudest thing in the
             header, because it is 12.5/600 with nothing in front of it now,
             which is where the prominence should have come from in the first
             place.

             The untitled state stays dimmer AND lighter, so it reads as
             absence rather than as a name someone chose. */
          style={{
            flex: 1,
            color: block.name ? text2 : text3,
            fontFamily: 'var(--ds-font-body)',
            fontSize: 13,
            fontWeight: block.name ? 600 : 400,
            letterSpacing: '-0.005em',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'text',
          }}
        >
          {block.name || 'Untitled'}
        </span>
      )}

      {/* WHO CHANGED THIS, WHEN IT WAS NOT YOU.

          Reads the `blocks` projection from migration 0007, where `edited_by`
          is stamped by a SECURITY DEFINER trigger from auth.uid(). So this is
          the server's answer, not a claim the client is repeating — which is
          the whole reason the column is not writable: a flag that can be
          forged is a false statement about a colleague, rendered as fact.

          THREE THINGS IT DELIBERATELY DOES NOT DO.

          It does not flag YOUR edits. A marker on every block you have touched
          is confetti, and it buries the one case the feature exists for.
          lib/blocks.js returns null for your own changes so this component
          never has to remember.

          It does not flag what it does not know. 0007's backfill leaves
          `edited_by` NULL for work that predates attribution rather than
          guessing the owner, and unknown renders as nothing at all.

          It is not a border, a glow or a tint on the block. Every one of those
          fights the block's own content for the same pixels — and a data tool
          whose tables change colour because somebody edited them is a tool
          that has made attribution more important than data. It is a dot in
          the header, in the one place the block already spends chrome. */}
      {/* STATE B — LIVE CO-PRESENCE.

          Same 7px dot, same personHue, same slot, same mono 9.5px label. The
          idiom is deliberately NOT changed: a person's colour means the same
          thing whether it is flagging their last edit or their presence, so
          identity stays consistent across both signals instead of the app
          having two palettes for "who".

          The ONE difference is that the dot pulses. That single piece of motion
          carries "live" versus "historical" on its own, which is why nothing
          else needed to change — and it is why there is no border, no glow and
          no tint at this stage. Those belong to state C, where there is an
          actual collision to report.

          Opacity is held steady through the pulse and only scale moves: a dot
          fading in and out reads as a loading indicator, and a 7px dot at
          reduced opacity against a raised header is close to invisible at the
          bottom of the cycle. */}
      {presence ? (
        <span
          title={presenceLabel(presence)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            flexShrink: 0, maxWidth: 140, overflow: 'hidden',
            fontFamily: 'var(--ds-font-mono)', fontSize: 11,
            color: text3, whiteSpace: 'nowrap',
          }}>
          <span
            className="ds-presence-dot"
            style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: personHue(presence.by),
            }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {presenceLabel(presence)}
          </span>
        </span>
      ) : attribution && (
        <span
          title={`${attributionLabel(attribution)}${attribution.at ? ' · ' + new Date(attribution.at).toLocaleString() : ''}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            flexShrink: 0, maxWidth: 120, overflow: 'hidden',
            fontFamily: 'var(--ds-font-mono)', fontSize: 11,
            color: text3, whiteSpace: 'nowrap',
          }}>
          {/* The dot carries the identity and the text carries the name, so the
              flag still reads for anyone who cannot separate the hues. Colour
              is never the only channel. */}
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: personHue(attribution.by),
          }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {attribution.name || 'Someone'}
          </span>
        </span>
      )}

      {/* Provenance. A block extracted from a PDF says so, and clicking takes
          you back to the page it came from.

          This is the same idea as a teleport link, pointed the other way: a
          teleport is a link the user wrote, this is one the app wrote on their
          behalf. Without it an extracted table is just a table, and in a week
          nobody remembers which document produced it — which for a research
          tool is the difference between a citation and a rumour. */}
      {block.source?.type === 'pdf' && (
        <button
          onClick={e => { e.stopPropagation(); onGoToSource?.(block.source) }}
          onMouseDown={e => e.stopPropagation()}
          title={`Extracted from page ${block.source.page} — click to go back to it`}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            background: 'none', border: 'none', borderRadius: 4, padding: '2px 6px',
            color: text3, cursor: 'pointer',
            fontFamily: 'var(--ds-font-mono)', fontSize: 11, lineHeight: 1,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = accent)}
          onMouseLeave={e => (e.currentTarget.style.color = text3)}>
          <Icon name="block-pdf" size={12} />
          p{block.source.page}
        </button>
      )}

      {/* Backlinks. Rendered only when there ARE some — a permanent "0" on
          every block would be noise on the 95% of blocks nothing points at. */}
      {backlinks.length > 0 && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); setShowBacklinks(v => !v) }}
            onMouseDown={e => e.stopPropagation()}
            aria-expanded={showBacklinks}
            title={`${backlinks.length} block${backlinks.length > 1 ? 's link' : ' links'} here`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: showBacklinks ? accentDim : 'none',
              border: 'none', borderRadius: 4, padding: '2px 6px',
              color: showBacklinks ? accent : text3, cursor: 'pointer',
              fontFamily: 'var(--ds-font-mono)', fontSize: 11, lineHeight: 1,
            }}>
            <Icon name="share-link" size={12} />
            {backlinks.length}
          </button>

          {showBacklinks && (
            <div
              onMouseDown={e => e.stopPropagation()}
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 5, zIndex: Z.popover,
                width: 232, maxHeight: 240, overflowY: 'auto',
                background: surface, border: `1px solid ${border}`, borderRadius: 8,
                boxShadow: '0 10px 30px rgba(0,0,0,0.28)', padding: 5,
                fontFamily: 'var(--ds-font-body)', cursor: 'default',
              }}>
              <div style={{
                fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.8,
                textTransform: 'uppercase', color: text3, padding: '3px 7px 5px',
              }}>
                Linked from
              </div>
              {backlinks.map((bl, i) => (
                <button
                  key={`${bl.from.blockId}:${i}`}
                  onClick={e => {
                    e.stopPropagation()
                    setShowBacklinks(false)
                    onTeleport?.(bl.from)
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 8px', borderRadius: 6, border: 'none',
                    background: 'transparent', cursor: 'pointer',
                    fontFamily: 'var(--ds-font-body)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = raised)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ display: 'block', fontSize: 12, color: text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bl.sourceName}
                  </span>
                  {/* The link's own words, which are usually more useful than
                      the source block's name for remembering why it points here. */}
                  {bl.label && bl.label !== bl.sourceName && (
                    <span style={{ display: 'block', fontSize: 11, color: accentText, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      “{bl.label}”
                    </span>
                  )}
                  <span style={{ display: 'block', fontSize: 11, color: text3, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bl.notebookName} › {bl.sheetName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={e => {
          e.stopPropagation()
          onDelete()
        }}
        style={{
          background: 'none',
          border: 'none',
          color: text3,
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1,
          padding: '0 2px',
          flexShrink: 0,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = red)}
        onMouseLeave={e => (e.currentTarget.style.color = text3)}
      >
        <Icon name="action-delete" size={12} />
      </button>
    </div>
  )
}
