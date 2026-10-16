//@include fresh.js
const R = {}
const t0 = Date.now()
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /import file/i }).click()])
await fc.setFiles(['/home/claude/e2e/fixtures/big.csv'])
await page.getByRole('button', { name: /Whole table/ }).first().waitFor({ timeout: 30000 })
R.importMs = Date.now() - t0
const t1 = Date.now()
await page.getByRole('button', { name: /Whole table/ }).first().click()
await page.waitForSelector('[data-ds-grid-scroll]', { timeout: 30000 }); await sleep(100)
R.tableMs = Date.now() - t1
R.status = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').parentElement.parentElement.innerText.match(/[\d,]+ rows/)?.[0])
// scroll the grid deep and measure frame times
const g = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').getBoundingClientRect().toJSON())
await page.mouse.move(g.x + 200, g.y + 100)
const t2 = Date.now()
for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 2000); await sleep(16) }
R.scrollMs = Date.now() - t2
R.long = await page.evaluate(() => new Promise(res => { const obs = []; const po = new PerformanceObserver(l => obs.push(...l.getEntries().map(e => Math.round(e.duration)))); po.observe({ type: 'longtask', buffered: true }); setTimeout(() => { po.disconnect(); res(obs.slice(-15)) }, 300) }))
// type into a cell deep down
await page.mouse.click(g.x + 120, g.y + 60); await sleep(100)
const t3 = Date.now(); await page.keyboard.type('X'); await page.keyboard.press('Enter'); await sleep(50); R.editMs = Date.now() - t3
await sleep(2000)
R.saveState = await H.toasts()
R.heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) + 'MB' : null)
await shot('pf1')
return R
