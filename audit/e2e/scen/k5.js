//@include fresh.js
const R = {}
const zoomLabel = () => page.evaluate(() => [...document.querySelectorAll('span[title="Click to reset the view"]')].map(s => s.innerText)[0])
await page.mouse.move(860, 480)
for (let i = 0; i < 5; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 200); await page.keyboard.up('Control'); await sleep(120) }
await sleep(300)
R.zoom = await zoomLabel()
await H.add('Notes'); await page.keyboard.type('Zoomed'); await sleep(200)
let d = await H.dom()
R.blockAtZoom = d.map(b => [b.x, b.y, b.w, b.h])
R.inView = d.every(b => b.x >= 280 && b.x + b.w <= 1440 && b.y >= 70 && b.y + b.h <= 900)
await page.keyboard.press('Escape'); await sleep(150)
const b = d[0]
await page.mouse.move(b.x + 30, b.y + 7); await page.mouse.down(); await page.mouse.move(b.x + 130, b.y + 107, { steps: 12 }); await page.mouse.up(); await sleep(500)
const d2 = await H.dom()
R.dragScreenDelta = [d2[0].x - b.x, d2[0].y - b.y]
// zoom in a lot
await page.mouse.move(d2[0].x + 50, d2[0].y + 30)
for (let i = 0; i < 12; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control'); await sleep(80) }
await sleep(300)
R.zoom2 = await zoomLabel()
const d3 = await H.dom()
R.afterZoomIn = d3.map(b => [b.x, b.y, b.w, b.h])
// click into text at high zoom, type
await page.mouse.click(d3[0].x + d3[0].w / 2, d3[0].y + d3[0].h / 2); await sleep(200)
await page.keyboard.type('X'); await sleep(200)
R.textAfterClick = (await H.dom())[0].text
// reset zoom by clicking label
await page.locator('span[title="Click to reset the view"]').click(); await sleep(400)
R.zoom3 = await zoomLabel()
await shot('k5')
return R
