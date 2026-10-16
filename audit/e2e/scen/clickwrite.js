//@include fresh.js
await page.mouse.click(760, 500); await sleep(500)
const a = { blocks: (await H.dom()).length, active: await H.active() }
await page.keyboard.type('hello'); await page.keyboard.press('Escape'); await sleep(200)
await page.mouse.click(1000, 700); await sleep(400)   // lets go of the selection only
const b = (await H.dom()).length
await page.mouse.click(1000, 700); await sleep(400)   // now writes
return { a, afterRelease: b, afterSecond: (await H.dom()).length }
