const R = {}
await page.getByText('Visuals', { exact: true }).last().click(); await sleep(500)
await shot('v1-bar')
R.bar = await page.evaluate(() => [...document.querySelectorAll('[role=toolbar] button, [data-ds-visuals] button')].map(b => (b.getAttribute('aria-label') || b.title || b.innerText).slice(0, 25)))
// pick rectangle with R key and draw
await page.keyboard.press('r'); await sleep(150)
await page.mouse.move(600, 300); await page.mouse.down(); await page.mouse.move(800, 420, { steps: 8 }); await page.mouse.up(); await sleep(300)
R.shapesAfterRect = await page.evaluate(() => document.querySelectorAll('[data-shape-id], [data-ds-shape]').length)
await shot('v1-rect')
// sticky
await page.keyboard.press('Escape'); await sleep(100)
await page.keyboard.press('n'); await sleep(150)
await page.mouse.click(1000, 500); await sleep(300)
R.activeAfterSticky = await H.active()
await page.keyboard.type('Sticky text'); await sleep(100)
await page.keyboard.press('Escape'); await sleep(200)
R.shapes2 = await page.evaluate(() => document.querySelectorAll('[data-shape-id], [data-ds-shape]').length)
R.blocks = (await H.dom()).length
await shot('v1-sticky')
return R
