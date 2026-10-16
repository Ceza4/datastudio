//@include fresh.js
await page.getByRole('button', { name: /^add$/i }).first().click(); await sleep(300)
const t = await page.evaluate(() => { const m = document.querySelector('[role=menu], [role=listbox], [role=dialog]'); return m ? m.innerText : document.body.innerText.slice(0, 1500) })
await page.keyboard.press('Escape')
return t.split('\n').filter(Boolean)
