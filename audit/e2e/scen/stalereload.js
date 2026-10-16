//@include fresh.js
await H.add('Notes'); await page.keyboard.type('shared'); await page.keyboard.press('Escape'); await sleep(1500)
const p2 = await context.newPage(); await p2.setViewportSize({ width: 1440, height: 900 })
await p2.goto('http://localhost:3100/app'); await sleep(3000)
await page.locator('[data-ds-block-wrap] [contenteditable=true]').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' ONE'); await sleep(1500)
await p2.locator('[data-ds-block-wrap] [contenteditable=true]').first().click(); await p2.keyboard.press('End'); await p2.keyboard.type(' TWO'); await sleep(1500)
const st = async pg => pg.evaluate(() => /Changed in another tab/.test(document.body.innerText))
const R = { stale: [await st(page), await st(p2)] }
const pg = R.stale[0] ? page : p2
const t0 = await pg.evaluate(() => performance.timeOrigin)
await pg.getByRole('button', { name: 'Reload' }).click(); await sleep(3000)
const t1 = await pg.evaluate(() => performance.timeOrigin)
R.reloaded = t1 !== t0
R.afterReload = { banner: await st(pg), text: await pg.evaluate(() => document.querySelector('[data-ds-block-wrap]')?.innerText.slice(0, 40)) }
await p2.close()
return R
