/*
  lib/docpages.js
  --------------------------------------------------------------------------
  REAL PAGES FOR THE DOCUMENT BLOCK: the page layout pass.

  The editor is ONE contentEditable laid over a stack of sheets. After every
  edit, `paginate` walks the flow and moves whatever would cross a page's
  bottom margin to the top of the next sheet. Two kinds of move, both marked
  so they can be stripped before anything is saved:

    · a PUSH — a top margin on a whole block (`data-ds-pushed`);
    · a GAP — a block-level spacer INSIDE a block (`[data-ds-gap]`): a long
      paragraph continues on the next page line by line, a long table row
      by row.

  Word's widow and orphan control holds (two lines each side), headings stay
  with what follows them, captions with their table or figure, a page break
  sends what follows to the next sheet, and footnotes take room at the
  bottom of the page their reference lands on.

  ── PAGES ARE A LIST, NOT A STRIDE ─────────────────────────────────────────
  Section breaks (lib/docsections.js) can turn a page landscape, so pages no
  longer share one height. The pass builds the page list as the flow reaches
  each page — a page's geometry is its section's — and every "which page is
  this y on" question asks that list.

  With mixed orientations the editor is as wide as the widest page, and the
  blocks of a narrower section get a layout-only `max-width`
  (`data-ds-sx`), stripped with the pushes.

  ── SPEED ─────────────────────────────────────────────────────────────────
  Every position is read ONCE, every move is decided arithmetically, and all
  of them are written together, then checked once. If the check finds a move
  landed somewhere else — margin collapsing the arithmetic did not model —
  the pass is redone the careful way, reading after every write.
  -------------------------------------------------------------------------- */

import { stripTabWidths } from './doctabs.js'

export const PAGE_GAP = 24
const HEADING = /^H[1-6]$/
const TEXTY = /^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6])$/

/* ── Clearing ─────────────────────────────────────────────────────────── */

function clearPush(el) {
  if (el.hasAttribute?.('data-ds-pushed')) {
    el.style.removeProperty('margin-top')
    el.removeAttribute('data-ds-pushed')
  }
  if (el.hasAttribute?.('data-ds-sx')) {
    el.style.removeProperty('max-width')
    el.removeAttribute('data-ds-sx')
  }
  if (el.getAttribute && el.hasAttribute('style') && !el.getAttribute('style')) el.removeAttribute('style')
}

/** Remove every push, gap and section width. The live selection survives:
 *  removing a node and Node.normalize() both move live ranges (DOM spec). */
export function clearLayout(root) {
  if (!root) return 0
  let n = 0
  root.querySelectorAll('[data-ds-pushed],[data-ds-sx]').forEach(el => { clearPush(el); n++ })
  const parents = new Set()
  root.querySelectorAll('[data-ds-gap]').forEach(g => { parents.add(g.parentNode); g.remove(); n++ })
  parents.forEach(p => p && p.normalize())
  return n
}

/** Remove the gaps inside one block only — before Backspace or Delete acts
 *  next to one, so the key deletes a character and not the spacer. */
export function clearGapsIn(el) {
  const gaps = el ? el.querySelectorAll('[data-ds-gap]') : []
  if (!gaps.length) return false
  const parents = new Set()
  gaps.forEach(g => { parents.add(g.parentNode); g.remove() })
  parents.forEach(p => p && p.normalize())
  return true
}

/** Strip layout from a CLONE — what storage and export see. */
export function stripLayoutHtml(root) {
  const c = root.cloneNode(true)
  clearLayout(c)
  stripTabWidths(c)
  return c
}

/* ── Units ────────────────────────────────────────────────────────────── */

/** What pagination moves: top-level blocks, except that lists are paged item
 *  by item (nested lists ride with their item). */
export function pageUnits(root) {
  const out = []
  for (const k of root.children) {
    if ((k.tagName === 'UL' || k.tagName === 'OL') && k.children.length) {
      for (const li of k.children) if (li.tagName === 'LI') out.push(li)
    } else out.push(k)
  }
  return out
}

export const offsetIn = (el, root) => {
  let y = 0, n = el
  while (n && n !== root) { y += n.offsetTop; n = n.offsetParent }
  return y
}
export const offsetLeftIn = (el, root) => {
  let x = 0, n = el
  while (n && n !== root) { x += n.offsetLeft; n = n.offsetParent }
  return x
}

const isBreak = el => el.hasAttribute?.('data-ds-pagebreak') || el.hasAttribute?.('data-ds-sectionbreak')
const isSection = el => el.hasAttribute?.('data-ds-sectionbreak')
const isColumns = el => el.dataset?.type === 'columns'
const canSplitText = el => TEXTY.test(el.tagName) && !isColumns(el) && !isBreak(el)
  && !el.hasAttribute?.('data-ds-toc') && !el.querySelector('img,table,ul,ol,[data-type]')
const isTable = el => el.tagName === 'TABLE'

/* ── The page list ────────────────────────────────────────────────────── */

/* geom.sections[s] = { w, h, mt, mb, left, right, contentW, mirror } */
function makeBook(geom) {
  const secs = geom.sections
  const pages = []
  const add = sec => {
    const prev = pages[pages.length - 1]
    const g = secs[sec] || secs[0]
    pages.push({ top: prev ? prev.top + prev.h + PAGE_GAP : 0, h: g.h, w: g.w, mt: g.mt, mb: g.mb, sec })
    return pages.length - 1
  }
  add(0)
  const at = k => { while (pages.length <= k) add(pages[pages.length - 1].sec); return pages[k] }
  /** The page a y falls on, scanning from page `from` (y in a gap counts
   *  for the page above it). */
  const indexOf = (y, from = 0) => {
    let k = Math.max(0, from)
    for (let guard = 0; guard < 5000; guard++) {
      const p = at(k)
      if (y < p.top + p.h + PAGE_GAP) return k
      k++
    }
    return k
  }
  /** Start a new section on the page after k: drop anything planned past k
   *  and add the page with the new section's geometry. */
  const startSection = (k, sec) => {
    if (pages[k + 1] && pages[k + 1].sec === sec) return k + 1
    pages.length = k + 1
    return add(sec)
  }
  return { pages, at, indexOf, startSection }
}

/** Two page lists that lay out the same (so React state can stay put). */
export function samePages(a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i]
    if (p.top !== q.top || p.h !== q.h || p.w !== q.w || p.sec !== q.sec || p.mt !== q.mt || p.mb !== q.mb) return false
  }
  return true
}

/** Which page (0-based) a y is on, for a finished page list. */
export function pageIndexAt(list, y) {
  if (!list?.length) return 0
  for (let k = 0; k < list.length; k++) if (y < list[k].top + list[k].h + PAGE_GAP) return k
  return list.length - 1
}

/** Section index per unit: a section break belongs to the section it ends. */
function sectionIndexes(units) {
  const out = new Array(units.length)
  let s = 0
  for (let i = 0; i < units.length; i++) { out[i] = s; if (isSection(units[i])) s++ }
  return out
}

/* ── Line measurement ─────────────────────────────────────────────────── */

/* Client rects are in SCREEN pixels (the page is scaled, the canvas zoomed);
   converted back through the root's measured scale. */
function rootFrame(root) {
  const r = root.getBoundingClientRect()
  const s = root.offsetHeight ? r.height / root.offsetHeight : 1
  return { top: r.top, s: s || 1 }
}

/** The lines of a text block: where each line box starts (editor px) and the
 *  DOM point where its text starts. A line starts halfway between the
 *  previous line's glyph bottom and its own glyph top. */
function measureTextLines(el, root, frame) {
  const frags = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.data.length && !n.parentElement?.closest?.('[data-ds-gap],[data-ds-tab]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  const rg = document.createRange()
  const y = v => (v - frame.top) / frame.s
  let n
  while ((n = walker.nextNode())) {
    rg.selectNodeContents(n)
    const rects = [...rg.getClientRects()].filter(r => r.height > 0)
    if (!rects.length) continue
    let prevTop = null
    for (const r of rects) {
      if (prevTop != null && Math.abs(r.top - prevTop) < 1) continue
      let off = 0
      if (prevTop != null) {
        let lo = 0, hi = n.data.length - 1
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          rg.setStart(n, mid); rg.setEnd(n, mid + 1)
          const cr = rg.getClientRects()[0] || rg.getBoundingClientRect()
          if (cr.top >= r.top - 1) hi = mid; else lo = mid + 1
        }
        off = lo
      }
      frags.push({ gTop: y(r.top), gBot: y(r.bottom), node: n, off })
      prevTop = r.top
    }
  }
  const lines = []
  for (const f of frags.sort((a, b) => a.gTop - b.gTop)) {
    const last = lines[lines.length - 1]
    if (last && f.gTop < last.gBot - 2) {
      last.gBot = Math.max(last.gBot, f.gBot)
      last.gTop = Math.min(last.gTop, f.gTop)
      continue
    }
    lines.push({ gTop: f.gTop, gBot: f.gBot, node: f.node, off: f.off })
  }
  const elTop = offsetIn(el, root)
  const cs = getComputedStyle(el)
  const padTop = parseFloat(cs.paddingTop) || 0, bdTop = parseFloat(cs.borderTopWidth) || 0
  return lines.map((l, i) => ({
    top: i === 0 ? elTop + padTop + bdTop : (lines[i - 1].gBot + l.gTop) / 2,
    node: l.node, off: l.off,
  }))
}

function measureTableLines(table, root) {
  const tTop = offsetIn(table, root)
  return [...table.rows].filter(r => !r.hasAttribute('data-ds-gap')).map(r => ({ top: tTop + r.offsetTop, row: r }))
}

function notesIn(el, root) {
  const refs = el.querySelectorAll?.('[data-ds-fn]')
  if (!refs || !refs.length) return null
  return [...refs].map(r => ({ id: r.getAttribute('data-ds-fn'), y: offsetIn(r, root) }))
}

/* ── Section widths ───────────────────────────────────────────────────── */

/* With mixed orientations the editor is as wide as the widest section; a
   block in a narrower section is capped to its own text column. Reads all,
   then writes all. */
function applySectionWidths(root, units, secOf, geom) {
  const widest = geom.contentW
  const edLeft = geom.editorLeft
  const jobs = []
  for (let i = 0; i < units.length; i++) {
    const g = geom.sections[secOf[i]]
    if (!g || g.contentW >= widest - 0.5) continue
    const u = units[i]
    if (isBreak(u)) continue
    const cs = getComputedStyle(u)
    const px = v => parseFloat(v) || 0
    const x = offsetLeftIn(u, root) - edLeft
    const box = cs.boxSizing === 'border-box' ? 0 : px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth)
    jobs.push({ u, max: Math.max(24, g.contentW - x - px(cs.marginRight) - box) })
  }
  for (const j of jobs) { j.u.setAttribute('data-ds-sx', ''); j.u.style.maxWidth = j.max + 'px' }
  return jobs.length
}

/* ── The plan ─────────────────────────────────────────────────────────── */

/**
 * Lay the flow out on pages.
 * @param {HTMLElement} root  the editor (offsetParent of its children, first
 *        page's top margin as padding-top)
 * @param {{ sections: object[], contentW:number, editorLeft:number,
 *           notes?: Map<string,number>, noteSep?: number }} geom
 * @returns {{ pages:number, pageList:object[], notePage:Map, heads:Array }}
 */
export function paginate(root, geom) {
  const empty = { pages: 1, pageList: makeBook(geom).pages, notePage: new Map(), heads: [] }
  if (!root) return empty
  clearLayout(root)
  let units = pageUnits(root)
  if (!units.length) return empty
  const secOf = sectionIndexes(units)
  if (geom.sections.length > 1) applySectionWidths(root, units, secOf, geom)
  const frame = rootFrame(root)
  const plan = planLayout(root, units, secOf, geom, frame)
  applyPlan(plan)
  let bad = -1
  for (const m of plan.moves) {
    if (m.kind !== 'push') continue
    /* offsetTop is whole pixels, so a correct move can read a pixel off. */
    if (Math.abs(offsetIn(m.el, root) - m.target) > 1.5) { bad = m.index; break }
  }
  let result = plan
  if (bad >= 0) {
    clearLayout(root)
    units = pageUnits(root)
    if (geom.sections.length > 1) applySectionWidths(root, units, secOf, geom)
    result = carefulLayout(root, units, secOf, geom, rootFrame(root))
  }
  const list = result.pageList
  return { pages: list.length, pageList: list, notePage: result.notePage, heads: headsOf(root, list) }
}

function headsOf(root, list) {
  const out = []
  root.querySelectorAll('h1,h2,h3,h4,[data-ds-style="title"]').forEach(h => {
    if (h.closest('[data-ds-toc]')) return
    const text = h.textContent.replace(/​/g, '').trim()
    if (!text) return
    const level = h.getAttribute('data-ds-style') === 'title' ? 0 : Number(h.tagName[1])
    out.push({ el: h, level, text, pageIndex: pageIndexAt(list, offsetIn(h, root)) })
  })
  return out
}

/* Notes bookkeeping shared by both paths. */
function makeNotes(geom) {
  const notes = geom.notes || new Map()
  const noteSep = geom.noteSep || 14
  const reserved = new Map(), notePage = new Map()
  const resOf = p => reserved.get(p) || 0
  const need = (p, ids) => {
    let h = 0
    for (const id of ids) if (!notePage.has(id)) h += notes.get(id) || 0
    return h ? h + (resOf(p) ? 0 : noteSep) : 0
  }
  const add = (p, ids) => {
    for (const id of ids) {
      if (notePage.has(id)) continue
      notePage.set(id, p)
      reserved.set(p, resOf(p) + (notes.get(id) || 0) + (resOf(p) ? 0 : noteSep))
    }
  }
  const snap = () => ({ reserved: new Map(reserved), notePage: new Map(notePage) })
  const restore = s => { reserved.clear(); s.reserved.forEach((v, k) => reserved.set(k, v)); notePage.clear(); s.notePage.forEach((v, k) => notePage.set(k, v)) }
  return { notes, noteSep, reserved, notePage, resOf, need, add, snap, restore }
}

function pageCount(book, lastBottom, page, notes, pendingSection) {
  let n = Math.max(page + 1, book.indexOf(Math.max(0, lastBottom - 1)) + 1)
  for (const p of notes.reserved.keys()) n = Math.max(n, p + 1)
  return n + (pendingSection ? 1 : 0)
}

function planLayout(root, units, secOf, geom, frame) {
  const book = makeBook(geom)
  const nb = makeNotes(geom)
  const n = units.length
  const T = new Array(n), H = new Array(n)
  for (let i = 0; i < n; i++) { T[i] = offsetIn(units[i], root); H[i] = units[i].offsetHeight }

  const S = new Array(n).fill(0)
  let moves = []
  let shift = 0, page = 0, forceNext = false, pendingSec = null, lastBottom = 0
  const noteSnap = new Map()
  const bottomOf = (p, extra = 0) => { const pg = book.at(p); return pg.top + pg.h - pg.mb - nb.resOf(p) - extra }
  const topOf = p => { const pg = book.at(p); return pg.top + pg.mt }

  let guard = 0
  for (let i = 0; i < n; i++) {
    /* A backstop, never expected to trip: a layout that keeps rewinding
       stops here rather than hanging the page. */
    if (++guard > n * 30 + 100) break
    S[i] = shift
    noteSnap.set(i, { ...nb.snap(), page, forceNext, pendingSec, pages: book.pages.length })
    const k = units[i]
    const t = T[i] + shift
    if (isBreak(k)) {
      forceNext = true
      page = book.indexOf(t, page)
      if (isSection(k)) pendingSec = secOf[i] + 1
      continue
    }
    const b = t + H[i]
    let p = book.indexOf(t, page)
    if (forceNext) {
      /* The page after the break, in the new section's geometry if a
         section starts here. */
      const next = pendingSec != null ? book.startSection(page, pendingSec) : page + 1
      pendingSec = null
      forceNext = false
      if (p < next) {
        const target = topOf(next)
        moves.push({ kind: 'push', index: i, el: k, d: target - t, target })
        shift = S[i] + (target - t)
        page = next
        const tt = T[i] + shift
        const refs = (notesIn(k, root) || []).map(r => r.id)
        if (tt + H[i] > bottomOf(page, nb.need(page, refs)) + 0.5) {
          const sp = trySplit(k, i, root, frame, T, shift, page, book, nb)
          if (sp) { moves.push(...sp.moves); shift += sp.added; page = sp.page; lastBottom = Math.max(lastBottom, T[i] + shift + H[i]); continue }
        }
        nb.add(page, refs)
        lastBottom = Math.max(lastBottom, tt + H[i])
        continue
      }
      p = Math.max(p, next)
    }
    const cTop = topOf(p)
    const refs = notesIn(k, root)
    const ids = refs ? refs.map(r => r.id) : []
    const cBot = bottomOf(p, nb.need(p, ids))
    let target = null, who = i

    if (t < cTop - 1) {
      target = cTop                                        // in a gap or a top margin
    } else if (b > cBot + 0.5) {
      const split = trySplit(k, i, root, frame, T, shift, p, book, nb)
      if (split) {
        moves.push(...split.moves)
        shift += split.added
        page = split.page
        lastBottom = Math.max(lastBottom, T[i] + shift + H[i])
        continue
      }
      if (t <= cTop + 1) {                                 // already at the top: let it run over
        page = p
        nb.add(page, ids)
        lastBottom = Math.max(lastBottom, b)
        continue
      }
      target = topOf(p + 1)
      const j = keepWith(units, i)
      if (j < i) {
        const wt = T[j] + S[j], wp = book.indexOf(wt, 0)
        if (wp === p && wt > topOf(wp) + 1) who = j
      }
    }

    if (target != null) {
      const wt = T[who] + S[who]
      if (target > wt) {
        moves = moves.filter(m => m.index < who)
        if (who !== i) nb.restore(noteSnap.get(who))
        const d = target - wt
        moves.push({ kind: 'push', index: who, el: units[who], d, target })
        shift = S[who] + d
        const tt = T[who] + shift
        page = book.indexOf(tt, page)
        if (who !== i) {
          i = who; S[i] = S[who]
          lastBottom = Math.max(lastBottom, tt + H[who])
          nb.add(page, (notesIn(units[who], root) || []).map(r => r.id))
          continue
        }
        /* Moved whole to a fresh page and STILL taller than it: split there. */
        if (tt + H[i] > bottomOf(page, nb.need(page, ids)) + 0.5) {
          const again = trySplit(k, i, root, frame, T, shift, page, book, nb)
          if (again) { moves.push(...again.moves); shift += again.added; page = again.page; lastBottom = Math.max(lastBottom, T[i] + shift + H[i]); continue }
        }
        nb.add(page, ids)
        lastBottom = Math.max(lastBottom, tt + H[i])
        continue
      }
    }
    page = p
    nb.add(page, ids)
    lastBottom = Math.max(lastBottom, b)
  }
  const count = pageCount(book, lastBottom, page, nb, pendingSec != null)
  if (pendingSec != null) book.startSection(count - 2, pendingSec)
  for (const m of moves) if (m.kind === 'push') m.margin = collapsedTop(m.el, root) + m.d
  return { moves, pageList: book.pages.slice(0, count).map(pg => ({ ...pg })), notePage: nb.notePage }
}

/*
  Split a text block or a table that crosses the bottom of page p0. Returns
  the gaps to insert, or null when it should move whole.
*/
function trySplit(k, i, root, frame, T, shift, p0, book, nb) {
  const table = isTable(k)
  if (!table && !canSplitText(k)) return null
  const lines = table ? measureTableLines(k, root) : measureTextLines(k, root, frame)
  const L = lines.length
  if (table ? L < 2 : L < 4) return null
  const unitBottom = T[i] + k.offsetHeight
  const refs = notesIn(k, root) || []
  const base = shift
  const moves = []
  let added = 0, p = p0, first = 0
  for (let guard = 0; guard < 400; guard++) {
    const pg = book.at(p)
    const lineBot = j => (j + 1 < L ? lines[j + 1].top : unitBottom) + added + base
    const idsBefore = j => refs.filter(r => r.y < (j < L ? lines[j].top : Infinity) && !nb.notePage.has(r.id)).map(r => r.id)
    const room = ids => pg.top + pg.h - pg.mb - nb.resOf(p) - nb.need(p, ids)
    let fit = first
    while (fit < L && lineBot(fit) <= room(idsBefore(fit + 1)) + 0.5) fit++
    if (fit >= L) {
      nb.add(p, idsBefore(L))
      return { moves, added, page: p }
    }
    let cut = fit
    if (!table) {
      if (L - cut < 2) cut = L - 2
      if (cut - first < 2) {
        if (first === 0) return null
        cut = first + Math.max(1, cut - first)
      }
    } else if (cut === first) {
      if (first === 0) return null
      cut = first + 1
    }
    nb.add(p, idsBefore(cut))
    const lineTop = lines[cut].top + added + base
    const nx = book.at(p + 1)
    const target = nx.top + nx.mt
    const h = Math.max(0, target - lineTop)
    moves.push(table
      ? { kind: 'gapRow', index: i, row: lines[cut].row, height: h, target }
      : { kind: 'gap', index: i, node: lines[cut].node, off: lines[cut].off, height: h, target })
    added += h
    p += 1
    first = cut
  }
  return null
}

function keepWith(units, i) {
  let j = i
  if (units[j].matches?.('.cap, figcaption, [data-caption], [data-ds-caption]') && j > 0 && /^(TABLE|FIGURE|IMG)$/.test(units[j - 1].tagName)) j--
  while (j > 0 && HEADING.test(units[j - 1].tagName)) j--
  return j
}

function collapsedTop(el, root) {
  const px = v => parseFloat(v) || 0
  let m = px(getComputedStyle(el).marginTop), node = el
  for (;;) {
    const prev = node.previousElementSibling
    if (prev) { m = Math.max(m, px(getComputedStyle(prev).marginBottom)); break }
    const par = node.parentElement
    if (!par || par === root) break
    const pcs = getComputedStyle(par)
    if (px(pcs.paddingTop) || px(pcs.borderTopWidth)) break
    m = Math.max(m, px(pcs.marginTop))
    node = par
  }
  return m
}

/* ── Writing ──────────────────────────────────────────────────────────── */

export function makeGap(height) {
  const g = document.createElement('span')
  g.setAttribute('data-ds-gap', '')
  g.setAttribute('contenteditable', 'false')
  g.setAttribute('aria-hidden', 'true')
  g.style.display = 'block'
  g.style.height = height + 'px'
  return g
}

function makeGapRow(row, height) {
  const tr = document.createElement('tr')
  tr.setAttribute('data-ds-gap', '')
  tr.setAttribute('contenteditable', 'false')
  tr.setAttribute('aria-hidden', 'true')
  const td = document.createElement('td')
  td.colSpan = Math.max(1, row.cells.length)
  td.style.cssText = `height:${height}px;padding:0;border:0;background:transparent`
  tr.appendChild(td)
  return tr
}

function applyPlan(plan) {
  const gaps = plan.moves.filter(m => m.kind === 'gap').reverse()
  for (const m of gaps) {
    let at = m.node
    if (!at.parentNode) continue
    if (m.off > 0 && m.off < at.data.length) at = at.splitText(m.off)
    else if (m.off >= at.data.length) { at.parentNode.insertBefore(makeGap(m.height), at.nextSibling); continue }
    at.parentNode.insertBefore(makeGap(m.height), at)
  }
  for (const m of plan.moves) {
    if (m.kind === 'gapRow') m.row.parentNode?.insertBefore(makeGapRow(m.row, m.height), m.row)
    else if (m.kind === 'push') {
      m.el.setAttribute('data-ds-pushed', '')
      m.el.style.marginTop = m.margin + 'px'
    }
  }
}

/* ── The careful path ─────────────────────────────────────────────────── */

function carefulLayout(root, units, secOf, geom, frame) {
  const book = makeBook(geom)
  const nb = makeNotes(geom)
  const topOf = p => { const pg = book.at(p); return pg.top + pg.mt }
  const bottomOf = (p, extra = 0) => { const pg = book.at(p); return pg.top + pg.h - pg.mb - nb.resOf(p) - extra }
  const pushTo = (el, target) => {
    el.setAttribute('data-ds-pushed', '')
    for (let pass = 0; pass < 3; pass++) {
      const diff = target - offsetIn(el, root)
      if (Math.abs(diff) < 0.5) break
      const cur = parseFloat(getComputedStyle(el).marginTop) || 0
      el.style.marginTop = Math.max(0, cur + diff) + 'px'
    }
  }
  let page = 0, forceNext = false, pendingSec = null, lastBottom = 0
  let guard = 0
  for (let i = 0; i < units.length; i++) {
    if (++guard > units.length * 30 + 100) break
    const k = units[i]
    if (isBreak(k)) {
      forceNext = true
      page = book.indexOf(offsetIn(k, root), page)
      if (isSection(k)) pendingSec = secOf[i] + 1
      continue
    }
    let t = offsetIn(k, root), b = t + k.offsetHeight
    let p = book.indexOf(t, page)
    const ids = (notesIn(k, root) || []).map(r => r.id)
    let target = null, who = k
    if (forceNext) {
      const next = pendingSec != null ? book.startSection(page, pendingSec) : page + 1
      pendingSec = null; forceNext = false
      if (p < next) target = topOf(next)
      p = Math.max(p, next)
    } else if (t < topOf(p) - 1) target = topOf(p)
    else if (b > bottomOf(p, nb.need(p, ids)) + 0.5) {
      const T = []; T[i] = t
      const split = trySplit(k, i, root, frame, T, 0, p, book, nb)
      if (split) {
        applyPlan({ moves: split.moves })
        t = offsetIn(k, root); b = t + k.offsetHeight
        page = split.page
        lastBottom = Math.max(lastBottom, b)
        continue
      }
      if (t > topOf(p) + 1) {
        target = topOf(p + 1)
        const j = keepWith(units, i)
        if (j < i) {
          const w = units[j], wt = offsetIn(w, root), wp = book.indexOf(wt, 0)
          if (wp === p && wt > topOf(wp) + 1) who = w
        }
      }
    }
    if (target != null && target > offsetIn(who, root)) {
      pushTo(who, target)
      if (who !== k) i = units.indexOf(who)
    }
    const cur = units[i]
    t = offsetIn(cur, root); b = t + cur.offsetHeight
    page = book.indexOf(t, page)
    nb.add(page, (notesIn(cur, root) || []).map(r => r.id))
    lastBottom = Math.max(lastBottom, b)
  }
  const count = pageCount(book, lastBottom, page, nb, pendingSec != null)
  if (pendingSec != null) book.startSection(count - 2, pendingSec)
  return { pageList: book.pages.slice(0, count).map(pg => ({ ...pg })), notePage: nb.notePage }
}

/** Which page (1-based) an element's top is on, for a finished page list. */
export function pageOfElement(root, el, list) {
  if (!root || !el) return 1
  if (typeof list === 'number') {
    /* The old signature: a uniform page height. */
    return Math.floor(offsetIn(el, root) / (list + PAGE_GAP)) + 1
  }
  return pageIndexAt(list, offsetIn(el, root)) + 1
}
