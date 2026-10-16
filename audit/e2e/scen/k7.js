//@include fresh.js
const R = {}
const zoomLabel = () => page.evaluate(() => [...document.querySelectorAll('span[title="Zoom to 100%"]')].map(s => s.innerText)[0])
await page.mouse.move(860, 480)
for (let i = 0; i < 5; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 200); await page.keyboard.up('Control'); await sleep(120) }
await H.add('Notes'); await page.keyboard.type('Zoomed'); await sleep(200)
await page.keyboard.press('Escape'); await sleep(100); await page.keyboard.press('Escape'); await sleep(200)
R.zoomBefore = await zoomLabel()
const before = (await H.dom())[0]
await page.locator('span[title="Zoom to 100%"]').click(); await sleep(400)
R.zoomAfter = await zoomLabel()
const after = (await H.dom())[0]
R.before = [before.x, before.y, before.w, before.h]; R.after = [after.x, after.y, after.w, after.h]
R.inView = after.x > 280 && after.x + after.w < 1440 && after.y > 70 && after.y + after.h < 900
return R
