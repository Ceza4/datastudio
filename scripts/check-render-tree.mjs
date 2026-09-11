#!/usr/bin/env node
/*
  scripts/check-render-tree.mjs
  --------------------------------------------------------------------------
  NOTHING IN THE RENDER TREE TALKS TO A SERVER.

  WHY THIS EXISTS, which is the same reason twice.

  lib/supabaseClient.js reads `process.env` at module scope. Next inlines that
  at build time; nothing else does. So the moment a file under components/ can
  reach it — directly or through four hops of imports — three things happen:

    · tests/browser/run.mjs mounts a blank page and reports
      `process is not defined`, which does not name the import that caused it;
    · every component in that graph becomes untestable outside Next;
    · a rendering component acquires opinions about the network.

  The first time, lib/attribution.js was split out of lib/blocks.js to fix it,
  and the lesson was written down as "the pure half imports nothing that talks
  to a server". That phrasing was too narrow. The chat block obeyed it — and
  the import moved one level up into NotebookCanvas, which the harness also
  mounts, and the harness went red again for the identical reason.

  A rule that has been broken twice by people who had read it is a rule that
  needs a check rather than a paragraph. This is the check.

  ── THE RULE, STATED HONESTLY ──────────────────────────────────────────────

  The first draft of this script said "no file under components/". Run against
  the actual codebase it flagged four components that have always reached the
  network and have always worked — SettingsPanel, AccountButton, SyncChip and
  SharePanel — because nothing ever mounts them outside Next.

  So that phrasing was a rule nobody follows, which is worse than no rule: it
  would have been baselined into an ignore list within a week and stopped
  meaning anything. The constraint that is REAL, and that broke twice, is
  narrower and sharper:

      ANYTHING THE BROWSER HARNESS MOUNTS MUST NOT REACH THE NETWORK LAYER.

  The entry points are therefore not a hand-written list — they are read out of
  tests/browser/harness.jsx, so the guard widens by itself the day somebody
  adds a component to the harness, which is exactly the day the constraint
  starts applying to it.
  -------------------------------------------------------------------------- */

import { readFileSync, existsSync, statSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)

/* The modules that make a graph unmountable outside Next. supabaseClient is
   the root cause; the rest are listed because they import it and naming them
   makes the failure message say something useful. */
const FORBIDDEN = new Set([
  'lib/supabaseClient.js',
])

/* The harness is the entry point, and it is read rather than restated. */
const HARNESS = join(ROOT, 'tests/browser/harness.jsx')

const IMPORT_RE = /(?:^|\n)\s*(?:import[\s\S]*?from|export[\s\S]*?from)\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

function importsOf(file) {
  let src
  try { src = readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src))) out.push(m[1])
  }
  return out
}

/** Resolve a relative specifier the way both the bundler and bare Node would. */
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null          // a package; not our graph
  const base = resolve(dirname(fromFile), spec)
  for (const cand of [base, base + '.js', base + '.jsx', join(base, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

const rel = f => relative(ROOT, f).split('\\').join('/')

/**
 * The shortest import path from `entry` to a forbidden module, or null.
 * Breadth-first on purpose: the shortest path is the one a person can act on.
 */
function pathToForbidden(entry) {
  const seen = new Set([entry])
  const queue = [[entry]]
  while (queue.length) {
    const chain = queue.shift()
    const file = chain[chain.length - 1]
    for (const spec of importsOf(file)) {
      const next = resolveSpec(file, spec)
      if (!next || seen.has(next)) continue
      seen.add(next)
      const chainNext = [...chain, next]
      if (FORBIDDEN.has(rel(next))) return chainNext
      queue.push(chainNext)
    }
  }
  return null
}

if (!existsSync(HARNESS)) {
  console.log('\n  SKIPPED — tests/browser/harness.jsx is missing.\n')
  process.exit(0)
}

/* Every component the harness mounts, directly. Those, and everything they
   pull in, are the graph that has to load in bare Chromium. */
const entries = importsOf(HARNESS)
  .map(spec => resolveSpec(HARNESS, spec))
  .filter(f => f && rel(f).startsWith('components/'))

let checked = 0
const violations = []

for (const file of entries) {
  checked++
  const chain = pathToForbidden(file)
  if (chain) violations.push(chain)
}

console.log('')
if (violations.length) {
  console.log(`  ✗ ${violations.length} render-tree file(s) can reach the network layer.\n`)
  /* One example in full rather than all of them in summary: they are almost
     always the same one import, and the chain is what tells you where to cut. */
  for (const chain of violations.slice(0, 3)) {
    console.log('    ' + chain.map(rel).join('\n      → '))
    console.log('')
  }
  if (violations.length > 3) console.log(`    …and ${violations.length - 3} more, almost certainly the same import.\n`)
  console.log('  This graph has to mount in bare Chromium for tests/browser to run.')
  console.log('  Move the call into app/app/page.js and pass it down as a prop.')
  console.log('  See the note in components/notebook/NotebookCanvas.js.\n')
  process.exit(1)
}

console.log(`  Checked ${checked} harness-mounted components and everything they import.`)
console.log('  ✓ nothing the browser harness mounts can reach the network layer.\n')
