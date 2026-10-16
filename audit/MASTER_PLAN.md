# Reliability audit — master plan

Started 16 Oct 2026 (Europe/Kiev). Brief: exhaustive reliability, interaction,
UI/UX, persistence and regression audit of DataStudio, with autonomous fixes on
a separate branch. **Nothing in this audit is deployed.**

## Safety rules in force

- Work happens on branch `audit/reliability-oct16`, cut from `main` at `c990efe`.
  `main` is what Vercel deploys, so this branch is pushed but never merged by
  the audit. (Your standing rule is "push straight to main"; the brief's rule is
  "never deploy without explicit approval". The brief wins for this job — the
  merge is yours to make.)
- The live site (datastudioreimagined.com) is used read-mostly through your
  signed-in Chrome, on a fresh test project only. No credentials are typed by
  the agent.
- Heavy scripted testing runs locally against a **Supabase test double**
  (`audit/e2e/mock-supabase.mjs`): the production build is compiled with
  `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321` and the double answers
  `/auth/v1/user` for one fixed fake user and keeps PostgREST tables in memory.
  No production code is altered to make this possible — the real proxy.js gate,
  real sync, real IndexedDB all run.

## Environment (discovered, not assumed)

| | |
|---|---|
| Framework | Next.js 16.1.7 (Turbopack), React 19.2.3, plain JS |
| Routes | `/`, `/app` (gated by proxy.js), `/login`, `/signup`, `/forgot`, `/reset`, `/pricing`, `/sandbox/html-preview`, API: `/api/agent`, `/api/account/delete`, `/api/account/export` |
| State | `app/app/page.js` (AppPage, ~3.7k lines) owns workspace state; `NotebookCanvas.js` (~7k lines) owns canvas interaction state |
| Persistence | IndexedDB/localStorage (`lib/persistence.js`) + Supabase sync (`lib/sync.js`, outbox) |
| Undo | `lib/undo.js`, workspace-snapshot stack in AppPage |
| Tests | `npm test` (node, 62 suites), `npm run check` (6 static guards), `npm run test:browser` (Playwright harness, isolated components), `npm run check:db` (needs Postgres) |
| CI | `.github/workflows/security.yml` — audit, tests, guards, build |

## Baseline (before any change, commit c990efe)

| Check | Result |
|---|---|
| `npm test` | **PASS** — 62 suites, 3022 assertions, 10.6 s |
| `npm run check` | **PASS** — all 6 guards |
| `npm run build` | **PASS** — exit 0 |
| `npx eslint .` | **FAIL (pre-existing)** — 196 problems (177 errors, 19 warnings); 147 are React-compiler `set-state-in-render`/"renders" rules |
| `npm run test:browser` | **FAIL (pre-existing)** — aborted at "text rail" with a 30 s TimeoutError. Root cause: the test was stale, not the app (see DEF-001). |
| `npm run check:db` | NOT RUN — needs a local Postgres; recorded as blocked |

## Completion gates

See the brief §30. Status of each is tracked in COVERAGE_REPORT.md; nothing is
counted as passed unless a scenario in TEST_MATRIX.md says PASS with evidence.

## Current phase

Final regression and independent review (RUN_LOG batch 15). 39 defects logged: 38 fixed and verified, DEF-028 open (product decision), DEF-031 recommended for an immediate hotfix (OPEN_QUESTIONS Q0).

## Ledger

DEFECTS · FIX_LOG · TEST_MATRIX · REGRESSION_MATRIX · COVERAGE_REPORT · OPEN_QUESTIONS · RUN_LOG · APPLICATION_MAP · INTERACTION_GRAPH · e2e/ (harness and every scenario).
