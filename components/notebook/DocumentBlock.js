'use client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react'
import { sanitizeEditorHtml } from '../../lib/sanitize'
import { safeLinkUrl } from '../../lib/urls'
import { pageMetrics, fontStack } from '../../lib/pagesetup'
import {
  PAGE_GAP, PT_TO_PX, rangeIn, setRange, caretElement, paragraphsIn, applyInlineStyle,
  applyParagraphStyle, indentParagraphs, cleanupSpans, paginate, offsetIn, clearGapsIn,
  htmlWithoutPushes, pagePalette, PAGE_BREAK_HTML, normalizeRoot, divsToParagraphs, unwrapBlockParagraphs,
  selectionIndex, restoreSelectionIndex,
} from '../../lib/docedit'
import {
  isColumnsRow, columnsOf, readWidths, writeWidths, evenWidths,
  resizePair, normalizeColumnRows, handleColumnKeyDown, DIVIDER_PX,
} from '../../lib/columns'
import { createHistory, inputKind } from '../../lib/dochistory'
import {
  trackDelete, trackInsertText, markFragmentInserted, acceptChange, rejectChange,
  acceptAll, rejectAll, listChanges, changeOf, authorHue, CHANGE_SEL,
} from '../../lib/doctrack'
import {
  anchorComment, anchorsOf, removeAnchors, commentIdsAt, newCommentId,
  addThread, editThread, replyTo, setResolved, removeThread,
} from '../../lib/doccomments'
import { findAll, paintMatches, clearPaint, replaceRange, firstAfter } from '../../lib/docfind'
import { newNoteId, noteRefHtml, renumberNotes, TOC_HTML, updateTocs } from '../../lib/docnotes'
import { updateCitations, citeHtml, BIB_HTML } from '../../lib/doccite'
import {
  changeCase, nextCase, clearFormatting, readFormat, applyFormat, setListStyle, fixListNesting,
  smartQuote, autoformatFor, isRuleLine, tableOp, cellAtCaret, setImageLayout, captionHtml,
  renumberCaptions, EQUATION_HTML,
} from '../../lib/docformat'
import { saveVersion, AUTO_MS } from '../../lib/docversions'
import { registerDoc, notifyDoc } from '../../lib/docbridge'
import { currentAuthor } from '../../lib/docauthor'
import { docCss, docScreenCss, changeColorsCss } from '../../lib/docstyle'
import { snapshotPrintHtml } from '../../lib/docprint'
import { localPoint } from '../../lib/canvasgeom'
import { pageIndexAt, samePages } from '../../lib/docpages'
import { sectionsOf, sectionGeometry, leftMarginOf, pageLabels, sectionKey, sectionBreakHtml } from '../../lib/docsections'
import { layoutTabs, TAB_HTML } from '../../lib/doctabs'
import Ruler from './doc/DocRuler'
import DocRail from './doc/DocRail'
import { DocMenu, LinkPop, PageJump, ZoomMenu, PasteChip } from './doc/DocMenus'
import { FindBar, NavPane } from './doc/DocPanels'
import {
  HeaderFooterLayer, FootnoteLayer, WatermarkLayer, ImageTools, TableTools,
  NOTE_SEP, noteStyle, hfGeometry, hfFor, fillTokens, offsetLeftIn,
} from './doc/DocLayers'
import {
  StatsDialog, statsOf, ParagraphDialog, paragraphValues, applyParagraphValues, FontDialog,
  SourcesDialog, VersionsDialog, PageSizeDialog, TextDialog,
} from './doc/DocDialogs'
import { SectionDialog } from './doc/DocSection'

/*
  components/notebook/DocumentBlock.js
  --------------------------------------------------------------------------
  THE HEAVIER WRITING SURFACE. Notes is quick capture; this is the document.

  ── REAL PAGES ─────────────────────────────────────────────────────────────
  Separate sheets with a gap between them; text that reaches a page's
  bottom margin continues on the next sheet — whole blocks move, long
  paragraphs continue line by line, tables row by row (lib/docpages.js).
  The editor is ONE contentEditable laid over the stack of sheets, so
  selecting and typing across a page boundary stay native.

  The page is drawn at its true size and SCALED to fit the block (or to the
  zoom you pick) — never squeezed, so every line breaks where it prints.

  ── WHAT LIVES WHERE ───────────────────────────────────────────────────────
    content (HTML)      text, formatting, comment anchors, tracked changes,
                        footnote marks, citations, TOC, bibliography
    block.comments      comment threads          lib/doccomments.js
    block.footnotes     footnote texts           lib/docnotes.js
    block.sources       citation sources         lib/doccite.js
    block.hf            headers and footers      doc/DocLayers.js
  Layout (pushes, line gaps) never reaches storage; see htmlWithoutPushes.

  ── UNDO ───────────────────────────────────────────────────────────────────
  The document keeps its own history (lib/dochistory.js), because most of
  what the ribbon does writes the DOM directly and Chrome's contentEditable
  undo cannot see it.

  ── THE RIBBON ─────────────────────────────────────────────────────────────
  Commands that need this component (undo, find, comments, footnotes, track
  changes …) arrive through lib/docbridge.js under this block's id.
  -------------------------------------------------------------------------- */

export { PAGE_BREAK_HTML } from '../../lib/docedit'

const SCROLL_PAD_TOP = 20
const SCROLL_PAD_X = 24
const RAIL_GAP = 24
const RAIL_W = 270
/* Page numbers and headers are part of the PAGE, sized in points. */
const HF_PT = 9
const TRACKED_DELETE_UNIT = { deleteWordBackward: 'word', deleteWordForward: 'word', deleteSoftLineBackward: 'lineboundary', deleteSoftLineForward: 'lineboundary', deleteHardLineBackward: 'paragraphboundary', deleteHardLineForward: 'paragraphboundary' }

/* The text of the document for counting: paragraphs joined by newlines,
   without deleted (tracked) text, layout spacers or generated blocks. */
function countableText(root, range) {
  if (!root) return ''
  const parts = []
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement?.closest?.('del[data-ds-uid],[data-ds-gap],[data-ds-toc],[data-ds-bib],[data-ds-fn]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  let n, lastBlock = null
  while ((n = w.nextNode())) {
    if (range && !range.intersectsNode(n)) continue
    let t = n.data
    if (range) {
      if (n === range.endContainer) t = t.slice(0, range.endOffset)
      if (n === range.startContainer) t = t.slice(range.startOffset - (n === range.endContainer ? 0 : 0))
    }
    const b = n.parentElement?.closest('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,pre')
    if (lastBlock && b !== lastBlock) parts.push('\n')
    lastBlock = b
    parts.push(t)
  }
  return parts.join('')
}

function DocumentBlockInner({
  block, colors, dark = false, onSave, onEditStart, onEditEnd, onUpdateBlock,
}) {
  /* NO `zoom` PROP: the page renders inside the canvas's own transform. The
     scale below is the block's own fit or chosen zoom. */
  const { base, raised, border, text3 } = colors
  const ref = useRef(null)
  const scrollRef = useRef(null)
  const noteMeasureRef = useRef(null)
  const savedContent = useRef(null)
  const pendingRemote = useRef(null)
  const blockRef = useRef(block)
  blockRef.current = block
  /* Read live: the account (and so your name) can arrive after the
     document mounts, and several listeners are registered only once. */
  const author = useMemo(() => ({ get id() { return currentAuthor().id }, get name() { return currentAuthor().name } }), [])
  const history = useRef(null)
  if (!history.current) history.current = createHistory()
  const guard = useRef(false)          // our own execCommand calls: not user input
  const composing = useRef(false)
  const compStart = useRef(null)

  /* The laid-out pages: [{ top, h, w, mt, mb, sec }] in editor px (see
     lib/docpages.js — sections can make a page landscape). */
  const [pageList, setPageList] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  const [menu, setMenu] = useState(null)
  const [link, setLink] = useState(null)
  const [selTick, setSelTick] = useState(0)
  const [layoutTick, setLayoutTick] = useState(0)
  const [activeId, setActiveId] = useState(null)       // rail card
  const [find, setFind] = useState(null)                // { query, replace, matchCase, wholeWord, showReplace }
  const [findFocus, setFindFocus] = useState(0)
  const [findIdx, setFindIdx] = useState(0)
  const [hfEdit, setHfEdit] = useState(null)            // { zone, page }
  const [noteFocus, setNoteFocus] = useState(null)
  const [imgSel, setImgSel] = useState(null)
  const [tableSel, setTableSel] = useState(null)
  const [dialog, setDialog] = useState(null)            // { kind, … }
  const [painter, setPainter] = useState(null)          // { fmt, sticky }
  const [pasteChip, setPasteChip] = useState(null)
  const [live, setLive] = useState({ words: 0, chars: 0 })
  const [empty, setEmpty] = useState(false)
  const plainNext = useRef(false)
  const layoutRef = useRef({ heads: [], notePage: new Map(), noteHeights: new Map() })
  const lastVersionAt = useRef(Date.now())

  /* Thread data changes locally faster than a round-trip through the block
     store, so consecutive edits read the latest local copy. */
  const commentsRef = useRef(block.comments || [])
  useEffect(() => { commentsRef.current = block.comments || [] }, [block.comments])
  const notesRef = useRef(block.footnotes || {})
  useEffect(() => { notesRef.current = block.footnotes || {} }, [block.footnotes])
  const patch = useCallback(p => onUpdateBlock?.(blockRef.current.id, p), [onUpdateBlock])

  const metrics = useMemo(() => pageMetrics(block, 1), [block])
  const pal = pagePalette(block.pageColor || 'white', dark)
  const fontPt = block.fontSize || 11
  const fStack = fontStack(block.font)
  const showMarkup = block.showMarkup !== false
  const zoom = block.zoom || 'fit'

  /* ── Page geometry: sections, mirror margins, gutter ──────────────────── */
  /* The first section is the block's own; each section break adds one. The
     editor is as wide as the widest page; its text column starts at the
     first page's left margin (gutter included). */
  const [secKey, setSecKey] = useState('')
  const secKeyRef = useRef('')
  const geoKey = [block.pageSize, block.orientation, JSON.stringify(block.pageCustom || null), JSON.stringify(block.margins || null),
    block.marginPreset, block.gutter, block.mirror, block.pageStart, block.numFmt, secKey].join('|')
  const sections = useMemo(() => {
    const list = sectionsOf(ref.current, block)
    return list.map(s => ({ ...s, geo: sectionGeometry(block, s.orient) }))
  }, [geoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const geo0 = sections[0].geo
  const editorW = Math.max(...sections.map(s => s.geo.w))
  const editorLeft = geo0.left
  const contentWMax = Math.max(...sections.map(s => s.geo.contentW))
  const editorRight = Math.max(0, editorW - editorLeft - contentWMax)
  const pagesView = useMemo(() => {
    const list = pageList || [{ top: 0, h: geo0.h, w: geo0.w, mt: geo0.mt, mb: geo0.mb, sec: 0 }]
    const labels = pageLabels(list, sections)
    return list.map((pg, k) => {
      const g = (sections[pg.sec] || sections[0]).geo
      const left = leftMarginOf(g, k)
      const right = g.mirror && k % 2 === 1 ? g.left : g.right
      /* Mirror margins: the text column stays put and an even page is drawn
         shifted under it, so its text sits in the mirrored place. */
      return { ...pg, x: editorLeft - left, left, right, label: labels[k].label, total: labels[k].total }
    })
  }, [pageList, sections, editorLeft, geo0])
  const pages = pagesView.length
  const pagesRef = useRef(pagesView)
  pagesRef.current = pagesView
  const originX = Math.max(0, -Math.min(0, ...pagesView.map(p => p.x)))
  const lastPg = pagesView[pagesView.length - 1]
  const totalH = lastPg.top + lastPg.h
  const pagesRight = Math.max(editorW, ...pagesView.map(p => p.x + p.w))

  /* ── Pagination ───────────────────────────────────────────────────────── */
  const geomRef = useRef(null)
  geomRef.current = {
    sections: sections.map(s => s.geo), sectionList: sections, contentW: contentWMax, editorLeft,
  }
  const sched = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const measureNotes = () => {
    const m = noteMeasureRef.current
    const el = ref.current
    const out = new Map()
    if (!el) return out
    const ids = renumberNotes(el)
    if (!m) return out
    ids.forEach((id, i) => {
      m.textContent = `${i + 1} ${notesRef.current[id] || 'Type the note'}`
      out.set(id, m.offsetHeight)
    })
    m.textContent = ''
    return out
  }

  const runLayout = (pass = 0) => {
    const el = ref.current
    if (!el || composing.current) return
    const b = blockRef.current
    /* Section breaks are content, so the section list is read from the DOM
       each pass; when it changed shape, re-render first (the editor may need
       to be wider for a landscape section) and lay out after. */
    const key = sectionKey(el)
    if (key !== secKeyRef.current) { secKeyRef.current = key; setSecKey(key); return }
    layoutTabs(el, geomRef.current.editorLeft)
    const notes = measureNotes()
    const r = paginate(el, { ...geomRef.current, notes, noteSep: NOTE_SEP })
    /* Headings carry the PRINTED page number (a restarted, roman-numbered
       section says "iv"), and the page index for navigation. */
    const labels = pageLabels(r.pageList, geomRef.current.sectionList)
    for (const h of r.heads) { h.pageNo = h.pageIndex + 1; h.page = labels[h.pageIndex]?.label ?? String(h.pageNo) }
    /* Generated content follows the layout it describes: a TOC's page
       numbers, citations, caption numbers. A change here moves text, so the
       pass runs again (twice at most — it converges at once in practice). */
    let changed = updateTocs(el, r.heads)
    changed = updateCitations(el, b.sources, b.citeStyle) || changed
    renumberCaptions(el)
    if (changed) { scheduleSaveRef.current?.(); if (pass < 2) { runLayout(pass + 1); return } }
    layoutRef.current = { heads: r.heads, notePage: r.notePage, noteHeights: notes, pageList: r.pageList }
    setPageList(prev => (samePages(prev, r.pageList) ? prev : r.pageList))
    setLayoutTick(t => t + 1)
  }
  const runLayoutRef = useRef(runLayout)
  runLayoutRef.current = runLayout
  /* Coalesced into a microtask, not a frame: a frame never comes in a hidden
     tab, and React StrictMode's mount–unmount–mount cancelled a queued frame
     and left the flag set for good — pagination silently stopped. */
  const repaginate = useCallback(() => {
    if (sched.current) return
    sched.current = true
    queueMicrotask(() => {
      sched.current = false
      if (alive.current) runLayoutRef.current()
    })
  }, [])
  useLayoutEffect(() => { repaginate() },
    [geoKey, block.font, block.fontSize, block.lineSpacing, block.showMarks, block.citeStyle, block.sources, block.footnotes, showMarkup, repaginate])
  useEffect(() => {
    document.fonts?.ready?.then(() => repaginate())
    const el = ref.current
    const onLoad = e => { if (e.target?.tagName === 'IMG') repaginate() }
    el?.addEventListener('load', onLoad, true)
    return () => el?.removeEventListener('load', onLoad, true)
  }, [repaginate])

  /* The block's size decides the fit scale. */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setFit({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setFit({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /* ── Saving, history, counts ──────────────────────────────────────────── */
  const snapshot = () => ({ html: ref.current.innerHTML, sel: selectionIndex(ref.current) })

  const updateCounts = useCallback(() => {
    const el = ref.current
    if (!el) return
    const s = statsOf(countableText(el))
    setLive(l => (l.words === s.words && l.chars === s.chars ? l : { words: s.words, chars: s.chars }))
    const isEmpty = !el.textContent.replace(/\u200b/g, '').trim() && !el.querySelector('img,table,hr,[data-ds-toc],[data-ds-bib],[data-ds-pagebreak],[data-ds-sectionbreak]')
    setEmpty(isEmpty)
  }, [])
  const countTimer = useRef(null)
  const scheduleCounts = () => { clearTimeout(countTimer.current); countTimer.current = setTimeout(updateCounts, 120) }

  const persist = useCallback(() => {
    const el = ref.current
    if (!el || savedContent.current === null) return
    const clean = sanitizeEditorHtml(htmlWithoutPushes(el))
    if (clean === savedContent.current) return
    savedContent.current = clean
    pendingRemote.current = null   // your edit is the newer one
    onSave?.(clean)
    if (Date.now() - lastVersionAt.current > AUTO_MS) {
      lastVersionAt.current = Date.now()
      saveVersion(blockRef.current.id, clean, '').catch(() => {})
    }
  }, [onSave])
  const saveTimer = useRef(null)
  const scheduleSave = () => { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(persist, 500) }
  const scheduleSaveRef = useRef(scheduleSave)
  scheduleSaveRef.current = scheduleSave
  useEffect(() => () => { clearTimeout(saveTimer.current); clearTimeout(countTimer.current); persist() }, [persist])

  /* Every edit — typed, pasted, or a command — ends here. */
  const recordNext = useRef(null)
  const handleInput = e => {
    const el = ref.current
    if (!el) return
    const t = e?.nativeEvent?.inputType ?? e?.inputType ?? null
    normalizeColumnRows(el)
    cleanupSpans(el)
    normalizeRoot(el)
    fixListNesting(el)
    unwrapBlockParagraphs(el)
    /* Select all + Delete leaves an empty heading; typing would continue in
       it. Word keeps the style too, but nobody expects it: back to Normal. */
    if (el.children.length === 1 && /^H[1-6]$/.test(el.firstElementChild.tagName) && !el.textContent.trim() && t?.startsWith('delete')) {
      const p = document.createElement('p'); p.innerHTML = '<br>'
      el.firstElementChild.replaceWith(p)
      const r = document.createRange(); r.setStart(p, 0); r.collapse(true); setRange(r)
    }
    if (!guard.current) history.current.record(snapshot(), recordNext.current || inputKind(t))
    recordNext.current = null
    repaginate()
    scheduleSave()
    scheduleCounts()
    notifyDoc(blockRef.current.id)
  }

  /* Run a DOM-writing command as ONE undo step. */
  const command = fn => {
    const el = ref.current
    if (!el) return false
    guard.current = true
    let ok
    try { ok = fn(el) } finally { guard.current = false }
    recordNext.current = 'cmd'
    handleInput({ inputType: null })
    return ok
  }
  const exec = (cmd, value = null) => command(() => document.execCommand(cmd, false, value))

  /* ── Load ─────────────────────────────────────────────────────────────── */
  const writeIn = useCallback(clean => {
    const el = ref.current
    if (!el) return
    el.innerHTML = clean
    savedContent.current = clean
    divsToParagraphs(el)
    normalizeRoot(el)
    unwrapBlockParagraphs(el)
    normalizeColumnRows(el)
    history.current.reset({ html: el.innerHTML, sel: null })
    repaginate()
    updateCounts()
  }, [repaginate, updateCounts])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const clean = sanitizeEditorHtml(block.content || '')
    if (clean === savedContent.current) return
    if (savedContent.current !== null && document.activeElement === el) {
      pendingRemote.current = clean
      return
    }
    pendingRemote.current = null
    writeIn(clean)
  }, [block.content, writeIn])

  /* ── Undo / redo ──────────────────────────────────────────────────────── */
  const restore = state => {
    const el = ref.current
    if (!el || !state) return
    /* A state recorded with no caret (the loaded document) keeps the caret
       where it is rather than jumping to the top. */
    const here = state.sel == null ? selectionIndex(el) : null
    el.innerHTML = state.html
    el.focus({ preventScroll: true })
    restoreSelectionIndex(el, state.sel ?? here)
    repaginate()
    scheduleSave()
    scheduleCounts()
    setImgSel(null)
    notifyDoc(blockRef.current.id)
  }
  const undo = () => { history.current.touchSelection(selectionIndex(ref.current)); restore(history.current.undo()) }
  const redo = () => restore(history.current.redo())

  /* ── Where you are ────────────────────────────────────────────────────── */
  useEffect(() => {
    const onSel = () => {
      const el = ref.current
      const r = rangeIn(el)
      if (!r) return
      const at = caretElement(el, r)
      if (at) setCurrentPage(pageIndexAt(pagesRef.current, offsetIn(at.nodeType === 1 ? at : at.parentElement, el)) + 1)
      setSelTick(t => t + 1)
      /* The card for what the caret is in: a comment, else a change. */
      const ids = commentIdsAt(r.startContainer, el)
      const open = ids.find(id => commentsRef.current.some(c => c.id === id && !c.resolved))
      if (open) setActiveId(open)
      else {
        const ch = changeOf(r.startContainer, el)
        if (ch) setActiveId(changeKey(ch))
      }
      const cell = cellAtCaret(el)
      setTableSel(cell ? cell.closest('table') : null)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* A new layout can move the caret to another page (a section break just
     inserted, text reflowed): the page — and so the ruler — follows. */
  useEffect(() => {
    const el = ref.current
    const r = rangeIn(el)
    if (!r) return
    const at = caretElement(el, r)
    if (at) setCurrentPage(pageIndexAt(pagesRef.current, offsetIn(at.nodeType === 1 ? at : at.parentElement, el)) + 1)
  }, [pageList])

  /* ── Scale ────────────────────────────────────────────────────────────── */
  const comments = block.comments || []
  const changeIds = useRef(new WeakMap())
  const changeSeq = useRef(0)
  const changeKey = el => {
    let k = changeIds.current.get(el)
    if (!k) { k = 'chg' + (++changeSeq.current); changeIds.current.set(el, k) }
    return k
  }
  const railItems = useMemo(() => {
    const el = ref.current
    if (!el) return []
    const items = []
    const orphans = []
    for (const c of comments) {
      if (c.resolved && !block.showResolved) continue
      const a = anchorsOf(el, c.id)
      if (a.length) items.push({ type: 'comment', id: c.id, y: Math.max(0, offsetIn(a[0], el) - 6), thread: c, anchored: true })
      else if (c.text) orphans.push({ type: 'comment', id: c.id, thread: c, anchored: false })
    }
    if (showMarkup) {
      for (const ch of listChanges(el)) items.push({ type: 'change', id: changeKey(ch.el), y: Math.max(0, offsetIn(ch.el, el) - 6), change: ch })
    }
    let y = items.reduce((m, i) => Math.max(m, i.y), 0) + 120
    for (const o of orphans) { items.push({ ...o, y }); y += 110 }
    return items
  }, [layoutTick, comments, block.showResolved, showMarkup]) // eslint-disable-line react-hooks/exhaustive-deps
  const railOn = railItems.length > 0
  const docW = originX + pagesRight + (railOn ? RAIL_GAP + RAIL_W : 0)
  const fitScale = fit.w > 0 ? Math.max(0.3, Math.min(1, (fit.w - SCROLL_PAD_X * 2) / docW)) : 1
  const scale = zoom === 'fit' ? fitScale
    : zoom === 'page' ? Math.max(0.2, Math.min(fitScale, fit.h > 0 ? (fit.h - SCROLL_PAD_TOP - 32) / Math.max(...pagesView.map(p => p.h)) : 1))
    : Math.max(0.25, Math.min(3, Number(zoom) || 1))

  /* The ruler follows the caret's page (its section's width, its mirrored
     margins). */
  const rulerPg = pagesView[Math.max(0, Math.min(pagesView.length - 1, currentPage - 1))]
  const rulerPage = { w: rulerPg.w, x: originX + rulerPg.x, left: rulerPg.left, right: rulerPg.right, even: !!(sections[rulerPg.sec] || sections[0]).geo.mirror && (currentPage - 1) % 2 === 1 }

  const onScroll = e => {
    if (document.activeElement === ref.current) return
    const y = e.currentTarget.scrollTop / scale
    setCurrentPage(pageIndexAt(pagesView, y + 40) + 1)
  }
  const goToPage = n => {
    const s = scrollRef.current
    const pg = pagesView[Math.max(0, Math.min(pagesView.length - 1, n - 1))]
    if (s && pg) s.scrollTo({ top: pg.top * scale, behavior: 'smooth' })
  }
  /* Scroll so an element (editor coordinates) is in view. */
  const scrollToY = (y, h = 40) => {
    const s = scrollRef.current
    if (!s) return
    const top = y * scale + SCROLL_PAD_TOP
    if (top < s.scrollTop + 40 || top + h * scale > s.scrollTop + s.clientHeight - 40) s.scrollTo({ top: Math.max(0, top - s.clientHeight / 3), behavior: 'smooth' })
  }

  /* ── Commands ─────────────────────────────────────────────────────────── */
  const insertHtml = html => command(() => document.execCommand('insertHTML', false, html))
  /* Inline atoms (a footnote mark, a citation) go in with the Range API:
     execCommand('insertHTML') treats a contenteditable=false element as a
     block and SPLIT the paragraph around it. */
  const insertInline = html => command(root => {
    const r = rangeIn(root)
    if (!r) return false
    r.deleteContents()
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    const nodes = [...tpl.content.childNodes]
    const last = nodes[nodes.length - 1]
    r.insertNode(tpl.content)
    const c = document.createRange()
    if (last?.nodeType === 3) c.setStart(last, last.length); else c.setStartAfter(last)
    c.collapse(true); setRange(c)
    return true
  })
  const ensureCaret = () => {
    const el = ref.current
    if (!el) return null
    if (!rangeIn(el)) {
      el.focus({ preventScroll: true })
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); setRange(r)
    }
    return el
  }
  const openLink = () => {
    const el = ref.current
    const r = rangeIn(el)
    if (!r) return
    const a = caretElement(el, r)?.closest?.('a')
    const rect = (r.getClientRects()[0] || r.getBoundingClientRect())
    setLink({ x: rect.left, y: rect.bottom + 6, href: a?.getAttribute('href') || '', text: r.collapsed && !a ? '' : null, range: r.cloneRange(), anchor: a || null })
  }
  const contentW = geo0.contentW

  const setStyle = name => command(el => {
    const tag = name === 'title' || name === 'subtitle' || name === 'normal' ? 'p' : name === 'quote' ? 'blockquote' : name
    document.execCommand('formatBlock', false, tag)
    for (const p of paragraphsIn(el)) {
      if (name === 'title' || name === 'subtitle') p.setAttribute('data-ds-style', name)
      else p.removeAttribute('data-ds-style')
    }
    return true
  })

  /* Comments */
  const addComment = () => {
    const el = ensureCaret()
    const r = rangeIn(el)
    if (!r) return
    const existing = commentIdsAt(r.startContainer, el).find(id => commentsRef.current.some(c => c.id === id))
    if (existing && r.collapsed) { setActiveId(existing); return }
    const id = newCommentId()
    const ok = command(root => anchorComment(root, r, id))
    if (!ok) return
    const next = addThread(commentsRef.current, { id, text: '', author })
    commentsRef.current = next
    patch({ comments: next })
    setActiveId(id)
  }
  const railApi = {
    edit: (id, text) => { const n = editThread(commentsRef.current, id, text); commentsRef.current = n; patch({ comments: n }) },
    reply: (id, text) => { const n = replyTo(commentsRef.current, id, { text, author }); commentsRef.current = n; patch({ comments: n }) },
    resolve: (id, v) => { const n = setResolved(commentsRef.current, id, v); commentsRef.current = n; patch({ comments: n }); if (v) setActiveId(null) },
    remove: id => {
      command(root => { removeAnchors(root, id); return true })
      const n = removeThread(commentsRef.current, id); commentsRef.current = n; patch({ comments: n })
      setActiveId(null)
    },
    accept: el => { command(() => { acceptChange(el); return true }); setActiveId(null) },
    reject: el => { command(() => { rejectChange(el); return true }); setActiveId(null) },
  }
  const activate = id => {
    setActiveId(id)
    const el = ref.current
    const target = id.startsWith('c_') ? anchorsOf(el, id)[0] : listChanges(el).find(c => changeKey(c.el) === id)?.el
    if (target) {
      const r = document.createRange(); r.selectNodeContents(target); r.collapse(true)
      el.focus({ preventScroll: true }); setRange(r)
      scrollToY(offsetIn(target, el))
    }
  }

  /* Footnotes */
  const addFootnote = () => {
    const el = ensureCaret()
    if (!el) return
    const id = newNoteId()
    const r = rangeIn(el)
    if (r && !r.collapsed) { r.collapse(false); setRange(r) }
    insertInline(noteRefHtml(id))
    const next = { ...notesRef.current, [id]: '' }
    notesRef.current = next
    patch({ footnotes: next })
    setNoteFocus(id)
  }
  const noteTimer = useRef(null)
  const editNote = (id, text) => {
    notesRef.current = { ...notesRef.current, [id]: text }
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => { noteTimer.current = null; patch({ footnotes: notesRef.current }) }, 350)
    repaginate()
  }
  /* A footnote typed in the last 350 ms before the block unmounts (sheet
     switch, project switch, delete-then-undo) was dropped with the timer —
     the body has the same flush on unmount, the notes did not (audit
     DEF-024). */
  const patchRef = useRef(patch)
  patchRef.current = patch
  useEffect(() => () => {
    if (noteTimer.current) { clearTimeout(noteTimer.current); noteTimer.current = null; patchRef.current({ footnotes: notesRef.current }) }
  }, [])
  const backToRef = id => {
    const el = ref.current
    const sup = el?.querySelector(`[data-ds-fn="${CSS.escape(id)}"]`)
    if (!sup) return
    el.focus({ preventScroll: true })
    const r = document.createRange(); r.setStartAfter(sup); r.collapse(true); setRange(r)
  }

  /* Track changes */
  const trackedType = text => {
    const el = ref.current
    let r = rangeIn(el)
    if (!r) return
    guard.current = true
    try {
      if (!r.collapsed) {
        const res = trackDelete(el, r, author)
        if (res?.end) { const c = document.createRange(); c.setStart(res.end.node, res.end.offset); c.collapse(true); setRange(c) }
        r = rangeIn(el)
      }
      const after = trackInsertText(el, r, text, author)
      setRange(after)
    } finally { guard.current = false }
    recordNext.current = 'type'
    handleInput({ inputType: 'insertText' })
  }
  const trackedDelete = inputType => {
    const el = ref.current
    const sel = window.getSelection()
    const r0 = rangeIn(el)
    if (!r0) return false
    const saved = r0.cloneRange()
    const backward = inputType.includes('Backward') || inputType === 'deleteByCut' || inputType === 'deleteContent'
    if (r0.collapsed) sel.modify('extend', backward ? 'backward' : 'forward', TRACKED_DELETE_UNIT[inputType] || 'character')
    const r = rangeIn(el)
    if (!r || r.collapsed) return false
    guard.current = true
    let res
    try { res = trackDelete(el, r, author) } finally { guard.current = false }
    if (!res) { setRange(saved); return false }
    const pt = backward ? res.start : res.end
    if (pt) { const c = document.createRange(); c.setStart(pt.node, pt.offset); c.collapse(true); setRange(c) }
    recordNext.current = 'delete'
    handleInput({ inputType })
    return true
  }
  const moveToChange = dir => {
    const el = ref.current
    const list = [...el.querySelectorAll(CHANGE_SEL)]
    if (!list.length) return
    const r = rangeIn(el)
    let i = dir > 0 ? list.findIndex(c => !r || r.comparePoint(c, 0) > 0) : list.map((c, k) => [c, k]).reverse().find(([c]) => !r || r.comparePoint(c, 0) < 0)?.[1]
    if (i == null || i < 0) i = dir > 0 ? 0 : list.length - 1
    activate(changeKey(list[i]))
  }
  const moveToComment = dir => {
    const el = ref.current
    const open = commentsRef.current.filter(c => !c.resolved).map(c => ({ c, a: anchorsOf(el, c.id)[0] })).filter(x => x.a)
      .sort((x, y) => (x.a.compareDocumentPosition(y.a) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    if (!open.length) return
    const cur = open.findIndex(x => x.c.id === activeId)
    const i = cur < 0 ? (dir > 0 ? 0 : open.length - 1) : (cur + dir + open.length) % open.length
    activate(open[i].c.id)
  }
  const acceptOrReject = (accept, all) => {
    const el = ref.current
    if (all) { command(root => { (accept ? acceptAll : rejectAll)(root); return true }); return }
    const r = rangeIn(el)
    let targets = []
    if (r && !r.collapsed) targets = [...el.querySelectorAll(CHANGE_SEL)].filter(c => r.intersectsNode(c))
    else {
      const c = r ? changeOf(r.startContainer, el) : null
      if (c) targets = [c]
      else {
        const act = listChanges(el).find(x => changeKey(x.el) === activeId)
        if (act) targets = [act.el]
      }
    }
    if (!targets.length) { moveToChange(1); return }
    command(() => { targets.forEach(t => (accept ? acceptChange : rejectChange)(t)); return true })
    moveToChange(1)
  }

  /* Find and replace */
  const matches = useMemo(() => (find?.query ? findAll(ref.current, find.query, find) : []),
    [find?.query, find?.matchCase, find?.wholeWord, layoutTick, find]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!find) { clearPaint(); return }
    const i = Math.min(findIdx, Math.max(0, matches.length - 1))
    paintMatches(matches, matches.length ? i : null)
    return () => clearPaint()
  }, [find, matches, findIdx])
  const openFind = withReplace => {
    const r = rangeIn(ref.current)
    const seed = r && !r.collapsed && r.toString().length < 80 ? r.toString() : null
    setFind(f => ({ query: seed ?? f?.query ?? '', replace: f?.replace ?? '', matchCase: !!f?.matchCase, wholeWord: !!f?.wholeWord, showReplace: withReplace || !!f?.showReplace }))
    setFindFocus(t => t + 1)
    if (r) setTimeout(() => setFindIdx(firstAfter(findAll(ref.current, seed ?? find?.query ?? '', find || {}), r)), 0)
  }
  const showMatch = i => {
    const m = matches[i]
    if (!m) return
    setFindIdx(i)
    scrollToY(offsetIn(m.startContainer.nodeType === 1 ? m.startContainer : m.startContainer.parentElement, ref.current))
  }
  const findStep = dir => { if (matches.length) showMatch((findIdx + dir + matches.length) % matches.length) }
  const replaceOne = () => {
    const m = matches[findIdx]
    if (!m) return
    const text = find.replace || ''
    command(el => {
      if (block.trackChanges) {
        const res = trackDelete(el, m, author)
        if (res?.end && text) { const c = document.createRange(); c.setStart(res.end.node, res.end.offset); c.collapse(true); setRange(trackInsertText(el, c, text, author)) }
      } else setRange(replaceRange(m, text))
      return true
    })
  }
  const replaceEvery = () => {
    const list = [...matches].reverse()
    if (!list.length) return
    const text = find.replace || ''
    command(el => {
      for (const m of list) {
        if (block.trackChanges) {
          const res = trackDelete(el, m, author)
          if (res?.end && text) { const c = document.createRange(); c.setStart(res.end.node, res.end.offset); c.collapse(true); trackInsertText(el, c, text, author) }
        } else replaceRange(m, text)
      }
      return true
    })
  }
  const closeFind = () => {
    const m = matches[findIdx]
    setFind(null)
    const el = ref.current
    el?.focus({ preventScroll: true })
    if (m) setRange(m)
  }

  /* Images */
  const addCaption = () => {
    const img = imgSel
    if (!img) return
    command(el => {
      const n = el.querySelectorAll('[data-ds-caption]').length + 1
      const host = img.closest('p,div,figure') && img.closest('p,div,figure') !== el ? img.closest('p,div,figure') : img
      host.insertAdjacentHTML('afterend', captionHtml(n))
      const cap = host.nextElementSibling
      const r = document.createRange(); r.selectNodeContents(cap); r.collapse(false); setRange(r)
      return true
    })
    setImgSel(null)
  }

  /* The format painter: read now, apply on the next selection. */
  const armPainter = sticky => {
    if (painter) { setPainter(null); return }
    const fmt = readFormat(ref.current)
    if (fmt) setPainter({ fmt, sticky: !!sticky })
  }
  useEffect(() => { notifyDoc(block.id) }, [painter, block.id])

  /* ── Print ────────────────────────────────────────────────────────────── */
  const printHtml = () => {
    const el = ref.current
    if (!el) return null
    const b = blockRef.current
    const pv = pagePalette('white', false)
    const lineH = Math.round(HF_PT * PT_TO_PX * 1.3)
    const nst = noteStyle(fStack, fontPt)
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const notesByPage = notesGrouped()
    const overlays = p => {
      const pg = pagesView[p] || pagesView[0]
      const g = hfGeometry(pg, lineH)
      let h = ''
      for (const zone of ['header', 'footer']) {
        const t = !b.hf && zone === 'footer' ? (pages > 1 ? { c: 'Page {page} of {pages}' } : {}) : hfFor(b.hf, zone, p)
        if (!t.l && !t.c && !t.r) continue
        const y = zone === 'header' ? g.headTop : pg.h - g.footTop - lineH
        h += `<div style="position:absolute;left:${pg.left}px;right:${pg.right}px;top:${y}px;height:${lineH}px;display:flex;gap:12px;font-family:${fStack.replace(/"/g, "'")};font-size:${HF_PT * PT_TO_PX}px;line-height:${lineH}px;color:${pv.mute}">`
          + ['l', 'c', 'r'].map(k => `<span style="flex:1;min-width:0;text-align:${k === 'l' ? 'left' : k === 'c' ? 'center' : 'right'};white-space:nowrap;overflow:hidden">${esc(fillTokens(t[k], { page: pg.label, pages: pg.total, title: b.name }))}</span>`).join('')
          + '</div>'
      }
      const notes = notesByPage.get(p)
      if (notes?.length) {
        const total = notes.reduce((s, n) => s + (layoutRef.current.noteHeights.get(n.id) || 20), 0)
        const top = pg.h - pg.mb - total - NOTE_SEP
        h += `<div style="position:absolute;left:${pg.left}px;right:${pg.right}px;top:${top}px"><div style="height:${NOTE_SEP}px;display:flex;align-items:center"><span style="width:33%;height:1px;background:${pv.rule}"></span></div>`
          + notes.map(n => `<div style="font-family:${fStack.replace(/"/g, "'")};font-size:${nst.fontSize}px;line-height:${nst.lineHeight};padding-top:${nst.paddingTop}px;color:${pv.text};display:flex;gap:4px"><sup style="line-height:0;font-size:.75em">${n.n}</sup><span>${esc(n.text)}</span></div>`).join('')
          + '</div>'
      }
      if (b.watermark) h += `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><span style="transform:rotate(-45deg);font-family:Inter,sans-serif;font-weight:700;font-size:${Math.min(140, (pg.w * 1.1) / Math.max(4, b.watermark.length))}px;letter-spacing:4px;color:rgba(0,0,0,.07);text-transform:uppercase;white-space:nowrap">${esc(b.watermark)}</span></div>`
      return h
    }
    return snapshotPrintHtml(el, {
      pages: pagesView, editorW, editorLeft, editorRight, title: b.name, font: fStack.replace(/"/g, "'"),
      fontSizePx: fontPt * PT_TO_PX, lineHeight: b.lineSpacing || 1.5, textIndent: (b.indentFirst || 0) * 96,
      palVars: { '--pg-bg': pv.bg, '--pg-text': pv.text, '--pg-mute': pv.mute, '--pg-rule': pv.rule, '--pg-th': pv.th, '--pg-link': pv.link, '--pg-head': pv.head, '--pg-head2': pv.head2 },
      overlays,
    })
  }

  /* ── The API the ribbon uses ──────────────────────────────────────────── */
  /* ── Sections ─────────────────────────────────────────────────────────── */
  /* The section the caret is in: the number of section breaks before it
     (with no caret, the current page's). */
  const breaksIn = el => (el ? [...el.querySelectorAll('[data-ds-sectionbreak]')] : [])
  const caretSection = () => {
    const el = ref.current
    const r = el && rangeIn(el)
    if (!r) return pagesRef.current[Math.max(0, currentPage - 1)]?.sec || 0
    let i = 0
    for (const br of breaksIn(el)) if (br.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) i++
    return i
  }
  const sectionSettings = i => {
    const s = sectionsOf(ref.current, blockRef.current)[i] || sectionsOf(null, blockRef.current)[0]
    return { orient: s.orient, restart: s.restart, start: s.start, numfmt: s.numfmt }
  }
  const setSection = (i, v) => {
    if (i === 0) {
      patch({ orientation: v.orient, pageStart: v.start && v.start !== 1 ? v.start : undefined, numFmt: v.numfmt !== 'decimal' ? v.numfmt : undefined })
      return
    }
    const br = breaksIn(ref.current)[i - 1]
    if (!br) return
    command(() => {
      br.setAttribute('data-orient', v.orient === 'landscape' ? 'landscape' : 'portrait')
      br.setAttribute('data-numfmt', v.numfmt || 'decimal')
      if (v.restart) { br.setAttribute('data-restart', '1'); br.setAttribute('data-start', String(v.start ?? 1)) }
      else { br.removeAttribute('data-restart'); br.removeAttribute('data-start') }
      return true
    })
  }

  const run = (cmd, arg) => {
    const el = ref.current
    if (!el) return
    switch (cmd) {
      case 'sectionBreak': { ensureCaret(); const cur = sectionSettings(caretSection()); insertHtml(sectionBreakHtml({ orient: cur.orient, numfmt: cur.numfmt, ...(arg || {}) })); break }
      case 'orient': setSection(caretSection(), { ...sectionSettings(caretSection()), orient: arg }); break
      case 'sectionDialog': { const i = caretSection(); setDialog({ kind: 'section', index: i, count: breaksIn(el).length + 1, init: sectionSettings(i) }); break }
      case 'tab': ensureCaret(); insertInline(TAB_HTML); break
      case 'undo': undo(); break
      case 'redo': redo(); break
      case 'find': openFind(false); break
      case 'replace': openFind(true); break
      case 'comment': addComment(); break
      case 'nextComment': moveToComment(1); break
      case 'prevComment': moveToComment(-1); break
      case 'footnote': addFootnote(); break
      case 'toc': ensureCaret(); insertHtml(TOC_HTML); break
      case 'bibliography': ensureCaret(); insertHtml(BIB_HTML); break
      case 'sources': setDialog({ kind: 'sources' }); break
      case 'insertHtml': ensureCaret(); insertHtml(arg); break
      case 'insertText': ensureCaret(); if (block.trackChanges) trackedType(arg); else command(() => document.execCommand('insertText', false, arg)); break
      case 'equation': ensureCaret(); insertHtml(EQUATION_HTML); break
      case 'hr': ensureCaret(); insertHtml('<hr><p><br></p>'); break
      case 'pagebreak': ensureCaret(); insertHtml(PAGE_BREAK_HTML); break
      case 'clearFormat': ensureCaret(); command(root => clearFormatting(root)); break
      case 'changeCase': ensureCaret(); command(root => changeCase(root, arg)); break
      case 'painter': armPainter(arg); break
      case 'listStyle': ensureCaret(); command(root => setListStyle(root, arg.ordered, arg.style)); break
      case 'style': ensureCaret(); setStyle(arg); break
      case 'dropcap': ensureCaret(); command(root => { for (const p of paragraphsIn(root)) { if (p.hasAttribute('data-ds-dropcap')) p.removeAttribute('data-ds-dropcap'); else p.setAttribute('data-ds-dropcap', '1') } return true }); break
      case 'spacing': ensureCaret(); command(root => applyParagraphStyle(root, p => { if (arg.before != null) p.style.marginTop = arg.before + 'pt'; if (arg.after != null) p.style.marginBottom = arg.after + 'pt'; if (arg.line != null) p.style.lineHeight = String(arg.line) })); break
      case 'track': patch({ trackChanges: !blockRef.current.trackChanges }); break
      case 'markup': patch({ showMarkup: !(blockRef.current.showMarkup !== false) }); break
      case 'showResolved': patch({ showResolved: !blockRef.current.showResolved }); break
      case 'accept': acceptOrReject(true, arg === 'all'); break
      case 'reject': acceptOrReject(false, arg === 'all'); break
      case 'nextChange': moveToChange(1); break
      case 'prevChange': moveToChange(-1); break
      case 'marks': patch({ showMarks: !blockRef.current.showMarks }); break
      case 'nav': patch({ showNav: !blockRef.current.showNav }); break
      case 'zoom': patch({ zoom: arg }); break
      case 'stats': setDialog({ kind: 'stats' }); break
      case 'paragraphDialog': { ensureCaret(); const p = paragraphsIn(el)[0]; if (p) setDialog({ kind: 'paragraph', range: rangeIn(el)?.cloneRange(), init: paragraphValues(p) }); break }
      case 'fontDialog': { ensureCaret(); setDialog({ kind: 'font', range: rangeIn(el)?.cloneRange(), init: fontInit() }); break }
      case 'versions': persist(); setDialog({ kind: 'versions' }); break
      case 'saveVersion': persist(); saveVersion(blockRef.current.id, savedContent.current || '', 'Saved by hand').catch(() => {}); break
      case 'pageSizeDialog': setDialog({ kind: 'pagesize' }); break
      case 'watermark': setDialog({ kind: 'watermark' }); break
      case 'link': ensureCaret(); openLink(); break
      case 'hf': setHfEdit({ zone: arg || 'header', page: Math.max(0, currentPage - 1) }); break
      default: break
    }
  }
  const runRef = useRef(run)
  runRef.current = run
  const sectionStateRef = useRef(null)
  sectionStateRef.current = () => {
    const i = caretSection()
    return { index: i, count: breaksIn(ref.current).length + 1, ...sectionSettings(i) }
  }
  useEffect(() => registerDoc(block.id, {
    run: (c, a) => runRef.current(c, a),
    state: () => ({
      canUndo: history.current.canUndo(), canRedo: history.current.canRedo(),
      tracking: !!blockRef.current.trackChanges, markup: blockRef.current.showMarkup !== false,
      painter: !!painterRef.current, marks: !!blockRef.current.showMarks, nav: !!blockRef.current.showNav,
      zoom: blockRef.current.zoom || 'fit', resolved: !!blockRef.current.showResolved,
      section: sectionStateRef.current(),
    }),
    printHtml: () => printHtmlRef.current(),
  }), [block.id])
  const painterRef = useRef(painter)
  painterRef.current = painter
  const printHtmlRef = useRef(printHtml)
  printHtmlRef.current = printHtml

  function fontInit() {
    const el = ref.current
    const at = caretElement(el)
    const cs = at ? getComputedStyle(at) : null
    const q = c => { try { return document.queryCommandState(c) } catch { return false } }
    const fam = cs ? cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() : ''
    return {
      font: fam && fam !== 'var(--ds-font-body)' && !fam.startsWith('__') ? fam : (block.font || 'Inter'),
      size: cs ? Math.round((parseFloat(cs.fontSize) / PT_TO_PX) * 2) / 2 : fontPt,
      bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
      smallCaps: cs?.fontVariantCaps === 'small-caps', allCaps: cs?.textTransform === 'uppercase',
      pos: q('superscript') ? 'sup' : q('subscript') ? 'sub' : '', color: '',
    }
  }

  /* ── Keys ─────────────────────────────────────────────────────────────── */
  const handleKeyDown = e => {
    const el = ref.current
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

    if (e.key === 'Escape' && painterRef.current) { e.preventDefault(); e.nativeEvent.__dsConsumed = true; setPainter(null); return }
    if (imgSel && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      const img = imgSel
      setImgSel(null)
      command(() => { img.remove(); return true })
      return
    }
    if (imgSel && e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; setImgSel(null); return }

    if (mod && !e.altKey) {
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return }
      if (key === 'f' && !e.shiftKey) { e.preventDefault(); openFind(false); return }
      if (key === 'h' && !e.shiftKey) { e.preventDefault(); openFind(true); return }
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); command(root => clearFormatting(root)); return }
      if (key === '.') { e.preventDefault(); exec('superscript'); return }
      if (key === ',') { e.preventDefault(); exec('subscript'); return }
      if (!e.shiftKey && (key === '1' || key === '2' || key === '5')) {
        e.preventDefault()
        const v = key === '1' ? 1 : key === '2' ? 2 : 1.5
        command(root => applyParagraphStyle(root, p => { p.style.lineHeight = String(v) }))
        return
      }
      /* Word's paragraph shortcuts. Each is also a BROWSER shortcut (Ctrl+L
         address bar, Ctrl+R reload, Ctrl+J downloads, Ctrl+E search) —
         which is why they must be taken here, inside the document. */
      const align = { l: '', e: 'center', r: 'right', j: 'justify' }[key]
      if (align !== undefined && !e.shiftKey) {
        e.preventDefault()
        command(root => applyParagraphStyle(root, p => { if (align) p.style.textAlign = align; else p.style.removeProperty('text-align') }))
        return
      }
      if (key === 'e' && e.shiftKey) { e.preventDefault(); run('track'); return }
      if (e.shiftKey && (key === '8' || key === '*')) { e.preventDefault(); run('marks'); return }
      if (key === 'k') { e.preventDefault(); openLink(); return }
      if (e.key === 'Enter') { e.preventDefault(); insertHtml(PAGE_BREAK_HTML); return }
      if (key === ']' || key === '[' || (e.shiftKey && (e.key === '>' || e.key === '<'))) {
        e.preventDefault()
        const at = caretElement(el)
        const cur = at ? parseFloat(getComputedStyle(at.nodeType === 1 ? at : at.parentElement).fontSize) / PT_TO_PX : fontPt
        const up = key === ']' || e.key === '>'
        const next = Math.max(6, Math.min(200, Math.round(cur) + (up ? 1 : -1)))
        command(root => applyInlineStyle(root, { fontSize: next + 'pt' }))
        return
      }
      if (e.shiftKey && key === 'v') { plainNext.current = true; return }
    }
    if (mod && e.altKey) {
      if (['0', '1', '2', '3', '4'].includes(e.key) || ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        e.preventDefault()
        const d = (e.code || '').replace('Digit', '') || e.key
        setStyle(d === '0' ? 'normal' : 'h' + d)
        return
      }
      if (key === 'm' || e.code === 'KeyM') { e.preventDefault(); addComment(); return }
      if (key === 'f' || e.code === 'KeyF') { e.preventDefault(); addFootnote(); return }
    }
    if (e.key === 'F3' && e.shiftKey) {
      e.preventDefault()
      const r = rangeIn(el)
      command(root => changeCase(root, nextCase(r ? r.toString() : '')))
      return
    }

    /* Backspace at the start of the line after a page break removes the
       break; Delete at the end of the line before one does too. The break
       is invisible on real pages, so the keys must know it is there. */
    if ((e.key === 'Backspace' || e.key === 'Delete') && !mod) {
      const r = rangeIn(el)
      const para = r ? paragraphsIn(el, r)[0] : null
      if (para) clearGapsIn(para)
      if (r && r.collapsed && para) {
        const pre = document.createRange(); pre.setStart(para, 0); pre.setEnd(r.startContainer, r.startOffset)
        const post = document.createRange(); post.setStart(r.startContainer, r.startOffset); post.setEnd(para, para.childNodes.length)
        const atStart = !pre.toString().replace(/\u200b/g, '').length
        const atEnd = !post.toString().replace(/\u200b/g, '').length
        const top = para.parentElement === el ? para : null
        if (top && e.key === 'Backspace' && atStart && top.previousElementSibling?.matches('[data-ds-pagebreak],[data-ds-sectionbreak]')) {
          e.preventDefault(); const br = top.previousElementSibling; command(() => { br.remove(); return true }); return
        }
        if (top && e.key === 'Delete' && atEnd && top.nextElementSibling?.matches('[data-ds-pagebreak],[data-ds-sectionbreak]')) {
          e.preventDefault(); const br = top.nextElementSibling; command(() => { br.remove(); return true }); return
        }
      }
    }

    /* Tab, the way Word does it: next cell in a table, a nested level in a
       list, otherwise an indent — never a blockquote. */
    if (e.key === 'Tab' && !mod) {
      e.preventDefault()
      const at = caretElement(el)
      const cell = at?.closest?.('td,th')
      if (cell && el.contains(cell)) {
        command(() => {
          const table = cell.closest('table')
          const all = [...table.querySelectorAll('td,th')].filter(c => !c.closest('[data-ds-gap]'))
          let i = all.indexOf(cell) + (e.shiftKey ? -1 : 1)
          if (i >= all.length) {
            const tr = cell.closest('tr').cloneNode(true)
            tr.querySelectorAll('td,th').forEach(c => { const d = document.createElement('td'); d.innerHTML = '<br>'; c.replaceWith(d) })
            cell.closest('tbody, table').appendChild(tr)
          }
          const target = [...table.querySelectorAll('td,th')].filter(c => !c.closest('[data-ds-gap]'))[Math.max(0, i)]
          if (target) { const r = document.createRange(); r.selectNodeContents(target); setRange(r) }
          return true
        })
        return
      }
      if (at?.closest?.('li')) { exec(e.shiftKey ? 'outdent' : 'indent'); return }
      const r = rangeIn(el)
      const para = paragraphsIn(el, r)[0]
      let atStart = true
      if (r && para && r.collapsed) {
        const pre = document.createRange(); pre.setStart(para, 0); pre.setEnd(r.startContainer, r.startOffset)
        atStart = pre.toString().replace(/\u200b/g, '').length === 0
      }
      /* Mid-line: a real tab, stretched to the paragraph's next stop
         (lib/doctabs.js). At the start of a line it indents, as before. */
      if (e.shiftKey || !r?.collapsed || atStart) command(root => indentParagraphs(root, e.shiftKey ? -1 : 1, contentW))
      else insertInline(TAB_HTML)
      return
    }

    const col = handleColumnKeyDown(e)
    if (col.handled && col.changed) { handleInput({ inputType: null }) }
  }

  /* Typing hooks: tracked changes, smart quotes, native undo from menus. */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onBefore = e => {
      if (guard.current) return
      const t = e.inputType
      if (t === 'historyUndo') { e.preventDefault(); undo(); return }
      if (t === 'historyRedo') { e.preventDefault(); redo(); return }
      const b = blockRef.current
      let data = e.data
      let custom = false
      if (t === 'insertText' && (data === '"' || data === "'") && b.smartQuotes !== false) {
        const r = rangeIn(el)
        let before = ''
        if (r) { const pre = document.createRange(); const para = paragraphsIn(el, r)[0] || el; pre.setStart(para, 0); pre.setEnd(r.startContainer, r.startOffset); before = pre.toString() }
        data = smartQuote(data, before)
        custom = true
      }
      if (b.trackChanges) {
        if (t === 'insertText' || t === 'insertReplacementText') {
          e.preventDefault()
          let text = data ?? e.dataTransfer?.getData('text/plain') ?? ''
          if (t === 'insertReplacementText') {
            const tr = e.getTargetRanges?.()[0]
            if (tr) { const r = document.createRange(); r.setStart(tr.startContainer, tr.startOffset); r.setEnd(tr.endContainer, tr.endOffset); setRange(r) }
          }
          if (text) trackedType(text)
          return
        }
        if (t.startsWith('delete') && t !== 'deleteByDrag' && t !== 'deleteByCut') {
          if (trackedDelete(t)) e.preventDefault()
          return
        }
        if (t === 'insertFromDrop' || t === 'deleteByDrag') { e.preventDefault(); return }
      }
      if (custom) {
        e.preventDefault()
        guard.current = true
        try { document.execCommand('insertText', false, data) } finally { guard.current = false }
        handleInputRef.current({ inputType: 'insertText' })
      }
    }
    el.addEventListener('beforeinput', onBefore)
    return () => el.removeEventListener('beforeinput', onBefore)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const handleInputRef = useRef(handleInput)
  handleInputRef.current = handleInput

  /* Autoformat after the input lands: "- " → list, "# " → heading, "---"
     then Enter → a rule. One undo step takes it back to what you typed. */
  const onInput = e => {
    const t = e.nativeEvent?.inputType
    const el = ref.current
    if (blockRef.current.autoFormat !== false && !blockRef.current.trackChanges) {
      const r = rangeIn(el)
      const para = r ? paragraphsIn(el, r)[0] : null
      if (t === 'insertText' && e.nativeEvent.data === ' ' && para && r.collapsed && !para.closest('li,td,th') && !/^H[1-6]$/.test(para.tagName)) {
        const pre = document.createRange(); pre.setStart(para, 0); pre.setEnd(r.startContainer, r.startOffset)
        const af = autoformatFor(pre.toString())
        if (af) {
          handleInput(e)                          // the typed "- " is its own step
          /* Built by hand rather than with execCommand: Chrome's list
             command on a just-emptied paragraph put the <ul> INSIDE the
             <p>, and everything typed after it nested there too. */
          command(() => {
            const del = document.createRange(); del.setStart(para, 0); del.setEnd(r.startContainer, r.startOffset)
            del.deleteContents()
            let host, target
            if (af.kind === 'ul' || af.kind === 'ol') {
              host = document.createElement(af.kind)
              if (af.style) host.style.listStyleType = af.style
              target = document.createElement('li')
              host.appendChild(target)
            } else { host = document.createElement(af.kind); target = host }
            while (para.firstChild) target.appendChild(para.firstChild)
            if (!target.textContent && !target.querySelector('br,img')) target.innerHTML = '<br>'
            for (const a of ['style']) { const v = para.getAttribute(a); if (v && host === target) host.setAttribute(a, v) }
            para.replaceWith(host)
            const c = document.createRange()
            const first = target.firstChild
            if (first && first.nodeType === 3) c.setStart(first, 0); else c.setStart(target, 0)
            c.collapse(true); setRange(c)
            return true
          })
          return
        }
      }
      if (t === 'insertParagraph' && para) {
        const prev = para.previousElementSibling
        if (prev && prev.tagName === 'P' && isRuleLine(prev.textContent || '')) {
          handleInput(e)
          command(() => { const hr = document.createElement('hr'); prev.replaceWith(hr); return true })
          return
        }
      }
    }
    handleInput(e)
  }

  /* Column-divider resize — see TextBlockContent.js's startColumnResize. */
  const startColumnResize = (divider, startEvent) => {
    const row = isColumnsRow(divider)
    if (!row) return
    const cols = columnsOf(row)
    const dividers = Array.from(row.children).filter(c => c.dataset?.type === 'col-divider')
    const idx = dividers.indexOf(divider)
    if (idx < 0) return
    if (startEvent.detail >= 2) { writeWidths(row, evenWidths(cols.length)); handleInput({ inputType: null }); return }
    const rowRect = row.getBoundingClientRect()
    const sc = rowRect.width / (row.offsetWidth || rowRect.width)
    const cW = Math.max(1, rowRect.width - DIVIDER_PX * (cols.length - 1) * sc)
    const startX = startEvent.clientX
    const startWidths = readWidths(row)
    if (startWidths.length !== cols.length) return
    document.body.style.cursor = 'col-resize'
    divider.setAttribute('data-dragging', 'true')
    function onMove(ev) { writeWidths(row, resizePair(startWidths, idx, ((ev.clientX - startX) / cW) * 100)) }
    function onUp() {
      document.body.style.cursor = ''
      divider.removeAttribute('data-dragging')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      handleInput({ inputType: null })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* ── Clipboard ────────────────────────────────────────────────────────── */
  const cleanFragment = r => {
    const box = document.createElement('div')
    box.appendChild(r.cloneContents())
    box.querySelectorAll('[data-ds-gap]').forEach(g => g.remove())
    box.querySelectorAll('[data-ds-pushed]').forEach(x => { x.style.removeProperty('margin-top'); x.removeAttribute('data-ds-pushed') })
    box.querySelectorAll('[data-ds-sx]').forEach(x => { x.style.removeProperty('max-width'); x.removeAttribute('data-ds-sx') })
    box.querySelectorAll('[data-ds-tab]').forEach(x => x.style.removeProperty('width'))
    box.querySelectorAll('[data-ds-comment]').forEach(s => s.replaceWith(...s.childNodes))
    return sanitizeEditorHtml(box.innerHTML)
  }
  const onCopy = e => {
    const r = rangeIn(ref.current)
    if (!r || r.collapsed) return
    e.preventDefault()
    e.clipboardData.setData('text/html', cleanFragment(r))
    e.clipboardData.setData('text/plain', countableText(ref.current, r) || r.toString())
  }
  const onCut = e => {
    const r = rangeIn(ref.current)
    if (!r || r.collapsed) return
    onCopy(e)
    e.preventDefault()
    if (block.trackChanges) {
      guard.current = true
      let res
      try { res = trackDelete(ref.current, r, author) } finally { guard.current = false }
      if (res?.start) { const c = document.createRange(); c.setStart(res.start.node, res.start.offset); c.collapse(true); setRange(c) }
      recordNext.current = 'cmd'
      handleInput({ inputType: null })
    } else command(() => { r.deleteContents(); return true })
  }

  const handlePaste = e => {
    const html = e.clipboardData?.getData('text/html')
    const text = e.clipboardData?.getData('text/plain') || ''
    const el = ref.current
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const plainHtml = t => {
      const lines = t.replace(/\r/g, '').split('\n')
      return lines.length === 1 ? null : lines.map(l => `<p>${esc(l) || '<br>'}</p>`).join('')
    }
    e.preventDefault()
    const tracking = blockRef.current.trackChanges
    const before = snapshot()
    const r0 = rangeIn(el)
    const at = r0 ? (r0.getClientRects()[0] || r0.getBoundingClientRect()) : null
    const insertPlain = t => {
      const multi = plainHtml(t)
      if (tracking) {
        if (multi) document.execCommand('insertHTML', false, markFragmentInserted(multi, author))
        else trackedType(t)
      } else if (multi) document.execCommand('insertHTML', false, multi)
      else document.execCommand('insertText', false, t)
    }
    if (plainNext.current || !html) {
      plainNext.current = false
      if (!text) return
      command(() => { insertPlain(text); return true })
      return
    }
    /* Word and Google Docs put alignment on runs; Word's paste keeps it on
       the paragraph. Empty links left by a refused URL are dropped. */
    const tpl = document.createElement('template')
    tpl.innerHTML = sanitizeEditorHtml(html)
    tpl.content.querySelectorAll('span[style*="text-align"]').forEach(s => {
      const m = /text-align:\s*(\w+)/.exec(s.getAttribute('style'))
      const p = s.closest('p,div,h1,h2,h3,h4,li')
      if (m && p && !p.style.textAlign) p.style.textAlign = m[1]
      s.style.removeProperty('text-align')
    })
    tpl.content.querySelectorAll('a:not([href])').forEach(a => a.replaceWith(...a.childNodes))
    let clean = tpl.innerHTML
    if (tracking) clean = markFragmentInserted(clean, author)
    command(root => {
      if (tracking) {
        const r = rangeIn(root)
        if (r && !r.collapsed) {
          const res = trackDelete(root, r, author)
          if (res?.end) { const c = document.createRange(); c.setStart(res.end.node, res.end.offset); c.collapse(true); setRange(c) }
        }
      }
      document.execCommand('insertHTML', false, clean)
      return true
    })
    if (at && text) setPasteChip({ x: at.left, y: at.bottom, before, text })
  }

  /* ── Mouse ────────────────────────────────────────────────────────────── */
  const onContextMenu = e => {
    if (e.shiftKey) { e.stopPropagation(); return }
    e.preventDefault(); e.stopPropagation()
    const el = ref.current
    const r = rangeIn(el)
    const node = r?.startContainer
    setMenu({
      x: e.clientX, y: e.clientY,
      ctx: {
        hasSelection: !!r && !r.collapsed,
        table: !!cellAtCaret(el),
        link: !!caretElement(el, r)?.closest?.('a'),
        comment: node ? commentIdsAt(node, el).find(id => commentsRef.current.some(c => c.id === id)) : null,
        change: node ? (changeOf(node, el)?.tagName === 'INS' ? 'ins' : changeOf(node, el) ? 'del' : null) : null,
      },
    })
  }
  const runMenu = act => {
    const el = ref.current
    const ctx = menu?.ctx || {}
    setMenu(null)
    el?.focus({ preventScroll: true })
    if (act === 'cut') document.execCommand('cut')
    else if (act === 'copy') document.execCommand('copy')
    else if (act === 'paste' || act === 'pasteplain') {
      navigator.clipboard?.readText?.().then(t => { if (t) run('insertText', t) }).catch(() => {})
    }
    else if (act === 'link') openLink()
    else if (act === 'unlink') command(root => { const a = caretElement(root)?.closest?.('a'); if (a) a.replaceWith(...a.childNodes); return true })
    else if (act === 'comment') { if (ctx.comment) setActiveId(ctx.comment); else addComment() }
    else if (act === 'footnote') addFootnote()
    else if (act === 'acceptChange') acceptOrReject(true, false)
    else if (act === 'rejectChange') acceptOrReject(false, false)
    else if (['rowAbove', 'rowBelow', 'colLeft', 'colRight', 'delRow', 'delCol', 'delTable'].includes(act)) command(root => tableOp(root, act))
    else if (act === 'h1' || act === 'h2') setStyle(act)
    else if (act === 'p') setStyle('normal')
    else if (act === 'clear') command(root => clearFormatting(root))
    else if (act === 'paragraph') run('paragraphDialog')
    else if (act === 'pagebreak') insertHtml(PAGE_BREAK_HTML)
    else if (act === 'all') { const r = document.createRange(); r.selectNodeContents(el); setRange(r) }
  }

  const applyLink = (href, label) => {
    const safe = safeLinkUrl(/^[a-z][a-z0-9+.-]*:/i.test(href) ? href : 'https://' + href)
    if (!safe) return 'That is not a web or mail link.'
    const el = ref.current
    el.focus({ preventScroll: true })
    setRange(link.range)
    const escA = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    command(() => {
      if (link.anchor) link.anchor.setAttribute('href', safe)
      else if (link.range.collapsed) document.execCommand('insertHTML', false, `<a href="${escA(safe)}">${escA(label || safe)}</a>`)
      else document.execCommand('createLink', false, safe)
      return true
    })
    setLink(null)
    return null
  }

  /* Double-click the top or bottom margin of a page: edit its header or
     footer, as in Word. */
  const onDoubleClick = e => {
    const el = ref.current
    const p = localPoint(el, e.clientX, e.clientY)
    const page = pageIndexAt(pagesView, p.y)
    const pg = pagesView[page]
    const within = p.y - pg.top
    if (within < 0 || within > pg.h) return
    if (within < pg.mt) { e.preventDefault(); setHfEdit({ zone: 'header', page }) }
    else if (within > pg.h - pg.mb) { e.preventDefault(); setHfEdit({ zone: 'footer', page }) }
  }
  const onMouseUp = () => {
    const pnt = painterRef.current
    if (!pnt) return
    const el = ref.current
    const r = rangeIn(el)
    if (!r) return
    command(root => applyFormat(root, pnt.fmt))
    if (!pnt.sticky) setPainter(null)
  }
  const onClick = e => {
    const el = ref.current
    const a = e.target.closest?.('a[href]')
    if (a && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      const safe = safeLinkUrl(a.getAttribute('href'))
      if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
      return
    }
    const row = e.target.closest?.('[data-ds-toc-l]')
    if (row) {
      const rows = [...row.parentElement.querySelectorAll('[data-ds-toc-l]')]
      const heads = layoutRef.current.heads.filter(h => h.level <= 3)
      const h = heads[rows.indexOf(row)]
      if (h) goToHead(h)
      return
    }
    const fn = e.target.closest?.('[data-ds-fn]')
    if (fn) { setNoteFocus(fn.getAttribute('data-ds-fn')); return }
    if (e.target.closest?.('[data-ds-cite]')) { setDialog({ kind: 'sources' }); return }
    void el
  }
  const goToHead = h => {
    const el = ref.current
    if (!h?.el?.isConnected) return
    el.focus({ preventScroll: true })
    const r = document.createRange(); r.selectNodeContents(h.el); r.collapse(true); setRange(r)
    const s = scrollRef.current
    if (s) s.scrollTo({ top: Math.max(0, offsetIn(h.el, el) * scale - 24), behavior: 'smooth' })
  }

  /* Keys the canvas would otherwise act on while a popover is open. */
  useEffect(() => {
    if (!hfEdit) return
    const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); ev.__dsConsumed = true; setHfEdit(null) } }
    const down = ev => { if (!ev.target.closest?.('[data-ds-hf-edit]') && !ev.target.closest?.('[data-ds-hf-bar]') && !ev.target.closest?.('button,label,input')) setHfEdit(null) }
    window.addEventListener('keydown', key, true)
    window.addEventListener('mousedown', down, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('mousedown', down, true) }
  }, [hfEdit])

  /* ── Render ───────────────────────────────────────────────────────────── */
  const pageVars = {
    '--pg-bg': pal.bg, '--pg-text': pal.text, '--pg-mute': pal.mute, '--pg-rule': pal.rule,
    '--pg-th': pal.th, '--pg-link': pal.link, '--pg-head': pal.head, '--pg-head2': pal.head2,
    '--pg-pt': geo0.mt + 'px', '--pg-pl': editorLeft + 'px',
  }
  const notesGrouped = () => {
    const byPage = new Map()
    const el = ref.current
    if (!el) return byPage
    const { notePage } = layoutRef.current
    el.querySelectorAll('[data-ds-fn]').forEach((s, i) => {
      const id = s.getAttribute('data-ds-fn')
      const p = notePage.get(id) ?? pageIndexAt(pagesRef.current, offsetIn(s, el))
      if (!byPage.has(p)) byPage.set(p, [])
      byPage.get(p).push({ id, n: i + 1, text: notesRef.current[id] || '' })
    })
    return byPage
  }
  const notesByPage = useMemo(notesGrouped, [layoutTick, block.footnotes]) // eslint-disable-line react-hooks/exhaustive-deps
  const uids = useMemo(() => {
    const el = ref.current
    if (!el) return []
    return [...new Set([...el.querySelectorAll(CHANGE_SEL)].map(c => c.getAttribute('data-ds-uid')))]
  }, [layoutTick])
  const dynCss = [
    changeColorsCss('[data-ds-doc]', uids, authorHue),
    ...comments.filter(c => c.resolved).map(c => `[data-ds-doc] [data-ds-comment="${c.id.replace(/["\\]/g, '')}"] { background: none; border-bottom: 0; }`),
    activeId?.startsWith('c_') ? `[data-ds-doc] [data-ds-comment="${activeId.replace(/["\\]/g, '')}"] { background: rgba(250, 204, 21, 0.55); }` : '',
    showMarkup ? '' : '[data-ds-doc] del[data-ds-uid] { display: none; } [data-ds-doc] ins[data-ds-uid] { color: inherit !important; text-decoration: none; }',
    '[data-ds-note] [contenteditable]:empty::before { content: attr(data-placeholder); color: var(--pg-mute); }',
  ].join('\n')
  const headIdx = useMemo(() => {
    const heads = layoutRef.current.heads
    const el = ref.current
    const r = rangeIn(el)
    if (!r || !heads.length) return heads.findIndex(h => h.pageNo >= currentPage)
    let idx = -1
    heads.forEach((h, i) => { if (h.el.isConnected && r.comparePoint(h.el, 0) <= 0) idx = i })
    return idx
  }, [selTick, layoutTick, currentPage])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: base, fontFamily: 'var(--ds-font-body)' }}>
      <style>{docCss('[data-ds-doc]') + docScreenCss('[data-ds-doc]') + dynCss}</style>

      {block.showRuler && (
        <Ruler block={block} metrics={metrics} colors={colors} scale={scale} editorRef={ref} selTick={selTick}
          onUpdateBlock={onUpdateBlock} onParagraphChange={() => handleInput({ inputType: null })} padX={SCROLL_PAD_X} docW={docW}
          page={rulerPage} />
      )}
      {find && (
        <FindBar state={find} count={matches.length} index={Math.min(findIdx, Math.max(0, matches.length - 1))} focusTick={findFocus}
          onChange={s => { setFind(s); setFindIdx(0) }} onNext={() => findStep(1)} onPrev={() => findStep(-1)}
          onReplace={replaceOne} onReplaceAll={replaceEvery} onClose={closeFind} />
      )}
      {painter && (
        <div role="status" style={{ padding: '4px 12px', fontSize: 12, color: 'var(--ds-accent)', background: 'var(--ds-accent-dim)', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
          Format painter: select text to copy the format onto it{painter.sticky ? ' (stays on — Esc to stop)' : ''}.
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {block.showNav && <NavPane heads={layoutRef.current.heads} current={headIdx} onGo={i => goToHead(layoutRef.current.heads[i])} onClose={() => patch({ showNav: false })} />}

        {/* ── The desk and its sheets ── */}
        <div ref={scrollRef} onScroll={onScroll} data-ds-desk=""
          style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: `${SCROLL_PAD_TOP}px ${SCROLL_PAD_X}px 32px` }}>
          <div style={{ width: docW * scale, height: totalH * scale, margin: '0 auto', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, width: docW,
              transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: '0 0',
              ...pageVars,
            }}>
             <div style={{ position: 'absolute', left: originX, top: 0, width: docW - originX }}>
              {/* The sheets. Decorative, so they never take a click. */}
              <div aria-hidden="true">
                {pagesView.map((pg, i) => (
                  <div key={i} data-ds-page={i + 1} data-ds-page-label={pg.label} style={{
                    position: 'absolute', left: pg.x, top: pg.top, width: pg.w, height: pg.h,
                    background: pal.bg, pointerEvents: 'none',
                    boxShadow: 'var(--ds-shadow-sm), var(--ds-shadow-md)',
                  }} />
                ))}
              </div>
              <WatermarkLayer text={block.watermark} pages={pagesView} pal={pal} />
              <HeaderFooterLayer pages={pagesView} hf={block.hf} legacyFooter
                font={fStack} fontPt={HF_PT} pal={pal} title={block.name} editing={hfEdit}
                onChange={hf => patch({ hf })} onClose={() => { setHfEdit(null); ref.current?.focus({ preventScroll: true }) }} />

              <div
                ref={ref}
                data-ds-doc=""
                data-ds-text=""
                data-marks={block.showMarks ? '' : undefined}
                data-empty={empty ? '' : undefined}
                contentEditable
                suppressContentEditableWarning
                spellCheck
                role="textbox"
                aria-multiline="true"
                aria-label="Document body"
                onFocus={() => {
                  onEditStart?.()
                  try { document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* old engines */ }
                }}
                onBlur={() => {
                  persist()
                  onEditEnd?.()
                  const p = pendingRemote.current
                  pendingRemote.current = null
                  if (p != null && p !== savedContent.current) writeIn(p)
                }}
                onCompositionStart={() => {
                  composing.current = true
                  /* Where the composition starts: with track changes on, the
                     finished text is re-entered as a tracked insertion. */
                  const r = rangeIn(ref.current)
                  compStart.current = blockRef.current.trackChanges && r ? (() => { const c = r.cloneRange(); c.collapse(true); return c })() : null
                }}
                onCompositionEnd={e => {
                  composing.current = false
                  const start = compStart.current
                  compStart.current = null
                  const text = e.data || ''
                  const r = rangeIn(ref.current)
                  if (start && text && r && blockRef.current.trackChanges) {
                    const span = document.createRange()
                    try { span.setStart(start.startContainer, start.startOffset); span.setEnd(r.endContainer, r.endOffset) } catch { handleInput({ inputType: 'insertText' }); return }
                    if (span.toString() === text) {
                      guard.current = true
                      try { span.deleteContents(); span.collapse(true); setRange(span) } finally { guard.current = false }
                      trackedType(text)
                      return
                    }
                  }
                  handleInput({ inputType: 'insertText' })
                }}
                onInput={onInput}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onCopy={onCopy}
                onCut={onCut}
                onContextMenu={onContextMenu}
                onClick={onClick}
                onDoubleClick={onDoubleClick}
                onMouseUp={onMouseUp}
                onDragStart={e => { if (e.target?.tagName === 'IMG') e.preventDefault() }}
                onMouseDown={e => {
                  const divider = e.target.closest?.('[data-type="col-divider"]')
                  if (divider) { e.preventDefault(); e.stopPropagation(); startColumnResize(divider, e); return }
                  setImgSel(e.target?.tagName === 'IMG' ? e.target : null)
                  e.stopPropagation()
                }}
                style={{
                  position: 'relative', zIndex: 1,
                  width: editorW, boxSizing: 'border-box',
                  paddingTop: geo0.mt,
                  paddingBottom: geo0.mb,
                  paddingLeft: editorLeft,
                  paddingRight: editorRight,
                  minHeight: totalH,
                  outline: 'none',
                  color: pal.text,
                  fontFamily: fStack,
                  fontSize: fontPt * PT_TO_PX,
                  lineHeight: block.lineSpacing || 1.5,
                  textIndent: (block.indentFirst || 0) * 96,
                  cursor: painter ? 'copy' : 'text',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  opacity: hfEdit ? 0.5 : 1,
                  transition: 'opacity 120ms',
                }}
              />

              <FootnoteLayer byPage={notesByPage} pages={pagesView} style={noteStyle(fStack, fontPt)} pal={pal}
                heights={layoutRef.current.noteHeights} onEdit={editNote} focusId={noteFocus} onFocused={() => setNoteFocus(null)} onBack={backToRef} />
              <div ref={noteMeasureRef} aria-hidden="true" style={{ ...noteStyle(fStack, fontPt), position: 'absolute', left: -99999, top: 0, width: contentW, visibility: 'hidden' }} />

              {imgSel && <ImageTools img={imgSel} root={ref.current} scale={scale} contentW={contentW}
                onChange={layout => command(() => { if (typeof layout === 'string') setImageLayout(imgSel, layout); return true })}
                onCaption={addCaption}
                onAlt={() => setDialog({ kind: 'alt', img: imgSel })}
                onDelete={() => { const img = imgSel; setImgSel(null); command(() => { img.remove(); return true }) }} />}
              {tableSel && !imgSel && <TableTools table={tableSel} root={ref.current} onOp={op => command(root => tableOp(root, op))} />}

              {railOn && (
                <DocRail items={railItems} activeId={activeId} left={pagesRight + RAIL_GAP} width={RAIL_W}
                  onActivate={activate} api={railApi} />
              )}
             </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── STATUS BAR ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        padding: '4px 12px', borderTop: `1px solid ${border}`, background: raised,
        fontFamily: 'var(--ds-font-body)', fontSize: 12, color: text3,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        <PageJump current={currentPage} pages={pages} onGo={goToPage} />
        {block.showWordCount !== false && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => setDialog({ kind: 'stats' })} title="Word count"
              style={{ background: 'none', border: 'none', padding: '1px 4px', margin: '-1px -4px', borderRadius: 4, cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
              {live.words.toLocaleString()} {live.words === 1 ? 'word' : 'words'}
            </button>
          </>
        )}
        {block.trackChanges && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => run('track')} title="Track changes is on (Ctrl+Shift+E)"
              style={{ background: 'none', border: 'none', padding: '1px 4px', margin: '-1px -4px', borderRadius: 4, cursor: 'pointer', color: 'var(--ds-accent)', font: 'inherit' }}>
              Tracking changes
            </button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <ZoomMenu zoom={zoom} scale={scale} onZoom={z => patch({ zoom: z })} />
      </div>

      {menu && <DocMenu at={menu} ctx={menu.ctx} onPick={runMenu} onClose={() => setMenu(null)} />}
      {link && <LinkPop at={link} onApply={applyLink} onClose={() => setLink(null)}
        onRemove={link.anchor ? () => { command(() => { link.anchor.replaceWith(...link.anchor.childNodes); return true }); setLink(null) } : null} />}
      {pasteChip && <PasteChip at={pasteChip} onDone={() => setPasteChip(null)}
        onTextOnly={() => {
          const chip = pasteChip
          setPasteChip(null)
          restore(chip.before)
          run('insertText', chip.text)
        }} />}

      {dialog?.kind === 'stats' && (() => {
        const el = ref.current
        const s = statsOf(countableText(el))
        const r = rangeIn(el)
        const selStats = r && !r.collapsed ? statsOf(countableText(el, r)) : null
        return <StatsDialog onClose={() => setDialog(null)} stats={{
          ...s, pages, paragraphs: el ? [...el.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote')].filter(p => p.textContent.trim() && !p.closest('[data-ds-toc],[data-ds-bib]')).length : 0,
          notes: el ? el.querySelectorAll('[data-ds-fn]').length : 0, comments: comments.filter(c => !c.resolved).length, selection: selStats,
        }} />
      })()}
      {dialog?.kind === 'paragraph' && dialog.init && (
        <ParagraphDialog initial={dialog.init} onClose={() => setDialog(null)} onApply={v => {
          const r = dialog.range
          setDialog(null)
          ref.current.focus({ preventScroll: true })
          if (r) setRange(r)
          command(root => { applyParagraphValues(paragraphsIn(root), v); return true })
        }} />
      )}
      {dialog?.kind === 'font' && (
        <FontDialog initial={dialog.init} onClose={() => setDialog(null)} onApply={v => {
          const r = dialog.range
          setDialog(null)
          ref.current.focus({ preventScroll: true })
          if (r) setRange(r)
          command(root => {
            const q = c => { try { return document.queryCommandState(c) } catch { return false } }
            const cur = rangeIn(root)
            if (cur && !cur.collapsed) {
              for (const [cmd, on] of [['bold', v.bold], ['italic', v.italic], ['underline', v.underline], ['strikeThrough', v.strike]]) if (q(cmd) !== !!on) document.execCommand(cmd)
              if (v.pos === 'sup' && !q('superscript')) document.execCommand('superscript')
              if (v.pos === 'sub' && !q('subscript')) document.execCommand('subscript')
              if (!v.pos) { if (q('superscript')) document.execCommand('superscript'); if (q('subscript')) document.execCommand('subscript') }
            }
            const isDefault = v.font === (block.font || 'Inter')
            const stack = fontStack(v.font)
            applyInlineStyle(root, {
              fontFamily: isDefault ? '' : (stack.startsWith('var(') ? `'${v.font}', ${stack}` : stack),
              fontSize: v.size + 'pt',
              fontVariant: v.smallCaps ? 'small-caps' : '',
              textTransform: v.allCaps ? 'uppercase' : '',
              color: v.color || '',
            })
            return true
          })
        }} />
      )}
      {dialog?.kind === 'sources' && (
        <SourcesDialog sources={block.sources} style={block.citeStyle} onClose={() => setDialog(null)}
          onSave={(list, st) => patch({ sources: list, citeStyle: st })}
          onInsert={(src, st) => {
            setDialog(null)
            patch({ citeStyle: st })
            const el = ensureCaret()
            el.focus({ preventScroll: true })
            insertInline(citeHtml(src, st))
          }} />
      )}
      {dialog?.kind === 'versions' && (
        <VersionsDialog docId={block.id} current={savedContent.current || ''} onClose={() => setDialog(null)}
          onRestore={html => {
            setDialog(null)
            saveVersion(block.id, savedContent.current || '', 'Before restoring an older version').catch(() => {})
            const el = ref.current
            el.focus({ preventScroll: true })
            command(root => { root.innerHTML = sanitizeEditorHtml(html); divsToParagraphs(root); normalizeRoot(root); return true })
          }} />
      )}
      {dialog?.kind === 'pagesize' && (
        <PageSizeDialog initial={block.pageCustom || { w: metrics.page.w, h: metrics.page.h }} onClose={() => setDialog(null)}
          onApply={c => { setDialog(null); patch({ pageSize: 'custom', pageCustom: c, orientation: 'portrait' }) }} />
      )}
      {dialog?.kind === 'section' && (
        <SectionDialog index={dialog.index} count={dialog.count} initial={dialog.init} onClose={() => setDialog(null)}
          onApply={v => { const i = dialog.index; setDialog(null); setSection(i, v) }}
          onRemove={() => { const br = breaksIn(ref.current)[dialog.index - 1]; setDialog(null); if (br) command(() => { br.remove(); return true }) }} />
      )}
      {dialog?.kind === 'watermark' && (
        <TextDialog title="Watermark" label="Text across every page" initial={block.watermark || ''} placeholder="DRAFT, CONFIDENTIAL…"
          hint="Leave empty for no watermark. It prints too." onClose={() => setDialog(null)}
          onApply={v => { setDialog(null); patch({ watermark: v.slice(0, 40) }) }} />
      )}
      {dialog?.kind === 'alt' && (
        <TextDialog title="Alt text" label="Describe the picture" multiline initial={dialog.img?.getAttribute('alt') || ''}
          hint="Read aloud by screen readers, and shown if the picture cannot load." onClose={() => setDialog(null)}
          onApply={v => { const img = dialog.img; setDialog(null); command(() => { img?.setAttribute('alt', v); return true }) }} />
      )}
    </div>
  )
}

export default memo(DocumentBlockInner)

/* Re-exported for callers that place things over the page. */
export { offsetLeftIn }
