/*
  scripts/sync-pdf-worker.mjs
  --------------------------------------------------------------------------
  Copies pdf.js's worker out of node_modules and into public/, and records the
  version it came from.

      npm run pdf:worker      (also runs automatically on postinstall)

  WHY THE WORKER IS A FILE IN public/ AND NOT A BUNDLED IMPORT
  pdf.js does its parsing in a Web Worker. Every bundler has its own opinion
  about how to emit one, those opinions change between major versions, and
  getting it wrong produces a build that succeeds and an app that hangs on the
  first PDF with no error. Serving the worker as a plain static file sidesteps
  the entire category: `GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`
  is just a URL, and it works identically in dev, in a production build and on
  Vercel.

  WHY THE VERSION IS RECORDED
  The single most common pdf.js failure is an API/worker version mismatch —
  the app loads pdf.mjs at 5.4.149 from node_modules while public/ still holds
  a worker from whatever was installed months ago. pdf.js detects this and
  refuses to run, but only at runtime, on the first document someone opens.

  lib/pdfdoc.js reads public/pdf-worker-version.json and asserts it matches
  the API's own `version` before loading anything, so a drift is a clear error
  at startup instead of a mystery later. Regenerating is one command.
  -------------------------------------------------------------------------- */

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'node_modules', 'pdfjs-dist', 'package.json')
const PUBLIC = join(ROOT, 'public')

if (!existsSync(PKG)) {
  // postinstall runs in environments where the dep legitimately isn't there
  // yet (a fresh clone mid-install, CI installing in stages). Not an error.
  console.log('[pdf] pdfjs-dist not installed yet — skipping worker sync.')
  process.exit(0)
}

const { version } = JSON.parse(readFileSync(PKG, 'utf8'))

/* Minified. The worker is 1MB minified against 1.9MB unminified, it's never
   stepped through in a debugger, and it's downloaded by anyone who opens a
   PDF. There's no case for shipping the readable one. */
const SRC = join(ROOT, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
const DEST = join(PUBLIC, 'pdf.worker.min.mjs')

if (!existsSync(SRC)) {
  console.error(`[pdf] Expected worker at ${SRC} but it isn't there.`)
  console.error('[pdf] The pdfjs-dist install looks incomplete. Try: npm install pdfjs-dist --force')
  process.exit(1)
}

mkdirSync(PUBLIC, { recursive: true })
copyFileSync(SRC, DEST)

/* CMaps and the standard font data.

   Without cmaps, a document using a CJK encoding renders its text as blanks or
   mojibake — pdf.js needs the character maps to know what the bytes mean.
   Without the standard fonts, any PDF that references Helvetica or Times
   WITHOUT embedding it (extremely common, since the spec says a reader must
   already have the base 14) falls back to a substitute with different metrics,
   so the text renders at subtly wrong widths and every annotation position
   drawn against it is subtly wrong too.

   Together they're about 1.8MB of static files, fetched only for documents
   that actually need them. */
const EXTRAS = [
  ['cmaps', 'pdf-cmaps'],
  ['standard_fonts', 'pdf-fonts'],
]

let extraCount = 0
for (const [from, to] of EXTRAS) {
  const src = join(ROOT, 'node_modules', 'pdfjs-dist', from)
  if (!existsSync(src)) {
    console.warn(`[pdf] ${from}/ missing from pdfjs-dist — documents needing it may render blank text.`)
    continue
  }
  const dest = join(PUBLIC, to)
  rmSync(dest, { recursive: true, force: true })   // stale entries would shadow new ones
  cpSync(src, dest, { recursive: true })
  extraCount += readdirSync(dest).length
}

writeFileSync(
  join(PUBLIC, 'pdf-worker-version.json'),
  JSON.stringify({ version, syncedAt: new Date().toISOString() }, null, 2) + '\n'
)

const kb = (readFileSync(DEST).length / 1024).toFixed(0)
console.log(`[pdf] worker ${version} → public/pdf.worker.min.mjs (${kb} KB)`)
console.log(`[pdf] ${extraCount} cmap + font files → public/pdf-cmaps, public/pdf-fonts`)
