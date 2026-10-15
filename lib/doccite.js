/*
  lib/doccite.js
  --------------------------------------------------------------------------
  CITATIONS AND A BIBLIOGRAPHY, the way Word's References tab does them.

  Sources live on the block as `block.sources` [{ id, type, authors, year,
  title, container, publisher, url, pages }]. A citation in the text is a
  non-editable atom <span data-ds-cite="s_…">(Oke, 1982)</span>; a
  bibliography is a non-editable <div data-ds-bib>. Both are regenerated
  from the sources whenever a source or the style changes, so editing a
  source's year fixes every citation of it at once. APA 7 and MLA 9, the
  two styles students are asked for most.
  -------------------------------------------------------------------------- */

export const CITE_STYLES = [{ id: 'apa', label: 'APA 7th' }, { id: 'mla', label: 'MLA 9th' }]

export function newSourceId() {
  return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** "Oke, T. R.; Smith, J." → [{ last, first }] */
export function parseAuthors(s) {
  return String(s || '').split(/;|\band\b|&/).map(a => a.trim()).filter(Boolean).map(a => {
    if (a.includes(',')) { const [last, ...rest] = a.split(','); return { last: last.trim(), first: rest.join(',').trim() } }
    const parts = a.split(/\s+/)
    return { last: parts.pop() || a, first: parts.join(' ') }
  })
}

const initialsOf = first => first.split(/[\s-]+/).filter(Boolean).map(x => x[0].toUpperCase() + '.').join(' ')

/** The in-text citation: (Oke, 1982) / (Oke & Smith, 1982) / (Oke et al., 1982). */
export function inText(src, style = 'apa', pages = '') {
  if (!src) return '(Source?)'
  const a = parseAuthors(src.authors)
  const names = !a.length ? (src.title || 'Anon.')
    : a.length === 1 ? a[0].last
    : a.length === 2 ? `${a[0].last} ${style === 'mla' ? 'and' : '&'} ${a[1].last}`
    : `${a[0].last} et al.`
  if (style === 'mla') return `(${names}${pages ? ' ' + pages : ''})`
  return `(${names}, ${src.year || 'n.d.'}${pages ? ', p. ' + pages : ''})`
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** One reference-list entry, as HTML (titles in italics). */
export function referenceHtml(src, style = 'apa') {
  const a = parseAuthors(src.authors)
  const t = esc(src.title || 'Untitled')
  const cont = esc(src.container || '')
  const pub = esc(src.publisher || '')
  const url = esc(src.url || '')
  const pages = esc(src.pages || '')
  if (style === 'mla') {
    const names = !a.length ? '' : a.length === 1 ? `${esc(a[0].last)}, ${esc(a[0].first)}. `
      : a.length === 2 ? `${esc(a[0].last)}, ${esc(a[0].first)}, and ${esc(a[1].first)} ${esc(a[1].last)}. `
      : `${esc(a[0].last)}, ${esc(a[0].first)}, et al. `
    const title = cont ? `“${t}.” <i>${cont}</i>` : `<i>${t}</i>`
    return `${names}${title}${pub ? ', ' + pub : ''}${src.year ? ', ' + esc(src.year) : ''}${pages ? ', pp. ' + pages : ''}${url ? ', ' + url : ''}.`
  }
  const names = a.map(x => `${esc(x.last)}${x.first ? ', ' + esc(initialsOf(x.first)) : ''}`)
  const who = !names.length ? '' : names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ', &amp; ' + names[names.length - 1]
  const year = `(${esc(src.year || 'n.d.')}).`
  const title = cont ? `${t}. <i>${cont}</i>${pages ? ', ' + pages : ''}.` : `<i>${t}</i>.`
  return `${who ? who + ' ' : ''}${year} ${title}${pub ? ' ' + pub + '.' : ''}${url ? ' ' + url : ''}`
}

export function citeHtml(src, style) {
  return `<span data-ds-cite="${esc(src.id)}" contenteditable="false">${esc(inText(src, style))}</span>`
}

export const BIB_HTML = '<div data-ds-bib="1" contenteditable="false"></div><p><br></p>'

export function bibInner(sources, style = 'apa') {
  const sorted = [...(sources || [])].sort((x, y) => {
    const ax = parseAuthors(x.authors)[0]?.last || x.title || ''
    const ay = parseAuthors(y.authors)[0]?.last || y.title || ''
    return ax.localeCompare(ay)
  })
  const head = `<p data-ds-bib-title="1">${style === 'mla' ? 'Works Cited' : 'References'}</p>`
  if (!sorted.length) return head + '<p data-ds-bib-entry="1">Add sources under References → Citations and they appear here.</p>'
  return head + sorted.map(s => `<p data-ds-bib-entry="1">${referenceHtml(s, style)}</p>`).join('')
}

/** Refresh every citation and bibliography. @returns true if anything changed */
export function updateCitations(root, sources, style) {
  if (!root) return false
  const byId = new Map((sources || []).map(s => [s.id, s]))
  let changed = false
  root.querySelectorAll('[data-ds-cite]').forEach(c => {
    const t = inText(byId.get(c.getAttribute('data-ds-cite')), style)
    if (c.textContent !== t) { c.textContent = t; changed = true }
  })
  root.querySelectorAll('[data-ds-bib]').forEach(b => {
    const html = bibInner(sources, style)
    if (b.innerHTML !== html) { b.innerHTML = html; changed = true }
  })
  return changed
}
