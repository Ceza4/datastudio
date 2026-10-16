//@include fresh.js
const btn = page.locator('button[title^="Draw on the canvas"]')
await btn.hover(); await sleep(400)
const R = {}
R.hoverPanel = await page.evaluate(() => { const b = document.querySelector('button[title^="Draw on the canvas"]'); const w = b.parentElement; return w.innerText.split('\n').filter(Boolean) })
await page.mouse.move(700, 600); await sleep(400)
await btn.focus(); await sleep(300)
R.focusPanel = await page.evaluate(() => { const b = document.querySelector('button[title^="Draw on the canvas"]'); return b.parentElement.innerText.split('\n').filter(Boolean) })
await page.keyboard.press('ArrowDown'); await sleep(200)
R.afterArrow = await H.active()
return R
