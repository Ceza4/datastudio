await page.locator("[role=application]").focus(); await page.keyboard.press("Control+z"); await sleep(400); await page.keyboard.press("Control+z"); await sleep(600)
const btn = page.locator('button[title="Find, replace and format painter"]')
await btn.click(); await sleep(250)
const items = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /^(Find|Replace|Format painter)/.test(b.innerText.trim())).map(b => b.innerText.trim().replace(/\s+/g, ' ')))
await page.getByRole('button', { name: /^Find/ }).last().click(); await sleep(300)
const findOpen = await page.evaluate(() => !!document.querySelector('input[placeholder*="Find" i], input[aria-label*="Find" i]'))
return { items, findOpen }
