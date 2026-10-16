//@include fresh.js
await H.add('Notes'); await page.keyboard.type('shared'); await page.keyboard.press('Escape'); await sleep(1500)
const p2 = await context.newPage(); await p2.setViewportSize({ width: 1440, height: 900 })
const R = { trials: [] }
for (let i = 0; i < 3; i++) {
  await Promise.all([page.goto('http://localhost:3100/app'), p2.goto('http://localhost:3100/app')])
  await sleep(4000)
  const b1 = await page.evaluate(() => /Changed in another tab/.test(document.body.innerText))
  const b2 = await p2.evaluate(() => /Changed in another tab/.test(document.body.innerText))
  R.trials.push([b1, b2])
}
// a REAL conflict must still be caught: edit in tab 1, then edit in tab 2 without reloading
await page.locator('[data-ds-block-wrap] [contenteditable=true]').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' ONE'); await sleep(1500)
await p2.locator('[data-ds-block-wrap] [contenteditable=true]').first().click(); await p2.keyboard.press('End'); await p2.keyboard.type(' TWO'); await sleep(1500)
R.realConflict = [await page.evaluate(() => /Changed in another tab/.test(document.body.innerText)), await p2.evaluate(() => /Changed in another tab/.test(document.body.innerText))]
await p2.close()
return R
