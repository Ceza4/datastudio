const R = {}
const inp = page.locator('input[type=date]').first()
const fmt = d => d.toISOString().slice(0, 10)
const today = new Date(); const y = new Date(Date.now() - 86400000); const tm = new Date(Date.now() + 86400000)
for (const [k, v] of [['today', today], ['yesterday', y], ['tomorrow', tm]]) {
  await inp.fill(fmt(v)); await sleep(300)
  R[k] = await page.evaluate(() => document.querySelector('[data-ds-block-wrap]').innerText.replace(/\n+/g, ' | '))
}
R.tz = await page.evaluate(() => [Intl.DateTimeFormat().resolvedOptions().timeZone, new Date().toString()])
await inp.fill(''); await sleep(300)
R.cleared = await page.evaluate(() => document.querySelector('[data-ds-block-wrap]').innerText.replace(/\n+/g, ' | '))
return R
