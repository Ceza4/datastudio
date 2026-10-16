//@include fresh.js
await H.add('Notes'); await page.keyboard.type('x'); await page.keyboard.press('Escape'); await sleep(300)
for (const w of [1366, 1440, 1536, 1600, 1920]) {
  await page.setViewportSize({ width: w, height: 860 }); await sleep(400)
  await page.screenshot({ path: `/home/claude/e2e/shots/top-${w}.png`, clip: { x: 0, y: 0, width: w, height: 70 } })
}
const res = await page.evaluate(() => { const isl = document.querySelector('[data-ds-island=top] > div > div'); return { sw: isl.scrollWidth, cw: isl.clientWidth } })
return res
