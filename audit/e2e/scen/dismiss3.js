//@include fresh.js
const R = {}
// Builder stays open on outside clicks — so a canvas click while it is open must still write
await page.locator('button:has-text("Builder")').first().click(); await sleep(400)
await page.mouse.click(760, 640); await sleep(500)
R.builderOpenClickWrites = (await H.dom()).length
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200)
// a selected note + Account open: the dismiss-click releases the selection, writes nothing
const locked = () => page.evaluate(() => [...document.querySelectorAll('span')].some(s => s.textContent.trim() === 'LOCKED'))
await page.locator('[data-ds-block-wrap]').first().click({ position: { x: 40, y: 8 } }); await sleep(200)
R.selectedBefore = await locked()
await page.locator('button[aria-label=Account]').click(); await sleep(400)
await page.mouse.click(1100, 700); await sleep(500)
R.afterDismiss = { blocks: (await H.dom()).length, locked: await locked() }
await page.mouse.click(1100, 700); await sleep(500)
R.nextClickWrites = (await H.dom()).length
return R
