/*
  lib/pdfedits.js
  --------------------------------------------------------------------------
  Undo and redo for the PDF overlay.

  WHY A SNAPSHOT STACK AND NOT INVERSE COMMANDS
  The textbook version stores each operation with its inverse — add/remove,
  move/move-back. It's memory-efficient and it's the wrong choice here.

  Every inverse has to be written correctly, and a single wrong one corrupts
  the document silently and permanently: you undo, the state is subtly wrong,
  you keep working, and by the time anyone notices there's nothing to go back
  to. An overlay is a small array of small plain objects — a hundred
  annotations is a few KB — so snapshotting the whole thing after each change
  costs almost nothing and cannot be implemented incorrectly. Undo becomes an
  array index.

  This is the same trade as storing the original bytes immutably, for the same
  reason: correctness that's structural rather than earned.

  THE STACK IS NOT PERSISTED
  Only the current overlay is written to IndexedDB. Reopening a document gives
  you your annotations with an empty history, which is what every document
  editor does — and it avoids the question of what undo means after the
  underlying file has changed.
  -------------------------------------------------------------------------- */

/* Deep enough for a working session, shallow enough that the memory is
   irrelevant. Fifty snapshots of a hundred annotations is well under a
   megabyte. */
export const HISTORY_LIMIT = 50

/** A fresh history holding one state: the overlay as loaded. */
export function createHistory(initial = []) {
  return { stack: [clone(initial)], index: 0 }
}

const clone = edits => (Array.isArray(edits) ? edits.map(e => ({ ...e })) : [])

/** The overlay as it stands. Never returns the internal array. */
export const current = h => clone(h?.stack?.[h.index] ?? [])

export const canUndo = h => !!h && h.index > 0
export const canRedo = h => !!h && h.index < h.stack.length - 1

/**
 * Record a new state.
 *
 * Anything ahead of the cursor is discarded — the standard branch-pruning
 * behaviour. Editing after undoing abandons the redo path, because keeping it
 * would mean a tree, and a tree needs a UI nobody wants in a PDF viewer.
 */
export function commit(h, edits) {
  const base = h?.stack?.slice(0, (h.index ?? 0) + 1) ?? [[]]
  base.push(clone(edits))
  // Trim from the front once the cap is reached, so the oldest state goes.
  const overflow = Math.max(0, base.length - HISTORY_LIMIT)
  const stack = overflow ? base.slice(overflow) : base
  return { stack, index: stack.length - 1 }
}

export const undo = h => (canUndo(h) ? { ...h, index: h.index - 1 } : h)
export const redo = h => (canRedo(h) ? { ...h, index: h.index + 1 } : h)

/* ── operations ──────────────────────────────────────────────────────
   Each returns a NEW array. They never mutate, so a caller holding the
   previous state — which is exactly what the history stack is — keeps it
   intact. */

export const addEdit = (edits, edit) => [...(edits || []), edit]

export function updateEdit(edits, id, patch) {
  return (edits || []).map(e => (e.id === id ? { ...e, ...patch, id: e.id } : e))
}

export const removeEdit = (edits, id) => (edits || []).filter(e => e.id !== id)

export const removeEditsOnPage = (edits, page) => (edits || []).filter(e => e.page !== page)

/**
 * Move an entry to the end, so it paints last.
 * The overlay has no explicit z-order: entries paint in array order, which
 * keeps the data model as small as it can be. "Bring to front" is therefore
 * "move to the end", and there's no second ordering field to keep in sync.
 */
export function bringToFront(edits, id) {
  const list = edits || []
  const found = list.find(e => e.id === id)
  return found ? [...list.filter(e => e.id !== id), found] : list
}

/** Which entry is under a point, topmost first. Used for select and delete. */
export function hitTest(edits, page, point, pad = 2) {
  const onPage = (edits || []).filter(e => e.page === page && e.rect)
  for (let i = onPage.length - 1; i >= 0; i--) {
    const { rect } = onPage[i]
    if (point.x >= rect.x - pad && point.x <= rect.x + rect.w + pad &&
        point.y >= rect.y - pad && point.y <= rect.y + rect.h + pad) {
      return onPage[i]
    }
  }
  return null
}

/** A one-line summary of what's been changed, for the rail. */
export function describeEdits(edits) {
  const list = edits || []
  if (!list.length) return 'No edits'
  const counts = {}
  for (const e of list) counts[e.kind] = (counts[e.kind] || 0) + 1
  const names = { text: 'text', whiteout: 'white-out', highlight: 'highlight', ink: 'drawing', image: 'image', replace: 'text edit' }
  return Object.entries(counts)
    .map(([k, n]) => `${n} ${names[k] || k}${n > 1 ? 's' : ''}`)
    .join(' · ')
}
