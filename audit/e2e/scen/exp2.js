const out = {}
for (const fmt of ['Word', 'Markdown', 'Excel', 'CSV', 'PowerPoint', 'Image', 'Embed / HTML', 'JSON', 'PDF']) {
  const btn = page.locator('button').filter({ hasText: new RegExp('^' + fmt.replace('/', '\\/')) }).first()
  if (!(await btn.count())) { await page.getByRole('button', { name: /export/i }).first().click(); await sleep(400) }
  let dl = null, popup = null
  const dlP = page.waitForEvent('download', { timeout: 8000 }).then(d => dl = d).catch(() => {})
  const popP = page.context().waitForEvent('page', { timeout: 8000 }).then(p => popup = p).catch(() => {})
  await page.locator('button').filter({ hasText: new RegExp('^' + fmt.replace('/', '\\/')) }).first().click().catch(e => out[fmt] = 'click fail')
  await sleep(1500)
  // some formats may need a second "Export" button
  const go = page.getByRole('button', { name: /^(Export|Download|Save)\b/ })
  if (!dl && await go.count()) { await go.last().click().catch(() => {}); }
  await Promise.race([dlP, popP, sleep(8000)])
  if (dl) { const p = await dl.path().catch(() => null); const fs = await import('node:fs'); out[fmt] = dl.suggestedFilename() + ' ' + (p ? fs.statSync(p).size : '?') + 'B' }
  else if (popup) out[fmt] = 'popup ' + popup.url().slice(0, 40)
  else out[fmt] = out[fmt] || 'no download; toasts=' + (await H.toasts()).join('|').slice(-80)
  await page.keyboard.press('Escape'); await sleep(300)
}
return out
