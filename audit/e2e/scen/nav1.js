//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('x'); await sleep(900)
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200)
await page.mouse.move(1000, 600)
await page.mouse.wheel(0, 300); await sleep(300)
await page.keyboard.down('Control'); await page.mouse.wheel(0, 200); await page.keyboard.up('Control'); await sleep(300)
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+z'); await sleep(400)
R.t1 = await H.toasts()
// collapse a project in sidebar, expand it
await page.getByText('My Project', { exact: true }).first().click(); await sleep(300)
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+z'); await sleep(400)
R.t2 = await H.toasts()
return R
