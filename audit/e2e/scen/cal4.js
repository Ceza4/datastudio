//@include fresh.js
await H.add('Calendar'); await sleep(600)
const box = await page.locator('[data-ds-block-wrap]').first().boundingBox()
await shot('cal4', { clip: { x: box.x, y: box.y, width: box.width, height: 140 } })
// week + agenda titles too
const out = {}
for (const v of ['Week', 'Agenda']) {
  await page.locator('[data-ds-block-wrap] button', { hasText: v }).first().click(); await sleep(250)
  out[v] = await page.evaluate(() => { const s = document.querySelector('[data-ds-block-wrap] span[title]'); return s ? s.textContent + ' ' + Math.round(s.getBoundingClientRect().width) + '/' + s.scrollWidth : null })
}
return out
