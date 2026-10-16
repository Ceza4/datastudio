//@include fresh.js
const R = {}
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /import file/i }).click()])
await fc.setFiles(['/home/claude/e2e/fixtures/doc.pdf', '/home/claude/e2e/fixtures/pic.png'])
await sleep(3000)
R.blocks = (await H.dom()).map(b => [b.text.split('\n')[0], b.w, b.h])
R.toasts = await H.toasts()
await shot('pdf1')
await sleep(1500)
await page.reload({ waitUntil: 'networkidle' }); await sleep(2500)
R.afterReload = (await H.dom()).map(b => [b.text.split('\n')[0], b.w, b.h])
R.imgs = await page.evaluate(() => [...document.querySelectorAll('[data-ds-block-wrap] img, [data-ds-block-wrap] canvas')].map(i => i.tagName + ':' + Math.round(i.getBoundingClientRect().width) + 'x' + Math.round(i.getBoundingClientRect().height) + (i.naturalWidth !== undefined ? ' nat=' + i.naturalWidth : '')))
await shot('pdf1-reload')
return R
