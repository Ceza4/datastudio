return await page.evaluate(() => {
  const out = []
  for (const [x, y] of [[839, 202], [700, 277]]) {
    let el = document.elementFromPoint(x, y); const chain = []
    for (let i = 0; el && i < 6; i++, el = el.parentElement) chain.push(el.tagName + (el.getAttribute('data-ds-block-wrap') ? '[wrap]' : '') + (el.getAttribute('data-block-id') ? '[bid]' : '') + ' style=' + (el.getAttribute('style') || '').slice(0, 140))
    out.push(chain)
  }
  return out
})
