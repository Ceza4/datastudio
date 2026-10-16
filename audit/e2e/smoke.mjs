import { launch, openApp, SHOTS, dump } from './lib.mjs'
const { browser, page, errors } = await launch()
await openApp(page)
console.log('url', page.url())
await page.screenshot({ path: SHOTS + '/smoke.png' })
console.log('errors', errors)
const d = await dump()
console.log('tables', Object.keys(d.tables), d.log.slice(-30).map(l => l.m + ' ' + l.p).join('\n'))
await browser.close()
