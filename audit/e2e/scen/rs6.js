//@include fresh.js
for (const L of ['Notes','Document','Kanban Board','Section','Task','Calendar','Table Block','Database','Countdown','Flashcards','Chat','Pipeline','HTML prototype','Agent']) {
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await H.add(L); await sleep(200)
}
await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
return await page.evaluate(() => [...document.querySelectorAll('[data-ds-block-wrap]')].map(w => {
  const wr = w.getBoundingClientRect()
  const kids = [...w.children].map(c => { const r = c.getBoundingClientRect(); return `${c.tagName}:${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x - wr.x)},${Math.round(r.y - wr.y)} pos=${getComputedStyle(c).position} ov=${getComputedStyle(c).overflow}` })
  const handles = w.querySelectorAll('[data-ds-resize]').length
  const body = w.querySelector('[data-ds-resize="e"]')?.parentElement
  return { wrap: `${Math.round(wr.width)}x${Math.round(wr.height)}`, kids, handles, handleParentOverflow: body ? getComputedStyle(body).overflow : null, handleParentIsWrapChild: body?.parentElement === w }
}))
