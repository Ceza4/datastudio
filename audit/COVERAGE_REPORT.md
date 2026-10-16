# Coverage report

Honest status per area. "Covered" means driven in a real browser with the outcome checked, not just rendered.

| Area | Status | Evidence / gap |
|---|---|---|
| Routes (/, /app gate, login, signup, forgot, reset, pricing, 404, html-preview) | Covered | public-pages.mjs; titles; 404; proxy gate fail-closed (code + mock) |
| Canvas: add (menu, keys, palette), select, marquee, drag, resize, delete, duplicate, grab (G), keyboard mode (M), full screen, zoom/pan, lock | Covered | k*, kb*, km*, rs*, s*, fs1, focus6, ghost1 |
| Undo/redo (workspace + grid), two-device | Covered | two-device-undo.mjs 7/7, two-device-grid-undo.mjs 6/6, sh1 |
| Persistence (reload, IndexedDB) for 13 block types, files, shapes | Covered | block-battery.mjs, vis2, proj1 |
| Multiple tabs | Covered | LIVE + e2e twotab/stalereload: false stale banner (DEF-043), dead Reload (DEF-044), real conflicts still caught |
| Sync (outbox, conflicts, errors) | Partly | mock PostgREST; realtime socket blocked by CSP in the mock setup — realtime not exercised |
| Table grid (edit, Tab/Enter, Escape levels, undo, fill, clipboard TSV) | Covered | g*, exp*, browser suite |
| Database (table/board/calendar/gallery views, menus, filter) | Covered | db1, db2, browser suite (DEF-031) |
| Notes, Document (ribbon, pages, footnotes, DOCX) | Covered (main paths) | d1–d7, tx1, browser suite |
| Kanban, Task, Calendar, Countdown, Section, Flashcards, HTML, Pipeline, Record | Covered (main paths) | kb*, task*, cal*, st*, fc1, html1, squeeze |
| Chat | Partly | send/render; LIVE: first-message race found (DEF-048), own label "You" confirmed; multi-user realtime not testable here |
| Agent | Partly | instructions flush (DEF-024); no model calls made (real cost, out of scope) |
| Visuals (shapes, connectors, text, mind map), Draw/pen | Covered | vis2, mind1, drawpanel2 |
| Sidebar (projects, sheets, folders, files, drag, delete/undo, keyboard) | Covered | proj1, kbside, tab3 |
| Imports (CSV incl. European, XLSX dates/1904, PDF, image, DOCX, Markdown, 50k rows) | Covered | im*, imp-place, workbook tests |
| Exports (CSV, Markdown, DOCX names) | Covered | exp1, exp2, dl1, unit tests |
| People / sharing | Partly | panels open; DEF-028 (opening shared projects) is a product gap |
| Account / auth / MFA / billing | Partly (read-only, LIVE) | Plan / Security / Privacy screens opened, nothing submitted; Privacy policy + ToS missing (Q11); no credential or billing actions (out of scope) |
| Accessibility | Covered (automated + keyboard) | axe (0 name/label violations), Tab walks, keyboard parity sweep; contrast tokens open (Q4); no screen-reader session |
| Performance | Spot-checked | 50k-row CSV ~1 s, table insert ~230 ms, undo ~70 ms, scroll long tasks 55–64 ms; LIVE first load: TTFB 171 ms, FCP 1.5 s, 2.26 MB JS → main chunk −26 % (DEF-045) |
| Security | Spot-checked | HTML sandbox (no parent/storage access), CSP, sanitizer suite in browser tests; no penetration testing (out of scope) |
| Browsers | Chromium only | Firefox/Safari not available in this environment |
| Viewports | 1280–1920 wide, 698–900 tall | no mobile layout pass |
