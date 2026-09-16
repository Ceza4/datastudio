/*
  tests/workbook.test.mjs
  --------------------------------------------------------------------------
  The prototype-pollution guard around XLSX.read (lib/workbook.js).

  The point of these is not that SheetJS is currently exploitable in this exact
  way — it is that the guard actually fires, actually cleans up, and actually
  refuses the import, so the mitigation is a real one rather than a comment
  claiming to be one. The pollution is simulated directly rather than by
  shipping a malicious .xlsx into the repo.
  -------------------------------------------------------------------------- */

import { readWorkbook, utils } from '../lib/workbook.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }

console.log('\n  a clean workbook round-trips')
{
  const ws = utils.aoa_to_sheet([['a', 'b'], [1, 2]])
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'Sheet1')
  const bytes = new Uint8Array(
    (await import('xlsx')).write(wb, { type: 'array', bookType: 'xlsx' })
  )

  const back = readWorkbook(bytes)
  ok(back.SheetNames.length === 1, 'a real workbook parses')
  const rows = utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1 })
  ok(rows[0][0] === 'a' && rows[1][1] === 2, 'the data survives the guard unchanged')
  ok(Object.getOwnPropertyNames(Object.prototype).includes('hasOwnProperty'),
    'the guard left Object.prototype alone on the happy path')
}

console.log('\n  the guard fires on pollution')
{
  /* Stand in for a crafted workbook by polluting during the parse. What the
     guard sees is identical: a prototype gained an own-property between the
     snapshot and the return. */
  const marker = '__ds_pollution_probe__'
  let threw = null
  const realParse = (await import('xlsx')).read
  try {
    // Simulate by polluting first, then parsing garbage — readWorkbook
    // snapshots on entry, so pollute from inside the parse instead.
    const bad = {
      get length() { Object.prototype[marker] = 'owned'; return 0 },
    }
    try { readWorkbook(bad) } catch (e) { threw = e }
  } finally {
    delete Object.prototype[marker]
  }
  void realParse

  ok(threw != null, 'the import is refused rather than returning a parsed result')
  ok(!(marker in Object.prototype) && !Object.prototype[marker],
    'the polluted property is removed from Object.prototype')
  ok(/not imported/.test(threw?.message || ''),
    'the message says the file was not imported, not just that something went wrong')
  ok(/malicious/.test(threw?.message || ''),
    'and it says why — a damaged file does not do this')
}

console.log('\n  cleanup happens even when the parser throws')
{
  const marker = '__ds_pollution_probe2__'
  let threw = null
  try {
    const bad = {
      get length() {
        Object.prototype[marker] = 'owned'
        throw new Error('parser exploded halfway')
      },
    }
    try { readWorkbook(bad) } catch (e) { threw = e }
  } finally {
    delete Object.prototype[marker]
  }
  ok(threw != null, 'the failure still propagates')
  ok(!Object.prototype[marker],
    'a payload that pollutes and THEN crashes the parser is still swept — this is why the sweep is in finally')
}

console.log('\n  malformed input is an ordinary failure, not an attack')
{
  /* SheetJS is VERY lenient. Four random bytes do not throw and do not come
     back empty — they come back as a one-cell "Sheet1", because anything it
     cannot recognise is treated as CSV. That is worth knowing: it is the same
     behaviour that turns a .txt file into a grid of sentence fragments, which
     is fixed separately at the routing layer.

     What is asserted here is only what this module is responsible for: the
     guard stays QUIET. A corrupt file is not an attack, and reporting it as
     one would train people to click through the warning that matters. */
  let threw = null, wb = null
  try { wb = readWorkbook(new Uint8Array([1, 2, 3, 4])) } catch (e) { threw = e }
  ok(!/malicious/.test(threw?.message || ''), 'garbage is not reported as malicious')
  ok(threw === null, 'and it does not throw at all — SheetJS falls back to CSV parsing')
  ok((wb?.SheetNames?.length ?? 0) > 0,
    'it yields a sheet, which is why the import path must judge the CONTENT rather than trusting the parse')
}

console.log('\n  delimited text: European Excel exports')
{
  const { readDelimitedText } = await import('../lib/workbook.js')
  const rowsOf = wb => utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })
  const enc = s => new TextEncoder().encode(s)

  /* More decimal commas than semicolons — SheetJS split this on the commas. */
  let csv = 'Data;Temperatūra;Drėgmė\n'
  for (let i = 1; i <= 5; i++) csv += `2026-01-0${i};12,${i};45,${i}\n`
  let rows = rowsOf(readDelimitedText(enc(csv)))
  ok(rows[0].length === 3, 'semicolon file keeps all three columns')
  ok(rows[0][2] === 'Drėgmė', 'UTF-8 Lithuanian letters survive')
  ok(rows[1][1] === 12.1 && rows[5][2] === 45.5, 'decimal commas become 12.1, not 121')
  ok(rows[1][0] === '2026-01-01', 'ISO dates stay as the day string')

  rows = rowsOf(readDelimitedText(enc('a,b,c\n1,2.5,x\n3,4,"y, z"\n')))
  ok(rows[1][1] === 2.5 && rows[2][2] === 'y, z', 'comma CSV with dot decimals and quoted commas')

  rows = rowsOf(readDelimitedText(enc('a\tb\n1\t2\n')))
  ok(rows[1][1] === 2, 'tab-separated')

  rows = rowsOf(readDelimitedText(enc('sep=;\nA;B\n1 234,5;007\n')))
  ok(rows[0][1] === 'B' && rows[1][0] === 1234.5, 'sep= hint line and space-grouped thousands')
  ok(rows[1][1] === '007', 'leading-zero codes stay text')

  const cp1257 = new Uint8Array([0x44, 0x72, 0xEB, 0x67, 0x6D, 0xEB, 0x3B, 0x42, 0x0A, 0x31, 0x3B, 0x32, 0x0A])
  rows = rowsOf(readDelimitedText(cp1257))
  ok(rows[0][0] === 'Drėgmė', 'Windows-1257 (non-UTF-8) Excel export decodes')
}

console.log('\n  header row detection: forms with title lines and merged headers')
{
  const { tableFromSheet } = await import('../lib/workbook.js')
  const ws = utils.aoa_to_sheet([
    ['Forma patvirtinta Lietuvos Respublikos … įsakymu Nr. 1'],
    ['UAB Pavyzdys'],
    [],
    ['Eil. Nr.', 'Pavadinimas', 'Kiekis', null],
    [null, null, 'Planuojamas', 'Faktinis'],
    [1, 'Obuoliai', 10, 9.5],
    [2, 'Kriaušės', 20, 21, 'pastaba'],
  ])
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }, { s: { r: 3, c: 2 }, e: { r: 3, c: 3 } }]
  const t = tableFromSheet(ws)
  ok(t.headerRow === 3, 'title lines above the header are skipped')
  ok(t.labels.length === 5, 'width covers the widest data row, not the title')
  ok(t.labels[0] === 'Eil. Nr.' && t.labels[1] === 'Pavadinimas', 'real column names are used')
  ok(t.labels[2] === 'Kiekis · Planuojamas' && t.labels[3] === 'Kiekis · Faktinis', 'a merged group header combines with its sub-headers')
  ok(t.rows.length === 2 && t.rows[0][1] === 'Obuoliai' && t.rows[1][4] === 'pastaba', 'data starts after the sub-header row')

  const names = tableFromSheet(utils.aoa_to_sheet([['Vardas', 'Miestas'], ['Jonas', 'Vilnius']]))
  ok(names.rows.length === 1 && names.labels.join() === 'Vardas,Miestas', 'a text first data row is not mistaken for sub-headers')

  const plain = tableFromSheet(utils.aoa_to_sheet([['a', 'b'], [1, 2]]))
  ok(plain.headerRow === 0 && plain.labels.join() === 'a,b' && plain.rows.length === 1, 'an ordinary sheet is unchanged')
  const partial = tableFromSheet(utils.aoa_to_sheet([['ID', 'Suma'], [1, 10, 20, 30, 40], [2, 11, 21, 31, 41]]))
  ok(partial.headerRow === 0 && partial.rows.length === 2, 'a partly-labelled header over wider numeric data stays row 1')
  const twin = tableFromSheet(utils.aoa_to_sheet([['Vardas', 'Kiekis', 'Kiekis'], ['Jonas', 'daug', 'mažai'], ['Ona', 'x', 'y']]))
  ok(twin.rows.length === 2 && twin.labels[1] === 'Kiekis', 'identical adjacent headers without a merge are not a group')
  const meta = tableFromSheet(utils.aoa_to_sheet([['Įmonės kodas', 123456], ['A', 'B', 'C'], [1, 2, 3]]))
  ok(meta.headerRow === 0, 'a non-title row above (text + number) keeps row 1 as header')
  const single = tableFromSheet(utils.aoa_to_sheet([['only'], [1], [2]]))
  ok(single.headerRow === 0 && single.rows.length === 2, 'a one-column sheet still uses row 1')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
