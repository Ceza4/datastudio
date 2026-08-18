/*
  lib/pdfdoc.js
  --------------------------------------------------------------------------
  The ONLY module that talks to pdf.js.

  WHY IT'S ISOLATED
  Everything else in the PDF feature — coordinates, storage, validation, the
  overlay model, the block chrome — is plain logic that runs and is tested in
  Node. pdf.js is not: it needs a browser, a Web Worker and WASM, and it
  cannot be executed in the environment this was written in.

  So the unverifiable surface is deliberately confined to this one file, kept
  as small as it can be, and given a boring API. If PDFs don't render, the bug
  is in here or in the worker file, and nowhere else.

  DYNAMIC IMPORT, ALWAYS
  pdf.js is roughly 700KB of JavaScript before the worker. A static import
  would put all of it in the first-load bundle of an app most of whose users
  will never open a PDF. `await import()` means it's fetched the first time
  someone actually does, and never otherwise.

  THE WORKER IS A STATIC FILE
  See scripts/sync-pdf-worker.mjs. Bundler-emitted workers are the classic
  source of "builds fine, hangs at runtime"; a plain URL is not.
  -------------------------------------------------------------------------- */

import { makeViewport } from './pdfspace.js'

const WORKER_URL = '/pdf.worker.min.mjs'
const VERSION_URL = '/pdf-worker-version.json'

let libPromise = null
let verifiedVersion = null

/**
 * Load pdf.js once and configure the worker.
 * Concurrent callers share one promise — three PDF blocks mounting together
 * must not each fetch 700KB.
 */
export function loadPdfjs() {
  if (libPromise) return libPromise
  libPromise = (async () => {
    const pdfjs = await import(/* webpackChunkName: "pdfjs" */ 'pdfjs-dist/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL

    /* Version drift between the API and the worker is pdf.js's most common
       failure, and it surfaces as a confusing error on the first document
       rather than at startup. Checking it here turns it into one clear
       message, once, naming the exact fix. Non-fatal: a missing version file
       shouldn't stop a correctly-installed app from working. */
    try {
      const res = await fetch(VERSION_URL, { cache: 'no-store' })
      if (res.ok) {
        const { version } = await res.json()
        verifiedVersion = version
        if (version && pdfjs.version && version !== pdfjs.version) {
          console.error(
            `[DataStudio] pdf.js version mismatch — the app is running ${pdfjs.version} ` +
            `but public/pdf.worker.min.mjs is ${version}. Run \`npm run pdf:worker\` to resync.`
          )
        }
      }
    } catch { /* offline, or the file isn't there yet — not fatal */ }

    return pdfjs
  })()
  return libPromise
}

export const workerVersion = () => verifiedVersion

/**
 * Open a document from bytes.
 *
 * The array is COPIED before being handed over. pdf.js transfers the buffer to
 * its worker, which detaches it — and the same bytes are the record in
 * IndexedDB and the source for export. Handing it the original turns those
 * into a zero-length array with no error, and the document silently becomes
 * unexportable. This one line is easy to remove during a cleanup and very
 * unpleasant to debug afterwards.
 */
export async function openDocument(bytes, { password } = {}) {
  const pdfjs = await loadPdfjs()
  const copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes)

  const task = pdfjs.getDocument({
    data: copy,
    password,
    // Never evaluate JavaScript embedded in a document.
    isEvalSupported: false,
    // Don't let a document reach the network for fonts or images.
    disableAutoFetch: true,
    useWorkerFetch: false,
    // Standard fonts and cmaps ship with the package; point at them so a
    // document using a non-embedded font still renders with correct metrics.
    cMapUrl: '/pdf-cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdf-fonts/',
  })

  try {
    return await task.promise
  } catch (err) {
    throw translateError(err)
  }
}

/** pdf.js errors are named types with terse messages. Turn them into English. */
export function translateError(err) {
  const name = err?.name || ''
  const msg = String(err?.message || err || '')

  if (name === 'PasswordException' || /password/i.test(msg)) {
    return Object.assign(new Error('This PDF is password-protected. DataStudio can’t open encrypted documents yet.'), { code: 'password' })
  }
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(msg)) {
    return Object.assign(new Error('This file is damaged and can’t be read. If it opens elsewhere, try re-saving it and importing again.'), { code: 'invalid' })
  }
  if (name === 'MissingPDFException' || /missing/i.test(msg)) {
    return Object.assign(new Error('The document data couldn’t be found. It may have been cleared from storage.'), { code: 'missing' })
  }
  if (/worker/i.test(msg)) {
    return Object.assign(new Error('The PDF engine failed to start. Run `npm run pdf:worker` and reload.'), { code: 'worker' })
  }
  return Object.assign(new Error(`This PDF couldn’t be opened: ${msg || 'unknown error'}`), { code: 'unknown' })
}

/**
 * Page geometry, using OUR viewport rather than pdf.js's.
 *
 * page.getViewport() would return the same numbers — makeViewport is a port of
 * it. Going through ours means one implementation is used for rendering AND
 * for every annotation coordinate, so they cannot drift apart, and it's the
 * one that has unit tests.
 */
export async function pageGeometry(doc, pageNumber, scale = 1) {
  const page = await doc.getPage(pageNumber)
  const viewBox = page.view                      // [x0, y0, x1, y1]
  const rotation = page.rotate || 0
  const userUnit = page.userUnit || 1
  return { page, viewBox, rotation, userUnit, viewport: makeViewport({ viewBox, scale, rotation, userUnit }) }
}

/**
 * Render one page into a canvas.
 * Returns the RenderTask so a caller can cancel it — scrolling fast through a
 * long document starts renders faster than they finish, and an uncancelled
 * one keeps painting into a canvas that's already been reused for another
 * page, which shows up as pages flickering into each other.
 */
export function renderPage(page, canvas, viewport, dpr = 1) {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not get a 2D context — the canvas may be too large.')

  /* pdf.js scales via the transform rather than by re-deriving the viewport,
     so the CSS size and the backing-store size stay independent. */
  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null

  return page.render({
    canvasContext: ctx,
    viewport,
    transform,
    background: '#ffffff',
  })
}

/**
 * Every text run on a page, with position, in PDF space.
 * Used by the text layer (so selection and browser find work) and later by
 * extraction. `str` can legitimately be empty — those items carry line breaks.
 */
export async function pageTextItems(doc, pageNumber) {
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent()
  return (content.items || []).map(it => ({
    str: it.str ?? '',
    transform: it.transform,
    width: it.width,
    height: it.height,
    fontName: it.fontName,
    hasEOL: !!it.hasEOL,
  }))
}

/** Title, author and page count, for the block header. */
export async function documentInfo(doc) {
  try {
    const meta = await doc.getMetadata()
    return {
      title: meta?.info?.Title || null,
      author: meta?.info?.Author || null,
      pages: doc.numPages,
      producer: meta?.info?.Producer || null,
    }
  } catch {
    return { title: null, author: null, pages: doc?.numPages || 0, producer: null }
  }
}

/**
 * Close a document and free its worker resources.
 * Not optional: every open document holds a worker port, and a workspace where
 * PDF blocks have been opened and closed a few dozen times will exhaust them
 * and start failing to open anything.
 */
export async function closeDocument(doc) {
  try { await doc?.cleanup?.() } catch { /* already gone */ }
  try { await doc?.destroy?.() } catch { /* already gone */ }
}
