const labels = ['Notes','Document','Kanban Board','Section','Task','Calendar','Table Block','Database','Countdown','Flashcards','Chat','File','Pipeline','Record','HTML prototype','Agent','Agent chat','Image','PDF']
const out = []
for (const L of labels) {
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await page.mouse.click(1300, 860)  // empty canvas, deselect
  await sleep(150)
  const before = await page.locator('[data-ds-block-wrap]').count()
  await page.getByRole('button', { name: /^add$/i }).first().click()
  await sleep(200)
  await page.keyboard.type(L)
  await sleep(150)
  await page.keyboard.press('Enter')
  await sleep(700)
  const after = await page.locator('[data-ds-block-wrap]').count()
  out.push([L, before, after, await page.evaluate(() => document.activeElement?.tagName + '.' + (document.activeElement?.getAttribute('aria-label')||document.activeElement?.className||'').toString().slice(0,30))])
}
await shot('tour3-all', { fullPage: false })
return out
