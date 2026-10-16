// DEF candidate: Ctrl+Z after a remote pull reverts the other device's work.
import { launch, BASE, sleep, ok, summary, resetMock, dump } from './lib.mjs'
await resetMock()
const A = await launch(), B = await launch()
async function openFresh(p) {
  await p.goto(BASE + '/app', { waitUntil: 'networkidle' }); await sleep(600)
}
async function add(p, label, text) {
  await p.getByRole('button', { name: /^add$/i }).first().click(); await sleep(200)
  await p.keyboard.type(label); await p.keyboard.press('Enter'); await sleep(500)
  await p.keyboard.type(text); await sleep(400)
  await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Escape'); await sleep(200)
}
const texts = p => p.evaluate(() => [...document.querySelectorAll('[data-ds-text]')].map(e => e.innerText.trim()))
const docText = async () => { const d = await dump(); return (d.tables.docs || []).map(r => JSON.stringify(r.doc)).join(' ') }

await openFresh(A.page)
await A.page.getByRole('button', { name: /new project/i }).click(); await sleep(800)
await add(A.page, 'Notes', 'FROM-A-ONE')
await sleep(3500)
ok((await docText()).includes('FROM-A-ONE'), 'A pushed its first block')

await openFresh(B.page); await sleep(2500)
ok((await texts(B.page)).includes('FROM-A-ONE'), 'B pulled A\'s block', await texts(B.page))

// A makes its own edit (recorded in A's undo history)
await add(A.page, 'Notes', 'FROM-A-TWO')
await sleep(3500)
// B pulls it, then makes ITS edit
await B.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(2500)
ok((await texts(B.page)).includes('FROM-A-TWO'), 'B pulled A\'s second block', await texts(B.page))
await add(B.page, 'Notes', 'FROM-B')
await sleep(3500)
ok((await docText()).includes('FROM-B'), 'B pushed its block')

// A pulls B's work
await A.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(2500)
ok((await texts(A.page)).includes('FROM-B'), 'A pulled B\'s block', await texts(A.page))

// A undoes ITS OWN last action (adding FROM-A-TWO … typing)
await A.page.locator('[role=application]').focus()
await A.page.keyboard.press('Control+z'); await sleep(600)
const afterUndo = await texts(A.page)
console.log('A after one Ctrl+Z:', afterUndo, await A.page.evaluate(() => [...document.querySelectorAll('[role=status]')].map(t => t.innerText)))
ok(afterUndo.includes('FROM-B'), "A's Ctrl+Z keeps B's block (undo must not revert another device's work)", afterUndo)
await sleep(4000)
ok((await docText()).includes('FROM-B'), "the server still has B's block after A's undo is pushed")
await A.browser.close(); await B.browser.close()
process.exit(summary())
