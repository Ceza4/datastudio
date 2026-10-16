//@include fresh.js
const out = {}
for (const w of [1280, 1366, 1440, 1568, 1700, 1920]) {
  await page.setViewportSize({ width: w, height: 800 }); await sleep(300)
  out[w] = await page.evaluate(() => {
    const isl = [...document.querySelectorAll('[data-ds-island]')].map(e => { const r = e.getBoundingClientRect(); return e.getAttribute('data-ds-island') + ':' + Math.round(r.x) + '-' + Math.round(r.right) })
    const name = [...document.querySelectorAll('span,div,input')].find(e => /^M(y Project)?/.test(e.textContent || e.value || '') && (e.textContent || e.value || '').length < 14 && e.getBoundingClientRect().y < 60 && e.getBoundingClientRect().x > 270)
    const r = name?.getBoundingClientRect()
    return { isl, name: name && { tag: name.tagName, w: Math.round(r.width), sw: name.scrollWidth, cs: getComputedStyle(name).maxWidth } }
  })
}
return out
