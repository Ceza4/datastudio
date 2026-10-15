-- ============================================================================
--  04_people_checks.sql — 0010: conversations belong to their members, and an
--  older app cannot overwrite what a newer one saved.
--
--  A starts conversations. B is a friend in another organisation. C is A's
--  colleague (same organisation) — the person who could read A's "private"
--  threads under 0009. D signs up only after being invited. E is a stranger.
--  Everything rolls back.
-- ============================================================================

\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ppl-a@datastudio.invalid', now(), now()),
  ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ppl-b@datastudio.invalid', now(), now()),
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ppl-c@datastudio.invalid', now(), now()),
  ('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ppl-e@datastudio.invalid', now(), now());

insert into public.org_members (org_id, user_id, role)
values ('org_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1','c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','member');

update public.subscriptions set plan = 'pro'
 where org_id = 'org_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';

insert into public.docs (id, owner_id, org_id, kind, name, doc)
values ('nb_ppl','a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1','org_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1','notebook','People project',
 '{"_schema":2,"sheets":[{"id":"sh_1","name":"Sheet 1","blocks":[{"id":"blk_ppl","type":"table","name":"Numbers"}]}]}'::jsonb);

create temp table t_ids (k text primary key, v text);
grant all on t_ids to authenticated;


-- ══ 1. the version guard ════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1","role":"authenticated"}';
do $do$
declare ok boolean := false;
begin
  begin
    update public.docs set doc = '{"sheets":[]}'::jsonb where id = 'nb_ppl';
  exception when others then
    if sqlerrm like 'outdated_client%' then ok := true; else raise; end if;
  end;
  if not ok then raise exception 'FAIL 1: an unstamped (older) client overwrote a format-2 document'; end if;

  ok := false;
  begin
    update public.docs set doc = '{"_schema":1,"sheets":[]}'::jsonb where id = 'nb_ppl';
  exception when others then
    if sqlerrm like 'outdated_client%' then ok := true; else raise; end if;
  end;
  if not ok then raise exception 'FAIL 1: a format-1 client overwrote a format-2 document'; end if;

  update public.docs set doc = '{"_schema":2,"sheets":[{"id":"sh_1","name":"Sheet 1","blocks":[{"id":"blk_ppl","type":"table","name":"Numbers"}]}]}'::jsonb, name = 'Renamed' where id = 'nb_ppl';
  update public.docs set doc = '{"_schema":3,"sheets":[{"id":"sh_1","name":"Sheet 1","blocks":[{"id":"blk_ppl","type":"table","name":"Numbers"}]}]}'::jsonb where id = 'nb_ppl';
  -- A soft delete does not touch the document and must always be allowed.
  raise notice 'ok  1  a document can only be written by the same or a newer format';
end $do$;


-- ══ 2. A starts a conversation with B ═══════════════════════════════════════
do $do$
declare tid text; tid2 text; n int;
begin
  tid := public.chat_start_thread(array['PPL-B@datastudio.invalid'], null);
  if tid is null then raise exception 'FAIL 2: no thread'; end if;
  tid2 := public.chat_start_thread(array['ppl-b@datastudio.invalid'], null);
  if tid2 <> tid then raise exception 'FAIL 2: a second direct thread with the same person'; end if;
  insert into t_ids values ('ab', tid);
  insert into public.chat_messages (id, thread_id, body) values ('m_ab1', tid, 'hi B');
  select count(*) into n from public.chat_messages where thread_id = tid;
  if n <> 1 then raise exception 'FAIL 2: A cannot read her own thread'; end if;
  raise notice 'ok  2  one direct thread per pair, found again rather than duplicated';
end $do$;

-- ══ 3. before B takes part, A sees the address, not an account ══════════════
do $do$
declare m jsonb;
begin
  select members into m from public.chat_my_threads() where id = (select v from t_ids where k = 'ab');
  if jsonb_array_length(m) <> 2 then raise exception 'FAIL 3: % members', jsonb_array_length(m); end if;
  if exists (select 1 from jsonb_array_elements(m) x where not (x->>'self')::boolean and (x->>'name') is not null) then
    raise exception 'FAIL 3: B''s account name is shown before B took part — that is an account oracle';
  end if;
  if m::text like '%b1b1b1b1%' then raise exception 'FAIL 3: a member''s account id leaked'; end if;
  raise notice 'ok  3  an invitee who has not taken part is shown as the typed address';
end $do$;

-- ══ 4. C — A's own colleague — cannot read A's conversation with B ══════════
set local request.jwt.claims to '{"sub":"c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1","role":"authenticated"}';
do $do$
declare n int; ok boolean := false;
begin
  select count(*) into n from public.chat_messages where thread_id = (select v from t_ids where k = 'ab');
  if n <> 0 then raise exception 'FAIL 4: a colleague reads a private conversation'; end if;
  select count(*) into n from public.chat_threads;
  if n <> 0 then raise exception 'FAIL 4: a colleague sees somebody else''s thread'; end if;
  begin
    insert into public.chat_messages (id, thread_id, body) values ('m_c', (select v from t_ids where k = 'ab'), 'me too');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 4: a colleague posted into a private conversation'; end if;
  ok := false;
  begin perform public.chat_add_members((select v from t_ids where k = 'ab'), array['ppl-c@datastudio.invalid']);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 4: an outsider added himself to a conversation'; end if;
  raise notice 'ok  4  a colleague in the same organisation reads nothing and posts nothing';
end $do$;

-- ══ 5. B reads, replies; A sees one unread; names appear ════════════════════
set local request.jwt.claims to '{"sub":"b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1","role":"authenticated"}';
do $do$
declare n int; u int;
begin
  select count(*) into n from public.chat_messages where thread_id = (select v from t_ids where k = 'ab');
  if n <> 1 then raise exception 'FAIL 5: B cannot read the thread (% rows)', n; end if;
  select unread into u from public.chat_my_threads() where id = (select v from t_ids where k = 'ab');
  if u <> 1 then raise exception 'FAIL 5: B should have 1 unread, has %', u; end if;
  insert into public.chat_messages (id, thread_id, body) values ('m_ab2', (select v from t_ids where k = 'ab'), 'hi A');
  select unread into u from public.chat_my_threads() where id = (select v from t_ids where k = 'ab');
  if u <> 0 then raise exception 'FAIL 5: replying did not mark the thread read (% unread)', u; end if;
end $do$;

set local request.jwt.claims to '{"sub":"a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1","role":"authenticated"}';
do $do$
declare u int; m jsonb; nm text;
begin
  select unread, members into u, m from public.chat_my_threads() where id = (select v from t_ids where k = 'ab');
  if u <> 1 then raise exception 'FAIL 5: A should have 1 unread, has %', u; end if;
  select x->>'name' into nm from jsonb_array_elements(m) x where not (x->>'self')::boolean;
  if nm is distinct from 'ppl-b' then raise exception 'FAIL 5: after B took part A should see B''s name, sees %', nm; end if;
  perform public.chat_mark_read((select v from t_ids where k = 'ab'));
  select unread into u from public.chat_my_threads() where id = (select v from t_ids where k = 'ab');
  if u <> 0 then raise exception 'FAIL 5: mark read left % unread', u; end if;
  raise notice 'ok  5  the other person reads and replies; unread counts follow; names appear once they take part';
end $do$;

-- ══ 6. direct threads stay direct; groups take more people ══════════════════
do $do$
declare ok boolean := false; g text; n int;
begin
  begin perform public.chat_add_members((select v from t_ids where k = 'ab'), array['ppl-e@datastudio.invalid']);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 6: a person was added to a direct conversation'; end if;

  g := public.chat_start_thread(array['ppl-b@datastudio.invalid', 'later-d@datastudio.invalid'], 'Launch crew');
  insert into t_ids values ('grp', g);
  if (select kind from public.chat_threads where id = g) <> 'group' then raise exception 'FAIL 6: a titled thread is not a group'; end if;
  n := public.chat_add_members(g, array['ppl-c@datastudio.invalid', 'ppl-c@datastudio.invalid', 'not an email']);
  if n <> 1 then raise exception 'FAIL 6: expected 1 new member, added %', n; end if;
  select jsonb_array_length(members) into n from public.chat_my_threads() where id = g;
  if n <> 4 then raise exception 'FAIL 6: group has % members, expected 4', n; end if;
  perform public.chat_rename(g, 'Launch crew 2');
  if (select title from public.chat_threads where id = g) <> 'Launch crew 2' then raise exception 'FAIL 6: rename'; end if;
  insert into public.chat_messages (id, thread_id, body) values ('m_g1', g, 'welcome');
  raise notice 'ok  6  direct conversations cannot grow; groups can, deduplicated and validated';
end $do$;

-- ══ 7. clients cannot touch the tables behind the functions ═════════════════
do $do$
declare ok boolean := false;
begin
  begin perform 1 from public.chat_members limit 1;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 7: chat_members is directly readable'; end if;
  ok := false;
  begin insert into public.chat_threads (id, kind) values ('thr_forged', 'group');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 7: a client created a thread directly'; end if;
  ok := false;
  begin insert into public.chat_messages (id, thread_id, block_id, body) values ('m_both', (select v from t_ids where k = 'ab'), 'blk_ppl', 'x');
  exception when check_violation then ok := true; when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 7: a message in a thread AND a block'; end if;
  raise notice 'ok  7  threads and members are written only through the functions';
end $do$;

-- ══ 8. the stranger ═════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.chat_messages where thread_id is not null;
  if n <> 0 then raise exception 'FAIL 8: a stranger reads % thread messages', n; end if;
  select count(*) into n from public.chat_my_threads();
  if n <> 0 then raise exception 'FAIL 8: a stranger lists % threads', n; end if;
  raise notice 'ok  8  a stranger sees no conversations at all';
end $do$;

-- ══ 9. an invite to somebody without an account is claimed when they sign up ═
reset role;
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','later-d@datastudio.invalid', now(), now());
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.chat_messages where thread_id = (select v from t_ids where k = 'grp');
  if n <> 1 then raise exception 'FAIL 9: the new account cannot read the group it was invited to (% rows)', n; end if;
  insert into public.chat_messages (id, thread_id, body) values ('m_d1', (select v from t_ids where k = 'grp'), 'thanks!');
  raise notice 'ok  9  an invite by email becomes membership when that address signs up';
end $do$;

-- ══ 10. leaving ═════════════════════════════════════════════════════════════
do $do$
declare n int; ok boolean := false;
begin
  perform public.chat_leave((select v from t_ids where k = 'grp'));
  select count(*) into n from public.chat_messages where thread_id = (select v from t_ids where k = 'grp');
  if n <> 0 then raise exception 'FAIL 10: still reading after leaving'; end if;
  begin insert into public.chat_messages (id, thread_id, body) values ('m_d2', (select v from t_ids where k = 'grp'), 'still here?');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 10: posted after leaving'; end if;
  raise notice 'ok 10  leaving a group ends reading and posting';
end $do$;

-- ══ 11. who shared with me, by name ═════════════════════════════════════════
set local request.jwt.claims to '{"sub":"a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1","role":"authenticated"}';
insert into public.shares (id, doc_id, subject_kind, grantee_email, role) values ('shr_ppl', 'nb_ppl', 'doc', 'ppl-b@datastudio.invalid', 'viewer');
set local request.jwt.claims to '{"sub":"b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1","role":"authenticated"}';
do $do$
declare nm text;
begin
  select name into nm from public.people_who_shared_with_me();
  if nm is distinct from 'ppl-a' then raise exception 'FAIL 11: the sharer shows as %', nm; end if;
  raise notice 'ok 11  somebody who shared with you is shown by name';
end $do$;
set local request.jwt.claims to '{"sub":"e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1","role":"authenticated"}';
do $do$
begin
  if exists (select 1 from public.people_who_shared_with_me()) then
    raise exception 'FAIL 11: a stranger learns who shares with whom';
  end if;
end $do$;

-- ══ 12. authors are named inside the thread, and only there ════════════════
set local request.jwt.claims to '{"sub":"a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.chat_thread_authors((select v from t_ids where k = 'ab'));
  if n <> 2 then raise exception 'FAIL 12: expected 2 named authors, got %', n; end if;
end $do$;
set local request.jwt.claims to '{"sub":"c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1","role":"authenticated"}';
do $do$
begin
  if exists (select 1 from public.chat_thread_authors((select v from t_ids where k = 'ab'))) then
    raise exception 'FAIL 12: an outsider learns who wrote in a conversation';
  end if;
  raise notice 'ok 12  authors are named to the people in the conversation, and to nobody else';
end $do$;

reset role;
do $$ begin raise notice ' '; raise notice '  12/12 people behaviours verified'; end $$;

rollback;
