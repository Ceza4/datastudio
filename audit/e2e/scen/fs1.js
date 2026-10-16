//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('Full'); await page.keyboard.press('Escape'); await sleep(200)
await page.keyboard.press('Control+Shift+F'); await sleep(700)
R.focusOn = await page.evaluate(() => document.documentElement.dataset.dsFocus || null)
R.active = await H.active()
await page.keyboard.type(' screen'); await sleep(200)
await page.keyboard.press('Escape'); await sleep(400)
R.afterTap = await page.evaluate(() => document.documentElement.dataset.dsFocus || null)
await page.keyboard.down('Escape'); await sleep(900); await page.keyboard.up('Escape'); await sleep(600)
R.afterHold = await page.evaluate(() => document.documentElement.dataset.dsFocus || null)
R.text = (await H.dom())[0].text
// Delete while in full screen must not delete
await page.keyboard.press('Control+Shift+F'); await sleep(700)
await page.locator('[role=application]').focus().catch(() => {})
await page.keyboard.press('Delete'); await sleep(300)
R.deleteInFocus = (await H.dom()).length
await page.keyboard.press('Control+Shift+F'); await sleep(700)
R.exitedByShortcut = await page.evaluate(() => document.documentElement.dataset.dsFocus || null)
return R
