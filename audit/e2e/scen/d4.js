//@include fresh.js
await H.add('Document'); await sleep(500)
await page.keyboard.press('Escape'); await sleep(150)
const out = []
const wrapInfo = async () => page.evaluate(() => { const w = document.querySelector('.ds-ribbon-scroll'); const b = document.querySelector('.ds-ribbon-band'); return { cw: w.clientWidth, sw: b.scrollWidth } })
// zoom out view? the doc is 880 wide; shrink via the w handle and grow via e handle
for (const dx of [-100, -100, -100, 300, 300, 300]) {
  const b = (await H.dom())[0]
  const x = b.x + b.w - 1, y = b.y + b.h / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 6 }); await page.mouse.up(); await sleep(400)
  out.push({ blockW: (await H.dom())[0].w, ...(await wrapInfo()) })
}
return out
