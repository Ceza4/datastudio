//@include fresh.js
const R = {}
await H.add('Notes'); await page.keyboard.type('Hello world'); await sleep(200)
const [b] = await H.dom()
R.afterType = { active: await H.active(), sel: await H.selected() }
// Delete inside text deletes a char, not the block
await page.keyboard.press('Backspace'); await sleep(150)
R.backspaceInText = { n: (await H.dom()).length, text: (await H.dom())[0]?.text }
// Ctrl+A inside text: text only
await page.keyboard.press('Control+a'); await sleep(150)
R.ctrlAInText = { sel: await page.evaluate(() => getSelection().toString()), selBlocks: await H.selected() }
await page.keyboard.press('ArrowRight')
// Escape: leave text, keep block selected, canvas focused
await page.keyboard.press('Escape'); await sleep(200)
R.esc1 = { active: await H.active(), sel: await H.selected() }
// Delete: deletes block
await page.keyboard.press('Delete'); await sleep(500)
R.afterDelete = { n: (await H.dom()).length, toasts: await H.toasts() }
// Ctrl+Z: restore
await page.keyboard.press('Control+z'); await sleep(500)
R.afterUndo = { n: (await H.dom()).length, text: (await H.dom())[0]?.text, toasts: await H.toasts(), active: await H.active() }
// Ctrl+Shift+Z: redo deletes again
await page.keyboard.press('Control+Shift+z'); await sleep(500)
R.afterRedo = { n: (await H.dom()).length }
await page.keyboard.press('Control+z'); await sleep(500)
R.afterUndo2 = { n: (await H.dom()).length, text: (await H.dom())[0]?.text }
await sleep(1200)
R.saved = (await H.savedBlocks())?.map(b => ({ id: b.id, type: b.type, content: (b.content || '').slice(0, 40) }))
return R
