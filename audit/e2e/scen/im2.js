const R = {}
const btns = page.getByRole('button', { name: /Whole table/ })
await btns.nth(1).click(); await sleep(800)
R.euro = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]')?.innerText.split('\n').filter(Boolean).slice(0, 30))
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200)
await btns.nth(2).click(); await sleep(800)
R.xlsx = await page.evaluate(() => [...document.querySelectorAll('[data-ds-grid-scroll]')].map(g => g.innerText.split('\n').filter(Boolean).slice(0, 30)))
await shot('im2')
return R
