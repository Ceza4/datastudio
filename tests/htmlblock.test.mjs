/* HTML prototype block: bridge placement, message checks, viewport fit, CSP, title. */
import {
  withBridge, bridgeScript, readLog, fitViewport, titleOf, previewCsp, byteLength,
  MAX_HTML_BYTES, MAX_LOG_CHARS, SANDBOX, PREVIEW_PATH,
} from '../lib/htmlblock.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

console.log('\n bridge placement')
const B = bridgeScript('tok')
ok(withBridge('<!doctype html><html><head><title>x</title></head><body></body></html>', 'tok').startsWith('<!doctype html><html><head>' + B), 'right after <head>')
ok(withBridge('<html lang="lt"><body>hi</body></html>', 'tok').startsWith('<html lang="lt">' + B), 'after <html> when there is no head')
ok(withBridge('<!DOCTYPE html>\n<p>hi</p>', 'tok').startsWith('<!DOCTYPE html>' + B), 'never before a doctype (quirks mode)')
ok(withBridge('<p>hi</p>', 'tok') === B + '<p>hi</p>', 'a fragment gets it in front')
ok(withBridge('<header>x</header>', 'tok').startsWith(B), '<header> is not mistaken for <head>')
ok(B.includes('"tok"') && !B.includes('</script>"'), 'the token is embedded as a JSON string')
ok(bridgeScript('a"</script>').includes('\\"') , 'a hostile token cannot break out of the string')

console.log('\n messages')
ok(readLog({ dsHtml: 1, token: 't', kind: 'warn', text: 'x' }, 't').kind === 'warn', 'a line from this run is accepted')
ok(readLog({ dsHtml: 1, token: 'old', kind: 'log', text: 'x' }, 't') === null, 'a line from a previous run is dropped')
ok(readLog({ token: 't', text: 'x' }, 't') === null && readLog(null, 't') === null && readLog('str', 't') === null, 'wrong shapes dropped')
ok(readLog({ dsHtml: 1, token: 't', kind: 'eval', text: 'x' }, 't').kind === 'log', 'unknown kinds become log')
ok(readLog({ dsHtml: 1, token: 't', kind: 'log', text: 'y'.repeat(9000) }, 't').text.length === MAX_LOG_CHARS, 'long lines are cut')

console.log('\n viewport fit')
const f = fitViewport(390, { w: 800, h: 600 })
ok(f.scale === 1 && f.w === 390 && f.left === (800 - 390) / 2, 'a phone fits at 100%, centred')
const d = fitViewport(1280, { w: 664, h: 500 })
ok(Math.abs(d.scale - 0.5) < 1e-9 && Math.abs(d.h - 952) < 1e-9, 'desktop scales down to fit width; height fills the area at that scale')
ok(JSON.stringify(fitViewport(null, { w: 300, h: 200 })) === JSON.stringify({ w: 300, h: 200, scale: 1, left: 0, top: 0 }), 'Fill = the whole area')
ok(fitViewport(1280, { w: 0, h: 0 }).scale === 0.1, 'a collapsed area never gives a zero scale')

console.log('\n isolation')
ok(SANDBOX.includes('allow-scripts') && !SANDBOX.includes('allow-same-origin') && !SANDBOX.includes('allow-top-navigation'), 'sandbox: scripts yes, same-origin and top navigation no')
const csp = previewCsp()
ok(/script-src [^;]*https:/.test(csp) && /script-src [^;]*'unsafe-inline'/.test(csp), 'CDN and inline scripts allowed in the preview')
ok(csp.includes("frame-ancestors 'self'") && csp.includes("form-action 'none'") && csp.includes("base-uri 'none'"), 'only framed by us, no form posts, no base rewrite')
ok(csp.startsWith("default-src 'none'") && !/https?:\/\/\*/.test(csp), 'default deny')
ok(PREVIEW_PATH === '/sandbox/html-preview', 'route path')

console.log('\n misc')
ok(titleOf('<html><head><title> Heat &amp; card </title></head></html>') === 'Heat & card', 'title read and unescaped')
ok(titleOf('<p>no title</p>') === '', 'no title → empty')
ok(byteLength('ą') === 2 && byteLength('a') === 1, 'bytes, not characters')
ok(MAX_HTML_BYTES === 512000, '500 KB cap')

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
