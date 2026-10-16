//@include fresh.js
await H.add('HTML'); await sleep(500)
const R = {}
R.blocks = (await H.dom()).map(b => b.text.slice(0, 40))
const ta = page.getByLabel('HTML source')
await ta.click()
await page.keyboard.type('<title>Probe</title><h1 id=x>Hello</h1><script>console.log("hi"); try { parent.document.title } catch (e) { console.error("blocked " + e.name) }; try { localStorage.x = 1; console.log("ls ok") } catch (e) { console.warn("ls " + e.name) }</script>')
await page.keyboard.press('Control+Enter'); await sleep(1200)
R.console = (await page.locator('[data-ds-block-wrap]').first().innerText()).split('\n').filter(l => /hi|blocked|ls |error|warning|Console/.test(l))
const fr = page.frames().find(f => f.url().includes('html-preview'))
R.frameText = fr ? await fr.evaluate(() => document.body.innerText).catch(e => 'ERR ' + e.message) : 'no frame'
R.name = (await H.dom())[0].text.slice(0, 30)
// Tab in the editor; then Escape — can the keyboard leave the editor?
await ta.click(); await page.keyboard.press('End'); await page.keyboard.press('Tab'); await sleep(50)
R.afterTab = await H.active()
await page.keyboard.press('Escape'); await sleep(150)
R.afterEsc = await H.active()
// Unsaved-typing-on-switch: type then immediately go to a new sheet and back
await ta.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('<p>LAST</p>')
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(700)
await page.getByText('Sheet 1', { exact: true }).first().click(); await sleep(900)
R.afterSwitch = await page.evaluate(() => document.querySelector('[aria-label="HTML source"]')?.value.slice(-30))
await sleep(800)
const b = (await H.savedBlocks())?.find(x => x.type === 'html')
R.savedTail = b?.html?.slice(-30)
await shot('html1')
return R
