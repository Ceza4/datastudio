//@include fresh.js
const esc = async () => { for (let i = 0; i < 2; i++) { const inB = await page.evaluate(() => !!document.activeElement?.closest('[data-ds-block-wrap]')); if (!inB) break; await page.keyboard.press('Escape'); await sleep(100) } }
for (const L of ['Notes', 'Document', 'Table Block', 'Kanban Board', 'Task', 'Database', 'Countdown', 'Calendar', 'Flashcards', 'Chat', 'HTML prototype', 'Section']) { await H.add(L); await esc(); await page.keyboard.press('Escape') }
await page.addScriptTag({ path: '/home/claude/e2e/node_modules/axe-core/axe.min.js' })
const seen = new Map()
const scan = async (state) => {
  const out = await page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: ['button-name', 'label', 'link-name', 'aria-allowed-attr', 'aria-required-attr', 'aria-valid-attr-value', 'nested-interactive', 'select-name', 'image-alt', 'duplicate-id-aria'] })
    return r.violations.flatMap(v => v.nodes.map(x => { const el = document.querySelector(x.target[0]); return [v.id, (el?.closest('[data-ds-block-wrap]') ? 'block:' : '') + ((el?.getAttribute('title') || el?.parentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 40)), (el?.outerHTML || '').replace(/style="[^"]*"/g, '').slice(0, 110)] }))
  })
  for (const [id, ctx, html] of out) { const k = id + html; if (!seen.has(k)) seen.set(k, { id, ctx, html, state }) }
}
await scan('canvas')
const d = await H.dom()
for (const b of d) { await page.mouse.click(b.x + 60, b.y + 14); await sleep(250); await scan('selected ' + b.text.split('\n')[0]); await page.keyboard.press('Escape'); await page.keyboard.press('Escape') }
for (const name of [/settings/i, /people/i, /account/i, /builder/i]) { await page.getByRole('button', { name }).first().click(); await sleep(400); await scan('panel ' + name); await page.keyboard.press('Escape'); await sleep(200); await page.mouse.click(1420, 880); await sleep(150) }
await page.getByRole('button', { name: /export/i }).first().click(); await sleep(400); await scan('export'); await page.keyboard.press('Escape'); await sleep(200)
await page.getByRole('button', { name: /^add/i }).first().click(); await sleep(300); await scan('add menu'); await page.keyboard.press('Escape')
return [...seen.values()]
