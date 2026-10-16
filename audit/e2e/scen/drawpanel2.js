//@include fresh.js
const R = {}
const panelOpen = () => page.evaluate(() => /Smart pen/.test(document.querySelector('button[title^="Draw on the canvas"]').parentElement.innerText))
// keyboard: tab to Draw from the Add button
await page.locator('button[title="Add a block"], button[aria-label="Add a block"]').first().focus()
await page.keyboard.press('Tab'); await sleep(200)
R.onDraw = await H.active(); R.openOnFocus = await panelOpen()
const stops = []
for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); await sleep(60); stops.push(await page.evaluate(() => (document.activeElement.getAttribute('aria-label') || document.activeElement.title || document.activeElement.innerText || '').slice(0, 22))) }
R.stops = stops; R.stillOpen = await panelOpen()
await page.keyboard.press('Escape'); await sleep(200)
R.afterEsc = { open: await panelOpen(), active: await page.evaluate(() => document.activeElement.title.slice(0, 20)) }
await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await sleep(150)
R.reenter = await panelOpen()
await page.locator('[role=application]').focus(); await sleep(200)
R.leaveCloses = !(await panelOpen())
// mouse still works
await page.locator('button[title^="Draw on the canvas"]').hover(); await sleep(300)
R.hover = await panelOpen()
return R
