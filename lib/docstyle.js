/*
  lib/docstyle.js
  --------------------------------------------------------------------------
  THE DOCUMENT'S TYPOGRAPHY, in one place, for the page on screen AND the
  printed PDF. The print is built from the laid-out page (lib/docprint.js),
  so if these two ever disagreed by a pixel of line height, a printed page
  would end on a different line than the one on screen.

  Word's model: sizes and spacing in POINTS, "Normal" 8 pt after each
  paragraph, headings with their own size, weight, colour and space above,
  Title and Subtitle, a real Quote style. `s` is the scope selector.
  -------------------------------------------------------------------------- */

export function docCss(s) {
  return `
${s} p, ${s} div:not([data-type]):not([data-ds-toc]):not([data-ds-bib]):not([data-ds-pagebreak]):not([data-ds-sectionbreak]) { margin: 0 0 8pt; }
${s} h1 { font-size: 20pt; font-weight: 600; margin: 18pt 0 6pt; line-height: 1.2; color: var(--pg-head); }
${s} h2 { font-size: 16pt; font-weight: 600; margin: 14pt 0 4pt; line-height: 1.25; color: var(--pg-head); }
${s} h3 { font-size: 13pt; font-weight: 600; margin: 12pt 0 3pt; line-height: 1.3; color: var(--pg-head2); }
${s} h4 { font-size: 1em; font-weight: 600; font-style: italic; margin: 10pt 0 2pt; line-height: 1.35; color: var(--pg-head2); }
${s} h5, ${s} h6 { font-size: 1em; font-weight: 600; margin: 8pt 0 2pt; color: var(--pg-head2); }
${s} p[data-ds-style="title"] { font-size: 28pt; font-weight: 300; letter-spacing: -0.5px; line-height: 1.1; margin: 0 0 6pt; }
${s} p[data-ds-style="subtitle"] { font-size: 15pt; color: var(--pg-mute); letter-spacing: 0.3px; line-height: 1.3; margin: 0 0 14pt; }
${s} ul, ${s} ol { padding-left: 1.6em; margin: 0 0 8pt; }
${s} ol ol { list-style-type: lower-alpha; }
${s} ol ol ol { list-style-type: lower-roman; }
${s} ul ul { list-style-type: circle; }
${s} ul ul ul { list-style-type: square; }
${s} li { margin: 0 0 2pt; }
${s} li > ul, ${s} li > ol { margin: 2pt 0 0; }
${s} blockquote { margin: 8pt 0; padding: 2pt 0 2pt 12pt; border-left: 3px solid var(--pg-rule); font-style: italic; color: var(--pg-text); }
${s} table { border-collapse: collapse; margin: 6pt 0 10pt; width: 100%; }
${s} td, ${s} th { border: 1px solid var(--pg-rule); padding: 4pt 6pt; vertical-align: top; min-width: 2em; }
${s} th { background: var(--pg-th); font-weight: 600; text-align: left; }
${s} table[data-ds-borders="none"] td, ${s} table[data-ds-borders="none"] th { border-color: transparent; }
${s} table[data-ds-borders="outer"] { border: 1px solid var(--pg-rule); }
${s} table[data-ds-borders="outer"] td, ${s} table[data-ds-borders="outer"] th { border-color: transparent; }
${s} table[data-ds-borders="rows"] td, ${s} table[data-ds-borders="rows"] th { border-left-color: transparent; border-right-color: transparent; }
${s} img { max-width: 100%; height: auto; display: block; margin: 4pt 0; }
${s} figcaption, ${s} [data-ds-caption] { font-size: 0.85em; color: var(--pg-mute); font-style: italic; margin: 2pt 0 10pt; }
${s} sup, ${s} sub { line-height: 0; font-size: 0.72em; }
${s} a { color: var(--pg-link); text-decoration: underline; text-underline-offset: 2px; }
${s} hr { border: 0; border-top: 1px solid var(--pg-rule); margin: 10pt 0; }
${s} [data-ds-pagebreak] { height: 0; margin: 0; border: 0; }
${s} [data-ds-sectionbreak] { height: 0; margin: 0; border: 0; }
${s} [data-ds-tab] { display: inline-block; white-space: pre; tab-size: 0; text-indent: 0; min-width: 2px; }
${s} [data-ds-dropcap]::first-letter { float: left; font-size: 3.2em; line-height: 0.82; padding: 0.06em 0.08em 0 0; font-weight: 600; color: var(--pg-head); }
${s} p[data-ds-eq] { text-align: center; font-family: 'Cambria Math', 'STIX Two Math', 'Latin Modern Math', Cambria, Georgia, serif; font-style: italic; margin: 8pt 0; }
${s} [data-ds-toc] { margin: 0 0 12pt; cursor: default; }
${s} [data-ds-toc-title], ${s} [data-ds-bib-title] { font-size: 16pt; font-weight: 600; color: var(--pg-head); margin: 0 0 8pt; }
${s} [data-ds-toc-l] { display: flex; align-items: baseline; margin: 0 0 3pt; cursor: pointer; }
${s} [data-ds-toc-l]::before { content: ''; order: 1; flex: 1; border-bottom: 1px dotted var(--pg-mute); margin: 0 4px; min-width: 12px; }
${s} [data-ds-toc-l] > span:first-child { order: 0; }
${s} [data-ds-toc-page] { order: 2; font-variant-numeric: tabular-nums; }
${s} [data-ds-toc-l="1"] { font-weight: 600; }
${s} [data-ds-toc-l="2"] { padding-left: 16pt; }
${s} [data-ds-toc-l="3"] { padding-left: 32pt; }
${s} [data-ds-bib] { margin: 0 0 12pt; }
${s} [data-ds-bib-entry] { padding-left: 0.5in; text-indent: -0.5in; margin: 0 0 6pt; }
${s} [data-ds-fn] { color: var(--pg-link); cursor: pointer; padding: 0 1px; }
${s} [data-ds-cite] { cursor: pointer; }
${s} ins[data-ds-uid] { text-decoration: underline; text-decoration-thickness: 1px; }
${s} del[data-ds-uid] { text-decoration: line-through; }
`
}

/** Per-author colours for tracked changes, as CSS for the uids present. */
export function changeColorsCss(s, uids, hueOf) {
  return uids.map(u => {
    const h = hueOf(u)
    const sel = `[data-ds-uid="${String(u).replace(/["\\]/g, '')}"]`
    return `${s} ins${sel}, ${s} del${sel} { color: hsl(${h} 62% 36%); }`
  }).join('\n')
}

/** Screen-only rules: never printed. */
export function docScreenCss(s) {
  return `
${s} { caret-color: var(--pg-text); }
${s} ::selection { background: color-mix(in srgb, var(--ds-accent) 26%, transparent); color: inherit; }
${s}[data-empty]::before { content: 'Start writing…'; position: absolute; left: var(--pg-pl); top: var(--pg-pt); color: var(--pg-mute); pointer-events: none; }
${s} [data-ds-comment] { background: rgba(250, 204, 21, 0.26); border-bottom: 2px solid rgba(234, 179, 8, 0.75); }
${s}[data-marks] p::after, ${s}[data-marks] li::after, ${s}[data-marks] h1::after, ${s}[data-marks] h2::after, ${s}[data-marks] h3::after, ${s}[data-marks] h4::after, ${s}[data-marks] blockquote::after { content: '¶'; color: var(--pg-mute); opacity: 0.55; margin-left: 2px; font-style: normal; font-weight: 400; }
${s}[data-marks] [data-ds-pagebreak] { height: auto; border-top: 1px dotted var(--pg-mute); margin: 6pt 0; position: relative; }
${s}[data-marks] [data-ds-pagebreak]::after { content: 'Page break'; position: absolute; left: 50%; top: -0.7em; transform: translateX(-50%); background: var(--pg-bg); padding: 0 6px; font-family: var(--ds-font-body); font-size: 11px; color: var(--pg-mute); }
${s}[data-marks] [data-ds-sectionbreak] { height: auto; border-top: 3px double var(--pg-mute); margin: 6pt 0; position: relative; }
${s}[data-marks] [data-ds-sectionbreak]::after { content: 'Section break (next page)'; position: absolute; left: 50%; top: -0.75em; transform: translateX(-50%); background: var(--pg-bg); padding: 0 6px; font-family: var(--ds-font-body); font-size: 11px; color: var(--pg-mute); }
${s}[data-marks] [data-ds-tab]::before { content: '→'; position: absolute; color: var(--pg-mute); font-size: 0.8em; }
${s}[data-marks] [data-ds-tab] { position: relative; }
${s} [data-ds-toc]:hover { background: color-mix(in srgb, var(--ds-accent) 6%, transparent); }
${s} [data-ds-cite]:hover, ${s} [data-ds-fn]:hover { background: color-mix(in srgb, var(--ds-accent) 14%, transparent); border-radius: 2px; }
::highlight(ds-find) { background-color: rgba(250, 204, 21, 0.45); }
::highlight(ds-find-current) { background-color: rgba(249, 115, 22, 0.55); }
`
}
