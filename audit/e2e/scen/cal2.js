//@include fresh.js
await H.add('Calendar'); await sleep(600)
const hdr = await page.evaluate(() => { const b = document.querySelector('[data-ds-block-wrap]'); const t = [...b.querySelectorAll('button, span, div')].find(e => e.textContent.trim() === 'Today'); const row = t?.parentElement; return row ? [...row.children].map(c => c.tagName + ':' + JSON.stringify(c.textContent.trim().slice(0, 20)) + ':' + (c.getAttribute('aria-label') || c.title || '')) : null })
const box = await page.locator('[data-ds-block-wrap]').first().boundingBox()
await shot('cal2', { clip: { x: box.x + 170, y: box.y + 30, width: 360, height: 50 } })
return hdr
