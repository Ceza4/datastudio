//@include fresh.js
await H.add('Notes'); await page.keyboard.type('On sheet one'); await sleep(200)
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(600)
await H.add('Notes'); await page.keyboard.type('On sheet two'); await sleep(300)
await page.keyboard.press('Escape'); await sleep(150)
await page.getByText('Sheet 1', { exact: true }).first().click(); await sleep(600)
await page.getByText('Sheet 2', { exact: true }).first().click(); await sleep(600)
return await H.history()
