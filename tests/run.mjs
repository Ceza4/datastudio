/*
  tests/run.mjs
  --------------------------------------------------------------------------
  Runs every *.test.mjs in this folder and reports one summary.

      npm test

  No framework. These are pure functions with no DOM and no async, so a
  framework would be more setup than the tests themselves — and a test suite
  that needs an install step before it runs is a test suite that stops being
  run. Each file is a plain module that prints `ok` lines and exits non-zero
  on failure.
  -------------------------------------------------------------------------- */

import { readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(HERE).filter(f => f.endsWith('.test.mjs')).sort()

if (!files.length) {
  console.error('No *.test.mjs files found in tests/')
  process.exit(1)
}

let failed = 0
let totalPass = 0, totalFail = 0
const t0 = Date.now()

for (const f of files) {
  /* Suites containing JSX need the transform hook. Passing --import to every
     suite would work, but it costs a TypeScript load on files that don't need
     one, so it's opt-in by filename. */
  const needsJsx = f.startsWith('smoke.')
  const args = needsJsx
    ? ['--import', join(HERE, 'jsx-loader.mjs'), join(HERE, f)]
    : [join(HERE, f)]
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' })
  const out = (res.stdout || '') + (res.stderr || '')

  // Each suite prints " N passed, M failed" as its last meaningful line.
  const m = /(\d+) passed, (\d+) failed/.exec(out)
  const p = m ? Number(m[1]) : 0
  const q = m ? Number(m[2]) : 0
  totalPass += p; totalFail += q

  /* A REPORTED failure counts even when the suite exited 0.
     ------------------------------------------------------------------
     Most suites end with `process.exit(fail ? 1 : 0)`. Four of them
     (templates, sanitize, urls, pdfreplace) end with `export default
     { pass, fail }` instead, and a module that finishes normally exits 0
     whatever it printed. So a broken assertion in any of those four printed
     "1 FAILED" on its own line, printed "· 1 FAILED" in the summary, and
     `npm test` exited 0 — which is what CI, a pre-commit hook and an agent
     all actually read.

     Found by mutation: deleting `sourceNotebookId` from templateFromNotebook
     turned templates.test.mjs red on screen and left the exit code green.
     The count is right there in the output either way, so use it. */
  const bad = res.status !== 0 || q > 0
  if (bad) failed++

  console.log(`${bad ? '✗' : '✓'}  ${f.padEnd(38)} ${p} passed${q ? `, ${q} FAILED` : ''}`)

  // Only spill the full log for a failure — a green run should be one line.
  if (bad) {
    console.log(out.split('\n').filter(l => /FAIL|Error|at /.test(l)).slice(0, 25).map(l => '     ' + l).join('\n'))
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n${failed ? '✗' : '✓'}  ${files.length} suites · ${totalPass} assertions passed${totalFail ? ` · ${totalFail} FAILED` : ''} · ${secs}s\n`)
process.exit(failed ? 1 : 0)
