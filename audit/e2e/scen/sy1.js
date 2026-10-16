//@include fresh.js
await H.add('Notes'); await page.keyboard.type('Synced text'); await sleep(4000)
const d = await (await fetch('http://localhost:54321/__dump')).json()
return { tables: Object.fromEntries(Object.entries(d.tables).map(([k, v]) => [k, v.map(r => ({ id: r.id, kind: r.kind, name: r.name, rev: r.rev, len: JSON.stringify(r.doc || r).length }))])), log: d.log.slice(-25).map(l => l.m + ' ' + l.p.slice(0, 110)) }
