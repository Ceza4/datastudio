//@include fresh.js
await H.add('Database'); await sleep(800)
await shot('ghost0')
return { dom: await H.dom(), url: page.url(), top: await page.evaluate(() => document.querySelector('[data-ds-island=top]')?.innerText) }
