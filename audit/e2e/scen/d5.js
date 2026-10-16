const measure = () => page.evaluate(() => { const b = document.querySelector('.ds-ribbon-band'); return [...b.children].map(g => { const lab = g.lastElementChild?.innerText?.split('\n')[0]; return lab + ':' + Math.round(g.getBoundingClientRect().width) }) })
const out = { wide: await measure() }
// shrink to 720 for compact 2
const b = (await H.dom())[0]
const x = b.x + b.w - 1, y = b.y + b.h / 2
await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 700, y, { steps: 6 }); await page.mouse.up(); await sleep(400)
out.narrow = await measure()
out.narrowW = (await H.dom())[0].w
return out
