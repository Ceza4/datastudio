//@include fresh.js
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(500)
await page.locator('body').click({ position: { x: 5, y: 450 } }).catch(() => {})
await page.evaluate(() => document.activeElement?.blur())
const seen = []
for (let i = 0; i < 40; i++) {
  await page.keyboard.press('Tab'); await sleep(40)
  seen.push(await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY'; const r = a.getBoundingClientRect(); return `${a.tagName}${a.getAttribute('role') ? '{' + a.getAttribute('role') + '}' : ''} "${(a.getAttribute('aria-label') || a.title || a.innerText || a.value || '').trim().slice(0, 28)}" @${Math.round(r.x)},${Math.round(r.y)}` }))
}
return seen
