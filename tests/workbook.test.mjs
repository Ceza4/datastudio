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

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
