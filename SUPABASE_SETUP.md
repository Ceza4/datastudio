# Supabase setup — step by step

Companion to `DATASTUDIO-BACKEND-PLAN.md` (one level above the repo). That
file is the *design*; this is the checklist to actually stand it up. Scope of
this pass: plan step 1 only — project, schema, RLS, and the client that reads
it. **No auth UI changes** — `login/page.js` and `signup/page.js` are still
the `setTimeout` stubs, on purpose. That's the next piece of work, not this
one.

Do these in order. Don't skip step 5.

---

## 1. Find your project URL and anon key

You said you'd already connected GitHub to Supabase, so a project should
exist.

1. Go to https://supabase.com/dashboard and open the project.
2. Left sidebar → **Project Settings** (gear icon) → **API**.
3. You'll see two values under "Project API keys":
   - **Project URL** — looks like `https://abcdefghijk.supabase.co`
   - **anon / public** key — a long string starting with `eyJ...` (it's a JWT)
4. Copy both. You will **not** need the `service_role` key for anything in
   this pass — if the dashboard shows one, ignore it. It bypasses every RLS
   policy and should never leave the dashboard.

If no project exists yet: **New project** → pick a name, a database
password (save it somewhere — you won't need it for this pass, but you will
later), and a region. EU region if you want data residency to match the GDPR
note in the backend plan. Creation takes about two minutes.

---

## 2. Run the schema migration

1. In the dashboard, left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0001_init.sql` from this repo, copy the whole
   file, paste it into the editor.
3. Click **Run**.
4. You should see `Success. No rows returned`. If you see an error instead,
   stop and paste the error back — don't re-run with edits guessed on the
   fly, the tables/triggers build on each other in order.

What this creates: `profiles`, `notebooks`, `folders`, `images`, `usage`
tables; RLS policies on all five; a trigger that creates a `profiles` +
`usage` row automatically when someone signs up; a trigger that keeps
`usage` in sync whenever `notebooks`/`images` change; and a private Storage
bucket called `notebook-images` with a policy scoping it per-user.

5. Sanity check the bucket: sidebar → **Storage** → you should see
   `notebook-images` listed, marked private.

---

## 3. Set up your local env

1. In the repo root: copy `.env.local.example` to `.env.local`.
2. Fill in the two values from step 1:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijk.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```
3. `.env.local` is already gitignored (check `.gitignore` if you want to
   confirm) — it will never get committed.

---

## 4. Install and verify

```bash
npm install                  # picks up @supabase/supabase-js from package.json
npm run check:supabase       # the new verification script
```

You should see four numbered sections, all `✓`. If anything shows `✗`, the
message tells you which step to redo — usually either the env vars (back to
step 3) or the migration didn't fully apply (back to step 2).

Then confirm nothing else broke:

```bash
npm test
npm run check
npm run build
```

All of these should behave exactly as before — this change is additive.
`getSupabase()` returns `null` when unconfigured, so none of the existing
app code (which doesn't call it yet) is affected either way.

---

## 5. The RLS penetration test — do this, don't skip it

`npm run check:supabase` already automates the anonymous half of this (step
4 in its output: confirms an anonymous request gets zero rows from every
table). But automate-and-trust is exactly the habit the backend plan warns
against ("test RLS by trying to break it, not by reading the policy"). Do
the manual version once, by hand, so you've actually seen it work:

1. In the Supabase dashboard, **Authentication** → **Users** → **Add user**
   twice, creating two throwaway accounts (any email/password — you can
   delete them after).
2. **Table Editor** → `notebooks` → insert one row manually, setting
   `owner_id` to user A's id (copy it from the Users list).
3. **SQL Editor** → run a query *as user A* using
   `set local role authenticated; set local request.jwt.claims = '{"sub":"<user-A-uuid>"}';`
   then `select * from notebooks;` — you should see the row.
4. Change the claim to user B's uuid, re-run — you should see **zero rows**,
   even though the row exists in the table.
5. If step 4 returns user A's row to user B, RLS is not working — stop and
   don't build anything on top until that's fixed. (Likely cause: RLS was
   enabled but the policy didn't get created, or got created on the wrong
   table.)

Delete the two test users and the test row when done.

---

## 6. Commit

```bash
git add package.json package-lock.json lib/supabaseClient.js \
        .env.local.example supabase/migrations/0001_init.sql \
        scripts/check-supabase.mjs SUPABASE_SETUP.md
git commit -m "Add Supabase client, schema, and RLS (plan step 1)"
git push
```

`.env.local` itself is never committed — that's the point of it being
gitignored. Whoever works on this next (you, or the other agent) needs their
own copy from step 3.

---

## What's deliberately NOT in this pass

Straight from the backend plan's order-of-work — steps 2 onward are separate
work, not done here:

- Real auth (magic link / Google), replacing the login/signup stubs
- `middleware.js` route protection
- First-sign-in adoption of existing local IndexedDB notebooks
- `lib/sync.js` — the actual push/pull/conflict-copy logic
- Image upload to the `notebook-images` bucket + signed URLs
- Sync status UI in Settings
- Enforcing `lib/limits.js` (it already exists with `ENFORCE = false`; leave
  it that way)
- Realtime subscription, billing

If you or the other agent pick one of these up next, re-read
`DATASTUDIO-BACKEND-PLAN.md` §3–§5 first — the conflict-handling and
first-sign-in-adoption sections in particular have specific reasoning behind
the design that's easy to accidentally simplify away.
