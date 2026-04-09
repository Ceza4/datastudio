# `components/tools/`

This folder holds the toolbar tools for DataStudio's canvas. Every file here is one tool (or one helper used by exactly one tool).

## Ownership

**Primary owner: [collaborator name]** — feel free to add new tools, edit existing ones, and reorganize this folder as you see fit.

**Matas should not edit files here** unless coordinating directly with the collaborator. Files in `components/notebook/`, the canvas in `app/app/page.js`, and the sidebar belong to Matas.

If both people need to touch a file, agree first in chat. The point of this split is to make merge conflicts impossible by default.

## Conventions

- **One component per file.** Helper sub-components (like `FmtBtn.js` for `FormatBar.js`) get their own file too.
- **`'use client'` at the top of every file.** These are React client components.
- **All visual styling is inline** — no Tailwind, no CSS modules. Use the `colors` prop for theme tokens.
- **Each file has a doc comment block** at the top explaining what the component does and where its state lives.

## Component contract (the props pattern)

Every tool component receives `colors` as a prop. Most also receive callbacks (`onRun`, `onClose`, `onApply`) instead of touching parent state directly.

State ownership rule of thumb:
- **Lives inside the tool component** if no other part of the app reads it (e.g. `colorDraft` in `FormatBar`, `trimOptions` in `TrimPanel`).
- **Lives in `AppPage`** if the canvas rendering or another tool depends on it (e.g. `highlightEmpty`, `duplicateMap`, `colFormats`).

When in doubt: start with state inside the component, only lift it up when you find a second place that needs to read it.

## Files in this folder

| File | Purpose |
|------|---------|
| `CrosscheckWizard.js` | 4-step modal for fuzzy-matching company names across two columns. Owns its own wizard state + Web Worker. |
| `FormatBar.js` | The format ribbon shown when activeTool === 'format'. Per-column font/align/bold/wrap + global header/banding/borders. |
| `FmtBtn.js` | Small toggle button helper used only by `FormatBar.js`. |
| `TrimPanel.js` | Strip whitespace + change casing across all canvas columns. |
| `EmptyPanel.js` | Toggle highlight-empty-cells mode. |
| `DuplicatesPanel.js` | Find duplicate values across columns. |
| `StatsPanel.js` | Calculate per-column stats (shown as floating cards on the canvas). |

## Adding a new tool

1. Create `MyTool.js` in this folder.
2. Add a `'use client'` line and a doc comment.
3. In `app/app/page.js`, import it and render it inside the `{activeTool === 'mytool' && (...)}` block.
4. Add `{ id: 'mytool', label: 'My Tool', icon: '★', desc: '...' }` to the `tools` array in `AppPage`.

If your tool needs new state in `AppPage`, talk to Matas first — that's the boundary that needs coordination.
