//@include fresh.js
const R = {}
for (const [name, sel] of [['Account', 'button[aria-label=Account]'], ['Settings', 'button[aria-label=Settings]'], ['People', '[data-menu-toggle=people]']]) {
  await page.locator(sel).first().click(); await sleep(400)
  await page.keyboard.press('Tab'); await sleep(100)
  const inside = await H.active()
  await page.keyboard.press('Escape'); await sleep(300)
  R[name] = { inside, afterEsc: await H.active() }
}
// outside click on People must NOT steal focus to the People button
await page.locator('[data-menu-toggle=people]').click(); await sleep(400)
await page.mouse.click(800, 600); await sleep(300)
R.peopleOutsideClick = await H.active()
return R
