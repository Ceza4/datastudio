# Regression matrix — final run, 16 Oct 2026

| Suite | Result |
|---|---|
| `npm test` | **PASS** — 63 suites, 3,083 assertions (baseline 62 / 3,022) |
| `npm run check` | **PASS** — 8/8 guards (baseline 6; added: check-undef, plus registry shortcut assertions inside tests) |
| `npm run test:browser` | **PASS** — 166/166 (baseline: aborted after 61, DEF-001). New regressions DEF-029/030/031 each FAIL on the pre-fix file |
| `npm run build` | **PASS** |
| ESLint | 197 problems vs 181 on main. All 16 extra are React-compiler rules: 13 on OLD page.js lines the linter now analyses (it skipped AppPage on main), 3 documented false positives on the ribbon's shared `menuRow` helper (35 identical on main). Zero on any other audit line |
| E2E scenarios (fail-closed runner, `audit/e2e`) | **104/111 PASS**. 7 FAIL, none a regression: ghost1 (needs the DEF-031 crash put back — by design), k5 (selector of a tooltip renamed by DEF-005), cal1 / g-race / v1 (continue from a previous step's state), rs5 (inspects pre-DEF-015 markup), s1 (first-run empty state only) |
| Review repros (rev1, rev2) | **PASS** on the fixed build; rev1 FAILS on the pre-fix page.js (wrong block restored, footnote lost) |
| Two-device undo (table + workspace) | **PASS** 7/7, 6/6 |
| Live site (Matas's Chrome) | Defects reproduced before fix: 006, 021, 028, 030, 031, 032. Nothing deployed; test blocks removed |

Not run: `npm run check:db` (needs a local Postgres), WebKit/Firefox, mobile widths, screen reader.
