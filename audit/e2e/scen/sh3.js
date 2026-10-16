//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('S1 note'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(400)
await H.add('Notes'); await page.keyboard.type('S2 note'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await sleep(800)
// hover Sheet 2 row to reveal delete
const row = page.getByText('Sheet 2', { exact: true }).first()
await row.hover(); await sleep(200)
R.rowButtons = await page.evaluate(() => { const el = [...document.querySelectorAll('span')].find(s => s.textContent === 'Sheet 2'); const r = el.closest('div'); return [...r.querySelectorAll('button')].map(b => b.title || b.getAttribute('aria-label') || b.innerText) })
const del = page.locator('button[title*="Delete" i]').filter({ hasNot: page.locator('xx') })
R.delCount = await del.count()
await shot('sh3-hover')
return R
