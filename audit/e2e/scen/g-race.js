const g = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').getBoundingClientRect().toJSON())
await page.mouse.click(g.x + 48 + 60, g.y + 26 + 24 * 3 + 12); await sleep(150)
await page.keyboard.press('b')
const s1 = await page.evaluate(() => { const i = document.querySelector('[data-ds-cell-editor]'); return i ? [i.value, i.selectionStart, i.selectionEnd, document.activeElement === i] : 'no editor' })
await page.keyboard.press(',')
await page.keyboard.press('c')
const s2 = await page.evaluate(() => { const i = document.querySelector('[data-ds-cell-editor]'); return i ? [i.value, i.selectionStart, i.selectionEnd, document.activeElement === i] : 'no editor' })
await page.keyboard.press('Escape')
// slow typing
await page.keyboard.type('xyz', { delay: 120 })
const s3 = await page.evaluate(() => { const i = document.querySelector('[data-ds-cell-editor]'); return i ? i.value : 'no editor' })
await page.keyboard.press('Escape')
return { s1, s2, s3 }
