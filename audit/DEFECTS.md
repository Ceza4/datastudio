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

## DEF-010 · P2 · Undo (wrong action reversed) · FIXED (verified)
**Clicking between sheets was recorded as an undoable "edit"; Ctrl+Z then bounced you between sheets instead of undoing your work.**
- Repro: type in a note on Sheet 2 → click Sheet 1 → click Sheet 2 → Ctrl+Z. Actual: "Undid edit" and you are on Sheet 1; again → back on Sheet 2; only the third press undoes the typing.
- Root cause: `activeSheetId` lives inside the notebook, so a sheet switch mints a new `notebooks` and the capture effect recorded it.
- Fix: `isNavigationOnly(prev, next)` — a change that only moves `activeSheetId` is not recorded; and `sheetTouched()` makes an undo/redo open the sheet its change was on, so nothing is undone out of sight.
- Verification: same repro → first Ctrl+Z "Undid edit text" on Sheet 2. From Sheet 1, Ctrl+Z opens Sheet 2 and undoes there. 7 new unit assertions.

## DEF-011 · P1 · Data integrity · FIXED (verified)
**Ctrl+Z inside a table wiped cells another device/collaborator had typed since — and pushed the wipe to the server.**
- Repro (two contexts, same table): A types A-FIRST, B pulls; A types A-SECOND; B pulls and types B-CELL; A pulls B-CELL; A clicks a cell and presses Ctrl+Z.
- Actual on c990efe: A-SECOND **and B-CELL** vanish on A, and the server copy loses B-CELL (re-run against the original SheetGrid to confirm: 2 FAIL).
- Root cause: SheetGrid's own 60-step stack restored whole `{rows, headers}` snapshots — the DEF-003 bug again, one level down.
- Fix: grid entries keep `before` and `after` (all six mutators write through `commit()`), undo/redo use `revertChange`. `revertChange` also learned to merge positionally when the table grew since (a wider row from someone typing past the last column).
- Tests: `audit/e2e/two-device-grid-undo.mjs` 6/6; unit test for the widened-row case.

## DEF-012 · P3 · Undo · FIXED (verified)
**Every session had an undo step that did nothing ("Undid edit"), and adding a project or a sheet was labelled just "edit".**
- Root cause: a new array holding the same notebook objects was recorded as a change.
- Fix: such no-op changes are skipped; `markUndo('add project')`, `markUndo('add sheet')`.

## DEF-013 · P3 · Data identity · FIXED (code-verified)
**New sheets got `sheet_${Date.now()}` ids (the unsalted pattern already removed from notebooks and folders) and the name "Sheet N+1" even when that name was taken** — delete Sheet 2 of three, add one → two "Sheet 3".
- Fix: `newSheetId()` and the first free "Sheet N".

## DEF-014 · P3 · Visual (regression of a 25 Sep fix) · FIXED (verified)
**The Document's Home ribbon never fit — at the 880 px default its right third (Editing, part of Paragraph) was scrolled out of sight, at every block width.**
- Measured: full Home = 1587 px (Font 550, Paragraph 346, Styles 480, Editing 211). The hard-coded breakpoints (852/972) were written for a 962 px tab; Font, Styles and a new Editing group grew past them.
- Fix: compaction is measured per level (sum of group widths) and the fullest level that fits is used; new level folds Editing (Find/Replace/Painter) into one dropdown; the tightest level narrows the font box to 80 px.
- Verification: 880 px → natural 876 ≤ 878, nothing hidden (`audit/evidence/doc-ribbon-880-after.png`); 1620 px → full gallery; 720 px (minimum) → overflow fade as before. Editing dropdown → Find opens.

## DEF-015 · P2 · Interaction (hit-testing) · FIXED (verified)
**Pressing on a block's visible border did not resize it — on 18 of 19 block types.**
- Repro: select a Notes block, press on its right border line and drag. Nothing happens (width unchanged). Only a 4 px strip just *inside* the border worked.
- Root cause: `ResizeHandle` (10 px bands, 5 px either side of the edge) was rendered inside each block's body, and every body except Chat is `overflow:hidden`, so the outer half and the border itself were clipped out of hit-testing.
- Fix: one `ResizeHandle` on the block wrapper (same box, no clipping) instead of 19 inside the bodies; hidden in full screen; Countdown still has none.
- Verification: Notes, Table, Database, Kanban, Chat — pressing exactly on the border hits the `e` handle and widens by the dragged 100 px; 2 px outside also hits.

## DEF-016 · P3 · Polish · FIXED (verified)
**Every route had the same tab title, and the 404 was Next's bare stock page with no way back.**
- Fix: title template `%s · DataStudio`; server layouts name Sign in / Create an account / Reset your password / Choose a new password / Plans; `/app` shows "<project> · DataStudio"; `app/not-found.js` keeps the words and adds "Open DataStudio" / "Home".
- Verification: titles read back per route; 404 screenshot.

## DEF-017 · P3 · Visual · FIXED (code-verified)
**The keyboard-shortcuts dialog was 94 % opaque, so block titles under it showed through its text.** Fix: opaque `surface` background on that dialog only.

## DEF-018 · P2 · Usability · FIXED (verified after rebuild)
**"/h1", "/h2", "/h3" in a note matched nothing**, closed the slash menu and left "/h1" in the text. Fix: slash filter also matches the command id prefix.

## DEF-019 · P2 · Data correctness · FIXED (verified)
**European CSVs: "1.234,50" stayed text while "99,9" in the same column became a number**, so sums silently skipped it.
- Fix: dot-grouped thousands with a comma decimal (or ≥2 dot groups) parse as numbers in comma-decimal files. A lone "1.234" keeps its old reading (ambiguous).
- Verification: 4 unit assertions; in-app import shows 1234.5.

## DEF-020 · P1 · Data correctness · FIXED (verified)
**Every date imported from an .xlsx landed ONE DAY EARLY for users east of Greenwich — including Kyiv and Vilnius.**
- Repro: import an .xlsx with 2026-08-12 in a date cell, browser in Europe/Kiev → table shows 2026-08-11 (and 2026-09-01 → 2026-08-31).
- Root cause: SheetJS 0.18.5 with `cellDates:true` builds dates from a local `new Date(1899,11,30)` and corrects by `getTimezoneOffset()` (whole minutes); that epoch is in local mean time, which has seconds (Kyiv: 4 s), so each date became 23:59:56 the day before. AppPage then (correctly) read the local calendar day.
- Fix: `readWorkbook` reads serials with their number formats and builds local dates from `SSF.parse_date_code` calendar fields (1904 workbooks honoured).
- Verification: 13 unit assertions across UTC, Kyiv, Vilnius, Paris, New York, Kolkata (fail on the old code — 23:59:56); in-app import in Europe/Kiev shows 2026-08-12 / 2026-09-01.

## DEF-021 · P3 · Accessibility · FIXED (verified)
**Icon-only controls with no accessible name** (axe `button-name`, `label`): every block's × delete button, the project and sheet × buttons in the sidebar, and Kanban lane-name fields.
- LIVE (2026-10-16): the sheet × in the sidebar still reads as a nameless button in production.
- Fix: `aria-label`/`title` ("Delete block", "Delete project <name>", "Delete sheet <name>", "Lane name").
- Verification: axe over the canvas with 12 block types, each block selected, Settings/People/Account/Builder/Export/Add open — 0 `button-name`/`label`/`link-name`/ARIA violations (85 buttons pass).

## DEF-022 · P3 · Accessibility (contrast) · FIXED (verified)
**The active project, active sheet and selected file column were drawn in `accent` (#1D9E75) — 2.78:1 on the active-row fill.** `lib/theme.js` itself says accent is for "fills, borders and rings only"; text has `accentText` (#147154). Fix: those three use `accentText`. Remaining contrast findings are design tokens (OPEN_QUESTIONS Q4).

## DEF-023 · P3 · Copy · FIXED
Section delete dialog read "It holds 1 block. They can go with the section…" — singular now says "It can go…".

## DEF-024 · P3 · Data loss (small window) · FIXED (code-verified)
**Typing dropped by debounces that were never flushed on unmount:** Document footnotes (350 ms) and Agent instructions (500 ms). Switch sheet/project or close the panel inside the window and the last characters were gone. The Document body already flushed on unmount; these two did not.
- Fix: flush on unmount (both) and on blur (Agent instructions), from refs so cleanup sees the latest text.

## DEF-025 · P2 · Usability / placement · FIXED (verified)
**Imported blocks landed at a fixed world point (200,140)+jitter — under the 280 px sidebar, and on top of each other when several files were imported at once.** The Add menu had been fixed for exactly this; Import File, docx/markdown/file attachments and the sidebar's "Whole table" had not.
- Repro: Import File → doc.pdf + pic.png together. The image covers the PDF; the PDF's left edge is under the sidebar.
- Fix: the canvas publishes a placer (`placeRef`) using the Add menu's rule (in view, clear of blocks via `lib/placement.js`), remembers spots handed out in the last 4 s so a multi-file import does not stack, uses the type's real size, and moves the camera when no on-screen spot is free. Dropped files still land under the pointer.
- Verification: PDF + image + CSV table → 0 overlaps (was 2).

## DEF-026 · P2 · Data presentation (exports) · FIXED (verified)
**Every exported file name lost its non-ASCII letters.** The workspace exporters replaced anything outside `[a-z0-9-_ ]` with "_"; the Word/PDF document exporter replaced anything outside ASCII `\w` with "-".
- Repro (old code, real outputs): "Ataskaita už rugsėjį" → `Ataskaita u_ rugs_j_`; "Звіт за серпень" → `____ __ _______` (workspace export) and `document` (Word export); "Ataskaita — Vilnius Q3" → `Ataskaita _ Vilnius Q3`.
- Root cause: two hand-rolled ASCII allow-lists, written separately.
- Fix: one rule, `lib/filename.js` `safeFileName` — NFC, only characters file systems refuse (control, `< > : " / \ | ? *`) are replaced, dashes → "-", whitespace collapsed, trailing dots/spaces dropped (Windows), reserved DOS names prefixed, 80 characters. Used by `lib/exporters.js` and `lib/docexport.js`.
- Verification: `tests/filename.test.mjs` (9 assertions: Lithuanian, Ukrainian, emoji, reserved names, path separators, trailing dots, length, empty → fallback). Headless download of a Unicode-named export keeps the name (Chromium with a UTF-8 locale).

## DEF-027 · P3 · Data correctness (exports) · FIXED (verified)
**A table whose headers are all blank (every new or unnamed sheet) exported a CSV whose first line was bare commas**, so Excel and every importer read a blank header row and shifted the data down a row. Markdown export printed an empty header row.
- Fix: `tableForExport` — no header line when every header is blank (CSV); column letters A, B, C… as the Markdown header; Markdown cells escape newlines as `<br>` so a multi-line cell no longer breaks the table. Width stays the grid's (one column per header): a cell past the last header is never on screen, so it is not exported — a deliberate choice, documented in code and test.
- Verification: `tests/lib.test.mjs` +3 assertions; the existing "blank rows are skipped" assertion unchanged.

## DEF-028 · P2 · Sharing · OPEN — needs a product decision (OPEN_QUESTIONS Q6)
**A project or sheet shared to you by an account outside your workspace is listed under "Shared with me" but cannot be opened.** The row is clickable only when the notebook already exists locally (`notebooks.find(n => n.id === row.docId)`, app/app/page.js); the pull is filtered by `org_id`/`owner_id` (lib/sync.js), and a sheet-level grant deliberately does not carry the `docs` row (0008 §9). So the row reads "A shared project" / "Shared with you", has a default cursor, and does nothing on click — no message says why.
- LIVE (2026-10-16, Matas's Chrome): the row "Shared with you · one sheet" does nothing on click, and its chip reads "Shared from someone" — the sender's name is not resolved either.
- Not fixed: whether a shared project opens read-only, opens live (needs an RLS read path for granted docs), or is copied in is a product and security decision. Smallest honest interim: a tooltip/toast on click ("Opening shared projects is coming — ask the owner to invite you to the workspace"). See OPEN_QUESTIONS Q6.

## DEF-029 · P1 · Data loss (typing) · FIXED (verified)
**In a table, typing straight after Tab or Enter lost characters: "a, Tab, b,c" stored "c" (sometimes ",c").** Fast typists hit this on every row they type in.
- Repro: Table block → click A1 → type `a` → Tab → immediately type `b,c` → Enter. B1 holds `c`. Reproduced 3/3 in the real app; does not happen when the cell is opened by clicking (no pending hand-back).
- Root cause: `commitEdit` calls `refocus()`, which hands focus back to the grid one animation frame later (so the unmounting input's blur cannot steal it back). In the real app, re-rendering the canvas after the commit makes that frame late, and the next key had already opened the next cell. The deferred hand-back only skipped focus that was *outside* the grid — the new editor is *inside* it — so it pulled focus to the grid, the editor's blur committed "b" and closed, and "," reopened the same cell and replaced it. Event trace: `keydown b @grid → focusin INPUT → focusout INPUT → focusin grid → keydown , @grid`.
- Fix (`components/notebook/SheetGrid.js`): the deferred hand-back only acts when focus is nowhere (`<body>`); the editor now focuses in a layout effect (before paint, not after); and a printable key that still reaches the grid while a typed-over cell is opening is appended to it rather than dropped.
- LIVE (2026-10-16): not reproduced through the Chrome extension — it types slower than a frame per key, so the late frame always fires first. The race needs keys within one frame of Tab (fast typists; heavy sheets).
- Verification: in-app 5/5 correct (was 0/3). New browser regression (`tests/browser/run.mjs`, "table grid — typing straight after Tab"): the harness renders too fast to slip a frame, so the test delays animation frames deliberately — it FAILS on the old SheetGrid and passes on the fix.

## DEF-030 · P2 · Data loss (small window) · FIXED (verified in-app; browser regression written, NOT yet run)
**HTML typed into an HTML block in the last 600 ms before switching sheet, closing the project or closing the tab was lost.** Same class as DEF-024.
- Repro: HTML block → type `<p>LAST</p>` at the end → immediately click New Sheet → back to Sheet 1. The source and the saved block lack `<p>LAST</p>`. Control (wait 1 s before switching) keeps it.
- Root cause: `HtmlBlock` saved through a 600 ms debounce and its unmount cleanup only `clearTimeout`-ed it — the pending save was dropped, not flushed. No pagehide/visibilitychange flush either (TextBlockContent has both).
- Fix (`components/notebook/HtmlBlock.js`): the pending commit is kept in a ref and flushed on editor blur, on unmount, on `pagehide` and on `visibilitychange`.
- LIVE (2026-10-16, production build, Matas's Chrome): reproduced — typed `<p>LAST</p>`, clicked New Sheet, back to Sheet 1: gone. Control with a 1.5 s pause: kept. Test blocks and sheet deleted afterwards.
- Verification: in-app scenario 2/2 keeps `<p>LAST</p>` (was lost). Browser regression added to `tests/browser/run.mjs` (unmount with focus still in the editor) — its run was interrupted by Matas and is still pending. Sweep: every other unmount `clearTimeout` in components/ is a display timer (countdown tick, midnight re-render), not a pending write.

## DEF-031 · P1 · Crash (block-level) · FIXED (verified; LIVE-confirmed)
**Opening the Filter menu of any database — or the Name column's menu, a select with no options, the view menu of a board/calendar with nothing to group by, or the view menu on a database's only view — crashed the whole block** ("This database block couldn't be displayed — text2 is not defined"). The board's own empty state says "Click the highlighted view chip above", which is one of the crashing clicks.
- Repro (LIVE, production, 2026-10-16): Add → Database → Filter. Or: + → Board → click the Board chip. Error card every time; "Try again" recovers, no data lost.
- Root cause: four menus in `components/notebook/DatabaseBlock.js` (PropertyMenu, SelectMenu, ViewMenu, FilterMenu) used `text2` without destructuring it from `colors`. Every use is an empty-state hint, so normal-path tests (which had options, filters, several views) never reached it, and the server-render guards cannot open a menu.
- Fix: destructure `text2` in all four. Guard: new `scripts/check-undef.mjs` (ESLint `no-undef` only, JSON report, fails closed if the report is unreadable) added to `npm run check` — it fails on the old file with exactly these 7 lines and passes across all 188 files now. A first draft passed on the broken code (missing formatter swallowed the report); caught by testing the guard against the old file.
- Verification: browser regression "database — every menu opens without taking the block down" opens the view menu, title-column menu, empty filter menu and option picker — FAILS on the old file, passes now. In-app: Filter, title menu and the board view menu all open with their hints.

## DEF-032 · P2 · Interaction (canvas frozen) · FIXED (verified; LIVE-confirmed)
**After deleting a crashed block from its error card, the canvas stayed LOCKED over an empty sheet — wheel and pinch did nothing**, with nothing visible to click away from (Esc releases it, but nothing says so except the chip's tooltip).
- Repro (LIVE): crash a database (DEF-031) → Delete block on the error card → toolbar still shows LOCKED; scrolling does not move the dot grid. The Delete key path did not do this.
- Root cause: the error card called the raw `onDeleteBlock(id)`, skipping `deleteBlock()` — which clears the selection, animates, and offers UNDO. More generally nothing pruned `selectedIds` when a block disappeared by any other route (sync from another device, undo of an add, a section taking its children).
- Fix (`components/notebook/NotebookCanvas.js`): the error card uses `deleteBlock(block)`; and selection of blocks, shapes and the selected connection is pruned to what exists whenever those lists change.
- Verification: in-app with the crash reinstated in a throwaway build — after the error-card delete LOCKED is gone and the wheel pans (translate 60→−240). Undo-of-add while selected: not LOCKED.

## DEF-006 · update — FIXED (verified)
LIVE-confirmed 2026-10-16: after Add → Database, `document.activeElement` is `<body>`.
- Fix (`NotebookCanvas.enterFresh`): a new block with nothing to type into hands the keyboard to the canvas (role=application) when focus is nowhere; text blocks still take the caret.
- Verification: Database, Table, Kanban, Calendar, Countdown, Flashcards, and a mouse-driven add → canvas; Notes → its editor; HTML → its source. The canvas shows its existing subtle focus ring.

## DEF-033 · P2 · Visual (laptop widths) · FIXED (verified)
**Whenever anything was selected — most of the time — the project name read "M…" on 1280–1440 px screens (and "My Pro…" at 1700), and the sheet name collapsed to a "·…" stub.**
- Root cause: the title island lives in the left third of the `1fr auto 1fr` row (true-centred toolbar), ~200–265 px of room at laptop widths. The LOCKED chip (64 px) appears with any selection and the name was the only thing allowed to shrink, down to its 36 px floor. DEF-002 had fixed the unselected case only.
- Fix: the title column is a CSS size container (`container-type: inline-size`; its width comes from the grid, never its content). Under 300 px of room LOCKED becomes a lock badge (the word stays for screen readers and in the tooltip) and the full-screen button tightens; under 340 px the sheet name is hidden rather than stubbed (it is highlighted in the sidebar); under 250 px "100%" steps aside only while the zoom IS 100% (any other zoom shows it, clickable); under 210 px the island padding trims. Wide screens unchanged.
- Verification: "My Project" with a block selected, name width / natural width — before: 1280 36/84, 1366 36/84, 1440 37/84, 1700 70/84; after: 84/84 at 1280, 1366, 1440, 1536, 1700, 1920, island never clipped. Zoomed to 135% at 1280: zoom label back, name 73/84. A 31-character name truncates with the full name in the tooltip. Screenshots audit/evidence/title-before.png / title-after.png.

## DEF-034 · P3 · Copy · FIXED
**Count + plural noun with a count of one**, swept across app/, components/, lib/: sheet tooltip "Sheet 1 · 1 blocks", PDF reference card "1 pages", database filter message "All 1 rows are still here", sidebar drag label "· 1 columns", PDF text label "1 lines · 1 words", People "1 people", Crosscheck "1 rows" (×2), Export "(1 rows)". Also the project and sheet names (text cursor, rename on double-click) now say "double-click to rename" in their tooltips.
