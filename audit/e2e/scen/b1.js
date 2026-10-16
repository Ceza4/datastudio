//@include fresh.js
await page.getByRole('button', { name: /builder/i }).first().click(); await sleep(500)
await shot('b1')
return await page.evaluate(() => document.body.innerText.slice(0, 1200))
