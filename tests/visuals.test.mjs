/* Builder → Visuals: mind map model + layout, connectors, new shape kinds. */
import {
  createMindMap, addChild, addSibling, removeBranch, reparent, navigate, setText,
  toggleCollapsed, layout, nodeAt, nodeBox, mindmapBounds, countDescendants,
  repairMindMap, cloneNodes, NODE_H, BRANCH_COLORS, toggleCentre,
} from '../lib/mindmap.js'
import { serializeSelection, parseClipboard, materialise } from '../lib/clipboard.js'
import {
  createShape, hitShape, shapeBounds, pickShape, pickTarget, resolveConnectors,
  bakeConnectorsFor, isLinear, isLabelled, resizeShape, rotateShape, anchorPoint, shapesInRect,
} from '../lib/shapes.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e

console.log('\n mind map: build')
let m = createShape('mindmap', { x: 100, y: 200 })
ok(m.kind === 'mindmap' && m.id && m.nodes[m.root].text === 'Central idea', 'a new map has one root topic')
ok(m.w > 0 && m.h === NODE_H, 'bounds cached on the shape')
let r = addChild(m, m.root); m = r.shape; const a = r.id
r = addChild(m, m.root); m = r.shape; const b = r.id
r = addChild(m, m.root); m = r.shape; const c = r.id
ok(m.nodes[m.root].children.join() === [a, b, c].join(), 'Tab adds children in order')
ok(m.nodes[a].color === BRANCH_COLORS[0] && m.nodes[b].color === BRANCH_COLORS[1], 'first-level branches get distinct colours')
r = addChild(m, a); m = r.shape; const a1 = r.id
ok(m.nodes[a1].color === m.nodes[a].color, 'a sub-topic inherits its branch colour')
r = addSibling(m, a); m = r.shape; const ab = r.id
ok(m.nodes[m.root].children.indexOf(ab) === 1, 'Enter adds a sibling right after')
r = addSibling(m, m.root); m = r.shape
ok(m.nodes[r.id].parent === m.root, 'Enter on the root adds a child (roots have no siblings)')
m = removeBranch(m, r.id).shape

console.log('\n mind map: layout')
let L = layout(m)
const rb = L.boxes[m.root]
ok(rb.x === 0 && rb.y === 0, 'root sits at the map origin')
ok(L.boxes[a].x === rb.w + 56, 'children one gap to the right of the parent')
const ys = m.nodes[m.root].children.map(k => L.boxes[k].y)
ok(ys.every((y, i) => i === 0 || y > ys[i - 1]), 'siblings stacked top to bottom')
const mid = (ys[0] + ys[ys.length - 1] + NODE_H) / 2
ok(near(rb.y + NODE_H / 2, (L.boxes[a].y + L.boxes[c].y + NODE_H) / 2, 40), 'root roughly centred on its children')
ok(L.boxes[a1].y + NODE_H <= L.boxes[ab].y, 'a subtree does not overlap the next sibling')
ok(layout(m) === L, 'layout is cached per nodes object')
m = setText(m, a, 'A much longer topic title here')
ok(layout(m).boxes[a].w > L.boxes[a].w, 'longer text widens the topic')
ok(layout(m).boxes[a1].x > L.boxes[a1].x, '…and pushes its children right')
const B = mindmapBounds(m)
ok(B.x === m.x && B.y < m.y && B.h > NODE_H, 'world bounds span the whole tree')
ok(shapeBounds(m).w === B.w, 'shapeBounds knows mind maps')

console.log('\n mind map: hit + toggle + collapse')
const box = nodeBox(m, b)
ok(nodeAt(m, box.x + 5, box.y + 5)?.nodeId === b, 'nodeAt finds a topic')
ok(nodeAt(m, box.x - 20, box.y - 300) === null, 'empty space between branches is not the map')
ok(hitShape(m, box.x + 5, box.y + 5) && !hitShape(m, B.x + B.w + 50, B.y), 'hitShape uses topics')
const t = toggleCentre(m, a)
ok(nodeAt(m, t.x, t.y)?.part === 'toggle', 'the toggle is its own hit part')
const before = layout(m).visible.length
m = toggleCollapsed(m, a)
ok(layout(m).visible.length === before - 1 && m.nodes[a].collapsed, 'collapse hides the branch')
ok(countDescendants(m, a) === 1, 'descendant count for the collapsed badge')
r = addChild(m, a); m = r.shape
ok(!m.nodes[a].collapsed, 'adding under a collapsed topic opens it')
m = removeBranch(m, r.id).shape

console.log('\n mind map: navigate + reparent + remove')
ok(navigate(m, m.root, 'ArrowRight') === a, 'Right: first child')
ok(navigate(m, a, 'ArrowLeft') === m.root, 'Left: parent')
ok(navigate(m, a, 'ArrowDown') === ab && navigate(m, ab, 'ArrowUp') === a, 'Up/Down: siblings')
ok(navigate(m, m.root, 'ArrowDown') === null, 'root has nowhere to go up/down')
ok(reparent(m, a, a1) === null, 'cannot move a topic into its own branch')
ok(reparent(m, m.root, a) === null, 'the root cannot be moved under anything')
ok(reparent(m, a1, a) === null, 'dropping on the current parent is a no-op')
const m2 = reparent(m, a1, c)
ok(m2 && m2.nodes[c].children.includes(a1) && !m2.nodes[a].children.includes(a1) && m2.nodes[a1].parent === c, 'reparent moves a topic with its branch')
ok(m2.nodes[a1].color === m2.nodes[c].color, 'and recolours it to the new branch')
const rm = removeBranch(m, a)
ok(!rm.shape.nodes[a] && !rm.shape.nodes[a1] && rm.select === ab, 'delete removes the whole branch, selects the next sibling')
ok(removeBranch(m, m.root).shape === m, 'the root is not removed by removeBranch')

console.log('\n mind map: repair + clone')
const broken = { ...m, nodes: { ...m.nodes, [a]: { ...m.nodes[a], children: [...m.nodes[a].children, 'ghost'] }, orphan: { id: 'orphan', text: 'x', parent: 'nowhere', children: [] } } }
const fixed = repairMindMap(broken)
ok(!fixed.nodes[a].children.includes('ghost'), 'dangling child ids dropped')
ok(fixed.nodes.orphan.parent === fixed.root && fixed.nodes[fixed.root].children.includes('orphan'), 'orphans re-hung under the root')
ok(repairMindMap(m) === m, 'a healthy map is returned untouched')
const cyc = { ...m, nodes: { ...m.nodes, x1: { id: 'x1', text: '', parent: 'x2', children: ['x2'] }, x2: { id: 'x2', text: '', parent: 'x1', children: ['x1'] } } }
const cf = repairMindMap(cyc)
ok(layout(cf).visible.includes('x1') && layout(cf).visible.includes('x2'), 'a cycle is broken and both topics become reachable')
const cl = cloneNodes(m)
ok(cl.root !== m.root && Object.keys(cl.nodes).length === Object.keys(m.nodes).length && cl.nodes[cl.root].children.length === m.nodes[m.root].children.length, 'clone gives fresh topic ids, same tree')
ok(resizeShape(m, 'se', 999, 999) === m && rotateShape(m, 30) === m, 'maps neither resize nor rotate')

console.log('\n new kinds')
const st = createShape('sticky', { x: 0, y: 0, w: 150, h: 120, text: 'Hi' })
ok(st.text === 'Hi' && isLabelled('sticky') && isLabelled('rect') && !isLabelled('line'), 'labels on boxes and stickies')
ok(hitShape(st, 75, 60), 'a sticky is hit anywhere inside, unfilled or not')
ok(!hitShape(createShape('rect', { x: 0, y: 0, w: 100, h: 100 }), 50, 50), 'an unfilled plain rect is still hit on its outline only')
ok(hitShape(createShape('text', { x: 0, y: 0, w: 100, h: 30 }), 50, 15), 'a text box is hit inside')
ok(createShape('rect').text === undefined, 'shapes without text carry no text key')
const cn = createShape('connector', { x: 0, y: 0, w: 10, h: 10, from: 'a', to: 'b' })
ok(isLinear('connector') && cn.from === 'a' && cn.to === 'b' && cn.rot === 0, 'connector is linear with from/to')

console.log('\n connectors')
const A = createShape('rect', { id: 'A', x: 0, y: 0, w: 100, h: 60, fill: 'x' })
const Bx = createShape('ellipse', { id: 'B', x: 300, y: 0, w: 100, h: 60, fill: 'x' })
const K = createShape('connector', { id: 'K', x: 5, y: 5, w: 1, h: 1, from: 'A', to: 'B' })
let S = [A, Bx, K]
let R = resolveConnectors(S)
let k = R.find(s => s.id === 'K')
ok(near(k.x, 100) && near(k.y, 30) && near(k.x + k.w, 300, 1) && near(k.y + k.h, 30), 'ends sit on the two outlines, centre to centre')
const live = new Map([['B', { ...Bx, y: 200 }]])
k = resolveConnectors(S, live).find(s => s.id === 'K')
ok(k.y + k.h > 150, 'follows a shape mid-drag via the live map')
ok(resolveConnectors([A, Bx]) !== undefined && resolveConnectors([A, Bx]).length === 2, 'no connectors: nothing to do')
const plain = [A, Bx]; ok(resolveConnectors(plain) === plain, 'returns the same array when nothing is attached')
k = resolveConnectors([A, K]).find(s => s.id === 'K')
ok(near(k.x + k.w, 6) && near(k.y + k.h, 6), 'a missing end keeps its stored point')
ok(pickTarget(S, 50, 30)?.id === 'A', 'pickTarget: inside a shape')
ok(pickTarget([createShape('rect', { id: 'U', x: 0, y: 0, w: 100, h: 60 })], 50, 30)?.id === 'U', 'pickTarget: even an unfilled one, anywhere inside')
ok(pickTarget(S, 200, 30) === null, 'pickTarget: nothing over empty canvas')
ok(pickTarget(S, 50, 30, 6, 'A') === null, 'pickTarget: can exclude the start shape')
const baked = bakeConnectorsFor(S, ['B'])
ok(baked.length === 1 && baked[0].id === 'K' && near(baked[0].patch.x + baked[0].patch.w, 300, 1), 'bake writes the resolved ends before a delete')
ok(bakeConnectorsFor(S, ['K']).length === 0, 'deleting the connector itself bakes nothing')
const mm = createShape('mindmap', { id: 'M', x: 600, y: 0 })
const rootBox = nodeBox(mm, mm.root)
const p = anchorPoint(mm, 0, rootBox.y + NODE_H / 2)
ok(near(p.x, 600, 1), 'a connector to a map lands on its root topic')
ok(shapesInRect([mm], { x: 590, y: -100, w: 400, h: 300 }).length === 1, 'marquee catches a map by its layout bounds')
ok(pickShape([A, mm], rootBox.x + 4, rootBox.y + 4)?.id === 'M', 'pickShape finds the map by its topic')

console.log('\n paste')
{
  const K2 = createShape('connector', { id: 'K2', x: 0, y: 0, w: 10, h: 0, from: 'A', to: 'Z' })
  const out = materialise(parseClipboard(serializeSelection({ shapes: [A, K2] })), { x: 5, y: 5 })
  const na = out.shapes.find(s => s.kind === 'rect'), nk = out.shapes.find(s => s.kind === 'connector')
  ok(nk.from === na.id && na.id !== 'A', 'a pasted connector follows the pasted copy of its shape')
  ok(nk.to === null, '…and drops an attachment whose shape did not come along')
  const mm2 = materialise(parseClipboard(serializeSelection({ shapes: [mm] })), { x: 0, y: 0 }).shapes[0]
  ok(mm2.kind === 'mindmap' && mm2.nodes[mm2.root] && mm2.id !== 'M', 'a mind map survives copy and paste')
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
