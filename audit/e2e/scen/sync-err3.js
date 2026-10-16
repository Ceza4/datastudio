//@include fresh.js
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /import file/i }).click()])
await fc.setFiles(['/home/claude/e2e/fixtures/pic.png'])
await sleep(6000)
return await page.evaluate(() => [...document.querySelectorAll('div[title]')].filter(d => d.style.position === 'fixed').map(d => d.title + ' :: ' + d.innerText))
