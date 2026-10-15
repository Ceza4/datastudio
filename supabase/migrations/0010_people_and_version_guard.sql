-- ============================================================================
--  0010_people_and_version_guard.sql
--
--  TWO THINGS, BOTH FOUND WHILE MAKING THE PEOPLE PANEL WORK.
--
--  ── 1. AN OLDER APP MUST NOT OVERWRITE WHAT A NEWER ONE SAVED ──────────────
--
--  A tab still running last week's code loaded a document, sanitised it with
--  last week's allowlist — which did not know section breaks or tab stops — and
--  pushed the result. The newer markup was gone, silently, on every device.
--  Compare-and-set on `rev` cannot see this: the old tab's write was perfectly
--  ordered. What it lacked was the right to write at all.
--
--  The client now stamps `doc._schema` (lib/appversion.js, CONTENT_SCHEMA) on
--  every document it pushes. This trigger refuses an update that would LOWER
--  it. A client with no stamp counts as 0, so every build that predates this
--  file is refused the moment a newer one has written — which is the point.
--  The refusal names itself (`outdated_client`) so the new client can tell
--  "reload" apart from every other failure; the old client just sees an error
--  and keeps its work in its outbox, which is where it belongs until reload.
--
--  ── 2. A CONVERSATION WITH ONE PERSON MUST BE READABLE BY THAT PERSON ONLY ─
--
--  The People panel's threads were chat BLOCKS hidden in the current project
--  (0009). A chat block is readable by whoever can read the block — every
--  colleague in the organisation, and every person the project is shared with.
--  So a "private" conversation with Ana was readable by Ben, because Ben had
--  the project too. And a conversation with somebody who shared THEIR project
--  with you lived in YOUR project, which they cannot read at all.
--
--  Membership belongs to the conversation, not to a document:
--
--      chat_threads   one conversation, `direct` (two people) or `group`
--      chat_members   who is in it — by account, or by email until they sign
--                     up (claimed exactly like a pending share, 0008 §11)
--      chat_messages  gains `thread_id`; a message belongs to a chat block
--                     OR a thread, never both
--
--  Everything about a thread is written through SECURITY DEFINER functions;
--  the two tables are read-only to clients. A client that could insert a
--  member row could add itself to anybody's conversation.
--
--  ── NOT REVEALING WHO HAS AN ACCOUNT ──────────────────────────────────────
--
--  0008 withholds `shares.grantee_id` so that sharing cannot be used to test
--  whether an address is registered. Threads keep that promise: a member's
--  account is never exposed, and a member's display NAME is shown only once
--  they have taken part (read or written). Until then the thread shows the
--  address that was typed — which the inviter already knew.
--
--  Also: 0009 never added chat_messages to the realtime publication, so
--  "live" chat refreshed only when you sent something. §6.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.chat_messages') is null then
    raise exception '0009 has not been applied — public.chat_messages is missing.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  1. THE VERSION GUARD
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.doc_schema_of(d jsonb)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case when (d ->> '_schema') ~ '^[0-9]{1,6}$' then (d ->> '_schema')::int else 0 end
$fn$;

create or replace function public.docs_schema_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  was int := public.doc_schema_of(old.doc);
  now_ int := public.doc_schema_of(new.doc);
begin
  if new.doc is distinct from old.doc and now_ < was then
    raise exception 'outdated_client: this document was saved by a newer version of DataStudio (format %, this app writes %). Reload to keep editing.', was, now_
      using errcode = 'P0001', hint = 'outdated_client';
  end if;
  return new;
end $fn$;

-- Named to sort FIRST among the before-update triggers (they fire in name
-- order), so nothing else spends work on a write that is about to be refused.
drop trigger if exists docs_00_schema_guard on public.docs;
create trigger docs_00_schema_guard
  before update on public.docs
  for each row execute function public.docs_schema_guard();


-- ════════════════════════════════════════════════════════════════════════════
--  2. THREADS AND THEIR MEMBERS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.chat_threads (
  id              text primary key,
  kind            text not null check (kind in ('direct', 'group')),
  title           text check (title is null or length(title) <= 80),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz
);

comment on table public.chat_threads is
  'A conversation between people, independent of any document. Written only through the chat_* functions. See 0010.';

create table if not exists public.chat_members (
  id           bigint generated always as identity primary key,
  thread_id    text not null references public.chat_threads(id) on delete cascade,
  -- One of these identifies the member. `email` is kept for everybody (it is
  -- what a block shared into the thread is granted to, see lib/chat.js); an
  -- unclaimed invite has only the email.
  user_id      uuid references auth.users(id) on delete cascade,
  email        text,
  added_by     uuid references auth.users(id) on delete set null,
  added_at     timestamptz not null default now(),
  left_at      timestamptz,
  last_read_at timestamptz,
  constraint chat_members_who check (user_id is not null or email is not null)
);

create unique index if not exists chat_members_one_user
  on public.chat_members (thread_id, user_id) where user_id is not null;
create unique index if not exists chat_members_one_email
  on public.chat_members (thread_id, lower(email)) where user_id is null;
create index if not exists chat_members_mine
  on public.chat_members (user_id) where left_at is null;
create index if not exists chat_members_pending_email
  on public.chat_members (lower(email)) where user_id is null;

-- Messages: a block's OR a thread's.
alter table public.chat_messages
  add column if not exists thread_id text references public.chat_threads(id) on delete cascade;
alter table public.chat_messages alter column block_id drop not null;
alter table public.chat_messages alter column doc_id drop not null;

alter table public.chat_messages drop constraint if exists chat_one_home;
alter table public.chat_messages add constraint chat_one_home
  check ((block_id is null) <> (thread_id is null));

create index if not exists chat_thread_msgs_idx
  on public.chat_messages (thread_id, created_at) where thread_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
--  3. WHO IS IN WHICH CONVERSATION
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_thread_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select m.thread_id from public.chat_members m
   where m.user_id = (select auth.uid()) and m.left_at is null
$fn$;


-- ════════════════════════════════════════════════════════════════════════════
--  4. MESSAGES: THE 0009 TRIGGER, TAUGHT ABOUT THREADS
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.chat_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  actor uuid := (select auth.uid());
  b     record;
begin
  if tg_op = 'UPDATE' then
    new.id         := old.id;
    new.org_id     := old.org_id;
    new.doc_id     := old.doc_id;
    new.block_id   := old.block_id;
    new.thread_id  := old.thread_id;
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
    new.ref_block_id := old.ref_block_id;
    new.ref_share_id := old.ref_share_id;

    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
      new.body := null;
      new.bytes := 0;
    else
      new.deleted_at := old.deleted_at;
    end if;

    if new.body is distinct from old.body and new.deleted_at is null then
      new.edited_at := now();
      new.bytes := coalesce(octet_length(new.body), 0);
    end if;
    return new;
  end if;

  if new.thread_id is not null and new.block_id is not null then
    raise exception 'A message belongs to a chat block or a conversation, not both.' using errcode = 'check_violation';
  end if;

  if new.thread_id is not null then
    if not exists (select 1 from public.chat_members m
                    where m.thread_id = new.thread_id and m.user_id = actor and m.left_at is null) then
      raise exception 'You are not in this conversation.' using errcode = 'insufficient_privilege';
    end if;
    -- A thread belongs to no document; its words are metered to the author's
    -- own organisation, which is who is paying for having said them.
    new.org_id := public.default_org();
    new.doc_id := null;
  else
    select id, org_id, doc_id into b from public.blocks where id = new.block_id;
    if b.id is null then
      raise exception 'That chat block no longer exists.' using errcode = 'foreign_key_violation';
    end if;
    new.org_id := b.org_id;
    new.doc_id := b.doc_id;
  end if;

  new.author_id  := actor;
  -- clock_timestamp(), not now(): now() is the TRANSACTION's start, so two
  -- messages in one transaction — or a message and a read marker — would tie,
  -- and "unread since" comparisons would call a fresh message already read.
  new.created_at := clock_timestamp();
  new.edited_at  := null;
  new.deleted_at := null;
  new.bytes      := coalesce(octet_length(new.body), 0);

  if exists (
    select 1 from public.chat_messages
     where deleted_at is null
       and ((new.thread_id is not null and thread_id = new.thread_id)
         or (new.block_id  is not null and block_id  = new.block_id))
     offset 4999 limit 1
  ) then
    raise exception 'This conversation has reached its limit of 5000 messages.'
      using errcode = 'check_violation';
  end if;

  if new.ref_block_id is not null then
    if new.ref_block_id not in (select public.my_readable_block_ids()) then
      raise exception 'You cannot share a block you cannot see.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.thread_id is not null then
    update public.chat_threads set last_message_at = new.created_at where id = new.thread_id;
    -- Saying something is reading everything before it.
    update public.chat_members set last_read_at = new.created_at
     where thread_id = new.thread_id and user_id = actor;
  end if;

  return new;
end $fn$;

-- The org pin: `org_id` stays NOT NULL (the meter and the org index need it);
-- default_org() above always has an answer for a signed-in author.

drop policy if exists "chat readable" on public.chat_messages;
create policy "chat readable" on public.chat_messages
  for select using (
    (block_id is not null and block_id in (select public.my_readable_block_ids()))
    or (thread_id is not null and thread_id in (select public.my_thread_ids()))
  );

drop policy if exists "chat postable" on public.chat_messages;
create policy "chat postable" on public.chat_messages
  for insert with check (
    (block_id is not null and block_id in (select public.my_readable_block_ids()))
    or (thread_id is not null and thread_id in (select public.my_thread_ids()))
  );

grant select (thread_id) on public.chat_messages to authenticated;
grant insert (thread_id) on public.chat_messages to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  5. THREADS AND MEMBERS: READ-ONLY TO CLIENTS, WRITTEN BY FUNCTIONS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.chat_threads enable row level security;
alter table public.chat_members enable row level security;

drop policy if exists "threads i am in" on public.chat_threads;
create policy "threads i am in" on public.chat_threads
  for select using (id in (select public.my_thread_ids()));

-- Members are listed through chat_my_threads(), which decides what of each
-- member may be shown. No direct read: the table carries user ids, and a
-- member's account is exactly what must not leak (header).
-- An explicit deny, so "RLS on, no policy" reads as a decision rather than an
-- oversight (01_repair_checks.sql 17b flags the latter).
drop policy if exists "members only through functions" on public.chat_members;
create policy "members only through functions" on public.chat_members
  for select using (false);

revoke all on public.chat_threads from anon, authenticated;
revoke all on public.chat_members from anon, authenticated;
grant select (id, kind, title, created_at, last_message_at) on public.chat_threads to authenticated;

create or replace function public.chat_norm_emails(p_emails text[])
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select coalesce(array_agg(distinct e), '{}')
    from (select lower(trim(x)) as e from unnest(coalesce(p_emails, '{}')) x) s
   where e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(e) <= 254
$fn$;

-- Adds each address to a thread. Resolves registered people to their account
-- (never returned to the caller), leaves the rest as pending invites.
create or replace function public.chat_add_emails(p_thread text, p_emails text[], p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  e text; uid uuid; n int := 0;
begin
  foreach e in array public.chat_norm_emails(p_emails) loop
    select p.id into uid from public.profiles p where lower(p.email) = e limit 1;
    if uid = p_actor then continue; end if;
    if uid is not null then
      if exists (select 1 from public.chat_members where thread_id = p_thread and user_id = uid) then
        update public.chat_members set left_at = null, email = coalesce(email, e)
         where thread_id = p_thread and user_id = uid and left_at is not null;
        continue;
      end if;
    elsif exists (select 1 from public.chat_members where thread_id = p_thread and user_id is null and lower(email) = e) then
      continue;
    end if;
    insert into public.chat_members (thread_id, user_id, email, added_by)
    values (p_thread, uid, e, p_actor);
    n := n + 1;
  end loop;
  return n;
end $fn$;

/**
 * Start a conversation, or return the one that already exists.
 * One address and no title → a DIRECT thread, reused if you already have one
 * with that address. Anything else → a GROUP thread.
 */
create or replace function public.chat_start_thread(p_emails text[], p_title text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  actor  uuid := (select auth.uid());
  me     text;
  emails text[];
  target uuid;
  tid    text;
  kind   text;
begin
  if actor is null then
    raise exception 'Sign in to start a conversation.' using errcode = 'insufficient_privilege';
  end if;
  select lower(email) into me from public.profiles where id = actor;
  emails := array(select x from unnest(public.chat_norm_emails(p_emails)) x where x is distinct from me);
  if coalesce(array_length(emails, 1), 0) = 0 then
    raise exception 'Add at least one other person''s email.' using errcode = 'check_violation';
  end if;
  if array_length(emails, 1) > 49 then
    raise exception 'A conversation can have at most 50 people.' using errcode = 'check_violation';
  end if;

  kind := case when array_length(emails, 1) = 1 and nullif(trim(coalesce(p_title, '')), '') is null
               then 'direct' else 'group' end;

  if kind = 'direct' then
    select p.id into target from public.profiles p where lower(p.email) = emails[1] limit 1;
    select t.id into tid
      from public.chat_threads t
      join public.chat_members mine on mine.thread_id = t.id and mine.user_id = actor
      join public.chat_members them on them.thread_id = t.id and them.id <> mine.id
     where t.kind = 'direct'
       and ((target is not null and them.user_id = target)
         or (them.user_id is null and lower(them.email) = emails[1]))
     order by t.created_at
     limit 1;
    if tid is not null then
      update public.chat_members set left_at = null where thread_id = tid and user_id = actor;
      return tid;
    end if;
  end if;

  tid := 'thr_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.chat_threads (id, kind, title, created_by)
  values (tid, kind, nullif(left(trim(coalesce(p_title, '')), 80), ''), actor);
  insert into public.chat_members (thread_id, user_id, email, added_by, last_read_at)
  values (tid, actor, me, actor, clock_timestamp());
  perform public.chat_add_emails(tid, emails, actor);
  return tid;
end $fn$;

create or replace function public.chat_add_members(p_thread text, p_emails text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  actor uuid := (select auth.uid());
  k text;
  n int;
begin
  if p_thread not in (select public.my_thread_ids()) then
    raise exception 'You are not in this conversation.' using errcode = 'insufficient_privilege';
  end if;
  select kind into k from public.chat_threads where id = p_thread;
  if k = 'direct' then
    raise exception 'Start a group to add more people.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.chat_members where thread_id = p_thread and left_at is null)
     + coalesce(array_length(public.chat_norm_emails(p_emails), 1), 0) > 50 then
    raise exception 'A conversation can have at most 50 people.' using errcode = 'check_violation';
  end if;
  n := public.chat_add_emails(p_thread, p_emails, actor);
  return n;
end $fn$;

create or replace function public.chat_rename(p_thread text, p_title text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_thread not in (select public.my_thread_ids()) then
    raise exception 'You are not in this conversation.' using errcode = 'insufficient_privilege';
  end if;
  update public.chat_threads
     set title = nullif(left(trim(coalesce(p_title, '')), 80), '')
   where id = p_thread and kind = 'group';
end $fn$;

create or replace function public.chat_leave(p_thread text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.chat_members set left_at = now()
   where thread_id = p_thread and user_id = (select auth.uid()) and left_at is null;
end $fn$;

create or replace function public.chat_mark_read(p_thread text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.chat_members set last_read_at = clock_timestamp()
   where thread_id = p_thread and user_id = (select auth.uid()) and left_at is null;
end $fn$;

/**
 * My conversations, newest first, with who is in each and how many messages
 * I have not read. The ONLY way a client learns about members, so this is
 * where the "no account oracle" rule lives: a member's name appears once they
 * have read or written in the thread; before that, the address as typed.
 */
create or replace function public.chat_my_threads()
returns table (
  id text, kind text, title text, created_at timestamptz, last_message_at timestamptz,
  last_body text, last_author_self boolean, unread integer, members jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with me as (select (select auth.uid()) as uid),
  mine as (
    select m.thread_id, m.last_read_at, m.added_at
      from public.chat_members m, me
     where m.user_id = me.uid and m.left_at is null
  )
  select t.id, t.kind, t.title, t.created_at, t.last_message_at,
         lm.body, lm.author_id = (select uid from me),
         (select count(*)::int from public.chat_messages x
           where x.thread_id = t.id and x.deleted_at is null
             and x.author_id is distinct from (select uid from me)
             and x.created_at > coalesce(mine.last_read_at, mine.added_at)),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'key', 'm' || m.id,
                    'self', m.user_id = (select uid from me),
                    'email', m.email,
                    'name', case when m.user_id = (select uid from me)
                                   or m.last_read_at is not null
                                   or exists (select 1 from public.chat_messages y
                                               where y.thread_id = t.id and y.author_id = m.user_id)
                                 then coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, m.email), '@', 1))
                                 else null end,
                    'joined', m.user_id = (select uid from me)
                                or m.last_read_at is not null,
                    'left', m.left_at is not null)
                  order by m.added_at), '[]'::jsonb)
            from public.chat_members m
            left join public.profiles p on p.id = m.user_id
           where m.thread_id = t.id)
    from mine
    join public.chat_threads t on t.id = mine.thread_id
    left join lateral (
      select x.body, x.author_id from public.chat_messages x
       where x.thread_id = t.id and x.deleted_at is null
       order by x.created_at desc limit 1
    ) lm on true
   order by coalesce(t.last_message_at, t.created_at) desc
$fn$;

/**
 * The people who have shared something with me, by name. They chose to give
 * me access, so showing me who they are discloses nothing they did not; the
 * profile table itself stays organisation-scoped.
 */
create or replace function public.people_who_shared_with_me()
returns table (user_id uuid, name text, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select distinct p.id, coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1)), lower(p.email)
    from public.shares s
    join public.profiles p on p.id = s.created_by
   where s.grantee_id = (select auth.uid()) and s.revoked_at is null
$fn$;


-- ════════════════════════════════════════════════════════════════════════════
--  6. PENDING MEMBERS ARE CLAIMED AT SIGN-UP, AND CHAT IS LIVE
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.claim_pending_chat_members()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.email is null then return null; end if;
  update public.chat_members m
     set user_id = new.id
   where m.user_id is null
     and lower(m.email) = lower(new.email)
     and not exists (select 1 from public.chat_members o
                      where o.thread_id = m.thread_id and o.user_id = new.id);
  return null;
end $fn$;

drop trigger if exists profiles_claim_chat on public.profiles;
create trigger profiles_claim_chat
  after insert on public.profiles
  for each row execute function public.claim_pending_chat_members();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
  else
    raise notice 'supabase_realtime publication not found — chat will refresh on send only.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  7. THE DEFINER SURFACE, RE-CLOSED
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  fn record;
  keep_for_authenticated text[] := array[
    'is_org_member', 'has_org_role', 'org_plan', 'my_org_ids', 'my_account', 'default_org',
    'my_shared_doc_ids', 'my_shared_block_ids', 'my_editable_block_ids',
    'my_editable_doc_ids', 'my_hidden_doc_ids', 'shared_asset_ids',
    'my_readable_block_ids',
    -- new in 0010
    'my_thread_ids', 'chat_start_thread', 'chat_add_members', 'chat_rename',
    'chat_leave', 'chat_mark_read', 'chat_my_threads', 'people_who_shared_with_me'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
    if fn.proname = any(keep_for_authenticated) then
      execute format('grant execute on function %s to authenticated', fn.sig);
    else
      execute format('revoke all on function %s from authenticated', fn.sig);
    end if;
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  8. SELF-TEST (structural; behaviour is supabase/test/04_people_checks.sql)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare n int;
begin
  if to_regclass('public.chat_threads') is null or to_regclass('public.chat_members') is null then
    raise exception '0010: thread tables missing';
  end if;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('chat_threads', 'chat_members')
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if n > 0 then raise exception '0010: clients can write thread tables directly (% grants)', n; end if;
  select count(*) into n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'chat_members' and grantee in ('anon', 'authenticated');
  if n > 0 then raise exception '0010: chat_members is directly readable — it carries account ids'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'docs_00_schema_guard') then
    raise exception '0010: the version guard is not installed';
  end if;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and array_to_string(coalesce(p.proacl, '{}'), ',') like '=X/%';
  if n > 0 then raise exception '0010: % SECURITY DEFINER function(s) are PUBLIC-executable', n; end if;
end $$;

commit;
