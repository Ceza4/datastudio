await page.getByRole('button', { name: /^dark$/i }).click(); await sleep(500)
await page.keyboard.press('Escape'); await sleep(200)
await page.mouse.click(1300, 800); await sleep(200)
await H.add('Document'); await page.keyboard.type('Dark doc'); await sleep(200)
await page.keyboard.press('Escape'); await sleep(200)
await H.add('Kanban Board'); await page.keyboard.press('Escape'); await sleep(300)
await page.locator('span[title="Zoom to 100%"]').click().catch(() => {})
for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await sleep(80) }
await page.mouse.move(900, 500)
for (let i = 0; i < 3; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 200); await page.keyboard.up('Control'); await sleep(100) }
await sleep(400)
await shot('dark1')
