-- ============================================================================
--  05_agent_checks.sql — are agents private, and can only the server spend
--
--  Two people: A owns an agent and a chat, B is A's colleague in the same
--  organisation. B must see neither. Neither may spend or grant credits;
--  the service role may. Everything rolls back.
-- ============================================================================

\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','agent-a@datastudio.invalid', now(), now()),
  ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','agent-b@datastudio.invalid', now(), now());

insert into public.org_members (org_id, user_id, role)
values ('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5','member');

update public.subscriptions set plan = 'pro'
 where org_id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';

-- ── A creates an agent and a chat ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';

insert into public.agents (id, config) values ('agt_1', '{"name":"Designer"}');
-- owner_id is stamped: a forged owner is replaced by the caller's id.
insert into public.agents (id, owner_id, config)
values ('agt_2', 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5', '{"name":"Forged"}');
insert into public.agent_chats (id, agent_id, name, data) values ('ach_1', 'agt_1', 'Pricing', '{"transcript":[]}');

do $do$
declare b jsonb;
begin
  if (select owner_id from public.agents where id = 'agt_2') <> 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5' then
    raise exception 'FAIL 1: owner_id was client-chosen';
  end if;
  raise notice 'ok  1  owner is stamped, never chosen';

  b := public.ai_balance();
  if (b->>'monthly')::int <> 1500 or (b->>'remaining')::int <> 1500 then
    raise exception 'FAIL 2: pro balance wrong: %', b;
  end if;
  raise notice 'ok  2  a Pro org starts with 1,500 monthly credits';
end $do$;

-- A cannot spend or grant.
do $do$
begin
  begin
    perform public.ai_debit('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', null, null, null, null, 'x', 0,0,0,0,0, 0, 5);
    raise exception 'FAIL 3: a client could call ai_debit';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ai_grant_credits('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 100000);
    raise exception 'FAIL 4: a client could grant itself credits';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ai_wallets set topup = 999999;
    raise exception 'FAIL 5: a client could write its wallet';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_ledger (org_id, model, credits) values ('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'x', -500);
    raise exception 'FAIL 6: a client could write the ledger';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok  3  no client can debit, grant, or write the wallet or ledger';
end $do$;

-- ── B, same organisation, sees nothing ─────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';

do $do$
declare n int;
begin
  select count(*) into n from public.agents;
  if n <> 0 then raise exception 'FAIL 7: a colleague sees % agents', n; end if;
  select count(*) into n from public.agent_chats;
  if n <> 0 then raise exception 'FAIL 8: a colleague sees % agent chats', n; end if;
  update public.agents set config = '{"name":"hijacked"}' where id = 'agt_1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 9: a colleague edited an agent'; end if;
  begin
    insert into public.agent_chats (id, agent_id, name) values ('ach_evil', 'agt_1', 'x');
    raise exception 'FAIL 10: a colleague attached a chat to someone else''s agent';
  exception when foreign_key_violation then null;
  end;
  raise notice 'ok  4  a colleague in the same org sees and changes nothing';
end $do$;

-- ── the service role spends: monthly first, then top-ups ───────────────────
reset role;
set local role service_role;

do $do$
declare b jsonb;
begin
  b := public.ai_grant_credits('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 1000);
  if (b->>'topup')::int <> 1000 then raise exception 'FAIL 11: grant %', b; end if;
  b := public.ai_debit('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
                       'agt_1', 'ach_1', 'task_1', 'claude-sonnet-5', 1000, 200, 0, 0, 0, 0.004, 1400);
  if (b->>'used')::int <> 1400 or (b->>'topup')::int <> 1000 then raise exception 'FAIL 12: %', b; end if;
  b := public.ai_debit('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
                       'agt_1', 'ach_1', 'task_1', 'claude-sonnet-5', 1000, 200, 0, 0, 0, 0.004, 300);
  if (b->>'used')::int <> 1500 or (b->>'topup')::int <> 800 or (b->>'remaining')::int <> 800 then
    raise exception 'FAIL 13: overflow did not go to top-up: %', b;
  end if;
  raise notice 'ok  5  monthly credits are spent first, then top-ups';
end $do$;

-- ── A sees her own spending; B sees none of it ─────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
do $do$
declare s jsonb;
begin
  s := public.ai_spent('task_1');
  if (s->>'task')::int <> 1700 then raise exception 'FAIL 14: task spend %', s; end if;
  raise notice 'ok  6  per-task spend is readable by its owner';
end $do$;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int; s jsonb;
begin
  select count(*) into n from public.ai_ledger;
  if n <> 0 then raise exception 'FAIL 15: a colleague reads % ledger rows', n; end if;
  s := public.ai_spent('task_1');
  if (s->>'task')::int <> 0 then raise exception 'FAIL 16: a colleague reads another''s task spend'; end if;
  raise notice 'ok  7  nobody reads anybody else''s spending';
end $do$;

-- ── a month later the monthly allowance comes back ─────────────────────────
reset role;
update public.ai_wallets set period_start = now() - interval '1 month 3 days'
 where org_id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';
set local role service_role;
do $do$
declare b jsonb;
begin
  b := public.ai_balance_of('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5');
  if (b->>'used')::int <> 0 or (b->>'remaining')::int <> 2300 then raise exception 'FAIL 17: rollover %', b; end if;
  if (b->>'period_start')::timestamptz > now() or (b->>'period_end')::timestamptz <= now() then
    raise exception 'FAIL 18: period does not contain now: %', b;
  end if;
  raise notice 'ok  8  the month rolls lazily; top-ups carry over';
end $do$;

-- ── free has no AI ─────────────────────────────────────────────────────────
reset role;
update public.subscriptions set plan = 'free' where org_id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';
update public.ai_wallets set topup = 0 where org_id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
do $do$
declare b jsonb;
begin
  b := public.ai_balance();
  if (b->>'remaining')::int <> 0 then raise exception 'FAIL 19: free has credits %', b; end if;
  raise notice 'ok  9  a free org has no agent credits';
end $do$;

rollback;
