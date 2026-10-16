//@include fresh.js
await H.add('Task'); await sleep(400)
const d = await H.dom(); const b = d[0]
await page.mouse.click(b.x + 60, b.y + 14); await sleep(300)
await shot('task1')
const R = {}
R.ui = await page.evaluate(() => [...document.querySelectorAll('button,input,select,[role=button]')].filter(e => e.getBoundingClientRect().width && (e.closest('[data-ds-block-wrap]') || e.closest('[data-island-rail],[data-kbd-zone]'))).map(e => (e.getAttribute('aria-label') || e.title || e.placeholder || e.innerText || e.type).slice(0, 30)))
return R
