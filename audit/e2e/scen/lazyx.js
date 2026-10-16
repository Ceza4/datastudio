const reqs = []
page.on('request', r => { if (/f9a4eca87e75a791/.test(r.url())) reqs.push(r.url().split('/').pop()) })
//@include fresh.js
await sleep(1500)
const R = { onLoad: reqs.length }
await page.locator('input[type=file]').first().setInputFiles(['/home/claude/e2e/fixtures/basic.csv', '/home/claude/e2e/fixtures/multi.xlsx', '/home/claude/e2e/fixtures/euro.csv']); await sleep(2500)
R.afterImport = reqs.length
R.sidebar = await page.evaluate(() => document.querySelector('[data-ds-island=left]').innerText.split('\n').filter(Boolean).slice(4, 14))
R.errors = await page.evaluate(() => document.body.innerText.match(/could not[^\n]*/i)?.[0] || null)
return R
