// Helpers injected into every step script.
const H = {
  async saved() {
    return page.evaluate(() => new Promise(res => {
      const q = indexedDB.open('datastudio'); q.onsuccess = () => {
        const db = q.result; const tx = db.transaction('state', 'readonly'); const g = tx.objectStore('state').getAll()
        g.onsuccess = () => res(g.result); g.onerror = () => res(null)
      }; q.onerror = () => res(null)
    }))
  },
  async savedBlocks() {
    const all = await H.saved(); const st = all?.find(x => x && x.notebooks) || all?.[0]
    if (!st?.notebooks) return null
    const nb = st.notebooks.find(n => n.id === st.activeNotebookId) || st.notebooks[0]
    const sh = nb?.sheets?.find(s => s.id === nb.activeSheetId) || nb?.sheets?.[0]
    return sh?.blocks || []
  },
  async dom() {
    return page.evaluate(() => [...document.querySelectorAll('[data-ds-block-wrap]')].map(b => {
      const r = b.getBoundingClientRect(); return { id: b.getAttribute('data-ds-block-wrap'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), z: b.style.zIndex, text: b.innerText.slice(0, 60) }
    }))
  },
  async selected() { // selection = z-index 20 (or container 3) with the pointer parked away
    await page.mouse.move(1435, 895)
    await sleep(60)
    return (await H.dom()).filter(b => b.z === '20' || b.z === '3').map(b => b.id)
  },
  async active() { return page.evaluate(() => { const a = document.activeElement; return a ? a.tagName + (a.getAttribute('aria-label') ? '[' + a.getAttribute('aria-label') + ']' : '') + (a.getAttribute('role') ? '{' + a.getAttribute('role') + '}' : '') + (a.isContentEditable ? '(ce)' : '') : null }) },
  async add(label) {
    await page.getByRole('button', { name: /^add$/i }).first().click(); await sleep(200)
    await page.keyboard.type(label); await sleep(120); await page.keyboard.press('Enter'); await sleep(500)
  },
  async toasts() { return page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert]')].map(t => t.innerText.trim()).filter(Boolean)) },
  async header(id) { return page.locator(`[data-ds-block-wrap="${id}"]`).first() },
}
