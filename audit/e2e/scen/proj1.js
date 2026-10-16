//@include fresh.js
const R = {}
const side = () => page.evaluate(() => document.querySelector('[data-ds-island=left]').innerText.split('\n').filter(Boolean).slice(0, 14))
await page.getByRole('button', { name: /^Project$/ }).click(); await sleep(400)
R.newProjectFocus = await H.active()
await page.keyboard.type('Beta'); await page.keyboard.press('Enter'); await sleep(300)
await H.add('Notes'); await page.keyboard.type('beta note'); await page.keyboard.press('Escape'); await sleep(600)
await page.getByRole('button', { name: /^Folder$/ }).click(); await sleep(400)
R.folderFocus = await H.active()
await page.keyboard.type('Clients'); await page.keyboard.press('Enter'); await sleep(300)
R.sideAfterFolder = await side()
// drag Beta into Clients
const beta = page.locator('.nb-row', { hasText: 'Beta' }).first()
const folder = page.locator('[data-folder-drop]').first()
await beta.dragTo(folder); await sleep(400)
R.sideAfterDrag = await side()
// delete Beta via its ×, then UNDO from the toast
await beta.hover(); await page.getByRole('button', { name: 'Delete project Beta' }).click(); await sleep(400)
R.toast = await H.toasts()
R.sideAfterDelete = await side()
await page.getByRole('button', { name: /undo/i }).first().click(); await sleep(500)
R.sideAfterUndo = await side()
R.activeAfterUndo = (await H.dom()).map(b => b.text.slice(0, 20))
// delete again, then Ctrl+Z on the canvas
await page.locator('.nb-row', { hasText: 'Beta' }).first().hover(); await page.getByRole('button', { name: 'Delete project Beta' }).click(); await sleep(400)
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+z'); await sleep(500)
R.sideAfterCtrlZ = await side()
await sleep(800)
await page.reload({ waitUntil: 'networkidle' }); await sleep(800)
R.sideAfterReload = await side()
await page.locator('.nb-row', { hasText: 'Beta' }).first().click().catch(() => {}); await sleep(500)
R.betaBlocks = (await H.dom()).map(b => b.text.slice(0, 20))
return R
