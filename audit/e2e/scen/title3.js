//@include fresh.js
await H.add('Database'); await sleep(500)
const out = {}
for (const w of [1280, 1366, 1440, 1536, 1568, 1600, 1700, 1800, 1920]) {
  await page.setViewportSize({ width: w, height: 800 }); await sleep(250)
  out[w] = await page.evaluate(() => {
    const top = document.querySelector('[data-ds-island=top]')
    const name = [...document.querySelectorAll('span')].find(e => e.textContent === 'My Project' && e.getBoundingClientRect().y < 60 && e.getBoundingClientRect().x > 270)
    const col = name.closest("[data-ds-island=top] > div")
    return { tpl: getComputedStyle(top).gridTemplateColumns, col: Math.round(col.getBoundingClientRect().width), name: Math.round(name.getBoundingClientRect().width) }
  })
}
return out
