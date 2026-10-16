// Per-block-type lifecycle battery: create → escape → drag+undo → duplicate → copy/paste → delete+undo → reload.
import { launch, BASE, sleep, resetMock, SHOTS } from './lib.mjs'
const TYPES = (process.argv[2] || 'Notes,Document,Kanban Board,Section,Task,Calendar,Table Block,Database,Countdown,Flashcards,Chat,Pipeline,HTML prototype,Agent').split(',')
const rows = []
for (const L of TYPES) {
  await resetMock()
  const { browser, context, page, errors } = await launch()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  const r = { type: L, notes: [] }
  const dom = () => page.evaluate(() => [...document.querySelectorAll('[data-ds-block-wrap]')].map(b => { const q = b.getBoundingClientRect(); return { id: b.getAttribute('data-ds-block-wrap'), x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height), z: b.style.zIndex } }))
  const canvasFocus = () => page.evaluate(() => { const a = document.activeElement; return !a || a === document.body || a.getAttribute('role') === 'application' })
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert]')].map(t => t.innerText.trim()).filter(Boolean).join(' | '))
  try {
    await page.goto(BASE + '/app', { waitUntil: 'networkidle' }); await sleep(500)
    await page.getByRole('button', { name: /new project/i }).click(); await sleep(700)
    await page.getByRole('button', { name: /^add$/i }).first().click(); await sleep(200)
    await page.keyboard.type(L); await page.keyboard.press('Enter'); await sleep(900)
    let d = await dom()
    r.created = d.length === 1
    if (!r.created) throw new Error('not created: ' + d.length)
    const id0 = d[0].id
    r.focusAfterCreate = await page.evaluate(() => { const a = document.activeElement; return a.tagName + (a.isContentEditable ? '(ce)' : '') + (a.getAttribute('aria-label') ? '[' + a.getAttribute('aria-label').slice(0, 30) + ']' : '') })
    // Escape out (twice max) and require canvas focus with block still present
    for (let i = 0; i < 3 && !(await canvasFocus()); i++) { await page.keyboard.press('Escape'); await sleep(150) }
    r.escToCanvas = await canvasFocus()
    // select by clicking header
    d = await dom()
    const b = d[0]
    await page.mouse.click(b.x + 60, b.y + 14); await sleep(250)
    for (let i = 0; i < 3 && !(await canvasFocus()); i++) { await page.keyboard.press('Escape'); await sleep(150) }
    // drag the header by 150,80
    await page.mouse.move(b.x + 60, b.y + 14); await page.mouse.down(); await sleep(50)
    for (let k = 1; k <= 10; k++) { await page.mouse.move(b.x + 60 + 15 * k, b.y + 14 + 8 * k); await sleep(16) }
    await page.mouse.up(); await sleep(500)
    d = await dom()
    const moved = d.find(x => x.id === id0)
    r.dragMoved = moved ? `${moved.x - b.x},${moved.y - b.y}` : 'gone'
    for (let i = 0; i < 3 && !(await canvasFocus()); i++) { await page.keyboard.press('Escape'); await sleep(150) }
    await page.keyboard.press('Control+z'); await sleep(500)
    d = await dom()
    const back = d.find(x => x.id === id0)
    r.undoMove = back ? `${back.x - b.x},${back.y - b.y}` : 'gone'
    r.undoToast1 = await toasts()
    // reselect, duplicate
    await page.mouse.click(back.x + 60, back.y + 14); await sleep(250)
    for (let i = 0; i < 3 && !(await canvasFocus()); i++) { await page.keyboard.press('Escape'); await sleep(150) }
    await page.keyboard.press('Control+d'); await sleep(600)
    d = await dom()
    r.duplicate = d.length === 2 ? 'ok ' + (d[1].x - d[0].x) + ',' + (d[1].y - d[0].y) : `count ${d.length}`
    // copy/paste
    for (let i = 0; i < 3 && !(await canvasFocus()); i++) { await page.keyboard.press('Escape'); await sleep(150) }
    const before = d.length
    await page.keyboard.press('Control+c'); await sleep(300)
    await page.keyboard.press('Control+v'); await sleep(800)
    d = await dom()
    r.paste = d.length - before
    r.pasteToast = await toasts()
    // select all and delete
    for (let i = 0; i < 3 && !(await canvasFocus()); i++) { await page.keyboard.press('Escape'); await sleep(150) }
    await page.keyboard.press('Control+a'); await sleep(200)
    await page.keyboard.press('Delete'); await sleep(700)
    // section dialog?
    const dlg = await page.locator('[role=dialog],[role=alertdialog]').count()
    if (dlg) { r.notes.push('delete asked a dialog'); await page.keyboard.press('Escape'); await sleep(200) }
    d = await dom()
    r.deleteAll = d.length
    await page.keyboard.press('Control+z'); await sleep(600)
    d = await dom()
    r.undoDelete = d.length
    await sleep(1500)
    await page.reload({ waitUntil: 'networkidle' }); await sleep(1200)
    d = await dom()
    r.reload = d.length
    await page.screenshot({ path: `${SHOTS}/battery-${L.replace(/\W+/g, '_')}.png` })
  } catch (e) { r.error = e.message.split('\n')[0] }
  r.errors = errors.filter(e => !/realtime\/v1\/websocket/.test(e)).slice(0, 5)
  rows.push(r)
  console.log(JSON.stringify(r))
  await browser.close()
}
