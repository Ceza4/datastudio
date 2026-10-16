//@include fresh.js
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /import file/i }).click()])
await fc.setFiles(['/home/claude/e2e/fixtures/doc.pdf', '/home/claude/e2e/fixtures/pic.png', '/home/claude/e2e/fixtures/basic.csv'])
await sleep(3000)
await page.getByRole('button', { name: /Whole table/ }).first().click(); await sleep(800)
const d = await H.dom()
const overlaps = []
for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) { const a = d[i], b = d[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push([i, j]) }
await shot('imp-place')
return { rects: d.map(b => [b.text.split('\n')[0], b.x, b.y, b.w, b.h]), overlaps, underSidebar: d.filter(b => b.x < 280).length }
