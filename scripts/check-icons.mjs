/*
  scripts/check-icons.mjs
  --------------------------------------------------------------------------
  Guards the wire-in.  node scripts/check-icons.mjs

  A typo'd icon name doesn't crash — Icon.js renders a same-size blank spacer
  so a toolbar never collapses. That's the right runtime behaviour and exactly
  why the mistake is easy to ship: the layout looks fine, the glyph is just
  missing. This catches it at build time instead.

  Three assertions:
    1  every icon name referenced anywhere resolves to real geometry
    2  every file rendering <Icon> actually imports it
    3  the three brush weights stay strictly ascending, so they read as a
       family rather than three copies of the same stroke
  -------------------------------------------------------------------------- */

import { readFileSync, readdirSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'components/ui/icon-paths.js'), 'utf8')

const NAMES = new Set([...SRC.matchAll(/^ {2}'([^']+)':/gm)].map(m => m[1]))

/* Only strings that look like an icon id are checked. Without the prefix list
   this would flag every kebab-case string in the app — 'nowrap', 'ease-out',
   CSS values, class names — and the noise would make the check useless. */
const ICON_ID = new RegExp(
  '^(action|app|auth|block|cc|draw|format|grid|handle|history|img|nav|plan' +
  '|settings|share|size|state|status|storage|sync|text|theme|tool|view)-[a-z0-9-]+$'
)

/* THE ONE COLLISION BETWEEN TWO NAMESPACES
   -------------------------------------------------------------------------
   Design tokens are kebab-case too, and six of them share the `text-` prefix
   with the text icons: `--ds-text-2` and `--ds-text-3` are colours, and
   lib/database.js stores OPTION_COLORS as token NAMES so an option can never
   hold a hex that is invisible in one theme. The heuristic above read those
   strings as icon ids and reported four failures that were not failures.

   Skipping them is derived, not listed by hand: a candidate is exempt only if
   globals.css genuinely declares `--ds-<name>`. A typo'd icon is not a
   declared token, so nothing real can hide here — and the count is printed
   below, so the exemption can never be silent. */
const TOKENS = new Set(
  [...readFileSync(join(ROOT, 'app/globals.css'), 'utf8').matchAll(/--ds-([a-z0-9-]+)\s*:/g)].map(m => m[1])
)
const isDesignToken = s => !NAMES.has(s) && TOKENS.has(s)

const files = []
;(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'out'].includes(e.name)) continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.jsx?$/.test(e.name)) files.push(p)
  }
})(ROOT)

const unresolved = []
const noImport = []
const used = new Set()
const tokenHits = new Set()
let sites = 0

for (const f of files) {
  if (/icon-paths|ui[/\\]Icon\.js|scripts[/\\]/.test(f)) continue
  const s = readFileSync(f, 'utf8')
  const rel = relative(ROOT, f)

  const n = [...s.matchAll(/<Icon\b/g)].length
  sites += n
  if (n > 0 && !/import Icon from/.test(s)) noImport.push(rel)

  /* ONLY FILES THAT ARE ABOUT ICONS ARE SCANNED FOR ICON NAMES.

     The prefix heuristic reads any kebab-case string as a candidate, which is
     fine in a component and wrong elsewhere: lib/sanitize.js holds an
     allowlist of CSS properties, and 'text-decoration' and 'text-align' were
     being reported as missing icons.

     The first attempt at this skipped any file with no <Icon> in it, and that
     was WRONG in a way worth recording: blockRegistry.js, lib/database.js and
     lib/files.js all name real icons in data tables without rendering one, so
     the rule quietly dropped 8 names — including every block-type icon in the
     registry — out of the check. A guard that stops checking the thing it
     exists to check is worse than no guard.

     So the test is whether the file refers to icons IN CODE — an `icon:` key,
     an iconFor/iconName helper, or the Icon component itself. A prose mention
     does not count: sanitize.js says "broken-image icon" in a comment, which
     was enough to defeat the first version of this rule. Derived rather than a
     list of exempt files, because a list grows until it covers the file with
     the real typo in it. */
  if (n === 0 && !/icon\s*:|iconFor|iconName|\bIcon\b/.test(s)) continue

  for (const m of s.matchAll(/'([a-z][a-z0-9]*-[a-z0-9-]+)'/g)) {
    if (!ICON_ID.test(m[1])) continue
    if (isDesignToken(m[1])) { tokenHits.add(m[1]); continue }
    used.add(m[1])
    if (!NAMES.has(m[1])) unresolved.push(`${rel}  →  ${m[1]}`)
  }
}

const weight = n => {
  const b = new RegExp(`'${n}': \\{([\\s\\S]*?)\\n {2}\\},`).exec(SRC)?.[1]
  return Number(/sw:\s*([\d.]+)/.exec(b || '')?.[1] ?? 4.66)
}
const brushes = ['draw-brush-sm', 'draw-brush-md', 'draw-brush-lg'].map(weight)
const brushOk = brushes[0] < brushes[1] && brushes[1] < brushes[2]

console.log(`\n  ${NAMES.size} icons in the set`)
console.log(`  ${sites} <Icon> render sites across ${files.length} files`)
console.log(`  ${used.size} distinct icons referenced`)
if (tokenHits.size) {
  console.log(`  ${tokenHits.size} kebab-case string(s) skipped as design tokens: ${[...tokenHits].sort().join(', ')}`)
}
console.log('')

let failed = false
if (unresolved.length) {
  failed = true
  console.log(`  ✗ ${unresolved.length} name(s) do not resolve:`)
  for (const u of unresolved) console.log(`      ${u}`)
  console.log('    Add the .svg and re-run scripts/build-icons.mjs, or fix the typo.\n')
}
if (noImport.length) {
  failed = true
  console.log('  ✗ renders <Icon> without importing it:')
  for (const f of noImport) console.log(`      ${f}`)
  console.log('')
}
if (!brushOk) {
  failed = true
  console.log(`  ✗ brush weights are ${brushes.join(' / ')} — must be strictly ascending.\n`)
}

if (failed) process.exit(1)
console.log(`  ✓ all names resolve, all imports present`)
console.log(`  ✓ brush weights ${brushes.join(' / ')} ascending\n`)
