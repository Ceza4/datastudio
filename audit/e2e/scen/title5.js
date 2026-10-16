//@include fresh.js
await H.add('Database'); await sleep(500)
await page.setViewportSize({ width: 1280, height: 800 }); await sleep(250)
const m = () => page.evaluate(() => {
  const isl = document.querySelector('.ds-title-island'); const z = document.querySelector('.ds-title-zoom')
  const name = isl.querySelector('span')
  return { name: name.textContent + ' ' + Math.round(name.getBoundingClientRect().width) + '/' + name.scrollWidth, zoom: z ? getComputedStyle(z).display + ':' + z.textContent : null, clipped: isl.scrollWidth > isl.clientWidth }
})
const R = {}
R.selected = await m()
await page.keyboard.press('Escape'); await sleep(100); await page.keyboard.press('Escape'); await sleep(200)
R.deselected = await m()
await page.mouse.move(800, 500); await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control'); await sleep(400)
R.zoomed = await m()
// long name
await page.locator('.ds-title-island span').first().dblclick(); await sleep(250)
R.renameField = await H.active()
await page.keyboard.press('Control+a'); await page.keyboard.type('Quarterly revenue analysis 2026'); await page.keyboard.press('Enter'); await sleep(300)
R.longName = await m()
await page.screenshot({ path: '/home/claude/e2e/shots/title-long.png', clip: { x: 270, y: 10, width: 480, height: 50 } })
return R
