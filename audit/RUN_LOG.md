# Run log

All times Europe/Kiev, 16 Oct 2026.

| Batch | What ran | Outcome |
|---|---|---|
| 0 · baseline | npm test, check, build, lint, test:browser on c990efe | Unit/guards/build PASS; lint 196 pre-existing; browser suite aborted (stale test → DEF-001) |
| 1–6 | Inventory, interaction graph, undo/sync two-device runs, rename/cancel matrix, grid, imports (CSV/XLSX/PDF/image/DOCX), exports, a11y (axe), performance (50k-row CSV), live-site spot checks | DEF-001…025 found and fixed (commits 4572a48…e31b46c) |
| 7 | Grid typing race (traced to deferred refocus), export file names, CSV headers | DEF-026, 027, 029 fixed; DEF-028 logged |
| 8 | Flashcards (PASS), HTML block (DEF-030), live confirmations in Matas's Chrome on an empty project (cleaned up after) | DEF-030 fixed; production crash DEF-031 found live, fixed, guard added; DEF-032 found live, fixed |
| 9 | Focus after add, title island at 6 widths, plural sweep | DEF-006, 033, 034 fixed |
| 10 | Tab-order walk, sidebar keyboard, inert | DEF-035 fixed |
| 11 | Keymap vs shortcuts list, calendar header, squeeze sweep of 14 block types (clean) | DEF-036, 037 fixed |
| 12 | jsx-a11y click-without-key sweep (19 hits triaged) | DEF-038 fixed |
| 13 | Projects/folders (drag, delete, undo, reload — PASS), Visuals shapes+connector (PASS), mind map (PASS), copy/paste across sheets | DEF-039 fixed |
| 14 | Lint vs main | 0 new findings on audit lines except 3 documented false positives (shared ribbon `menuRow` helper, same as 35 on main) |
| 15 · regression | npm test 63 suites / 3,077 assertions PASS · check 8/8 PASS · test:browser 166/166 PASS · build PASS · all e2e scenarios (see REGRESSION_MATRIX) | see REGRESSION_MATRIX |

## Incidents

- Test Chromium died silently during the first full e2e run; the runner then reported every script clean because it only looked for script/page errors. Caught when spot-checks returned ECONNREFUSED. Runner rewritten to fail closed (needs a result object and zero errors of any kind, restarts Chromium between scripts) and the whole run repeated. The first run's "111 clean" is void.
- A safety-check outage blocked shell commands twice; file edits continued through the editor.
