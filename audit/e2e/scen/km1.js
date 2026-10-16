//@include fresh.js
const R = {}
const esc = async () => { for (let i = 0; i < 2; i++) { const inB = await page.evaluate(() => !!document.activeElement?.closest('[data-ds-block-wrap]')); if (!inB) break; await page.keyboard.press('Escape'); await sleep(100) } }
await H.add('Notes'); await page.keyboard.type('A'); await esc()
await H.add('Notes'); await page.keyboard.type('B'); await esc()
await H.add('Table Block'); await esc()
await page.keyboard.press('Escape'); await sleep(100)
await page.locator('[role=application]').focus()
await page.keyboard.press('m'); await sleep(500)
R.m = { sel: await H.selected() }
await page.keyboard.press('ArrowDown'); await sleep(500)
R.down = await H.selected()
await page.keyboard.press('g'); await sleep(100)
const before = (await H.dom()).find(b => b.id === R.down[0])
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await sleep(200)
await page.keyboard.press('Escape'); await sleep(300)
const after = (await H.dom()).find(b => b.id === R.down[0])
R.grabCancel = [after.x - before.x, after.y - before.y]
await page.keyboard.press('g'); await sleep(100)
for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
await page.keyboard.press('Enter'); await sleep(300)
const after2 = (await H.dom()).find(b => b.id === R.down[0])
R.grabCommit = [after2.x - before.x, after2.y - before.y]
// Enter enters block
await page.keyboard.press('Enter'); await sleep(300)
R.enter = await H.active()
await page.keyboard.press('Escape'); await sleep(200)
R.escBack = { active: await H.active(), sel: await H.selected() }
// Tab -> toolbar
await page.keyboard.press('Tab'); await sleep(200)
R.tab = await H.active()
await page.keyboard.press('Escape'); await sleep(200)
R.tabEsc = await H.active()
// ? shortcuts
await page.keyboard.press('Shift+/'); await sleep(300)
R.help = await page.evaluate(() => !!document.body.innerText.match(/Keyboard mode/))
await page.keyboard.press('n'); await sleep(200)
R.nWhileHelp = (await H.dom()).length
await page.keyboard.press('Escape'); await sleep(200)
R.helpClosed = !(await page.evaluate(() => !!document.body.innerText.match(/Enter keyboard mode/)))
// Ctrl+K palette
await page.keyboard.press('Control+k'); await sleep(300)
R.palette = await H.active()
await page.keyboard.type('add kanban'); await sleep(200); await page.keyboard.press('Enter'); await sleep(600)
R.afterPalette = (await H.dom()).length
return R
