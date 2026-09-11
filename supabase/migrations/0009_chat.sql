-- ============================================================================
--  0009_chat.sql
--
--  A CONVERSATION THAT LIVES ON THE CANVAS.
--
--  Matas asked for "a chatting block where you can allow certain people to join
--  your sheet or project", and for a block you can drag into that chat and have
--  the other person drag back out. 0007 made a block addressable; 0008 made a
--  grant. This is the third piece, and it is deliberately the smallest of the
--  three, because both hard problems are already solved:
--
--    · WHO CAN SEE THIS THREAD is not a new question. It is "who can read the
--      chat block", which 0008 already answers. There is no separate
--      membership, no invite, no second permission model to keep in step with
--      the first. A thread is readable by exactly the people who can read the
--      block it sits in.
--
--    · WHAT A SHARED BLOCK IS is not a new question either. A message carrying
--      a block is a message carrying a `blocks.id` and the `shares.id` that
--      makes it readable — a reference, not a copy. The content already lives
--      in `blocks.data` for precisely the duration of that grant.
--
--  ── THE DECISION THAT WILL LOOK WRONG AND IS NOT ───────────────────────────
--
--  A VIEWER CAN POST. Read access to the block is write access to the thread.
--
--  That reads like a permission bug and it is the whole point: you share a
--  sheet with somebody so they can tell you what they think of it. A chat where
--  the person you invited cannot reply is not a chat, it is a notice board, and
--  nobody would ship it twice. Editing the SHEET still requires `editor` —
--  those are different verbs and 0008 keeps them apart.
--
--  ── METERING, AND WHY IT IS NOT IN THE QUOTA YET ───────────────────────────
--
--  Everything on disk should be metered; 0005 exists because it was not. But
--  `recompute_usage_org()` is the function every write in an organisation
--  passes through, and getting it wrong means nobody in that tenant can save
--  anything. Redefining it to fold in a third source, in the same migration
--  that introduces that source, is a bad trade.
--
--  So: `usage.chat_bytes` is maintained here by its own small trigger that
--  touches ONLY that column, and the abuse ceiling is enforced directly
--  instead — 4 000 characters a message, 5 000 messages a block. That is a
--  hard bound of ~20 MB per chat block, reached by a person typing full-length
--  messages five thousand times. Once the number has been watched in
--  production for a while, folding it into the quota check is a three-line
--  change to a function whose behaviour is then already known.
--
--  MEASURE FIRST, ENFORCE CHEAPLY, TIGHTEN LATER — rather than rewriting the
--  most dangerous function in the schema on the strength of an estimate.
--
--  ── ONE THING THE CLIENT MUST NOT GET WRONG ────────────────────────────────
--
--  `body` IS PLAIN TEXT. It is not sanitised here, because it is never meant to
--  reach an HTML parser: the renderer sets textContent, not innerHTML. If a
--  future renderer ever wants formatting, it goes through lib/sanitize.js like
--  every other rich field in this codebase, and this comment becomes wrong.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.shares') is null then
    raise exception '0008 has not been applied — public.shares is missing.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  1. THE TABLE
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.chat_messages (
  id        text primary key,

  -- Denormalised from the block, pinned by trigger. Same argument as
  -- `blocks.org_id` in 0007: every policy and index below reaches the tenant
  -- without a join.
  org_id    text not null references public.organizations(id) on delete cascade,
  doc_id    text not null references public.docs(id) on delete cascade,

  -- The CHAT BLOCK this thread belongs to. ON DELETE CASCADE: deleting the
  -- block deletes the conversation, which is what a person dragging a chat
  -- block to the bin unambiguously means.
  block_id  text not null references public.blocks(id) on delete cascade,

  -- ON DELETE SET NULL, not CASCADE. When somebody deletes their account their
  -- side of a conversation must not vanish out of everybody else's — the other
  -- half would stop making sense. The message survives, unattributed.
  author_id uuid references auth.users(id) on delete set null,

  body      text,

  -- A message can carry a BLOCK instead of, or as well as, words. Both halves
  -- are needed: the block id is what to render, the share id is what makes it
  -- readable, and a reference whose grant has been revoked must degrade to
  -- "this was removed" rather than to a silent blank.
  ref_block_id text references public.blocks(id) on delete set null,
  ref_share_id text references public.shares(id) on delete set null,

  bytes     integer not null default 0,   -- server-computed, see §3

  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,

  constraint chat_body_len check (body is null or length(body) <= 4000),

  -- A message with neither words nor a block is not a message — UNLESS it has
  -- been unsent, which is precisely the state where having nothing left is the
  -- point. The first draft of this constraint omitted the `deleted_at` arm and
  -- the trigger in §3, which nulls the body on unsend, could not commit: every
  -- attempt to unsend a text-only message failed on the table's own check.
  -- Caught by 03_chat_checks.sql check 9, which is the only reason the two
  -- halves were ever run against each other.
  constraint chat_has_content check (
    deleted_at is not null or body is not null or ref_block_id is not null
  )
);

comment on table public.chat_messages is
  'One message in the thread belonging to one chat block. Readable and postable by whoever can read that block. See 0009.';

-- The only read this table ever serves: one thread, oldest first.
create index if not exists chat_thread_idx
  on public.chat_messages (block_id, created_at);

-- "how big is this conversation", for §4's meter.
create index if not exists chat_org_idx on public.chat_messages (org_id);


-- ════════════════════════════════════════════════════════════════════════════
--  2. WHICH BLOCKS I CAN READ AT ALL
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0008 has `my_shared_block_ids()` — blocks reached by a GRANT. The chat needs
-- the wider set: grants plus my own organisation's blocks. Stated once here
-- rather than inlined into three policies, for the reason 0008 §5 gives at
-- length: a policy that reads `shares` directly is evaluated as the querying
-- role and needs SELECT on a column that is deliberately withheld.
create or replace function public.my_readable_block_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select b.id from public.blocks b
   where b.org_id in (select public.my_org_ids())
     and b.doc_id not in (select public.my_hidden_doc_ids())
  union
  select public.my_shared_block_ids()
$fn$;


-- ════════════════════════════════════════════════════════════════════════════
--  3. WHAT THE CLIENT MAY SAY
-- ════════════════════════════════════════════════════════════════════════════
--
-- The client supplies: id, block_id, body, and optionally a reference. Author,
-- tenant, document, size and every timestamp are computed. A client that can
-- name the author of a message can put words in a colleague's mouth, which is
-- a worse failure than a forged block edit — 0007 §2 makes the same argument
-- about `edited_by` and it applies twice as hard to speech.
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
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
    new.ref_block_id := old.ref_block_id;
    new.ref_share_id := old.ref_share_id;

    -- A deletion is a tombstone and the clock is ours. A client may say
    -- "deleted" or "not deleted" and nothing else about when — the same clamp
    -- `docs.deleted_at` got in 0003, and for the same reason.
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
      new.body := null;            -- an unsent message leaves no text behind
      new.bytes := 0;
    elsif new.deleted_at is null then
      new.deleted_at := old.deleted_at;
    else
      new.deleted_at := old.deleted_at;
    end if;

    if new.body is distinct from old.body and new.deleted_at is null then
      new.edited_at := now();
      new.bytes := coalesce(octet_length(new.body), 0);
    end if;
    return new;
  end if;

  select id, org_id, doc_id into b from public.blocks where id = new.block_id;
  if b.id is null then
    raise exception 'That chat block no longer exists.' using errcode = 'foreign_key_violation';
  end if;

  new.org_id     := b.org_id;
  new.doc_id     := b.doc_id;
  new.author_id  := actor;
  new.created_at := now();
  new.edited_at  := null;
  new.deleted_at := null;
  new.bytes      := coalesce(octet_length(new.body), 0);

  -- THE ABUSE CEILING. See the header for why this is here rather than in the
  -- quota system. Live rather than cached, because a cached counter is a second
  -- thing to be wrong.
  --
  -- `offset 4999 limit 1` rather than `count(*)`: this stops the index scan at
  -- the five-thousandth row and never reads past it, so the cost of the check
  -- is bounded no matter what the thread does or what a later migration sets
  -- the limit to. A count would keep scanning to the end for an answer it
  -- stopped needing 4999 rows ago.
  if exists (
    select 1 from public.chat_messages
     where block_id = new.block_id and deleted_at is null
     offset 4999 limit 1
  ) then
    raise exception 'This conversation has reached its limit of 5000 messages.'
      using errcode = 'check_violation';
  end if;

  -- A reference must name a block that is actually readable by the person
  -- posting it. Without this, a message could advertise any block id in the
  -- database and the recipient's own policy would be the only thing standing
  -- between them and it.
  if new.ref_block_id is not null then
    if new.ref_block_id not in (select public.my_readable_block_ids()) then
      raise exception 'You cannot share a block you cannot see.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end $fn$;

drop trigger if exists chat_0_before_write on public.chat_messages;
create trigger chat_0_before_write
  before insert or update on public.chat_messages
  for each row execute function public.chat_before_write();


-- ════════════════════════════════════════════════════════════════════════════
--  4. THE METER
-- ════════════════════════════════════════════════════════════════════════════
alter table public.usage add column if not exists chat_bytes bigint not null default 0;

comment on column public.usage.chat_bytes is
  'Bytes of live chat message text in this organisation. Measured, not yet charged — see 0009 header.';

-- Statement-level, with transition tables, for exactly the reason 0008 §10
-- rewrote the usage triggers: a per-row trigger on a bulk insert recomputes the
-- same tenant once per row.
create or replace function public.recompute_chat_bytes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  o text;
begin
  for o in select distinct org_id from touched where org_id is not null loop
    update public.usage u
       set chat_bytes = coalesce((
             select sum(m.bytes) from public.chat_messages m
              where m.org_id = o and m.deleted_at is null), 0)
     where u.org_id = o;
  end loop;
  return null;
end $fn$;

drop trigger if exists chat_meter_ins on public.chat_messages;
drop trigger if exists chat_meter_upd on public.chat_messages;
drop trigger if exists chat_meter_del on public.chat_messages;

create trigger chat_meter_ins after insert on public.chat_messages
  referencing new table as touched
  for each statement execute function public.recompute_chat_bytes();
create trigger chat_meter_upd after update on public.chat_messages
  referencing new table as touched
  for each statement execute function public.recompute_chat_bytes();
create trigger chat_meter_del after delete on public.chat_messages
  referencing old table as touched
  for each statement execute function public.recompute_chat_bytes();


-- ════════════════════════════════════════════════════════════════════════════
--  5. THE POLICIES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.chat_messages enable row level security;

-- READ: whoever can read the block. One rule, no second membership model.
drop policy if exists "chat readable" on public.chat_messages;
create policy "chat readable" on public.chat_messages
  for select using (block_id in (select public.my_readable_block_ids()));

-- POST: the same set. See the header — a viewer who cannot reply is a notice
-- board, not a conversation.
drop policy if exists "chat postable" on public.chat_messages;
create policy "chat postable" on public.chat_messages
  for insert with check (block_id in (select public.my_readable_block_ids()));

-- EDIT / UNSEND: your own words only. `author_id` is stamped by §3 and pinned
-- on update, so this cannot be walked around by claiming to be somebody else
-- after the fact.
drop policy if exists "chat own message" on public.chat_messages;
create policy "chat own message" on public.chat_messages
  for update using  (author_id = (select auth.uid()))
          with check (author_id = (select auth.uid()));

-- No DELETE policy and no DELETE grant. A message is unsent, never erased —
-- the row stays so the thread above and below it still reads as a sequence.
revoke all on public.chat_messages from anon, authenticated;

grant select (id, org_id, doc_id, block_id, author_id, body,
              ref_block_id, ref_share_id, created_at, edited_at, deleted_at)
  on public.chat_messages to authenticated;

-- `bytes` is not readable and not writable: it is bookkeeping, and a client
-- that can see it learns nothing it did not already have.
grant insert (id, block_id, body, ref_block_id, ref_share_id)
  on public.chat_messages to authenticated;

grant update (body, deleted_at) on public.chat_messages to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  6. THE DEFINER SURFACE, RE-CLOSED
-- ════════════════════════════════════════════════════════════════════════════
-- 0006 made this an invariant rather than a list precisely so a later migration
-- could not quietly reopen it. This file adds three definers.
do $$
declare
  fn record;
  keep_for_authenticated text[] := array[
    'is_org_member', 'has_org_role', 'org_plan', 'my_org_ids', 'my_account', 'default_org',
    'my_shared_doc_ids', 'my_shared_block_ids', 'my_editable_block_ids',
    'my_editable_doc_ids', 'my_hidden_doc_ids', 'shared_asset_ids',
    -- new in 0009, called from inside the chat policies
    'my_readable_block_ids'
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
--  7. SELF-TEST
-- ════════════════════════════════════════════════════════════════════════════
-- Structural. The behavioural proof — a stranger seeing nothing, a grantee
-- posting, an author that cannot be forged — is supabase/test/03_chat_checks.sql,
-- which can be two different people.
do $$
declare n int;
begin
  if to_regclass('public.chat_messages') is null then
    raise exception '0009: chat_messages missing';
  end if;

  select count(*) into n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'chat_messages'
     and grantee = 'authenticated' and privilege_type = 'INSERT';
  if n <> 5 then
    raise exception '0009: a client may insert % columns of chat_messages, expected 5', n;
  end if;

  select count(*) into n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'chat_messages'
     and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if n <> 2 then
    raise exception '0009: a client may update % columns of chat_messages, expected 2 (body, deleted_at)', n;
  end if;

  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'chat_messages'
       and grantee in ('authenticated', 'anon')
       and column_name = 'author_id'
       and privilege_type in ('INSERT', 'UPDATE')
  ) then
    raise exception '0009: a client can write chat_messages.author_id — it could put words in a colleague''s mouth';
  end if;

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'chat_messages'
     and grantee in ('anon', 'authenticated') and privilege_type = 'DELETE';
  if n > 0 then raise exception '0009: chat is client-deletable; messages are unsent, not erased'; end if;

  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and array_to_string(coalesce(p.proacl, '{}'), ',') like '=X/%';
  if n > 0 then raise exception '0009: % SECURITY DEFINER function(s) are PUBLIC-executable', n; end if;

  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'my_readable_block_ids'
     and array_to_string(coalesce(p.proacl, '{}'), ',') not like '%authenticated=X%';
  if n > 0 then
    raise exception '0009: my_readable_block_ids is not executable by authenticated — every chat read would fail';
  end if;

  select count(*) into n from pg_trigger
   where tgrelid = 'public.chat_messages'::regclass
     and not tgisinternal and tgname like '%meter%' and (tgtype & 1) = 1;
  if n > 0 then raise exception '0009: % chat meter trigger(s) are per-row', n; end if;

  raise notice '0009: chat in place — one thread per block, read access is post access, metered but not yet charged.';
end $$;

commit;
