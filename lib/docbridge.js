/*
  lib/docbridge.js
  --------------------------------------------------------------------------
  How the ribbon talks to ITS document.

  The ribbon (components/tools/DocumentRibbon.js) and the page
  (components/notebook/DocumentBlock.js) are siblings in the canvas, and
  several documents can be open at once. Commands that need the document's
  own machinery — its undo history, find bar, comments, footnotes, track
  changes — go through the API that document registers here under its block
  id. Plain character formatting still goes straight to the DOM selection.
  -------------------------------------------------------------------------- */

const apis = new Map()
const listeners = new Map()

export function registerDoc(id, api) {
  apis.set(id, api)
  notifyDoc(id)
  return () => { if (apis.get(id) === api) apis.delete(id); notifyDoc(id) }
}

export function docApi(id) { return apis.get(id) || null }

/* The browser test harness drives documents through this. */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') window.__dsDocApi = docApi

/** Run a command on a document; false when it is not mounted. */
export function runDoc(id, cmd, arg) {
  const a = apis.get(id)
  if (!a) return false
  a.run(cmd, arg)
  return true
}

/** The ribbon re-renders when the document's state it shows (undo
 *  availability, tracking on, painter armed) changes. */
export function subscribeDoc(id, fn) {
  if (!listeners.has(id)) listeners.set(id, new Set())
  listeners.get(id).add(fn)
  return () => listeners.get(id)?.delete(fn)
}

export function notifyDoc(id) {
  listeners.get(id)?.forEach(fn => { try { fn() } catch { /* a listener's bug is not the document's */ } })
}
