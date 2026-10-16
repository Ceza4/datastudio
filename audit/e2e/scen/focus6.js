//@include fresh.js
const R = {}
for (const t of ['Database', 'Table', 'Notes', 'Kanban', 'Calendar', 'Countdown', 'Flashcards', 'HTML']) {
  await H.add(t); await sleep(500)
  R[t] = await H.active()
  // a canvas shortcut must still work: '?' opens the shortcuts dialog only when the canvas has the keyboard
  await page.keyboard.press('Escape'); await sleep(120); await page.keyboard.press('Escape'); await sleep(120)
}
// Mouse-driven add: open Add with a click, pick with a click
await page.getByRole('button', { name: /^add$/i }).first().click(); await sleep(200)
await page.getByRole('menuitem', { name: /database/i }).first().click().catch(async () => { await page.getByText('Database', { exact: true }).last().click() })
await sleep(500)
R.mouseAdd = await H.active()
return R
