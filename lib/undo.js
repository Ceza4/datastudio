/*
  lib/undo.js
  --------------------------------------------------------------------------
  The workspace undo stack.

  WHY THERE WASN'T ONE

  Ctrl+Z called undoLastDrawing() and nothing else. Deletion recovery was
  genuinely good — twelve separate paths offered an undo toast — but move,
  resize, rename, reorder and re-parent had nothing at all, and the toast
  expires after seven seconds. The code was honest about the trade-off:
  binding Ctrl+Z to "whatever changed last" without a real stack behind it
  would look like an undo system and quietly delete things nobody meant to
  remove.

  That reasoning was right. This is the stack that makes the binding safe.

  WHY WHOLE-STATE SNAPSHOTS ARE CHEAP HERE

  Every mutation in app/app/page.js is immutable — `{ ...block, ...patch }`
  inside `notebooks.map(...)`. So two consecutive versions of the workspace
  share every object that did not change, and holding a reference to the
  previous `notebooks` array costs one spine of shallow copies rather than a
  copy of the data. A hundred entries is a hundred spines.

  That is what makes the effect-based capture in AppPage possible: nothing has
  to describe its own inverse, so no mutator can be added later that silently
  is not undoable. The whole class of "we forgot to make that one undoable"
  bugs does not exist.

  WHAT COALESCING IS FOR

  A text block saves on a 300ms debounce while you type. Without coalescing,
  a paragraph is fifty undo entries and Ctrl+Z becomes useless — you press it
  eleven times to get back to before the sentence. Consecutive entries with
  the same label, close together in time, merge into one: the OLDEST `before`
  and the NEWEST `after`, so undoing takes you to before you started typing.
  -------------------------------------------------------------------------- */

/** How long two same-label edits can be apart and still count as one action. */
export const COALESCE_MS = 700

/** Entries kept. Beyond this the oldest is dropped, oldest-first. */
export const HISTORY_LIMIT = 100

export function emptyHistory(limit = HISTORY_LIMIT) {
  return { past: [], future: [], limit }
}

/**
 * Should these two edits be treated as one?
 *
 * Same label, close in time, and the labels must be one of the CONTINUOUS
 * kinds — typing and dragging produce a stream, whereas two deletions a
 * quarter of a second apart are two deletions and must undo separately.
 */
const CONTINUOUS = new Set(['edit text', 'move', 'resize', 'rename', 'draw'])

export function shouldCoalesce(prev, next) {
  if (!prev || !next) return false
  if (prev.label !== next.label) return false
  if (!CONTINUOUS.has(next.label)) return false
  if (prev.nbId !== next.nbId) return false
  return next.at - prev.at <= COALESCE_MS
}

/**
 * Record an edit.
 *
 * An entry is `{ before, after, activeBefore, activeAfter, label, at, nbId }`.
 * before/after are whole `notebooks` references; activeBefore/activeAfter are
 * the id of the notebook that was open on each side of the change.
 *
 * THE ACTIVE ID IS PART OF THE STATE, and leaving it out was a real bug rather
 * than an omission. Deleting your last notebook creates a stand-in and switches
 * to it; restoring only `notebooks` then left activeNotebookId pointing at a
 * stand-in that no longer existed, and the canvas rendered nothing at all. It
 * also matters for the ordinary case: undoing a change made in another notebook
 * should take you to where the change was, not silently alter a document you
 * cannot see.
 *
 * Returns a NEW history — nothing here mutates.
 */
export function record(h, entry) {
  const last = h.past[h.past.length - 1]
  if (shouldCoalesce(last, entry)) {
    /* Keep the OLDEST before and the NEWEST after: one undo returns to the
       state before the run of edits began, which is what a person means when
       they undo a sentence they just typed. */
    const merged = { ...entry, before: last.before, activeBefore: last.activeBefore, at: entry.at }
    return { ...h, past: [...h.past.slice(0, -1), merged], future: [] }
  }
  const past = [...h.past, entry]
  /* Any new edit invalidates the redo branch. This is the standard linear
     model — it is what every editor does, and the alternative (a tree) is a
     feature nobody asked for. */
  return { ...h, past: past.length > h.limit ? past.slice(past.length - h.limit) : past, future: [] }
}

/**
 * Step back one edit.
 * @returns {{history:object, state:any, label:string}|null} null when there is
 *          nothing to undo — callers use that to decide whether to say so.
 */
export function undo(h) {
  if (!h.past.length) return null
  const entry = h.past[h.past.length - 1]
  return {
    history: { ...h, past: h.past.slice(0, -1), future: [...h.future, entry] },
    state: entry.before,
    activeId: entry.activeBefore,
    label: entry.label,
  }
}

/** Step forward one edit. */
export function redo(h) {
  if (!h.future.length) return null
  const entry = h.future[h.future.length - 1]
  return {
    history: { ...h, past: [...h.past, entry], future: h.future.slice(0, -1) },
    state: entry.after,
    activeId: entry.activeAfter,
    label: entry.label,
  }
}

export const canUndo = h => h.past.length > 0
export const canRedo = h => h.future.length > 0

/** What the next Ctrl+Z would reverse, for a menu label or a toast. */
export const nextUndoLabel = h => (h.past.length ? h.past[h.past.length - 1].label : null)
export const nextRedoLabel = h => (h.future.length ? h.future[h.future.length - 1].label : null)
