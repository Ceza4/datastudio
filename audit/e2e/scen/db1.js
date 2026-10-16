//@include fresh.js
await H.add('Database'); await sleep(500); await page.keyboard.press('Escape')
const R = {}
const W = () => page.evaluate(() => document.querySelector('[data-ds-block-wrap]').innerText.replace(/\n+/g, ' | ').slice(0, 400))
R.start = await W()
await page.getByText('New row').click(); await sleep(300)
R.afterNewRow = { active: await H.active(), text: await W() }
await page.keyboard.type('Row one'); await page.keyboard.press('Enter'); await sleep(300)
R.afterType = { active: await H.active(), text: await W() }
await page.getByText('New row').click(); await sleep(300)
await page.keyboard.type('Row two'); await page.keyboard.press('Escape'); await sleep(300)
R.afterEsc = { active: await H.active(), text: await W() }
await shot('db1')
return R
