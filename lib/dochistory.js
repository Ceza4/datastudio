/*
  lib/dochistory.js
  --------------------------------------------------------------------------
  THE DOCUMENT'S OWN UNDO. Chrome's contentEditable undo only knows about
  execCommand edits; everything the ribbon does by writing the DOM directly
  (a font size on a selection, an indent, alignment, a comment, a tracked
  deletion, pagination's own moves) was invisible to it, so Ctrl+Z skipped
  them or, worse, undid the wrong thing.

  So the document keeps snapshots: the editor's HTML and the selection as a
  position that survives re-rendering (see docedit's selectionIndex). Typing
  is grouped the way Word groups it — one undo step per burst, broken by a
  pause, by switching between typing and deleting, and by Enter — and every
  command is a step of its own.
  -------------------------------------------------------------------------- */

const GROUP_MS = 900

export function createHistory({ limit = 300 } = {}) {
  let stack = []
  let index = -1
  let lastAt = 0
  let lastKind = null

  return {
    /** Start over from one state (a load, or content from sync). */
    reset(state) {
      stack = state ? [state] : []
      index = stack.length - 1
      lastKind = null
    },
    /**
     * Record the state AFTER an edit.
     * kind: 'type' | 'delete' | 'para' | 'cmd'
     */
    record(state, kind = 'cmd') {
      if (!state) return
      const top = stack[index]
      if (top && top.html === state.html) { top.sel = state.sel; return }
      const now = Date.now()
      const merge = (kind === 'type' || kind === 'delete') && kind === lastKind
        && now - lastAt < GROUP_MS && index === stack.length - 1 && index > 0
      if (merge) stack[index] = state
      else {
        stack = stack.slice(0, index + 1)
        stack.push(state)
        if (stack.length > limit) stack.shift()
        index = stack.length - 1
      }
      lastAt = now
      lastKind = kind === 'para' ? null : kind
    },
    /** Keep the selection of the current step up to date, so undo returns
     *  the caret to where it was when the step began. */
    touchSelection(sel) { if (stack[index]) stack[index].sel = sel },
    undo() {
      if (index <= 0) return null
      index -= 1
      lastKind = null
      return stack[index]
    },
    redo() {
      if (index >= stack.length - 1) return null
      index += 1
      lastKind = null
      return stack[index]
    },
    canUndo: () => index > 0,
    canRedo: () => index < stack.length - 1,
    get size() { return stack.length },
  }
}

/** How an input event groups: Word breaks a typing burst on Enter and when
 *  you switch between typing and deleting. */
export function inputKind(inputType) {
  if (!inputType) return 'cmd'
  if (inputType === 'insertText' || inputType === 'insertCompositionText' || inputType === 'insertReplacementText') return 'type'
  if (inputType.startsWith('delete')) return 'delete'
  if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') return 'para'
  return 'cmd'
}
