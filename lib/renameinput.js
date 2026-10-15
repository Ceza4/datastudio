/*
  lib/renameinput.js
  --------------------------------------------------------------------------
  The three rules every "rename in place" field follows. (Audit DEF-007/009,
  16 Oct 2026.)

  NINE FIELDS HAD THE SAME TWO BUGS, copied from one to the next:

    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}

  and an onBlur that commits. So Escape SAVED whatever had been typed — the
  one key whose whole meaning is "never mind" — on the project, sheet, folder,
  block, section, column-group and task titles, in the sidebar and on the
  canvas. And none of them selected their text on focus, so creating a folder
  and typing its name produced "New FolderClients".

  The rules:
    · Enter commits (blur, and the existing onBlur does the saving).
    · Escape cancels: the field is marked, then blurred; onBlur sees the mark
      and closes without saving. The press stops here, so it does not also
      deselect the block or leave full screen behind the field.
    · Focus selects the current name, so typing replaces it — what Finder,
      Explorer and every tab strip do.

  A field that writes on every keystroke (BlockHandle) hands its own onCancel
  to put the original back.
  -------------------------------------------------------------------------- */

const MARK = 'dsRenameCancel'

/** onKeyDown for a commit-on-blur rename field. */
export function renameKeyDown(onCancel) {
  return e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.dataset[MARK] = '1'
      onCancel?.()
      e.currentTarget.blur()
    }
  }
}

/** True inside onBlur when the blur came from Escape. Clears the mark. */
export function renameCancelled(e) {
  const el = e?.currentTarget || e?.target
  if (!el?.dataset?.[MARK]) return false
  delete el.dataset[MARK]
  return true
}

/** onFocus: select the whole name, so typing replaces it. */
export function selectAllOnFocus(e) {
  try { e.currentTarget.select() } catch { /* not a text input */ }
}
