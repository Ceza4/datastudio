-- =============================================================================
-- DataStudio — 0003: everything syncs
-- =============================================================================
-- Follows 0001_init.sql and 0002_harden_privileges.sql. Run it the same way:
-- Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- WHAT CHANGED AND WHY
--
--   1. PRIMARY KEYS ARE text, NOT uuid.
--      The client mints ids like `nb_<uuid>`. The prefix is load-bearing
--      (lib/templatestore.js prunes assets per family by it, and a prefixed id
--      is greppable inside a jsonb column, which is the difference between a
--      five-minute and a five-hour incident). More importantly, notebooks
--      already on people's disks carry ids like `notebook_1755689432000`, and
--      those ids are quoted INLINE inside teleport link addresses stored in
--      text blocks. A uuid primary key would force a migration that rewrites
--      user content to satisfy a column type. Wrong trade. text takes both.
--
--   2. FOUR DOC TABLES BECAME ONE.
--      0001 had `notebooks`. The client also needs to sync folders, imported
--      workbooks and templates, and all four are the same thing: an id, a JSON
--      document, a revision counter. Four tables would mean four sets of
--      policies, four sets of grants, four byte triggers — four places to get
--      RLS wrong. 0002 exists because the FIRST pass at this got column
--      privileges wrong on two tables out of five. One `docs` table with a
--      `kind` check constraint is one place to get it right.
--
--   3. `images` BECAME `assets`.
--      Images were the only binary with a cloud story. PDFs (25MB each) and
--      attachments (50MB each) sat in IndexedDB with no bucket, no manifest
--      and no metering — so an attachment was invisible on your other machine
--      and gone with the browser profile. One manifest, one bucket, one
--      metering path.
--
--   4. THE CLIENT CAN NO LONGER DESTROY CLOUD DATA.
--      DELETE is granted, but its RLS policy only passes for rows that have
--      been soft-deleted for more than 30 days. Everything else is a
--      `deleted_at` stamp. A compromised token, a bug in a prune, or a
--      mis-typed `.delete()` in a future refactor cannot take an afternoon
--      with it. This also removes the need for pg_cron: the grace window is
--      enforced by the policy, and any signed-in client can garbage-collect.
--
-- SAFETY: section 0 REFUSES TO RUN if the tables it replaces contain rows.
-- They are empty today (nothing has ever pushed — lib/sync.js does not exist
-- yet), and that is exactly why this migration can be destructive. If someone
-- runs it a year from now against a live project, it stops instead.
-- =============================================================================


-- ── 0. refuse to run over real data ─────────────────────────────────────────
do $do$
declare
  n bigint := 0;
  t text;
begin
  foreach t in array array['notebooks', 'folders', 'images'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception
          '0003 replaces public.% and it holds % row(s). This migration is destructive by design and is only safe on a project nothing has ever synced to. Export first, then delete the guard in section 0 deliberately.',
          t, n;
      end if;
    end if;
  end loop;
end
$do$;


-- ── 1. tear down what 0001/0002 built for the old shape ─────────────────────
-- Triggers go with their tables; the functions are dropped explicitly because
-- `drop table` leaves them behind and a stale recompute_usage() referencing a
-- table that no longer exists fails at the worst possible moment — inside
-- someone else's transaction.
drop trigger if exists notebooks_usage_trigger on public.notebooks;
drop trigger if exists notebooks_set_bytes    on public.notebooks;
drop trigger if exists images_usage_trigger   on public.images;
drop trigger if exists images_set_bytes       on public.images;

drop table if exists public.images    cascade;
drop table if exists public.notebooks cascade;
drop table if exists public.folders   cascade;

drop function if exists public.trg_recompute_usage_notebooks() cascade;
drop function if exists public.trg_recompute_usage_images()    cascade;
drop function if exists public.set_notebook_bytes()            cascade;
drop function if exists public.set_image_bytes()               cascade;


-- ── 2. docs — every synced JSON document, one shape ─────────────────────────
create table if not exists public.docs (
  id          text primary key,
  owner_id    uuid not null references auth.users on delete cascade,
  kind        text not null check (kind in ('notebook', 'folder', 'sheetfile', 'template')),
  name        text not null default 'Untitled',
  -- The whole client-side object: sheets, blocks, connections for a notebook;
  -- {name, collapsed, itemIds} for a folder. NOT normalised into
  -- docs -> sheets -> blocks -> cells, for the reason the backend plan §2
  -- gives: a notebook is only ever read and written whole, and normalising it
  -- would mean hundreds of rows per save and a join to render one canvas.
  doc         jsonb  not null default '{}'::jsonb,
  -- Server-computed. See section 5 — a client-asserted size is a client-chosen
  -- quota.
  bytes       bigint not null default 0,
  -- Optimistic concurrency. Incremented by trigger, never by the client, so a
  -- client cannot skip ahead and win a conflict it should have lost.
  rev         bigint not null default 1,
  -- Which machine wrote this revision. Not security, not identity: it is the
  -- answer to "why is my laptop showing an older version", which is a whole
  -- new class of support ticket the moment sync exists.
  device_id   text,
  updated_at  timestamptz not null default now(),
  -- Soft delete. Purged only after 30 days, and only by the DELETE policy
  -- below, which is the entire data-loss safety net.
  deleted_at  timestamptz
);

-- The pull query is "everything of mine that changed since X", so owner_id
-- leads and updated_at orders. kind is in the index because the client pulls
-- folders before notebooks (a notebook filed into a folder that has not
-- arrived yet renders at the root and looks like it moved on its own).
create index if not exists docs_owner_updated_idx on public.docs (owner_id, updated_at desc);
create index if not exists docs_owner_kind_idx    on public.docs (owner_id, kind);
-- Partial index: the garbage collector asks only about rows with a stamp, and
-- in a healthy project that is a tiny fraction of the table.
create index if not exists docs_deleted_idx       on public.docs (deleted_at) where deleted_at is not null;


-- ── 3. assets — the manifest for every byte in Storage ──────────────────────
-- Bytes live in the bucket; this row is what makes metering and orphan
-- collection possible without listing a bucket (which is O(everything) and
-- rate-limited).
create table if not exists public.assets (
  id          text primary key,          -- img_… / pdf_… / file_… — the id already in blocks
  owner_id    uuid not null references auth.users on delete cascade,
  kind        text not null check (kind in ('image', 'pdf', 'file')),
  -- Which document keeps this alive. Null means "not attached yet", which is
  -- a real state: the upload finishes before the block that references it is
  -- pushed. ON DELETE SET NULL rather than CASCADE — a hard-deleted doc must
  -- not silently take bytes with it while a template still copies them.
  doc_id      text references public.docs on delete set null,
  path        text not null unique,      -- storage object path
  bytes       bigint not null default 0, -- corrected from storage.objects, see section 5
  name        text,
  mime        text,
  width       integer,
  height      integer,
  -- Content hash, so the same image dropped into two notebooks uploads once.
  -- Nullable: an attachment streamed from disk may be hashed lazily.
  sha256      text,
  -- THE MUTABLE HALF OF AN OTHERWISE IMMUTABLE OBJECT.
  --
  -- A PDF in DataStudio is immutable source bytes plus an `edits` overlay
  -- array (lib/pdfs.js — nothing ever modifies the original, which is why undo
  -- is free and a crash cannot corrupt the document). The bytes belong in
  -- Storage and never change; the overlay is a few kilobytes of JSON that
  -- changes constantly. Putting the overlay in the object would rewrite a
  -- 25MB upload every time someone highlighted a line.
  --
  -- So the object stays immutable and cacheable forever, and this column
  -- carries {edits, editsRev}. It is the only part of a manifest row a client
  -- may rewrite, alongside the two bookkeeping columns in section 7.
  meta        jsonb  not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists assets_owner_idx   on public.assets (owner_id);
create index if not exists assets_doc_idx     on public.assets (doc_id);
create index if not exists assets_sha_idx     on public.assets (owner_id, sha256) where sha256 is not null;
create index if not exists assets_deleted_idx on public.assets (deleted_at) where deleted_at is not null;
-- Assets pull on the same "changed since" cursor the docs do, so they need
-- the same index shape. Without it, every focus event sequential-scans the
-- manifest.
create index if not exists assets_owner_updated_idx on public.assets (owner_id, updated_at desc);


-- ── 4. usage — same table, new columns ──────────────────────────────────────
-- image_bytes becomes asset_bytes because it now counts PDFs and attachments
-- too, and a column whose name lies about what it holds is how the wrong
-- number ends up on an invoice.
alter table public.usage add column if not exists asset_bytes bigint not null default 0;
alter table public.usage drop column if exists image_bytes;
alter table public.usage add column if not exists doc_count integer not null default 0;

create or replace function public.recompute_usage(target_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.usage (owner_id, doc_bytes, asset_bytes, notebook_count, doc_count, updated_at)
  values (
    target_owner,
    coalesce((select sum(bytes) from public.docs   where owner_id = target_owner and deleted_at is null), 0),
    coalesce((select sum(bytes) from public.assets where owner_id = target_owner and deleted_at is null), 0),
    coalesce((select count(*)   from public.docs   where owner_id = target_owner and deleted_at is null and kind = 'notebook'), 0),
    coalesce((select count(*)   from public.docs   where owner_id = target_owner and deleted_at is null), 0),
    now()
  )
  on conflict (owner_id) do update set
    doc_bytes      = excluded.doc_bytes,
    asset_bytes    = excluded.asset_bytes,
    notebook_count = excluded.notebook_count,
    doc_count      = excluded.doc_count,
    updated_at     = now();
end;
$fn$;

-- Recompute from source rather than incrementing counters. Slightly more work
-- per write; it can never drift the way +=/-= bookkeeping does after a crashed
-- transaction or a row deleted by hand in the dashboard.
create or replace function public.trg_recompute_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.recompute_usage(coalesce(new.owner_id, old.owner_id));
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists docs_usage_trigger on public.docs;
create trigger docs_usage_trigger
  after insert or update or delete on public.docs
  for each row execute function public.trg_recompute_usage();

drop trigger if exists assets_usage_trigger on public.assets;
create trigger assets_usage_trigger
  after insert or update or delete on public.assets
  for each row execute function public.trg_recompute_usage();


-- ── 5. the columns the client must not decide ───────────────────────────────
-- 0002's lesson, generalised: RLS answers "is this your row?" and never "may
-- you write this column?". Anything that decides entitlement, billing or
-- conflict resolution is computed here, in a BEFORE trigger, so whatever the
-- client sent is simply discarded. That is cheaper than grant surgery and it
-- cannot be forgotten by a future column.
create or replace function public.docs_before_write()
returns trigger
language plpgsql
as $fn$
begin
  -- Size for metering. `bytes = 0` on every write would otherwise make metered
  -- usage permanently zero, and the number quota enforcement runs against
  -- would be attacker-chosen.
  new.bytes := octet_length(new.doc::text);

  -- A timestamp from a client is a timestamp from a clock you do not control.
  -- One machine with a skewed clock would sort its writes to the top of every
  -- pull forever, or to the bottom and never be seen again.
  new.updated_at := now();

  -- THE TOMBSTONE CLOCK IS THE SERVER'S.
  --
  -- Section 6's "docs purge" policy allows a hard delete once deleted_at is
  -- more than 30 days old. deleted_at is an ordinary column the client may
  -- write (that is how "delete" works at all), so without this clamp the
  -- 30-day window is defeated by a two-step from the browser console: set
  -- deleted_at to a date last year, then delete. The whole safety net would be
  -- decoration.
  --
  -- A client may therefore say "deleted" or "not deleted", and nothing else.
  -- Restoring and re-deleting restarts the clock, which errs toward keeping
  -- data for longer — the correct direction to be wrong in.
  if new.deleted_at is not null then
    new.deleted_at := case when tg_op = 'UPDATE' then coalesce(old.deleted_at, now()) else now() end;
  end if;

  if tg_op = 'INSERT' then
    new.rev := 1;
  else
    -- The revision is the SERVER'S count, always old + 1. The client's
    -- compare-and-set lives in the WHERE clause of its update (`where id = $1
    -- and rev = $2`); letting it also choose the next number would let a
    -- client jump to rev 9999 and win every future conflict by default.
    new.rev := old.rev + 1;
    -- Ownership is immutable. RLS's `with check` already refuses a row handed
    -- to someone else, but this makes the invariant local to the row rather
    -- than dependent on a policy staying correct.
    new.owner_id := old.owner_id;
    new.kind     := old.kind;
    new.id       := old.id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists docs_before_write on public.docs;
create trigger docs_before_write
  before insert or update on public.docs
  for each row execute function public.docs_before_write();

-- The authoritative size of a blob is on the storage object, not in the
-- manifest row the client wrote. Nothing stops a client uploading 10MB and
-- then inserting a row claiming 4KB.
--
-- ORDERING DEPENDENCY, and this time it is enforced rather than hoped for:
-- 0002's version fell back to trusting the client when the object was not
-- there yet, with a comment asking whoever built uploads to upload FIRST.
-- Uploads exist now (lib/cloudassets.js), so the fallback is gone — a manifest
-- row whose object is missing is refused. An orphaned object with no manifest
-- row is recoverable (the collector sweeps it); a manifest row with no object
-- is a broken image in someone's notebook forever.
create or replace function public.assets_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $fn$
declare
  real_size bigint;
begin
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

  new.updated_at := now();

  -- Same clamp as docs, and for the same reason: deleted_at is granted to the
  -- client (it is how an asset is retired), and the "assets purge" policy
  -- reads it to decide whether the bytes may go. A backdated stamp would let a
  -- client destroy its own objects instantly, which is the one thing the
  -- 30-day window exists to prevent.
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

drop trigger if exists assets_before_write on public.assets;
create trigger assets_before_write
  before insert or update on public.assets
  for each row execute function public.assets_before_write();


-- ── 6. row-level security ───────────────────────────────────────────────────
-- Written as four separate policies per table rather than one `for all`, so
-- DELETE can be narrower than the rest. That difference is the point: it is
-- what makes cloud data undestroyable by a client.
alter table public.docs   enable row level security;
alter table public.assets enable row level security;

drop policy if exists "docs select" on public.docs;
create policy "docs select" on public.docs
  for select using (auth.uid() = owner_id);

drop policy if exists "docs insert" on public.docs;
create policy "docs insert" on public.docs
  for insert with check (auth.uid() = owner_id);

drop policy if exists "docs update" on public.docs;
create policy "docs update" on public.docs
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- THE SAFETY NET. A hard delete is legal only against a row that has carried a
-- deleted_at stamp for more than 30 days. Everything the app calls "delete" is
-- an update that sets that stamp; this policy is what makes the 30 days real
-- rather than a client-side convention that one bad refactor can drop.
drop policy if exists "docs purge" on public.docs;
create policy "docs purge" on public.docs
  for delete using (
    auth.uid() = owner_id
    and deleted_at is not null
    and deleted_at < now() - interval '30 days'
  );

drop policy if exists "assets select" on public.assets;
create policy "assets select" on public.assets
  for select using (auth.uid() = owner_id);

drop policy if exists "assets insert" on public.assets;
create policy "assets insert" on public.assets
  for insert with check (auth.uid() = owner_id);

drop policy if exists "assets update" on public.assets;
create policy "assets update" on public.assets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "assets purge" on public.assets;
create policy "assets purge" on public.assets
  for delete using (
    auth.uid() = owner_id
    and deleted_at is not null
    and deleted_at < now() - interval '30 days'
  );


-- ── 7. column privileges ────────────────────────────────────────────────────
-- Everything a trigger computes is left writable and discarded, EXCEPT where a
-- write is meaningless rather than merely overridden. assets is a manifest of
-- blobs that already exist: nothing legitimate rewrites one, so the only
-- column a client may change is the soft-delete stamp.
revoke update on public.assets from anon, authenticated;
grant  update (deleted_at, doc_id, meta) on public.assets to authenticated;

-- The profiles grant is NOT here. It has to name the `prefs` column, and that
-- column does not exist until section 8 — running it here fails with
-- `column "prefs" of relation "profiles" does not exist` and rolls the whole
-- migration back. It lives at the end of section 8 instead, immediately after
-- the ALTER that creates the column it is talking about.


-- ── 8. prefs ride on the profile ────────────────────────────────────────────
-- Theme, sidebar state, editor preferences. Their own jsonb column rather than
-- a docs row because they are not a document: there is exactly one per
-- account, they have no name, and they must never appear in a folder or a
-- conflict copy. prefs_rev exists so the same last-write-wins comparison the
-- docs use works here without inventing a second mechanism.
alter table public.profiles add column if not exists prefs      jsonb  not null default '{}'::jsonb;
alter table public.profiles add column if not exists prefs_rev  bigint not null default 0;

-- The column privileges for profiles, now that prefs exists. Re-granted here
-- rather than edited into 0002, so 0002 stays a faithful record of what it did.
--
-- The revoke has to come FIRST and has to be table-wide: revoking a column
-- privilege out of a table-wide grant is a silent no-op in Postgres, so
-- `revoke update (plan) on profiles` on its own looks like it worked and
-- changes nothing. 0002 has the long version of this note; do not "simplify"
-- either of them.
revoke update on public.profiles from anon, authenticated;
grant  update (email, display_name, prefs) on public.profiles to authenticated;

-- prefs_rev is the SERVER'S count, for the same reason docs.rev is: a client
-- that picks its own revision number can pick a large one and win every future
-- comparison. It is deliberately NOT in the grant list above — the trigger
-- moves it, and only when prefs actually changed, so renaming yourself does
-- not make your theme look newer than the theme on your other machine.
create or replace function public.profiles_before_update()
returns trigger
language plpgsql
as $fn$
begin
  new.prefs_rev := old.prefs_rev;
  if new.prefs is distinct from old.prefs then
    new.prefs_rev := old.prefs_rev + 1;
  end if;
  return new;
end;
$fn$;

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();


-- ── 9. storage ──────────────────────────────────────────────────────────────
-- ONE private bucket for images, PDFs and attachments. 0001 created
-- `notebook-images`, which only ever made sense while images were the only
-- binary that synced.
--
-- Path: {owner_id}/{kind}/{asset_id}
-- owner_id leads so the policy can match on the first path segment, which is
-- the only part of an object name a storage policy can cheaply constrain.
--
-- file_size_limit is set server-side to 50MB, matching MAX_FILE_BYTES in
-- lib/files.js. The client already refuses larger files; this is the copy of
-- that rule that a modified client cannot edit out.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ds-assets', 'ds-assets', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;

drop policy if exists "own notebook images" on storage.objects;
drop policy if exists "ds assets read"   on storage.objects;
drop policy if exists "ds assets write"  on storage.objects;
drop policy if exists "ds assets delete" on storage.objects;

create policy "ds assets read" on storage.objects
  for select using (bucket_id = 'ds-assets' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "ds assets write" on storage.objects
  for insert with check (bucket_id = 'ds-assets' and auth.uid()::text = (storage.foldername(name))[1]);

-- Objects are IMMUTABLE once written. An image is never edited in place — a
-- crop or rotate mints a new id and uploads a new object (backend plan §3),
-- which is what keeps sync from ever having to reconcile two versions of the
-- same bytes and makes every object cacheable forever.
-- No update policy at all, therefore: under RLS an absent policy is a denial.

-- Deletion of the BYTES is allowed, unlike deletion of the manifest row: the
-- collector removes an object only after its row has been soft-deleted past
-- the 30-day window, and an object with no row is already garbage. The
-- asymmetry is deliberate — losing bytes whose manifest row survives is a
-- broken image; losing a manifest row whose bytes survive is a leak. Broken is
-- worse, so the row is the thing that is protected.
create policy "ds assets delete" on storage.objects
  for delete using (bucket_id = 'ds-assets' and auth.uid()::text = (storage.foldername(name))[1]);

-- THE OLD BUCKET IS LEFT IN PLACE, and not because it was forgotten.
--
-- `delete from storage.buckets` is refused by Supabase's own
-- storage.protect_delete() trigger: "Direct deletion from storage tables is
-- not allowed. Use the Storage API instead." That guard exists to stop a
-- bucket row being removed while objects still reference it, which would
-- orphan the bytes with nothing left pointing at them — the same asymmetry
-- this migration reasons about in section 9, enforced by Supabase one level
-- up. It is right, and working around it would be working around a data-loss
-- protection.
--
-- `notebook-images` never held an object (image upload did not exist until
-- lib/cloudassets.js), so it costs nothing to leave. Remove it by hand in
-- Storage -> Buckets if the empty row is annoying.
do $do$
begin
  if exists (select 1 from storage.buckets where id = 'notebook-images') then
    raise notice 'The unused notebook-images bucket is still present. Delete it from the Storage page in the dashboard — SQL cannot, by design.';
  end if;
end
$do$;


-- ── 10. realtime ────────────────────────────────────────────────────────────
-- Subscribed to only as a NOTIFY — "something of yours changed, go pull" — not
-- as a stream of edits. Streaming edits is what a CRDT is for, and you do not
-- have simultaneous multi-user editing; you have one person on two machines.
--
-- Wrapped because the publication may not exist on a project where Realtime
-- was never enabled, and a migration that fails on an optional feature is a
-- migration people learn to run in pieces.
do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
    ) then
      alter publication supabase_realtime add table public.docs;
    end if;
  else
    raise notice 'supabase_realtime publication not found — enable Realtime in the dashboard, then re-run section 10.';
  end if;
end
$do$;

-- Realtime respects RLS, but only if the row it is about can be identified
-- after a delete. Without this, a DELETE event arrives with the primary key
-- only and the policy cannot evaluate owner_id, so the event is dropped.
alter table public.docs replica identity full;
