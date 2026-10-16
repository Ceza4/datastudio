// Reset to an empty workspace with one project.
await fetch('http://localhost:54321/__reset')
await page.goto('http://localhost:3100/app', { waitUntil: 'domcontentloaded' })
await page.evaluate(async () => {
  localStorage.clear(); sessionStorage.clear()
  const dbs = await indexedDB.databases?.() || []
  await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r() })))
})
await page.goto('http://localhost:3100/app', { waitUntil: 'networkidle' })
await sleep(400)
const np = page.getByRole('button', { name: /new project/i })
if (await np.count()) { await np.first().click(); await sleep(600) }

await page.getByRole('button', { name: /^add$/i }).first().click(); await sleep(200)
await page.keyboard.type('Notes'); await page.keyboard.press('Enter'); await sleep(500)
await page.keyboard.type('Hello world')
await sleep(300)
await shot('n1-typed')
const info = await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0,200), blocks: [...document.querySelectorAll('[data-ds-block-wrap]')].map(b => ({ id: b.getAttribute('data-ds-block-wrap'), r: b.getBoundingClientRect().toJSON(), cls: b.className, sel: b.getAttribute('data-selected') })) }))
return info
