//@include fresh.js
const R = {}
const esc = async () => { for (let i = 0; i < 2; i++) { const inB = await page.evaluate(() => !!document.activeElement?.closest('[data-ds-block-wrap]')); if (!inB) break; await page.keyboard.press('Escape'); await sleep(100) } }
await H.add('Section'); await esc(); await page.keyboard.press('Escape')
await H.add('Notes'); await page.keyboard.type('child'); await esc(); await page.keyboard.press('Escape')
let d = await H.dom()
const sec = d[0], note = d[1]
R.start = d.map(b => [b.x, b.y, b.w, b.h])
// drag note into section center
await page.mouse.move(note.x + 60, note.y + 14); await page.mouse.down()
await page.mouse.move(sec.x + 80, sec.y + 80, { steps: 15 }); await sleep(150); await page.mouse.up(); await sleep(500)
d = await H.dom(); R.afterDrop = d.map(b => [b.x, b.y, b.w, b.h])
// drag section by its header: child should follow
const s2 = d[0]
await page.mouse.move(s2.x + 120, s2.y + 18); await page.mouse.down(); await page.mouse.move(s2.x + 220, s2.y + 118, { steps: 12 }); await page.mouse.up(); await sleep(500)
const d3 = await H.dom(); R.afterSectionMove = d3.map((b, i) => [b.x - d[i].x, b.y - d[i].y])
// undo once: both back?
await page.keyboard.press('Escape'); await sleep(100)
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+z'); await sleep(500)
const d4 = await H.dom(); R.undoMove = d4.map((b, i) => [b.x - d[i].x, b.y - d[i].y])
// delete section via selection + Delete => dialog
await page.mouse.click(d4[0].x + 120, d4[0].y + 18); await sleep(200)
await page.keyboard.press('Escape'); await sleep(100)
await page.mouse.click(d4[0].x + 120, d4[0].y + 18); await sleep(200)
await page.keyboard.press('Delete'); await sleep(400)
R.dialog = await page.evaluate(() => document.querySelector('[role=dialog],[role=alertdialog]')?.innerText.replace(/\n+/g, ' | '))
R.dialogFocus = await H.active()
await shot('sec1')
await page.keyboard.press('Escape'); await sleep(300)
R.afterCancel = (await H.dom()).length
return R
