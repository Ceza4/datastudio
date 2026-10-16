//@include fresh.js
await H.add('Notes'); await page.keyboard.type('Export me'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await H.add('Table Block'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await page.getByRole('button', { name: /export/i }).first().click(); await sleep(500)
await shot('exp1')
const opts = await page.evaluate(() => { const d = document.querySelector('[role=dialog]') || document.body; return [...d.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || b.innerText).replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean) })
return opts
