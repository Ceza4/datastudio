-- ============================================================================
--  03_chat_checks.sql — does the chat block actually let the right people talk
--
--  0009's own self-test is structural. It cannot answer the question the
--  feature exists for, which is whether somebody you shared ONE SHEET with can
--  read that sheet's conversation and reply to it — and whether a stranger
--  can do neither.
--
--  So this is three people, running as `authenticated` with real JWT claims,
--  exactly like 02_sharing_checks.sql. Everything rolls back.
-- ============================================================================

\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ── fixtures ────────────────────────────────────────────────────────────────
--   A owns the project and the chat block
--   B a stranger in his own organisation — the friend
--   C a member of A's organisation — the colleague
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','chat-a@datastudio.invalid', now(), now()),
  ('b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','chat-b@datastudio.invalid', now(), now()),
  ('c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','chat-c@datastudio.invalid', now(), now());

insert into public.org_members (org_id, user_id, role)
values ('org_a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9','c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9','member');

update public.subscriptions set plan = 'pro'
 where org_id in ('org_a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9',
                  'org_b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9');

-- Sheet one carries the chat block and a table. Sheet two carries a block
-- nobody outside the org will be granted — checks 12 and 13 need something
-- readable-to-A-and-not-to-B to point a reference at.
insert into public.docs (id, owner_id, org_id, kind, name, doc)
values ('nb_chat','a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9',
        'org_a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9','notebook','Chat project',
 '{"sheets":[
     {"id":"sh_1","name":"Sheet 1","blocks":[
        {"id":"blk_chat","type":"chat","name":"Thread"},
        {"id":"blk_data","type":"table","name":"Numbers"}]},
     {"id":"sh_2","name":"Sheet 2","blocks":[
        {"id":"blk_secret","type":"text","content":"not for sharing"}]}
   ]}'::jsonb);

do $do$
declare n int;
begin
  select count(*) into n from public.blocks where doc_id = 'nb_chat';
  if n <> 3 then raise exception 'FIXTURE: projected % blocks, expected 3', n; end if;
  raise notice 'ok  0  the chat block is a real row, so a thread can hang off it';
end $do$;


-- ══ 1. a stranger reads nothing and says nothing ════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9","role":"authenticated"}';
do $do$
declare n int; ok boolean := false;
begin
  select count(*) into n from public.chat_messages where block_id = 'blk_chat';
  if n <> 0 then raise exception 'FAIL 1: a stranger reads the thread'; end if;

  begin
    insert into public.chat_messages (id, block_id, body) values ('msg_x','blk_chat','let me in');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 1: a stranger posted into somebody else''s thread'; end if;
  raise notice 'ok  1  a stranger cannot read the thread and cannot post to it';
end $do$;


-- ══ 2. a colleague reads and posts ══════════════════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9","role":"authenticated"}';
insert into public.chat_messages (id, block_id, body)
values ('msg_a1','blk_chat','Mara, does the regional split look right to you?');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.chat_messages where block_id = 'blk_chat';
  if n <> 1 then raise exception 'FAIL 2: a colleague sees % of 1 message', n; end if;
  insert into public.chat_messages (id, block_id, body) values ('msg_c1','blk_chat','looking now');
  raise notice 'ok  2  a member of the organisation reads the thread and replies';
end $do$;


-- ══ 3. the author is stamped, never supplied ════════════════════════════════
reset role;
do $do$
declare who uuid;
begin
  select author_id into who from public.chat_messages where id = 'msg_c1';
  if who is distinct from 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9'::uuid then
    raise exception 'FAIL 3: the message is attributed to %, not to who wrote it', coalesce(who::text,'<null>');
  end if;
  raise notice 'ok  3  author_id comes from the session, not from the payload';
end $do$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9","role":"authenticated"}';
do $do$
declare ok boolean := false;
begin
  begin
    insert into public.chat_messages (id, block_id, author_id, body)
    values ('msg_forge','blk_chat','a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9','I approve this'::text);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then
    raise exception 'FAIL 4: a client named the author of a message — it could put words in a colleague''s mouth';
  end if;
  raise notice 'ok  4  a client cannot name the author at all';
end $do$;


-- ══ 5. THE HEADLINE: a VIEWER on one sheet joins the conversation ═══════════
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9","role":"authenticated"}';
insert into public.shares (id, doc_id, subject_kind, sheet_id, grantee_email, role)
values ('shr_chat','nb_chat','sheet','sh_1','chat-b@datastudio.invalid','viewer');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.chat_messages where block_id = 'blk_chat';
  if n <> 2 then raise exception 'FAIL 5: the grantee sees % of 2 messages', n; end if;

  -- The decision 0009's header defends. A viewer who cannot reply is a notice
  -- board; this is the assertion that stops somebody "fixing" it later.
  insert into public.chat_messages (id, block_id, body)
  values ('msg_b1','blk_chat','EMEA looks low to me — is that the Q3 rebate?');
  raise notice 'ok  5  a VIEWER on the shared sheet reads the thread AND replies';
end $do$;

-- but a viewer still cannot write the SHEET. Different verbs.
do $do$
declare n int;
begin
  update public.blocks set data = '{"id":"blk_data","type":"table"}'::jsonb where id = 'blk_data';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 6: posting rights leaked into editing rights'; end if;
  raise notice 'ok  6  replying to the thread is not permission to edit the sheet';
end $do$;


-- ══ 7. your own words only ══════════════════════════════════════════════════
do $do$
declare n int; t text;
begin
  update public.chat_messages set body = 'actually I said something else' where id = 'msg_a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 7: somebody edited another person''s message'; end if;

  update public.chat_messages set body = 'EMEA looks low — is that the rebate?' where id = 'msg_b1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 7: a person could not edit their OWN message'; end if;
  raise notice 'ok  7  you may edit your own message and nobody else''s';
end $do$;

reset role;
do $do$
declare e timestamptz;
begin
  select edited_at into e from public.chat_messages where id = 'msg_b1';
  if e is null then raise exception 'FAIL 8: an edited message does not say it was edited'; end if;
  select edited_at into e from public.chat_messages where id = 'msg_a1';
  if e is not null then raise exception 'FAIL 8: an untouched message claims to have been edited'; end if;
  raise notice 'ok  8  edited_at is set by the server, and only on the message that changed';
end $do$;


-- ══ 9. unsending takes the words with it ════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9","role":"authenticated"}';
update public.chat_messages set deleted_at = now() where id = 'msg_b1';

reset role;
do $do$
declare t text; d timestamptz; z int;
begin
  select body, deleted_at, bytes into t, d, z from public.chat_messages where id = 'msg_b1';
  if d is null then raise exception 'FAIL 9: the message was not marked unsent'; end if;
  if t is not null then
    raise exception 'FAIL 9: an unsent message still holds its text — "unsend" that leaves the words on disk is a lie';
  end if;
  if z <> 0 then raise exception 'FAIL 9: an unsent message is still charged % bytes', z; end if;
  if (select count(*) from public.chat_messages where id = 'msg_b1') <> 1 then
    raise exception 'FAIL 9: the row was erased rather than tombstoned — the thread would lose its sequence';
  end if;
  raise notice 'ok  9  unsending clears the text, zeroes the bytes, and keeps the row';
end $do$;


-- ══ 10. a revoked grantee loses the conversation ════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9","role":"authenticated"}';
update public.shares set revoked_at = now() where id = 'shr_chat';

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9","role":"authenticated"}';
do $do$
declare n int; ok boolean := false;
begin
  select count(*) into n from public.chat_messages where block_id = 'blk_chat';
  if n <> 0 then raise exception 'FAIL 10: a revoked grantee still reads % message(s)', n; end if;
  begin
    insert into public.chat_messages (id, block_id, body) values ('msg_b2','blk_chat','still here?');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 10: a revoked grantee still posts'; end if;
  raise notice 'ok 10  revoking the sheet closes the conversation with it';
end $do$;


-- ══ 11. a message must actually say something ═══════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9","role":"authenticated"}';
do $do$
declare ok boolean := false;
begin
  begin
    insert into public.chat_messages (id, block_id) values ('msg_empty','blk_chat');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL 11: an empty message was accepted'; end if;

  ok := false;
  begin
    insert into public.chat_messages (id, block_id, body)
    values ('msg_long','blk_chat', repeat('x', 4001));
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL 11: the 4000-character cap does not hold'; end if;
  raise notice 'ok 11  a message with nothing in it, and one over 4000 characters, are both refused';
end $do$;


-- ══ 12. you cannot pass on a block you cannot see ═══════════════════════════
-- A CAN see blk_secret, so A may reference it. The interesting case is the
-- other direction: a grantee referencing something outside their grant.
insert into public.chat_messages (id, block_id, body, ref_block_id)
values ('msg_ref','blk_chat','here is the sheet two block', 'blk_secret');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9","role":"authenticated"}';
insert into public.shares (id, doc_id, subject_kind, sheet_id, grantee_email, role)
values ('shr_chat2','nb_chat','sheet','sh_1','chat-b@datastudio.invalid','viewer');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9","role":"authenticated"}';
do $do$
declare ok boolean := false;
begin
  -- B is back in the thread (sheet one) but has never been granted sheet two.
  begin
    insert into public.chat_messages (id, block_id, body, ref_block_id)
    values ('msg_leak','blk_chat','look at this', 'blk_secret');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then
    raise exception 'FAIL 12: a grantee advertised a block outside their grant — the recipient''s own policy would be the only thing stopping them';
  end if;

  -- but a block they CAN see is fine
  insert into public.chat_messages (id, block_id, body, ref_block_id)
  values ('msg_ok','blk_chat','this one', 'blk_data');
  raise notice 'ok 12  you can pass on a block you can see, and only that';
end $do$;


-- ══ 13. the meter ═══════════════════════════════════════════════════════════
reset role;
do $do$
declare metered bigint; actual bigint;
begin
  select chat_bytes into metered from public.usage
   where org_id = 'org_a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9';
  select coalesce(sum(bytes),0) into actual from public.chat_messages
   where org_id = 'org_a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9' and deleted_at is null;
  if metered is distinct from actual then
    raise exception 'FAIL 13: usage says % chat bytes, the messages say %', metered, actual;
  end if;
  if metered <= 0 then raise exception 'FAIL 13: the meter never moved'; end if;
  raise notice 'ok 13  chat bytes are measured, and unsent messages are not counted';
end $do$;

do $do$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgrelid = 'public.chat_messages'::regclass
     and not tgisinternal and tgname like '%meter%';
  if n <> 3 then raise exception 'FAIL 14: expected 3 statement-level meter triggers, found %', n; end if;
  select count(*) into n from pg_trigger
   where tgrelid = 'public.chat_messages'::regclass
     and not tgisinternal and tgname like '%meter%' and (tgtype & 1) = 1;
  if n > 0 then raise exception 'FAIL 14: % meter trigger(s) are per-row', n; end if;
  raise notice 'ok 14  the meter is statement-level, so a bulk insert costs one recompute';
end $do$;


-- ══ 15. the ceiling actually holds ══════════════════════════════════════════
-- Filled for real rather than asserted from the source. A cap nobody has hit is
-- a cap that might be off by one, and off-by-one on a limit is the difference
-- between refusing the 5000th message and refusing the 5001st.
do $do$
declare n int; ok boolean := false;
begin
  perform set_config('request.jwt.claim.sub','a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9', true);

  -- Fill to exactly the cap, whatever the checks above happened to leave
  -- behind. The first draft hard-coded the top-up at 4990 and landed on 4994,
  -- because it counted the unsent message as live. An arithmetic mistake in a
  -- test is indistinguishable from the bug it was meant to find.
  select count(*) into n from public.chat_messages
   where block_id = 'blk_chat' and deleted_at is null;

  insert into public.chat_messages (id, block_id, body)
  select 'msg_bulk_' || g, 'blk_chat', 'filler ' || g
    from generate_series(1, 5000 - n) g;

  select count(*) into n from public.chat_messages
   where block_id = 'blk_chat' and deleted_at is null;
  if n <> 5000 then
    raise exception 'FAIL 15: expected exactly 5000 live messages before the wall, found %', n;
  end if;

  begin
    insert into public.chat_messages (id, block_id, body) values ('msg_over','blk_chat','one too many');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL 15: the 5000-message ceiling did not stop the 5001st'; end if;

  perform set_config('request.jwt.claim.sub','', true);
  raise notice 'ok 15  the 5000th message lands and the 5001st is refused';
end $do$;

do $do$ begin raise notice ' '; raise notice '  15/15 chat behaviours verified'; end $do$;

rollback;
