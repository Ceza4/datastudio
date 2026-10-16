//@include fresh.js
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(500)
// a text block so the formatting toolbar is mounted-and-parked
await H.add('Notes'); await sleep(300); await page.keyboard.press('Escape'); await sleep(100)
await page.evaluate(() => document.activeElement?.blur())
const seen = []
for (let i = 0; i < 14; i++) {
  await page.keyboard.press('Tab'); await sleep(40)
  seen.push(await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY'; const r = a.getBoundingClientRect(); return `${a.tagName}${a.getAttribute('role') ? '{' + a.getAttribute('role') + '}' : ''} "${(a.getAttribute('aria-label') || a.innerText || '').trim().slice(0, 24)}" @${Math.round(r.x)},${Math.round(r.y)} op=${getComputedStyle(a.closest('.nb-actions') || a).opacity}` }))
}
// keyboard: focus "Sheet 1" name and press Enter -> switches sheet; F2 renames
const R = { seen }
const s1 = page.locator('[role=button]', { hasText: 'Sheet 1' }).first()
await s1.focus(); await page.keyboard.press('Enter'); await sleep(400)
R.activeAfterEnter = await page.evaluate(() => document.querySelector('[aria-current=page]')?.innerText)
await s1.focus(); await page.keyboard.press('F2'); await sleep(200)
R.f2 = await H.active()
await page.keyboard.type('Renamed'); await page.keyboard.press('Enter'); await sleep(300)
R.renamed = await page.evaluate(() => [...document.querySelectorAll('[data-ds-island=left] [role=button]')].map(e => e.innerText))
// collapse sidebar: nothing inside is tabbable
await page.getByRole('button', { name: 'Hide sidebar' }).click(); await sleep(400)
await page.evaluate(() => document.activeElement?.blur())
const after = []
for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); await sleep(40); after.push(await page.evaluate(() => { const a = document.activeElement; return a.closest('[data-ds-island=left]') ? 'IN-SIDEBAR ' + a.innerText : a.tagName + ' ' + (a.getAttribute('aria-label') || '').slice(0, 20) })) }
R.collapsedTabs = after
return R
