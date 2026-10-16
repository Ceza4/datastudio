//@include fresh.js
await page.getByRole('button', { name: /^add$/i }).first().click(); await sleep(400)
const box = await page.locator('[role=listbox]').boundingBox()
await shot('addmenu2', { clip: { x: box.x - 12, y: box.y - 60, width: box.width + 24, height: Math.min(box.height + 70, 820) } })
await page.keyboard.press('Escape'); await sleep(100)
await page.locator('[role=application]').focus(); await page.keyboard.press('c'); await sleep(500)
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(100)
await page.keyboard.press('m'); await sleep(300)
return { blocks: (await H.dom()).map(b => b.text.slice(0, 12)), kbMode: await H.active() }
