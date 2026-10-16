# Audit e2e harness

Drives a production build of DataStudio in headless Chromium against a local
Supabase test double. Nothing here talks to the real backend.

- `mock-supabase.mjs` — answers `/auth/v1/user` for ONE fake user
  (`e2e@example.test`, token minted in `lib.mjs`) and keeps PostgREST tables in
  memory. `start-mock.sh` runs it on :54321.
- `rebuild.sh` — builds the app with `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`
  and serves it on :3100.
- `start-chrome.sh` — headless Chromium on :9333 (UTF-8 locale, for download names).
- `step.mjs scen/<file>.js` — runs one scenario with `page`, `context`, `shot`,
  `sleep` and the helpers in `h.js` / `hist.js`; `//@include fresh.js` resets to
  an empty workspace.
- Paths are absolute to the audit machine (`/home/claude/e2e`); adjust before reuse.
- `fixtures/big.csv` (50,000 rows) is not committed:
  `node -e "let s='id,name,score\n';for(let i=0;i<5e4;i++)s+=i+',row '+i+','+(i%97)+'\n';require('fs').writeFileSync('fixtures/big.csv',s)"`
