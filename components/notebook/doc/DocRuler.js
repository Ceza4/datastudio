'use client'
import { useMemo, useRef, useState } from 'react'
import { normalizeMargin, MARGIN_STEP } from '../../../lib/pagesetup'
import { applyParagraphStyle, paragraphsIn } from '../../../lib/docedit'
import { parseStops, formatStops, TAB_KINDS } from '../../../lib/doctabs'

/* ── The ruler ────────────────────────────────────────────────────────────
   Two rows, so nothing covers anything:
     · the BAR: the shaded areas are the margins; drag the edge where shade
       meets white to move a margin (the same `block.margins` the Layout tab
       edits);
     · the LANE under it: the caret paragraph's indents — first-line ▽,
       left indent □ and right indent △ — written to THAT paragraph, the way
       Word's indent markers work, not to the whole document.
   Every handle is a real button that also answers ← → (Shift for 0.25″).
   The ruler is drawn at the page's on-screen width, so its inches are the
   page's inches at every block width and every canvas zoom.

   It follows the CARET's page: a landscape section's ruler is wider, and
   with mirror margins an even page shows its margins swapped (dragging its
   left edge moves the document's right margin — the outside one).

   TAB STOPS (Word's model): the box at the far left picks the kind — left,
   centre, right; click the lane to set one on the caret paragraph(s), drag
   it along to move it, drag it off the ruler to remove it. Stops are
   inches from the left margin, stored on the paragraph (lib/doctabs.js). */
export default function Ruler({ block, metrics, colors, scale, editorRef, selTick, onUpdateBlock, onParagraphChange, padX = 24, docW, page }) {
  const { border, raised, text3, accent, base } = colors
  const barRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [tip, setTip] = useState(null)

  /* The caret page, in inches; falls back to the block's own page. */
  const gutter = Math.max(0, Math.min(2, Number(block.gutter) || 0))
  const pg = page || { w: metrics.px.pageW, x: 0, left: metrics.px.left + gutter * 96, right: metrics.px.right, even: false }
  const pageW = pg.w / 96
  const inches = Math.ceil(pageW)
  const pct = inchesFromLeft => (inchesFromLeft / pageW) * 100
  /* The margins as drawn on this page (gutter inside the left one). */
  const mL = pg.left / 96, mR = pg.right / 96
  const [tabKind, setTabKind] = useState('l')

  /* The caret paragraph's indents, in inches. */
  const para = useMemo(() => {
    const el = editorRef.current
    const p = el ? paragraphsIn(el)[0] : null
    if (!p) return null
    const cs = getComputedStyle(p)
    const PX = 96
    return {
      left: (parseFloat(cs.marginLeft) || 0) / PX,
      first: (parseFloat(cs.textIndent) || 0) / PX,
      right: (parseFloat(cs.marginRight) || 0) / PX,
      stops: parseStops(p.getAttribute('data-ds-tabs')),
    }
  }, [selTick, block.content]) // eslint-disable-line react-hooks/exhaustive-deps

  /* `side` is the side ON THIS PAGE; v the drawn margin there, in inches. */
  const writeMargin = (side, v) => {
    const drawnOther = side === 'left' ? mR : mL
    const drawn = Math.min(pageW - drawnOther - 1, Math.max(0.25, v))
    /* Which document margin that is: an even mirrored page swaps sides; the
       gutter sits on the inside (drawn left on odd, right on even — but it is
       added to the left margin's geometry only, so subtract it there). */
    const which = pg.even ? (side === 'left' ? 'right' : 'left') : side
    const raw = which === 'left' ? drawn - gutter : drawn
    const val = normalizeMargin(Math.max(0.25, raw), metrics.margins[which])
    onUpdateBlock?.(block.id, { margins: { ...metrics.margins, [which]: val } })
    return val
  }
  const writeStops = fn => {
    const el = editorRef.current
    if (!el) return
    applyParagraphStyle(el, p => {
      const next = formatStops(fn(parseStops(p.getAttribute('data-ds-tabs'))))
      if (next) p.setAttribute('data-ds-tabs', next); else p.removeAttribute('data-ds-tabs')
    })
    onParagraphChange?.()
  }
  const writeIndent = (which, v) => {
    const el = editorRef.current
    if (!el) return 0
    const contentW = metrics.inches.contentW
    const cur = para || { left: 0, first: 0, right: 0 }
    let out = 0
    applyParagraphStyle(el, p => {
      if (which === 'left') { out = Math.max(0, Math.min(contentW - 1 - cur.right, v)); p.style.marginLeft = out ? out + 'in' : ''; if (!out) p.style.removeProperty('margin-left') }
      else if (which === 'right') { out = Math.max(0, Math.min(contentW - 1 - cur.left, v)); p.style.marginRight = out ? out + 'in' : ''; if (!out) p.style.removeProperty('margin-right') }
      else { out = Math.max(-cur.left, Math.min(contentW - cur.left - 0.5, v)); if (out) p.style.textIndent = out + 'in'; else p.style.removeProperty('text-indent') }
    })
    onParagraphChange?.()
    return out
  }

  /* Screen px → inches from the bar's own measured width, so the conversion
     holds at every zoom without knowing it. */
  const startDrag = (which, e) => {
    e.preventDefault(); e.stopPropagation()
    const bar = barRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const pxPerIn = rect.width / pageW
    const snap = v => Math.round(v * 16) / 16
    setDrag(which)
    /* A tab stop being dragged: its current position, removed if dropped
       off the ruler. */
    let stopAt = typeof which === 'object' ? which.at : null
    let off = false
    const move = ev => {
      const x = snap((ev.clientX - rect.left) / pxPerIn)
      let label
      if (typeof which === 'object') {
        off = Math.abs(ev.clientY - (rect.top + rect.height)) > 36
        const nx = Math.max(0.06, Math.min(pageW - mL - mR, x - mL))
        if (!off) {
          const from = stopAt
          writeStops(list => [...list.filter(t => Math.abs(t.at - from) > 0.005), { at: nx, kind: which.kind }])
          stopAt = Math.round(nx * 100) / 100
        }
        label = off ? 'Release to remove the tab stop' : `Tab stop ${stopAt.toFixed(2)}″`
      } else if (which === 'mLeft') label = `Left margin ${writeMargin('left', x)}″`
      else if (which === 'mRight') label = `Right margin ${writeMargin('right', pageW - x)}″`
      else if (which === 'left') label = `Left indent ${writeIndent('left', x - mL).toFixed(2)}″`
      else if (which === 'right') label = `Right indent ${writeIndent('right', pageW - mR - x).toFixed(2)}″`
      else label = `First line ${writeIndent('first', x - mL - (para?.left || 0)).toFixed(2)}″`
      setTip({ x: ((ev.clientX - rect.left) / rect.width) * 100, label })
    }
    const up = () => {
      if (typeof which === 'object' && off) writeStops(list => list.filter(t => Math.abs(t.at - stopAt) > 0.005))
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null); setTip(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const nudge = (which, dir, coarse) => {
    const step = (coarse ? MARGIN_STEP : 0.05) * dir
    if (typeof which === 'object') {
      const nx = Math.max(0.06, which.at + step)
      writeStops(list => [...list.filter(t => Math.abs(t.at - which.at) > 0.005), { at: nx, kind: which.kind }])
    } else if (which === 'mLeft') writeMargin('left', mL + step)
    else if (which === 'mRight') writeMargin('right', mR - step)
    else if (which === 'left') writeIndent('left', (para?.left || 0) + step)
    else if (which === 'right') writeIndent('right', (para?.right || 0) - step)
    else writeIndent('first', (para?.first || 0) + step)
  }
  const keys = which => e => {
    if (typeof which === 'object' && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault(); e.stopPropagation()
      writeStops(list => list.filter(t => Math.abs(t.at - which.at) > 0.005))
      return
    }
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!dir) return
    e.preventDefault(); e.stopPropagation()
    nudge(which, dir, e.shiftKey)
  }

  const pctL = pct(mL)
  const pctR = pct(mR)
  const indL = pct(mL + (para?.left || 0))
  const indF = pct(mL + (para?.left || 0) + (para?.first || 0))
  const indR = 100 - pct(mR + (para?.right || 0))
  /* Click the lane (not a handle) to set a stop of the chosen kind. */
  const addStop = e => {
    if (e.target !== e.currentTarget) return
    e.preventDefault()                      // keep the caret in the document
    const bar = barRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / (rect.width / pageW)) * 16) / 16 - mL
    if (x <= 0.05 || x > pageW - mL - mR) return
    e.preventDefault()
    writeStops(list => [...list, { at: x, kind: tabKind }])
  }
  const kind = TAB_KINDS.find(k => k.id === tabKind)
  /* Word's tab glyphs: an upright with a foot to the right (left tab), both
     ways (centre), to the left (right tab). */
  const stopGlyph = k => (
    <span aria-hidden="true" style={{ position: 'relative', width: 9, height: 8, display: 'block' }}>
      <span style={{ position: 'absolute', top: 0, width: 2, height: 8, left: k === 'l' ? 0 : k === 'c' ? 3.5 : 7, background: 'currentColor' }} />
      <span style={{ position: 'absolute', bottom: 0, height: 2, left: 0, width: 9, background: 'currentColor' }} />
    </span>
  )

  const handle = (which, leftPct, label, shape, row) => (
    <button type="button" key={which}
      onMouseDown={e => startDrag(which, e)} onKeyDown={keys(which)}
      title={`${label} — drag, or nudge with ← → (Shift for ¼″)`} aria-label={label}
      style={{
        position: 'absolute', left: `${leftPct}%`, top: row === 'bar' ? 0 : row === 'first' ? 0 : 6,
        transform: 'translateX(-50%)', width: row === 'bar' ? 9 : 11, height: row === 'bar' ? 20 : 6,
        padding: 0, border: 'none', background: 'none', cursor: 'ew-resize',
        color: drag === which ? accent : text3, display: 'flex', justifyContent: 'center', zIndex: 2,
      }}>
      {shape}
    </button>
  )
  const tri = down => <span aria-hidden="true" style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', [down ? 'borderTop' : 'borderBottom']: '6px solid currentColor' }} />
  const edge = <span aria-hidden="true" style={{ width: 2, height: '100%', background: 'currentColor', opacity: 0.6 }} />

  return (
    <div style={{ flexShrink: 0, padding: `4px ${padX}px 0`, background: base, borderBottom: `1px solid ${border}` }}>
      {/* Level with the PAGE, which sits left of centre when the comment
          rail takes the right of the desk. */}
      <div style={{ width: (docW || pg.w) * scale, margin: '0 auto' }}>
      <div style={{ width: pg.w * scale, marginLeft: (pg.x || 0) * scale, position: 'relative' }}>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setTabKind(TAB_KINDS[(TAB_KINDS.findIndex(k => k.id === tabKind) + 1) % TAB_KINDS.length].id)}
          title={`${kind.label} — click to change; click under the ruler to set one`} aria-label={`Tab kind: ${kind.label}`}
          style={{ position: 'absolute', left: -26, top: 0, width: 20, height: 20, padding: 0, border: `1px solid ${border}`, borderRadius: 4, background: raised, color: text3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {stopGlyph(tabKind)}
        </button>
        <div ref={barRef} style={{ position: 'relative', height: 20, background: raised, border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pctL}%`, background: border, opacity: 0.6 }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${pctR}%`, background: border, opacity: 0.6 }} />
          {Array.from({ length: inches * 8 + 1 }, (_, i) => {
            const x = i / 8
            if (x > pageW) return null
            const isInch = i % 8 === 0, isHalf = i % 4 === 0
            if (!isHalf && scale < 0.6) return null
            return <span key={i} aria-hidden="true" style={{ position: 'absolute', bottom: 0, left: `${pct(x)}%`, width: 1, height: isInch ? 8 : isHalf ? 5 : 3, background: text3, opacity: isInch ? 0.85 : 0.5 }} />
          })}
          {/* Numbered from the left MARGIN, as Word does: the margin is 0. */}
          {Array.from({ length: inches * 2 + 1 }, (_, i) => {
            const n = i - Math.floor(mL)
            const x = mL + n
            if (n === 0 || x < 0.15 || x > pageW - 0.15) return null
            return <span key={`n${i}`} aria-hidden="true" style={{ position: 'absolute', top: 2, lineHeight: 1, left: `${pct(x)}%`, transform: 'translateX(-50%)', fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: text3 }}>{Math.abs(n)}</span>
          })}
          {handle('mLeft', pctL, 'Left margin', edge, 'bar')}
          {handle('mRight', 100 - pctR, 'Right margin', edge, 'bar')}
        </div>
        <div onMouseDown={addStop} title="Click to set a tab stop" style={{ position: 'relative', height: 13, cursor: 'copy' }}>
          {(para?.stops || []).map(t => (
            <button type="button" key={`t${t.at}`}
              onMouseDown={e => startDrag(t, e)} onKeyDown={keys(t)}
              title={`${TAB_KINDS.find(k => k.id === t.kind)?.label} at ${t.at}″ — drag to move, drag off to remove`}
              aria-label={`${TAB_KINDS.find(k => k.id === t.kind)?.label} at ${t.at} inches`}
              style={{ position: 'absolute', left: `${pct(mL + t.at)}%`, top: 3, transform: 'translateX(-50%)', width: 11, height: 9, padding: 0, border: 'none', background: 'none', cursor: 'ew-resize', color: drag && drag.at === t.at ? accent : text3, display: 'flex', justifyContent: 'center', zIndex: 2 }}>
              {stopGlyph(t.kind)}
            </button>
          ))}
          {handle('first', indF, 'First-line indent', tri(true), 'first')}
          {handle('left', indL, 'Left indent', <span aria-hidden="true" style={{ width: 9, height: 5, background: 'currentColor', borderRadius: '1px', opacity: 0.8 }} />, 'lane')}
          {handle('right', indR, 'Right indent', tri(false), 'lane')}
          {tip && <span style={{ position: 'absolute', left: `${tip.x}%`, top: -22, transform: 'translateX(8px)', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 3, padding: '1px 6px', borderRadius: 4, background: 'var(--ds-text)', color: 'var(--ds-base)', fontFamily: 'var(--ds-font-mono)', fontSize: 11 }}>{tip.label}</span>}
        </div>
      </div>
      </div>
    </div>
  )
}
