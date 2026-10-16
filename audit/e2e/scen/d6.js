//@include fresh.js
await H.add('Document'); await sleep(600)
await page.keyboard.press('Escape'); await sleep(150)
const info = async () => page.evaluate(() => { const w = document.querySelector('.ds-ribbon-scroll'); const b = document.querySelector('.ds-ribbon-band'); return { cw: w.clientWidth, natural: [...b.children].reduce((s, g) => s + g.offsetWidth, 0), groups: [...b.children].map(g => g.lastElementChild?.innerText?.split('\n')[0] + ':' + g.offsetWidth).join(' '), ov: w.dataset.overflow } })
const out = [{ w: (await H.dom())[0].w, ...(await info()) }]
await shot('d6-880')
for (const dx of [-160, 900]) {
  const b = (await H.dom())[0]; const x = b.x + b.w - 1, y = b.y + b.h / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 8 }); await page.mouse.up(); await sleep(500)
  out.push({ w: (await H.dom())[0].w, ...(await info()) })
}
return out
