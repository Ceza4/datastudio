-- ============================================================================
--  DataStudio — 0012: agents, agent chats, AI credits
--
--  WHAT THIS ADDS
--    1. plans.ai_credits              monthly agent credits per tier
--    2. ai_wallets                    one row per organisation: what is left
--    3. ai_ledger                     append-only: every model call, what it cost
--    4. ai_balance() / ai_debit()     the only ways to read and spend credits
--    5. agents, agent_chats           an agent's settings and its conversations
--
--  THE RULES THIS ENCODES
--
--  · AGENTS ARE PRIVATE. Owner-only RLS on both tables, no org-wide policy.
--    A colleague who can edit the sheet sees an agent BLOCK (an id and a name)
--    and nothing behind it: not the instructions, not the chats, not the
--    model. That is what "other people can't see the AI" means in storage.
--
--  · NO CLIENT CAN SPEND OR GRANT CREDITS. ai_debit and ai_grant_credits are
--    executable by the service role only; the model call and its cost are
--    observed by app/api/agent/route.js, never reported by a browser. A client
--    that lies about usage has nothing to lie to.
--
--  · MONTHLY CREDITS FIRST, THEN TOP-UPS. The month rolls lazily: the first
--    balance read or debit after a period ends starts the next one. No cron.
--
--  · 1 credit = $0.005 of model cost. The arithmetic lives in lib/agent/core.js
--    (creditsFor), shared by the route and the tests; this file only stores
--    the result.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.subscriptions') is null or to_regprocedure('public.org_plan(text)') is null then
    raise exception '0004/0005 have not been applied — subscriptions or org_plan() is missing.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  1. PLANS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.plans add column if not exists ai_credits integer not null default 0;

-- Free has no AI. Pro 1,500 / Max 5,000 a month (decided 29 Sep 2026).
update public.plans set ai_credits = 0    where id = 'free';
update public.plans set ai_credits = 1500 where id = 'pro';
update public.plans set ai_credits = 5000 where id = 'max';


-- ════════════════════════════════════════════════════════════════════════════
--  2. WALLETS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_wallets (
  org_id       text primary key references public.organizations(id) on delete cascade,
  period_start timestamptz not null default date_trunc('day', now()),
  used         integer not null default 0,     -- monthly credits spent this period
  topup        integer not null default 0,     -- bought credits left (may dip below 0 by one call)
  updated_at   timestamptz not null default now()
);

alter table public.ai_wallets enable row level security;
drop policy if exists "wallet readable by members" on public.ai_wallets;
create policy "wallet readable by members" on public.ai_wallets
  for select using (public.is_org_member(org_id));
revoke insert, update, delete, truncate on public.ai_wallets from anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  3. LEDGER
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_ledger (
  id            bigserial primary key,
  org_id        text not null references public.organizations(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  agent_id      text,
  chat_id       text,
  task_id       text,
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cache_write   integer not null default 0,
  cache_read    integer not null default 0,
  searches      integer not null default 0,
  usd           numeric(12,6) not null default 0,
  credits       integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists ai_ledger_user_time_idx on public.ai_ledger (user_id, created_at desc);
create index if not exists ai_ledger_task_idx      on public.ai_ledger (task_id);

alter table public.ai_ledger enable row level security;
-- You see your own spending. Nothing else, and never anyone else's.
drop policy if exists "ledger readable by its user" on public.ai_ledger;
create policy "ledger readable by its user" on public.ai_ledger
  for select using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.ai_ledger from anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  4. BALANCE AND DEBIT
-- ════════════════════════════════════════════════════════════════════════════

-- Rolls the period forward if it has ended and returns the wallet row.
-- Internal; not granted to anybody.
create or replace function public.ai_wallet_current(p_org text)
returns public.ai_wallets
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare w public.ai_wallets;
begin
  insert into public.ai_wallets (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into w from public.ai_wallets where org_id = p_org for update;
  if w.period_start + interval '1 month' <= now() then
    -- Whole months since the start, so a wallet untouched for a year lands in
    -- the CURRENT month rather than in month two.
    update public.ai_wallets
       set period_start = w.period_start
             + make_interval(months => (
                 (extract(year from age(now(), w.period_start)) * 12
                  + extract(month from age(now(), w.period_start)))::int)),
           used = 0, updated_at = now()
     where org_id = p_org
     returning * into w;
  end if;
  return w;
end;
$fn$;
revoke all on function public.ai_wallet_current(text) from public, anon, authenticated;

create or replace function public.ai_balance_of(p_org text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare w public.ai_wallets; p public.plans;
begin
  w := public.ai_wallet_current(p_org);
  p := public.org_plan(p_org);
  return jsonb_build_object(
    'plan',         p.id,
    'monthly',      p.ai_credits,
    'used',         least(w.used, p.ai_credits),
    'topup',        w.topup,
    'remaining',    greatest(p.ai_credits - w.used, 0) + w.topup,
    'period_start', w.period_start,
    'period_end',   w.period_start + interval '1 month'
  );
end;
$fn$;
revoke all on function public.ai_balance_of(text) from public, anon, authenticated;
grant execute on function public.ai_balance_of(text) to service_role;

-- What the signed-in person's organisation has left. The only balance a
-- client can ask for.
create or replace function public.ai_balance()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare org text := public.default_org();
begin
  if org is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return public.ai_balance_of(org);
end;
$fn$;
revoke all on function public.ai_balance() from public, anon;
grant execute on function public.ai_balance() to authenticated;

-- Spend. SERVICE ROLE ONLY: the route calls this after it has seen the usage
-- the API reported. Monthly credits go first, then top-ups.
create or replace function public.ai_debit(
  p_org text, p_user uuid, p_agent text, p_chat text, p_task text, p_model text,
  p_input integer, p_output integer, p_cache_write integer, p_cache_read integer,
  p_searches integer, p_usd numeric, p_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare w public.ai_wallets; p public.plans; monthly_left int; from_monthly int; from_topup int;
begin
  if p_credits < 0 then raise exception 'Negative debit.' using errcode = 'check_violation'; end if;
  w := public.ai_wallet_current(p_org);
  p := public.org_plan(p_org);
  monthly_left := greatest(p.ai_credits - w.used, 0);
  from_monthly := least(p_credits, monthly_left);
  from_topup   := p_credits - from_monthly;
  update public.ai_wallets
     set used = used + from_monthly, topup = topup - from_topup, updated_at = now()
   where org_id = p_org;
  insert into public.ai_ledger (org_id, user_id, agent_id, chat_id, task_id, model,
                                input_tokens, output_tokens, cache_write, cache_read,
                                searches, usd, credits)
  values (p_org, p_user, p_agent, p_chat, p_task, p_model,
          coalesce(p_input,0), coalesce(p_output,0), coalesce(p_cache_write,0), coalesce(p_cache_read,0),
          coalesce(p_searches,0), coalesce(p_usd,0), p_credits);
  return public.ai_balance_of(p_org);
end;
$fn$;
revoke all on function public.ai_debit(text, uuid, text, text, text, text, integer, integer, integer, integer, integer, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.ai_debit(text, uuid, text, text, text, text, integer, integer, integer, integer, integer, numeric, integer)
  to service_role;

-- Top-ups. SERVICE ROLE ONLY — the payment webhook, or supabase/dev/grant_credits.sql.
create or replace function public.ai_grant_credits(p_org text, p_credits integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_credits <= 0 then raise exception 'Grant must be positive.' using errcode = 'check_violation'; end if;
  perform public.ai_wallet_current(p_org);
  update public.ai_wallets set topup = topup + p_credits, updated_at = now() where org_id = p_org;
  return public.ai_balance_of(p_org);
end;
$fn$;
revoke all on function public.ai_grant_credits(text, integer) from public, anon, authenticated;
grant execute on function public.ai_grant_credits(text, integer) to service_role;

-- What this person has spent on one task, and today. For the per-task and
-- daily limits the route enforces. Reads only the caller's own rows.
create or replace function public.ai_spent(p_task text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'task',  coalesce((select sum(credits) from public.ai_ledger
                        where user_id = (select auth.uid()) and task_id = p_task), 0),
    'today', coalesce((select sum(credits) from public.ai_ledger
                        where user_id = (select auth.uid()) and created_at >= date_trunc('day', now())), 0)
  );
$fn$;
revoke all on function public.ai_spent(text) from public, anon;
grant execute on function public.ai_spent(text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  5. AGENTS AND THEIR CHATS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.agents (
  id         text primary key,
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint agents_config_size check (octet_length(config::text) <= 65536)
);
create index if not exists agents_owner_idx on public.agents (owner_id);

create table if not exists public.agent_chats (
  id         text primary key,
  agent_id   text not null references public.agents(id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null default 'New chat',
  is_open    boolean not null default true,
  credits    integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_chats_name_len check (length(name) <= 200),
  -- A long research chat with web results is large; 6MB is generous and
  -- still stops one runaway transcript from eating the database quota.
  constraint agent_chats_data_size check (octet_length(data::text) <= 6291456)
);
create index if not exists agent_chats_agent_idx on public.agent_chats (agent_id, updated_at desc);

-- Owner is stamped, never chosen. A client that sends owner_id = somebody
-- else gets its own id instead of an RLS error that names the other person.
create or replace function public.agent_stamp_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if (select auth.uid()) is not null then
    if tg_op = 'INSERT' then new.owner_id := (select auth.uid());
    else new.owner_id := old.owner_id; end if;
  end if;
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists agents_stamp on public.agents;
create trigger agents_stamp before insert or update on public.agents
  for each row execute function public.agent_stamp_owner();
drop trigger if exists agent_chats_stamp on public.agent_chats;
create trigger agent_chats_stamp before insert or update on public.agent_chats
  for each row execute function public.agent_stamp_owner();

-- A chat can only hang off an agent you own.
create or replace function public.agent_chats_check_agent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not exists (select 1 from public.agents a where a.id = new.agent_id and a.owner_id = new.owner_id) then
    raise exception 'No such agent.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$fn$;
drop trigger if exists agent_chats_agent on public.agent_chats;
create trigger agent_chats_agent before insert or update of agent_id on public.agent_chats
  for each row execute function public.agent_chats_check_agent();

alter table public.agents      enable row level security;
alter table public.agent_chats enable row level security;

drop policy if exists "agents are private" on public.agents;
create policy "agents are private" on public.agents
  for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "agent chats are private" on public.agent_chats;
create policy "agent chats are private" on public.agent_chats
  for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke truncate, trigger, references on public.agents, public.agent_chats from anon, authenticated;
revoke all on public.agents, public.agent_chats from anon;
grant select, insert, update, delete on public.agents, public.agent_chats to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  6. SELF-TEST (structural)
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from information_schema.role_routine_grants
              where routine_name in ('ai_debit','ai_grant_credits','ai_wallet_current','ai_balance_of')
                and grantee in ('authenticated','anon','PUBLIC')) then
    raise exception 'SELF-TEST: a spending function is executable by a client role';
  end if;
  if (select ai_credits from public.plans where id = 'free') <> 0 then
    raise exception 'SELF-TEST: free has AI credits';
  end if;
  raise notice '0012 ok: wallets, ledger, private agents';
end $$;

commit;
