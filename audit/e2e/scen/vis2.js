//@include fresh.js
const R = {}
const st = async () => { const all = await H.saved(); const s = all?.find(x => x && x.notebooks); const nb = s.notebooks.find(n => n.id === s.activeNotebookId) || s.notebooks[0]; const sh = nb.sheets.find(x => x.id === nb.activeSheetId) || nb.sheets[0]; return { shapes: (sh.shapes || []).map(x => x.type || x.kind || x.shape), conns: (sh.connections || []).length, keys: Object.keys(sh) } }
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+k'); await sleep(300); await page.keyboard.type('Open Visuals'); await sleep(200); await page.keyboard.press('Enter'); await sleep(500)
R.barOpen = await page.evaluate(() => document.body.innerText.includes('Rectangle') || !!document.querySelector('[data-ds-visuals-bar], [aria-label*="Visuals"]'))
await page.mouse.move(700, 450)
await page.keyboard.press('r'); await sleep(150)
await page.mouse.move(450, 300); await page.mouse.down(); await page.mouse.move(600, 400, { steps: 8 }); await page.mouse.up(); await sleep(300)
await page.keyboard.press('Escape'); await sleep(100)
await page.keyboard.press('o'); await sleep(150)
await page.mouse.move(850, 300); await page.mouse.down(); await page.mouse.move(1000, 400, { steps: 8 }); await page.mouse.up(); await sleep(300)
await page.keyboard.press('Escape'); await sleep(100)
await page.keyboard.press('c'); await sleep(150)
await page.mouse.move(525, 350); await page.mouse.down(); await page.mouse.move(925, 350, { steps: 12 }); await page.mouse.up(); await sleep(400)
await page.keyboard.press('Escape'); await sleep(1000)
R.afterDraw = await st()
await shot('vis2a')
// move rectangle with V
await page.keyboard.press('v'); await sleep(100)
await page.mouse.move(470, 320); await page.mouse.down(); await page.mouse.move(470, 560, { steps: 10 }); await page.mouse.up(); await sleep(500)
await shot('vis2b')
// text on a shape
await page.mouse.dblclick(525, 590); await sleep(300); R.editShape = await H.active()
await page.keyboard.type('Start'); await page.keyboard.press('Escape'); await sleep(400)
await page.keyboard.press('Escape'); await sleep(200)
await page.locator('[role=application]').focus()
for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+z'); await sleep(250) }
await sleep(800); R.afterUndo3 = await st()
for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Shift+z'); await sleep(250) }
await sleep(800); R.afterRedo3 = await st()
await page.reload({ waitUntil: 'networkidle' }); await sleep(1000)
R.afterReload = await st()
await shot('vis2c')
return R
