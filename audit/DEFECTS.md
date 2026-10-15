# Defect register

Severity: P0 critical · P1 high · P2 medium · P3 low. Status: OPEN · FIXED (verified) · FIXED (unverified) · WONTFIX · DEFERRED (needs a product decision).
Environment unless stated: Chromium 141 headless, 1440×900, production build of the audit branch against the local Supabase test double.

---

## DEF-001 · P3 · Test · FIXED (verified)
**Browser suite aborted at "text rail" — stale test, not an app bug.**
- Repro: `npm run test:browser` on c990efe → 30 s TimeoutError at `page.click('[aria-label="Insert hyperlink"]')`, every later suite (database, builder) never ran.
- Root cause: two app changes outran the test. (1) 1 Oct moved Link into the rail's collapsed secondary section (aria-hidden, max-width 0). (2) A whitespace-only selection now deliberately shows no rail, and the test's centre-of-box double-click selected the trailing space. (3) The "nothing selected" hint is only reachable in the frame before `selectionchange` hides the rail.
- Fix: `tests/browser/run.mjs` — open the chevron before Link; double-click on a word; drive the no-selection case in one task and assert what still holds (no `alert()`).
- Verification: 157 passed, 0 failed (was: aborted after 61).

## DEF-002 · P2 · Visual/layout · FIXED (verified)
**Title island clips its own controls at common laptop widths.**
- Repro: 1440×900, open any project. The island reads "My …", the full-screen button is cut in half under the centre toolbar, and selecting a block shows "LO" of the LOCKED chip.
- Expected: the project name may truncate, but the zoom %, LOCKED state and full-screen button stay whole and clickable.
- Root cause: the top row is `grid 1fr auto 1fr` so the toolbar sits at true centre; at 1440 the left column is (1440 − 502)/2 = 469 px, minus 300 px of sidebar padding = **169 px**, while the island's unshrinkable content is ≈ 240 px. `overflow:hidden` on both the column and the island clips it. It matters more than it looks: while a block is selected the wheel does nothing, and LOCKED is the only thing that says why.
- Fix: below 1700 px the centre toolbar's four labels are visually hidden (kept for screen readers; every button has a tooltip; Add gained one), below 1440 px its separators close up, and the project name may shrink to 36 px. `app/globals.css`, `NotebookCanvas.js`.
- Verification: screenshots at 1366/1440/1536/1600/1920 with a block selected — name truncates, zoom, LOCKED and full-screen are whole at every width (`audit/evidence/top-row-after.png`).
- Design note for Matas: this changes the toolbar's look on laptops (icons only under 1700 px). See OPEN_QUESTIONS Q1.

## DEF-003 · P1 · Data integrity · FIXED (verified)
**Ctrl+Z after a sync pull erases another device's (or collaborator's) work — locally and then on the server.**
- Repro (two browser contexts, same account): A adds a Notes block, B pulls it; A adds and types a second block; B pulls, adds its own block "FROM-B"; A pulls "FROM-B"; A presses Ctrl+Z once ("Undid edit text").
- Expected: A's own typing is undone; "FROM-B" stays.
- Actual (c990efe): "FROM-B" disappears on A, and A's next push removes it from the server.
- Root cause: `lib/undo.js` `undo()` returned `entry.before` and AppPage replaced the whole workspace with it. Pulls are deliberately not recorded, so `before` predates them.
- Fix: `revertChange(current, before, after)` reverts only the entry's own change onto the current state (keyed merge by id for notebooks/sheets/blocks, positional merge for table rows, a later edit wins on a true conflict). When nothing was pulled (`current === after`) it returns `before` itself — local behaviour unchanged. AppPage passes the live workspace and no longer arms the history-skip flag when the result is the same array (which would have silently dropped the next edit from history).
- Tests: `tests/undo.test.mjs` +10 assertions (fail on the old code); `audit/e2e/two-device-undo.mjs` (end-to-end, 7/7).

## DEF-004 · P3 · Undo/usability · FIXED (verified)
**The toast's UNDO was recorded as a new edit, so the next Ctrl+Z re-deleted the block ("Undid edit").**
- Repro: delete a Notes block → click UNDO in the toast → press Ctrl+Z on the canvas.
- Expected: Ctrl+Z steps back past the delete (the delete was already undone).
- Actual: the block is deleted again; the toast says "Undid edit". Same shape for sheet and project deletes, which also had no undo label of their own ("Undid edit").
- Fix: `undoVia(label, fallback)` in AppPage — when the change is still the top of the history, the toast steps the history back (redo works); otherwise the old hand-restore runs. Sheet and project deletes now label their entries "delete sheet"/"delete project".
- Verification: same sequence now yields "Undid edit text" then "Undid add".

## DEF-005 · P2 · Navigation · FIXED (verified)
**Clicking the zoom % ("reset the view") jumped to the world origin and could show an empty canvas.**
- Repro: zoom out to 25 %, add a block (it lands in view), click "25%".
- Actual: 100 % at pan (60,60); the block was off-screen (y = −963) with nothing to say where it went.
- Fix: zoom to 100 % anchored on the selection, else the blocks currently visible, else the view centre; tooltip now "Zoom to 100%".
- Verification: block at (722,414) and in view after the click.

## DEF-006 · P3 · Accessibility · OPEN
**After picking a non-text block from +Add, keyboard focus falls to `<body>`.**
- Repro: +Add → Kanban (or Table, Task, Calendar, Database, Countdown, Flashcards, Section, Agent) → Enter. `document.activeElement` is BODY.
- Impact: shortcuts still work (the canvas treats BODY as itself) but a screen reader loses its place and the canvas focus ring is gone. Text blocks focus their editor correctly.

## DEF-007 · P2 · Usability · FIXED (verified)
**Rename fields did not select their text: new folder + typing "Clients" → "New FolderClients".**
- Fix: `selectAllOnFocus` on every rename field (`lib/renameinput.js`).

## DEF-008 · P3 · Usability · FIXED (verified)
**Sidebar "Project" created indistinguishable "My Project" rows and never offered to name them; Enter then created another one** (focus stayed on the button).
- Fix: unique default names ("My Project 2" …) and the sidebar button opens the rename field like Folder does.

## DEF-009 · P2 · Interaction (cancellation) · FIXED (verified)
**Escape COMMITTED a rename in nine fields** — project (sidebar and title island), sheet (sidebar and title island), folder, block header, section, column group, task title.
- Root cause: one copied handler, `if (key === 'Enter' || key === 'Escape') blur()`, with commit-on-blur.
- Fix: `lib/renameinput.js` — Enter commits, Escape marks-and-blurs so onBlur closes without saving (block headers, which rename live, restore the original), and the Escape press stops at the field so it does not also deselect the block.
- Verification: folder/project/block header sequences in `audit/e2e` — Escape leaves the old name and the block stays selected; Enter keeps the new one.
