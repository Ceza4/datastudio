//@include fresh.js
const R = {}
const sbText = () => page.evaluate(() => document.querySelector('aside, [data-ds-island="sidebar"]')?.innerText || document.body.innerText.slice(0, 500))
// Folder: type replaces
await page.getByRole('button', { name: /^folder$/i }).click(); await sleep(300)
await page.keyboard.type('Clients'); await page.keyboard.press('Enter'); await sleep(300)
R.folder = (await sbText()).includes('Clients') && !(await sbText()).includes('New FolderClients')
// Project: rename on create
await page.getByRole('button', { name: /^project$/i }).click(); await sleep(300)
R.projectActive = await H.active()
await page.keyboard.type('Acme'); await page.keyboard.press('Enter'); await sleep(300)
R.projectNamed = (await sbText()).includes('Acme')
// Another project, Escape cancels → keeps unique default
await page.getByRole('button', { name: /^project$/i }).click(); await sleep(300)
await page.keyboard.type('Nope'); await page.keyboard.press('Escape'); await sleep(300)
const t = await sbText()
R.escapeKeepsDefault = !t.includes('Nope') && t.includes('My Project 2')
// Block rename via header double-click, Escape restores
await H.add('Notes'); await page.keyboard.type('body'); await page.keyboard.press('Escape'); await sleep(200)
const b = (await H.dom())[0]
await page.mouse.dblclick(b.x + 40, b.y + 14); await sleep(300)
R.renameActive = await H.active()
await page.keyboard.type('Temp name'); await sleep(100)
R.liveName = (await H.dom())[0].text.split('\n')[0]
await page.keyboard.press('Escape'); await sleep(300)
R.afterEsc = (await H.dom())[0].text.split('\n')[0]
R.selAfterEsc = await H.selected()
await page.mouse.dblclick(b.x + 40, b.y + 14); await sleep(300)
await page.keyboard.type('Kept'); await page.keyboard.press('Enter'); await sleep(300)
R.afterEnter = (await H.dom())[0].text.split('\n')[0]
// Title island rename: double-click name
await page.locator('span[title^="Acme"], span[title^="My Project"]').first().dblclick(); await sleep(300)
await page.keyboard.type('ZZZ'); await page.keyboard.press('Escape'); await sleep(300)
R.titleAfterEsc = await page.evaluate(() => document.querySelector('[data-ds-island=top]').innerText.split('\n')[0])
await shot('rn1')
return R
