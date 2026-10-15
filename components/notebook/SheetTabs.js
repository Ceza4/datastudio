'use client'
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { Z } from '../../lib/theme'
import { localPointFromEvent } from '../../lib/canvasgeom'
import {
  tabsOf, activeTabId, allSheets, nameError, switchTab, addTab, renameTab,
  setTabColor, moveTab, duplicateTab, removeTab, sheetHasData, TAB_COLORS,
} from '../../lib/sheettabs'

/* ── SHEET TABS, the Excel strip at the bottom of a table ─────────────────
   Lives in SheetGrid's status bar. Everything it does is a patch through
   onUpdateBlock (lib/sheettabs.js explains the storage), so undo, sync and
   the size limits treat it like any other edit to the table.

   Switching remounts the grid (NotebookCanvas keys it on the active tab), so
   selection, scroll and the grid's own undo history belong to one sheet and
   never leak into the next. `pendingGridFocus` hands keyboard focus to the
   freshly mounted grid, so Ctrl+PgDn can be pressed again and again. */
export let pendingGridFocus = null
const FLY_MS = 170
const SLIDE = 'transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1)'
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
let lastClick = { block: null, id: null, t: 0 }
export const takeGridFocus = id => { if (pendingGridFocus === id) { pendingGridFocus = null; return true } return false }

export function switchSheet(block, onUpdateBlock, toId) {
  const p = switchTab(block, toId)
  if (!p) return false
  pendingGridFocus = block.id
  onUpdateBlock(block.id, p)
  return true
}

/** Ctrl+PgUp / Ctrl+PgDn, called from the grid's key handler. */
export function stepSheet(block, onUpdateBlock, dir) {
  const tabs = tabsOf(block)
  const i = tabs.findIndex(t => t.id === activeTabId(block))
  const j = i + dir
  if (j < 0 || j >= tabs.length) return false
  return switchSheet(block, onUpdateBlock, tabs[j].id)
}

export function newSheet(block, onUpdateBlock, afterId = null) {
  const p = addTab(block, { afterId })
  const { _newId, ...patch } = p
  pendingGridFocus = block.id
  onUpdateBlock(block.id, patch)
  return _newId
}

export default function SheetTabs({ block, colors, onUpdateBlock }) {
  const { border, text, text2, text3, accent, accentText, raised, surface, base } = colors
  const toast = useToast()
  const tabs = tabsOf(block)
  const active = activeTabId(block)
  const stripRef = useRef(null)
  const [renaming, setRenaming] = useState(null)   // { id, value }
  const [menu, setMenu] = useState(null)           // { id, x, y, confirm? }
  const [drag, setDrag] = useState(null)           // { id, j, shift, phase, ghost }
  const [overflow, setOverflow] = useState({ left: false, right: false })
  const menuRef = useRef(null)
  /* The menu opens ABOVE the pointer (the tabs sit at the bottom of the
     block) and is kept inside the window on every side, measured rather than
     guessed, because the confirm step is a different height. */
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el || !menu) return
    const h = el.offsetHeight, w = el.offsetWidth
    const top = Math.max(8, Math.min(menu.y - h - 4, window.innerHeight - h - 8))
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - w - 8))
    el.style.top = top + 'px'; el.style.left = left + 'px'; el.style.visibility = 'visible'
  }, [menu])

  /* Arrows only when the tabs do not fit, enabled only toward hidden tabs. */
  const measure = () => {
    const el = stripRef.current
    if (!el) return
    const over = el.scrollWidth > el.clientWidth + 1
    const left = over && el.scrollLeft > 0
    const right = over && el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setOverflow(o => (o.left === left && o.right === right && o.over === over ? o : { left, right, over }))
  }
  useLayoutEffect(measure)
  useEffect(() => {
    const el = stripRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /* Keep the active tab in view after a switch (Ctrl+PgDn into a hidden tab). */
  useEffect(() => {
    /* By hand, not scrollIntoView: that scrolls EVERY scrollable ancestor,
       and the canvas container is one — the whole canvas would jump. */
    const strip = stripRef.current
    const el = strip?.querySelector(`[data-tab-id="${CSS.escape(active)}"]`)
    if (!strip || !el) return
    const l = el.offsetLeft, r = l + el.offsetWidth
    if (l < strip.scrollLeft) strip.scrollLeft = l
    else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth
    /* Re-run when the arrows appear: they take width from the strip, which
       would otherwise leave the newest tab half hidden behind them. */
  }, [active, overflow.over, tabs.length])

  useEffect(() => {
    if (!menu) return
    const close = e => { if (!e.target.closest?.('[data-sheet-tab-menu]')) setMenu(null) }
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.__dsConsumed = true; setMenu(null) } }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('mousedown', close, true); window.removeEventListener('keydown', esc, true) }
  }, [menu])

  const update = patch => { if (patch) onUpdateBlock(block.id, patch) }

  function commitRename() {
    if (!renaming) return
    const t = tabs.find(x => x.id === renaming.id)
    const v = renaming.value.trim()
    if (!t || v === t.name) { setRenaming(null); return }
    const r = renameTab(block, renaming.id, v)
    if (r.error) return            // stays open, showing why
    update(r)
    setRenaming(null)
  }

  function remove(id) {
    const res = removeTab(block, id)
    if (!res) return
    const name = tabs.find(t => t.id === id)?.name
    if (activeTabId(block) === id) pendingGridFocus = block.id
    onUpdateBlock(block.id, res.patch)
    toast(`Deleted sheet “${name}”`, { undo: () => onUpdateBlock(block.id, res.undo) })
  }

  /* ── DRAG TO REORDER ─────────────────────────────────────────────────
     A press that moves under 5px is a click. Past that, the tab lifts into a
     GHOST that follows the pointer (portalled, in screen space), the tab it
     came from becomes a dashed slot, and the other tabs slide aside to show
     where it will land. Letting go flies the ghost into the slot, then the
     order is written. Escape flies it home and writes nothing.

     Where it lands is decided in the strip's own untransformed space
     (lib/canvasgeom), against the tabs' ORIGINAL positions — measuring the
     sliding tabs mid-animation would make the gap chase the pointer. */
  function onTabPointerDown(e, id) {
    if (e.button !== 0 || renaming) return
    e.stopPropagation()
    const strip = stripRef.current
    const startX = e.clientX, startY = e.clientY
    const from = tabs.findIndex(t => t.id === id)
    let dragging = false, cancelled = false
    let geo = null, j = from, raf = null, last = null

    const measureTabs = () => {
      const els = [...strip.querySelectorAll('[data-tab-id]')]
      return els.map(el => ({ id: el.getAttribute('data-tab-id'), left: el.offsetLeft, w: el.offsetWidth }))
    }
    const slotFor = ev => {
      const x = localPointFromEvent(strip, ev).x + strip.scrollLeft
      let to = geo.tabs.length
      for (let k = 0; k < geo.tabs.length; k++) {
        if (k === from) continue
        const t = geo.tabs[k]
        if (x < t.left + t.w / 2) { to = k; break }
      }
      return to > from ? to - 1 : to
    }
    const layoutFor = jj => {
      const wD = geo.tabs[from].w
      const shift = {}
      let slot = 0
      geo.tabs.forEach((t, k) => {
        if (k === from) return
        if (from < k && k <= jj) { shift[t.id] = -wD; slot += t.w }
        else if (jj <= k && k < from) { shift[t.id] = wD; slot -= t.w }
      })
      shift[id] = slot
      return shift
    }
    const frame = () => {
      raf = null
      if (!last || cancelled) return
      const ev = last
      /* Nudge the strip when the ghost reaches either end, so a tab can be
         carried past the ones scrolled out of view. */
      const lx = localPointFromEvent(strip, ev).x
      if (lx < 24) strip.scrollLeft -= 10
      else if (lx > strip.clientWidth - 24) strip.scrollLeft += 10
      j = slotFor(ev)
      setDrag(d => d && ({
        ...d, j, shift: layoutFor(j),
        ghost: { ...d.ghost, left: ev.clientX - geo.grabX, top: geo.rect.top + (ev.clientY - startY) },
      }))
      if (lx < 24 || lx > strip.clientWidth - 24) raf = requestAnimationFrame(frame)
    }
    const begin = ev => {
      dragging = true
      const el = strip.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)
      const rect = el.getBoundingClientRect()
      geo = { tabs: measureTabs(), rect, grabX: startX - rect.left, scale: rect.width / (el.offsetWidth || 1) }
      document.body.style.cursor = 'grabbing'
      const t = tabs[from]
      setDrag({
        id, j: from, shift: {}, phase: 'drag',
        ghost: { left: ev.clientX - geo.grabX, top: rect.top, w: rect.width, h: rect.height, scale: geo.scale, name: t.name, color: t.color || '', on: t.id === active },
      })
    }
    const finish = (toRect, commit) => {
      document.body.style.cursor = ''
      const settle = () => {
        if (commit && j !== from) {
          /* Transitions off for the frame the order changes, so the tabs
             land in their new places instead of sliding back from the old. */
          setDrag(d => d && { ...d, phase: 'settle', shift: {} })
          update(moveTab(block, id, j))
          requestAnimationFrame(() => requestAnimationFrame(() => setDrag(null)))
        } else setDrag(null)
      }
      if (!toRect || reducedMotion()) { settle(); return }
      setDrag(d => d && ({ ...d, phase: 'fly', ghost: { ...d.ghost, left: toRect.left, top: toRect.top } }))
      setTimeout(settle, FLY_MS)
    }
    const onKey = ev => {
      if (ev.key !== 'Escape' || !dragging) return
      ev.preventDefault(); ev.stopPropagation(); ev.__dsConsumed = true
      cancelled = true
      cleanup()
      j = from
      setDrag(d => d && { ...d, j: from, shift: {} })
      finish(geo.rect, false)
    }
    const move = ev => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return
        begin(ev)
      }
      last = ev
      if (raf == null) raf = requestAnimationFrame(frame)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', onKey, true)
      if (raf != null) { cancelAnimationFrame(raf); raf = null }
    }
    const up = ev => {
      cleanup()
      if (cancelled) return
      if (!dragging) {
        /* A double-click on an INACTIVE tab: the first click switches, which
           remounts the grid and this strip with it, so the browser never
           sees two clicks on one element and no dblclick fires. The pair is
           recognised here instead, across the remount. */
        const now = Date.now()
        if (lastClick.block === block.id && lastClick.id === id && now - lastClick.t < 450) {
          lastClick = { block: null, id: null, t: 0 }
          setRenaming({ id, value: tabs.find(t => t.id === id)?.name || '' })
          return
        }
        lastClick = { block: block.id, id, t: now }
        if (id !== active) switchSheet(block, onUpdateBlock, id)
        return
      }
      if (ev.type === 'pointercancel') { finish(geo.rect, false); return }
      j = slotFor(ev)
      /* The slot's screen position: the dragged tab has already been slid
         into it (see `shift`), so its own rect IS the destination. */
      const el = strip.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)
      finish(el ? el.getBoundingClientRect() : null, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('keydown', onKey, true)
  }

  const btn = {
    width: 22, height: 22, display: 'grid', placeItems: 'center', flexShrink: 0,
    background: 'none', border: 'none', borderRadius: 4, cursor: 'pointer', color: text3, padding: 0,
  }
  const hover = on => e => { e.currentTarget.style.background = on ? surface : 'none'; e.currentTarget.style.color = on ? text : text3 }

  const menuSheet = menu ? allSheets(block).find(s => s.id === menu.id) : null
  const menuIdx = menu ? tabs.findIndex(t => t.id === menu.id) : -1
  const renameErr = renaming ? nameError(renaming.value, tabs, renaming.id) : ''

  return (
    <div data-sheet-tabs="" onMouseDown={e => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'stretch', minWidth: 0, flex: '0 1 auto', height: '100%', position: 'relative' }}>
      {overflow.over && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, paddingRight: 2 }}>
          <button aria-label="Scroll sheet tabs left" title="Scroll tabs left" disabled={!overflow.left}
            onClick={() => { stripRef.current.scrollLeft -= 140 }} onMouseEnter={hover(true)} onMouseLeave={hover(false)}
            style={{ ...btn, opacity: overflow.left ? 1 : 0.35 }}><Icon name="nav-chevron-right" size={12} style={{ transform: 'rotate(180deg)' }} /></button>
          <button aria-label="Scroll sheet tabs right" title="Scroll tabs right" disabled={!overflow.right}
            onClick={() => { stripRef.current.scrollLeft += 140 }} onMouseEnter={hover(true)} onMouseLeave={hover(false)}
            style={{ ...btn, opacity: overflow.right ? 1 : 0.35 }}><Icon name="nav-chevron-right" size={12} /></button>
        </div>
      )}

      <div ref={stripRef} role="tablist" aria-label="Sheets" onScroll={measure}
        style={{ display: 'flex', alignItems: 'stretch', overflow: 'hidden', minWidth: 0, flex: '0 1 auto', position: 'relative', }}>
        {tabs.map(t => {
          const on = t.id === active
          const isRen = renaming?.id === t.id
          return (
            <div key={t.id} data-tab-id={t.id} role="tab" aria-selected={on}
              tabIndex={on ? 0 : -1}
              title={t.name}
              onPointerDown={e => onTabPointerDown(e, t.id)}
              onDoubleClick={e => { e.stopPropagation(); setRenaming({ id: t.id, value: t.name }) }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ id: t.id, x: e.clientX, y: e.clientY }) }}
              onKeyDown={e => {
                if (isRen) return
                if (e.key === 'F2') { e.preventDefault(); setRenaming({ id: t.id, value: t.name }) }
              }}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                minWidth: 56, maxWidth: 180, padding: isRen ? '0 4px' : '0 12px', justifyContent: 'center',
                cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                fontFamily: 'var(--ds-font-body)', fontSize: 12,
                color: on ? text : text2, fontWeight: on ? 600 : 400,
                background: on ? base : 'transparent',
                borderRight: `1px solid ${border}`,
                transform: drag?.shift?.[t.id] ? `translateX(${drag.shift[t.id]}px)` : 'none',
                transition: drag && drag.phase !== 'settle' && !reducedMotion() ? SLIDE : 'none',
                zIndex: drag?.id === t.id ? 0 : 1,
                /* The slot the dragged tab will land in: a dashed outline of
                   the same width, its label hidden while the ghost is away. */
                ...(drag?.id === t.id && drag.phase !== 'settle' ? {
                  color: 'transparent', background: `${accent}14`,
                  outline: `1px dashed ${accent}`, outlineOffset: -3,
                } : null),
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = surface }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>
              {isRen ? (
                <input autoFocus data-ds-rename value={renaming.value} maxLength={40} aria-label="Sheet name"
                  aria-invalid={!!renameErr}
                  onChange={e => setRenaming({ id: t.id, value: e.target.value })}
                  onFocus={e => e.currentTarget.select()}
                  onPointerDown={e => e.stopPropagation()}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                    if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; setRenaming(null) }
                  }}
                  onBlur={() => { if (!renameErr) commitRename(); else setRenaming(null) }}
                  style={{
                    width: Math.max(70, Math.min(160, renaming.value.length * 7 + 20)), height: 20,
                    border: `1px solid ${renameErr ? 'var(--ds-red)' : accent}`, borderRadius: 4,
                    background: surface, color: text, padding: '0 6px', outline: 'none',
                    fontFamily: 'var(--ds-font-body)', fontSize: 12,
                  }} />
              ) : (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
              )}
              {on && !isRen && <span aria-hidden="true" style={{ position: 'absolute', left: 8, right: 8, bottom: 3, height: 2, borderRadius: '999px', background: accent }} />}
              {t.color && <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: t.color, opacity: on ? 0.55 : 1 }} />}
            </div>
          )
        })}
      </div>

      <button aria-label="New sheet" title="New sheet (Shift+F11)"
        onClick={() => newSheet(block, onUpdateBlock)}
        onMouseEnter={e => { e.currentTarget.style.color = accentText; e.currentTarget.style.background = surface }}
        onMouseLeave={e => { e.currentTarget.style.color = text3; e.currentTarget.style.background = 'none' }}
        style={{ ...btn, width: 26, height: 'auto', alignSelf: 'stretch', borderRadius: '0', borderRight: `1px solid ${border}` }}>
        <Icon name="action-add" size={12} />
      </button>

      {renaming && renameErr && (
        <div role="alert" style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: Z.hint, whiteSpace: 'nowrap',
          background: 'var(--ds-red)', color: '#fff', padding: '4px 8px', borderRadius: 6,
          fontFamily: 'var(--ds-font-body)', fontSize: 12, boxShadow: 'var(--ds-shadow-md)',
        }}>{renameErr}</div>
      )}

      {drag?.ghost && drag.phase !== 'settle' && typeof document !== 'undefined' && createPortal(
        <div aria-hidden="true" data-sheet-tab-ghost=""
          style={{
            position: 'fixed', left: drag.ghost.left, top: drag.ghost.top, minWidth: drag.ghost.w, height: drag.ghost.h,
            zIndex: Z.popover, pointerEvents: 'none', boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            padding: `0 ${12 * drag.ghost.scale}px`, whiteSpace: 'nowrap',
            fontFamily: 'var(--ds-font-body)', fontSize: 12 * drag.ghost.scale, fontWeight: drag.ghost.on ? 600 : 400,
            color: text, background: base, border: `1px solid ${accent}`, borderRadius: 6,
            boxShadow: 'var(--ds-shadow-lg)',
            transform: drag.phase === 'fly' ? 'none' : 'translateY(-3px) rotate(-1.5deg) scale(1.04)',
            transition: drag.phase === 'fly'
              ? `left ${FLY_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), top ${FLY_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), transform ${FLY_MS}ms ease`
              : 'transform 120ms ease',
          }}>
          <span>{drag.ghost.name}</span>
          {drag.ghost.color && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: drag.ghost.color }} />}
        </div>,
        document.body
      )}

      {menu && menuSheet && typeof document !== 'undefined' && createPortal(
        <div ref={menuRef} data-sheet-tab-menu="" role="menu"
          style={{
            position: 'fixed', left: menu.x, top: menu.y, visibility: 'hidden', zIndex: Z.popover,
            minWidth: 200, maxWidth: 260, background: surface, border: `1px solid ${border}`, borderRadius: 8,
            boxShadow: 'var(--ds-shadow-lg)', padding: 4, fontFamily: 'var(--ds-font-body)',
          }}>
          {menu.confirm ? (
            <div style={{ padding: 8, display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: text }}>Delete “{menuSheet.name}”?</div>
              <div style={{ fontSize: 12, color: text2, lineHeight: 1.5 }}>It has data in it. You can undo this from the notice that appears.</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button onClick={() => setMenu(null)} style={menuBtn(border, text2, surface)}>Cancel</button>
                <button autoFocus onClick={() => { setMenu(null); remove(menu.id) }}
                  style={{ ...menuBtn('var(--ds-red)', '#fff', 'var(--ds-red)') }}>Delete</button>
              </div>
            </div>
          ) : (<>
            <div style={{ padding: '6px 10px 4px', fontFamily: 'var(--ds-font-mono)', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{menuSheet.name}</div>
            <MenuItem icon="action-add" label="Insert sheet" hint="Shift+F11" colors={colors} onClick={() => { setMenu(null); newSheet(block, onUpdateBlock, menu.id) }} />
            <MenuItem icon="action-rename" label="Rename" hint="Double-click" colors={colors} onClick={() => { setMenu(null); setRenaming({ id: menu.id, value: menuSheet.name }) }} />
            <MenuItem icon="action-duplicate" label="Duplicate" colors={colors} onClick={() => { setMenu(null); const p = duplicateTab(block, menu.id); if (p) { const { _newId, ...patch } = p; pendingGridFocus = block.id; update(patch) } }} />
            <div style={{ height: 1, background: border, margin: '4px 2px' }} />
            <div style={{ padding: '4px 10px 2px', fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Tab colour</div>
            <div style={{ display: 'flex', gap: 5, padding: '4px 10px 6px', flexWrap: 'wrap' }}>
              {['', ...TAB_COLORS].map(c => (
                <button key={c || 'none'} aria-label={c ? `Colour ${c}` : 'No colour'} title={c ? c : 'No colour'}
                  onClick={() => { setMenu(null); update(setTabColor(block, menu.id, c)) }}
                  style={{
                    width: 20, height: 20, borderRadius: 4, cursor: 'pointer', padding: 0,
                    background: c || base, border: `1px solid ${c ? 'rgba(0,0,0,0.15)' : border}`,
                    outline: (menuSheet.color || '') === c ? `2px solid ${accent}` : 'none', outlineOffset: 1,
                    color: text3, fontSize: 11, lineHeight: 1,
                  }}>{c ? '' : '×'}</button>
              ))}
            </div>
            <div style={{ height: 1, background: border, margin: '4px 2px' }} />
            <MenuItem icon="nav-chevron-right" flip label="Move left" disabled={menuIdx <= 0} colors={colors} onClick={() => { setMenu(null); update(moveTab(block, menu.id, menuIdx - 1)) }} />
            <MenuItem icon="nav-chevron-right" label="Move right" disabled={menuIdx >= tabs.length - 1} colors={colors} onClick={() => { setMenu(null); update(moveTab(block, menu.id, menuIdx + 1)) }} />
            <div style={{ height: 1, background: border, margin: '4px 2px' }} />
            <MenuItem icon="action-delete" label="Delete" danger disabled={tabs.length < 2}
              hint={tabs.length < 2 ? 'Only sheet' : null} colors={colors}
              onClick={() => { if (sheetHasData(menuSheet)) setMenu({ ...menu, confirm: true }); else { setMenu(null); remove(menu.id) } }} />
          </>)}
        </div>,
        document.body
      )}
    </div>
  )
}

const menuBtn = (bd, fg, bg) => ({
  height: 26, padding: '0 12px', borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${bd}`, background: bg, color: fg,
  fontFamily: 'var(--ds-font-body)', fontSize: 12,
})

function MenuItem({ icon, flip, label, hint, onClick, disabled, danger, colors }) {
  const { text2, text3, raised } = colors
  return (
    <button role="menuitem" disabled={disabled} onClick={onClick}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = raised }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '7px 10px', background: 'none', border: 'none', borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        fontFamily: 'var(--ds-font-body)', fontSize: 13, color: danger ? 'var(--ds-red)' : text2,
      }}>
      <Icon name={icon} size={14} style={flip ? { transform: 'rotate(180deg)' } : undefined} />
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3 }}>{hint}</span>}
    </button>
  )
}
