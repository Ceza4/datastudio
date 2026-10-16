//@include fresh.js
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3100' })
const R = {}
await H.add('Notes'); await page.keyboard.type('copy me'); await page.keyboard.press('Escape'); await sleep(200)
await page.keyboard.press('Control+c'); await sleep(300)
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(500)
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+v'); await sleep(700)
R.sheet2 = (await H.dom()).map(b => b.text)
// external plain text
await page.evaluate(() => navigator.clipboard.writeText('Plain text from elsewhere\nsecond line'))
await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+v'); await sleep(700)
R.afterPlain = { blocks: (await H.dom()).map(b => b.text), toasts: await H.toasts() }
// tab-separated (from Excel)
await page.evaluate(() => navigator.clipboard.writeText('a\tb\n1\t2\n3\t4'))
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+v'); await sleep(700)
R.afterTsv = { blocks: (await H.dom()).map(b => b.text.slice(0, 40)), toasts: await H.toasts() }
return R
