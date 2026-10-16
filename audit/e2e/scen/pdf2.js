await sleep(2000)
const r = await page.evaluate(() => { const c = document.querySelector('[data-ds-block-wrap] canvas'); const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++; return { w: c.width, h: c.height, dark, text: c.closest('[data-ds-block-wrap]').innerText.slice(0, 200) } })
const log = (await (await fetch('http://localhost:54321/__dump')).json()).log.filter(l => !/auth\/v1\/user|my_account|chat_my/.test(l.p)).slice(-12).map(l => l.m + ' ' + l.p.slice(0, 90))
return { r, log }
