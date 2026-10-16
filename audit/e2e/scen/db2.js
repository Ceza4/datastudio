//@include fresh.js
const R = {}
const wrap = () => page.locator('[data-ds-block-wrap]').first()
const crashed = async () => (await page.getByText(/couldn.t be displayed/).count()) > 0
await H.add('Database'); await sleep(500); await page.keyboard.press('Escape')
await wrap().locator('button', { hasText: 'Filter' }).click(); await sleep(300)
R.filterMenu = { crashed: await crashed(), text: (await page.getByRole('dialog', { name: 'Filter' }).innerText().catch(() => '')).slice(0, 80) }
await page.keyboard.press('Escape'); await sleep(150)
await wrap().locator('[data-ds-db-col]').first().click(); await sleep(300)
R.titleMenu = { crashed: await crashed() }
await page.keyboard.press('Escape'); await sleep(150)
await wrap().locator('[data-ds-db-addview]').click(); await sleep(200)
await page.getByText('Board', { exact: true }).last().click(); await sleep(300)
await wrap().locator('[data-ds-db-viewchip][aria-pressed=true]').click(); await sleep(300)
R.boardViewMenu = { crashed: await crashed(), text: (await page.locator('[role=dialog]').last().innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 160) }
await page.keyboard.press('Escape'); await sleep(150)
await shot('db2')
return R
