'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { Z } from '../../lib/theme'
import { ADD_ITEMS, ADD_ITEMS_BY_GROUP, matchesAddQuery } from './blockRegistry'

/*
  components/notebook/AddMenu.js
  --------------------------------------------------------------------------
  THE +ADD MENU. Hybrid: grouped when you are browsing, flat when you are not.

  WHAT IT REPLACES
  A 140px-wide dropdown of ten bare labels in registry order, no search, no
  descriptions, no grouping, no keyboard. Fine at four block types and steadily
  worse at eleven — the list had become something you read rather than something
  you scanned.

  WHY BlockPicker IS THE PRECEDENT, NOT SlashMenu
  Structurally this is BlockPicker: a portalled fixed-position panel with a
  search input on top and a scrollable result list under it, opened
  already-focused so typing works immediately. SlashMenu is the visual
  precedent — row anatomy, active state, the mouseLive gating — but it is
  positioned at a caret and driven entirely by its parent's keyboard handler,
  because that parent owns a contentEditable. This owns its own input, so it
  owns its own keys.

  THE HYBRID, PRECISELY
  · Empty query  → grouped under the five ADD_MENU_GROUPS headings. Grouping is
                   a browsing aid for when you do not yet know what you want.
  · Any query    → headings vanish, one flat filtered list. The moment you know
                   what you want, the aid is in the way. Same behaviour
                   BlockPicker already has.

  ONE FLAT ACTIVE INDEX ACROSS EITHER VIEW. Arrowing down through the grouped
  view walks Write → Organize → Data → Media → Collaborate as a single sequence
  rather than per-group, because a two-axis keyboard model in an eleven-item
  menu is cost with no benefit. `flat` below is the single ordered array both
  views render from, so the index can never mean two different things.

  NOTHING HERE HAND-MAINTAINS A LIST. Items, groups, descriptions, keywords and
  bucketing all come from blockRegistry.js — which is the whole point of the
  unification pass. Adding a block type changes one file.
  -------------------------------------------------------------------------- */

const PANEL_W = 320      // 268 was the slash menu's; 300 still ellipsed three descriptions
const PANEL_MAXH = 380
const EDGE = 8

export default function AddMenu({ anchorRect, colors, onPick, onClose }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const [query, setQuery] = useState('')
  const [activeRaw, setActive] = useState(0)
  const panelRef = useRef(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  /* Mouse hover is suppressed until the pointer actually moves. Arrowing
     through the list scrolls it under a stationary cursor, which fires
     mouseenter on whatever slid underneath — and then the keyboard and the
     mouse fight over the highlight. Lifted verbatim from SlashMenu: it is a
     solved problem, not something to redesign per menu. */
  const mouseLive = useRef(false)

  const searching = query.trim().length > 0

  /* THE ONE ORDERED LIST. Both views render from this, so an index is
     unambiguous and Enter can never insert a different row from the one
     highlighted. */
  const flat = useMemo(
    () => (searching ? ADD_ITEMS.filter(i => matchesAddQuery(i, query)) : ADD_ITEMS_BY_GROUP.flatMap(g => g.items)),
    [query, searching]
  )

  /* CLAMPED AT READ, not corrected in an effect.

     `activeRaw` is what the keyboard moved to; `active` is that clamped to the
     list currently on screen. Doing it here rather than in a
     `useEffect(() => setActive(...))` matters twice: the effect version renders
     once with an out-of-range index before fixing it (so one frame highlights
     nothing), and it is a setState-in-effect cascade the React compiler
     refuses to compile around.

     Clamped rather than reset to 0, because typing one more character usually
     narrows the list around what you were already pointing at, and yanking the
     highlight back to the top each time makes the menu feel like it is arguing
     with you. */
  const active = flat.length ? Math.min(activeRaw, flat.length - 1) : 0

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    function wake() { mouseLive.current = true }
    window.addEventListener('mousemove', wake)
    return () => window.removeEventListener('mousemove', wake)
  }, [])

  /* Keep the highlighted row visible. scrollTop directly, never
     scrollIntoView — that walks up the ancestor chain and can scroll the canvas
     behind the panel, which on an infinite canvas means the menu moves the
     document you are about to add a block to. */
  useEffect(() => {
    mouseLive.current = false
    const list = listRef.current
    const el = list?.querySelector('[data-active="true"]')
    if (!list || !el) return
    /* offsetTop must be measured against the LIST, not the panel — the list
       carries `position: relative` for exactly that reason. Without it the
       search row's 38px was folded into every offsetTop while scrollTop was
       measured from the list's own origin, so the two were never in the same
       coordinate space and every keyboard scroll overshot.

       The group label is `position: sticky`, so it sits ON TOP of whatever
       scrolls under it. Landing a row flush with scrollTop therefore parks it
       underneath the label — which is why arrowing to the first item of a
       group hid the row you had just selected. Back the scroll off by the
       label's real height rather than a guessed constant. */
    const sticky = list.querySelector('[data-group-label]')
    const stickyH = sticky ? sticky.offsetHeight : 0
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top - stickyH < list.scrollTop) list.scrollTop = Math.max(0, top - stickyH)
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [active, query])

  useEffect(() => {
    function onDown(e) {
      if (!panelRef.current?.contains(e.target)) onClose()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown) }
  }, [onClose])

  function onKeyDown(e) {
    /* Handled AND stopped, both. The canvas has single-keypress block shortcuts
       (TYPE_BY_KEY — n/t/k/s/i/a/c) and its own Escape and arrow bindings; every
       letter typed into this search box is a letter that must not also reach
       them. The input element owns the keydown, so in practice a bubbling
       letter would need a document-level listener to cause trouble — but
       stopPropagation makes that independent of what anyone adds to the canvas
       later, which is cheaper than remembering this constraint. */
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation()
      /* Modulo wraparound, the same `(((i + d) % n) + n) % n` form
         TextBlockContent uses for the slash menu — from the last row, down
         lands on the first, and from the first, up lands on the last. */
      setActive(a => (flat.length ? (a + 1) % flat.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      setActive(a => (flat.length ? (((a - 1) % flat.length) + flat.length) % flat.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      const item = flat[active]
      if (item) onPick(item.type)
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation()
      onClose()
    } else {
      e.stopPropagation()
    }
  }

  if (typeof document === 'undefined') return null

  /* Anchored under the +Add button, flipping above when there is no room —
     the same edge handling SlashMenu does for the caret popup. Clamped against
     the VIEWPORT: this portals to <body> and is position:fixed, so it lives in
     screen space regardless of the canvas transform. */
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const a = anchorRect || { left: 24, bottom: 80, top: 40 }
  const left = Math.max(EDGE, Math.min(a.left, vw - PANEL_W - EDGE))
  const below = a.bottom + 6
  const flip = below + PANEL_MAXH > vh - EDGE
  const top = flip ? Math.max(EDGE, a.top - PANEL_MAXH - 6) : below

  /* Rendered per row so the grouped and flat views share ONE row component and
     cannot drift in anatomy or active state. `i` is the flat index — the only
     index that exists. */
  const Row = (item, i) => {
    const on = i === active
    return (
      <button
        key={item.type}
        role="option"
        aria-selected={on}
        data-active={on ? 'true' : 'false'}
        onMouseEnter={() => { if (mouseLive.current) setActive(i) }}
        onClick={() => onPick(item.type)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '8px 10px', border: 'none', borderRadius: 6, cursor: 'pointer',
          background: on ? accentDim : 'transparent',
          color: on ? accent : text,
          fontFamily: 'var(--ds-font-body)', textAlign: 'left',
          transition: 'background var(--ds-motion-hover) var(--ds-ease-standard)',
        }}>
        <span style={{
          width: 27, height: 27, borderRadius: 'var(--ds-radius-sm)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: on ? accent : raised, color: on ? '#fff' : text2,
        }}>
          <Icon name={item.icon} size={16} />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 500, fontSize: 13 }}>{item.label}</span>
          {item.desc && (
            <span style={{
              display: 'block', fontSize: 12, marginTop: 1,
              color: on ? accent : text3, opacity: on ? 0.8 : 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {item.desc}
            </span>
          )}
        </span>
      </button>
    )
  }

  const panel = (
    <div
      ref={panelRef}
      data-kbd-zone
      data-island-rail
      role="dialog"
      aria-label="Add a block"
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, zIndex: Z.popover,
        width: PANEL_W, maxHeight: PANEL_MAXH,
        display: 'flex', flexDirection: 'column',
        background: surface, border: `1px solid ${border}`, borderRadius: 'var(--ds-radius-pan)',
        boxShadow: 'var(--ds-shadow-lg)', overflow: 'hidden',
        fontFamily: 'var(--ds-font-body)',
        animation: 'dsToolbarIn var(--ds-motion-enter) var(--ds-ease-overshoot)',
      }}>

      {/* Search row. Geometry lives in .ds-searchrow in app/globals.css so this
          header and BlockPicker's cannot drift apart again — they carried two
          different padding pairs and two different esc keycaps before. Nothing
          here sets a size. */}
      <div className="ds-searchrow">
        <Icon name="nav-search" size="sm" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search blocks…"
          aria-label="Search blocks"
        />
        <kbd className="ds-kbd">esc</kbd>
      </div>

      <div ref={listRef} role="listbox" aria-label="Block types"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 6, position: 'relative' }}>

        {flat.length === 0 && (
          <div style={{ padding: '12px 12px', fontSize: 13, color: text3, lineHeight: 1.5 }}>
            Nothing matches “{query}”.
          </div>
        )}

        {/* SEARCHING → flat. The headings are a browsing aid and get out of the
            way the moment you know what you want. */}
        {searching && flat.map((item, i) => Row(item, i))}

        {/* BROWSING → grouped, with the flat index threaded through so the
            keyboard walks one continuous sequence across the headings. */}
        {!searching && (() => {
          let i = -1
          return ADD_ITEMS_BY_GROUP.map(g => (
            <div key={g.id}>
              <div data-group-label style={{
                /* Sticky, and the scroll effect above measures this element's
                   height so a row can never be parked underneath it. */
                position: 'sticky', top: -6, zIndex: 1,
                background: surface,
                padding: '8px 12px 6px',
                /* 600, not 700. At the old 9.5px a heavy weight was the only
                   thing making these readable; at 11px it made them compete
                   with the 13px row titles they are supposed to sit behind. */
                fontSize: 11, color: text3, textTransform: 'uppercase',
                letterSpacing: 0.8, fontWeight: 600, fontFamily: 'var(--ds-font-mono)',
              }}>
                {g.label}
              </div>
              {g.items.map(item => { i += 1; return Row(item, i) })}
            </div>
          ))
        })()}
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
