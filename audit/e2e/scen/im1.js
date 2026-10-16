//@include fresh.js
const R = {}
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /import file/i }).click()])
await fc.setFiles(['/home/claude/e2e/fixtures/basic.csv', '/home/claude/e2e/fixtures/euro.csv', '/home/claude/e2e/fixtures/multi.xlsx'])
await sleep(2500)
R.sidebar = await page.evaluate(() => document.body.innerText.split('Builder')[0].slice(0, 600))
R.toasts = await H.toasts()
R.blocks = (await H.dom()).length
await shot('im1')
return R
