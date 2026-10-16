//@include fresh.js
const R = {}
const state = async () => { const all = await H.saved(); const st = all?.find(x => x && x.notebooks); const nb = st.notebooks.find(n => n.id === st.activeNotebookId) || st.notebooks[0]; const sh = nb.sheets.find(s => s.id === nb.activeSheetId) || nb.sheets[0]; return { shapes: (sh.shapes || []).map(s => s.type || s.kind), conns: (sh.connections || []).length } }
await page.locator('button[title^="Draw on the canvas"]').click(); await sleep(400)
await page.mouse.move(700, 400); await page.keyboard.press('r'); await sleep(100)
await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(620, 380, { steps: 6 }); await page.mouse.up(); await sleep(200)
await page.keyboard.press('Escape'); await sleep(100)
await page.keyboard.press('o'); await sleep(100)
await page.mouse.move(800, 300); await page.mouse.down(); await page.mouse.move(920, 380, { steps: 6 }); await page.mouse.up(); await sleep(200)
await page.keyboard.press('Escape'); await sleep(100)
await page.keyboard.press('c'); await sleep(100)
await page.mouse.move(560, 340); await page.mouse.down(); await page.mouse.move(860, 340, { steps: 10 }); await page.mouse.up(); await sleep(300)
await page.keyboard.press('Escape'); await sleep(900)
R.after3 = await state()
await shot('vis1')
// move the rectangle: does the connector follow?
await page.keyboard.press('v'); await sleep(100)
await page.mouse.move(530, 320); await page.mouse.down(); await page.mouse.move(530, 520, { steps: 8 }); await page.mouse.up(); await sleep(300)
await shot('vis1b')
await page.keyboard.press('Escape'); await sleep(100); await page.keyboard.press('Escape'); await sleep(100)
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+z'); await sleep(300)
await page.keyboard.press('Control+z'); await sleep(300)
await sleep(800); R.afterUndo2 = await state()
await page.keyboard.press('Control+Shift+z'); await sleep(300); await sleep(800)
R.afterRedo = await state()
await page.reload({ waitUntil: 'networkidle' }); await sleep(900)
R.afterReload = { dom: await page.evaluate(() => document.querySelectorAll('svg [data-shape-id], [data-ds-shape]').length), saved: await state() }
return R
