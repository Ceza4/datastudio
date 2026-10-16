//@include fresh.js
const R = {}
const esc = async () => { for (let i = 0; i < 2; i++) { const inBlock = await page.evaluate(() => !!document.activeElement?.closest('[data-ds-block-wrap]')); if (!inBlock) break; await page.keyboard.press('Escape'); await sleep(120) } }
await H.add('Notes'); await page.keyboard.type('One'); await esc()
await H.add('Table Block'); await esc()
await H.add('Task'); await esc()
let d = await H.dom()
R.start = d.map(b => [b.x, b.y, b.w, b.h])
// marquee from empty space covering all
await page.mouse.click(1350, 850); await sleep(200)   // deselect
await page.mouse.move(300, 100); await page.mouse.down(); await page.mouse.move(700, 500, { steps: 8 }); await page.mouse.move(1430, 890, { steps: 8 }); await page.mouse.up(); await sleep(300)
R.marquee = await H.selected()
await shot('k4-marquee')
// drag one selected block: all should move
d = await H.dom()
const a = d[0]
await page.mouse.move(a.x + 60, a.y + 14); await page.mouse.down(); await page.mouse.move(a.x + 160, a.y + 64, { steps: 10 }); await page.mouse.up(); await sleep(500)
const d2 = await H.dom()
R.multiDrag = d2.map((b, i) => [b.x - d[i].x, b.y - d[i].y])
R.selAfterDrag = (await H.selected()).length
await page.keyboard.press('Control+z'); await sleep(400)
const d3 = await H.dom()
R.undoMulti = d3.map((b, i) => [b.x - d[i].x, b.y - d[i].y])
R.toast = await H.toasts()
// right-click context menu on a selected block
await page.mouse.click(d3[1].x + 60, d3[1].y + 14, { button: 'right' }); await sleep(300)
R.ctx = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /Duplicate|Delete|Full screen|Fit to|Reset size/.test(b.innerText)).map(b => b.innerText.trim()))
await shot('k4-ctx')
await page.keyboard.press('Escape'); await sleep(200)
R.ctxAfterEsc = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /Duplicate \(/.test(b.innerText)).length)
return R
