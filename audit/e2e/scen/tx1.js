//@include fresh.js
const R = {}
await H.add('Notes'); await sleep(200)
await page.keyboard.type('/'); await sleep(300)
R.slashItems = await page.evaluate(() => [...document.querySelectorAll('[role=listbox] [role=option], [role=option]')].map(o => o.innerText.split('\n')[0]).slice(0, 30))
await shot('tx-slash')
await page.keyboard.type('h1'); await sleep(200); await page.keyboard.press('Enter'); await sleep(200)
await page.keyboard.type('Big title'); await page.keyboard.press('Enter')
await page.keyboard.type('- item one'); await page.keyboard.press('Enter'); await page.keyboard.type('item two'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
await page.keyboard.type('[] todo'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
await page.keyboard.type('Plain end')
await sleep(500)
R.html = await page.evaluate(() => document.querySelector('[data-ds-textblock]').innerHTML.slice(0, 800))
await shot('tx1')
return R
