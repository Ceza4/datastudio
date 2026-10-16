const R = {}
const lanes = () => page.evaluate(() => [...document.querySelectorAll('[data-ds-block-wrap] input')].map(i => i.value))
const W = () => page.evaluate(() => document.querySelector('[data-ds-block-wrap]').innerText.replace(/\n+/g, ' | ').slice(0, 300))
await page.getByRole('button', { name: '+ card' }).first().click(); await sleep(300)
R.afterAdd = { active: await H.active(), text: await W() }
await page.keyboard.type('First task'); await page.keyboard.press('Enter'); await sleep(300)
R.afterEnter = { active: await H.active(), text: await W() }
await page.keyboard.type('Second task'); await page.keyboard.press('Enter'); await sleep(300)
R.afterSecond = { active: await H.active(), text: await W() }
await page.keyboard.press('Escape'); await sleep(200)
R.afterEsc = { active: await H.active(), text: await W(), n: (await H.dom()).length }
// Backspace/Delete now: should not delete the block if focus is in kanban? (focus where?)
await shot('kb2')
return R
