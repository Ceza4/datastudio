'use client'
import Icon from '../ui/Icon'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '../../lib/theme'
import { SLASH_BLOCK_ITEMS } from './blockRegistry'

/* SlashMenu — presentational only.
   --------------------------------------------------------------------------
   WHY THIS WAS REWRITTEN

   The old version owned its own keyboard handling via a capture-phase
   `document.addEventListener('keydown', …, true)`, while the contentEditable
   that owns the caret had its own React onKeyDown. Two handlers, two phases,
   and an effect whose dependency array (`[filtered, activeIdx, onSelect,
   onClose]`) was a fresh array plus two fresh closures on every render — so
   the listener was torn down and re-registered constantly. Arrow keys raced
   the caret: whichever handler won decided whether the caret moved, and once
   the caret moved off the end of "/query" the parent's detectSlash() no
   longer matched and closed the menu. That's the "press / then arrow down and
   it disappears" bug.

   The fix is ownership, not patching. The component that owns the caret —
   TextBlockContent — now owns the keyboard too. It intercepts arrows, Enter,
   Tab and Escape in its own onKeyDown before the browser can move the caret,
   and drives this component through props. This file no longer listens to
   anything. There is exactly one handler, in one phase, and no race is
   possible.

   Rendered through a portal into document.body because the notebook canvas
   applies a CSS transform, which breaks position:fixed for descendants.
   -------------------------------------------------------------------------- */

/* THE NINE FORMATTING COMMANDS, hand-maintained — correctly.

   These mutate markup inside the paragraph you are already in. There is nothing
   in blockRegistry.js for them to be derived FROM, and inventing registry
   entries for "Heading 2" so that one list could generate both would be a
   worse kind of duplication: a block registry describing things that are not
   blocks. So the split is deliberate rather than half-finished — formatting is
   declared here, block insertion is derived below. */
const FORMAT_COMMANDS = [
  { id: 'h1',        label: 'Heading 1',   desc: 'Large section heading',      icon: 'text-h1',    keywords: 'heading title big' },
  { id: 'h2',        label: 'Heading 2',   desc: 'Medium section heading',     icon: 'text-h2',    keywords: 'heading subtitle' },
  { id: 'h3',        label: 'Heading 3',   desc: 'Small section heading',      icon: 'text-h3',    keywords: 'heading small' },
  { id: 'bullet',    label: 'Bullet list', desc: 'Unordered list',             icon: 'text-bullet-list',     keywords: 'bullet unordered list ul point' },
  { id: 'numbered',  label: 'Numbered list', desc: 'Ordered list with numbers', icon: 'text-numbered-list',   keywords: 'numbered ordered list ol' },
  { id: 'checklist', label: 'Checklist',   desc: 'To-do items with checkboxes', icon: 'text-checklist',    keywords: 'checklist todo checkbox task' },
  { id: 'quote',     label: 'Quote',       desc: 'Indented quotation',          icon: 'text-quote',    keywords: 'quote blockquote cite' },
  { id: 'divider',   label: 'Divider',     desc: 'Horizontal separator line',   icon: 'text-divider',    keywords: 'divider line separator rule hr' },
  { id: 'code',      label: 'Code block',  desc: 'Monospaced code snippet',     icon: 'text-code',  keywords: 'code snippet pre monospace' },
  /* Columns live here, not in SLASH_BLOCK_ITEMS below, on purpose. They used
     to insert a whole separate floating block (the old Notion-style `columns`
     container type) — this is the replacement: real text columns, laid out
     inside the paragraph flow you're already in, the same way "Bullet list"
     turns your current content into a list rather than spawning a new block.
     See lib/columns.js for the HTML they insert. */
  { id: 'columns-2', label: '2 columns',   desc: 'Lay out text in 2 side-by-side columns', icon: 'block-section', keywords: 'columns layout side by side split two' },
  { id: 'columns-3', label: '3 columns',   desc: 'Lay out text in 3 side-by-side columns', icon: 'block-section', keywords: 'columns layout side by side split three' },
  { id: 'columns-4', label: '4 columns',   desc: 'Lay out text in 4 side-by-side columns', icon: 'block-section', keywords: 'columns layout side by side split four' },
  { id: 'columns-5', label: '5 columns',   desc: 'Lay out text in 5 side-by-side columns', icon: 'block-section', keywords: 'columns layout side by side split five' },
  /* Not a formatting command — it opens a picker and then inserts a span. The
     slash menu is still the right home for it: it's where people already look
     for "insert something here", and putting it in the format rail would
     imply it styles the selection. */
  { id: 'link',      label: 'Link to a block', desc: 'Jump to another block, sheet or notebook', icon: 'share-link', keywords: 'link teleport jump reference goto connect mention' },
]

/** Ids that insert a fresh N-column row rather than reformatting the current
 *  paragraph. Read by TextBlockContent.js's applyCommand — kept as a derived
 *  set (not a hardcoded switch-case list in two files) for the same reason
 *  SLASH_BLOCK_IDS below is derived rather than typed twice. */
export const COLUMNS_COMMAND_N = Object.freeze({
  'columns-2': 2, 'columns-3': 3, 'columns-4': 4, 'columns-5': 5,
})

/* ── BLOCK INSERTION, DERIVED FROM THE REGISTRY ───────────────────────────
   `database` used to be a tenth hand-typed entry in the array above — a second,
   independent declaration of a type blockRegistry.js already fully describes.
   The two agreed, and nothing whatsoever enforced that they would keep
   agreeing: change the label, the icon or the keywords in either place and they
   silently diverge. `columns` was about to be the second instance of the same
   thing.

   Now both come from BLOCK_TYPES via SLASH_BLOCK_ITEMS, opted in per type with
   `inSlashMenu`. Adding another one is one flag in one file.

   They stay LAST, after the formatting commands, because that is where they
   were and because "insert a whole block" is a bigger action than "make this a
   heading" — the common case should not move down the list to make room for the
   rare one. */
export const COMMANDS = [...FORMAT_COMMANDS, ...SLASH_BLOCK_ITEMS]

/* Which ids put a BLOCK on the canvas rather than markup in this paragraph.
   Derived, so the handler in TextBlockContent cannot fall out of step with the
   list either — it used to test `id === 'database'` by hand. */
export const SLASH_BLOCK_IDS = new Set(SLASH_BLOCK_ITEMS.map(i => i.id))

/* Shared by the menu and by its parent, so the parent can clamp the active
   index against exactly the list the user is looking at. */
export function filterCommands(filter) {
  const q = (filter || '').toLowerCase().trim()
  if (!q) return COMMANDS
  return COMMANDS.filter(c =>
    c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q)
  )
}

export default function SlashMenu({ x, y, filter, activeIdx, colors, onSelect, onHover }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const listRef = useRef(null)
  // Mouse selection is suppressed until the pointer actually moves. Cycling
  // with the arrow keys scrolls the list under a stationary cursor, which
  // fires mouseenter on whatever slid beneath it — the keyboard and the mouse
  // then fight over the highlight. Standard menu behaviour: last input wins.
  const mouseLive = useRef(false)
  const filtered = filterCommands(filter)

  useEffect(() => {
    function wake() { mouseLive.current = true }
    window.addEventListener('mousemove', wake)
    return () => window.removeEventListener('mousemove', wake)
  }, [])

  const searching = (filter || '').trim().length > 0

  /* Keep the highlighted row in view when the parent moves the index.
     scrollTop is set directly rather than via scrollIntoView, which walks up
     the ancestor chain and can scroll the page or the canvas behind us.

     THE STICKY HEADER STILL HAS TO BE ACCOUNTED FOR HERE. position: sticky
     (below) keeps a group header pinned on screen, but it does NOT reserve
     space for itself in this scroll-into-view math — scrollTop = el.offsetTop
     alone would happily park the active row's top edge visually behind the
     pinned header. Subtracting the header's own height from the "scrolling
     up" threshold is what keeps the active row fully clear of it. Only that
     branch needs the offset: the "scrolling down" branch aligns the row's
     BOTTOM edge to the viewport's bottom, which a top-pinned header never
     touches. No headers render at all while searching (see `searching`
     above), so the offset is simply 0 in that case. */
  useEffect(() => {
    mouseLive.current = false
    const list = listRef.current
    const el = list?.querySelector('[data-active="true"]')
    if (!list || !el) return
    const headerH = searching ? 0 : (list.querySelector('[data-slash-group-head]')?.offsetHeight || 0)
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top - headerH < list.scrollTop) list.scrollTop = top - headerH
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [activeIdx, filter, searching])

  if (typeof document === 'undefined') return null

  const MENU_W = 268
  const MENU_H = 340
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8))
  // Flip above the caret when there isn't room below it.
  const below = y + 6
  const top = below + MENU_H > window.innerHeight - 8
    ? Math.max(8, y - MENU_H - 22)
    : below

  /* Rendered per row so the grouped and flat views share ONE row component
     and cannot drift in anatomy or active state — the same discipline
     AddMenu.js uses for its own grouped/flat hybrid. `i` is the flat index
     into `filtered` (== COMMANDS when not searching), the only index that
     exists — group boundaries are a rendering detail layered on top, never a
     second index. */
  const Row = (cmd, i) => {
    const on = i === activeIdx
    return (
      <button key={cmd.id}
        role="option"
        aria-selected={on}
        data-active={on ? 'true' : 'false'}
        onMouseEnter={() => { if (mouseLive.current) onHover?.(i) }}
        onClick={() => onSelect(cmd.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '8px 10px', border: 'none', borderRadius: 6, cursor: 'pointer',
          background: on ? accentDim : 'transparent',
          color: on ? accent : text,
          fontFamily: 'var(--ds-font-body)', textAlign: 'left',
        }}>
        <span style={{
          width: 27, height: 27, borderRadius: 6, display: 'flex',
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: on ? accent : raised, color: on ? '#fff' : text2,
        }}>
          <Icon name={cmd.icon} size={16} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 500, fontSize: 13 }}>{cmd.label}</span>
          <span style={{ display: 'block', fontSize: 12, color: on ? accent : text3, opacity: on ? 0.8 : 1, marginTop: 1 }}>
            {cmd.desc}
          </span>
        </span>
      </button>
    )
  }

  /* GroupHead — sticky, reused for both groups. `position: sticky` is
     AddMenu.js's own group-header treatment, applied here verbatim rather
     than invented fresh: same `top: -6`, same background-matches-surface so
     rows scrolling underneath don't show through, same uppercase mono label.
     `data-slash-group-head` is a plain attribute selector, not a CSS hook —
     it's how the scroll-effect above measures the header's height without
     hardcoding a pixel number that would drift the moment the label styling
     changes. */
  const GroupHead = label => (
    <div data-slash-group-head style={{
      position: 'sticky', top: -6, zIndex: 1, background: surface,
      padding: '7px 11px 5px', fontSize: 11, color: text3, textTransform: 'uppercase',
      letterSpacing: 0.8, fontWeight: 700, fontFamily: 'var(--ds-font-mono)',
    }}>
      {label}
    </div>
  )

  const menu = (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert block"
      onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
      style={{
        position: 'fixed', left, top, zIndex: Z.popover,
        background: surface, border: `1px solid ${border}`, borderRadius: 'var(--ds-radius-pan)',
        boxShadow: 'var(--ds-shadow-lg)', padding: 6,
        fontFamily: 'var(--ds-font-body)', width: MENU_W,
        maxHeight: MENU_H, overflowY: 'auto',
      }}>

      {filtered.length === 0 && (
        <div style={{ padding: '10px 12px', fontSize: 13, color: text3 }}>
          No blocks match “{filter}”
        </div>
      )}

      {/* SEARCHING → flat, no group labels. A query means you already know
          what you want; the grouping is a browsing aid and gets out of the
          way, same as AddMenu.js does the instant its own search box has
          text in it. */}
      {searching && filtered.map((cmd, i) => Row(cmd, i))}

      {/* BROWSING → two real sticky-headed groups, "Format" then "Insert" —
          renamed from the old single "Insert" header, which was wrong for
          most of what sat under it (formatting commands don't insert
          anything). One flat index threaded through both groups via the `i`
          counter below, same technique AddMenu.js uses for its five. */}
      {!searching && (() => {
        let i = -1
        return (
          <>
            {GroupHead('Format')}
            {FORMAT_COMMANDS.map(cmd => { i += 1; return Row(cmd, i) })}
            {GroupHead('Insert')}
            {SLASH_BLOCK_ITEMS.map(cmd => { i += 1; return Row(cmd, i) })}
          </>
        )
      })()}
    </div>
  )

  return createPortal(menu, document.body)
}
