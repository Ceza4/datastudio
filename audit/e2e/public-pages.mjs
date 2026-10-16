import { createRequire } from 'node:module'
const require = createRequire('/opt/npm-tools/node_modules/')
const { chromium } = require('playwright')
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  for (const path of ['/', '/login', '/signup', '/forgot', '/reset', '/pricing', '/nope-404']) {
    const r = await p.goto('http://localhost:3100' + path, { waitUntil: 'networkidle' })
    await p.waitForTimeout(400)
    const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, title: document.title }))
    await p.screenshot({ path: `/home/claude/e2e/shots/pub-${w}${path.replace(/\W/g, '_') || '_root'}.png`, fullPage: true })
    console.log(w, path, r.status(), JSON.stringify(ov), errs.splice(0).filter(e => !/websocket/.test(e)).join(' | '))
  }
  await ctx.close()
}
await b.close()
