await page.locator('[role=application]').focus()
await page.keyboard.press('Shift+/'); await sleep(300)
const r = await page.evaluate(() => {
  const d = document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]')
  const scrim = d.previousElementSibling
  const cs = getComputedStyle(d), ss = getComputedStyle(scrim)
  return { dialogBg: cs.backgroundColor, dialogBackdrop: cs.backdropFilter, scrimRect: scrim.getBoundingClientRect().toJSON(), scrimBg: ss.backgroundColor, scrimZ: ss.zIndex, dialogZ: cs.zIndex, parentChain: (() => { let e = d.parentElement, out = []; while (e && out.length < 6) { const t = getComputedStyle(e).transform; out.push(e.tagName + ':' + t + ':' + getComputedStyle(e).zIndex); e = e.parentElement } return out })(), elAtCorner: document.elementFromPoint(300, 880)?.outerHTML.slice(0, 80) }
})
await page.keyboard.press('Escape')
return r
