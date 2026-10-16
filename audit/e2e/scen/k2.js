//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('Alpha'); await sleep(900)
await page.keyboard.press('Escape'); await sleep(150)
await page.keyboard.press('Delete'); await sleep(400)
R.del = (await H.dom()).length
await page.getByRole('button', { name: /^undo$/i }).click(); await sleep(400)
R.toastUndo = { n: (await H.dom()).length, toasts: await H.toasts() }
await page.mouse.click(1300, 860); await sleep(300)  // creates a text block? record
R.afterBgClick = { n: (await H.dom()).length, active: await H.active() }
await page.keyboard.press('Escape'); await sleep(100); await page.keyboard.press('Escape'); await sleep(200)
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+z'); await sleep(400)
R.ctrlZ1 = { n: (await H.dom()).length, texts: (await H.dom()).map(b => b.text), toasts: await H.toasts() }
await page.keyboard.press('Control+z'); await sleep(400)
R.ctrlZ2 = { n: (await H.dom()).length, texts: (await H.dom()).map(b => b.text), toasts: await H.toasts() }
await page.keyboard.press('Control+z'); await sleep(400)
R.ctrlZ3 = { n: (await H.dom()).length, texts: (await H.dom()).map(b => b.text), toasts: await H.toasts() }
return R
