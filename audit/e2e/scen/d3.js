const out = []
const wrap = async () => page.evaluate(() => { const w = document.querySelector('.ds-ribbon-scroll'); const b = document.querySelector('.ds-ribbon-band'); return { cw: w.clientWidth, sw: b.scrollWidth, ov: w.dataset.overflow } })
const grip = await page.evaluate(() => { const g = document.querySelector('[data-ds-resize="grip"], [data-ds-resize="se"], [data-ds-resize="e"]'); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, which: g.dataset.dsResize } })
out.push({ grip, start: await wrap() })
// zoom out the canvas would be locked; resize instead by dragging the grip left/right in steps
for (const dx of [-120, -120, 400, 300]) {
  const g = await page.evaluate(() => { const g = document.querySelector('[data-ds-resize="grip"], [data-ds-resize="se"], [data-ds-resize="e"]'); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + dx, g.y, { steps: 8 }); await page.mouse.up(); await sleep(400)
  out.push({ dx, ...(await wrap()) })
}
return out
