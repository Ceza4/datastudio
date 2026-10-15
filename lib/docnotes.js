/*
  lib/docnotes.js
  --------------------------------------------------------------------------
  FOOTNOTES and the TABLE OF CONTENTS — the two pieces of a document that
  are generated from the rest of it.

  FOOTNOTES. The reference in the text is <sup data-ds-fn="f_…"
  contenteditable="false">, numbered by position (renumbered on every edit,
  so inserting one earlier shifts the rest, as in Word). The note's words
  live on the block as `block.footnotes[id]`; they are drawn at the bottom
  of the page the reference lands on, and pagination reserves that room.
  Deleting the reference deletes the note from view; its text is kept on the
  block until the next save prunes unreferenced notes.

  TABLE OF CONTENTS. A non-editable <div data-ds-toc> holding one line per
  heading with its page number. It regenerates itself after pagination
  whenever a heading or a page number changes, so it is never stale; the
  generated lines are stored with the content so an export carries them.
  -------------------------------------------------------------------------- */

export function newNoteId() {
  return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function noteRefHtml(id) {
  return `<sup data-ds-fn="${id}" contenteditable="false">0</sup>`
}

/** Number every reference by document order. @returns ids in order */
export function renumberNotes(root) {
  const ids = []
  root?.querySelectorAll('[data-ds-fn]').forEach((s, i) => {
    const n = String(i + 1)
    if (s.textContent !== n) s.textContent = n
    ids.push(s.getAttribute('data-ds-fn'))
  })
  return ids
}

/** Notes no reference points at any more — pruned from the block on save. */
export function pruneNotes(notes, ids) {
  if (!notes) return notes
  const keep = new Set(ids)
  let changed = false
  const out = {}
  for (const k of Object.keys(notes)) { if (keep.has(k)) out[k] = notes[k]; else changed = true }
  return changed ? out : notes
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const TOC_HTML = '<div data-ds-toc="1" contenteditable="false"><p data-ds-toc-title="1">Contents</p></div><p><br></p>'

/** The inner HTML of a table of contents for these headings. */
export function tocInner(heads, title = 'Contents') {
  const rows = heads.filter(h => h.level <= 3).map(h =>
    `<p data-ds-toc-l="${Math.max(1, h.level)}"><span>${esc(h.text)}</span><span data-ds-toc-page="1">${h.page}</span></p>`)
  return `<p data-ds-toc-title="1">${esc(title)}</p>` + (rows.join('') || '<p data-ds-toc-l="1"><span>Add headings (Heading 1–3) and they appear here.</span><span data-ds-toc-page="1"></span></p>')
}

/** Bring every table of contents up to date. @returns true if one changed */
export function updateTocs(root, heads) {
  let changed = false
  root?.querySelectorAll('[data-ds-toc]').forEach(t => {
    const title = t.querySelector('[data-ds-toc-title]')?.textContent || 'Contents'
    const html = tocInner(heads, title)
    if (t.innerHTML !== html) { t.innerHTML = html; changed = true }
  })
  return changed
}
