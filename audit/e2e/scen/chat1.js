//@include fresh.js
await H.add('Chat'); await sleep(800)
const R = {}
R.active = await H.active()
R.text = (await page.locator('[data-ds-block-wrap]').first().innerText()).replace(/\n+/g, ' | ').slice(0, 300)
const comp = page.locator('[data-chat-composer]').first()
R.hasComposer = await comp.count(); R.composerBox = await comp.evaluate(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), cs.visibility, cs.display, e.disabled] })
if (R.hasComposer) {
  await comp.focus(); await page.keyboard.type('Hello team'); await page.keyboard.press('Enter'); await sleep(1200)
  R.after = (await page.locator('[data-ds-block-wrap]').first().innerText()).replace(/\n+/g, ' | ').slice(0, 300)
  R.toasts = await H.toasts()
  await page.keyboard.press('Delete'); await sleep(200); R.blocksAfterDelKey = (await H.dom()).length
}
await shot('chat1')
return R
