/*
  scripts/check-hook-order.mjs
  --------------------------------------------------------------------------
  Catches "Cannot access 'X' before initialization".

      npm run check:hooks

  THE MISTAKE
  A hook's dependency array is evaluated DURING RENDER, at the point the
  useEffect/useCallback/useMemo call executes. So this throws:

      useEffect(() => { ... }, [handleThing])     // ← evaluated here
      const handleThing = useCallback(() => {}, [])   // ← still in its TDZ

  It is not a lint error, it is not a type error, and it looks completely
  ordinary — two independent declarations that happen to be in the wrong
  order. The whole component throws on first render, and if there's an error
  boundary above it the failure is reported as "this block couldn't be
  displayed", which points at the block rather than at the ordering.

  That's exactly how it presented: a PDF that wouldn't open, chased through
  the pdf.js integration, when the cause was two lines in the wrong sequence.

  WHY A SCRIPT
  The risk scales with file size and with editing by insertion — move a hook,
  or add one that references a callback defined below it, and it's back. This
  file is cheap and it cannot be argued with.
  -------------------------------------------------------------------------- */

import { readFileSync, readdirSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'
import { parse } from '@babel/parser'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useCallback', 'useMemo', 'useImperativeHandle'])

const files = []
for (const dir of ['components', 'app']) {
  ;(function walk(d) {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (['node_modules', '.next', '.git'].includes(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.jsx?$/.test(e.name)) files.push(p)
    }
  })(join(ROOT, dir))
}

let problems = 0
let checked = 0

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  let ast
  try {
    ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  } catch { continue }

  /* Where each `const X = ...` is declared, by line. Only top-level-of-function
     consts matter for this check, but recording them all is harmless: a name
     declared in an inner scope simply won't be referenced by an outer deps
     array. */
  const declaredAt = new Map()
  const depsUses = []      // { name, line }

  ;(function visit(node, parent) {
    if (!node || typeof node !== 'object') return

    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.loc) {
      // First declaration wins; shadowing later is not what we're hunting.
      if (!declaredAt.has(node.id.name)) declaredAt.set(node.id.name, node.loc.start.line)
    }

    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && HOOKS.has(node.callee.name)) {
      const deps = node.arguments?.[1]
      if (deps?.type === 'ArrayExpression') {
        for (const el of deps.elements || []) {
          // Bare identifiers only. `a.b` is a member expression evaluated the
          // same way, but its OBJECT is what matters, so unwrap to the root.
          let root = el
          while (root && root.type === 'MemberExpression') root = root.object
          if (root?.type === 'Identifier' && root.loc) {
            depsUses.push({ name: root.name, line: root.loc.start.line })
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'parent') continue
      const v = node[key]
      if (Array.isArray(v)) v.forEach(c => visit(c, node))
      else if (v && typeof v.type === 'string') visit(v, node)
    }
  })(ast, null)

  checked++

  for (const use of depsUses) {
    const declLine = declaredAt.get(use.name)
    if (declLine === undefined) continue          // imported or a prop — fine
    if (declLine > use.line) {
      problems++
      console.log(`  ✗ ${relative(ROOT, file)}`)
      console.log(`      "${use.name}" is used in a dependency array on line ${use.line},`)
      console.log(`      but declared on line ${declLine}.`)
      console.log('      A deps array is evaluated during render, so this throws')
      console.log(`      "Cannot access '${use.name}' before initialization".`)
      console.log('      Move the declaration above the hook that depends on it.\n')
    }
  }
}

console.log(`\n  Checked ${checked} components.`)
if (problems) {
  console.log(`\n  ✗ ${problems} ordering problem(s).\n`)
  process.exit(1)
}
console.log('  ✓ every hook dependency is declared before it is used.\n')
