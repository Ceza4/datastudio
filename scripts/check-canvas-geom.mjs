/*
  scripts/check-canvas-geom.mjs
  --------------------------------------------------------------------------
  Guards against the coordinate bug that was reported twice.

      npm run check:geom

  THE RULE
  Components rendered INSIDE the canvas's `transform: translate() scale()`
  must not:

    · use `position: fixed` without a portal — a transformed ancestor becomes
      the containing block for fixed descendants, so the element is positioned
      against the canvas and then scaled, not against the viewport; and

    · derive pointer coordinates from getBoundingClientRect() without
      correcting for scale — that rect is the VISUALLY scaled box, so
      `clientX - rect.left` yields screen pixels where layout pixels are
      wanted.

  WHY A SCRIPT AND NOT JUST CARE
  Both mistakes look completely correct while reading, and both are invisible
  at 100% zoom — the broken and correct versions agree exactly there. They
  shipped in the sheet's context menu and in the PDF annotation layer, were
  reported as two unrelated bugs, and one was "fixed" without being
  understood. A rule this easy to reintroduce needs something that checks.
  -------------------------------------------------------------------------- */

import { readFileSync, readdirSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* Files rendered inside the transformed subtree. Kept explicit rather than
   inferred: an import graph would say NotebookCanvas renders everything, and
   the panels it renders ABOVE the transform are fine. */
const INSIDE_CANVAS = [
  'components/notebook/SheetGrid.js',
  'components/notebook/CalendarBlock.js',
  'components/notebook/DatabaseBlock.js',
  'components/notebook/TaskBlock.js',
  'components/notebook/KanbanBlock.js',
  'components/notebook/ImageBlock.js',
  'components/notebook/PdfBlock.js',
  'components/notebook/PdfAnnotationLayer.js',
  'components/notebook/TextBlockContent.js',
  'components/notebook/BlockHandle.js',
  'components/notebook/ResizeHandle.js',
  'components/notebook/BlockErrorBoundary.js',
]

/* Allowed to read a bounding rect without scale correction, with the reason.
   Anything not listed must go through lib/canvasgeom.js. */
const RECT_ALLOWED = {
  'components/notebook/TextBlockContent.js':
    'measures a Range for the slash menu, which is portalled and positioned in screen space',
  'components/notebook/DatabaseBlock.js':
    'anchorOf() measures a header/cell to place a PORTALLED menu, which lives in screen space too — the scaled rect is the correct one there. It does no pointer maths at all: the board reorders by HTML drag-and-drop, which reports targets rather than coordinates.',
}

let problems = 0

for (const rel of INSIDE_CANVAS) {
  let src
  try { src = readFileSync(join(ROOT, rel), 'utf8') } catch { continue }

  const hasFixed = /position:\s*['"]fixed['"]/.test(src)
  const hasPortal = /createPortal/.test(src)
  if (hasFixed && !hasPortal) {
    problems++
    console.log(`  ✗ ${rel}`)
    console.log('      uses position:fixed but never portals.')
    console.log('      Inside the canvas transform, fixed is positioned against the CANVAS,')
    console.log('      not the viewport — and then scaled. Portal it to document.body.\n')
  }

  const usesRect = /getBoundingClientRect\(\)/.test(src)
  const usesHelper = /from ['"](\.\.\/)+lib\/canvasgeom['"]/.test(src)
  if (usesRect && !usesHelper && !RECT_ALLOWED[rel]) {
    problems++
    console.log(`  ✗ ${rel}`)
    console.log('      calls getBoundingClientRect() without lib/canvasgeom.')
    console.log('      That rect is the VISUALLY SCALED box. For pointer maths use')
    console.log('      localPointFromEvent(); for measurement use localSize().\n')
  }
}

const files = []
;(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(e.name)) continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.jsx?$/.test(e.name)) files.push(p)
  }
})(join(ROOT, 'components'))

console.log(`\n  Checked ${INSIDE_CANVAS.length} in-canvas components (of ${files.length} total).`)
if (problems) {
  console.log(`\n  ✗ ${problems} problem(s). See lib/canvasgeom.js for the why.\n`)
  process.exit(1)
}
console.log('  ✓ no fixed-without-portal, no uncorrected rect maths.\n')
