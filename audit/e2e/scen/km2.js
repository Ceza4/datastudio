await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200)
await page.locator('[role=application]').focus()
await page.keyboard.press('Shift+/'); await sleep(300)
const R = { help: await page.evaluate(() => /keyboard mode/i.test(document.body.innerText)) }
const n0 = (await H.dom()).length
await page.keyboard.press('n'); await sleep(200)
R.nSwallowed = (await H.dom()).length === n0
await shot('help')
await page.keyboard.press('Escape'); await sleep(200)
R.closed = !(await page.evaluate(() => /Enter keyboard mode/i.test(document.body.innerText)))
return R
