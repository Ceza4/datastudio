//@include fresh.js
await H.add('Database'); await sleep(500)
const out = {}
for (const w of [1280, 1366, 1440, 1568, 1700, 1920]) {
  await page.setViewportSize({ width: w, height: 800 }); await sleep(300)
  out[w] = await page.evaluate(() => {
    const name = [...document.querySelectorAll('span')].find(e => e.textContent === 'My Project' && e.getBoundingClientRect().y < 60 && e.getBoundingClientRect().x > 270)
    const island = name?.closest('[data-ds-island], div[style*="border-radius"]')
    const row = name?.parentElement
    const r = name?.getBoundingClientRect(), rr = row?.getBoundingClientRect()
    const kids = row ? [...row.children].map(k => k.tagName + ':' + Math.round(k.getBoundingClientRect().width) + ':' + (k.textContent || '').slice(0, 10)) : []
    return { nameW: Math.round(r?.width), rowW: Math.round(rr?.width), rowX: Math.round(rr?.x), kids }
  })
}
return out
