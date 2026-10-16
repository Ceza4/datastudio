//@include fresh.js
const R = {}
const locked = () => page.evaluate(() => [...document.querySelectorAll('span')].some(s => s.textContent.trim() === 'LOCKED'))
await H.add('Database'); await sleep(500); await page.keyboard.press('Escape'); await sleep(100)
await page.locator('[data-ds-block-wrap]').first().locator('button', { hasText: 'Filter' }).click(); await sleep(400)
R.crashed = await page.getByText(/couldn.t be displayed/).count()
await page.locator('[data-ds-block-wrap]').first().click({ position: { x: 20, y: 10 } }).catch(() => {})
R.lockedBefore = await locked()
await page.locator('[role=alert] button', { hasText: 'Delete block' }).first().click(); await sleep(700)
R.after = { blocks: (await H.dom()).length, locked: await locked(), toasts: await H.toasts() }
// wheel pans again?
const T = () => page.evaluate(() => [...document.querySelectorAll('[role=application] *')].map(e => e.style.transform).filter(t => /translate/.test(t)).slice(0, 3).join('|'))
const pan0 = await T()
await page.mouse.move(800, 450); await page.mouse.wheel(0, 300); await sleep(300)
const pan1 = await T(); R.panMoved = { moved: pan0 !== pan1, pan0, pan1 }
// undo path: add a note, Ctrl+Z the add while it is selected
await H.add('Notes'); await page.keyboard.type('x'); await page.keyboard.press('Escape'); await sleep(200)
R.noteSelected = await locked()
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+z'); await sleep(300); await page.keyboard.press('Control+z'); await sleep(500)
R.afterUndo = { blocks: (await H.dom()).length, locked: await locked() }
return R
