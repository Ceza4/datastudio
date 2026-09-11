'use client'
import { Fragment, useState, useRef, useCallback } from 'react'
import { toPdfSpace, rectToScreen } from '../../lib/pdfspace'
import { localPointFromEvent } from '../../lib/canvasgeom'
import { makeEdit } from '../../lib/pdfs'
import { hitTest } from '../../lib/pdfedits'
import { runAtPoint, fitSize, makeReplaceEdit } from '../../lib/pdfreplace'

/*
  components/notebook/PdfAnnotationLayer.js
  --------------------------------------------------------------------------
  A transparent surface sitting exactly on top of the page canvas. It draws
  the overlay entries and captures the input that creates them.

  EVERY COORDINATE CROSSES THE BOUNDARY EXACTLY ONCE
  Pointer events arrive in screen pixels. They are converted to PDF space here,
  at the edge, and never again. Entries are STORED in PDF space, which is why
  an annotation survives zooming, resizing the block, changing fit mode and a
  rotated page: the point doesn't move, only the matrix that displays it does.

  Rendering goes the other way — stored PDF space out to screen — through the
  same viewport. So a bug in the conversion is visible immediately rather than
  only in the exported file.

  DOM, NOT A SECOND CANVAS
  Annotations are absolutely-positioned divs. A canvas would mean repainting
  everything on every mouse move, re-implementing hit testing, and losing text
  selection and focus for free. At the scale an overlay reaches — tens of
  entries per page, not thousands — the DOM is both faster to build and better
  behaved.
  -------------------------------------------------------------------------- */

export const TOOL_CURSORS = {
  select: 'default',
  whiteout: 'crosshair',
  highlight: 'crosshair',
  text: 'text',
  edittext: 'text',
  ink: 'crosshair',
}

export default function PdfAnnotationLayer({
  viewport, page, edits, tool, colors, accentColor,
  onAdd, onSelect, selectedId, width, height,
  /* The page's editable lines, in PDF space, already merged by
     lib/pdfreplace. NULL means "not read yet" and [] means "read, and this
     page has no text layer" — two states that look identical from here but
     need opposite messages: one is a wait, the other is a scan. */
  textRuns = null,
  /* Reads the page's own background colour from the rendered canvas. Supplied
     by PdfBlock, which owns the canvas; called once, at commit. */
  sampleCover,
}) {
  const [drag, setDrag] = useState(null)          // live rect, screen space
  const [strokePts, setStrokePts] = useState(null) // live freehand, screen space
  const [textAt, setTextAt] = useState(null)      // pending caret, screen space
  const [hoverRun, setHoverRun] = useState(null)  // run under the pointer, edit-text mode
  const [editor, setEditor] = useState(null)      // { run, session } — the open inline editor
  const [draft, setDraft] = useState('')
  const rootRef = useRef(null)
  const draftRef = useRef('')
  /* What a commit reads, rather than the state above.
     ---------------------------------------------------------------
     Clicking a second line while the first is still open produces pointerdown
     THEN blur, from two different renders, both wanting to commit. Reading
     the draft out of a ref — and stamping each editor with a session number —
     means whichever fires first commits the right run, and the other one sees
     a session that has moved on and does nothing. Held in state alone, the
     late blur committed the line the user had only just clicked into and
     silently dropped what they had typed into the previous one. */
  const editRef = useRef(null)
  const sessionRef = useRef(0)

  const { accent, border, text, text3, surface, red, amber, green } = colors

  /* Pointer position in the layer's OWN untransformed pixels.

     `clientX - rect.left` is not enough: the canvas is inside a CSS
     `scale()`, so getBoundingClientRect reports the visually scaled box and
     that subtraction yields SCREEN pixels — while the annotation layer, and
     everything stored in the document, is in layout pixels. At 50% zoom every
     click landed at twice its true distance from the block's corner, which is
     the "starts editing way past my mouse" report. See lib/canvasgeom.js. */
  const localPoint = useCallback(e => localPointFromEvent(rootRef.current, e), [])

  const pageEdits = (edits || []).filter(e => e.page === page)

  /* ── input ────────────────────────────────────────────────────────── */

  function onPointerDown(e) {
    if (e.button !== 0) return
    // Never let a drag on the layer become a drag of the block behind it.
    e.stopPropagation()
    const p = localPoint(e)

    if (tool === 'select') {
      const pdf = toPdfSpace(p, viewport)
      onSelect?.(hitTest(edits, page, pdf)?.id ?? null)
      return
    }

    /* BOTH branches below open an autoFocus input, and both need this.
       Without it the editor opens and shuts inside one click:

         pointerdown on the layer  → React renders the input, autoFocus takes it
         focusin  on the input
         mousedown on the layer    → the DEFAULT focus behaviour of mousedown
         focusout on the input       moves focus back to the layer
                                   → onBlur commits and closes the editor

       preventDefault on pointerdown suppresses the focus shift that mousedown
       would otherwise perform, so the input keeps what autoFocus gave it. It
       also stops the click starting a text selection over the page, which is
       wanted here anyway. Verified against a real browser in
       tests/browser/edittext.spec.mjs — no unit test can see this, because the
       whole failure lives in the event sequence. */
    if (tool === 'text' || tool === 'edittext') e.preventDefault()

    if (tool === 'text') {
      setTextAt(p)
      draftRef.current = ''
      return
    }

    if (tool === 'edittext') {
      // Whatever is open commits before anything else opens, so one click
      // moves from line to line without losing the last one.
      commitEdit()
      const run = runAtPoint(textRuns || [], toPdfSpace(p, viewport))
      if (!run) { setHoverRun(null); return }
      /* A skewed or rotated run can't be covered by an axis-aligned rectangle
         and redrawn horizontally — the replacement would sit straight across
         text that isn't. Refused, and said out loud: on a touch screen this
         click is the first the user hears of it, so the notice is pinned to
         the run rather than left to hover. */
      if (!run.upright) { setHoverRun(run); return }
      openEditor(run)
      return
    }

    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (tool === 'ink') setStrokePts([p])
    else setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }

  function onPointerMove(e) {
    if (tool === 'edittext') {
      if (editor) return                          // the editor covers its own run
      const run = runAtPoint(textRuns || [], toPdfSpace(localPoint(e), viewport))
      /* Same object, same state: React bails out of the re-render. Without
         this a 120Hz pointer re-renders the whole overlay on every sample
         while the hover target hasn't changed at all. */
      setHoverRun(prev => (prev === run ? prev : run))
      return
    }
    if (!drag && !strokePts) return
    const p = localPoint(e)
    if (strokePts) {
      /* Drop points closer than 2px. Freehand at 120Hz produces hundreds of
         near-identical points per stroke, and every one becomes a line segment
         in the exported file. */
      const last = strokePts[strokePts.length - 1]
      if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return
      setStrokePts(pts => [...pts, p])
    } else {
      setDrag(d => ({ ...d, x1: p.x, y1: p.y }))
    }
  }

  function onPointerUp(e) {
    e.currentTarget.releasePointerCapture?.(e.pointerId)

    if (strokePts) {
      if (strokePts.length >= 2) {
        onAdd?.(makeEdit('ink', page, {
          points: strokePts.map(p => toPdfSpace(p, viewport)),
          color: accentColor || accent,
          width: 2,
        }))
      }
      setStrokePts(null)
      return
    }

    if (!drag) return
    const w = Math.abs(drag.x1 - drag.x0)
    const h = Math.abs(drag.y1 - drag.y0)
    setDrag(null)
    // A click, not a drag. Creating a zero-size annotation would leave an
    // invisible entry that can only be removed with undo.
    if (w < 4 || h < 4) return

    const screenRect = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w, h }
    const a = toPdfSpace({ x: screenRect.x, y: screenRect.y }, viewport)
    const b = toPdfSpace({ x: screenRect.x + w, y: screenRect.y + h }, viewport)
    const rect = {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
    }

    if (tool === 'whiteout') {
      onAdd?.(makeEdit('whiteout', page, { rect, color: '#ffffff' }))
    } else if (tool === 'highlight') {
      onAdd?.(makeEdit('highlight', page, { rect, color: '#ffe066', opacity: 0.35 }))
    }
  }

  function commitText() {
    const value = draftRef.current.trim()
    const at = textAt
    setTextAt(null)
    draftRef.current = ''
    if (!value || !at) return

    const size = 12
    /* The click marks where the text should LOOK like it starts — its top-left.
       pdf-lib draws from the baseline, so the anchor moves down by roughly the
       cap height before conversion. Without this every exported line sits a
       line-height above where it was placed. */
    const baselineScreen = { x: at.x, y: at.y + size * 0.8 * (viewport.scale || 1) }
    const pdf = toPdfSpace(baselineScreen, viewport)
    onAdd?.(makeEdit('text', page, { x: pdf.x, y: pdf.y, text: value, size, color: '#000000' }))
  }

  /* ── editing text that is already on the page ─────────────────────── */

  /* What the line says NOW: the newest replacement sitting on it, or the
     document's own words if it hasn't been touched. Reopening a line someone
     has already rewritten has to show their sentence — offering them the
     original again reads as the edit having been lost. */
  function currentTextFor(run) {
    let str = run.str
    for (const e of pageEdits) {
      if (e.kind !== 'replace' || !Number.isFinite(e.x)) continue
      if (Math.abs(e.x - run.x) < 0.01 && Math.abs(e.y - run.baselineY) < 0.01) str = String(e.text ?? '')
    }
    return str
  }

  function openEditor(run) {
    const start = currentTextFor(run)
    sessionRef.current += 1
    /* `base` is what commit compares against, and it is deliberately not
       run.str: on a second pass the question is "did you change anything
       this time", not "does this differ from the imported document". */
    editRef.current = { session: sessionRef.current, run, text: start, base: start }
    setEditor({ session: sessionRef.current, run })
    setDraft(start)
    setHoverRun(null)
  }

  /**
   * Commit whatever the editor holds. `session` identifies the editor a blur
   * came from; a stale one is ignored rather than committing the run that has
   * since taken its place. Called with nothing, it commits whatever is open.
   */
  function commitEdit(session) {
    const cur = editRef.current
    if (!cur) return
    if (session !== undefined && cur.session !== session) return
    editRef.current = null
    setEditor(null)
    setDraft('')

    // Opening a line, reading it and leaving is not an edit. Recording one
    // would put a row in the history that undoes to the same page.
    if (cur.text === cur.base) return

    const cover = sampleCover?.(cur.run.rect)
    onAdd?.(makeReplaceEdit(cur.run, cur.text, page, {
      cover: cover || undefined,
      /* The original glyph colour isn't recoverable from the text layer, so
         it's inferred from the background the replacement sits on: black on
         paper, white on a dark page. Wrong only where the page has dark text
         on a dark ground, which was already unreadable. */
      color: inkOn(cover),
    }))
  }

  function cancelEdit() {
    editRef.current = null
    setEditor(null)
    setDraft('')
  }

  /* Where the replacement will be drawn, and at what size, using the same
     function export uses — so the warning here and the decision there cannot
     disagree about anything except the last fraction of a point. */
  const fit = editor ? fitSize(editor.run, draft) : null
  const fitState = !editor ? null
    : fit === null ? 'nofit'
      : fit < editor.run.size - 0.05 ? 'shrink' : 'ok'
  const fitTone = fitState === 'nofit' ? red : fitState === 'shrink' ? amber : green
  const fitNote = fitState === 'nofit'
    ? 'Too long — this text will not be exported'
    : fitState === 'shrink'
      ? `Shrunk to ${Math.round(fit * 10) / 10}pt to fit`
      : 'Fits'

  /* ── render ───────────────────────────────────────────────────────── */

  const editRect = editor && rectToScreen(editor.run.rect, viewport)
  const hoverRect = tool === 'edittext' && hoverRun && !editor
    ? rectToScreen(hoverRun.rect, viewport)
    : null

  const liveRect = drag && {
    left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0),
  }

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { setDrag(null); setStrokePts(null) }}
      onPointerLeave={() => setHoverRun(null)}
      style={{
        position: 'absolute', inset: 0, width, height,
        cursor: TOOL_CURSORS[tool] || 'default',
        /* In select mode the layer must not swallow text selection on the
           page beneath it — that's the one interaction the canvas owns. */
        pointerEvents: tool === 'select' && !pageEdits.length ? 'none' : 'auto',
        touchAction: 'none',
      }}>

      {/* committed entries.

          Every branch checks the fields it needs before reading them. An
          overlay is untrusted input: it can come from a newer build with a
          kind this version doesn't know, from a partial write, or from an
          edit whose payload was never valid. The export path already skipped
          malformed entries; the RENDER path didn't, so one rectangle with no
          `rect` threw and replaced the whole block with an error card. */}
      {pageEdits.map(edit => {
        const on = edit.id === selectedId
        if (edit.kind === 'whiteout' || edit.kind === 'highlight') {
          if (!edit.rect) return null
          const r = rectToScreen(edit.rect, viewport)
          return (
            <div key={edit.id}
              style={{
                position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
                background: edit.kind === 'whiteout' ? (edit.color || '#fff') : (edit.color || '#ffe066'),
                opacity: edit.kind === 'highlight' ? (edit.opacity ?? 0.35) : 1,
                outline: on ? `2px solid ${accent}` : 'none',
                outlineOffset: 1,
                pointerEvents: 'none',
              }} />
          )
        }
        if (edit.kind === 'text') {
          if (!edit.text || !Number.isFinite(edit.x) || !Number.isFinite(edit.y)) return null
          const p = rectToScreen({ x: edit.x, y: edit.y, w: 0, h: 0 }, viewport)
          const size = (edit.size || 12) * (viewport.scale || 1)
          return (
            <div key={edit.id}
              style={{
                position: 'absolute', left: p.x, top: p.y - size * 0.8,
                color: edit.color || '#000',
                /* NOT a token, and not an oversight. pdf-lib embeds this run as
                   base-14 Helvetica on export, so the on-screen preview has to
                   be Helvetica too or the overlay and the exported PDF
                   disagree about where every glyph sits. Leave it. */
                fontFamily: 'Helvetica, Arial, sans-serif',
                fontSize: size, lineHeight: 1.2, whiteSpace: 'pre',
                outline: on ? `2px solid ${accent}` : 'none',
                pointerEvents: 'none',
              }}>
              {edit.text}
            </div>
          )
        }
        if (edit.kind === 'replace') {
          if (!edit.rect || !Number.isFinite(edit.x) || !Number.isFinite(edit.y)) return null
          const r = rectToScreen(edit.rect, viewport)
          const p = rectToScreen({ x: edit.x, y: edit.y, w: 0, h: 0 }, viewport)
          /* Preview what export will actually do, not what was typed. Export
             measures with the real font and DROPS text that still doesn't fit
             at the floor, leaving the cover behind — so showing the text here
             regardless would be a lie the user only finds in the saved file.
             The dashed edge is the marker for that case. */
          const fitted = fitSize({ rect: edit.rect, size: edit.size || 12 }, edit.text)
          const size = (fitted || edit.size || 12) * (viewport.scale || 1)
          return (
            <Fragment key={edit.id}>
              <div style={{
                position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
                background: edit.cover || '#ffffff',
                outline: on ? `2px solid ${accent}` : 'none',
                outlineOffset: 1,
                boxShadow: fitted === null ? `inset 0 0 0 1px ${red}` : 'none',
                pointerEvents: 'none',
              }} />
              {!!edit.text && fitted !== null && (
                <div style={{
                  position: 'absolute', left: p.x, top: p.y - size * 0.8,
                  color: edit.color || '#000',
                  fontFamily: 'Helvetica, Arial, sans-serif',
                  fontSize: size, lineHeight: 1.2, whiteSpace: 'pre',
                  pointerEvents: 'none',
                }}>
                  {edit.text}
                </div>
              )}
            </Fragment>
          )
        }
        if (edit.kind === 'ink') {
          const pts = (edit.points || [])
            .filter(pt => Number.isFinite(pt?.x) && Number.isFinite(pt?.y))
            .map(pt => rectToScreen({ x: pt.x, y: pt.y, w: 0, h: 0 }, viewport))
          if (pts.length < 2) return null
          return (
            <svg key={edit.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
              <polyline
                points={pts.map(pt => `${pt.x},${pt.y}`).join(' ')}
                fill="none"
                stroke={edit.color || accent}
                strokeWidth={(edit.width || 2) * (viewport.scale || 1)}
                strokeLinecap="round" strokeLinejoin="round"
                opacity={on ? 0.7 : 1}
              />
            </svg>
          )
        }
        return null
      })}

      {/* live drag preview */}
      {liveRect && (
        <div style={{
          position: 'absolute', ...liveRect,
          background: tool === 'whiteout' ? 'rgba(255,255,255,0.85)' : 'rgba(255,224,102,0.35)',
          border: `1px dashed ${accent}`, pointerEvents: 'none',
        }} />
      )}

      {strokePts?.length > 1 && (
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <polyline points={strokePts.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke={accentColor || accent} strokeWidth={2 * (viewport.scale || 1)}
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}

      {/* the line under the pointer, before it is opened */}
      {hoverRect && (
        <>
          <div style={{
            position: 'absolute', left: hoverRect.x, top: hoverRect.y,
            width: hoverRect.w, height: hoverRect.h,
            background: `${hoverRun.upright ? accent : red}1f`,
            border: `1px solid ${hoverRun.upright ? accent : red}`,
            borderRadius: 4, pointerEvents: 'none',
          }} />
          {!hoverRun.upright && (
            <div style={{
              position: 'absolute', left: hoverRect.x,
              top: Math.max(0, hoverRect.y - 17),
              padding: '2px 6px', borderRadius: 4,
              background: surface, border: `1px solid ${red}`, color: red,
              fontFamily: 'var(--ds-font-mono)', fontSize: 11, whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}>
              Rotated text — can’t be rewritten
            </div>
          )}
        </>
      )}

      {/* rewriting a line, in place */}
      {editor && editRect && (
        <>
          <input
            key={editor.session}
            autoFocus
            value={draft}
            onChange={e => {
              setDraft(e.target.value)
              if (editRef.current) editRef.current.text = e.target.value
            }}
            onBlur={() => commitEdit(editor.session)}
            onKeyDown={e => {
              e.stopPropagation()
              /* Shift+Enter commits too. A replacement occupies one line by
                 definition — a newline here would be silently dropped at
                 export, which is worse than not accepting it. */
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(editor.session) }
              else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
            }}
            onPointerDown={e => e.stopPropagation()}
            style={{
              position: 'absolute', left: editRect.x, top: editRect.y,
              width: Math.max(editRect.w + 28, 96), height: editRect.h,
              boxSizing: 'border-box', padding: '0 3px',
              font: `${editor.run.size * (viewport.scale || 1)}px Helvetica, Arial, sans-serif`,
              color: text, background: surface,
              border: `1px solid ${fitState === 'nofit' ? red : accent}`,
              borderRadius: 4, outline: 'none',
            }} />

          {/* Whether it will fit has to be answerable before Enter, not after
              export — by then the file is saved and the line is gone. */}
          <div style={{
            position: 'absolute', left: editRect.x,
            top: editRect.y + editRect.h + 20 > height
              ? Math.max(0, editRect.y - 18)
              : editRect.y + editRect.h + 4,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '2px 6px', borderRadius: 4,
            background: surface, border: `1px solid ${fitState === 'nofit' ? red : border}`,
            fontFamily: 'var(--ds-font-mono)', fontSize: 11, whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: fitTone, flexShrink: 0 }} />
            <span style={{ color: fitState === 'nofit' ? red : text3 }}>{fitNote}</span>
            <span style={{ color: text3, opacity: 0.7 }}>· Enter saves · Esc cancels</span>
          </div>
        </>
      )}

      {/* text entry, in place */}
      {textAt && (
        <input
          autoFocus
          defaultValue=""
          onChange={e => { draftRef.current = e.target.value }}
          onBlur={commitText}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            else if (e.key === 'Escape') { e.preventDefault(); draftRef.current = ''; setTextAt(null) }
          }}
          onPointerDown={e => e.stopPropagation()}
          placeholder="Type, then Enter"
          style={{
            position: 'absolute', left: textAt.x, top: textAt.y,
            minWidth: 140, padding: '2px 4px',
            font: `${12 * (viewport.scale || 1)}px Helvetica, Arial, sans-serif`,
            color: '#000', background: 'rgba(255,255,255,0.95)',
            border: `1px solid ${accent}`, borderRadius: 4, outline: 'none',
          }} />
      )}

      {/* An empty page in an annotation tool with no visible affordance reads
          as broken. One line, only while a drawing tool is armed. */}
      {tool !== 'select' && !pageEdits.length && !drag && !strokePts && !textAt && !editor && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 8, textAlign: 'center',
          fontSize: 11, color: text3, fontFamily: 'var(--ds-font-body)',
          pointerEvents: 'none', textShadow: '0 1px 3px rgba(255,255,255,0.9)',
        }}>
          {tool === 'text' ? 'Click where the text should go'
            : tool !== 'edittext' ? 'Drag on the page'
              /* A scan has no text layer, so nothing here is clickable and the
                 tool looks broken. Saying which of the two silences this is —
                 still reading, or nothing to read — costs one line. */
              : textRuns === null ? 'Reading this page’s text…'
                : textRuns.length ? 'Click a line of text to rewrite it'
                  : 'No text layer on this page — nothing to edit'}
        </div>
      )}
    </div>
  )
}

/**
 * Ink colour for a replacement, given the background it will sit on.
 *
 * These are STORED values written into the edit, not styling — the document
 * has no theme and a replacement drawn in the app's accent would be a
 * different colour in someone else's viewer. Black unless the sampled page is
 * genuinely dark, in which case black would be invisible.
 */
function inkOn(cover) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(cover || ''))
  if (!m) return '#000000'
  const n = parseInt(m[1], 16)
  // Rec. 601 luma — close enough to perceived brightness for a binary choice.
  const luma = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000
  return luma < 110 ? '#ffffff' : '#000000'
}
