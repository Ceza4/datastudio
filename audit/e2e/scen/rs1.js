//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('resize me'); await page.keyboard.press('Escape'); await sleep(200)
R.handles = await page.evaluate(() => [...document.querySelectorAll('[data-ds-resize]')].map(g => { const r = g.getBoundingClientRect(); return [g.dataset.dsResize, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }))
const b0 = (await H.dom())[0]
const g = R.handles.find(h => h[0] === 'e') || R.handles[0]
await page.mouse.move(g[1] + g[3] / 2, g[2] + g[4] / 2); await sleep(100)
await page.mouse.down(); await page.mouse.move(g[1] + 120, g[2] + g[4] / 2, { steps: 10 }); await page.mouse.up(); await sleep(400)
const b1 = (await H.dom())[0]
R.dw = b1.w - b0.w
return R
