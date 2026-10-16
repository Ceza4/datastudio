//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('One'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200)
await H.add('Notes'); await page.keyboard.type('Two'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200)
R.start = await H.dom()
// Click empty canvas with nothing selected
await page.mouse.click(1200, 700); await sleep(500)
R.bgClick1 = { n: (await H.dom()).length, active: await H.active(), sel: await H.selected() }
await page.keyboard.press('Escape'); await sleep(100); await page.keyboard.press('Escape'); await sleep(300)
R.afterEsc = { n: (await H.dom()).length, sel: await H.selected() }
await shot('k3-a')
return R
