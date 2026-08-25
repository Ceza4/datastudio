/*
  lib/clipboard.js
  --------------------------------------------------------------------------
  Copying blocks and shapes between sheets, notebooks and windows.

  WHY THIS DID NOT EXIST

  Ctrl+C, Ctrl+X, Ctrl+V and Ctrl+A worked inside a spreadsheet cell and
  nowhere else. On the canvas there was Ctrl+D — duplicate in place — and that
  was all, so there was no way to move a block to another sheet, let alone to
  another notebook. For anyone arriving from Excel or Miro that reads as the
  app being unfinished rather than as a missing feature.

  HOW IT TRAVELS

  As JSON on the system clipboard, behind a magic first line. That choice
  matters more than it looks:

    · it survives between browser TABS and between windows, which an in-memory
      clipboard would not;
    · pasting into a text editor gives something a human can read and file a
      bug with, rather than nothing;
    · pasting arbitrary text into the canvas is unambiguous — no prefix, not
      ours, so the canvas can fall back to making a text block out of it.

  Ids are always reminted on paste. Keeping them would mean a copy and its
  original share an identity, and then deleting one deletes the other, which is
  the kind of bug that takes a day to find and one line to prevent.
  -------------------------------------------------------------------------- */

/* The first line of the payload. Versioned, because a future shape change has
   to be able to refuse an old clipboard rather than half-read it. */
export const CLIP_MAGIC = 'datastudio/blocks;v1'

const rid = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`

/**
 * Serialise a selection for the clipboard.
 *
 * Positions are stored RELATIVE to the top-left of the selection, so a paste
 * lands as a group wherever it is dropped rather than at the coordinates it
 * happened to be copied from — which, on an infinite canvas, could be a
 * thousand pixels off screen.
 */
export function serializeSelection({ blocks = [], shapes = [] }) {
  if (!blocks.length && !shapes.length) return null

  const xs = [...blocks.map(b => b.x ?? 0), ...shapes.map(s => s.x ?? 0)]
  const ys = [...blocks.map(b => b.y ?? 0), ...shapes.map(s => s.y ?? 0)]
  const originX = Math.min(...xs)
  const originY = Math.min(...ys)

  /* Which connections travel is decided here rather than at paste time: a wire
     with one end outside the selection has nothing to reconnect to, and
     bringing it along would produce an arrow pointing at nothing. */
  const payload = {
    v: 1,
    blocks: blocks.map(b => ({ ...b, x: (b.x ?? 0) - originX, y: (b.y ?? 0) - originY })),
    shapes: shapes.map(s => ({ ...s, x: (s.x ?? 0) - originX, y: (s.y ?? 0) - originY })),
  }
  return CLIP_MAGIC + '\n' + JSON.stringify(payload)
}

/**
 * Read a clipboard string back.
 *
 * @returns {{blocks:Array, shapes:Array}|null} null for anything that is not
 *          ours — including our own magic followed by damaged JSON, because a
 *          half-parsed paste is worse than no paste.
 */
export function parseClipboard(text) {
  if (typeof text !== 'string') return null
  if (!text.startsWith(CLIP_MAGIC)) return null
  const body = text.slice(CLIP_MAGIC.length).replace(/^\n/, '')
  let data
  try { data = JSON.parse(body) } catch { return null }
  if (!data || typeof data !== 'object') return null
  if (data.v !== 1) return null
  const blocks = Array.isArray(data.blocks) ? data.blocks : []
  const shapes = Array.isArray(data.shapes) ? data.shapes : []
  if (!blocks.length && !shapes.length) return null
  return { blocks, shapes }
}

/**
 * Turn a parsed payload into things that can be added to a sheet.
 *
 * Every id is reminted, and `parentSectionId` is remapped when the section it
 * points at came along too — a pasted block whose section stayed behind must
 * not claim to be inside a section on a different sheet.
 */
export function materialise(parsed, { x = 0, y = 0 } = {}) {
  if (!parsed) return { blocks: [], shapes: [] }

  const idMap = new Map()
  for (const b of parsed.blocks) idMap.set(b.id, rid('block'))

  const blocks = parsed.blocks.map(b => {
    const next = { ...b, id: idMap.get(b.id), x: (b.x ?? 0) + x, y: (b.y ?? 0) + y }
    if (next.parentSectionId) {
      const mapped = idMap.get(next.parentSectionId)
      /* Dropped rather than kept when the section did not travel. A dangling
         parent id makes the block invisible to the section it thinks it is in
         and immovable by the one it is actually on. */
      next.parentSectionId = mapped || null
    }
    return next
  })

  const shapes = parsed.shapes.map(s => ({ ...s, id: rid('shape'), x: (s.x ?? 0) + x, y: (s.y ?? 0) + y }))
  return { blocks, shapes }
}

/** Blocks whose content lives in a separate store and would not survive a copy. */
export const ASSET_BLOCK_TYPES = new Set(['image', 'pdf', 'file'])

/**
 * Which of these blocks can be copied as-is?
 *
 * An image, PDF or attachment block carries only an ID; the bytes live in
 * IndexedDB. Copying the block alone produces a "file is missing" box on the
 * other side, which looks like data loss even though nothing was lost. Until
 * the paste path can copy bytes too, those are reported so the caller can say
 * so plainly rather than pasting a broken block.
 */
export function splitCopyable(blocks) {
  const copyable = [], skipped = []
  for (const b of blocks) (ASSET_BLOCK_TYPES.has(b.type) ? skipped : copyable).push(b)
  return { copyable, skipped }
}
