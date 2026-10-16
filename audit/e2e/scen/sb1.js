//@include fresh.js
const R = {}
const sb = () => page.evaluate(() => { const s = document.querySelector('[data-kbd-zone][data-ds-island="sidebar"], aside') ; return s ? s.innerText.slice(0, 400) : document.body.innerText.slice(0, 300) })
R.sidebar0 = await sb()
await page.getByRole('button', { name: /^folder$/i }).click(); await sleep(400)
R.afterFolder = { active: await H.active(), sb: await sb() }
await page.keyboard.type('Clients'); await page.keyboard.press('Enter'); await sleep(300)
R.afterFolderName = await sb()
await page.getByRole('button', { name: /^project$/i }).click(); await sleep(400)
R.afterProject = { active: await H.active(), sb: await sb() }
await page.keyboard.type('Second'); await page.keyboard.press('Enter'); await sleep(300)
R.afterProjectName = await sb()
await shot('sb1')
return R
