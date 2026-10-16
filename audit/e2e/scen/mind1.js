//@include fresh.js
const R = {}
const st = async () => { const all = await H.saved(); const s = all?.find(x => x && x.notebooks); const nb = s.notebooks.find(n => n.id === s.activeNotebookId) || s.notebooks[0]; const sh = nb.sheets.find(x => x.id === nb.activeSheetId) || nb.sheets[0]; return (sh.shapes || []).map(x => (x.type || x.kind) + ':' + (x.text || x.label || '')) }
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+k'); await sleep(300); await page.keyboard.type('Open Visuals'); await sleep(200); await page.keyboard.press('Enter'); await sleep(500)
await page.mouse.move(700, 450); await page.keyboard.press('m'); await sleep(150)
await page.mouse.click(700, 450); await sleep(400)
R.afterPlace = { active: await H.active(), shapes: await st() }
await page.keyboard.type('Plan'); await page.keyboard.press('Enter'); await sleep(300)   // commit text?
R.afterRootText = { active: await H.active() }
await page.keyboard.press('Tab'); await sleep(250)
await page.keyboard.type('Research'); await page.keyboard.press('Enter'); await sleep(250)
await page.keyboard.press('Enter'); await sleep(250)
await page.keyboard.type('Build'); await page.keyboard.press('Enter'); await sleep(250)
await sleep(900)
R.afterTree = await st()
await shot('mind1')
await page.keyboard.press('ArrowUp'); await sleep(150)
await page.keyboard.press('Delete'); await sleep(400)
await sleep(800); R.afterDelete = await st()
await page.keyboard.press('Escape'); await page.locator('[role=application]').focus()
await page.keyboard.press('Control+z'); await sleep(500); await sleep(800)
R.afterUndo = await st()
return R
