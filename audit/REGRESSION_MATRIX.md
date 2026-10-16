# Regression matrix — final run, 16–17 Oct 2026

| Suite | Result |
|---|---|
| `npm test` | **PASS** — 63 suites, 3,103 assertions (baseline 62 / 3,022) |
| `npm run check` | **PASS** — 8/8 guards (added check-undef; it fails on parse errors too) |
| `npm run test:browser` | **PASS** — 166/166 (baseline aborted after 61). DEF-029/030/031 regressions each FAIL on the pre-fix file |
| `npm run build` | **PASS** · main JS chunk 1.58 MB → 1.17 MB (DEF-045) |
| ESLint | 197 vs 181 on main — 13 on OLD page.js lines the linter now analyses (it skipped AppPage on main), 3 documented false positives on the ribbon's shared `menuRow`; zero elsewhere on audit lines |
| E2E (fail-closed runner, `audit/e2e`) | **115 / 123 PASS** on the build before the second review's fixes; the 8 FAIL are not regressions — ghost1 + rev2 (deliberately crash a block / need the old bug), k5 (tooltip renamed by DEF-005), cal1 / g-race / v1 (continue from a previous step), rs5 (pre-DEF-015 markup), s1 (first-run only). After the second review's fixes: dismiss2, dismiss3, clickwrite, panelfocus, twotab, stalereload, chat1 re-run — all as expected |
| Two-device undo | PASS 7/7, 6/6 |
| Failing-on-old-code repros | rev1 (DEF-040/041), twotab (DEF-043), ghost/db (DEF-031/032), html1 (DEF-030), exp3b (DEF-029) |
| Live (Matas's Chrome) | Reproduced on production before fix: 006, 021, 028, 030, 031, 032, 043, 044, 046, 048. Nothing deployed; every test block, sheet and the test chat message removed |

Not run: `npm run check:db` (needs Postgres), WebKit/Firefox, mobile widths, screen reader, real payments/auth changes (out of scope).
