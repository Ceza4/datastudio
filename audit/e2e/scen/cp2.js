//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('copy me'); await page.keyboard.press('Escape'); await sleep(300)
R.selected = await H.selected(); console.log('step: selected', R.selected)
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+c'); await sleep(200)
R.toastCopy = await H.toasts(); console.log('step: copied', R.toastCopy)
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(600)
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+v'); await sleep(600)
R.sheet2 = (await H.dom()).map(b => ({ id: b.id, t: b.text.slice(0, 20) }))
await page.keyboard.press('Control+v'); await sleep(600)
const d = await H.dom(); R.twoPastes = { n: d.length, ids: new Set(d.map(b => b.id)).size, overlap: d.length === 2 && d[0].x === d[1].x && d[0].y === d[1].y }
if (!d.length) { R.active = await H.active(); return R }
// cut on sheet 2 then undo
await page.locator('[data-ds-block-wrap]').first().click({ position: { x: 40, y: 10 }, force: true }); await sleep(150)
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+x'); await sleep(500)
R.afterCut = (await H.dom()).length
await page.keyboard.press('Control+z'); await sleep(500)
R.afterUndoCut = (await H.dom()).length
// sheet 1 original untouched
await page.getByText('Sheet 1', { exact: true }).first().click(); await sleep(600)
R.sheet1 = (await H.dom()).map(b => ({ id: b.id, t: b.text.slice(0, 20) }))
// paste into a text editor: should paste text, not a block
await page.locator('[data-ds-block-wrap] [contenteditable=true]').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Control+v'); await sleep(400)
R.pasteInText = { blocks: (await H.dom()).length, text: (await H.dom())[0].text.slice(0, 60) }
return R
