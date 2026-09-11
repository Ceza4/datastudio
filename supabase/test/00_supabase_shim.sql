-- Local stand-in for the parts of Supabase these migrations touch.
-- NOT a Supabase emulator: it exists so `psql < 0001..0005` can be run and
-- exercised on a laptop or in CI, which is the only reason 0004's breakage
-- survived to production.
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')           then create role anon           nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated')  then create role authenticated  nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')   then create role service_role   nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if;
end $$;

grant anon, authenticated, service_role to postgres;

create schema if not exists auth;
create schema if not exists storage;

-- Column set matches what supabase/rls_pentest.sql inserts, so the same file
-- runs here and against a real project without a local variant to drift.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_super_admin     boolean,
  last_sign_in_at    timestamptz,
  confirmation_token text,
  recovery_token     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Supabase reads these from the request JWT. Here they read a GUC the test
-- sets, which is exactly how supabase/rls_pentest.sql already drives them.
-- Real Supabase reads the whole claims blob and pulls 'sub' out of it. The
-- per-claim GUCs are a legacy fallback that some tooling still sets, so both
-- are honoured here — a shim that only understood one of them would make
-- rls_pentest.sql (claims blob) and this directory's own tests (per-claim)
-- disagree about who is signed in, which is worse than either.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    nullif(current_setting('request.jwt.claim.sub', true), '')
  )::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    'anon'
  )
$$;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets,
  name             text,
  owner            uuid,          -- deprecated upstream, still present
  owner_id         text,
  version          text,
  path_tokens      text[],
  metadata         jsonb,
  user_metadata    jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

-- Verbatim from Supabase's storage schema: splits on '/' and drops the final
-- segment, so [1] is the leading directory. The migrations' whole tenant
-- boundary rests on this returning what they think it returns.
create or replace function storage.foldername(name text) returns text[]
language plpgsql stable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts,1) - 1];
end $$;

-- Supabase's protect_delete() guard on buckets, which 0003 ran into.
create or replace function storage.protect_delete() returns trigger language plpgsql as $$
begin raise exception 'Deleting buckets through SQL is not permitted.'; end $$;

-- Supabase grants these broadly by default; the migrations' revokes only make
-- sense against that baseline.
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on all tables    in schema public  to anon, authenticated, service_role;
grant all on all sequences in schema public  to anon, authenticated, service_role;
grant all on all tables    in schema storage to anon, authenticated, service_role;
alter default privileges in schema public  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema storage grant all on tables    to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
