# Interaction graph

The shared mechanisms most features pass through, what they read and write, and where they have been shown to conflict. Risk clusters are ranked by what this audit actually found, not by guess.

## 1. The two undo histories — highest-risk cluster (3 P1/P2 defects found here)

```
user edit ─► AppPage setNotebooks ─► capture effect ─► H.record(before, after)
sync pull ─► applyRemoteRows ──────► setNotebooks + applyingHistoryRef (NOT recorded)
Ctrl+Z on canvas ─► applyHistory(H.undo, current) ─► revertChange(current, before, after)
Ctrl+Z in a table ─► SheetGrid undo stack (local) ─► revertChange on {rows, headers}
toast UNDO ─► undoVia(label) ─► history step if top entry, else hand restore
```

| State | Writers | Readers | Found |
|---|---|---|---|
| `notebooks` | every mutator in AppPage, sync pull, undo/redo | canvas, sidebar, sync `changed()`, save debounce | DEF-003 (undo over a pull), DEF-010 (sheet switch recorded), DEF-012 (no-op entries) |
| `historyRef` | capture effect, applyHistory | Ctrl+Z/Y, toast undo | DEF-004 (toast restore recorded as a new edit) |
| `applyingHistoryRef` (one boolean) | applyHistory, applyRemoteRows, addLocalDoc | capture effect | armed with no change ⇒ next real edit unrecorded (fixed in applyHistory). **Still a risk:** a pull and a local edit batched into one render would skip the local edit. |
| SheetGrid `undoStack` | six grid mutators | grid Ctrl+Z/Y | DEF-011 (grid undo over a pull) |

**Known design seam, not fixed:** the grid's own undo and the workspace undo are two stacks. Undo in the grid is itself recorded as a workspace "edit", so leaving the grid and pressing Ctrl+Z re-applies what the grid just undid. Same shape for a note's browser undo. See OPEN_QUESTIONS Q3.

## 2. Keyboard routing

```
window capture: Ctrl+K palette · Ctrl+Shift+F full screen · Esc during drag
document bubble: canvas onKey (gated: full screen owns keys; Esc first; then "onCanvas" = target is canvas or BODY)
React handlers inside blocks run before the document listener and mark e.__dsConsumed
```

- Rename fields (9) used Escape = commit and let the press reach the canvas (deselect). DEF-009, fixed with `lib/renameinput.js`.
- BODY counts as the canvas, so after the Add menu closes and focus falls to BODY (DEF-006) shortcuts still work — the only cost is accessibility.
- Verified no leak: Delete/Backspace inside text, grid, Document, Kanban card never deleted the block; Ctrl+A inside text selects text only; letters while the shortcuts dialog is open create nothing.

## 3. Pointer routing and hit-testing

- Block wrapper `onPointerDownCapture` selects; header `onMouseDown` drags; resize handles `onMouseDown` resize. Handles used to live inside `overflow:hidden` bodies → DEF-015 (half of each handle clipped; the border itself did nothing).
- Selection lock: while anything is selected, wheel/pinch are swallowed (preventDefault, no camera move). The only explanation is the LOCKED chip — which DEF-002 had clipped.
- Marquee, multi-drag, section containment, kanban card drag: PASS.

## 4. Persistence and sync

```
notebooks ─► debounced saveState (IndexedDB, compare-and-set on savedAt)
          └► sync.changed() ─► outbox ─► PATCH docs (eq id, eq rev) / INSERT / conflict copy
pull (focus, realtime, interval) ─► applyPulled ─► applyRemoteRows
```

- Reload persistence: PASS for all 13 battery block types, tables, imports, PDFs/images (see TEST_MATRIX).
- Two-device sequences: PASS after DEF-003/011.

## 5. Import pipeline

`readWorkbook` (SheetJS + prototype-pollution guard) / `readDelimitedText` (own delimiter, decimal and encoding rules) ─► `tableFromSheet` (header-row detection) ─► `normaliseRow` (Date ─► local ISO day) ─► sidebar file ─► table block.
- DEF-020 (P1): dates a day early east of Greenwich. DEF-019: dot-grouped thousands stayed text.

## Cancellation matrix (summary)

| Interaction | Exit paths tested | Result |
|---|---|---|
| Rename (9 fields) | Enter, Escape, click away | Escape now cancels; Enter/blur commit |
| Grid cell edit | Escape, Enter, Tab, click another cell | PASS |
| Block drag | release, Escape (code-reviewed), window blur (code) | PASS (release + undo) |
| Keyboard grab (G) | Enter, Escape | PASS (Esc restores position) |
| Full screen | tap Esc (stays), hold Esc, Ctrl+Shift+F | PASS |
| Section delete dialog | Escape, Cancel | PASS (nothing deleted) |
| Shortcuts dialog | Escape, ? | PASS; keys swallowed while open |
| Add menu / palette | Escape, Enter | PASS |
| Visuals tool | Escape → Select | PASS |
