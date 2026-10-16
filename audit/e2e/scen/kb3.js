const R = {}
const W = () => page.evaluate(() => [...document.querySelectorAll('[data-ds-block-wrap] input')].map(i => i.value + ':' + i.closest('div[style]')?.parentElement?.innerText.match(/^\d+/m)?.[0]).join(' ; '))
const laneText = () => page.evaluate(() => { const w = document.querySelector('[data-ds-block-wrap]'); return w.innerText.replace(/\n+/g, '|') })
const card = page.getByText('First task', { exact: true })
const cb = await card.boundingBox()
const lane2 = await page.getByText('Lane 2').boundingBox().catch(() => null)
R.lane2 = lane2
// lanes are inputs, so find lane 2 column via input value
const l2 = await page.evaluate(() => { const i = [...document.querySelectorAll('[data-ds-block-wrap] input')].find(x => x.value === 'Lane 2'); const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 120 } })
await page.mouse.move(cb.x + 30, cb.y + 10); await page.mouse.down(); await page.mouse.move(l2.x, l2.y, { steps: 15 }); await sleep(100); await page.mouse.up(); await sleep(500)
R.afterDrag = await laneText()
R.blockPos = (await H.dom())[0]
await page.locator('[role=application]').focus()
await page.keyboard.press('Control+z'); await sleep(400)
R.afterUndo = { text: await laneText(), toast: await H.toasts() }
await shot('kb3')
return R
