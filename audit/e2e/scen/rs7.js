//@include fresh.js
const R = {}
for (const L of ['Notes', 'Table Block', 'Database', 'Kanban Board', 'Chat']) {
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(100)
  await H.add(L); await sleep(300)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(150)
  const all = await H.dom(); const b = all[all.length - 1]
  await page.mouse.click(b.x + 60, b.y + 14); await sleep(200)   // select via header
  // press exactly on the visible right border line, drag +100
  const x = b.x + b.w - 1, y = b.y + b.h / 2
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.dataset?.dsResize || 'none', [x, y])
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y, { steps: 8 }); await page.mouse.up(); await sleep(400)
  const b2 = (await H.dom()).find(q => q.id === b.id)
  // and the outer half of the band (2px outside)
  const x2 = b2.x + b2.w + 2
  const hit2 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.dataset?.dsResize || 'none', [x2, y])
  R[L] = { hitOnBorder: hit, hitOutside: hit2, widened: b2.w - b.w }
  await page.keyboard.press('Control+z'); await sleep(200)
}
return R
