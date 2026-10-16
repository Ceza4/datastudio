//@include fresh.js
await H.add('Database'); await sleep(500)
const out = {}
for (const w of [1280, 1366, 1440, 1536, 1700, 1920]) {
  await page.setViewportSize({ width: w, height: 800 }); await sleep(250)
  out[w] = await page.evaluate(() => {
    const name = [...document.querySelectorAll('span')].find(e => e.textContent === 'My Project' && e.getBoundingClientRect().y < 60 && e.getBoundingClientRect().x > 270)
    const sheet = name.nextElementSibling
    const lk = document.querySelector('.ds-locked')
    const isl = name.parentElement
    return { name: Math.round(name.getBoundingClientRect().width) + '/' + name.scrollWidth, sheet: Math.round(sheet.getBoundingClientRect().width), locked: Math.round(lk.getBoundingClientRect().width), icon: getComputedStyle(lk.querySelector('.ds-locked-icon')).display, clipped: isl.scrollWidth > isl.clientWidth }
  })
  await page.screenshot({ path: `/home/claude/e2e/shots/title-${w}.png`, clip: { x: 270, y: 10, width: 480, height: 50 } })
}
return out
