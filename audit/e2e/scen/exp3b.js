//@include fresh.js
await H.add('Table Block'); await sleep(300)
const g = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').getBoundingClientRect().toJSON())
await page.mouse.click(g.x + 48 + 60, g.y + 26 + 12); await page.keyboard.type('a'); await page.keyboard.press('Tab'); await page.keyboard.type('b,c'); await page.keyboard.press('Enter'); await sleep(200)
const cells = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').innerText.split('\n').filter(Boolean).slice(-4))
return cells
