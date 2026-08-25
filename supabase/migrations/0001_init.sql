-- =============================================================================
-- DataStudio — initial Supabase schema
-- =============================================================================
-- Source of design: DATASTUDIO-BACKEND-PLAN.md §2 (schema) and §2 RLS.
-- IndexedDB stays the source of truth on the client; this is a *replica*,
-- not the primary store — see that doc before changing anything here.
--
-- HOW TO RUN THIS
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file
--   -> Run. It's idempotent-ish (uses IF NOT EXISTS / OR REPLACE where it
--   can) but is meant to be run once on a fresh project, not repeatedly.
--
-- AFTER RUNNING: do the RLS penetration test in SUPABASE_SETUP.md before
-- writing any client code that reads/writes these tables. Do not trust the
-- policy text — try to break it.
-- =============================================================================

-- ── folders (created before notebooks — notebooks.folder_id references it) ──
create table if not exists public.folders (
  id        uuid primary key default gen_random_uuid(),
  owner_id  uuid not null references auth.users on delete cascade,
  name      text not null,
  position  integer not null default 0
);
create index if not exists folders_owner_idx on public.folders (owner_id);

-- ── profiles ──────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text,
  display_name text,
  plan         text not null default 'free',   -- free | pro | team
  created_at   timestamptz not null default now()
);

-- ── notebooks ─────────────────────────────────────────────────────────────
-- A notebook is a tree that's only ever read/written whole, so it's one
-- JSONB blob (sheets, blocks, connections) rather than a normalised
-- notebooks -> sheets -> blocks -> cells chain. See plan §2 for why.
create table if not exists public.notebooks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users on delete cascade,
  name        text not null default 'Untitled',
  doc         jsonb not null default '{}'::jsonb,
  folder_id   uuid references public.folders on delete set null,
  bytes       integer not null default 0,          -- doc size, for metering
  rev         bigint  not null default 1,           -- optimistic concurrency (plan §3)
  device_id   text,                                 -- who wrote this rev
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                           -- soft delete, 30-day window
);
create index if not exists notebooks_owner_updated_idx
  on public.notebooks (owner_id, updated_at desc);

-- ── images ────────────────────────────────────────────────────────────────
-- Bytes live in Storage; this is the manifest that makes metering and
-- orphan-collection possible without listing a bucket.
create table if not exists public.images (
  id          text primary key,                     -- the imageId already in blocks
  owner_id    uuid not null references auth.users on delete cascade,
  notebook_id uuid references public.notebooks on delete cascade,
  path        text not null,                         -- storage object path
  bytes       integer not null,
  width       integer,
  height      integer,
  mime        text,
  created_at  timestamptz not null default now()
);
create index if not exists images_owner_idx on public.images (owner_id);

-- ── usage — maintained by trigger, never written directly by the client ────
create table if not exists public.usage (
  owner_id       uuid primary key references auth.users on delete cascade,
  doc_bytes      bigint not null default 0,
  image_bytes    bigint not null default 0,
  notebook_count integer not null default 0,
  updated_at     timestamptz not null default now()
);

-- Recomputes one owner's row from source tables rather than incrementing/
-- decrementing counters. Slightly more work per write, but it can never
-- drift out of sync the way +=/-= bookkeeping does after a crashed
-- transaction or a manual row delete in the dashboard.
create or replace function public.recompute_usage(target_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage (owner_id, doc_bytes, image_bytes, notebook_count, updated_at)
  values (
    target_owner,
    coalesce((select sum(bytes) from public.notebooks where owner_id = target_owner and deleted_at is null), 0),
    coalesce((select sum(bytes) from public.images where owner_id = target_owner), 0),
    coalesce((select count(*) from public.notebooks where owner_id = target_owner and deleted_at is null), 0),
    now()
  )
  on conflict (owner_id) do update set
    doc_bytes      = excluded.doc_bytes,
    image_bytes    = excluded.image_bytes,
    notebook_count = excluded.notebook_count,
    updated_at     = now();
end;
$$;

create or replace function public.trg_recompute_usage_notebooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_usage(coalesce(new.owner_id, old.owner_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.trg_recompute_usage_images()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_usage(coalesce(new.owner_id, old.owner_id));
  return coalesce(new, old);
end;
$$;

-- Fires on every write, not just bytes/deleted_at changes — recomputing is
-- cheap at this scale and "restrict to these columns" is one more thing to
-- remember to update correctly if a new metered column is added later.
drop trigger if exists notebooks_usage_trigger on public.notebooks;
create trigger notebooks_usage_trigger
  after insert or update or delete on public.notebooks
  for each row execute function public.trg_recompute_usage_notebooks();

drop trigger if exists images_usage_trigger on public.images;
create trigger images_usage_trigger
  after insert or delete on public.images
  for each row execute function public.trg_recompute_usage_images();

-- ── auto-create a profile row when someone signs up ─────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.usage (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Row-level security
-- =============================================================================
-- Supabase exposes Postgres directly to the browser via the anon key. Without
-- RLS, every signed-in user can read every row in every table above. This is
-- the part to get right before anything else — see SUPABASE_SETUP.md for the
-- penetration test to run immediately after this file executes.

alter table public.profiles  enable row level security;
alter table public.notebooks enable row level security;
alter table public.folders   enable row level security;
alter table public.images    enable row level security;
alter table public.usage     enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own notebooks" on public.notebooks;
create policy "own notebooks" on public.notebooks
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "own folders" on public.folders;
create policy "own folders" on public.folders
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "own images" on public.images;
create policy "own images" on public.images
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- usage is written only by the triggers above (security definer), never by
-- the client directly — so the client only ever needs read access.
drop policy if exists "read own usage" on public.usage;
create policy "read own usage" on public.usage
  for select using (auth.uid() = owner_id);

-- =============================================================================
-- Storage bucket for notebook images
-- =============================================================================
-- Private bucket. Path convention: {owner_id}/{notebook_id}/{image_id}.{ext}
-- Putting owner_id first lets the storage policy below match on the leading
-- path segment (storage.foldername splits the object path on '/').

insert into storage.buckets (id, name, public)
values ('notebook-images', 'notebook-images', false)
on conflict (id) do nothing;

drop policy if exists "own notebook images" on storage.objects;
create policy "own notebook images" on storage.objects
  for all
  using (bucket_id = 'notebook-images' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'notebook-images' and auth.uid()::text = (storage.foldername(name))[1]);
