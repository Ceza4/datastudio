# `components/tools/`

This folder holds standalone tools that plug into DataStudio. As of the
notebook-only rewrite, **Crosscheck is the only tool left** — the old
canvas grid (and its toolbar tools: Trim & Clean, Highlight Empty,
Duplicates, Col Stats, Format, plus the never-built Gap Finder / Col
Mapper / Sort & Filter / Merge / Split) was removed along with the
preview/canvas modes. DataStudio is now always the notebook workspace.

## Ownership

**Primary owner: [collaborator name]** — feel free to add new tools, edit
existing ones, and reorganize this folder as you see fit.

**Matas should not edit files here** unless coordinating directly with the
collaborator. `components/notebook/`, `app/app/page.js`, and the sidebar
belong to Matas.

If both people need to touch a file, agree first in chat.

## Conventions

- **One component per file.**
- **`'use client'` at the top of every file.**
- **All visual styling is inline** — no Tailwind, no CSS modules. Use the
  `colors` prop for theme tokens.
- **Each file has a doc comment block** at the top explaining what the
  component does and where its state lives.

## Files in this folder

| File | Purpose |
|------|---------|
| `CrosscheckPanel.js` | Draggable floating island for fuzzy-matching company names across two columns. Inputs come from table blocks on the active notebook sheet (`sourceColumns` prop). Not a modal — no overlay, the notebook stays interactive behind it. Includes a cleanup step (skip blanks / remove duplicates) and live streaming progress from the worker. Results land back as a new table block via `onAddToNotebook({ headers, rows })`. |

Styling comes from the `--ds-*` design tokens in `app/globals.css` (and the
`.ds-island` / `.ds-btn` / `.ds-card` classes), not from a `colors` prop — it
themes itself off the `data-theme` attribute.

It's opened from a `⚡ Crosscheck` button in the notebook's floating
toolbar island (`components/notebook/NotebookCanvas.js`), which calls the
`onOpenCrosscheck` prop passed down from `AppPage`.

## Adding a new tool

1. Create `MyTool.js` in this folder, `'use client'` + doc comment.
2. Decide how it's triggered — likely a button in `NotebookCanvas`'s
   floating toolbar island, following the `onOpenCrosscheck` pattern.
3. Wire the open/close state and any callback props in `AppPage`
   (`app/app/page.js`) and pass them down to `NotebookCanvas`, same as
   `showCCWizard` / `onOpenCrosscheck` / `onAddToNotebook`.

If your tool needs new state in `AppPage`, talk to Matas first.
