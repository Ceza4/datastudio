//@include fresh.js
await H.add('Notes'); await page.keyboard.type('copy me'); await page.keyboard.press('Escape'); await sleep(300)
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+c'); await sleep(300)
await page.evaluate(() => {
  window.__log = []
  window.addEventListener('keydown', e => { if (e.key === 'v') setTimeout(() => window.__log.push('keydown v prevented=' + e.defaultPrevented + ' target=' + e.target.tagName), 0) }, true)
  document.addEventListener('paste', e => window.__log.push('paste@' + e.target.tagName + ' prevented=' + e.defaultPrevented + ' len=' + e.clipboardData.getData('text/plain').length), true)
})
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+v'); await sleep(500)
return { log: await page.evaluate(() => window.__log), blocks: (await H.dom()).length, toasts: await H.toasts() }
