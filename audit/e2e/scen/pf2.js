const g = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').getBoundingClientRect().toJSON())
await page.mouse.click(g.x + 120, g.y + 84); await sleep(100)
await page.keyboard.type('Y'); await page.keyboard.press('Enter'); await sleep(300)
const t = Date.now(); await page.keyboard.press('Control+z'); await page.waitForFunction(() => !document.querySelector('[data-ds-grid-scroll]').innerText.includes('\nY\n'), null, { timeout: 5000 }).catch(() => {}); const undoMs = Date.now() - t
// canvas-level undo of the same: escape out then Ctrl+Z
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200)
await page.locator('[role=application]').focus()
const t2 = Date.now(); await page.keyboard.press('Control+z'); await sleep(50); const wsUndo = Date.now() - t2
return { undoMs, wsUndo, toasts: await H.toasts() }
