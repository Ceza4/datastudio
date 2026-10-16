//@include fresh.js
const R = {}
await page.locator('input[type=file]').first().setInputFiles(['/home/claude/e2e/fixtures/basic.csv', '/home/claude/e2e/fixtures/multi.xlsx']); await sleep(1800)
const side = () => page.evaluate(() => document.querySelector('[data-ds-island=left]').innerText.split('\n').filter(Boolean).slice(0, 30))
R.before = await side()
const name = page.locator('[data-ds-island=left] [role=button]', { hasText: 'basic.csv' }).first()
await name.focus(); R.focused = await H.active()
const exp0 = await name.getAttribute('aria-expanded')
await page.keyboard.press('Enter'); await sleep(300)
R.expandedToggle = [exp0, await name.getAttribute('aria-expanded')]
// multi-sheet workbook: sheet rows
const multi = page.locator('[data-ds-island=left] [role=button]', { hasText: 'multi.xlsx' }).first()
if (await multi.getAttribute('aria-expanded') === 'false') { await multi.focus(); await page.keyboard.press('Enter'); await sleep(300) }
const sheetRow = page.locator('.sheet-row').first()
R.sheetRowRole = await sheetRow.getAttribute('role')
const s0 = await sheetRow.getAttribute('aria-expanded'); await sheetRow.focus(); await page.keyboard.press(' '); await sleep(300)
R.sheetToggle = [s0, await sheetRow.getAttribute('aria-expanded')]
// zoom label keyboard
await page.mouse.move(800, 500); await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control'); await sleep(300)
const z = page.locator('.ds-title-zoom'); const zt0 = await z.innerText()
await z.focus(); await page.keyboard.press('Enter'); await sleep(400)
R.zoom = [zt0, await z.innerText()]
R.after = await side()
return R
