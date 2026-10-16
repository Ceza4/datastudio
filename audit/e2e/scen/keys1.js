//@include fresh.js
await page.locator('[role=application]').focus(); await page.keyboard.press('?'); await sleep(400)
const t = await page.locator('[role=dialog]').last().innerText().catch(() => 'none')
await page.keyboard.press('Escape')
return t.split('\n').filter(Boolean)
