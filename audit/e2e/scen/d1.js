//@include fresh.js
await H.add('Document'); await sleep(500)
await page.keyboard.type('Hello document world'); await sleep(200)
await shot('d1')
const R = {}
R.active = await H.active()
// Select all inside doc then bold
await page.keyboard.press('Control+a'); await sleep(100)
R.selText = await page.evaluate(() => getSelection().toString())
R.blocksSel = await H.selected()
await page.keyboard.press('Control+b'); await sleep(200)
R.boldHtml = await page.evaluate(() => document.querySelector('[aria-label="Document body"]')?.innerHTML.slice(0, 200))
// Delete all text: Backspace must not delete block
await page.keyboard.press('Backspace'); await sleep(200)
await page.keyboard.press('Backspace'); await sleep(200)
R.afterBackspace = (await H.dom()).length
// Ctrl+Z inside doc
await page.keyboard.press('Control+z'); await sleep(300)
R.afterUndo = await page.evaluate(() => document.querySelector('[aria-label="Document body"]')?.innerText.slice(0, 100))
return R
