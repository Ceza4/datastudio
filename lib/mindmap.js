/*
  lib/mindmap.js
  --------------------------------------------------------------------------
  Builder → Visuals: the mind map. Pure model and layout, no React, no DOM
  (text measuring is injected, see setTextMeasurer). 24 Sep 2026.

  A MIND MAP IS ONE SHAPE, NOT A SHAPE PER TOPIC.

  It lives in sheet.shapes like every other shape, with kind 'mindmap', so it
  gets the verbs shapes already have for free: select, drag to move the whole
  map, marquee, copy/paste, delete with undo, the workspace undo stack. The
  topics are data inside it:

    { id, kind: 'mindmap', x, y, w, h, rot: 0,
      root: 'n_…',
      nodes: { [id]: { id, text, parent, children: [ids], collapsed, color } } }

  x,y is the ROOT topic's top-left corner. Every other topic's position is
  derived by layout(), never stored. So a map cannot end up with overlapping
  topics, and moving the map is the same four-number edit as moving a box.
  w,h is a cache of the map's extent, refreshed by withBounds() on each
  write, for code that reads a shape's size without knowing its kind.

  WHY TOPICS ARE NOT SEPARATE SHAPES JOINED BY CONNECTORS: auto-layout. The
  moment a topic owns its own x,y, adding a child means moving every topic
  below it, one write per topic, and a half-applied write leaves a map with
  overlaps. Here, adding a child is one write of one object.

  LAYOUT: a tidy tree growing to the right. A topic's subtree height is the
  sum of its visible children's subtree heights plus gaps; the topic sits at
  the vertical centre of its subtree. Collapsed topics contribute only
  themselves. Same algorithm as the confirmed prototype.

  Branch colours are TOKEN NAMES ('accent', 'amber', …), resolved by the
  renderer through CSS variables, so a branch cannot be invisible in the
  theme it was not drawn in. Same rule as Database option colours.
  -------------------------------------------------------------------------- */

export const NODE_H = 34
export const V_GAP = 12
export const H_GAP = 56
export const TOGGLE_R = 8
export const MAX_NODE_W = 320
export const BRANCH_COLORS = ['accent', 'code-num', 'amber', 'code-fn', 'red', 'green']

/* ── measuring ───────────────────────────────────────────────────────── */

/* Average advance widths for Inter at 13px, used until a real measurer is
   installed (tests, server render). Close enough that a topic's box is never
   visibly short, and deterministic, which is what tests need. */
function estimate(text, bold) {
  let w = 0
  for (const ch of String(text)) {
    if (/[A-Z]/.test(ch)) w += 8.6
    else if (/[mwMW@%]/.test(ch)) w += 10.4
    else if (/[iljtf.,:;'|!]/.test(ch)) w += 3.9
    else if (ch === ' ') w += 3.6
    else w += 7.1
  }
  return w * (bold ? 1.06 : 1)
}
let measurer = estimate
/** Install a real text measurer: (text, bold) => width in px at 13px. */
export function setTextMeasurer(fn) {
  if (typeof fn === 'function' && fn !== measurer) { measurer = fn; layoutCache = new WeakMap() }
}
export function nodeWidth(text, isRoot) {
  const min = isRoot ? 120 : 64
  return Math.round(Math.min(MAX_NODE_W, Math.max(min, Math.ceil(measurer(text || 'Topic', isRoot)) + 28)))
}

/* ── ids ─────────────────────────────────────────────────────────────── */

let seq = 0
export function newNodeId() {
  seq = (seq + 1) % 1e6
  return `n_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/* ── construction ────────────────────────────────────────────────────── */

export function createMindMap(opts = {}) {
  const root = newNodeId()
  const s = {
    id: opts.id,
    kind: 'mindmap',
    x: Math.round(opts.x ?? 0),
    y: Math.round(opts.y ?? 0),
    w: 0, h: 0, rot: 0,
    color: null, size: 2, fill: null,
    root,
    nodes: { [root]: { id: root, text: opts.text ?? 'Central idea', parent: null, children: [], collapsed: false, color: null } },
  }
  return withBounds(s)
}

/* ── layout ──────────────────────────────────────────────────────────── */

let layoutCache = new WeakMap()

/**
 * Topic boxes RELATIVE to the root's top-left, plus the map's extent.
 * { boxes: { [id]: { x, y, w, h } }, bounds: { x, y, w, h }, visible: [ids] }
 * Cached per `nodes` object: every edit replaces `nodes`, so identity is a
 * correct cache key and a drag of the whole map never re-measures.
 */
export function layout(s) {
  const N = s?.nodes
  if (!N || !N[s.root]) return { boxes: {}, bounds: { x: 0, y: 0, w: 0, h: 0 }, visible: [] }
  const hit = layoutCache.get(N)
  if (hit && hit.root === s.root) return hit.out

  const kids = n => (n.collapsed ? [] : n.children.filter(k => N[k]))
  const sub = {}
  const heightOf = id => {
    const ks = kids(N[id])
    const h = ks.length ? Math.max(NODE_H, ks.reduce((a, k) => a + heightOf(k), 0) + V_GAP * (ks.length - 1)) : NODE_H
    sub[id] = h
    return h
  }
  heightOf(s.root)

  const boxes = {}, visible = []
  const place = (id, x, top) => {
    const n = N[id]
    const w = nodeWidth(n.text, id === s.root)
    boxes[id] = { x, y: top + sub[id] / 2 - NODE_H / 2, w, h: NODE_H }
    visible.push(id)
    const ks = kids(n)
    const inner = ks.reduce((a, k) => a + sub[k], 0) + V_GAP * Math.max(0, ks.length - 1)
    let y = top + (sub[id] - inner) / 2
    for (const k of ks) { place(k, x + w + H_GAP, y); y += sub[k] + V_GAP }
  }
  /* Root's top-left is (0,0): its subtree is centred on it. */
  place(s.root, 0, NODE_H / 2 - sub[s.root] / 2)

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const id of visible) {
    const b = boxes[id]
    const toggle = N[id].children.length ? TOGGLE_R * 2 + 2 : 0
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w + toggle); y1 = Math.max(y1, b.y + b.h)
  }
  const out = { boxes, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, visible }
  layoutCache.set(N, { root: s.root, out })
  return out
}

/** A topic's box in WORLD coordinates. */
export function nodeBox(s, id) {
  const b = layout(s).boxes[id]
  return b ? { x: s.x + b.x, y: s.y + b.y, w: b.w, h: b.h } : null
}

/** The whole map's extent in world coordinates. */
export function mindmapBounds(s) {
  const b = layout(s).bounds
  return { x: s.x + b.x, y: s.y + b.y, w: b.w, h: b.h }
}

/** Keep the cached w,h in step with the layout. Returns the same object when
 *  nothing changed. */
export function withBounds(s) {
  const b = layout(s).bounds
  const w = Math.round(b.w), h = Math.round(b.h)
  return s.w === w && s.h === h ? s : { ...s, w, h }
}

/** Where the collapse toggle of a topic sits (world), or null. */
export function toggleCentre(s, id) {
  const n = s.nodes?.[id]
  const b = nodeBox(s, id)
  if (!n || !b || !n.children.length) return null
  return { x: b.x + b.w + TOGGLE_R + 1, y: b.y + b.h / 2 }
}

/** What is under a world point: { nodeId, part: 'node' | 'toggle' } or null.
 *  Topmost first is irrelevant here: a tidy layout never overlaps. */
export function nodeAt(s, px, py, tol = 0) {
  const { boxes, visible } = layout(s)
  for (const id of visible) {
    const t = toggleCentre(s, id)
    if (t && Math.hypot(px - t.x, py - t.y) <= TOGGLE_R + tol) return { nodeId: id, part: 'toggle' }
    const b = boxes[id]
    const x = s.x + b.x, y = s.y + b.y
    if (px >= x - tol && px <= x + b.w + tol && py >= y - tol && py <= y + b.h + tol) return { nodeId: id, part: 'node' }
  }
  return null
}

/* ── edits (all immutable, all return a shape with fresh bounds) ─────── */

function commit(s, nodes) { return withBounds({ ...s, nodes }) }

export function isDescendant(s, ancestor, id) {
  let n = s.nodes[id]
  while (n && n.parent) { if (n.parent === ancestor) return true; n = s.nodes[n.parent] }
  return false
}

export function countDescendants(s, id) {
  const n = s.nodes[id]
  return n ? n.children.reduce((a, k) => a + 1 + countDescendants(s, k), 0) : 0
}

/** Add a topic under `parentId`, after `afterId` when given (else last).
 *  Returns { shape, id }. A collapsed parent opens, or the new topic would
 *  be created somewhere you cannot see. */
export function addChild(s, parentId, afterId) {
  const p = s.nodes[parentId]
  if (!p) return { shape: s, id: null }
  const id = newNodeId()
  const color = parentId === s.root
    ? BRANCH_COLORS[p.children.length % BRANCH_COLORS.length]
    : (p.color || BRANCH_COLORS[0])
  const at = afterId && p.children.includes(afterId) ? p.children.indexOf(afterId) + 1 : p.children.length
  const children = [...p.children]
  children.splice(at, 0, id)
  const nodes = {
    ...s.nodes,
    [parentId]: { ...p, children, collapsed: false },
    [id]: { id, text: '', parent: parentId, children: [], collapsed: false, color },
  }
  return { shape: commit(s, nodes), id }
}

/** Enter: a sibling after this topic. On the root there are no siblings, so
 *  it adds a child instead, which is what every mind map tool does. */
export function addSibling(s, id) {
  const n = s.nodes[id]
  if (!n) return { shape: s, id: null }
  return n.parent ? addChild(s, n.parent, id) : addChild(s, id)
}

export function setText(s, id, text) {
  const n = s.nodes[id]
  if (!n || n.text === text) return s
  return commit(s, { ...s.nodes, [id]: { ...n, text } })
}

export function toggleCollapsed(s, id) {
  const n = s.nodes[id]
  if (!n || !n.children.length) return s
  return commit(s, { ...s.nodes, [id]: { ...n, collapsed: !n.collapsed } })
}

/** Remove a topic and its whole branch. The root cannot be removed this way
 *  (deleting the root is deleting the map, which the canvas does as a shape
 *  delete, with undo). Returns { shape, select } where select is the topic
 *  that should be selected next: the previous sibling, else the next, else
 *  the parent. */
export function removeBranch(s, id) {
  const n = s.nodes[id]
  if (!n || !n.parent) return { shape: s, select: id }
  const nodes = { ...s.nodes }
  const drop = k => { for (const c of nodes[k]?.children || []) drop(c); delete nodes[k] }
  drop(id)
  const p = nodes[n.parent]
  const i = p.children.indexOf(id)
  const children = p.children.filter(k => k !== id)
  nodes[n.parent] = { ...p, children }
  const select = children[i - 1] || children[i] || n.parent
  return { shape: commit(s, nodes), select }
}

function recolor(nodes, id, color) {
  nodes[id] = { ...nodes[id], color }
  for (const k of nodes[id].children) recolor(nodes, k, color)
}

/** Move a topic (with its branch) under another. Refused (returns null) for
 *  the root, onto itself, onto its own current parent, and onto anything in
 *  its own branch, which would detach the branch from the tree. */
export function reparent(s, id, parentId) {
  const n = s.nodes[id], p = s.nodes[parentId]
  if (!n || !p || !n.parent || id === parentId || n.parent === parentId) return null
  if (isDescendant(s, id, parentId)) return null
  const nodes = { ...s.nodes }
  const old = nodes[n.parent]
  nodes[n.parent] = { ...old, children: old.children.filter(k => k !== id) }
  nodes[parentId] = { ...nodes[parentId], children: [...nodes[parentId].children, id], collapsed: false }
  nodes[id] = { ...n, parent: parentId }
  const color = parentId === s.root
    ? BRANCH_COLORS[(nodes[parentId].children.length - 1) % BRANCH_COLORS.length]
    : (nodes[parentId].color || BRANCH_COLORS[0])
  recolor(nodes, id, color)
  return commit(s, nodes)
}

/** Arrow-key navigation. Right: first visible child. Left: parent. Up/Down:
 *  previous/next sibling. Returns the id to select, or null to stay. */
export function navigate(s, id, key) {
  const n = s.nodes[id]
  if (!n) return null
  if (key === 'ArrowRight') return !n.collapsed && n.children[0] ? n.children[0] : null
  if (key === 'ArrowLeft') return n.parent || null
  if ((key === 'ArrowDown' || key === 'ArrowUp') && n.parent) {
    const sib = s.nodes[n.parent].children
    const i = sib.indexOf(id) + (key === 'ArrowDown' ? 1 : -1)
    return sib[i] || null
  }
  return null
}

/** Rebuild with new node ids (paste, duplicate), so two copies of a map
 *  never share a topic id. */
export function cloneNodes(s) {
  const map = {}
  for (const id of Object.keys(s.nodes || {})) map[id] = newNodeId()
  const nodes = {}
  for (const [id, n] of Object.entries(s.nodes || {})) {
    nodes[map[id]] = { ...n, id: map[id], parent: n.parent ? map[n.parent] || null : null, children: n.children.map(k => map[k]).filter(Boolean) }
  }
  return { ...s, root: map[s.root], nodes }
}

/** A map whose data is damaged (a sync from an old client, a hand-edited
 *  file) must still render and still be editable. Drops children that point
 *  nowhere, re-links orphans under the root, and guarantees a root. */
export function repairMindMap(s) {
  if (!s || s.kind !== 'mindmap') return s
  let nodes = s.nodes && typeof s.nodes === 'object' ? s.nodes : {}
  let root = s.root
  if (!nodes[root]) {
    root = Object.keys(nodes).find(k => !nodes[k]?.parent) || newNodeId()
    if (!nodes[root]) nodes = { ...nodes, [root]: { id: root, text: 'Central idea', parent: null, children: [], collapsed: false, color: null } }
  }
  let changed = root !== s.root || nodes !== s.nodes
  const out = {}
  for (const [id, n] of Object.entries(nodes)) {
    const kids = Array.isArray(n?.children) ? n.children.filter(k => nodes[k] && k !== id) : []
    out[id] = { id, text: typeof n?.text === 'string' ? n.text : '', parent: id === root ? null : (nodes[n?.parent] ? n.parent : root), children: kids, collapsed: !!n?.collapsed, color: n?.color ?? null }
    if (!n || kids.length !== (n.children || []).length || out[id].parent !== n.parent) changed = true
  }
  /* Orphans: a parent that does not list them as a child. */
  for (const [id, n] of Object.entries(out)) {
    if (id === root) continue
    if (!out[n.parent].children.includes(id)) { out[n.parent] = { ...out[n.parent], children: [...out[n.parent].children, id] }; changed = true }
  }
  /* Cycles: anything the root cannot reach is re-hung under the root. */
  const seen = new Set()
  const walk = id => { if (seen.has(id)) return; seen.add(id); for (const k of out[id].children) walk(k) }
  walk(root)
  for (const id of Object.keys(out)) {
    if (seen.has(id)) continue
    for (const k of Object.keys(out)) out[k] = { ...out[k], children: out[k].children.filter(c => c !== id) }
    out[id] = { ...out[id], parent: root }
    out[root] = { ...out[root], children: [...out[root].children, id] }
    changed = true
    walk(id)
  }
  return changed ? withBounds({ ...s, root, nodes: out }) : s
}
