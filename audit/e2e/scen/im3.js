//@include fresh.js
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /import file/i }).click()])
await fc.setFiles(['/home/claude/e2e/fixtures/euro.csv', '/home/claude/e2e/fixtures/multi.xlsx'])
await sleep(2000)
const btns = page.getByRole('button', { name: /Whole table/ })
await btns.nth(0).click(); await sleep(800)
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200)
await btns.nth(1).click(); await sleep(800)
const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
return { tz, grids: await page.evaluate(() => [...document.querySelectorAll('[data-ds-grid-scroll]')].map(g => g.innerText.split('\n').filter(Boolean).slice(16, 30))) }
