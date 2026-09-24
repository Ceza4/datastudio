import { DEFAULT_CANVAS_BG, CANVAS_PRESETS, normalizeCanvasBg, resolveCanvasBg, isDefaultCanvasBg, dotContrast, drawDotGrid } from '../lib/canvasbg.js'
let pass=0, fail=0
const eq=(a,b,m)=>{const A=JSON.stringify(a),B=JSON.stringify(b);A===B?(pass++,console.log('  ok   '+m)):(fail++,console.log(`  FAIL ${m}\n        got      ${A}\n        expected ${B}`))}

console.log('\n normalizeCanvasBg — untrusted notebook field')
eq(normalizeCanvasBg(undefined), DEFAULT_CANVAS_BG, 'undefined → defaults (every notebook before this existed)')
eq(normalizeCanvasBg('x'), DEFAULT_CANVAS_BG, 'string → defaults')
eq(normalizeCanvasBg({ spacing: 0 }).spacing, 8, 'spacing 0 clamps to the minimum (it is a loop bound)')
eq(normalizeCanvasBg({ spacing: NaN }).spacing, 32, 'spacing NaN → default')
eq(normalizeCanvasBg({ spacing: '48' }).spacing, 48, 'numeric string coerced')
eq(normalizeCanvasBg({ spacing: 9999 }).spacing, 128, 'spacing clamps to the maximum')
eq(normalizeCanvasBg({ radius: 1.13 }).radius, 1.1, 'radius snaps to its 0.1 step without float dust')
eq(normalizeCanvasBg({ opacityDark: 95 }).opacityDark, 80, 'opacity capped at 80%')
eq(normalizeCanvasBg({ preset: 'neon' }).preset, 'default', 'unknown preset → default')
eq(normalizeCanvasBg({ ruler: 'yes' }).ruler, false, 'ruler must be a real boolean')
eq(Object.keys(normalizeCanvasBg({ evil: 1 })).includes('evil'), false, 'unknown keys dropped')
eq(isDefaultCanvasBg(undefined), true, 'missing field counts as default')
eq(isDefaultCanvasBg({ preset: 'slate' }), false, 'a changed preset is not default')

console.log('\n resolveCanvasBg — per theme')
eq(resolveCanvasBg(undefined, false).bg, '#EAE7DE', 'default light ground = --ds-canvas-bg')
eq(resolveCanvasBg(undefined, true).bg, '#141412', 'default dark ground = --ds-canvas-bg (dark)')
eq(resolveCanvasBg({ opacityLight: 10, opacityDark: 60 }, true).alpha, 0.6, 'dark theme reads its own opacity')

console.log('\n presets — defaults land near 2:1 and under 3:1 in both themes')
for (const p of CANVAS_PRESETS) {
  const l = dotContrast(p.light.ink, p.light.bg, DEFAULT_CANVAS_BG.opacityLight / 100)
  const d = dotContrast(p.dark.ink, p.dark.bg, DEFAULT_CANVAS_BG.opacityDark / 100)
  eq(l > 1.8 && l < 3 && d > 1.8 && d < 3, true, `${p.id}: light ${l.toFixed(2)}:1, dark ${d.toFixed(2)}:1`)
}

console.log('\n drawDotGrid — bounded work')
globalThis.Path2D = class { constructor(){ this.n=0 } moveTo(){} arc(){ this.n++ } }
let fills = []
const ctx = { setTransform(){}, clearRect(){}, fill(p){ fills.push(p.n) }, fillStyle: '' }
drawDotGrid(ctx, { w: 1920, h: 1080, dpr: 2, panX: 0, panY: 0, zoom: 0.05 }, resolveCanvasBg({ spacing: 8 }, false))
eq(fills[0] < 20000, true, `zoomed far out thins to ${fills[0]} dots, not millions`)
fills = []
drawDotGrid(ctx, { w: 800, h: 600, dpr: 1, panX: 0, panY: 0, zoom: 1 }, resolveCanvasBg({ opacityLight: 0 }, false))
eq(fills.length, 0, 'opacity 0 draws nothing')
fills = []
drawDotGrid(ctx, { w: 800, h: 600, dpr: 1, panX: 0, panY: 0, zoom: 1 }, resolveCanvasBg({ ruler: true }, false))
eq(fills.length, 2, 'ruler on → minor and major passes')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
