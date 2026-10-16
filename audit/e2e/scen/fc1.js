//@include fresh.js
await H.add('Flashcards'); await sleep(400)
const R = {}
const wrap = page.locator('[data-ds-block-wrap]').first()
await page.getByLabel('New card front').click()
await page.keyboard.type('Capital of Lithuania'); await page.keyboard.press('Enter')
R.afterEnterFront = await H.active()
await page.keyboard.type('Vilnius'); await page.keyboard.press('Enter'); await sleep(300)
R.afterAdd = { active: await H.active(), text: (await wrap.innerText()).replace(/\n+/g,' | ').slice(0,300) }
// Delete key inside the composer must not delete the block
await page.keyboard.type('x'); await page.keyboard.press('Backspace'); await page.keyboard.press('Delete'); await sleep(200)
R.blocksAfterDel = (await H.dom()).length
// Empty front + Enter → nothing added
await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await sleep(200)
R.countAfterEmpty = (await wrap.innerText()).match(/Cards · (\d+)/)?.[1]
// bulk paste
await page.getByLabel('New card front').click()
await page.evaluate(() => { const ta = document.querySelector('[aria-label="New card front"]'); const dt = new DataTransfer(); dt.setData('text/plain', 'a - 1\nb - 2\nc - 3'); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })
await sleep(300)
R.afterPaste = { count: (await wrap.innerText()).match(/Cards · (\d+)/)?.[1], toasts: await H.toasts() }
// study
await page.locator('[data-study-start]').click(); await sleep(300)
R.studyActive = await H.active()
await page.keyboard.press('3'); await sleep(100)  // grade before flip: must do nothing
R.beforeFlip = (await wrap.innerText()).replace(/\n+/g,' | ').slice(0,200)
await page.keyboard.press(' '); await sleep(150)
await page.keyboard.press('1'); await sleep(150)   // again
await page.keyboard.press(' '); await sleep(150); await page.keyboard.press('3'); await sleep(150)
R.midStudy = (await wrap.innerText()).replace(/\n+/g,' | ').slice(0,200)
await page.keyboard.press('Escape'); await sleep(300)
R.afterEsc = { active: await H.active(), selected: await H.selected(), view: (await wrap.innerText()).slice(0,60) }
await sleep(1200)
const b = (await H.savedBlocks()).find(x => x.type === 'flashcards')
R.saved = b && (b.cards || b.deck?.cards || []).map(c => ({ f: c.front, b: c.back, reps: c.reps, hist: c.history?.length }))
R.savedKeys = b && Object.keys(b)
await shot('fc1')
return R
