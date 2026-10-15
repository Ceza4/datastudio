/*
  tests/appversion.test.mjs
  --------------------------------------------------------------------------
  The format stamp (lib/appversion.js) and the rule that keeps it honest:
  lib/sanitize.js may not change without CONTENT_SCHEMA being reviewed.
  Run: node tests/appversion.test.mjs
  -------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { CONTENT_SCHEMA, SANITIZE_FINGERPRINT, schemaOf, stampDoc, isOutdatedError } from '../lib/appversion.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name) } else { fail++; console.log('  FAIL', name, extra) } }

console.log('\n the stamp')
ok('an unstamped document is format 0', schemaOf({ sheets: [] }) === 0 && schemaOf(null) === 0)
ok('junk is format 0', schemaOf({ _schema: 'x' }) === 0 && schemaOf({ _schema: -2 }) === 0)
const d = { id: 'nb', sheets: [] }
const s = stampDoc(d)
ok('stamping copies, never mutates', s !== d && d._schema === undefined && s._schema === CONTENT_SCHEMA)
ok('an already-stamped document is returned as is', stampDoc(s) === s)
ok('the server refusal is recognised', isOutdatedError({ message: 'outdated_client: this document was saved by a newer version' }))
ok('by hint too', isOutdatedError({ message: 'x', hint: 'outdated_client' }))
ok('other errors are not', !isOutdatedError({ message: 'permission denied' }))

console.log('\n the rule')
const fp = createHash('sha256').update(readFileSync(new URL('../lib/sanitize.js', import.meta.url))).digest('hex').slice(0, 16)
ok('lib/sanitize.js has not changed since CONTENT_SCHEMA was last reviewed', fp === SANITIZE_FINGERPRINT,
  `\n       lib/sanitize.js changed (fingerprint ${fp}). If the change lets NEW markup be stored, bump CONTENT_SCHEMA in lib/appversion.js;\n       either way set SANITIZE_FINGERPRINT = '${fp}'. An older app would otherwise strip the new markup and push the result.`)

console.log(`\n ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
