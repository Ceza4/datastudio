return await page.evaluate(() => {
  const w = document.querySelector('[data-ds-block-wrap]')
  const desc = (el, d = 0) => d > 3 ? [] : [...el.children].flatMap(c => [' '.repeat(d * 2) + c.tagName + (c.dataset.dsResize ? '[resize=' + c.dataset.dsResize + ']' : '') + ' ' + (c.getAttribute('style') || '').slice(0, 110), ...desc(c, d + 1)])
  return desc(w).slice(0, 40)
})
