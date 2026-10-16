//@include fresh.js
const R = {}
await H.add('Table Block'); await sleep(400)
const g = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').getBoundingClientRect().toJSON())
R.grid = g
const cell = (r, c) => ({ x: g.x + 48 + 130 * c + 60, y: g.y + 26 + 24 * r + 12 })
const readCells = () => page.evaluate(() => {
  // read the persisted rows via the fiber-free route: the visible text of the grid
  return document.querySelector('[data-ds-grid-scroll]').innerText.split('\n').filter(Boolean).slice(0, 40)
})
await page.mouse.click(cell(0, 0).x, cell(0, 0).y); await sleep(150)
R.focus1 = await H.active()
await page.keyboard.type('123'); await page.keyboard.press('Enter'); await sleep(100)
await page.keyboard.type('abc'); await page.keyboard.press('Tab'); await sleep(100)
await page.keyboard.type('x,y'); await page.keyboard.press('Enter'); await sleep(200)
R.afterType = await readCells()
R.focus2 = await H.active()
// Escape while editing: abandon
await page.mouse.click(cell(3, 0).x, cell(3, 0).y); await sleep(100)
await page.keyboard.type('SHOULDNOT'); await page.keyboard.press('Escape'); await sleep(150)
R.afterEscEdit = await readCells()
// Delete in grid clears cell, not the block
await page.mouse.click(cell(0, 0).x, cell(0, 0).y); await sleep(100)
await page.keyboard.press('Delete'); await sleep(200)
R.afterDelete = { cells: await readCells(), blocks: (await H.dom()).length }
// Ctrl+Z in grid restores
await page.keyboard.press('Control+z'); await sleep(200)
R.afterGridUndo = await readCells()
// Escape twice leaves the sheet; third keeps block selected?
await page.keyboard.press('Escape'); await sleep(100)
R.esc1 = { active: await H.active(), sel: await H.selected() }
await page.keyboard.press('Escape'); await sleep(100)
R.esc2 = { active: await H.active(), sel: await H.selected() }
await page.keyboard.press('Escape'); await sleep(100)
R.esc3 = { active: await H.active(), sel: await H.selected() }
await sleep(1200)
await page.reload({ waitUntil: 'networkidle' }); await sleep(1000)
R.afterReload = await readCells().catch(e => 'ERR ' + e.message)
await shot('g1')
return R
