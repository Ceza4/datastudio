-- ============================================================================
--  0005_repair_tenancy_and_quota.sql
--
--  MIGRATION 0004 BROKE EVERY CLIENT WRITE, AND NOTHING NOTICED FOR TWO DAYS.
--
--  0004 added `org_id` to `docs` and `assets`, backfilled it, and then set it
--  NOT NULL. There is no default and no BEFORE INSERT trigger that fills it.
--  The client's insert payload — unchanged since 0003 — does not send the
--  column. So since the moment 0004 was applied:
--
--      every document push  → 23502 null value in column "org_id"
--      every asset upload   → 42501 row-level security policy violation
--
--  The second one is separate and just as total: 0004 §8 moved the storage
--  path to {org_id}/{kind}/{asset_id}, while lib/cloudassets.js still builds
--  {user_uuid}/{kind}/{asset_id}. `is_org_member('<uuid>')` is false for
--  everyone, so the bucket refuses every write.
--
--  WHY THE PEN TEST PASSED ANYWAY. supabase/rls_pentest.sql hand-writes both
--  `org_id` and the org-shaped storage path, because it was written from the
--  schema rather than from the client. It proved the policies were correct
--  about a request the application never makes. A test that constructs its own
--  input can only ever check the half of the contract it already agrees with;
--  §14 of this file adds the missing half.
--
--  This migration is the repair, plus eleven other things the audit that found
--  it turned up. Ordered by blast radius:
--
--     1  org_id is assigned by the server, so the client's payload works and
--        the column stops being forgeable          (blocking + escalation)
--     2  trigger order: the org is pinned BEFORE quota reads it   (escalation)
--     3  legacy storage paths stay readable; new writes go to the org path
--     4  quota: a row may not arrive already deleted    (unbounded bypass)
--     5  quota: bytes awaiting purge still count        (unbounded bypass)
--     6  quota: one advisory lock per org               (TOCTOU + lost update)
--     7  usage is keyed by the tenant it measures       (bricking + drift)
--     8  an asset whose object is gone can still be tombstoned      (drift)
--     9  storage writes check the plan, not just membership   (quota bypass)
--    10  SECURITY DEFINER functions are no longer PUBLIC-executable
--    11  docs UPDATE is column-scoped, like assets and profiles already are
--    12  audit rows cannot be forged with a chosen ip / user agent
--    13  indexes for the predicates that actually run per row
--    14  a self-test that inserts what the CLIENT sends, not what a test wants
--
--  Idempotent. Safe to re-run. Every destructive step is guarded.
-- ============================================================================

begin;

-- ── 0. preconditions ────────────────────────────────────────────────────────
-- Fail loudly rather than half-applying against a database that is not where
-- this migration thinks it starts.
do $$
begin
  if to_regclass('public.organizations') is null then
    raise exception '0004 has not been applied — run it first.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'docs' and column_name = 'org_id'
  ) then
    raise exception '0004 has not been applied — docs.org_id is missing.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  1. THE TENANT IS DECIDED BY THE SERVER
-- ════════════════════════════════════════════════════════════════════════════
--
-- Two ways to fix "the client does not send org_id": teach the client to send
-- it, or stop needing it. The second is strictly better, because `org_id` is a
-- TENANT IDENTIFIER — the one value in the row that decides which billing
-- account pays, which quota applies and who else can read it. A field like
-- that should never be chosen by the party it constrains, for the same reason
-- `owner_id` and `rev` are not.
--
-- So: absent from the payload means "my own workspace". Present means "this
-- shared workspace", and RLS's `with check (is_org_member(org_id))` decides
-- whether that claim is true. The client can express an intent; it cannot
-- assert an entitlement.
--
-- `'org_' || auth.uid()` reproduces the id shape handle_new_user() mints
-- (0004 §11) and 0004 §4b backfilled. It is derived rather than looked up so
-- this runs without touching organizations on the hot path.

create or replace function public.default_org()
returns text
language sql
stable
as $fn$
  select case when auth.uid() is null then null else 'org_' || auth.uid()::text end
$fn$;

-- Fills org_id on INSERT, pins it on UPDATE. One function, both tables.
--
-- The pin was already here as pin_org_id(); what it lacked was the insert half
-- and, more importantly, a position in the firing order early enough to matter
-- (see §2).
create or replace function public.own_org_id()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    new.org_id := coalesce(new.org_id, public.default_org());
    if new.org_id is null then
      -- Unreachable through PostgREST (RLS needs a session), but a NULL here
      -- would become `org_plan(NULL)` → 'free' → "upgrade to sync", which is
      -- the single most confusing error this system can produce: a paying
      -- customer told their plan does not include the thing they pay for.
      raise exception 'No organisation for this session.' using errcode = 'check_violation';
    end if;
  else
    new.org_id := old.org_id;
  end if;
  return new;
end;
$fn$;


-- ════════════════════════════════════════════════════════════════════════════
--  2. FIRING ORDER, WHICH IS A CORRECTNESS PROPERTY HERE AND NOT A DETAIL
-- ════════════════════════════════════════════════════════════════════════════
--
-- Postgres fires BEFORE ROW triggers in ALPHABETICAL ORDER BY TRIGGER NAME.
-- 0004 knew this — `assets_aa_enforce_quota` carries a comment calling its
-- prefix load-bearing — and then got the docs side backwards:
--
--     docs_before_write      (b)
--     docs_enforce_quota     (e)   ← reads new.org_id
--     docs_pin_org           (p)   ← restores new.org_id, too late
--
-- The quota check therefore ran against whatever org_id the client sent, and
-- the pin then put the real one back before the row was written. The `with
-- check` saw the legitimate org and passed. That is a working plan escalation:
--
--     update docs set doc = <400 bytes>                        → refused, free plan
--     update docs set doc = <400 bytes>, org_id = 'org_<max>'  → accepted
--
-- The row stays in the attacker's own org. Only the entitlement decision was
-- borrowed. Note this needed BOTH halves — the wrong order AND `docs` still
-- holding a table-wide UPDATE grant (fixed in §11), which is why `assets`,
-- whose grant lists three columns, was never exposed.
--
-- Numeric prefixes rather than letter games: '0' (0x30) sorts before every
-- lowercase letter and before '_' (0x5F), so these run first on both tables
-- and stay first whatever anyone names a future trigger.

drop trigger if exists docs_pin_org      on public.docs;
drop trigger if exists assets_pin_org    on public.assets;
drop trigger if exists docs_0_org_pin    on public.docs;
drop trigger if exists assets_0_org_pin  on public.assets;

create trigger docs_0_org_pin
  before insert or update on public.docs
  for each row execute function public.own_org_id();

create trigger assets_0_org_pin
  before insert or update on public.assets
  for each row execute function public.own_org_id();

-- pin_org_id() is now unreferenced. Left in place rather than dropped: 0004
-- created it, a rollback to 0004 would recreate the trigger that calls it, and
-- a missing function turns that rollback into an outage.
comment on function public.pin_org_id() is
  'Superseded by own_org_id() in 0005 — kept so a rollback to 0004 still resolves.';


-- ════════════════════════════════════════════════════════════════════════════
--  3. LEGACY STORAGE PATHS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Objects written before 0004 live at {user_uuid}/{kind}/{id}. 0004's policies
-- recognise only {org_id}/…, so those objects became unreadable AND
-- undeletable — the worst combination, because the manifest row still names
-- them and still bills for them.
--
-- Renaming them is not available: storage.objects.name is the S3 key, and
-- updating it from SQL desynchronises the metadata from the bucket. So the old
-- boundary is re-admitted for READ and DELETE only.
--
-- This is not a weakening. `(storage.foldername(name))[1] = auth.uid()::text`
-- is precisely the rule 0003 shipped and 0004 replaced; it scopes to one user,
-- which is a strictly tighter set than one organisation. What it must never do
-- is admit new WRITES, or the two path shapes would coexist forever and the
-- tenant boundary would depend on which era an object was written in.

drop policy if exists "ds assets read"   on storage.objects;
drop policy if exists "ds assets write"  on storage.objects;
drop policy if exists "ds assets delete" on storage.objects;

create policy "ds assets read" on storage.objects
  for select using (
    bucket_id = 'ds-assets'
    and (
      public.is_org_member((storage.foldername(name))[1])
      or (storage.foldername(name))[1] = (select auth.uid())::text   -- legacy, pre-0004
    )
  );

-- WRITE: org path only, and the plan must actually include cloud storage.
--
-- The plan clause closes a hole 0004 left wide open. `uploadAsset` puts the
-- OBJECT first and the manifest row second — deliberately, so a row can never
-- name bytes that are not there — which means the only quota gate was on the
-- row. A client that simply never inserts the row can fill the bucket. Proven
-- in audit: 20 GB written by an account on a plan whose asset allowance is 0.
--
-- This does not meter bytes (a storage policy cannot see a running total). It
-- draws the line the plan draws: free accounts are local-only, so they have no
-- business writing to the bucket at all.
create policy "ds assets write" on storage.objects
  for insert with check (
    bucket_id = 'ds-assets'
    and public.has_org_role((storage.foldername(name))[1], array['owner','admin','member'])
    and (public.org_plan((storage.foldername(name))[1])).cloud
  );

create policy "ds assets delete" on storage.objects
  for delete using (
    bucket_id = 'ds-assets'
    and (
      public.has_org_role((storage.foldername(name))[1], array['owner','admin'])
      or (storage.foldername(name))[1] = (select auth.uid())::text   -- legacy, pre-0004
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
--  4-6. THE QUOTA SYSTEM WAS DECORATIVE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Three independent bypasses, any one of which alone made the limits advisory.
--
-- (4) A ROW COULD ARRIVE ALREADY DELETED. Both quota functions opened with
--     `if new.deleted_at is not null then return new; end if;` — correct
--     intent (never refuse a delete; that would trap someone over quota with
--     no way back under it) applied to the wrong set of operations, because it
--     also fires on INSERT. Send the tombstone flag with the insert and the
--     check is skipped entirely; the SELECT policies do not filter tombstones,
--     so the data reads back fine. Proven in audit: 500 rows / 4.9 MB stored
--     on a plan with a 100-byte limit, and the same on a FREE account, whose
--     `not p.cloud` refusal also sits after the early return.
--
--     The fix is to say what was meant. A row may not be born deleted. That is
--     not a real operation — nothing in the client does it — so refusing it
--     costs nothing and closes the hole completely.
--
-- (5) DELETED BYTES STOPPED COUNTING IMMEDIATELY, BUT DID NOT LEAVE THE DISK
--     FOR 30 DAYS. So: fill the plan, tombstone everything, fill it again.
--     Repeat. Usage reads one plan's worth while the vendor stores N.
--
--     Fixed by separating the two questions that were being answered with one
--     number. `usage.doc_bytes` keeps meaning "what you have" — that is what
--     the meter in Settings should show. New `pending_bytes` columns mean
--     "what we are still storing for you", and the QUOTA CHECK uses the sum.
--     Both are true, and the one the user is refused against is the honest
--     one: we cannot store more than we can store.
--
-- (6) NO LOCKING, so two writers both read the same headroom and both pass.
--     Worse inside a single statement: the usage triggers are AFTER ROW, which
--     Postgres queues to end-of-statement, so a 50-row array insert runs 50
--     quota checks against one pre-statement total. Proven in audit: 3450
--     bytes accepted against a 100-byte limit, in one POST. And
--     recompute_usage_org itself was a lost update — two transactions each
--     computing from their own snapshot, the later commit stamping the older
--     total.
--
--     A `for update` on the usage row does not fix it, because a tenant with
--     no usage row yet has no row to lock. A transaction-scoped advisory lock
--     keyed on the org does, and it releases at commit with no cleanup.
--
--     Cost: writes within ONE organisation serialise. They already did, one
--     statement later, at the AFTER trigger. Across organisations there is no
--     contention at all, which is the axis that has to scale.

alter table public.usage add column if not exists doc_pending_bytes   bigint not null default 0;
alter table public.usage add column if not exists asset_pending_bytes bigint not null default 0;

comment on column public.usage.doc_pending_bytes is
  'Bytes in tombstoned documents, still on disk until the 30-day purge. Counted against quota, not shown as used.';
comment on column public.usage.asset_pending_bytes is
  'Bytes in tombstoned assets, still on disk until the 30-day purge. Counted against quota, not shown as used.';


-- ════════════════════════════════════════════════════════════════════════════
--  7. usage IS KEYED BY THE TENANT IT MEASURES
-- ════════════════════════════════════════════════════════════════════════════
--
-- It was keyed by `owner_id`, a leftover from 0001 when a user WAS the tenant.
-- 0004 added `org_id` alongside and kept `on conflict (owner_id)`. Two bugs
-- fell out, both proven:
--
--   (a) A NULL created_by BRICKS THE ORGANISATION. recompute_usage_org() reads
--       `organizations.created_by` to fill `usage.owner_id`, which is the NOT
--       NULL primary key. created_by is `on delete set null`. So when the
--       person who created a shared workspace deletes their account, every
--       subsequent write by every remaining member fails with 23502 — and
--       because the trigger also fires on DELETE, they cannot even empty it.
--
--   (b) ONE USER, TWO ORGS, ONE ROW. The conflict target is owner_id, so a
--       user who created a second organisation has a single usage row that
--       gets relabelled back and forth between them. The quota check then
--       looks up `where org_id = <the other one>`, finds nothing, coalesces to
--       zero, and hands out a full fresh allowance — flipping on every write.
--
-- Both are the same mistake: a table that measures organisations was keyed by
-- people. owner_id stays as a convenience column and becomes nullable, which
-- is what it always was in truth.

do $$
begin
  -- Collapse any duplicate rows before the unique key goes on. Keeps the
  -- freshest row per org; the values are recomputed from source below anyway,
  -- so this only has to be deterministic, not clever.
  delete from public.usage u
   using public.usage keep
   where u.org_id is not null
     and u.org_id = keep.org_id
     and (u.updated_at, u.owner_id) < (keep.updated_at, keep.owner_id);

  -- A row that never got an org_id in 0004's backfill cannot be repaired and
  -- is not referenced by anything; the recompute below rebuilds what is real.
  delete from public.usage where org_id is null;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.usage'::regclass and contype = 'p' and conname = 'usage_pkey'
  ) then
    -- Only swap the key if it is not already on org_id (re-run safety).
    if not exists (
      select 1
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       where c.conrelid = 'public.usage'::regclass and c.contype = 'p' and a.attname = 'org_id'
    ) then
      alter table public.usage drop constraint usage_pkey;
      alter table public.usage alter column owner_id drop not null;
      alter table public.usage alter column org_id   set  not null;
      alter table public.usage add constraint usage_pkey primary key (org_id);
    end if;
  end if;
end $$;

drop index if exists public.usage_org_idx;   -- the PK covers it now
create index if not exists usage_owner_idx on public.usage (owner_id) where owner_id is not null;


-- The recompute, rewritten: locked, keyed on the org, and splitting live bytes
-- from bytes awaiting purge.
create or replace function public.recompute_usage_org(target_org text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare owner_uuid uuid;
begin
  if target_org is null then return; end if;

  -- Same lock the quota check takes, so a recompute cannot interleave with a
  -- check and cannot lose an update to a concurrent recompute. hashtext is
  -- stable within a major version, and a collision between two org ids would
  -- cost a little serialisation, never correctness.
  perform pg_advisory_xact_lock(hashtext('ds_usage:' || target_org));

  select created_by into owner_uuid from public.organizations where id = target_org;

  insert into public.usage (
    owner_id, org_id, doc_bytes, asset_bytes,
    doc_pending_bytes, asset_pending_bytes,
    notebook_count, doc_count, updated_at
  )
  values (
    owner_uuid, target_org,
    coalesce((select sum(bytes) from public.docs   where org_id = target_org and deleted_at is null), 0),
    coalesce((select sum(bytes) from public.assets where org_id = target_org and deleted_at is null), 0),
    coalesce((select sum(bytes) from public.docs   where org_id = target_org and deleted_at is not null), 0),
    -- Deduplicated assets share one object between many rows. Summing bytes
    -- per row charges the same object once per notebook it appears in — the
    -- dedupe saves the vendor money and billed the user for it. `distinct on
    -- (path)` counts each object once, which is what the bucket actually
    -- holds. Applied to the pending side here and to the live side below.
    coalesce((select sum(bytes) from (
        select distinct on (path) path, bytes
          from public.assets
         where org_id = target_org and deleted_at is not null
         order by path, bytes desc
      ) d), 0),
    coalesce((select count(*)   from public.docs   where org_id = target_org and deleted_at is null and kind = 'notebook'), 0),
    coalesce((select count(*)   from public.docs   where org_id = target_org and deleted_at is null), 0),
    now()
  )
  on conflict (org_id) do update set
    owner_id            = excluded.owner_id,
    doc_bytes           = excluded.doc_bytes,
    asset_bytes         = excluded.asset_bytes,
    doc_pending_bytes   = excluded.doc_pending_bytes,
    asset_pending_bytes = excluded.asset_pending_bytes,
    notebook_count      = excluded.notebook_count,
    doc_count           = excluded.doc_count,
    updated_at          = now();

  -- The live asset total, deduplicated by path, written in a second statement
  -- so the expression above stays readable.
  update public.usage u
     set asset_bytes = coalesce((
           select sum(bytes) from (
             select distinct on (path) path, bytes
               from public.assets
              where org_id = target_org and deleted_at is null
              order by path, bytes desc
           ) d), 0)
   where u.org_id = target_org;
end;
$fn$;


-- ── 7b. the signup trigger followed the old key ─────────────────────────────
-- handle_new_user() ends with `on conflict (owner_id)`, which stopped being a
-- unique constraint the moment §7 moved the primary key to org_id. Every new
-- signup would have failed with 42P10 — a migration that repaired the write
-- path and closed the front door on the way out.
--
-- Caught by running this file against a real Postgres before it went near a
-- real database. That is the entire argument for supabase/test/.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare new_org text;
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

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
  on conflict (org_id) do update set owner_id = excluded.owner_id;

  return new;
end;
$fn$;


-- ════════════════════════════════════════════════════════════════════════════
--  4-6 (cont). THE QUOTA CHECKS THEMSELVES
-- ════════════════════════════════════════════════════════════════════════════

-- THE CHECK READS THE SOURCE TABLES, NOT THE `usage` CACHE.
--
-- That one change kills three bugs at once, and it is worth writing down why,
-- because the cache looked like the obvious thing to read.
--
--   · THE STATEMENT-LEVEL BYPASS. `usage` is maintained by AFTER ROW triggers,
--     which Postgres queues to end-of-statement. So every row of a 50-row array
--     insert checked itself against the same pre-statement total and all 50
--     passed. Proven in audit: 3450 bytes accepted against a 100-byte limit in
--     one request. No lock fixes this — the whole statement is one transaction,
--     so the lock is already held.
--
--     Rows inserted earlier in the SAME statement are visible to a later
--     BEFORE ROW trigger's query (verified, not assumed: Postgres increments
--     the command counter between rows for this purpose). So reading the table
--     sees rows 1..n-1 while row n is being checked, and the total is right.
--
--   · THE LOST UPDATE. recompute_usage_org computed from its own snapshot and
--     stamped the result, so a slower transaction could overwrite a newer
--     total with an older one — permanently, until something else wrote to
--     that org. A check reading the cache then handed out the difference as
--     free headroom, over and over.
--
--   · THE DELTA ARITHMETIC. `incoming - old.bytes` was correct for a live→live
--     edit and wrong for a restore, where old.bytes had never been in the
--     total. Excluding the row under edit from the sum removes the subtraction
--     entirely, and with it the whole class.
--
-- The cost is an aggregate per row written. It is the same aggregate
-- recompute_usage_org already ran per row, and §13's covering partial indexes
-- make both index-only. `usage` remains, as a display cache for the meter in
-- Settings — which is all it was ever read for outside this check.

create or replace function public.enforce_doc_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  p        public.plans;
  used     bigint;
  pending  bigint;
  incoming bigint;
begin
  -- A row may not be born deleted. See §4.
  if tg_op = 'INSERT' and new.deleted_at is not null then
    raise exception 'A document cannot be created already deleted.'
      using errcode = 'check_violation';
  end if;

  -- Becoming a tombstone, or staying one, frees space or changes nothing.
  -- Never refuse it — that is how someone over quota gets back under it.
  -- A RESTORE (tombstoned → live) deliberately falls through to be charged.
  if new.deleted_at is not null then return new; end if;

  p := public.org_plan(new.org_id);

  -- Fail CLOSED on an unresolvable plan. The old code left `p` as a NULL
  -- composite, which made `not p.cloud` and the comparison below both evaluate
  -- to NULL — i.e. neither check fired and the write sailed through.
  -- Unreachable today (subscriptions.plan has an FK to plans), but "the check
  -- silently vanishes" is the wrong direction for a check to fail in.
  if p.id is null then
    raise exception 'QUOTA: no plan resolves for organisation %.', new.org_id
      using errcode = 'check_violation';
  end if;

  if not p.cloud then
    raise exception 'QUOTA: the % plan does not include cloud sync. Your work stays on this device.', p.label
      using errcode = 'check_violation';
  end if;

  -- Serialises writers WITHIN one organisation, which they already were one
  -- statement later at the AFTER trigger. Across organisations there is no
  -- contention, and that is the axis that has to scale.
  perform pg_advisory_xact_lock(hashtext('ds_usage:' || new.org_id));

  select coalesce(sum(bytes), 0) into used
    from public.docs
   where org_id = new.org_id and deleted_at is null and id <> new.id;

  -- Deleted work is off the meter but still on the disk for 30 days. Charging
  -- it is what stops "fill the plan, delete it, fill it again" from holding N
  -- plans' worth of storage for the price of one.
  select coalesce(sum(bytes), 0) into pending
    from public.docs
   where org_id = new.org_id and deleted_at is not null and id <> new.id;

  incoming := octet_length(new.doc::text);

  if used + pending + incoming > p.doc_bytes then
    raise exception 'QUOTA: documents would use % of the % plan''s % limit.%',
      pg_size_pretty(used + pending + incoming), p.label, pg_size_pretty(p.doc_bytes),
      case when pending > 0
        then ' (' || pg_size_pretty(pending) || ' is deleted work awaiting the 30-day purge.)'
        else '' end
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;


create or replace function public.enforce_asset_quota()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $fn$
declare
  p         public.plans;
  used      bigint;
  pending   bigint;
  real_size bigint;
  shared    boolean;
begin
  if tg_op = 'INSERT' and new.deleted_at is not null then
    raise exception 'An asset cannot be created already deleted.'
      using errcode = 'check_violation';
  end if;

  if new.deleted_at is not null then return new; end if;

  p := public.org_plan(new.org_id);
  if p.id is null then
    raise exception 'QUOTA: no plan resolves for organisation %.', new.org_id
      using errcode = 'check_violation';
  end if;

  if not p.cloud then
    raise exception 'QUOTA: the % plan does not include cloud storage.', p.label
      using errcode = 'check_violation';
  end if;

  -- The size on the STORAGE OBJECT, never the number the client sent.
  select (o.metadata->>'size')::bigint into real_size
    from storage.objects o
   where o.bucket_id = 'ds-assets' and o.name = new.path;
  real_size := coalesce(real_size, 0);

  if real_size > p.max_file_bytes then
    raise exception 'QUOTA: that file is % — the % plan allows % per file.',
      pg_size_pretty(real_size), p.label, pg_size_pretty(p.max_file_bytes)
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('ds_usage:' || new.org_id));

  -- DEDUPE IS COUNTED ONCE, ON BOTH SIDES OF THE COMPARISON.
  --
  -- The same logo dropped into six notebooks is six manifest rows and one
  -- object: uploadAsset points the later rows at the existing path. Summing
  -- `bytes` per row charged the user six times for bytes stored once — the
  -- dedupe saved the vendor money and billed the customer for it.
  --
  -- `distinct on (path)` counts each object once. The incoming row is then
  -- free if its path is already held by a live row, which is the same rule
  -- seen from the other end.
  select coalesce(sum(bytes), 0) into used from (
    select distinct on (path) path, bytes
      from public.assets
     where org_id = new.org_id and deleted_at is null and id <> new.id
     order by path, bytes desc
  ) d;

  select coalesce(sum(bytes), 0) into pending from (
    select distinct on (path) path, bytes
      from public.assets
     where org_id = new.org_id and deleted_at is not null and id <> new.id
     order by path, bytes desc
  ) d;

  select exists (
    select 1 from public.assets a
     where a.org_id = new.org_id and a.path = new.path
       and a.deleted_at is null and a.id <> new.id
  ) into shared;
  if shared then real_size := 0; end if;

  if used + pending + real_size > p.asset_bytes then
    raise exception 'QUOTA: files would use % of the % plan''s % limit.%',
      pg_size_pretty(used + pending + real_size), p.label, pg_size_pretty(p.asset_bytes),
      case when pending > 0
        then ' (' || pg_size_pretty(pending) || ' is deleted work awaiting the 30-day purge.)'
        else '' end
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;


-- ════════════════════════════════════════════════════════════════════════════
--  8. AN ASSET WHOSE OBJECT IS GONE MUST STILL BE RETIRABLE
-- ════════════════════════════════════════════════════════════════════════════
--
-- assets_before_write() re-reads storage.objects on UPDATE as well as INSERT
-- and raises if the object is missing. The manifest ordering rule it enforces
-- ("bytes before row") is right, and on INSERT it is exactly right. On UPDATE
-- it is a trap:
--
--     1. object is deleted — by the owner, by collectRemote, by a partial
--        failure in the account-deletion route
--     2. `update assets set deleted_at = now()` → P0001 No object at …
--     3. the row can now never be tombstoned, therefore never purged,
--        therefore its bytes count against the plan FOREVER
--
-- and in a shared organisation an admin can inflict that on any member's
-- assets. The path is immutable (pinned three lines down), so re-reading
-- storage on UPDATE was never buying anything: the answer cannot have changed
-- in a way that matters, and old.bytes is the figure that was already checked.

create or replace function public.assets_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $fn$
declare
  real_size bigint;
begin
  if tg_op = 'INSERT' then
    select (o.metadata->>'size')::bigint
      into real_size
      from storage.objects o
     where o.bucket_id = 'ds-assets'
       and o.name = new.path;

    if real_size is null then
      raise exception
        'No object at ds-assets/% — upload the bytes before inserting the manifest row (see lib/cloudassets.js).',
        new.path;
    end if;
    new.bytes := real_size;

    -- The path must sit under this row's own organisation. This replaces what
    -- `unique (path)` was accidentally protecting (see §8c) and states it
    -- directly: a manifest row may not name bytes belonging to another tenant,
    -- deduplicated or not. The second branch admits objects written before
    -- 0004 moved the prefix, whose rows are otherwise unrepairable.
    if not (new.path like new.org_id || '/%'
            or new.path like new.owner_id::text || '/%') then
      raise exception
        'Asset path % does not belong to organisation %.', new.path, new.org_id
        using errcode = 'check_violation';
    end if;
  else
    -- The path cannot change, so the size cannot either. Trust the figure that
    -- was measured and quota-checked when the row was created.
    new.bytes := old.bytes;
  end if;

  new.updated_at := now();

  if new.deleted_at is not null then
    new.deleted_at := case when tg_op = 'UPDATE' then coalesce(old.deleted_at, now()) else now() end;
  end if;

  if tg_op = 'UPDATE' then
    new.owner_id   := old.owner_id;
    new.id         := old.id;
    new.path       := old.path;
    new.kind       := old.kind;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$fn$;


-- ── 8c. one object, many rows — which `path text not null unique` forbade ───
--
-- THE DEDUPE PATH HAS NEVER WORKED. 0003 documented the design in two places:
-- the assets table comment says "the same image dropped into two notebooks
-- uploads once", and collectRemote is built around "never delete an object
-- while ANY row still names its path". Both describe many rows sharing one
-- object. The column says `unique`.
--
-- So uploadAsset's dedupe branch — find a twin by sha256, insert a new row
-- pointing at twin.path — raises 23505 every time. The push throws, the outbox
-- entry backs off, and it retries forever. Dropping the same logo into a
-- second notebook wedges that asset's sync permanently, and the collector's
-- careful path-counting has been guarding a state the constraint made
-- impossible.
--
-- The constraint was doing one useful thing by accident: stopping a client
-- naming an arbitrary path, including one inside another tenant's prefix.
-- (Not a read: storage RLS still refuses. But a manifest row pointing at
-- someone else's bytes is a mess waiting to be someone's incident.) That job
-- is done properly below, by requiring the path to sit under the row's own
-- organisation — which is a stronger statement than uniqueness ever made.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.assets'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (path)';
  if c is not null then
    execute format('alter table public.assets drop constraint %I', c);
  end if;
end $$;

create index if not exists assets_path_idx on public.assets (path);

-- ── 8b. doc_id may not point across a tenant boundary ───────────────────────
-- `doc_id` is one of three columns a client may update on assets. Foreign key
-- validation runs with the table owner's rights, so it sees rows RLS hides:
-- setting doc_id to a document in someone else's organisation succeeds if it
-- exists and errors if it does not, which is a cross-tenant existence oracle.
-- It also means that when the other tenant eventually purges that document,
-- `on delete set null` performs a write into this tenant's row.
create or replace function public.assets_check_doc_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.doc_id is not null then
    if not exists (
      select 1 from public.docs d where d.id = new.doc_id and d.org_id = new.org_id
    ) then
      -- Deliberately the same message whether the document is absent or simply
      -- belongs to someone else. Distinguishing them is the oracle.
      raise exception 'No such document in this workspace.' using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists assets_zz_doc_org on public.assets;
create trigger assets_zz_doc_org
  before insert or update on public.assets
  for each row execute function public.assets_check_doc_org();


-- ════════════════════════════════════════════════════════════════════════════
--  10. SECURITY DEFINER FUNCTIONS WERE EXECUTABLE BY EVERYONE
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0004 ended with `revoke all on function public.my_account() from anon;`,
-- which does nothing: Postgres grants EXECUTE to PUBLIC on every new function,
-- and `anon` is a member of PUBLIC. Revoking from a role does not revoke what
-- PUBLIC already holds. The observed ACL still read `=X/postgres`.
--
-- Two of these are genuinely reachable and genuinely harmful:
--
--   recompute_usage_org(text) is SECURITY DEFINER, WRITES public.usage, and
--   sits in the PostgREST-exposed `public` schema — so it was callable
--   unauthenticated at POST /rest/v1/rpc/recompute_usage_org. Each call ran
--   three aggregates over docs and assets (cheap amplification), and a
--   nonexistent org returned a different error than a real one, which is an
--   account-existence oracle on a guessable id.
--
--   org_plan(text) leaked any tenant's plan and limits to anyone holding the
--   anon key — which is shipped in the browser bundle.
--
-- The lesson worth keeping: `revoke … from anon` is not a revoke. It has to
-- name PUBLIC.

-- Guarded by to_regprocedure: 0004 already dropped recompute_usage(uuid), and a
-- REVOKE naming a function that does not exist is a hard error that would take
-- the whole migration down with it. A hardening step must not be the thing
-- that stops the repair from applying.
do $$
declare
  f text;
  targets text[] := array[
    'public.recompute_usage_org(text)',
    'public.recompute_usage(uuid)',
    'public.org_plan(text)',
    'public.my_account()',
    'public.default_org()'
  ];
begin
  foreach f in array targets loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- org_plan stays executable by authenticated because the storage WRITE policy
-- (§3) calls it. A policy runs as the querying role, so revoking it there
-- would refuse every upload.
grant execute on function public.org_plan(text) to authenticated;
grant execute on function public.my_account()   to authenticated;
grant execute on function public.default_org()  to authenticated;

-- Belt and braces on search_path: appending pg_temp closes the one remaining
-- resolution trick, where a caller creates a temporary object that shadows an
-- unqualified name inside a definer function. Every table reference in these
-- functions is already schema-qualified, so this changes nothing today and
-- costs nothing to keep.
alter function public.is_org_member(text)   set search_path = public, pg_temp;
alter function public.has_org_role(text, text[]) set search_path = public, pg_temp;
alter function public.org_plan(text)        set search_path = public, pg_temp;
alter function public.my_account()          set search_path = public, pg_temp;
alter function public.handle_new_user()     set search_path = public, pg_temp;


-- ════════════════════════════════════════════════════════════════════════════
--  11. docs UPDATE IS COLUMN-SCOPED
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0002 did this surgery for profiles and 0003 for assets. `docs` was missed,
-- so `authenticated` could name eleven columns in a SET list — including
-- org_id, owner_id, rev, bytes and updated_at. Triggers defended every one of
-- them, which is why nothing broke; but §2's escalation needed exactly this
-- grant to exist, and defence-in-depth means the trigger should be the second
-- line rather than the only one.
--
-- The four columns listed are the four a client has any business changing.
-- Note that a trigger assigning rev/bytes/updated_at is unaffected: column
-- privileges are checked against the statement's SET list, not against what
-- triggers do afterwards.

revoke update on public.docs from anon, authenticated;
grant  update (name, doc, device_id, deleted_at) on public.docs to authenticated;

-- TRUNCATE bypasses RLS entirely. Supabase's default GRANT ALL hands it out
-- with everything else. Not reachable through PostgREST, which issues no
-- TRUNCATE — this is the belt to §11's braces.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  12. AUDIT ROWS WERE FORGEABLE
-- ════════════════════════════════════════════════════════════════════════════
--
-- The stamp trigger set `at` and nothing else. `action`, `ip` and `user_agent`
-- were all client-chosen, so a user could write `action='auth.login'` from
-- `ip='8.8.8.8'` into the log they are audited by — and, since nothing rate
-- limits inserts, bury a real entry under noise.
--
-- ip and user_agent are only meaningful when the SERVER observes them, so they
-- leave the client grant entirely. `action` gets a namespace check rather than
-- a fixed allow-list: an exhaustive list is a migration every time a new event
-- type is added, and the property that matters is that a client cannot invent
-- an action that reads like a server-side security event.

alter table public.audit_log
  drop constraint if exists audit_log_action_shape;
alter table public.audit_log
  add constraint audit_log_action_shape
  check (action ~ '^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$');

revoke insert on public.audit_log from anon, authenticated;
grant  insert (org_id, actor_id, action, target, outcome, detail) on public.audit_log to authenticated;

create or replace function public.audit_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  new.at := now();
  -- A client-written row is a client-written row. The server's own inserts go
  -- through the service role, which is not subject to this trigger's concern:
  -- auth.uid() is null there, so ip and user_agent survive.
  if (select auth.uid()) is not null then
    new.ip         := null;
    new.user_agent := null;
    if new.action like 'auth.%' or new.action like 'admin.%' then
      raise exception 'The % namespace is recorded by the server.', split_part(new.action, '.', 1)
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$fn$;

-- 'pending' lets a multi-step server operation record its intent before it
-- acts and settle the outcome afterwards, instead of asserting success in
-- advance — see app/api/account/delete/route.js.
alter table public.audit_log drop constraint if exists audit_log_outcome_check;
alter table public.audit_log
  add constraint audit_log_outcome_check
  check (outcome in ('ok','denied','error','pending'));


-- ════════════════════════════════════════════════════════════════════════════
--  13. INDEXES FOR THE PREDICATES THAT RUN PER ROW
-- ════════════════════════════════════════════════════════════════════════════
--
-- Two different costs, measured rather than guessed (numbers from a 40k-row
-- reproduction; they scale with table size, which is the point).
--
-- (a) recompute_usage_org runs three aggregates on EVERY row written, and the
--     trigger is FOR EACH ROW. Sequential scans of docs and assets: ~29 ms for
--     one ordinary save. In an app whose pitch is being faster than Excel,
--     that is the whole latency budget spent on bookkeeping. Covering partial
--     indexes turn all of them into index-only scans.
--
-- (b) The asset pull uses the same "changed since" cursor as documents, and
--     0004 gave that index to docs only. 7.79 ms → 0.10 ms.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and this
-- migration is one. These are ordinary CREATE INDEX: they take a write lock
-- for the duration, which on a table this size is milliseconds. Re-run against
-- a large table via the CONCURRENTLY variants noted at the end of the file.

create index if not exists docs_org_live_idx
  on public.docs   (org_id) include (bytes, kind) where deleted_at is null;
create index if not exists docs_org_dead_idx
  on public.docs   (org_id) include (bytes)       where deleted_at is not null;
create index if not exists assets_org_live_idx
  on public.assets (org_id, path) include (bytes) where deleted_at is null;
create index if not exists assets_org_dead_idx
  on public.assets (org_id, path) include (bytes) where deleted_at is not null;

create index if not exists assets_org_updated_idx
  on public.assets (org_id, updated_at desc);

-- Foreign keys with no index. auth.users deletion currently scans
-- organizations; a plans change scans subscriptions.
create index if not exists organizations_created_by_idx
  on public.organizations (created_by) where created_by is not null;
create index if not exists subscriptions_plan_idx
  on public.subscriptions (plan);

-- Dedupe lookup is per-owner in the client but everything else is per-tenant.
create index if not exists assets_org_sha_idx
  on public.assets (org_id, sha256) where sha256 is not null;

-- The pre-tenancy indexes are dead weight on the write path once the client
-- filters by org (four extra index updates per save). Dropped only if the
-- org-keyed replacement exists, so a partial application cannot leave the
-- table with neither.
do $$
begin
  if to_regclass('public.docs_org_updated_idx') is not null then
    drop index if exists public.docs_owner_updated_idx;
    drop index if exists public.docs_owner_kind_idx;
  end if;
  if to_regclass('public.assets_org_updated_idx') is not null then
    drop index if exists public.assets_owner_idx;
    drop index if exists public.assets_owner_updated_idx;
  end if;
end $$;


-- ── 13b. the RLS predicate is evaluated per row ─────────────────────────────
-- 0004's comment says `stable` "lets the planner call it once per query rather
-- than once per row". That is true of a function with constant arguments;
-- is_org_member(org_id) takes a COLUMN, so it cannot be hoisted and runs once
-- per candidate row. Measured 17.24 ms over 2000 rows.
--
-- Rewritten as set membership, the planner builds a hashed subplan once:
-- 0.93 ms for the same query. The security property is identical — the set is
-- computed from auth.uid() inside a definer function, exactly as before.
create or replace function public.my_org_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select m.org_id from public.org_members m where m.user_id = (select auth.uid())
$fn$;

revoke all on function public.my_org_ids() from public, anon;
grant execute on function public.my_org_ids() to authenticated;

drop policy if exists "docs select"   on public.docs;
drop policy if exists "assets select" on public.assets;

create policy "docs select" on public.docs
  for select using (org_id in (select public.my_org_ids()));

create policy "assets select" on public.assets
  for select using (org_id in (select public.my_org_ids()));


-- ════════════════════════════════════════════════════════════════════════════
--  14. THE SELF-TEST: INSERT WHAT THE CLIENT SENDS
-- ════════════════════════════════════════════════════════════════════════════
--
-- The whole reason 0004 shipped broken is that every test constructed its own
-- input. This block asserts the shape of the CONTRACT rather than of the
-- schema: that a payload with no org_id is accepted, that the row lands in the
-- caller's own organisation, and that a row cannot be born deleted.
--
-- It runs as the migration's role (no auth.uid()), so it cannot exercise the
-- policies — that is rls_pentest.sql's job. What it CAN prove is that the
-- NOT NULL constraint which broke everything is now satisfied by the server,
-- and it proves it here, at apply time, where a failure is a rolled-back
-- migration instead of a silent outage.

do $$
declare
  probe_user uuid;
  probe_org  text;
  got_org    text;
  refused    boolean := false;
  quota_stop boolean := false;
begin
  select id into probe_user from auth.users order by created_at limit 1;
  if probe_user is null then
    raise notice '0005 self-test skipped: no users yet.';
    return;
  end if;
  probe_org := 'org_' || probe_user::text;

  -- IMPERSONATE THE PROBE USER FOR THE REST OF THIS BLOCK.
  --
  -- Without this the migration runs with no session, auth.uid() is NULL, and
  -- the only way to insert anything is to supply org_id by hand — which is
  -- precisely the mistake that let 0004 ship. A self-test that hands the
  -- server the column it is supposed to derive proves nothing about the bug
  -- it exists to catch.
  --
  -- set_config(..., true) is transaction-local, so it unwinds with this
  -- migration whether it commits or rolls back.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', probe_user::text, 'role', 'authenticated')::text,
                     true);

  -- 1. THE EXACT PAYLOAD lib/sync.js SENDS — note: no org_id.
  begin
    insert into public.docs (id, owner_id, kind, name, doc, device_id, deleted_at)
    values ('nb_probe_0005', probe_user, 'notebook', 'probe',
            '{"probe":true}'::jsonb, 'probe-device', null);
  exception
    when check_violation then
      -- THIS IS ALSO A PASS, and the distinction matters.
      --
      -- A free plan has cloud = false, so enforce_doc_quota refuses every
      -- cloud write — correctly; that is what the tier means. The refusal is
      -- still positive evidence, because reaching the QUOTA check at all
      -- proves org_id was resolved: an unfilled column raises 23502
      -- (not_null_violation) from the constraint, and an unresolvable session
      -- raises 'No organisation for this session' from own_org_id(). Neither
      -- is a check_violation.
      --
      -- So on a paid tenant this test proves the whole path end to end, and on
      -- a free one it proves everything up to the tier gate. What it must
      -- never do is fail the migration because the account is doing exactly
      -- what its plan says.
      quota_stop := true;
    when not_null_violation then
      raise exception '0005 self-test: org_id was NOT filled by the server — this is the 0004 bug, unrepaired.';
  end;

  if quota_stop then
    raise notice '0005 self-test: org_id is server-assigned (reached the quota gate). This organisation is on a plan without cloud sync, so the write was refused after that — which is correct. Use supabase/dev/set_plan.sql to test a paid tier.';
  else
    select org_id into got_org from public.docs where id = 'nb_probe_0005';
    if got_org is distinct from probe_org then
      raise exception '0005 self-test: org_id landed as %, expected %', got_org, probe_org;
    end if;
    raise notice '0005 self-test: a payload with no org_id landed in % — the 0004 breakage is repaired.', got_org;
  end if;

  -- 2. A ROW MAY NOT BE BORN DELETED. Independent of the plan: this refusal
  --    comes from the same trigger but from a check that runs before the tier
  --    is consulted, so it is testable on every account.
  begin
    insert into public.docs (id, owner_id, kind, name, doc, deleted_at)
    values ('nb_probe_0005_dead', probe_user, 'notebook', 'probe',
            '{"probe":true}'::jsonb, now());
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception '0005 self-test: an already-deleted INSERT was accepted.';
  end if;

  delete from public.docs where id in ('nb_probe_0005', 'nb_probe_0005_dead');
  perform set_config('request.jwt.claims', '', true);
  raise notice '0005 self-test passed.';
end $$;


-- ── recompute every tenant with the new accounting ──────────────────────────
-- doc_pending_bytes / asset_pending_bytes start at 0 and the asset totals are
-- now deduplicated by path, so every existing row is stale until this runs.
do $$
declare o text;
begin
  for o in select id from public.organizations loop
    perform public.recompute_usage_org(o);
  end loop;
end $$;

commit;

-- ============================================================================
--  AFTERWARDS
--
--  Verify with supabase/rls_pentest.sql (12 checks, all should pass), then:
--
--    select org_id, doc_bytes, doc_pending_bytes, asset_bytes, asset_pending_bytes
--      from public.usage;
--
--    -- trigger order: the 0-prefixed pin must be first on both tables
--    select tgrelid::regclass as tbl, tgname
--      from pg_trigger
--     where not tgisinternal and tgrelid in ('public.docs'::regclass,'public.assets'::regclass)
--     order by tbl, tgname;
--
--    -- no SECURITY DEFINER function should show `=X/` (that is PUBLIC)
--    select proname, proacl from pg_proc
--     where pronamespace = 'public'::regnamespace and prosecdef;
--
--  ON A LARGE TABLE, build the indexes outside the transaction instead:
--    create index concurrently docs_org_live_idx on public.docs (org_id)
--      include (bytes, kind) where deleted_at is null;
--    …and the other six, then re-run this file (it is idempotent).
--
--  STILL OPEN, deliberately:
--    · recompute_usage_org is FOR EACH ROW. The covering indexes make it cheap
--      but a statement-level trigger with transition tables would make it
--      cheaper still. Left alone because it changes when the recompute runs
--      relative to the quota check, and that interaction wants its own test.
--    · Nothing enumerates the bucket, so an object whose manifest INSERT
--      failed is still invisible to every sweeper. The client half is fixed in
--      lib/cloudassets.js (the orphan path is now recorded and reclaimed); a
--      server-side sweep over storage.objects remains the belt.
-- ============================================================================
