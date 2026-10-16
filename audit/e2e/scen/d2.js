const r = await page.evaluate(() => {
  const body = document.querySelector('[aria-label="Document body"]')
  const wrap = body.closest('[data-ds-block-wrap]')
  const wr = wrap.getBoundingClientRect()
  const out = []
  wrap.querySelectorAll('button, select, input').forEach(b => {
    const q = b.getBoundingClientRect()
    if (q.width && q.right > wr.right - 2 && q.top < wr.top + 130) out.push({ t: (b.getAttribute('aria-label') || b.title || b.innerText).slice(0, 30), l: Math.round(q.left), r: Math.round(q.right) })
  })
  // find the ribbon row's scroll metrics
  const rows = [...wrap.querySelectorAll('div')].filter(d => d.scrollWidth > d.clientWidth + 2 && d.getBoundingClientRect().top < wr.top + 130).map(d => ({ sw: d.scrollWidth, cw: d.clientWidth, ox: getComputedStyle(d).overflowX, top: Math.round(d.getBoundingClientRect().top) }))
  return { wrapRight: Math.round(wr.right), clipped: out, overflowing: rows.slice(0, 6) }
})
return r
