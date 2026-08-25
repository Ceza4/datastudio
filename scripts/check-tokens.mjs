#!/usr/bin/env node
/*
  scripts/check-tokens.mjs
  --------------------------------------------------------------------------
  The palette is declared twice, on purpose: once as CSS custom properties in
  app/globals.css (so :hover, ::before and [data-theme] can reach it) and once
  as a JS object in lib/theme.js (so inline styles can). Two declarations of
  one thing is a drift machine, and it had already drifted — `accentDim` was
  carrying four different values across the codebase, and three of them
  appeared nowhere in globals.css at all.

  This script is what makes the duplication safe. It parses both files and
  fails if a single value disagrees.

      npm run check:tokens

  It also enforces two rules the audit turned up:

    · every colour named in lib/theme.js exists in BOTH themes. A token defined
      only in the light block renders as `unset` in dark, which is how you get
      one theme's text on the other theme's ground.

    · nothing in globals.css hardcodes a hex where a token exists. The token
      file being the worst offender is not a good look.
  -------------------------------------------------------------------------- */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
const js = readFileSync(join(ROOT, 'lib/theme.js'), 'utf8')

let fail = 0
const bad = m => { console.error('  ✗ ' + m); fail++ }

/* ── parse the CSS ─────────────────────────────────────────────────────── */
function block(re) {
  const m = re.exec(css)
  if (!m) return null
  const out = {}
  for (const line of m[1].split('\n')) {
    const t = /^\s*(--ds-[a-z0-9-]+)\s*:\s*([^;]+);/.exec(line)
    if (t) out[t[1]] = t[2].trim().toLowerCase()
  }
  return out
}
const cssLight = block(/^:root\s*\{([\s\S]*?)^\}/m)
const cssDark = block(/^\[data-theme='dark'\]\s*\{([\s\S]*?)^\}/m)

if (!cssLight) bad('could not parse the :root block in globals.css')
if (!cssDark) bad("could not parse the [data-theme='dark'] block in globals.css")

/* ── parse the JS ──────────────────────────────────────────────────────── */
function jsBlock(name) {
  const m = new RegExp(`const ${name} = \\{([\\s\\S]*?)^\\}`, 'm').exec(js)
  if (!m) return null
  const out = {}
  for (const line of m[1].split('\n')) {
    const t = /^\s*([a-zA-Z0-9]+)\s*:\s*'([^']+)'/.exec(line)
    if (t) out[t[1]] = t[2].toLowerCase()
  }
  return out
}
const jsLight = jsBlock('LIGHT')
const jsDark = jsBlock('DARK')

if (!jsLight) bad('could not parse LIGHT in lib/theme.js')
if (!jsDark) bad('could not parse DARK in lib/theme.js')

/* camelCase in JS ⇄ kebab-case in CSS. Listed rather than derived so a typo
   surfaces as a missing mapping instead of silently checking nothing. */
const MAP = {
  base: '--ds-base', surface: '--ds-surface', raised: '--ds-raised',
  canvasBg: '--ds-canvas-bg', border: '--ds-border', borderDim: '--ds-border-dim',
  text: '--ds-text', text2: '--ds-text-2', text3: '--ds-text-3',
  accent: '--ds-accent', accentText: '--ds-accent-text', accentDim: '--ds-accent-dim',
  green: '--ds-green', red: '--ds-red', amber: '--ds-amber',
  greenBg: '--ds-green-bg', amberBg: '--ds-amber-bg', redBg: '--ds-red-bg',
}

if (cssLight && cssDark && jsLight && jsDark) {
  for (const [jsKey, cssKey] of Object.entries(MAP)) {
    for (const [theme, c, j] of [['light', cssLight, jsLight], ['dark', cssDark, jsDark]]) {
      const cv = c[cssKey], jv = j[jsKey]
      if (jv == null) { bad(`lib/theme.js ${theme.toUpperCase()} is missing "${jsKey}"`); continue }
      if (cv == null) { bad(`globals.css ${theme} block is missing ${cssKey} (lib/theme.js has ${jsKey}: ${jv})`); continue }
      if (cv !== jv) bad(`${cssKey} disagrees in ${theme}: css ${cv} vs js ${jv}`)
    }
  }

  /* Every token the light block declares must also exist in dark. A colour
     with no dark value falls back to the light one, which is exactly the bug
     that makes an artifact unreadable in one theme. */
  const COLOURISH = /^--ds-(base|surface|raised|canvas-bg|border|border-dim|text|text-2|text-3|accent|accent-text|accent-dim|green|red|amber|green-bg|amber-bg|red-bg|glass|shadow)/
  for (const k of Object.keys(cssLight)) {
    if (COLOURISH.test(k) && !(k in cssDark)) bad(`${k} is declared in :root but not in [data-theme='dark']`)
  }
}

/* ── globals.css must not hardcode what it already names ───────────────── */
const TOKENISED = new Set(Object.values(cssLight || {}).filter(v => /^#[0-9a-f]{6}$/.test(v)))
const rules = css.slice(css.indexOf('* {'))
for (const m of rules.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
  const hex = m[0].toLowerCase()
  if (TOKENISED.has(hex)) {
    const line = css.slice(0, css.indexOf(m[0], css.indexOf('* {'))).split('\n').length
    bad(`globals.css:${line} hardcodes ${hex}, which is already a token`)
  }
}

if (fail) {
  console.error(`\n  ${fail} token problem${fail > 1 ? 's' : ''}. globals.css and lib/theme.js must agree.\n`)
  process.exit(1)
}
console.log(`\n  ✓ ${Object.keys(MAP).length} colours agree across globals.css and lib/theme.js, in both themes\n`)
