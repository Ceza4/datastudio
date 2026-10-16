await page.goto('http://localhost:3100/pdf-worker-version.json', { waitUntil: 'domcontentloaded' })
await page.setContent('<html><body><div id=c tabindex=0 style="width:200px;height:100px;background:#eee">canvas</div><div id=e contenteditable style="width:200px;height:40px;border:1px solid">edit</div></body></html>')
await page.evaluate(() => {
  window.__log = []
  document.addEventListener('paste', e => window.__log.push('paste@' + (e.target.id || e.target.tagName) + ':' + e.clipboardData.getData('text/plain')))
})
await page.evaluate(() => navigator.clipboard.writeText('HELLO').catch(e => window.__log.push('write ' + e.name)))
await page.focus('#c'); await page.keyboard.press('Control+v'); await sleep(200)
await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('Control+v'); await sleep(200)
await page.focus('#e'); await page.keyboard.press('Control+v'); await sleep(200)
return await page.evaluate(() => window.__log)
