return await page.evaluate(() => {
  const w = document.querySelector('[data-ds-block-wrap]')
  const body = w.firstElementChild
  const e = body.querySelector('[data-ds-resize="e"]')
  const r = e.getBoundingClientRect(), br = body.getBoundingClientRect()
  return { style: body.getAttribute('style'), eRect: r.toJSON(), bodyRect: br.toJSON(), hits: [835, 836, 837, 838, 839, 840, 841, 843].map(x => { const h = document.elementFromPoint(x, r.y + r.height / 2); return x + ':' + (h === e ? 'E' : h?.dataset?.dsResize || h?.tagName) }) }
})
