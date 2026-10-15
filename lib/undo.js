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

/* ── UNDO REVERTS ITS OWN EDIT, NOT EVERYTHING SINCE ──────────────────────
   (16 Oct 2026, audit DEF-003.)

   undo() used to return `entry.before` and the caller replaced the whole
   workspace with it. Locally that is exact — the current state IS the top
   entry's `after`, by construction. But a sync pull is deliberately NOT
   recorded (see applyRemoteRows in app/app/page.js), so once another device's
   edit had been pulled, the current state was `after` PLUS that edit, and
   restoring `before` wiped it. Reproduced end to end with two devices: A
   pulls B's new block, A presses Ctrl+Z once to undo A's own typing, and B's
   block disappears from A — then A's push overwrites it on the server too.
   One key, someone else's work gone everywhere.

   Now the entry's own change is reverted ONTO the current state:

     · current === after (nothing happened since — the normal, local case):
       return `before` exactly, so behaviour there is byte-for-byte unchanged;
     · otherwise walk the three versions together. Objects merge key by key,
       arrays of things with an `id` merge by id (an item the entry added is
       removed, one it deleted is put back next to its old neighbour, one it
       changed is recursed into), equal-length arrays merge position by
       position (table rows and cells), and anything else changed since by
       somebody else is LEFT ALONE — a later edit wins over an undo, because
       the alternative is the bug above.

   A pull replaces documents with freshly parsed copies, so references are
   never trusted to mean "changed": leaves are compared by value. */

const isPlainObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isKeyed = a => Array.isArray(a) && a.every(x => isPlainObj(x) && x.id != null)

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false
  return true
}

function revertKeyed(cur, before, after) {
  const B = new Map(before.map(x => [x.id, x]))
  const A = new Map(after.map(x => [x.id, x]))
  let changed = false
  const out = []
  for (const c of cur) {
    const inA = A.has(c.id), inB = B.has(c.id)
    if (inA && !inB) {
      /* Added by this entry. Removed — unless someone has since changed it,
         in which case it is no longer only ours to take away. */
      if (deepEqual(c, A.get(c.id))) { changed = true; continue }
      out.push(c); continue
    }
    if (inA && inB) {
      const n = revertChange(c, B.get(c.id), A.get(c.id))
      if (n !== c) changed = true
      out.push(n); continue
    }
    out.push(c)
  }
  /* Deleted by this entry: back in, after whichever earlier neighbour still
     exists, so a restored block keeps its stacking order. */
  const present = new Set(out.map(x => x.id))
  before.forEach((b, i) => {
    if (A.has(b.id) || present.has(b.id)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex(x => x.id === before[j].id)
      if (k >= 0) { at = k + 1; break }
    }
    out.splice(at, 0, b)
    present.add(b.id)
    changed = true
  })
  /* A pure reorder by this entry (sheet tabs, bring-to-front): if the shared
     items still sit in the order the entry left them, put them back in the
     order it found them, without disturbing anything else's slot. */
  const common = before.filter(b => A.has(b.id)).map(b => b.id)
  const afterOrder = after.filter(a => B.has(a.id)).map(a => a.id)
  if (common.join('\u0000') !== afterOrder.join('\u0000')) {
    const slots = [], ids = []
    out.forEach((x, k) => { if (B.has(x.id) && A.has(x.id)) { slots.push(k); ids.push(x.id) } })
    if (ids.join('\u0000') === afterOrder.join('\u0000')) {
      const byId = new Map(out.map(x => [x.id, x]))
      common.forEach((id, k) => { out[slots[k]] = byId.get(id) })
      changed = true
    }
  }
  return changed ? out : cur
}

/**
 * Undo the change `before → after` on top of `cur`, keeping everything else
 * `cur` has gained since. With `cur === after` this is just `before`.
 */
export function revertChange(cur, before, after) {
  if (Object.is(cur, after)) return before
  if (Object.is(before, after)) return cur
  if (cur === undefined) return cur
  if (isPlainObj(cur) && isPlainObj(before) && isPlainObj(after)) {
    if (deepEqual(cur, after)) return before
    let out = null
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const k of keys) {
      const b = before[k], a = after[k]
      if (Object.is(b, a)) continue
      const hadB = Object.prototype.hasOwnProperty.call(before, k)
      const hadA = Object.prototype.hasOwnProperty.call(after, k)
      const hasC = Object.prototype.hasOwnProperty.call(cur, k)
      if (!hadB) {                      // the entry added this key
        if (hasC && deepEqual(cur[k], a)) { out ??= { ...cur }; delete out[k] }
        continue
      }
      if (!hasC) {
        if (!hadA) { out ??= { ...cur }; out[k] = b }   // the entry removed it: restore
        continue                                         // removed since by someone else
      }
      const next = revertChange(cur[k], b, hadA ? a : undefined)
      if (!Object.is(next, cur[k])) { out ??= { ...cur }; out[k] = next }
    }
    return out ?? cur
  }
  if (isKeyed(cur) && isKeyed(before) && isKeyed(after)) return revertKeyed(cur, before, after)
  /* Position by position when this entry did not change the length — a cell
     edit. `cur` may have grown since (someone typed past the last column, or
     appended rows, and the table padded every row to match): the tail is
     theirs and is kept as it is. */
  if (Array.isArray(cur) && Array.isArray(before) && Array.isArray(after)
      && before.length === after.length && cur.length >= after.length) {
    if (deepEqual(cur, after)) return before
    let out = null
    for (let i = 0; i < after.length; i++) {
      const n = revertChange(cur[i], before[i], after[i])
      if (!Object.is(n, cur[i])) { out ??= cur.slice(); out[i] = n }
    }
    return out ?? cur
  }
  if (deepEqual(cur, after)) return before
  return cur          // changed since by someone else: a later edit wins
}

/**
 * Step back one edit.
 *
 * `current` is the workspace as it is NOW. Pass it: without it the old
 * whole-snapshot behaviour applies, which is only right when nothing outside
 * the history (a sync pull) has touched the workspace since.
 *
 * @returns {{history:object, state:any, label:string}|null} null when there is
 *          nothing to undo — callers use that to decide whether to say so.
 */
export function undo(h, current) {
  if (!h.past.length) return null
  const entry = h.past[h.past.length - 1]
  return {
    history: { ...h, past: h.past.slice(0, -1), future: [...h.future, entry] },
    state: current === undefined ? entry.before : revertChange(current, entry.before, entry.after),
    activeId: entry.activeBefore,
    label: entry.label,
    entry,
  }
}

/** Step forward one edit. Same `current` contract as undo(). */
export function redo(h, current) {
  if (!h.future.length) return null
  const entry = h.future[h.future.length - 1]
  return {
    history: { ...h, past: [...h.past, entry], future: h.future.slice(0, -1) },
    state: current === undefined ? entry.after : revertChange(current, entry.after, entry.before),
    activeId: entry.activeAfter,
    label: entry.label,
    entry,
  }
}

/* ── WHERE YOU ARE IS NOT SOMETHING YOU DID (audit DEF-010) ──────────────
   A sheet's `activeSheetId` lives inside its notebook, so clicking another
   sheet minted a new `notebooks` and the capture recorded it as an "edit".
   Ctrl+Z after looking at Sheet 2 then took you back to Sheet 1 ("Undid
   edit") instead of undoing your last change, and a second press bounced
   you to Sheet 2 again. Navigation is now left out of the history, and an
   undo instead TAKES you to the sheet its change was on (sheetTouched), so
   nothing is ever undone out of sight. */

/** True when `next` differs from `prev` only in which sheet is open. */
export function isNavigationOnly(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false
  let moved = false
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i], b = next[i]
    if (a === b) continue
    if (!a || !b || a.id !== b.id) return false
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if (k === 'activeSheetId') { if (a[k] !== b[k]) moved = true; continue }
      if (!Object.is(a[k], b[k])) return false
    }
  }
  return moved
}

/** The id of the first sheet of notebook `nbId` that `before → after` changed. */
export function sheetTouched(before, after, nbId) {
  const nb0 = Array.isArray(before) ? before.find(n => n.id === nbId) : null
  const nb1 = Array.isArray(after) ? after.find(n => n.id === nbId) : null
  if (!nb0 || !nb1 || nb0 === nb1) return null
  const s0 = new Map((nb0.sheets || []).map(s => [s.id, s]))
  for (const s of nb1.sheets || []) if (s0.get(s.id) !== s) return s.id
  for (const s of nb0.sheets || []) if (!(nb1.sheets || []).some(x => x.id === s.id)) return s.id
  return null
}

export const canUndo = h => h.past.length > 0
export const canRedo = h => h.future.length > 0

/** What the next Ctrl+Z would reverse, for a menu label or a toast. */
export const nextUndoLabel = h => (h.past.length ? h.past[h.past.length - 1].label : null)
export const nextRedoLabel = h => (h.future.length ? h.future[h.future.length - 1].label : null)
