#!/usr/bin/env node
/*
  scripts/check-scale.mjs
  --------------------------------------------------------------------------
  The sibling of check-tokens.mjs. That one keeps the PALETTE from drifting;
  this one keeps the SCALE from drifting.

  WHY IT EXISTS

  The app is styled with inline objects, so there is nothing structural stopping
  a call site from typing `fontSize: 10.5` — and by September 2026 the tree held
  24 distinct font sizes against a scale that defined 5, 142 of them fractional,
  and 62 under 11px. 130 icons were rendered at sizes between 9 and 40 from a
  set of 5. Border radii ran 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20.

  None of that was a decision anyone made. It accumulated one plausible-looking
  number at a time, and it is exactly what "the UI feels slightly off and I
  can't say why" is made of. A linter is the only thing that holds a scale in a
  codebase with no stylesheet to put it in.

  WHAT IT ENFORCES

    1  font sizes come from the scale: 11 12 13 14 16 20 (+ the three display
       sizes on the landing page)
    2  no fractional font size, ever — a half pixel cannot land on the pixel
       grid, and the grey fringe that results is the "blurry text" complaint
    3  icons render at 12 14 16 20 32 40 only, via <Icon size=…>
    4  border radii come from 4 6 8 10 12 16
    5  nothing hardcodes a font family outside globals.css — with one
       documented exception, PdfAnnotationLayer.js, where the on-screen text
       MUST match the Helvetica pdf-lib embeds on export

  Failing this is not a style nit. Every rule here maps to something a user
  reported seeing.

      npm run check:scale
  -------------------------------------------------------------------------- */

import { readdirSync, readFileSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, relative } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const FONT_SIZES  = new Set([11, 12, 13, 14, 16, 20, 24, 28, 30])
const ICON_SIZES  = new Set([12, 14, 16, 20, 32, 40])
const RADII       = new Set([4, 6, 8, 10, 12, 16])

/* The only file allowed to name a font family directly. See its comment. */
const FONT_FAMILY_EXEMPT = new Set(['components/notebook/PdfAnnotationLayer.js'])

let fail = 0
const bad = (file, line, msg) => {
  console.error(`  ✗ ${file}:${line}  ${msg}`)
  fail++
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.js') && name !== 'icon-paths.js') out.push(full)
  }
  return out
}

const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]

for (const full of files) {
  const rel = relative(ROOT, full).replace(/\\/g, '/')
  const src = readFileSync(full, 'utf8')
  const lines = src.split('\n')

  lines.forEach((line, i) => {
    const n = i + 1

    /* 1 + 2 — font size */
    for (const m of line.matchAll(/fontSize: (\d+(?:\.\d+)?)/g)) {
      const v = Number(m[1])
      if (!Number.isInteger(v)) {
        bad(rel, n, `fontSize: ${m[1]} is fractional — it cannot land on the pixel grid`)
      } else if (!FONT_SIZES.has(v)) {
        bad(rel, n, `fontSize: ${v} is off the scale (11 12 13 14 16 20)`)
      }
    }

    /* 4 — radius */
    for (const m of line.matchAll(/borderRadius: (\d+)(?![\d.%])/g)) {
      const v = Number(m[1])
      if (!RADII.has(v)) bad(rel, n, `borderRadius: ${v} is off the scale (4 6 8 10 12 16)`)
    }

    /* 5 — font family */
    /* A template literal that interpolates is a font PICKER rendering each
       choice in its own face (TextBlockToolbar, DocumentRibbon) — dynamic by
       definition, and not a hardcoded family. Only fixed strings are caught. */
    for (const m of line.matchAll(/fontFamily: (['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const value = m[2]
      if (value.includes('${')) continue
      if (value.startsWith('var(--ds-font')) continue
      if (FONT_FAMILY_EXEMPT.has(rel)) continue
      bad(rel, n, `hardcoded font family "${value}" — use var(--ds-font-body|head|mono)`)
    }
  })

  /* 3 — icon size, across the whole tag so multi-line <Icon …> is covered */
  for (const tag of src.matchAll(/<Icon\b[^>]*?\/?>/gs)) {
    const m = /size=\{(\d+)\}/.exec(tag[0])
    if (!m) continue
    const v = Number(m[1])
    if (!ICON_SIZES.has(v)) {
      const n = src.slice(0, tag.index).split('\n').length
      bad(rel, n, `<Icon size={${v}}> is off the scale (12 14 16 20 32 40) — prefer the SIZES tokens`)
    }
  }
}

if (fail) {
  console.error(`\n  ${fail} scale violation${fail === 1 ? '' : 's'}.`)
  console.error('  The scale is documented in app/globals.css under "Type scale".\n')
  process.exit(1)
}
console.log(`  ✓ scale clean across ${files.length} files`)
