//@include fresh.js
await H.add('Database'); await sleep(600)
const o = await page.evaluate(() => { const c = document.querySelector('[role=application]'); const cs = getComputedStyle(c); return { outline: cs.outlineStyle + ' ' + cs.outlineWidth, shadow: cs.boxShadow, fv: c.matches(':focus-visible') } })
await shot('focus7', { clip: { x: 0, y: 0, width: 1440, height: 900 } })
return o
