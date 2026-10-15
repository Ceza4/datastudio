/*
  tests/placement.test.mjs — where an unaimed new block lands (lib/placement.js).
  Run: node tests/placement.test.mjs
*/
import { findFreeSpot } from '../lib/placement.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const overlap = (a, b, g = 0) => a.x < b.x + b.w + g && a.x + a.w + g > b.x && a.y < b.y + b.h + g && a.y + a.h + g > b.y

console.log('\n placement')
{
  const s = findFreeSpot([], { x: 100, y: 100, w: 300, h: 200 })
  ok(s.x === 100 && s.y === 100 && !s.moved, 'empty sheet: the wanted spot')

  const rects = []
  const view = { x: 0, y: 0, w: 1600, h: 900 }
  for (let i = 0; i < 6; i++) {
    const want = { x: 500, y: 100, w: 400, h: 260 }
    const p = findFreeSpot(rects, want, { gap: 16, view })
    rects.push({ x: p.x, y: p.y, w: 400, h: 260 })
  }
  const clash = rects.some((a, i) => rects.some((b, j) => i !== j && overlap(a, b)))
  ok(!clash, 'six adds at the same spot never overlap')
  ok(rects.slice(0, 4).every(r => r.x >= 0 && r.y >= 0 && r.x + 400 <= 1600), 'the first adds stay on screen')
  ok(rects[1].x > rects[0].x || rects[1].y > rects[0].y, 'the second goes right or down, not up-left')

  const busy = [{ x: 0, y: 0, w: 1600, h: 900 }]
  const off = findFreeSpot(busy, { x: 500, y: 100, w: 400, h: 260 }, { gap: 16, view })
  ok(!off.inView && !overlap({ ...off, w: 400, h: 260 }, busy[0]), 'full screen: free spot off screen, and says so')

  const wide = findFreeSpot([{ x: 480, y: 80, w: 200, h: 100 }], { x: 500, y: 100, w: 880, h: 1100 }, { gap: 16, view })
  ok(!overlap({ ...wide, w: 880, h: 1100 }, { x: 480, y: 80, w: 200, h: 100 }, 16), 'a tall document block still avoids its neighbour')
}
console.log(`\n ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
