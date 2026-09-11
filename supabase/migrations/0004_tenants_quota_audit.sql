-- =============================================================================
-- DataStudio — 0004: tenants, server-enforced quota, plans, audit log
-- =============================================================================
-- Follows 0003_cloud_everything.sql. Run it the same way.
--
-- WHY THIS EXISTS
--
--   1. THE QUOTA WAS ENFORCED IN THE BROWSER AND NOWHERE ELSE.
--      lib/limits.js is client-side JavaScript. A modified client skips it and
--      writes whatever it likes. The security checklist's own acceptance
--      criterion — "a user cannot increase their own storage quota" — failed,
--      and it failed silently, because the tier itself was safe (0002 locked
--      profiles.plan) while the LIMIT the tier implies was never checked
--      anywhere the user could not reach. Limits now live in a server-owned
--      table and are enforced by triggers.
--
--   2. TENANCY IS CHEAP NOW AND EXPENSIVE LATER.
--      Every row today is owned by one auth.users id. Adding an organisation
--      boundary once real customer data exists means migrating live rows AND
--      rewriting every policy that supabase/rls_pentest.sql currently proves
--      correct — at exactly the moment somebody is evaluating the product.
--      Doing it while the tables are empty costs one migration and one pen-test
--      pass. Every signup silently gets a personal organisation of one; no UI,
--      no invitations, no roles exposed yet. The BOUNDARY is what is being
--      built here, not the feature.
--
--   3. THE PLAN'S AUTHORITY MOVED OFF profiles.
--      profiles.plan was a text column a webhook would have to write. It is now
--      derived from `subscriptions`, which only the service role can write, so
--      the billing state and the entitlement it grants cannot drift apart.
--
--   4. THERE WAS NO AUDIT TRAIL.
--      Append-only, tenant-scoped, and unwritable by the clients whose actions
--      it records.
--
-- SAFETY: section 0 refuses to run if docs or assets already hold rows that
-- would need backfilling by hand. On an empty project it proceeds.
-- =============================================================================


-- ── 0. what happens to rows that already exist ─────────────────────────────
-- The first version of this migration REFUSED to run if `docs` held anything,
-- on the grounds that inventing tenancy for existing data is worse than
-- stopping. It fired on the live project — five real documents — and that was
-- the right call for the version of the file that had no answer.
--
-- This is the answer. Deriving a personal organisation per existing OWNER is
-- not inventing anything: every row today belongs to exactly one auth.users
-- id, so the mapping is total and deterministic. The backfill is in section 4,
-- immediately before the NOT NULL that needs it, and it asserts afterwards
-- that nothing was left behind rather than trusting that it worked.
--
-- What is still refused is the genuinely ambiguous case: a doc whose owner is
-- gone. It cannot happen (owner_id is NOT NULL and references auth.users ON
-- DELETE CASCADE) and is checked anyway, because "cannot happen" is what
-- everybody says about the row that later turns out to exist.

-- ── 1. plans — the server's copy of what each tier may do ───────────────────
-- lib/limits.js keeps its own copy for INSTANT feedback ("this file is too
-- large") because a round trip before every drop would make the app feel slow.
-- This table is the one that decides. When the two disagree, this wins, and the
-- client's job is only to predict what it will say.
create table if not exists public.plans (
  id             text primary key,          -- free | pro | max
  doc_bytes      bigint  not null,          -- JSON documents in Postgres
  asset_bytes    bigint  not null,          -- images + PDFs + attachments in Storage
  max_file_bytes bigint  not null,          -- the largest single upload
  cloud          boolean not null default true,
  price_cents    integer not null default 0,
  currency       text    not null default 'usd',
  label          text    not null
);

-- FREE IS LOCAL-ONLY AND THAT IS EXPRESSED AS ZERO, NOT AS A SPECIAL CASE.
-- Every limit is 0 and `cloud` is false, so the ordinary quota check refuses a
-- free account's first cloud write without needing a branch that says "unless
-- the plan is free". A special case is a thing to forget; a zero is arithmetic.
-- Written out in bytes rather than as `50 * 1024^3`. `^` returns double
-- precision in Postgres and binds looser than `::`, so the tidy-looking version
-- is a float expression cast at the last moment — fine at these magnitudes and
-- exactly the kind of thing that is not fine at some future magnitude. Literal
-- integers cannot round.
insert into public.plans (id, doc_bytes, asset_bytes, max_file_bytes, cloud, price_cents, label) values
  ('free', 0,           0,             0,          false, 0,    'Free'),
  ('pro',  2147483648,  53687091200,   262144000,  true,  1200, 'Pro'),   -- 2GB docs · 50GB files · 250MB/file · $12
  ('max',  21474836480, 268435456000,  1073741824, true,  3200, 'Max')    -- 20GB docs · 250GB files · 1GB/file · $32
on conflict (id) do update set
  doc_bytes = excluded.doc_bytes, asset_bytes = excluded.asset_bytes,
  max_file_bytes = excluded.max_file_bytes, cloud = excluded.cloud,
  price_cents = excluded.price_cents, label = excluded.label;

alter table public.plans enable row level security;

-- Readable by anyone signed in — the pricing is public information and the
-- account panel renders from it. Writable by nobody: there is no insert,
-- update or delete policy, and under RLS an absent policy is a denial. The
-- service role bypasses RLS, which is how a price change is deployed.
drop policy if exists "plans readable" on public.plans;
create policy "plans readable" on public.plans for select using (true);
revoke insert, update, delete on public.plans from anon, authenticated;


-- ── 2. organisations ────────────────────────────────────────────────────────
create table if not exists public.organizations (
  id         text primary key,
  name       text not null default 'Personal',
  -- Kept for "who created this" and for the last-admin rule later. It does NOT
  -- grant access on its own — membership does. Two different questions, and
  -- conflating them is how an ownership transfer silently locks someone out.
  created_by uuid references auth.users on delete set null,
  personal   boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id     text not null references public.organizations on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members (user_id);

-- THE MEMBERSHIP TEST, AS A FUNCTION, USED BY EVERY POLICY BELOW.
--
-- SECURITY DEFINER is not decoration here and it is not a shortcut. org_members
-- has RLS of its own, so a policy on `docs` that selected from org_members
-- directly would evaluate that table's policy inside this one — and a policy
-- that reads a table which reads it back is infinite recursion, which Postgres
-- reports as a stack depth error at query time rather than at migration time.
-- A definer function reads the table with RLS bypassed, which is exactly what a
-- membership check needs to do to answer honestly.
--
-- `stable` lets the planner call it once per query rather than once per row.
create or replace function public.is_org_member(target_org text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.org_members m
     where m.org_id = target_org and m.user_id = auth.uid()
  );
$fn$;

create or replace function public.has_org_role(target_org text, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.org_members m
     where m.org_id = target_org and m.user_id = auth.uid() and m.role = any(roles)
  );
$fn$;

alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;

drop policy if exists "orgs readable by members" on public.organizations;
create policy "orgs readable by members" on public.organizations
  for select using (public.is_org_member(id));

-- Renaming is an owner/admin action. Creating and deleting organisations is not
-- a client operation at all: personal orgs come from the signup trigger, and
-- anything else will come from a server route that can also handle billing.
drop policy if exists "orgs renamable by admins" on public.organizations;
create policy "orgs renamable by admins" on public.organizations
  for update using (public.has_org_role(id, array['owner','admin']))
          with check (public.has_org_role(id, array['owner','admin']));
revoke insert, delete on public.organizations from anon, authenticated;
revoke update on public.organizations from anon, authenticated;
grant  update (name) on public.organizations to authenticated;

drop policy if exists "members readable by members" on public.org_members;
create policy "members readable by members" on public.org_members
  for select using (public.is_org_member(org_id));

-- Membership is written by the signup trigger and, later, by an invitation
-- route running as the service role. A client that could insert its own
-- membership row could join any organisation whose id it could guess, which is
-- the whole tenant boundary defeated by one POST.
revoke insert, update, delete on public.org_members from anon, authenticated;


-- ── 3. subscriptions — the authority on what a tenant is entitled to ────────
-- Written only by the billing webhook (service role). No client policy for
-- insert/update/delete exists, so no client can grant itself a plan.
create table if not exists public.subscriptions (
  org_id               text primary key references public.organizations on delete cascade,
  plan                 text not null default 'free' references public.plans(id),
  status               text not null default 'active'
                       check (status in ('active','trialing','past_due','canceled','incomplete')),
  provider             text,                 -- 'stripe', later
  provider_customer_id text,
  provider_sub_id      text,
  current_period_end   timestamptz,
  updated_at           timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
drop policy if exists "subscription readable by members" on public.subscriptions;
create policy "subscription readable by members" on public.subscriptions
  for select using (public.is_org_member(org_id));
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- THE ONE PLACE THAT ANSWERS "WHAT MAY THIS TENANT DO".
--
-- past_due does NOT downgrade to free. That is rule 2 from lib/limits.js, made
-- server-side: over quota or unpaid means new pushes queue, never that data is
-- deleted or that existing data stops syncing down. A thesis must not
-- disappear because a card expired. `canceled` is the deliberate end of a
-- relationship and does drop to free.
create or replace function public.org_plan(target_org text)
returns public.plans
language sql
stable
security definer
set search_path = public
as $fn$
  select p.* from public.plans p
   where p.id = coalesce((
     select case when s.status = 'canceled' then 'free' else s.plan end
       from public.subscriptions s where s.org_id = target_org
   ), 'free');
$fn$;


-- ── 4. org_id on the data tables ────────────────────────────────────────────
alter table public.docs   add column if not exists org_id text references public.organizations on delete cascade;
alter table public.assets add column if not exists org_id text references public.organizations on delete cascade;

create index if not exists docs_org_updated_idx   on public.docs   (org_id, updated_at desc);
create index if not exists assets_org_idx         on public.assets (org_id);

-- ── 4b. THE BACKFILL ────────────────────────────────────────────────────────
-- Idempotent, so re-running the migration after a partial failure is safe, and
-- so that a project with nothing in it simply does nothing here.
--
-- The org id is DERIVED from the user id ('org_' || uuid) rather than
-- generated, which is what makes every statement below re-runnable: the same
-- user always maps to the same organisation, in this file and in
-- handle_new_user() in section 11. Two different rules for the same id is how
-- a signup trigger and a backfill end up disagreeing about who owns what.
insert into public.organizations (id, name, created_by, personal)
select 'org_' || u.id::text, 'Personal', u.id, true
  from auth.users u
 on conflict (id) do nothing;

insert into public.org_members (org_id, user_id, role)
select 'org_' || u.id::text, u.id, 'owner'
  from auth.users u
 on conflict (org_id, user_id) do nothing;

insert into public.subscriptions (org_id, plan, status)
select 'org_' || u.id::text, 'free', 'active'
  from auth.users u
 on conflict (org_id) do nothing;

update public.docs   set org_id = 'org_' || owner_id::text where org_id is null;
update public.assets set org_id = 'org_' || owner_id::text where org_id is null;
-- (public.usage gains its org_id in section 5 and is backfilled there — this
--  file is ordered by dependency, not by tidiness.)

-- THE ASSERTION IS THE POINT. An UPDATE that matched nothing reports success
-- exactly like one that matched everything, so without this the SET NOT NULL
-- below would be the first thing to notice a problem — and it would report it
-- as a constraint violation with no explanation of which rows or why.
do $do$
declare orphan_docs bigint; orphan_assets bigint;
begin
  select count(*) into orphan_docs   from public.docs   where org_id is null;
  select count(*) into orphan_assets from public.assets where org_id is null;
  if orphan_docs > 0 or orphan_assets > 0 then
    raise exception
      'Backfill left % doc(s) and % asset(s) with no organisation. That means a row references an owner with no auth.users record, which the foreign key should have made impossible — investigate before forcing this through.',
      orphan_docs, orphan_assets;
  end if;
  raise notice 'Backfill complete: every doc and asset now belongs to an organisation.';
end
$do$;

-- Not null only AFTER the assertion above has proved there is nothing left to
-- backfill. Stated separately so a failure here names the column rather than
-- arriving as a confusing default.
alter table public.docs   alter column org_id set not null;
alter table public.assets alter column org_id set not null;


-- ── 5. usage, per tenant rather than per user ───────────────────────────────
alter table public.usage add column if not exists org_id text references public.organizations on delete cascade;

-- Backfilled HERE rather than in 4b, because the column does not exist until
-- the line above. The first version of this migration put all three updates
-- together in the backfill block and failed with `column "org_id" does not
-- exist` — a reminder that a migration file is ordered by dependency, and that
-- grouping related statements for readability is exactly how that ordering
-- gets broken.
update public.usage set org_id = 'org_' || owner_id::text where org_id is null;

create unique index if not exists usage_org_idx on public.usage (org_id) where org_id is not null;

create or replace function public.recompute_usage_org(target_org text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare owner_uuid uuid;
begin
  select created_by into owner_uuid from public.organizations where id = target_org;

  insert into public.usage (owner_id, org_id, doc_bytes, asset_bytes, notebook_count, doc_count, updated_at)
  values (
    owner_uuid, target_org,
    coalesce((select sum(bytes) from public.docs   where org_id = target_org and deleted_at is null), 0),
    coalesce((select sum(bytes) from public.assets where org_id = target_org and deleted_at is null), 0),
    coalesce((select count(*)   from public.docs   where org_id = target_org and deleted_at is null and kind = 'notebook'), 0),
    coalesce((select count(*)   from public.docs   where org_id = target_org and deleted_at is null), 0),
    now()
  )
  on conflict (owner_id) do update set
    org_id         = excluded.org_id,
    doc_bytes      = excluded.doc_bytes,
    asset_bytes    = excluded.asset_bytes,
    notebook_count = excluded.notebook_count,
    doc_count      = excluded.doc_count,
    updated_at     = now();
end;
$fn$;

create or replace function public.trg_recompute_usage_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.recompute_usage_org(coalesce(new.org_id, old.org_id));
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists docs_usage_trigger   on public.docs;
drop trigger if exists assets_usage_trigger on public.assets;

-- 0003's per-user versions. Dropped rather than left in place: a stale function
-- that still compiles but sums the wrong column is the kind of thing that gets
-- called by accident during a later refactor and quietly under-reports usage.
drop function if exists public.trg_recompute_usage() cascade;
drop function if exists public.recompute_usage(uuid) cascade;
create trigger docs_usage_trigger
  after insert or update or delete on public.docs
  for each row execute function public.trg_recompute_usage_org();
create trigger assets_usage_trigger
  after insert or update or delete on public.assets
  for each row execute function public.trg_recompute_usage_org();


-- ── 6. THE QUOTA, ENFORCED WHERE THE CLIENT CANNOT REACH IT ─────────────────
-- This is the fix for the checklist's §28 criterion "a user cannot increase
-- their own storage quota", which failed before this migration.
--
-- WHY IT READS `usage` RATHER THAN SUMMING THE TABLE
-- Summing docs on every write is O(rows) per keystroke-batch, on the hot path
-- of an app whose entire claim is that it is faster than Excel. `usage` is
-- maintained by the AFTER triggers above and is therefore the committed total
-- as of the previous write. The cost is that a burst of concurrent writes can
-- overshoot by one document. The alternative costs every user a table scan per
-- save to close a gap a person cannot exploit meaningfully: the next write
-- after the overshoot is refused.
create or replace function public.enforce_doc_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  p public.plans;
  used bigint;
  incoming bigint;
begin
  -- A soft delete or a restore never needs headroom checked; refusing one would
  -- trap someone over quota with no way to get back under it.
  if new.deleted_at is not null then return new; end if;

  p := public.org_plan(new.org_id);

  if not p.cloud then
    raise exception 'QUOTA: the % plan does not include cloud sync. Your work stays on this device.', p.label
      using errcode = 'check_violation';
  end if;

  select coalesce(doc_bytes, 0) into used from public.usage where org_id = new.org_id;
  incoming := octet_length(new.doc::text);
  -- On an UPDATE the row's previous size is already counted in `used`, so only
  -- the delta is new. Counting the whole document would refuse an edit that
  -- made a document SMALLER, which is the one edit an over-quota user needs to
  -- be able to make.
  if tg_op = 'UPDATE' then incoming := incoming - coalesce(old.bytes, 0); end if;

  if coalesce(used, 0) + incoming > p.doc_bytes then
    raise exception 'QUOTA: documents would use % of the % plan''s % limit.',
      pg_size_pretty(coalesce(used, 0) + incoming), p.label, pg_size_pretty(p.doc_bytes)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists docs_enforce_quota on public.docs;
create trigger docs_enforce_quota
  before insert or update on public.docs
  for each row execute function public.enforce_doc_quota();

create or replace function public.enforce_asset_quota()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $fn$
declare
  p public.plans;
  used bigint;
  real_size bigint;
begin
  if new.deleted_at is not null then return new; end if;

  p := public.org_plan(new.org_id);

  if not p.cloud then
    raise exception 'QUOTA: the % plan does not include cloud storage.', p.label
      using errcode = 'check_violation';
  end if;

  -- The size on the STORAGE OBJECT, never the number the client sent. 0003's
  -- assets_before_write already corrects the column; this reads the same source
  -- because the check has to happen BEFORE that trigger's value is trusted by
  -- anything, and because a quota that measures a client-supplied figure is a
  -- quota the client sets.
  select (o.metadata->>'size')::bigint into real_size
    from storage.objects o
   where o.bucket_id = 'ds-assets' and o.name = new.path;
  real_size := coalesce(real_size, 0);

  -- Per-plan maximum single file. The bucket's own file_size_limit is one
  -- global number and cannot express "250MB for Pro, 1GB for Max", so it stays
  -- set to the largest plan's cap and the per-tier rule lives here.
  if real_size > p.max_file_bytes then
    raise exception 'QUOTA: that file is % — the % plan allows % per file.',
      pg_size_pretty(real_size), p.label, pg_size_pretty(p.max_file_bytes)
      using errcode = 'check_violation';
  end if;

  select coalesce(asset_bytes, 0) into used from public.usage where org_id = new.org_id;
  if tg_op = 'UPDATE' then real_size := real_size - coalesce(old.bytes, 0); end if;

  if coalesce(used, 0) + real_size > p.asset_bytes then
    raise exception 'QUOTA: files would use % of the % plan''s % limit.',
      pg_size_pretty(coalesce(used, 0) + real_size), p.label, pg_size_pretty(p.asset_bytes)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

-- BEFORE the 0003 trigger that copies the real size in, because a quota check
-- that ran after a value was assigned would be checking a decision already
-- made. Postgres fires BEFORE row triggers in name order, and
-- `assets_aa_enforce_quota` sorts ahead of `assets_before_write`. That is a
-- load-bearing prefix; do not rename it to something tidier.
drop trigger if exists assets_aa_enforce_quota on public.assets;
create trigger assets_aa_enforce_quota
  before insert or update on public.assets
  for each row execute function public.enforce_asset_quota();


-- ── 7. tenant-shaped RLS, replacing the owner-only policies from 0003 ───────
-- The change is small and total: `auth.uid() = owner_id` becomes "are you a
-- member of the organisation this row belongs to". owner_id stays on the row as
-- the record of who WROTE it — useful in an audit trail, useless as an access
-- decision the moment two people share a workspace.
drop policy if exists "docs select" on public.docs;
create policy "docs select" on public.docs
  for select using (public.is_org_member(org_id));

drop policy if exists "docs insert" on public.docs;
create policy "docs insert" on public.docs
  for insert with check (
    public.is_org_member(org_id)
    and public.has_org_role(org_id, array['owner','admin','member'])
    -- You may only create rows attributed to yourself. Without this a member
    -- could write a document that claims another member authored it, which is
    -- the kind of thing that matters exactly once, in an incident review.
    and auth.uid() = owner_id
  );

drop policy if exists "docs update" on public.docs;
create policy "docs update" on public.docs
  for update using (public.has_org_role(org_id, array['owner','admin','member']))
          with check (public.has_org_role(org_id, array['owner','admin','member']));

drop policy if exists "docs purge" on public.docs;
create policy "docs purge" on public.docs
  for delete using (
    public.has_org_role(org_id, array['owner','admin'])
    and deleted_at is not null
    and deleted_at < now() - interval '30 days'
  );

drop policy if exists "assets select" on public.assets;
create policy "assets select" on public.assets
  for select using (public.is_org_member(org_id));

drop policy if exists "assets insert" on public.assets;
create policy "assets insert" on public.assets
  for insert with check (
    public.is_org_member(org_id)
    and public.has_org_role(org_id, array['owner','admin','member'])
    and auth.uid() = owner_id
  );

drop policy if exists "assets update" on public.assets;
create policy "assets update" on public.assets
  for update using (public.has_org_role(org_id, array['owner','admin','member']))
          with check (public.has_org_role(org_id, array['owner','admin','member']));

drop policy if exists "assets purge" on public.assets;
create policy "assets purge" on public.assets
  for delete using (
    public.has_org_role(org_id, array['owner','admin'])
    and deleted_at is not null
    and deleted_at < now() - interval '30 days'
  );

-- usage becomes readable per tenant rather than per user.
drop policy if exists "read own usage" on public.usage;
create policy "read own usage" on public.usage
  for select using (auth.uid() = owner_id or public.is_org_member(org_id));

-- org_id is immutable on both tables. Moving a document between tenants is a
-- deliberate server-side operation with billing and audit consequences, not
-- something a PATCH should be able to do.
create or replace function public.pin_org_id()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'UPDATE' then new.org_id := old.org_id; end if;
  return new;
end;
$fn$;

drop trigger if exists docs_pin_org   on public.docs;
drop trigger if exists assets_pin_org on public.assets;
create trigger docs_pin_org   before update on public.docs   for each row execute function public.pin_org_id();
create trigger assets_pin_org before update on public.assets for each row execute function public.pin_org_id();


-- ── 8. storage objects follow the tenant, not the user ──────────────────────
-- Path becomes {org_id}/{kind}/{asset_id}. The leading segment is still the
-- only thing a storage policy can cheaply constrain, so the boundary moves from
-- "is this your uuid" to "are you in this organisation".
drop policy if exists "ds assets read"   on storage.objects;
drop policy if exists "ds assets write"  on storage.objects;
drop policy if exists "ds assets delete" on storage.objects;

create policy "ds assets read" on storage.objects
  for select using (
    bucket_id = 'ds-assets' and public.is_org_member((storage.foldername(name))[1])
  );

create policy "ds assets write" on storage.objects
  for insert with check (
    bucket_id = 'ds-assets'
    and public.has_org_role((storage.foldername(name))[1], array['owner','admin','member'])
  );

-- Still no update policy: objects are immutable, a crop mints a new id.
create policy "ds assets delete" on storage.objects
  for delete using (
    bucket_id = 'ds-assets'
    and public.has_org_role((storage.foldername(name))[1], array['owner','admin'])
  );

-- Raised to the largest plan's per-file cap. The per-TIER limit is enforced in
-- enforce_asset_quota() above, because a bucket has exactly one number and
-- three plans need three.
update storage.buckets set file_size_limit = 1024 * 1024 * 1024 where id = 'ds-assets';


-- ── 9. avatars ──────────────────────────────────────────────────────────────
-- A separate bucket, and PUBLIC, unlike ds-assets. A profile picture is the
-- face you chose to show; serving it through signed URLs would mean a refresh
-- timer and a re-sign on every render of a 28px circle, to protect an image
-- whose entire purpose is to be looked at. Objects are still write-scoped to
-- their owner's own path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2 * 1024 * 1024,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar read"   on storage.objects;
drop policy if exists "avatar write"  on storage.objects;
drop policy if exists "avatar delete" on storage.objects;

create policy "avatar read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatar write" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatar delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists avatar_updated_at timestamptz;

-- Re-granted because the column list changed. Table-wide UPDATE has to come off
-- first or the column grants are a silent no-op — 0002 has the long note.
revoke update on public.profiles from anon, authenticated;
grant  update (email, display_name, prefs, avatar_path, avatar_updated_at) on public.profiles to authenticated;


-- ── 10. audit log ───────────────────────────────────────────────────────────
-- Append-only by policy, not by convention: there is an insert policy and a
-- select policy and deliberately no update or delete policy, so under RLS a
-- client cannot rewrite or erase a record of what it did. The service role
-- bypasses RLS, which is how retention is eventually applied.
create table if not exists public.audit_log (
  id         bigserial primary key,
  org_id     text references public.organizations on delete cascade,
  actor_id   uuid references auth.users on delete set null,
  action     text not null,        -- 'auth.login', 'doc.delete', 'asset.upload', …
  target     text,                 -- the id of whatever was acted on
  outcome    text not null default 'ok' check (outcome in ('ok','denied','error')),
  -- Deliberately small and deliberately not the payload. §14: "minimize
  -- sensitive customer data in logs". A record that a document was deleted is
  -- an audit trail; a copy of the document is a second database with none of
  -- the first one's protections.
  detail     jsonb not null default '{}'::jsonb,
  ip         inet,
  user_agent text,
  at         timestamptz not null default now()
);
create index if not exists audit_org_at_idx   on public.audit_log (org_id, at desc);
create index if not exists audit_actor_at_idx on public.audit_log (actor_id, at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit readable by admins" on public.audit_log;
create policy "audit readable by admins" on public.audit_log
  for select using (public.has_org_role(org_id, array['owner','admin']));

-- A client may record its own actions, attributed to itself, in its own
-- organisation. It cannot forge an actor and it cannot write into someone
-- else's tenant. Most entries will come from the server; this policy exists so
-- client-side events worth recording are not lost for want of a route.
drop policy if exists "audit appendable" on public.audit_log;
create policy "audit appendable" on public.audit_log
  for insert with check (public.is_org_member(org_id) and auth.uid() = actor_id);

revoke update, delete on public.audit_log from anon, authenticated;

-- `at` and `id` are the server's. A client that could stamp its own timestamp
-- could bury an entry in the middle of last year's log.
create or replace function public.audit_before_insert()
returns trigger
language plpgsql
as $fn$
begin
  new.at := now();
  return new;
end;
$fn$;

drop trigger if exists audit_stamp on public.audit_log;
create trigger audit_stamp before insert on public.audit_log
  for each row execute function public.audit_before_insert();


-- ── 11. signup creates the person, their organisation and their membership ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare new_org text;
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  -- Prefixed like every other id in the system so it is greppable, and derived
  -- from the user id so this trigger is idempotent: running twice for the same
  -- user cannot produce two personal organisations.
  new_org := 'org_' || new.id::text;

  insert into public.organizations (id, name, created_by, personal)
  values (new_org, 'Personal', new.id, true)
  on conflict (id) do nothing;

  insert into public.org_members (org_id, user_id, role)
  values (new_org, new.id, 'owner')
  on conflict (org_id, user_id) do nothing;

  insert into public.subscriptions (org_id, plan, status)
  values (new_org, 'free', 'active')
  on conflict (org_id) do nothing;

  insert into public.usage (owner_id, org_id)
  values (new.id, new_org)
  on conflict (owner_id) do update set org_id = excluded.org_id;

  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 12. what a client needs to know about itself, in one round trip ─────────
-- The account panel would otherwise make four requests to render a circle and a
-- plan name. Returns only what the caller is already entitled to read.
create or replace function public.my_account()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'user_id',    auth.uid(),
    'email',      p.email,
    'name',       p.display_name,
    'avatar',     p.avatar_path,
    'org_id',     o.id,
    'org_name',   o.name,
    'role',       m.role,
    'plan',       pl.id,
    'plan_label', pl.label,
    'cloud',      pl.cloud,
    'limits',     jsonb_build_object(
                    'doc_bytes',      pl.doc_bytes,
                    'asset_bytes',    pl.asset_bytes,
                    'max_file_bytes', pl.max_file_bytes),
    'usage',      jsonb_build_object(
                    'doc_bytes',   coalesce(u.doc_bytes, 0),
                    'asset_bytes', coalesce(u.asset_bytes, 0),
                    'notebooks',   coalesce(u.notebook_count, 0)),
    'status',     coalesce(s.status, 'active'),
    'period_end', s.current_period_end
  )
  from public.profiles p
  join public.org_members m   on m.user_id = p.id
  join public.organizations o on o.id = m.org_id
  left join public.subscriptions s on s.org_id = o.id
  cross join lateral public.org_plan(o.id) pl
  left join public.usage u on u.org_id = o.id
  where p.id = auth.uid()
  order by o.personal desc
  limit 1;
$fn$;

revoke all on function public.my_account() from anon;
grant execute on function public.my_account() to authenticated;

-- ── 13. one line you will want, and it is not run automatically ─────────────
-- Every existing account lands on `free` above, which is local-only — so the
-- moment this migration applies, sync STOPS for anyone already using the
-- product, including you. That is correct behaviour and a surprising way to
-- discover it.
--
-- To put your own account on a paid tier, uncomment and run this with your
-- email. It is deliberately not part of the migration: a file that silently
-- grants entitlements is a file nobody can audit.
--
-- update public.subscriptions set plan = 'max', status = 'active'
--  where org_id = 'org_' || (select id from auth.users where email = 'you@example.com');
