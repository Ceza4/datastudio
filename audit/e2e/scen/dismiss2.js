const R = {}
for (const [name, sel] of [['Account', 'button[aria-label=Account]'], ['Settings', 'button[aria-label=Settings]'], ['People', '[data-menu-toggle=people]'], ['Builder', 'button:has-text("Builder")'], ['Export', 'button[title^="Export"]'], ['Add', 'button[aria-label="Add a block"], button[title="Add a block"]']]) {
  await fetch('http://localhost:54321/__reset')
  await page.goto('http://localhost:3100/app', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => { localStorage.clear(); const dbs = await indexedDB.databases?.() || []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r() }))) })
  await page.goto('http://localhost:3100/app', { waitUntil: 'networkidle' }); await sleep(500)
  const np = page.getByRole('button', { name: /new project/i }); if (await np.count()) { await np.first().click(); await sleep(600) }
  await page.locator(sel).first().click(); await sleep(400)
  const open = await page.evaluate(() => document.body.innerText.length)
  await page.mouse.click(760, 640); await sleep(500)
  R[name] = { newBlocks: (await H.dom()).length }
}
return R
