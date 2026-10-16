//@include fresh.js
await page.locator('span[title^="My Project"]').first().dblclick().catch(()=>{}); await sleep(200); await page.keyboard.press('Control+a'); await page.keyboard.type('Ataskaita už rugsėjį'); await page.keyboard.press('Enter'); await sleep(300)
await H.add('Table Block'); await sleep(300)
const g = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').getBoundingClientRect().toJSON())
await page.mouse.click(g.x + 48 + 60, g.y + 26 + 12); await page.keyboard.type('a'); await page.keyboard.press('Tab'); await page.keyboard.type('b,c'); await page.keyboard.press('Enter'); await sleep(200)
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await page.getByRole('button', { name: /export/i }).first().click(); await sleep(400)
const fs = await import('node:fs')
const res = {}
for (const fmt of ['CSV', 'Markdown', 'JSON']) {
  const dlP = page.waitForEvent('download', { timeout: 8000 })
  await page.locator('button').filter({ hasText: new RegExp('^' + fmt) }).first().click()
  const dl = await dlP.catch(() => null)
  res[fmt] = dl ? dl.suggestedFilename() + ' :: ' + fs.readFileSync(await dl.path(), 'utf8').slice(0, 200) : 'none'
  await sleep(300)
  if (!(await page.locator('button').filter({ hasText: /^CSV/ }).count())) { await page.getByRole('button', { name: /export/i }).first().click(); await sleep(400) }
}
return res
