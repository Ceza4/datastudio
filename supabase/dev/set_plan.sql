-- ===========================================================================
--  supabase/dev/set_plan.sql — put an account on a paid plan by hand
-- ===========================================================================
--
--  WHY THIS FILE EXISTS
--
--  There is no payment provider yet. `subscriptions` is written by nobody:
--  migration 0004 revokes insert/update/delete from `anon` and `authenticated`
--  precisely so that a browser cannot promote itself to Pro by editing a row.
--  That is the right default and it means the only way to *test* Pro is to
--  come in above the client, through the SQL editor, as the service role.
--
--  This is a DEVELOPMENT tool. Running it against production is how you end up
--  giving away the product; the guard in section 0 exists to make that a
--  deliberate act rather than a paste-and-run accident.
--
--  HOW TO USE
--    1. Supabase dashboard → SQL Editor → New query
--    2. Paste this whole file
--    3. Change the two variables in section 1
--    4. Run. It prints what it changed.
--    5. In the app: sign out and back in, or reload — lib/limits.js caches the
--       plan in memory and only refetches via my_account() on session change.
--
--  TO GO BACK, set the plan to 'free' and run it again. Nothing is deleted
--  when you downgrade: see org_plan() in 0004 — over-quota means new pushes
--  queue, it never means data disappears.
-- ===========================================================================

begin;

-- ── 1. who and what ────────────────────────────────────────────────────────
-- The email of the account to change, and one of: free | pro | max
create temporary table _args on commit drop as
select
  'melkunas.matas@gmail.com'::text as email,
  'pro'::text                      as plan;

-- ── 2. sanity, before anything is written ──────────────────────────────────
do $$
declare
  v_email text;
  v_plan  text;
  v_uid   uuid;
begin
  select email, plan into v_email, v_plan from _args;

  if not exists (select 1 from public.plans where id = v_plan) then
    raise exception 'No such plan: %. Known plans: %',
      v_plan, (select string_agg(id, ', ' order by id) from public.plans);
  end if;

  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'No account with email %. Sign up first, then run this.', v_email;
  end if;

  -- Every user got a personal organization in 0004's backfill. If one is
  -- missing the tenancy model is broken and quota checks will behave oddly,
  -- so say so here rather than silently creating a second one.
  if not exists (select 1 from public.organizations where id = 'org_' || v_uid::text) then
    raise exception 'User % has no personal organization (org_%). Re-run migration 0004.', v_email, v_uid;
  end if;
end $$;

-- ── 3. the change ──────────────────────────────────────────────────────────
insert into public.subscriptions (org_id, plan, status, provider, current_period_end, updated_at)
select
  'org_' || u.id::text,
  a.plan,
  'active',
  'manual',                       -- not 'stripe'. This row did not come from a payment.
  now() + interval '30 days',
  now()
from _args a
join auth.users u on lower(u.email) = lower(a.email)
on conflict (org_id) do update set
  plan               = excluded.plan,
  status             = excluded.status,
  provider           = excluded.provider,
  current_period_end = excluded.current_period_end,
  updated_at         = now();

-- ── 4. what it looks like now ──────────────────────────────────────────────
select
  u.email,
  s.org_id,
  s.plan,
  s.status,
  s.provider,
  s.current_period_end,
  p.label,
  p.cloud                                        as cloud_enabled,
  pg_size_pretty(p.doc_bytes)                    as documents,
  pg_size_pretty(p.asset_bytes)                  as assets,
  pg_size_pretty(p.max_file_bytes)               as largest_upload
from _args a
join auth.users u          on lower(u.email) = lower(a.email)
join public.subscriptions s on s.org_id = 'org_' || u.id::text
join public.plans p         on p.id = s.plan;

commit;

-- ===========================================================================
--  AFTERWARDS — what you should see in the app
--
--    · Settings → Storage stops saying the browser is the only copy
--    · The sync chip appears bottom-right on the first edit
--    · Account panel shows the plan label and two usage meters
--    · An upload larger than the free cap is accepted
--
--  If none of that happens, the client is still holding the old snapshot.
--  Check in the browser console:
--      await (await import('/lib/limits.js')).refreshAccount()
--  or just sign out and in, which is what a real upgrade will do anyway.
-- ===========================================================================
