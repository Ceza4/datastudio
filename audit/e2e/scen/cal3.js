//@include fresh.js
await H.add('Calendar'); await sleep(600)
const out = {}
for (const w of [620, 760, 900]) {
  const id = (await H.dom())[0].id
  out['block'] = (await H.dom())[0].w
  out[w] = await page.evaluate(() => { const s = [...document.querySelectorAll('[data-ds-block-wrap] span')].find(e => e.textContent === 'October 2026'); const cs = getComputedStyle(s); const r = s.getBoundingClientRect(); return { w: Math.round(r.width), sw: s.scrollWidth, ov: cs.overflow, to: cs.textOverflow, ws: cs.whiteSpace, flex: cs.flex, minW: cs.minWidth, ts: cs.textTransform, ls: cs.letterSpacing, dir: cs.direction, ta: cs.textAlign } })
  break
}
return out
