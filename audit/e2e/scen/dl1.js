const r = {}
for (const name of ['plain.csv', 'Ataskaita už rugsėjį.csv', 'My Project - Sheet 1-2026.csv']) {
  const p = page.waitForEvent('download', { timeout: 5000 })
  await page.evaluate(n => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['x'])); a.download = n; document.body.appendChild(a); a.click(); a.remove() }, name)
  r[name] = (await p.catch(() => null))?.suggestedFilename() || 'none'
}
return r
