# Supabase setup — step by step

Companion to `DATASTUDIO-BACKEND-PLAN.md` (one level above the repo). That
file is the *design*; this is the checklist to actually stand it up.

**Rewritten 25 Aug 2026**, when sync landed. The previous version described a
one-step pass — client, schema, RLS, and nothing else — and said in several
places that auth was stubbed and `lib/sync.js` did not exist. Both are false
now. If a statement here disagrees with the code, the code is right and this
file is stale: fix it.

The live project is `lfkkhosisnuwimbcntte` ("Ceza4's Project", free tier,
**eu-central-1**). Migrations 0001, 0002 and 0003 are all applied to it, and
`supabase/rls_pentest.sql` passes against it including its negative control.
Everything below is what a **fresh** project needs.

---

## 1. Project URL and anon key

1. https://supabase.com/dashboard → open the project.
2. **Project Settings** → **API**.
3. Copy the **Project URL** and the **anon / public** key.

The key format changed: new projects hand out `sb_publishable_…` rather than
the old `eyJ…` JWT. Both work — `check-supabase.mjs` and supabase-js 2.112
accept either. Note this if you ever look at a key and think it is malformed
because it is not a JWT.

Never copy the `service_role` key anywhere. It bypasses every RLS policy in
this document, and a `NEXT_PUBLIC_*` variable ships to the browser.

**Pick an EU region.** You are in the EU handling researchers' unpublished
data; the backend plan §7 spells out what that costs you. The live project is
in eu-central-1 (Frankfurt).

---

## 2. Run the migrations, in order

SQL Editor → New query → paste the whole file → Run. One at a time:

| File | What it does |
|---|---|
| `0001_init.sql` | The original schema. Its `notebooks`/`folders`/`images` tables are dropped by 0003 — run it anyway, because 0002 and 0003 build on the parts that survive (`profiles`, `usage`, `handle_new_user`, RLS setup). |
| `0002_harden_privileges.sql` | Column privileges. Its `plan` lockdown is still load-bearing. |
| `0003_cloud_everything.sql` | The current shape: one `docs` table, one `assets` manifest, one `ds-assets` bucket, prefs on the profile, realtime, and the 30-day purge policy. |
| `0004_tenants_quota_audit.sql` | Organisations, roles, plans, subscriptions, server-side quota, audit log. **Shipped broken — see 0005.** |
| `0005_repair_tenancy_and_quota.sql` | Repairs 0004 (which had made every client write fail) and closes three quota bypasses, a plan escalation and four data-integrity bugs. Section 6d explains each. |

Expect `Success. No rows returned` from each. **If one errors, stop and read
the error rather than re-running with a guess** — these build on each other in
order, and a partially applied migration is worse than none. Supabase runs
each file in a transaction, so a failure rolls the whole file back and leaves
you exactly where you started.

Two things 0003 will warn you about and cannot do itself:

- **The old `notebook-images` bucket stays.** `delete from storage.buckets` is
  refused by Supabase's own `storage.protect_delete()` trigger — a data-loss
  guard worth respecting. It never held an object. Delete it by hand in
  **Storage → Buckets** if the empty row bothers you.
- **Realtime** must be enabled on the project for section 10 to attach `docs`
  to the publication. If it was off, the migration raises a notice and you
  re-run just that section afterwards.

Sanity check: **Storage** should list `ds-assets`, marked private, with a
50MB per-file limit.

---

## 3. Local env

```
cp .env.local.example .env.local     # then fill in the two values from step 1
```

`.env.local` is gitignored; `.env.local.example` is deliberately un-ignored
(`!.env.local.example` in `.gitignore`) so the template stays committable.

---

## 4. Verify

```bash
npm install
npm run check:db             # migrations + both SQL suites, on a throwaway postgres
npm run check:supabase       # env vars, reachability, 4 tables, anonymous reads
npm test                     # 39 suites
npm run check                # 5 static guards
npm run build
```

`check:db` is the one that would have caught the 0004 breakage, and it is
worth understanding why nothing else did. It spins up a throwaway Postgres,
applies **every migration in order**, then runs both SQL suites against it —
`rls_pentest.sql` for the policies and `supabase/test/01_repair_checks.sql` for
the triggers and grants. Needs `postgresql-16` on the machine; it touches no
remote project and nothing outside its own temp directory.

`check:supabase` is **not** part of `npm run check`, on purpose: the other
guards run on every build and must work with zero network and zero config.

Read its closing note. Section 4 of that script is weak by construction — a
table with RLS enabled and *zero policies* also returns zero rows
anonymously, so it can show four green ticks against a schema that is
completely broken for real signed-in users. It is not a substitute for step 5.

---

## 5. The RLS penetration test — do this, don't skip it

```
SQL Editor → New query → paste supabase/rls_pentest.sql → Run
```

It runs inside a transaction that **rolls back**: two throwaway `auth.users`,
a document, a storage object and an asset row, all gone when it finishes.
Every check `raise`s on failure, so **silence is a pass** and a failure is one
loud red error naming the check that broke.

Ten sections: the signup trigger; the owner reading their own rows (a guard
against a policy so tight the isolation checks pass for the wrong reason);
user B blocked from reading A's documents, assets, profile, usage and *bucket
objects*; B blocked from forging or updating rows in A's namespace; `plan` not
self-upgradable while `display_name` and `prefs` still are; bytes and revs
computed server-side; the compare-and-set losing quietly rather than erroring;
the 30-day purge window, including that a client cannot backdate its own
tombstone to defeat it; the asset manifest being append-only; and `usage`
being unwritable by anyone.

**Then run the negative control at the bottom of the file** (it is commented
out; uncomment and run it separately). It asserts the OPPOSITE of check 2 —
that B *can* read A's document — and must produce:

```
ERROR: P0001 ... NEGATIVE CONTROL: B saw 0 rows (asserted 1)
```

If it passes silently, the harness is not surfacing failures and every PASS
above is worthless. **Any change to these policies means re-running both.** A
green suite that cannot go red proves nothing.

One thing the pen test itself will teach you: `docs_before_write` clamps
`deleted_at` for *every* writer, `postgres` included, so the test has to
disable that trigger to simulate a 31-day-old tombstone. In production
nothing needs to backdate one — they age by the passage of time — but it does
mean restoring a dump of old tombstones resets their clocks, which errs
toward keeping data longer.

---

## 6. Auth settings to check in the dashboard

These are switches, not code, and the app behaves differently depending on
them:

- **Email confirmation** (Authentication → Providers → Email → "Confirm
  email"). Currently **ON**. `signUp()` therefore returns a user and *no*
  session, which `lib/auth.js` reports as its own `CONFIRM_EMAIL` status and
  the signup page renders as a "check your inbox" screen. If you turn it off,
  that screen simply stops appearing — nothing breaks.
- **The built-in SMTP is rate-limited to a couple of emails an hour.** That
  is the thing that will actually slow you down testing two accounts. Either
  turn confirmation off while testing, or add a real SMTP provider.
- **Google** is off, which is why the Google buttons on the login and signup
  pages render disabled with a title explaining why. Turning it on in the
  dashboard is all that is needed — there is no code change.

---

## 6b. Testing a paid plan without paying

There is no payment provider, and `subscriptions` is deliberately unwritable
by the browser — migration 0004 revokes `insert, update, delete` from
`authenticated`, which is exactly what stops a user promoting themselves to
Pro from the console. That leaves one legitimate route in: the SQL editor,
which runs as the service role.

`supabase/dev/set_plan.sql` is that route, written down so it is repeatable
and so the checks happen before the write rather than after a typo.

1. SQL Editor → New query, paste the whole file
2. Change the two values in section 1 (email, and `free` | `pro` | `max`)
3. Run — it prints the resulting plan and its limits
4. In the app, sign out and back in

Step 4 is not optional. `lib/limits.js` caches the plan in memory and refetches
it via `my_account()` only on a session change, so a promotion applied while a
tab is open is invisible to that tab.

Set the plan back to `free` the same way. Downgrading never deletes anything:
`org_plan()` treats over-quota as "new pushes queue", never as "data is
removed" — see the comment above that function for why `past_due` behaves the
same way.

---

## 6c. The contact address

`app/pricing/page.js` reads `NEXT_PUBLIC_CONTACT_EMAIL`. Leave it unset and
the paid tiers read **Not on sale yet**; set it and they become a mailto
button.

It used to be a hardcoded `hello@datastudio.app`. **That address does not
exist** — it was invented while writing the page. Nothing was ever received at
it, and anyone who clicked it got a bounce or, worse, nothing at all.

To make it real you need two separate things:

1. **The domain.** `datastudio.app` has to be registered by you. `.app` is a
   Google-run TLD with HSTS preloaded, so it is https-only — fine here, and
   worth knowing before you buy.
2. **A mailbox on it.** The cheapest working option is Cloudflare Email
   Routing (free): point the domain's nameservers at Cloudflare and forward
   `hello@` to your Gmail. It is receive-only — replies come from your Gmail
   address unless you also configure Gmail's "send mail as" with an SMTP
   relay. Paid alternatives that send properly: Google Workspace, Fastmail,
   Zoho.

The transactional email in `supabase/email/` is a **third**, separate thing —
that is a *sending* domain for Supabase Auth, and needs SPF/DKIM/DMARC records
plus an SMTP provider (Resend, Postmark, SES). See `supabase/email/README.md`.
Verification mail keeps working on Supabase's shared sender until then; it is
rate-limited and lands in spam more often, which is the actual reason to move.

---

## 6d. What 0005 repaired, and the lesson in it

Migration 0004 made `docs.org_id` and `assets.org_id` NOT NULL with no default
and no BEFORE INSERT trigger to fill them, and moved the storage path from
`{user_uuid}/…` to `{org_id}/…` without changing the client that builds it.
**Every document push and every asset upload had been failing since the moment
it was applied.** The user-facing symptom was the worst possible one: a paying
account being told *"the Free plan does not include cloud sync"*, because
`org_plan(NULL)` fell back to free.

It shipped because `rls_pentest.sql` writes its own `org_id` and its own
org-shaped storage path. It proved the policies were correct about a request
the application never makes — the half of the contract it already agreed with.
`supabase/test/01_repair_checks.sql` is the other half: it inserts the exact
payload `lib/sync.js` sends.

0005 also closed three unbounded quota bypasses, two of which made the limits
entirely decorative:

| | what it allowed |
|---|---|
| a row could arrive already `deleted_at` | the check returned early on INSERT too, so tombstoned rows were free storage — and still readable |
| a multi-row insert | usage is maintained by AFTER triggers, so all 50 rows of one array POST checked against the same pre-statement total |
| deleted-but-not-purged bytes | fill the plan, delete, refill; N plans' worth of real storage for one plan's price |

plus a plan escalation (`docs_pin_org` fired *after* the quota trigger, so
entitlement was decided from a client-supplied `org_id`), a tenant that a
departing creator could brick permanently, an asset row that became
un-retirable once its object was gone, and a `unique (path)` constraint that
made the deduplication path — documented in two places — raise `23505` every
time it was taken.

Run `npm run check:db` before and after any migration. All of the above are
locked down as failing-first checks.

---

## 7. What exists now

- `lib/supabaseClient.js` — the only place `createClient` is called. Returns
  `null` when unconfigured, so local-only use survives a missing env var.
- `lib/auth.js` — sign up / in / out, cross-tab aware. Auth never gates local
  use.
- `lib/sync.js` + `lib/syncdocs.js` — push, pull, compare-and-set, conflict
  copies, realtime.
- `lib/outbox.js` — the crash-proof queue that makes "what if they quit"
  recoverable.
- `lib/cloudassets.js` — images, PDFs and attachments to the `ds-assets`
  bucket, upload-then-manifest.
- `lib/limits.js` — real quota metering, `ENFORCE = true`.
- `supabase/dev/set_plan.sql` — put an account on a paid plan by hand, for
  testing. Development only.
- `supabase/test/run.sh` — every migration + both SQL suites on a throwaway
  Postgres (`npm run check:db`).
- `app/api/_guard.js` + `lib/samesite.js` — the Sec-Fetch-Site / Origin check
  on the two account routes. Neither had any CSRF protection: their whole
  authentication was "a session cookie was attached", and `SameSite=Lax` is
  site-scoped, so any sibling subdomain could POST to them.

### Deliberately dead schema

`profiles.avatar_path`, `profiles.avatar_updated_at` and the `avatars` bucket
(all migration 0004) are unused. The profile picture was removed when the
account control became a labelled `Account` button beside Builder and Settings
— there is no longer a circle for a portrait to fill — and the client half went
with it out of `lib/account.js`.

The columns and the bucket stay because dropping them costs a migration against
production and Supabase refuses bucket deletes through SQL, while leaving them
costs three empty columns. `my_account()` returns `avatar: null`, which is
honest. If a portrait is ever wanted again, the storage side is already
built.

## Known gaps, written down rather than forgotten

- **MFA is enforced in `proxy.js`, not in the database.** The middleware now
  refuses a session whose `nextLevel` is aal2 while `currentLevel` is not — so
  a stolen password alone no longer reaches `/app` or the account routes. The
  belt to that brace is an RLS policy keyed on `auth.jwt()->>'aal'`, which
  needs its own migration and its own pen-test case.
- **Nothing enumerates the storage bucket.** An object whose manifest INSERT
  failed is now recorded in the outbox and reclaimed by the client
  (`reclaimOrphan`), but a server-side sweep over `storage.objects` is the only
  thing that can catch one the client never gets to retry.
- **`recompute_usage_org` is still FOR EACH ROW.** 0005's covering partial
  indexes make it an index-only scan, but a statement-level trigger with
  transition tables would be cheaper again. Left alone because it changes when
  the recompute runs relative to the quota check.
- **The CSP still carries `'unsafe-inline'`.** See the note at the top of
  `proxy.js`. It is honest about being an open gap and records how to retest.

## What is still ahead

- **Sharing and collaboration.** Nothing in the schema is shared between
  accounts; `PLANS.*.sharing` is a flag nothing reads.
- **Billing.** Only once pricing is decided (backend plan §6, step 9).
- **Account deletion and data export.** GDPR erasure works by cascade from
  `auth.users`, but there is no UI for either.
- **`tests/browser/` coverage of sync.** Everything in `lib/sync.js` that
  touches timers, listeners and the network is untested in a real browser —
  which is precisely `smoke.render`'s blind spot, and where every bug that has
  reached a user in this codebase has lived.
