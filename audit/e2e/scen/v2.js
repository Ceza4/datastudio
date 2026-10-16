const has = () => page.evaluate(() => [...document.querySelectorAll('div,span')].some(e => e.childElementCount === 0 && /Click to place a sticky note/.test(e.textContent) && e.getBoundingClientRect().width > 0 && getComputedStyle(e).opacity !== '0'))
const R = { now: await has() }
await sleep(3000); R.after3s = await has()
await page.mouse.move(700, 600); await sleep(300); R.afterMove = await has()
return R
