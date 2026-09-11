-- ============================================================================
--  0006_definer_surface.sql
--
--  THE TEST THAT PASSED WHILE THE PROBLEM WAS STILL THERE.
--
--  0005 §10 revoked PUBLIC's implicit EXECUTE from five SECURITY DEFINER
--  functions by name, and supabase/test/01_repair_checks.sql asserted the fix
--  by checking those same names. It passed. Against the live database, the
--  count of SECURITY DEFINER functions still executable by PUBLIC was EIGHT.
--
--  The check enumerated what had been fixed instead of stating the property
--  that was supposed to hold. That is the same failure as 0004's: a test built
--  from the answer rather than from the requirement can only confirm the
--  answer. So this migration states the invariant, and the check that goes
--  with it now asks the database to enumerate violations rather than being
--  handed a list.
--
--  Three things, all defence in depth — none is reachable today:
--
--    1  every SECURITY DEFINER function in `public` loses PUBLIC's implicit
--       EXECUTE. Six of the eight return `trigger` (PostgREST does not expose
--       those, and calling one directly raises "can only be called as a
--       trigger"), but `is_org_member` and `has_org_role` are ordinary
--       functions sitting in the RPC surface with the anon key, which ships in
--       the browser bundle.
--
--    2  `usage` loses its table-wide UPDATE grant. RLS with no write policy
--       already denies it — rls_pentest.sql check 12 proves that — but a grant
--       whose only defence is the absence of a policy is one `create policy`
--       away from being real. This is precisely the shape that made 0005 §2's
--       plan escalation possible on `docs`.
--
--    3  a guard that refuses the migration if a future function reintroduces
--       either problem.
--
--  THE ONE THING THAT WOULD BREAK EVERYTHING IF DONE CARELESSLY:
--  `is_org_member` and `has_org_role` are called from inside RLS policies, and
--  a policy is evaluated as the QUERYING role. Revoking EXECUTE from
--  `authenticated` would make every policy that names them fail — a total
--  lockout of every signed-in user, from a hardening change. They keep
--  EXECUTE for `authenticated` and lose it only for PUBLIC and `anon`.
--  supabase/test/01_repair_checks.sql check 19 exists to catch a future
--  "tidy-up" that gets this wrong.
-- ============================================================================

begin;

-- ── 1. no SECURITY DEFINER function is executable by PUBLIC ─────────────────
--
-- `revoke ... from anon` does NOT do this: `anon` is a member of PUBLIC, and
-- PUBLIC's implicit grant survives a revoke aimed at a member. It has to name
-- PUBLIC. That was the bug in 0004's closing line, and 0005 fixed it for five
-- functions by hand. This does it for all of them, now and after any future
-- `create function`, because it is driven by the catalogue.
do $$
declare
  fn record;
  -- Functions the CLIENT legitimately calls, or that an RLS POLICY calls on
  -- the client's behalf. Everything else is trigger-only or server-only.
  keep_for_authenticated text[] := array[
    'is_org_member',   -- called by docs/assets/org policies
    'has_org_role',    -- called by the storage and update policies
    'org_plan',        -- called by the ds-assets write policy (0005 §3)
    'my_org_ids',      -- called by the docs/assets select policies
    'my_account',      -- the client's own account snapshot RPC
    'default_org'      -- reads auth.uid(); harmless, and own_org_id() needs it
  ];
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname,
           pg_get_function_result(p.oid) = 'trigger' as is_trigger
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);

    if fn.proname = any(keep_for_authenticated) then
      execute format('grant execute on function %s to authenticated', fn.sig);
    else
      -- Trigger functions and the server-only writers. A trigger fires
      -- without checking EXECUTE against the invoking role — the privilege is
      -- checked when the trigger is CREATED, not when it runs — so removing
      -- this cannot break a write path. Verified by check 18.
      execute format('revoke all on function %s from authenticated', fn.sig);
    end if;
  end loop;
end $$;


-- ── 2. usage is readable, never writable ───────────────────────────────────
-- The row is maintained entirely by AFTER triggers running as the definer.
-- No client has any business naming a column of it in a SET list.
revoke insert, update, delete on public.usage from anon, authenticated;


-- ── 3. the invariant, asserted before this file is allowed to commit ────────
do $$
declare
  bad_public int;
  bad_usage  int;
  broke_rls  int;
begin
  select count(*) into bad_public
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and array_to_string(coalesce(p.proacl, '{}'), ',') like '=X/%';
  if bad_public > 0 then
    raise exception '0006: % SECURITY DEFINER function(s) are still PUBLIC-executable', bad_public;
  end if;

  select count(*) into bad_usage
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'usage'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad_usage > 0 then
    raise exception '0006: usage still carries % write grant(s) to a client role', bad_usage;
  end if;

  -- THE LOCKOUT CHECK. If the policy helpers lost EXECUTE for `authenticated`,
  -- every signed-in read of docs and assets would fail. Refuse to commit
  -- rather than discover it from a support ticket.
  select count(*) into broke_rls
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('is_org_member', 'has_org_role', 'org_plan', 'my_org_ids')
     and array_to_string(coalesce(p.proacl, '{}'), ',') not like '%authenticated=X%';
  if broke_rls > 0 then
    raise exception
      '0006: % policy helper(s) are no longer executable by `authenticated` — every signed-in query would fail',
      broke_rls;
  end if;

  raise notice '0006: definer surface closed, usage is read-only, policy helpers intact.';
end $$;

commit;
