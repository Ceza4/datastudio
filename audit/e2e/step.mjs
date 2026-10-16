// Usage: node step.mjs <file.js>  — runs the file's body with {page, context, shot, sleep} in scope.
import { attach } from './cdp.mjs'
import { sessionCookie, SHOTS } from './lib.mjs'
import { readFileSync } from 'node:fs'
const { browser, context, page } = await attach()
if (!globalThis.__init) { await context.addCookies([sessionCookie()]) }
await page.setViewportSize({ width: 1440, height: 900 })
const errs = []
page.on('pageerror', e => errs.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = async (n, opts = {}) => { await page.screenshot({ path: `${SHOTS}/${n}.png`, ...opts }); console.log('shot', n) }
const src = readFileSync(process.argv[2], 'utf8').replace(/^\/\/@include (\S+)$/mg, (_, f) => readFileSync('/home/claude/e2e/' + f, 'utf8'))
const helpers = readFileSync('/home/claude/e2e/h.js', 'utf8') + '\n' + readFileSync('/home/claude/e2e/hist.js', 'utf8')
const fn = new Function('page', 'context', 'shot', 'sleep', `return (async () => { ${helpers}\n${src} })()`)
try { const r = await fn(page, context, shot, sleep); if (r !== undefined) console.log(JSON.stringify(r, null, 1).slice(0, 6000)) }
catch (e) { console.log('STEP ERROR', e.message.split('\n').slice(0, 6).join('\n')) }
if (errs.length) console.log('PAGE ERRORS/WARNINGS:\n' + errs.join('\n'))
process.exit(0)
