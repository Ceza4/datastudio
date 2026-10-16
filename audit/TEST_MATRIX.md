# Test matrix

Scenario scripts live in `audit/e2e/scen/` (run with `node step.mjs scen/<file>`). Each line: what is driven → expected → result. "PASS" means the outcome was checked, not merely that the script ran. Results of the final full run are in REGRESSION_MATRIX.md.

## Canvas and keyboard
| Scenario | Expectation | Result |
|---|---|---|
| k1–k7, kb1–kb3, km1–km3 | keyboard mode M, arrows, Enter/Esc levels, G grab, toolbar Tab | PASS |
| focus6, focus7 | after Add, keyboard is on the new block's text field or the canvas, never `<body>` | PASS (DEF-006) |
| keys1, addmenu2 | shortcuts list = real keymap; Add menu shows keys; C creates a Calendar, M enters keyboard mode | PASS (DEF-036) |
| tab1, tab2, tab3 | Tab order: no invisible controls; projects/sheets reachable; collapsed sidebar skipped | PASS (DEF-035) |
| drawpanel, drawpanel2 | Draw options reachable by keyboard; Esc closes onto Draw; hover still works | PASS (DEF-038) |
| kbside | file / workbook-sheet toggles and zoom reset by keyboard | PASS (DEF-038) |
| ghost1 | delete from error card → not LOCKED, wheel pans | PASS (DEF-032) |
| fs1 | full screen enter/leave, hold-Esc | PASS |
| title1–title5 | project name whole at 1280–1920 with a selection; zoomed; long names | PASS (DEF-033) |

## Blocks
| Scenario | Expectation | Result |
|---|---|---|
| block-battery.mjs | 13 types create, edit, reload intact | PASS |
| g1, g-race, g-race2, exp3, exp3b | grid typing after Tab keeps every key; Escape levels; undo | PASS (DEF-029) |
| db1, db2 | rows, views, every menu opens in its empty state | PASS (DEF-031) |
| d1–d7, tx1 | Notes/Document editing, ribbon at widths, footnotes flush | PASS |
| kb*, task1, task2, cal1, cal2–cal4, st1, st2 | Kanban, Task, Calendar (title readable), Countdown | PASS (DEF-037) |
| fc1 | flashcards add, bulk paste, study, grade, Esc, persist | PASS |
| html1, html1c | HTML run, sandbox (parent/localStorage blocked), Esc leaves editor, typing kept across sheet switch | PASS (DEF-030) |
| chat1 | send, render; Delete in composer keeps block | PASS (author label: see Q8) |
| vis1, vis2, mind1 | shapes, connector follows, shape text, undo/redo ×3, reload; mind map by keyboard | PASS |
| squeeze | 14 types at default size: no text squeezed below 60% | PASS |

## Workspace, files, data
| Scenario | Expectation | Result |
|---|---|---|
| sh1–sh3, sb1, nav1 | sheets add/switch/rename/delete, undo across sheets | PASS |
| proj1 | project create, folder drag, delete → UNDO toast and Ctrl+Z, reload | PASS |
| two-device-undo.mjs / two-device-grid-undo.mjs | undo never removes another device's work | PASS 7/7, 6/6 (DEF-003/011) |
| im1–im3, imp-place, pdf1, pdf2 | CSV/XLSX/PDF/image imports; dates; placement in view, no overlap | PASS (DEF-019/020/025) |
| exp1, exp2, dl1 | CSV/Markdown content; Unicode file names | PASS (DEF-026/027) |
| cp1, cp2 | copy/cut/paste across sheets without clipboard permission; cascade; undo cut | PASS (DEF-039) |
| sy1, sync-err* | offline/queued/error states of the sync chip | PASS |
| rn1 | rename fields: Enter commits, Escape cancels, blur commits | PASS (DEF-009) |
| ax1–ax5 | axe on canvas + panels: 0 name/label violations | PASS (contrast tokens: Q4) |
| pf1, pf2 | 50k-row import ~1 s, insert ~230 ms, undo ~70 ms | PASS |
| sec1 | HTML preview CSP / sandbox | PASS |
| public-pages.mjs | public routes, titles, 404 | PASS |

## Live site (Matas's Chrome, empty project, cleaned up)
| Check | Result |
|---|---|
| DEF-029 at extension typing speed | not reproduced (too slow to hit the frame) |
| DEF-030 HTML typing lost on sheet switch | reproduced; control kept |
| DEF-031 Filter / Board chip crash | reproduced ×2; "Try again" recovers |
| DEF-032 LOCKED with empty canvas | reproduced |
| DEF-006, DEF-021, DEF-028 | reproduced |
