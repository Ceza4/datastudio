/*
  scripts/check-undef.mjs
  --------------------------------------------------------------------------
  Fails on any identifier that is used but never defined (audit DEF-031).

  WHY A SEPARATE GUARD. Four menus in the database block read `text2` from a
  `colors` destructure that never took it. Rendering on the server (the unit
  suite, check-render-tree) cannot see it: those menus only exist after a
  click. In production, opening the column, option, view or filter menu threw
  a ReferenceError and the error boundary replaced the WHOLE block — the board
  view's own empty state told users to click exactly the chip that did it.

  `npm run lint` would have said so, but it carries a baseline of unrelated
  findings and gates nothing. This runs ONE rule, so it can gate.
  -------------------------------------------------------------------------- */
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = resolve(ROOT, 'node_modules/.bin/eslint')
let out
try {
  out = execFileSync(eslint, ['--rule', '{"no-undef":"error"}', '--format', 'json', 'app', 'components', 'lib'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch (e) {
  out = e.stdout   // eslint exits 1 when it finds anything at all
}
let results
try { results = JSON.parse(out) } catch {
  /* Never pass by accident: no parseable report is a failure, not a clean run. */
  console.log('  ✗ could not read an ESLint report — the check did not run')
  process.exit(1)
}
const hits = []
for (const f of results) for (const m of f.messages) {
  /* A file that does not PARSE has not been checked at all — ESLint reports
     it with ruleId null and fatal: true. Counting only no-undef let a syntax
     error read as "clean". */
  if (m.ruleId === 'no-undef' || m.fatal) hits.push(`${f.filePath.replace(ROOT + '/', '')}:${m.line}:${m.column}  ${m.fatal ? 'does not parse — ' : ''}${m.message}`)
}
if (!hits.length) { console.log(`  ✓ no undefined identifiers across ${results.length} files in app/, components/, lib/`); process.exit(0) }
console.log('  ✗ undefined identifiers — each one throws the moment that code runs:\n')
for (const h of hits) console.log('    ' + h)
process.exit(1)
