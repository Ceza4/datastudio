await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
const res = {}
for (const L of ['File', 'Record', 'Agent chat']) {
  await page.getByRole('button', { name: /^add$/i }).first().click()
  await sleep(200)
  await page.keyboard.type(L)
  await sleep(200)
  await shot('add-search-' + L.replace(' ', '_'))
  res[L] = await page.evaluate(() => [...document.querySelectorAll('input[aria-label="Search blocks"]')].map(i => i.closest('div')?.parentElement?.innerText.slice(0, 300)))
  await page.keyboard.press('Escape'); await sleep(150)
}
return res
