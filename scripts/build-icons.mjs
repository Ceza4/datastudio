/*
  scripts/build-icons.mjs
  --------------------------------------------------------------------------
  Turns a folder of .svg files into components/ui/icon-paths.js.

    node scripts/build-icons.mjs ../icons
    node scripts/build-icons.mjs ../icons --check     (validate only, no write)

  WHY GENERATE RATHER THAN IMPORT THE FILES
  Next can import SVGs as components, but that means ~100 network requests in
  dev, a wrapper component per file, and no way to enforce the system. Inlining
  the geometry into one module gives a single import, no runtime fetches, and
  one place to assert that every icon actually obeys the spec.

  WHAT IT ENFORCES
  Anything that would silently break at 14px, or break theming:
    · viewBox must be 0 0 64 64          (wrong grid = wrong scale everywhere)
    · no hardcoded colours               (kills dark mode)
    · no transforms / groups / gradients (don't survive flattening to a path)
    · no <text>                          (won't match the app's font)
    · no width/height attributes         (the component sets those)
  Violations are reported per file. Hard errors block the write; soft ones are
  fixed automatically and listed so you know what changed.
  -------------------------------------------------------------------------- */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, basename, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../components/ui/icon-paths.js')

const srcDir = process.argv[2]
const checkOnly = process.argv.includes('--check')

if (!srcDir) {
  console.error('usage: node scripts/build-icons.mjs <folder-of-svgs> [--check]')
  process.exit(1)
}
const dir = resolve(process.cwd(), srcDir)
if (!existsSync(dir)) {
  console.error(`Folder not found: ${dir}`)
  process.exit(1)
}

const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.svg')).sort()
if (!files.length) {
  console.error(`No .svg files in ${dir}`)
  process.exit(1)
}

/* The leading (?<![-\w]) matters: without it, looking up "width" also matches
   the tail of stroke-width="4.66", so every icon reported a width attribute it
   didn't have. Same trap for "x" inside "rx", and "r" inside "stroke". */
const attr = (tag, name) => {
  const m = new RegExp(`(?<![-\\w])${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
  return m ? m[1] : null
}
const nums = s => (s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number)

const icons = {}
const problems = []
const fixes = []

for (const file of files) {
  const name = basename(file, '.svg')
  const raw = readFileSync(join(dir, file), 'utf8')
  const bad = []
  const soft = []

  // ── structural checks ──
  const svgTag = /<svg[^>]*>/i.exec(raw)?.[0] ?? ''
  const vb = attr(svgTag, 'viewBox')
  if (!vb) bad.push('no viewBox')
  else {
    const [x, y, w, h] = nums(vb)
    if (x !== 0 || y !== 0 || w !== 64 || h !== 64) bad.push(`viewBox is "${vb}", expected "0 0 64 64"`)
  }
  if (/<(g|use|symbol)[\s>]/i.test(raw)) bad.push('contains <g>/<use>/<symbol> — flatten before export')
  if (/transform\s*=/i.test(raw)) bad.push('contains transform= — bake it into the path')
  if (/<(linearGradient|radialGradient|filter|mask|clipPath)[\s>]/i.test(raw)) bad.push('contains gradient/filter/mask')
  if (/<text[\s>]/i.test(raw)) bad.push('contains <text> — convert to paths')
  if (/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(raw.replace(/<!--[\s\S]*?-->/g, ''))) bad.push('hardcoded colour — must be currentColor')

  if (attr(svgTag, 'width') || attr(svgTag, 'height')) soft.push('stripped width/height')

  // ── geometry ──
  const d = []
  const dots = []

  for (const m of raw.matchAll(/<path\b[^>]*>/gi)) {
    const dd = attr(m[0], 'd')
    if (!dd) continue
    const fill = (attr(m[0], 'fill') || '').toLowerCase()
    // A filled path is a solid mark, not a stroked one — keep it flagged so
    // the component renders it without a stroke.
    if (fill && fill !== 'none') soft.push('filled path kept as a solid mark')
    d.push(dd.replace(/\s+/g, ' ').trim())
  }

  for (const m of raw.matchAll(/<circle\b[^>]*>/gi)) {
    const cx = Number(attr(m[0], 'cx')), cy = Number(attr(m[0], 'cy')), r = Number(attr(m[0], 'r'))
    const fill = (attr(m[0], 'fill') || '').toLowerCase()
    if ([cx, cy, r].every(Number.isFinite)) {
      if (fill && fill !== 'none') dots.push({ x: cx, y: cy, r })
      else d.push(`M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}`)
    }
  }
  for (const m of raw.matchAll(/<line\b[^>]*>/gi)) {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => Number(attr(m[0], a)))
    if ([x1, y1, x2, y2].every(Number.isFinite)) d.push(`M${x1} ${y1}L${x2} ${y2}`)
  }
  for (const m of raw.matchAll(/<(polyline|polygon)\b[^>]*>/gi)) {
    const pts = nums(attr(m[0], 'points'))
    if (pts.length >= 4) {
      let s = `M${pts[0]} ${pts[1]}`
      for (let i = 2; i < pts.length; i += 2) s += `L${pts[i]} ${pts[i + 1]}`
      if (/polygon/i.test(m[0])) s += 'Z'
      d.push(s)
    }
  }
  for (const m of raw.matchAll(/<rect\b[^>]*>/gi)) {
    const x = Number(attr(m[0], 'x') ?? 0), y = Number(attr(m[0], 'y') ?? 0)
    const w = Number(attr(m[0], 'width')), h = Number(attr(m[0], 'height'))
    const r = Number(attr(m[0], 'rx') ?? 0) || 0
    if ([x, y, w, h].every(Number.isFinite)) {
      d.push(r
        ? `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
        : `M${x} ${y}H${x + w}V${y + h}H${x}Z`)
    }
  }

  if (!d.length && !dots.length) bad.push('no drawable geometry found')

  // per-icon stroke override, if the file carries one
  const sw = Number(attr(svgTag, 'stroke-width'))
  const entry = { d, dots }
  if (Number.isFinite(sw) && Math.abs(sw - 4.66) > 0.01) entry.sw = sw

  if (bad.length) problems.push({ name, bad })
  if (soft.length) fixes.push({ name, soft: [...new Set(soft)] })
  icons[name] = entry
}

// ── report ──
const names = Object.keys(icons)
console.log(`\nRead ${files.length} SVG files from ${dir}`)
console.log(`  ${names.length} icons parsed`)

if (fixes.length) {
  console.log(`\n  Auto-corrected (${fixes.length}):`)
  for (const f of fixes.slice(0, 12)) console.log(`    ${f.name.padEnd(26)} ${f.soft.join(', ')}`)
  if (fixes.length > 12) console.log(`    …and ${fixes.length - 12} more`)
}

if (problems.length) {
  console.log(`\n  ✗ ${problems.length} file(s) violate the spec:\n`)
  for (const p of problems) {
    console.log(`    ${p.name}`)
    for (const b of p.bad) console.log(`        · ${b}`)
  }
  console.log('\n  Nothing written. Fix these, or re-export from the design tool.\n')
  process.exit(1)
}

if (checkOnly) {
  console.log('\n  ✓ All files pass. (--check, nothing written.)\n')
  process.exit(0)
}

// ── emit ──
const body = names.map(n => {
  const { d, dots, sw } = icons[n]
  const parts = [`d: [${d.map(x => `\n      '${x}',`).join('')}\n    ]`]
  if (dots.length) parts.push(`dots: [${dots.map(c => `{ x: ${c.x}, y: ${c.y}, r: ${c.r} }`).join(', ')}]`)
  if (sw) parts.push(`sw: ${sw}`)
  return `  '${n}': {\n    ${parts.join(',\n    ')},\n  },`
}).join('\n')

const out = `/*
  components/ui/icon-paths.js
  --------------------------------------------------------------------------
  GENERATED — do not edit by hand.
  Rebuild:  node scripts/build-icons.mjs <folder-of-svgs>

  ${names.length} icons · 64×64 viewBox · stroke 4.66 · currentColor
  Every file was checked for viewBox, hardcoded colour, transforms, groups,
  gradients and <text> before this was written.
  -------------------------------------------------------------------------- */

export const ICON_PATH_DATA = {
${body}
}

export const ICON_NAMES = Object.keys(ICON_PATH_DATA)
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, out)
console.log(`\n  ✓ Wrote ${OUT}`)
console.log(`    ${names.length} icons, ${(out.length / 1024).toFixed(1)} KB\n`)
