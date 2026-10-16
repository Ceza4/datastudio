//@include fresh.js
const types = ['Notes', 'Document', 'Kanban Board', 'Section', 'Task', 'Calendar', 'Countdown', 'Flashcards', 'Table Block', 'Database', 'Pipeline', 'HTML prototype', 'Chat', 'Agent']
const out = {}
for (const t of types) {
  await H.add(t); await sleep(700)
  await page.keyboard.press('Escape'); await sleep(80); await page.keyboard.press('Escape'); await sleep(80)
  const wraps = await H.dom()
  const last = wraps[wraps.length - 1]
  out[t] = await page.evaluate(id => {
    const root = document.querySelector(`[data-ds-block-wrap="${id}"]`)
    const res = []
    for (const e of root.querySelectorAll('*')) {
      if (e.children.length) continue
      const txt = (e.textContent || '').trim()
      if (txt.length < 3) continue
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const sw = e.scrollWidth
      if (sw > r.width * 1.6 && r.width < 80) res.push(`${txt.slice(0, 30)} ${Math.round(r.width)}/${sw}`)
    }
    return res.slice(0, 8)
  }, last.id)
  // remove it to keep the sheet clean
  await page.locator(`[data-ds-block-wrap="${last.id}"]`).click({ position: { x: 30, y: 8 } }).catch(() => {})
  await page.keyboard.press('Delete'); await sleep(400)
  await page.keyboard.press('Escape')
}
return out
