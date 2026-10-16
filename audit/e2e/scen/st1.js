//@include fresh.js
await H.add('Notes'); await page.keyboard.type('Theme test'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await H.add('Table Block'); await page.keyboard.press('Escape')
await page.getByRole('button', { name: /settings/i }).first().click(); await sleep(500)
await shot('st1')
return await page.evaluate(() => [...document.querySelectorAll('button,[role=switch],[role=radio],input,select')].filter(b => b.getBoundingClientRect().width && b.closest('[role=dialog],[data-ds-settings],aside,section')).map(b => (b.getAttribute('aria-label') || b.title || b.innerText || b.type).slice(0, 30)).slice(0, 60))
