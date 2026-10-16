/*
  tests/filename.test.mjs — lib/filename.js (audit DEF-026).
  Export filenames used an ASCII allow-list, so Lithuanian names were mangled.
*/
import { safeFileName } from '../lib/filename.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }

console.log('\n  export file names')
ok(safeFileName('Ataskaita už rugsėjį') === 'Ataskaita už rugsėjį', 'Lithuanian letters survive')
ok(safeFileName('Отчёт 2026') === 'Отчёт 2026', 'Cyrillic survives')
ok(safeFileName('My Project — Sheet 1') === 'My Project - Sheet 1', 'an em dash becomes a hyphen, not "_"')
ok(safeFileName('a/b\\c:d*e?f"g<h>i|j') === 'a_b_c_d_e_f_g_h_i_j', 'every character Windows refuses is replaced')
ok(safeFileName('report.  ') === 'report', 'trailing dots and spaces go (Windows drops them)')
ok(safeFileName('CON') === '_CON', 'reserved device names are prefixed')
ok(safeFileName('') === 'untitled' && safeFileName(null, 'document') === 'document', 'empty falls back')
ok(Array.from(safeFileName('ž'.repeat(200))).length === 80, 'capped at 80 characters, not bytes')
ok(safeFileName('a\u0000b\tc') === 'a_b_c', 'control characters do not reach the file system')

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
