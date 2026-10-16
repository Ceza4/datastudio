//@include fresh.js
await H.add('Table Block'); await sleep(300)
const g = await page.evaluate(() => document.querySelector('[data-ds-grid-scroll]').getBoundingClientRect().toJSON())
await page.evaluate(() => {
  window.__log = []
  window.__grid = document.querySelector('[data-ds-grid-scroll]')
  const tag = el => el ? (el.tagName + (el.hasAttribute?.('data-ds-cell-editor') ? '[ed]' : el.hasAttribute?.('data-ds-grid-scroll') ? '[grid]' : '')) : 'null'
  for (const t of ['input','select','selectionchange']) document.addEventListener(t, e => { const ed=document.querySelector('[data-ds-cell-editor]'); window.__log.push(t+':val='+(ed&&ed.value)+':sel='+(ed&&ed.selectionStart)+'-'+(ed&&ed.selectionEnd)) }, true)
  for (const t of ['keydown','focusin','focusout']) document.addEventListener(t, e => window.__log.push(t + ':' + (e.key||'') + ':' + tag(e.target) + ':ed=' + (document.querySelector('[data-ds-cell-editor]')?.value) + ':' + (document.querySelector('[data-ds-cell-editor]')?.selectionStart)), true)
})
await page.mouse.click(g.x + 48 + 60, g.y + 26 + 12); await page.keyboard.type('a'); await page.keyboard.press('Tab'); await page.keyboard.type('b,c'); await page.keyboard.press('Enter'); await sleep(200)
return await page.evaluate(() => window.__log)
