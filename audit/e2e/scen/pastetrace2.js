//@include fresh.js
await H.add('Notes'); await page.keyboard.type('copy me'); await page.keyboard.press('Escape'); await sleep(300)
await page.locator('[role=application]').focus(); await page.keyboard.press('Control+c'); await sleep(300)
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(700)
await page.evaluate(() => {
  window.__log = []
  window.addEventListener('keydown', e => { if (e.key === 'v') setTimeout(() => window.__log.push('keydown v prevented=' + e.defaultPrevented + ' target=' + e.target.tagName + (e.target.getAttribute('role') || '')), 0) }, true)
  document.addEventListener('paste', e => window.__log.push('paste@' + e.target.tagName + ' len=' + e.clipboardData.getData('text/plain').length), true)
})
const before = await H.active()
await page.locator('[role=application]').focus()
const after = await H.active()
await page.keyboard.press('Control+v'); await sleep(600)
return { before, after, log: await page.evaluate(() => window.__log), blocks: (await H.dom()).length, toasts: await H.toasts(), top: await page.evaluate(() => document.title) }
