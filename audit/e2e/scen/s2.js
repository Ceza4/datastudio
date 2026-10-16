await page.getByRole('button', { name: /^add$/i }).first().click()
await sleep(400)
await shot('tour2-add')
const items = await page.evaluate(() => [...document.querySelectorAll('[role=menu] [role=menuitem], [role=menuitem]')].map(e => e.textContent.trim().slice(0,40)))
return items
