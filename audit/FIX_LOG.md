# Fix log

Branch `audit/reliability-oct16`, cut from `main` at `c990efe`. Pushed; **not merged, not deployed**. 15 commits, 57 files, +2,002 / −228.

| Commit | Defects | What changed |
|---|---|---|
| 4572a48 | 001–009 | Stale browser test repaired; toolbar fits laptop widths; undo reverts only its own change over a sync pull (`lib/undo.js revertChange`); toast UNDO steps history; zoom-% reset anchored on content; rename fields select-all and Escape cancels (`lib/renameinput.js`); unique project names |
| 6dc928a | 003, 010–013 | Grid undo reverts onto current rows (collaborator cells survive); sheet switches are not undo steps; no-op history entries skipped; new sheet ids unique |
| 71f9dcc | 013–015 | One resize handle on the visible border; Document ribbon measured compaction |
| 8da1bf3 | 016–020 | Page titles, 404 page, auth layouts; slash menu matches ids (/h1); European dot-grouped numbers; **Excel dates a day early east of Greenwich** |
| 10d967a | 021–023 | Accessible names on icon buttons; sidebar active text contrast; section dialog copy |
| e31b46c | 024–025 | Footnote / Agent-instruction debounces flushed on unmount; imports placed in view, never stacked |
| 3169a73 | 026–029 | Unicode export file names (`lib/filename.js`); CSV/Markdown blank headers; **grid lost keys typed straight after Tab**; DEF-028 logged |
| 98eb01f | 030 | HTML block flushes pending save on blur/unmount/pagehide |
| e2245d3 | 031–032 | **Database menus crashed the block (undefined `text2`)** + `scripts/check-undef.mjs` guard; ghost selection pruned |
| f88a4dd | 006, 033–034 | Focus to canvas after non-text add; title island container query (no more "M…"); plural sweep |
| 4e768c5 | 035 | Sidebar projects/sheets keyboard-reachable; parked toolbar and collapsed sidebar `inert` |
| 5c221c5 | 036–037 | Single-key creates documented + shown in Add menu (+ test); calendar header wraps |
| 23e2185 | 038 | `lib/pressable.js`; Draw panel, file/folder toggles, zoom reset, swatches, Crosscheck, sync retry keyboard-operable |
| c995891 | 039 | Canvas paste through the native `paste` event, gated by focus; repeated pastes cascade |
| c06d4ea | — | Lint: no new React-compiler findings on audit lines; ledger |
| (next) | 040–042 + review follow-ups | Block updates target the block's own sheet; toast UNDO pinned to its history slot; `repairBlocks` on load/pull; error-card delete can't throw; paste gated while shortcuts open + Safari fallback; Draw panel click/Esc; check-undef fails on parse errors |

## Guards and tests added

- `scripts/check-undef.mjs` (in `npm run check`) — any undefined identifier fails the build gate. Proven to fail on the DEF-031 file.
- `tests/undo.test.mjs` (+cross-device cases), `tests/workbook.test.mjs` (timezones, European numbers), `tests/filename.test.mjs`, `tests/lib.test.mjs` (+CSV, +pressable), `tests/registry.equivalence.test.mjs` (+shortcut documentation/shadowing).
- `tests/browser/run.mjs`: grid typing after Tab (DEF-029), HTML block unmount flush (DEF-030), every database menu in its empty state (DEF-031). Each was run against the pre-fix file and FAILED there.

## Mistakes made during the audit (and caught)

- A no-undef guard first passed on broken code (missing ESLint formatter); caught by running it against the old file; rewritten to parse JSON and fail closed.
- A grid regression test first passed on broken code (harness renders too fast to slip a frame); fixed by delaying frames deliberately and splitting the typing; now fails on old code.
- A Python edit truncated `NotebookCanvas.js` mid-session; restored from git and re-applied before anything ran.
- A first paste listener gated on `e.target` and failed after a sheet switch (Chrome targets the text selection); traced and switched to focus.
- Export width briefly extended past the last header; reverted to match the grid before commit (a file should not carry data the table did not show).
