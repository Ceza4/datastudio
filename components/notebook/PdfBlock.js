'use client'
import { useState, useEffect, useRef, useCallback, memo } from 'react'
import Icon from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { getPdf, formatPdfSize } from '../../lib/pdfs'
import { openDocument, closeDocument, pageGeometry, renderPage, documentInfo, translateError, pageTextItems } from '../../lib/pdfdoc'
import { fitScale, clampScale, canvasSizeFor, rectToScreen, MIN_SCALE, MAX_SCALE } from '../../lib/pdfspace'
import { editableRuns, mergeRunsIntoLines } from '../../lib/pdfreplace'
import { putPdfEdits, revertPdf } from '../../lib/pdfs'
import { applyEdits, editedFilename, hasEdits } from '../../lib/pdfexport'
import PdfAnnotationLayer from './PdfAnnotationLayer'
import * as H from '../../lib/pdfedits'
import { createRenderQueue } from '../../lib/renderqueue'
import { localSize } from '../../lib/canvasgeom'
import PdfExtractPanel from '../tools/PdfExtractPanel'

/*
  components/notebook/PdfBlock.js
  --------------------------------------------------------------------------
  Stage 1: open a PDF and read it.

  LAZY RENDERING IS THE WHOLE DESIGN
  A naive viewer mounts one <canvas> per page. At A4 and 1.5× that's about
  6MB of backing store per page, so a 200-page report is over a gigabyte of
  canvas and the tab dies before the first page paints.

  Instead: one canvas, showing the current page, plus a small render-ahead of
  its immediate neighbours into an off-screen cache. Memory is constant
  regardless of document length, and paging feels instant because the next
  page is usually already drawn.

  RENDER TASKS ARE CANCELLED, NOT ABANDONED
  Holding the next-page key starts renders faster than they complete. An
  abandoned pdf.js RenderTask keeps painting into a canvas that has since been
  reused for a different page — which looks like pages bleeding into each
  other. Every new render cancels the one in flight first.

  WHAT'S NOT HERE YET
  Annotation, editing and extraction (stages 2–4). The toolbar rail advertises
  them as SOON rather than hiding them, so the block reads as a roadmap
  instead of as a dead end.
  -------------------------------------------------------------------------- */

const RENDER_AHEAD = 1          // pages either side to pre-draw
const CACHE_LIMIT = 5           // rendered bitmaps kept in memory
const RUNS_CACHE_LIMIT = 8      // pages whose text layer is kept parsed

/* ── the colour a replacement is painted over ─────────────────────────
   White is the obvious answer and it is wrong on most real documents. Scans
   are cream, letterheads are tinted, and a white rectangle on any of them is
   the artefact that says "this file has been edited" from across the room.

   The page is already rendered, so the right colour is available: read it off
   the canvas, just OUTSIDE the run's box — above and below, where there is
   page but no glyph. The most common value wins, which discards the few
   samples that land on a descender from the line above or on an
   anti-aliased edge, without needing to know which those are.

   Note the two coordinate hops. rectToScreen gives CSS pixels; the canvas
   backing store is devicePixelRatio times bigger (and capped, see
   canvasSizeFor), so the ratio is derived from the canvas itself rather than
   assumed to be window.devicePixelRatio. */
const COVER_FALLBACK = '#ffffff'
const COVER_SAMPLES = 12        // per band, evenly spaced across the run

export function samplePageColor(canvas, viewport, pdfRect) {
  if (!canvas || !viewport || !pdfRect) return COVER_FALLBACK
  const cw = canvas.width
  const ch = canvas.height
  // Not yet drawn, or zero-sized: there is nothing to read, and guessing from
  // an empty canvas would return transparent black — the worst possible cover.
  if (!(cw > 0) || !(ch > 0) || !(viewport.width > 0)) return COVER_FALLBACK

  try {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return COVER_FALLBACK

    const ratio = cw / viewport.width
    const r = rectToScreen(pdfRect, viewport)
    const x0 = Math.round(r.x * ratio)
    const y0 = Math.round(r.y * ratio)
    const w = Math.round(r.w * ratio)
    const h = Math.round(r.h * ratio)
    /* Two device pixels clear of the box. Closer catches the glyph's own
       anti-aliasing; much further lands on the next line of text. */
    const gap = Math.max(1, Math.round(2 * ratio))

    const sx = Math.min(Math.max(0, x0), cw - 1)
    const sw = Math.max(1, Math.min(w, cw - sx))

    const counts = new Map()
    /* Two rows on each side, not one. A single row can be swallowed whole by
       the descenders of the line above, or by a ruled line, and then the
       "most common value" is the wrong colour with a clear majority. Four
       rows can't all be. */
    for (const y of [y0 - gap, y0 - gap * 2, y0 + h + gap, y0 + h + gap * 2]) {
      if (y < 0 || y >= ch) continue                  // a run against the page edge
      const px = ctx.getImageData(sx, y, sw, 1).data
      const step = Math.max(1, Math.floor(sw / COVER_SAMPLES))
      // Start half a step in: the box's left edge is usually the first
      // glyph's stem, and its right edge the last one's.
      for (let i = step >> 1; i < sw; i += step) {
        const k = (px[i * 4] << 16) | (px[i * 4 + 1] << 8) | px[i * 4 + 2]
        counts.set(k, (counts.get(k) || 0) + 1)
      }
    }

    let best = null
    let bestN = 0
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n }
    if (best === null) return COVER_FALLBACK
    return `#${best.toString(16).padStart(6, '0')}`
  } catch {
    /* getImageData throws on a tainted canvas. pdf.js paints from bytes we
       own so it shouldn't happen — but an unreadable canvas must degrade to a
       plain white cover, never take the edit down with it. */
    return COVER_FALLBACK
  }
}


/* memo, because this component is a child of NotebookCanvas and NotebookCanvas
   re-renders on every frame of a pan or a zoom. Without it, dragging the canvas
   re-rendered every block on screen sixty times a second; with it, React bails
   out at this boundary and the frame costs nothing but the transform.

   A plain shallow compare is enough because every prop it receives is stable by
   construction: `colors` is one of two frozen module objects (lib/theme.js),
   handlers are cached per block id by blockCb() in NotebookCanvas, and `block`
   only changes identity when the block actually changes. */
function PdfBlockInner({ block, colors, dark, onUpdateBlock, isSelected, tool = 'select', onEditState, onExtract }) {
  const { surface, raised, border, text, text2, text3, accent, accentText, red } = colors
  const toast = useToast()

  const [status, setStatus] = useState('idle')     // idle | loading | ready | error
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [pageNum, setPageNum] = useState(block.pdfPage || 1)
  const [fitMode, setFitMode] = useState(block.pdfFit || 'width')
  const [scale, setScale] = useState(1)
  const [rendering, setRendering] = useState(false)
  /* Set the first time a render task actually completes. Its only job is to
     tell "we never tried to paint" apart from "we painted and you still can't
     see anything" — which is precisely the distinction that was missing when
     stage 1 came back as a blank page with no error. */
  const [painted, setPainted] = useState(false)

  /* The overlay, plus its undo history. Held here rather than in the parent
     because it belongs to this document — two PDF blocks showing the same file
     each get their own working history, and only the committed overlay is
     shared through storage. */
  const [history, setHistory] = useState(() => H.createHistory([]))
  const [selectedEditId, setSelectedEditId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [extractItems, setExtractItems] = useState(null)   // null = panel closed
  /* The current page's editable lines. NULL means "not read yet"; [] means
     "read, and there is no text layer" — the annotation layer says something
     different for each, because on a scan the second one is the whole answer. */
  const [textRuns, setTextRuns] = useState(null)
  const edits = H.current(history)
  const bytesRef = useRef(null)

  const docRef = useRef(null)
  const canvasRef = useRef(null)
  const viewportRef = useRef(null)
  /* One queue per block. Declared with the refs because the open effect's
     cleanup invalidates it. */
  const queueRef = useRef(null)
  if (!queueRef.current) queueRef.current = createRenderQueue()
  const queue = queueRef.current
  const cacheRef = useRef(new Map())
  /* Parsed text layers, by page. Editing text hit-tests against these on every
     pointer move, so re-parsing on each page flip would be felt. */
  const runsCacheRef = useRef(new Map())
  const wrapRef = useRef(null)
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 })

  /* ── open ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    const pdfId = block.pdfId
    /* Read here rather than in the cleanup: the ref object is created once and
       never reassigned, so this is the same Map either way — but reading a ref
       during teardown is the pattern that goes wrong when it isn't, and the
       linter is right to say so. */
    const runsCache = runsCacheRef.current
    if (!pdfId) { setStatus('idle'); return }

    setStatus('loading'); setError(null); setPainted(false)
    ;(async () => {
      try {
        const rec = await getPdf(pdfId)
        if (cancelled) return
        if (!rec?.bytes) throw new Error('This document’s data is no longer in storage. It may have been cleared.')

        const doc = await openDocument(rec.bytes)
        if (cancelled) { closeDocument(doc); return }

        docRef.current = doc
        /* Kept for export. openDocument copies before handing bytes to the
           worker, so this reference stays valid rather than being detached. */
        bytesRef.current = rec.bytes
        setHistory(H.createHistory(rec.edits || []))
        const meta = await documentInfo(doc)
        if (cancelled) return
        setInfo({ ...meta, name: rec.name, size: rec.size, encrypted: rec.encrypted, pdfVersion: rec.pdfVersion })
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(translateError(err).message)
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      /* Invalidate anything queued or running, so a draw that resumes after
         this teardown can't call setState on an unmounted component. */
      queue.cancelAll()
      cacheRef.current.clear()
      runsCache.clear()
      /* Freeing the worker port matters: every open document holds one, and a
         workspace where PDF blocks have come and gone will eventually fail to
         open anything at all. */
      if (docRef.current) { closeDocument(docRef.current); docRef.current = null }
    }
  }, [block.pdfId])

  /* ── measure the container ──────────────────────────────────────────
     A CALLBACK ref, not a ref object plus a mount effect.

     This is where stage 1 shipped broken and it's worth keeping the reason
     written down. The observer used to be attached in a useEffect with []
     deps. At mount `status` is 'loading', so the component returns the Shell
     — which doesn't contain this node. `wrapRef.current` was therefore null,
     the effect bailed, and because its deps were empty it never ran again
     once the real markup appeared. wrapSize stayed { w: 0, h: 0 }, draw()'s
     `if (!wrapSize.w) return` guard fired on every call, and the canvas was
     never painted: a blank page with nothing thrown and nothing logged.

     A callback ref fires exactly when the node attaches and detaches, so it
     cannot be desynchronised from conditional rendering — including any new
     early-return added later, which is what would break the deps-array fix
     all over again. */
  const roRef = useRef(null)

  const attachWrap = useCallback(node => {
    roRef.current?.disconnect()
    roRef.current = null
    wrapRef.current = node
    if (!node) return

    /* Measure synchronously as well as observing. ResizeObserver delivers its
       first entry on a later frame, so without this the first page waits a
       frame for a size that's already readable. */
    /* Only update when the numbers actually change. A fresh { w, h } object
       is never Object.is-equal to the last one, so React would re-render — and
       therefore re-draw — on every observer callback, including the ones that
       report an identical size. That churn is what made the render collision
       easy to hit in the first place. */
    const measure = (w, h) => setWrapSize(prev => (
      prev.w === w && prev.h === h ? prev : { w, h }
    ))

    /* offsetWidth, NOT getBoundingClientRect. The canvas is inside a
       `scale()`, so the bounding rect reports the VISUALLY scaled size — at
       40% zoom a 520px container measures 208px, fit-to-width then computes a
       scale for a box less than half the real one, and the page renders tiny.
       offsetWidth is layout pixels and ignores transforms entirely.

       The ResizeObserver path below was already correct by accident:
       contentRect is also reported in layout pixels. */
    const sz = localSize(node)
    if (sz.w > 0) measure(sz.w, sz.h)

    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      if (box?.width > 0) measure(Math.floor(box.width), Math.floor(box.height))
    })
    ro.observe(node)
    roRef.current = ro
  }, [])

  useEffect(() => () => roRef.current?.disconnect(), [])

  const totalPages = info?.pages || 0
  const safePage = Math.min(Math.max(1, pageNum), Math.max(1, totalPages))

  /* ── render ───────────────────────────────────────────────────────── */

  const drawNow = useCallback(async (n, ctx, opts = {}) => {
    const doc = docRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas) return

    /* Never gate rendering on having a measurement.

       The previous version returned early when wrapSize.w was 0, which is how
       a measurement bug became an invisible one — no page, no error, no clue.
       A width of 0 is a layout question, and the worst possible answer to it
       is "draw nothing". Fall back to the block's own width, which is always
       known, and let the observer refine it a frame later. */
    const boxW = wrapSize.w || (block.w || 520) - 18
    const boxH = wrapSize.h || (block.h || 620) - 80

    if (!opts.silent) setRendering(true)

    try {
      const base = await pageGeometry(doc, n, 1)
      if (!ctx.isCurrent()) return
      const auto = fitScale(base.viewport.width, base.viewport.height, boxW - 2, boxH - 2, fitMode)
      const s = clampScale(fitMode === 'actual' ? scale : auto)
      const { page, viewport } = await pageGeometry(doc, n, s)
      viewportRef.current = viewport

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const size = canvasSizeFor(viewport, dpr)

      canvas.width = size.width
      canvas.height = size.height
      canvas.style.width = `${Math.round(viewport.width)}px`
      canvas.style.height = `${Math.round(viewport.height)}px`

      const task = renderPage(page, canvas, viewport, size.ratio)
      ctx.track(task)
      await task.promise
      ctx.untrack(task)
      if (!ctx.isCurrent()) return
      setPainted(true)

      // Bounded LRU — the oldest entry goes once the cap is reached.
      const cache = cacheRef.current
      cache.set(n, true)
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
    } catch (err) {
      // A cancelled render is the normal result of paging quickly, not a fault.
      if (err?.name !== 'RenderingCancelledException') {
        setError(translateError(err).message)
        setStatus('error')
      }
    } finally {
      if (!opts.silent) setRendering(false)
    }
  }, [wrapSize.w, wrapSize.h, fitMode, scale, block.w, block.h])

  /* Renders are serialised through lib/renderqueue.js — see that file for why
     a "current task" ref isn't sufficient. */
  const draw = useCallback((n, opts = {}) => queue.run(ctx => drawNow(n, ctx, opts)), [drawNow, queue])

  useEffect(() => {
    if (status !== 'ready') return
    draw(safePage)
  }, [status, safePage, draw])

  /* Warm the neighbours after the visible page has painted, so paging feels
     instant. Silent, and deliberately after a beat — doing it eagerly makes
     the page you actually asked for wait behind ones you didn't. */
  useEffect(() => {
    if (status !== 'ready' || rendering) return
    const t = setTimeout(() => {
      for (let d = 1; d <= RENDER_AHEAD; d++) {
        for (const n of [safePage + d, safePage - d]) {
          if (n >= 1 && n <= totalPages && !cacheRef.current.has(n)) {
            docRef.current?.getPage(n).catch(() => {})   // parse ahead; paint stays on demand
          }
        }
      }
    }, 180)
    return () => clearTimeout(t)
  }, [status, rendering, safePage, totalPages])

  /* ── the page's editable lines ────────────────────────────────────────
     Only fetched while the Edit text tool is armed. Reading the text layer
     parses the page's content stream, and someone who opened a document to
     read it should not pay for a tool they have not picked up. */
  useEffect(() => {
    const doc = docRef.current
    if (status !== 'ready' || tool !== 'edittext' || !doc) { setTextRuns(null); return }

    const cached = runsCacheRef.current.get(safePage)
    if (cached) { setTextRuns(cached); return }

    let cancelled = false
    setTextRuns(null)
    ;(async () => {
      try {
        const items = await pageTextItems(doc, safePage)
        if (cancelled) return
        /* Merged into lines before anything sees them: pdf.js splits a visual
           line at every font and kerning change, and editing one of those
           fragments gives you three characters out of a sentence. */
        const lines = mergeRunsIntoLines(editableRuns(items))
        const cache = runsCacheRef.current
        cache.set(safePage, lines)
        if (cache.size > RUNS_CACHE_LIMIT) cache.delete(cache.keys().next().value)
        setTextRuns(lines)
      } catch {
        /* An unreadable text layer is not a broken document — the page still
           renders, it just can't be edited here. Reported as "no text" rather
           than replacing the block with an error card. */
        if (!cancelled) setTextRuns([])
      }
    })()

    /* Paging while a parse is in flight would otherwise hand the previous
       page's lines to the new page, and every hit test would then land on
       text that isn't there. Same cancellation rule as the render queue. */
    return () => { cancelled = true }
  }, [status, tool, safePage])

  /* Reads the page's own background from the rendered canvas, so a
     replacement is covered in the colour that was already there. Handed to
     the annotation layer because the canvas lives here. */
  const sampleCover = useCallback(
    rect => samplePageColor(canvasRef.current, viewportRef.current, rect),
    [])

  /* ── persist view state ───────────────────────────────────────────── */
  useEffect(() => {
    if (status !== 'ready') return
    if (block.pdfPage === safePage && block.pdfFit === fitMode) return
    onUpdateBlock?.(block.id, { pdfPage: safePage, pdfFit: fitMode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, fitMode, status])

  /* ── overlay operations ───────────────────────────────────────────
     Every mutation goes through commit(), so undo is always available and no
     operation has to know how to reverse itself. */

  /* Only complain once per block. A failing store fails on every stroke, and
     a toast per annotation is a worse experience than the silence it
     replaces. */
  const annotWarnedRef = useRef(false)

  const persist = useCallback(next => {
    if (!block.pdfId) return
    /* Written straight to the pdfs store, NOT into the workspace snapshot.
       Keeping the overlay next to the bytes means annotating a document
       doesn't touch the notebook autosave at all.

       WHICH IS ALSO WHY THIS HAS TO REPORT ITS OWN FAILURES.

       This was `.catch(() => {})`. Because annotations bypass the workspace
       snapshot they never reach saveState, so they never reach the "Not
       saving" banner either — a full disk or an aborted transaction threw
       away an afternoon of markup with no toast, no banner and no console
       line. Meanwhile setHistory updated regardless, so the annotation sat
       there on screen looking saved.

       This is the exact failure lib/persistence.js was rewritten to kill
       ("the catch logged a console.warn nobody sees, and the user kept
       working on a workspace that had stopped saving"), reintroduced in a
       sibling module.

       putPdfEdits also resolves null when the record is missing, which is its
       own quiet loss — a resolved promise that saved nothing. Both are
       reported. */
    Promise.resolve(putPdfEdits(block.pdfId, next))
      .then(rev => {
        if (rev != null || annotWarnedRef.current) return
        annotWarnedRef.current = true
        toast('This PDF is no longer in local storage, so annotations are not being saved.', { tone: 'error', duration: Infinity })
      })
      .catch(err => {
        if (annotWarnedRef.current) return
        annotWarnedRef.current = true
        toast(`Annotations are not being saved: ${err?.message || 'unknown error'}`, { tone: 'error', duration: Infinity })
      })
  }, [block.pdfId, toast])

  const applyChange = useCallback(next => {
    setHistory(h => {
      const committed = H.commit(h, next)
      persist(next)
      return committed
    })
  }, [persist])

  const addAnnotation = useCallback(edit => {
    applyChange(H.addEdit(H.current(history), edit))
  }, [history, applyChange])

  const deleteSelected = useCallback(() => {
    if (!selectedEditId) return
    applyChange(H.removeEdit(H.current(history), selectedEditId))
    setSelectedEditId(null)
  }, [history, selectedEditId, applyChange])

  const doUndo = useCallback(() => {
    setHistory(h => {
      if (!H.canUndo(h)) return h
      const next = H.undo(h)
      persist(H.current(next))
      return next
    })
    setSelectedEditId(null)
  }, [persist])

  const doRedo = useCallback(() => {
    setHistory(h => {
      if (!H.canRedo(h)) return h
      const next = H.redo(h)
      persist(H.current(next))
      return next
    })
  }, [persist])

  /* Revert never needed a warning — the source bytes are untouched and always
     were, so the dialog was reassuring the user about a danger that did not
     exist. What it does need is a way back, because the overlay it throws away
     can be an afternoon's work.

     applyChange is exactly the right undo: it commits the old array as a new
     history step AND persists it, so the edits come back on screen and in the
     store together. */
  const doRevert = useCallback(async () => {
    if (!edits.length) return
    const discarded = edits
    await revertPdf(block.pdfId)
    setHistory(h => H.commit(h, []))
    setSelectedEditId(null)
    toast(`${discarded.length} edit${discarded.length > 1 ? 's' : ''} discarded`, {
      undo: () => applyChange(discarded),
    })
  }, [edits, block.pdfId, applyChange, toast])

  const doExport = useCallback(async () => {
    if (!bytesRef.current) return
    setExporting(true)
    try {
      const out = await applyEdits(bytesRef.current, edits)
      const blob = new Blob([out], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = editedFilename(info?.name || block.name)
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoked on a later tick — revoking immediately cancels the download
      // in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setError(`Export failed: ${err?.message || 'unknown error'}`)
    } finally {
      setExporting(false)
    }
  }, [edits, info, block.name])

  /* Extraction reads the CURRENT page's text runs on demand. Doing it for
     every page up front would parse a 200-page document to answer a question
     nobody asked.

     DECLARED ABOVE the effect below, and it has to be. That effect lists
     openExtract in its dependency array, and a dependency array is evaluated
     during render at the point the useEffect call runs. A `const` declared
     further down is still in its temporal dead zone at that moment, so the
     whole component threw "Cannot access 'openExtract' before initialization"
     on its first render — which the error boundary then caught, making it look
     like a PDF problem rather than an ordering one. */
  const openExtract = useCallback(async () => {
    if (!docRef.current) return
    try {
      const items = await pageTextItems(docRef.current, safePage)
      setExtractItems(items)
    } catch (err) {
      setError(`Could not read this page's text: ${err?.message || 'unknown error'}`)
    }
  }, [safePage])

  /* Report upward so the rail can enable Undo/Redo/Revert/Export without
     duplicating any of this state. */
  useEffect(() => {
    onEditState?.({
      count: edits.length,
      canUndo: H.canUndo(history),
      canRedo: H.canRedo(history),
      exporting,
      summary: H.describeEdits(edits),
      undo: doUndo, redo: doRedo, revert: doRevert, export: doExport, extract: openExtract,
      deleteSelected, hasSelection: !!selectedEditId,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, exporting, selectedEditId, openExtract])

  const go = d => setPageNum(p => Math.min(Math.max(1, p + d), Math.max(1, totalPages)))

  /* Keys only act while this block owns focus — the canvas has its own
     tabIndex, so arrows here can't fight the canvas's block navigation. */
  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault(); e.stopPropagation()
      e.shiftKey ? doRedo() : doUndo()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); doRedo(); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEditId) {
      e.preventDefault(); e.stopPropagation(); deleteSelected(); return
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); go(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); go(-1) }
    else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); setPageNum(1) }
    else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); setPageNum(totalPages) }
  }

  /* ── states ───────────────────────────────────────────────────────── */

  if (!block.pdfId) {
    return (
      <Shell colors={colors}>
        <Icon name="block-pdf" size={30} style={{ opacity: 0.4 }} />
        <div style={{ fontSize: 12.5, color: text2, fontWeight: 600 }}>No document</div>
        <div style={{ fontSize: 11, color: text2, lineHeight: 1.5, maxWidth: 240 }}>
          Import a PDF from the sidebar, or drop one onto the canvas.
        </div>
      </Shell>
    )
  }

  if (status === 'error') {
    return (
      <Shell colors={colors}>
        <Icon name="status-error" size={22} style={{ color: red }} />
        <div style={{ fontSize: 12.5, color: red, fontWeight: 600 }}>Couldn’t open this PDF</div>
        <div style={{ fontSize: 11, color: text2, lineHeight: 1.55, maxWidth: 300 }}>{error}</div>
      </Shell>
    )
  }

  if (status !== 'ready') {
    return (
      <Shell colors={colors}>
        <Icon name="status-spinner" size={20} style={{ color: accentText }} />
        <div style={{ fontSize: 11.5, color: text3 }}>Opening document…</div>
      </Shell>
    )
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: surface }}
      onKeyDown={onKeyDown}
      onMouseDown={e => e.stopPropagation()}
    >
      {extractItems && (
        <PdfExtractPanel
          items={extractItems}
          pageNumber={safePage}
          pdfName={info?.name || block.name}
          colors={colors}
          onClose={() => setExtractItems(null)}
          onExtract={payload => {
            setExtractItems(null)
            onExtract?.({
              ...payload,
              /* Provenance travels with the block. Clicking the chip on the
                 result teleports back to the page it came from. */
              source: { type: 'pdf', pdfId: block.pdfId, page: safePage, bbox: payload.bbox || null },
              sourceName: info?.name || block.name || 'PDF',
            })
          }}
        />
      )}

      {/* ── page rail ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px',
        borderBottom: `1px solid ${border}`, background: raised, flexShrink: 0,
        fontFamily: 'var(--ds-font-body)',
      }}>
        <NavBtn label="Previous page" icon="nav-chevron-right" flip disabled={safePage <= 1}
          onClick={() => go(-1)} colors={colors} />

        <span style={{
          fontFamily: 'var(--ds-font-mono)', fontSize: 10.5, color: text2,
          minWidth: 62, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
        }}>
          {safePage} / {totalPages}
        </span>

        <NavBtn label="Next page" icon="nav-chevron-right" disabled={safePage >= totalPages}
          onClick={() => go(1)} colors={colors} />

        <div style={{ width: 1, height: 16, background: border, margin: '0 3px' }} />

        {[['width', 'size-fit', 'Fit width'], ['page', 'size-fit-screen', 'Fit page'], ['actual', 'size-reset', 'Actual size']]
          .map(([mode, icon, label]) => (
            <button key={mode} onClick={() => { setFitMode(mode); if (mode === 'actual') setScale(1) }}
              title={label} aria-label={label} aria-pressed={fitMode === mode}
              style={{
                display: 'flex', alignItems: 'center', padding: '3px 5px', borderRadius: 5,
                border: '1px solid transparent', cursor: 'pointer',
                background: fitMode === mode ? 'var(--ds-accent-dim)' : 'transparent',
                color: fitMode === mode ? accent : text3,
              }}>
              <Icon name={icon} size={12} />
            </button>
          ))}

        {fitMode === 'actual' && (
          <>
            <button onClick={() => setScale(s => clampScale(s / 1.25))} title="Zoom out" aria-label="Zoom out"
              disabled={scale <= MIN_SCALE} style={miniBtn(text3)}>−</button>
            <span style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 9.5, color: text3, minWidth: 30, textAlign: 'center' }}>
              {Math.round(scale * 100)}%
            </span>
            <button onClick={() => setScale(s => clampScale(s * 1.25))} title="Zoom in" aria-label="Zoom in"
              disabled={scale >= MAX_SCALE} style={miniBtn(text3)}>+</button>
          </>
        )}

        <span style={{ flex: 1 }} />

        {rendering && <Icon name="status-spinner" size={11} style={{ color: text3 }} />}

        <span title={`${info.name}${info.size ? ` · ${formatPdfSize(info.size)}` : ''}${info.pdfVersion ? ` · PDF ${info.pdfVersion}` : ''}`}
          style={{
            fontSize: 9.5, color: text3, fontFamily: 'var(--ds-font-mono)',
            maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
          {info.title || info.name}
        </span>
      </div>

      {/* ── page ── */}
      <div ref={attachWrap} tabIndex={0}
        style={{
          flex: 1, minHeight: 0, overflow: 'auto', display: 'flex',
          alignItems: 'flex-start', justifyContent: 'center',
          padding: 8, background: dark ? '#0d0c0b' : '#e8e6e1', outline: 'none',
        }}>
        {/* The canvas and the annotation layer share one positioned wrapper,
            so the layer's inset:0 lands exactly on the page and the two can't
            drift apart when the fit mode or zoom changes. */}
        <div style={{ position: 'relative', display: painted ? 'block' : 'none', flexShrink: 0 }}>
          <canvas ref={canvasRef}
            style={{
              display: 'block', maxWidth: '100%',
              boxShadow: dark ? '0 2px 14px rgba(0,0,0,0.6)' : '0 2px 12px rgba(0,0,0,0.18)',
              /* A white page on a white canvas has no edge, so a document with
                 wide margins looks like it failed to load. */
              background: '#fff',
            }} />

          {painted && viewportRef.current && (
            <PdfAnnotationLayer
              viewport={viewportRef.current}
              page={safePage - 1}
              edits={edits}
              tool={tool}
              colors={colors}
              accentColor={accent}
              selectedId={selectedEditId}
              onSelect={setSelectedEditId}
              onAdd={addAnnotation}
              textRuns={textRuns}
              sampleCover={sampleCover}
              width={Math.round(viewportRef.current.width)}
              height={Math.round(viewportRef.current.height)}
            />
          )}
        </div>

        {/* The document opened — page count and title are known — but no render
            has completed. Previously this state rendered an empty grey box and
            was indistinguishable from a broken build. Now it says so. */}
        {!painted && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
            padding: 24, textAlign: 'center', color: text3, fontFamily: 'var(--ds-font-body)',
          }}>
            <Icon name="status-spinner" size={18} style={{ color: accentText }} />
            <div style={{ fontSize: 11.5 }}>Rendering page {safePage}…</div>
            <div style={{ fontSize: 10, lineHeight: 1.5, maxWidth: 260, opacity: 0.75 }}>
              If this doesn’t clear, the pdf.js worker isn’t loading.
              Run <code style={{ fontFamily: 'var(--ds-font-mono)' }}>npm run pdf:worker</code> and reload.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── bits ────────────────────────────────────────────────────────────── */

function Shell({ children, colors }) {
  return (
    <div style={{
      height: '100%', minHeight: 140, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20,
      textAlign: 'center', color: colors.text3, fontFamily: 'var(--ds-font-body)',
      background: colors.surface,
    }}>
      {children}
    </div>
  )
}

function NavBtn({ label, icon, flip, disabled, onClick, colors }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', padding: '3px 5px', borderRadius: 5,
        border: 'none', background: 'transparent', cursor: disabled ? 'default' : 'pointer',
        color: disabled ? colors.border : colors.text2, opacity: disabled ? 0.5 : 1,
      }}>
      <Icon name={icon} size={13} style={flip ? { transform: 'rotate(180deg)' } : undefined} />
    </button>
  )
}

const miniBtn = color => ({
  width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 4, border: '1px solid transparent', background: 'transparent',
  color, cursor: 'pointer', fontFamily: 'var(--ds-font-mono)', fontSize: 12, lineHeight: 1, padding: 0,
})

export default memo(PdfBlockInner)
