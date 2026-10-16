//@include fresh.js
const esc = async () => { for (let i = 0; i < 2; i++) { const inB = await page.evaluate(() => !!document.activeElement?.closest('[data-ds-block-wrap]')); if (!inB) break; await page.keyboard.press('Escape'); await sleep(100) } }
for (const L of ['Notes', 'Table Block', 'Kanban Board', 'Task', 'Database', 'Countdown', 'Calendar']) { await H.add(L); await esc(); await page.keyboard.press('Escape') }
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(300)
await page.getByText('Sheet 1', { exact: true }).first().click(); await sleep(300)
// select a block so rails show
const d = await H.dom(); await page.mouse.click(d[0].x + 60, d[0].y + 14); await sleep(300)
await page.addScriptTag({ path: '/home/claude/e2e/node_modules/axe-core/axe.min.js' })
const res = await page.evaluate(async () => {
  const r = await axe.run(document, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: true } } })
  return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, eg: v.nodes.slice(0, 6).map(x => x.html.slice(0, 140)) }))
})
return res
