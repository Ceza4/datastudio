//@include fresh.js
await H.add('Kanban Board'); await sleep(500)
await page.keyboard.press('Escape'); await sleep(100)
await shot('kb1')
const R = {}
R.buttons = await page.evaluate(() => { const w = document.querySelector('[data-ds-block-wrap]'); return [...w.querySelectorAll('button,[role=button],input,textarea')].map(b => (b.getAttribute('aria-label') || b.title || b.placeholder || b.innerText || b.tagName).slice(0, 30)) })
R.text = await page.evaluate(() => document.querySelector('[data-ds-block-wrap]').innerText.slice(0, 300))
return R
