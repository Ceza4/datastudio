//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('On sheet one'); await sleep(200)
// while still editing (caret in text), click "New Sheet"
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(600)
R.afterNewSheet = { blocks: (await H.dom()).length, top: await page.evaluate(() => document.querySelector('[data-ds-island=top]').innerText.split('\n').slice(0, 3)) }
await H.add('Notes'); await page.keyboard.type('On sheet two'); await sleep(300)
await page.keyboard.press('Escape'); await sleep(150)
// switch back to sheet 1
await page.getByText('Sheet 1', { exact: true }).first().click(); await sleep(600)
R.sheet1 = (await H.dom()).map(b => b.text)
await page.getByText('Sheet 2', { exact: true }).first().click(); await sleep(600)
R.sheet2 = (await H.dom()).map(b => b.text)
// undo on sheet 2 should undo sheet-2 typing, not touch sheet 1
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+z'); await sleep(400)
R.undo1 = { blocks: (await H.dom()).map(b => b.text), toasts: await H.toasts() }
await page.keyboard.press('Control+z'); await sleep(400)
R.undo2 = { blocks: (await H.dom()).map(b => b.text), toasts: await H.toasts(), top: await page.evaluate(() => document.querySelector('[data-ds-island=top]').innerText.split('\n').slice(0, 3)) }
await page.keyboard.press('Control+z'); await sleep(400)
R.undo3 = { blocks: (await H.dom()).map(b => b.text), toasts: await H.toasts(), top: await page.evaluate(() => document.querySelector('[data-ds-island=top]').innerText.split('\n').slice(0, 3)) }
// now go to sheet 1 and press undo: it must take us to sheet 2 to undo the add there
await page.getByText('Sheet 1', { exact: true }).first().click(); await sleep(500)
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+z'); await sleep(500)
R.undo4 = { blocks: (await H.dom()).map(b => b.text), toasts: await H.toasts(), active: await page.evaluate(() => [...document.querySelectorAll('span[title*=" blocks"]')].map(s => s.innerText)) }
await shot('sh1')
return R
