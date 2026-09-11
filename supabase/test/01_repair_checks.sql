-- ============================================================================
--  01_repair_checks.sql — exploits that WORKED before 0005, run against it now
--
--  Every block here is an attack or a bug reproduction taken from the August
--  audit. Each raises if it succeeds. Run with:
--    psql -v ON_ERROR_STOP=1 -f supabase/test/00_supabase_shim.sql
--    psql -v ON_ERROR_STOP=1 -f supabase/migrations/000{1,2,3,4,5}_*.sql
--    psql -v ON_ERROR_STOP=1 -f supabase/test/01_repair_checks.sql
--
--  This runs as a superuser and drives auth.uid() through the request.jwt GUC,
--  the same way rls_pentest.sql does. It is the complement to that file: the
--  pen test proves the POLICIES are right, this proves the TRIGGERS and GRANTS
--  are, against the payloads the client actually sends.
-- ============================================================================

\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

do $outer$
declare
  ua uuid := '11111111-1111-1111-1111-111111111111';
  ub uuid := '22222222-2222-2222-2222-222222222222';
  oa text; ob text;
  passed int := 0;
  n bigint; v bigint; t text; t2 text; ok boolean;

  procedure_note text;
begin
  oa := 'org_' || ua::text;
  ob := 'org_' || ub::text;

  -- ── fixtures ──────────────────────────────────────────────────────────────
  insert into auth.users (id, email) values (ua,'a@t.test'), (ub,'b@t.test')
    on conflict (id) do nothing;
  insert into public.profiles (id, email) values (ua,'a@t.test'), (ub,'b@t.test')
    on conflict (id) do nothing;
  insert into public.organizations (id, name, created_by, personal) values
    (oa,'A',ua,true), (ob,'B',ub,true) on conflict (id) do nothing;
  insert into public.org_members (org_id, user_id, role) values
    (oa,ua,'owner'), (ob,ub,'owner') on conflict do nothing;
  -- A is on a deliberately tiny Pro so byte limits are testable; B is on max.
  insert into public.plans (id, doc_bytes, asset_bytes, max_file_bytes, cloud, price_cents, label)
    values ('tiny', 400, 400, 400, true, 100, 'Tiny') on conflict (id) do update
      set doc_bytes=400, asset_bytes=400, max_file_bytes=400, cloud=true;
  -- B stays on FREE: check 16 needs an account whose plan excludes cloud.
  insert into public.subscriptions (org_id, plan) values (oa,'tiny'), (ob,'free')
    on conflict (org_id) do update set plan = excluded.plan;

  -- A pre-0004 object, at the path shape the client built before the tenant
  -- move. Checks 14 and 15 read and write against it.
  delete from storage.objects where bucket_id = 'ds-assets';
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('ds-assets', ua::text || '/image/img_legacy', ua, '{"size": 99}'::jsonb)
  on conflict (bucket_id, name) do nothing;
  delete from public.docs   where org_id in (oa,ob);
  delete from public.assets where org_id in (oa,ob);
  perform public.recompute_usage_org(oa);
  perform public.recompute_usage_org(ob);

  perform set_config('request.jwt.claim.sub', ua::text, true);

  -- ══ 1. THE BLOCKER: the client's payload, with no org_id ═════════════════
  insert into public.docs (id, owner_id, kind, name, doc, device_id, deleted_at)
  values ('nb_1', ua, 'notebook', 'n', '{"b":[]}'::jsonb, 'dev', null);
  select org_id into t from public.docs where id = 'nb_1';
  if t is distinct from oa then
    raise exception 'FAIL 1: org_id landed as %, expected %', t, oa;
  end if;
  passed := passed + 1;  raise notice 'ok  1  client payload with no org_id inserts, lands in the caller''s own org';

  -- ══ 2. a row may not be born deleted (was: unlimited free storage) ════════
  ok := false;
  begin
    insert into public.docs (id, owner_id, kind, name, doc, deleted_at)
    values ('nb_ghost', ua, 'notebook', 'g', jsonb_build_object('p', repeat('x',5000)), now());
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL 2: a 5KB row was created already-deleted on a 400-byte plan'; end if;
  passed := passed + 1;  raise notice 'ok  2  a document cannot be created already deleted';

  -- ══ 3. multi-row insert cannot outrun the AFTER-trigger recompute ════════
  ok := false;
  begin
    insert into public.docs (id, owner_id, kind, name, doc)
    select 'nb_bulk_'||g, ua, 'notebook', 'b', jsonb_build_object('p', repeat('y',60))
      from generate_series(1,50) g;
  exception when check_violation then ok := true;
  end;
  select count(*) into n from public.docs where org_id = oa and id like 'nb_bulk_%';
  if not ok then
    raise exception 'FAIL 3: % rows of a 50-row insert accepted on a 400-byte plan', n;
  end if;
  passed := passed + 1;  raise notice 'ok  3  a 50-row array insert is bounded by the quota (% landed, statement rolled back)', n;

  -- ══ 4. bytes awaiting purge still count ══════════════════════════════════
  delete from public.docs where org_id = oa;
  perform public.recompute_usage_org(oa);
  insert into public.docs (id, owner_id, kind, name, doc)
  values ('nb_fill', ua, 'notebook', 'f', jsonb_build_object('p', repeat('z',300)));
  update public.docs set deleted_at = now() where id = 'nb_fill';
  select doc_bytes, doc_pending_bytes into v, n from public.usage where org_id = oa;
  if n = 0 then raise exception 'FAIL 4a: tombstoned bytes are not tracked as pending'; end if;
  if v <> 0 then raise exception 'FAIL 4b: tombstoned bytes still counted as used (%)', v; end if;
  ok := false;
  begin
    insert into public.docs (id, owner_id, kind, name, doc)
    values ('nb_again', ua, 'notebook', 'f', jsonb_build_object('p', repeat('z',300)));
  exception when check_violation then ok := true;
  end;
  if not ok then
    raise exception 'FAIL 4c: refilled the plan while % pending bytes are still on disk', n;
  end if;
  passed := passed + 1;  raise notice 'ok  4  deleted bytes stay charged until purge (% pending, used shows %)', n, v;

  -- ══ 5. a restore is charged its full size ════════════════════════════════
  -- (was: old.bytes subtracted from a total it was never in, so a big document
  --  could be restored past a full quota for free)
  ok := false;
  begin
    update public.docs set deleted_at = null where id = 'nb_fill';
  exception when check_violation then ok := true;
  end;
  -- Under the tiny plan the restore does not fit alongside its own pending
  -- bytes, which is the honest answer: the bytes are counted once as pending
  -- and once as incoming only while both are true.
  if not ok then
    select doc_bytes into v from public.usage where org_id = oa;
    if v = 0 then raise exception 'FAIL 5: a restore was accepted without being charged'; end if;
  end if;
  passed := passed + 1;  raise notice 'ok  5  a restore is charged its full size, not a delta';

  -- ══ 6. org_id cannot be borrowed to decide entitlement (escalation) ══════
  delete from public.docs where org_id = oa;
  perform public.recompute_usage_org(oa);
  insert into public.docs (id, owner_id, kind, name, doc)
  values ('nb_esc', ua, 'notebook', 'e', '{"p":"small"}'::jsonb);
  ok := false;
  begin
    -- as `authenticated`, which is the role PostgREST uses
    set local role authenticated;
    update public.docs
       set doc = jsonb_build_object('p', repeat('q',600)), org_id = ob
     where id = 'nb_esc';
    reset role;
  exception
    when check_violation then ok := true; reset role;
    when insufficient_privilege then ok := true; reset role;
  end;
  if not ok then
    select org_id into t from public.docs where id = 'nb_esc';
    raise exception 'FAIL 6: 600 bytes accepted on a 400-byte plan by naming org %; row is in %', ob, t;
  end if;
  select org_id into t from public.docs where id = 'nb_esc';
  if t <> oa then raise exception 'FAIL 6b: the row moved to %', t; end if;
  passed := passed + 1;  raise notice 'ok  6  naming another org on UPDATE neither moves the row nor borrows its plan';

  -- ══ 7. usage is keyed by org, so a second org gets its own row ═══════════
  insert into public.organizations (id, name, created_by, personal)
    values ('org_team_a','Team',ua,false) on conflict (id) do nothing;
  insert into public.org_members (org_id, user_id, role)
    values ('org_team_a',ua,'owner') on conflict do nothing;
  insert into public.subscriptions (org_id, plan) values ('org_team_a','max')
    on conflict (org_id) do update set plan='max';
  insert into public.docs (id, owner_id, org_id, kind, name, doc)
  values ('nb_team', ua, 'org_team_a', 'notebook', 't', '{"p":"team"}'::jsonb);
  select count(*) into n from public.usage where org_id in (oa,'org_team_a');
  if n <> 2 then
    raise exception 'FAIL 7: one user with two orgs has % usage rows, expected 2', n;
  end if;
  passed := passed + 1;  raise notice 'ok  7  each organisation has its own usage row';

  -- ══ 8. a NULL created_by does not brick the tenant ═══════════════════════
  update public.organizations set created_by = null where id = 'org_team_a';
  begin
    insert into public.docs (id, owner_id, org_id, kind, name, doc)
    values ('nb_orphan', ua, 'org_team_a', 'notebook', 'o', '{"p":"still works"}'::jsonb);
  exception when not_null_violation then
    raise exception 'FAIL 8: a departed org creator still bricks the organisation';
  end;
  passed := passed + 1;  raise notice 'ok  8  an organisation whose creator left still accepts writes';

  -- ══ 9. an asset whose object is gone can still be retired ═══════════════
  -- (was: assets_before_write re-read storage on UPDATE and raised, so the row
  --  could never be tombstoned, never purged, and its bytes billed forever)
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('ds-assets', oa || '/image/img_gone', ua, '{"size": 120}'::jsonb)
  on conflict (bucket_id, name) do nothing;
  insert into public.assets (id, owner_id, org_id, kind, path, mime)
  values ('img_gone', ua, oa, 'image', oa || '/image/img_gone', 'image/png');
  delete from storage.objects where bucket_id = 'ds-assets' and name = oa || '/image/img_gone';
  begin
    update public.assets set deleted_at = now() where id = 'img_gone';
  exception when others then
    raise exception 'FAIL 9: an asset whose object is gone cannot be tombstoned (%)', sqlerrm;
  end;
  passed := passed + 1;  raise notice 'ok  9  an asset can be retired after its object is gone';

  -- ══ 10. deduplicated assets are charged once, not once per row ═══════════
  delete from public.assets where org_id = oa;
  perform public.recompute_usage_org(oa);
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('ds-assets', oa || '/image/img_shared', ua, '{"size": 300}'::jsonb)
  on conflict (bucket_id, name) do update set metadata = excluded.metadata;
  -- Six manifest rows, one object. On the tiny plan (400 bytes) the second row
  -- would be refused if the object were charged twice.
  insert into public.assets (id, owner_id, org_id, kind, path, mime)
  select 'img_dup_'||g, ua, oa, 'image', oa || '/image/img_shared', 'image/png'
    from generate_series(1,6) g;
  select asset_bytes into v from public.usage where org_id = oa;
  if v <> 300 then
    raise exception 'FAIL 10: six rows sharing one 300-byte object metered as % bytes', v;
  end if;
  passed := passed + 1;  raise notice 'ok 10  six rows sharing one object are charged once (% bytes)', v;

  -- ══ 11. NO SECURITY DEFINER function is PUBLIC-executable ═══════════════
  --
  -- THIS CHECK USED TO NAME FOUR FUNCTIONS, AND THAT IS WHY IT LIED.
  --
  -- `revoke ... from anon` never worked — anon is a member of PUBLIC and
  -- PUBLIC's implicit EXECUTE survives a revoke aimed at a member — so 0005
  -- fixed five functions by name, and this check asserted those same five.
  -- It passed. Against the live database the real count was EIGHT.
  --
  -- A check built from the fix can only confirm the fix. This one now asks
  -- the catalogue to enumerate violations, so a function added next year is
  -- covered by a test written today. (`=X/` in proacl is PUBLIC.)
  select count(*) into n
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and prosecdef
     and array_to_string(coalesce(proacl, '{}'), ',') like '=X/%';
  if n > 0 then
    raise exception 'FAIL 11: % SECURITY DEFINER function(s) executable by PUBLIC (%)',
      n, (select string_agg(proname, ', ' order by proname) from pg_proc
           where pronamespace='public'::regnamespace and prosecdef
             and array_to_string(coalesce(proacl,'{}'),',') like '=X/%');
  end if;
  -- and the write-capable one is not reachable by a signed-in client either
  select count(*) into n
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'recompute_usage_org'
     and array_to_string(coalesce(proacl,'{}'), ',') like '%authenticated=X%';
  if n > 0 then
    raise exception 'FAIL 11b: recompute_usage_org is still callable by authenticated';
  end if;
  passed := passed + 1;  raise notice 'ok 11  definer functions are not PUBLIC-executable; the writer is trigger-only';

  -- ══ 12. audit rows cannot carry a chosen ip, agent or namespace ══════════
  insert into public.audit_log (org_id, actor_id, action, target, outcome, ip, user_agent, detail)
  values (oa, ua, 'doc.delete', 'nb_1', 'ok', '8.8.8.8'::inet, 'totally not me', '{"n":1}'::jsonb);
  select count(*) into n from public.audit_log
   where org_id = oa and (ip is not null or user_agent is not null);
  if n > 0 then raise exception 'FAIL 12: a client-written audit row kept its forged ip / user agent'; end if;
  ok := false;
  begin
    insert into public.audit_log (org_id, actor_id, action, outcome)
    values (oa, ua, 'auth.login', 'ok');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 12b: a client forged an auth.* audit entry'; end if;
  passed := passed + 1;  raise notice 'ok 12  audit ip/user-agent are server-only and auth.* is not client-writable';

  -- ══ 13. docs UPDATE is column-scoped ════════════════════════════════════
  select count(*) into n
    from information_schema.column_privileges
   where table_schema='public' and table_name='docs'
     and grantee='authenticated' and privilege_type='UPDATE';
  -- Five since 0008 §2: the four the sync engine writes, plus `visibility`,
  -- which is the private/org switch. If this ever climbs on its own, a
  -- migration granted a column nobody argued for.
  if n <> 5 then
    raise exception 'FAIL 13: authenticated may update % columns of docs, expected 5', n;
  end if;
  passed := passed + 1;  raise notice 'ok 13  authenticated may update exactly 5 columns of docs';

  -- ══ 17. no table in public is unprotected, and none silently denies ═════
  -- Two failure modes with opposite symptoms and one cause — nobody looked.
  -- A table with RLS off is readable by anyone holding the anon key. A table
  -- with RLS on and ZERO policies returns nothing to everyone, which reads as
  -- "the feature is broken" rather than "the grant is missing".
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if n > 0 then
    raise exception 'FAIL 17: % table(s) in public have RLS disabled (%)', n,
      (select string_agg(c.relname, ', ') from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
        where ns.nspname='public' and c.relkind='r' and not c.relrowsecurity);
  end if;
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname);
  if n > 0 then
    raise exception 'FAIL 17b: % table(s) have RLS on with no policy at all (%)', n,
      (select string_agg(c.relname, ', ') from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
        where ns.nspname='public' and c.relkind='r' and c.relrowsecurity
          and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname));
  end if;
  passed := passed + 1;  raise notice 'ok 17  every table in public has RLS on and at least one policy';

  -- ══ 18. a trigger still fires after its function loses EXECUTE ══════════
  -- 0006 revokes EXECUTE on the trigger functions from every client role, on
  -- the understanding that Postgres checks that privilege when a trigger is
  -- CREATED and not when it fires. That is load-bearing: if it were wrong,
  -- 0006 would have silently disabled the quota checks. Proven, not assumed.
  delete from public.docs where org_id = oa;
  perform public.recompute_usage_org(oa);
  ok := false;
  begin
    set local role authenticated;
    insert into public.docs (id, owner_id, kind, name, doc)
    values ('nb_trig', ua, 'notebook', 't', jsonb_build_object('p', repeat('w', 600)));
    reset role;
  exception when others then ok := true; reset role;
  end;
  if not ok then
    raise exception 'FAIL 18: 600 bytes were accepted on a 400-byte plan — the quota trigger stopped firing after its EXECUTE grant was revoked';
  end if;
  passed := passed + 1;  raise notice 'ok 18  trigger functions still fire with no EXECUTE grant to the caller';

  -- ══ 19. the policy helpers did NOT lose EXECUTE ═════════════════════════
  -- The other half of 18, and the one that would take the whole product down:
  -- is_org_member and friends are called from inside RLS policies, which run
  -- as the QUERYING role. Revoke those and every signed-in read returns
  -- nothing — a total lockout produced by a hardening change.
  select count(*) into n
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('is_org_member','has_org_role','org_plan','my_org_ids')
     and array_to_string(coalesce(proacl,'{}'),',') not like '%authenticated=X%';
  if n > 0 then
    raise exception 'FAIL 19: % policy helper(s) are not executable by authenticated — every signed-in query would fail', n;
  end if;
  passed := passed + 1;  raise notice 'ok 19  the RLS policy helpers are still executable by authenticated';

  -- ══ 20. usage carries no client write grant ═════════════════════════════
  select count(*) into n
    from information_schema.role_table_grants
   where table_schema='public' and table_name='usage'
     and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE');
  if n > 0 then
    raise exception 'FAIL 20: usage still carries % client write grant(s). RLS-with-no-policy is denying them today; that is one `create policy` away from not being true.', n;
  end if;
  passed := passed + 1;  raise notice 'ok 20  usage is read-only to clients by GRANT, not only by policy';

  -- ══ 21. the block projection, and what makes attribution TRUE ═══════════
  --
  -- The distinction this whole table exists to make: "who edited this block"
  -- must not degrade into "who last saved the file". A save touches the whole
  -- document; only some of its blocks actually changed.
  delete from public.docs where org_id = oa;
  perform public.recompute_usage_org(oa);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', ua::text, 'role', 'authenticated')::text, true);

  insert into public.docs (id, owner_id, kind, name, doc, org_id)
  values ('nb_attr', ua, 'notebook', 'attr',
          '{"id":"nb_attr","sheets":[{"id":"s1","blocks":[
              {"id":"blk_x","type":"text","content":"x"},
              {"id":"blk_y","type":"text","content":"y"}]}]}'::jsonb, oa);

  select count(*) into n from public.blocks where doc_id = 'nb_attr';
  if n <> 2 then raise exception 'FAIL 21: projected % blocks, expected 2', n; end if;

  -- B now saves the document, changing ONLY blk_x. (B is a member here purely
  -- to model a second editor; the tenancy checks are 2 and 22.)
  insert into public.org_members (org_id, user_id, role) values (oa, ub, 'member')
    on conflict do nothing;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', ub::text, 'role', 'authenticated')::text, true);
  update public.docs set doc =
    '{"id":"nb_attr","sheets":[{"id":"s1","blocks":[
        {"id":"blk_x","type":"text","content":"EDITED BY B"},
        {"id":"blk_y","type":"text","content":"y"}]}]}'::jsonb
   where id = 'nb_attr';

  select edited_by into t2 from public.blocks where id = 'blk_x';
  if t2 is distinct from ub::text then
    raise exception 'FAIL 21b: blk_x is attributed to %, expected the editor B', t2;
  end if;
  select edited_by into t2 from public.blocks where id = 'blk_y';
  if t2 is distinct from ua::text then
    raise exception 'FAIL 21c: blk_y was re-attributed to % by a save that did not touch it — this is "who saved the file", not "who edited the block"', t2;
  end if;
  passed := passed + 1;
  raise notice 'ok 21  a save re-attributes only the blocks it actually changed';

  -- ══ 22. attribution cannot be forged, and blocks cannot be written ═══════
  ok := false;
  begin
    set local role authenticated;
    update public.blocks set edited_by = ua where id = 'blk_x';
    reset role;
  exception when others then ok := true; reset role;
  end;
  if not ok then
    raise exception 'FAIL 22: a client rewrote edited_by. An attribution flag that can be forged is a false statement about a colleague, rendered as fact.';
  end if;

  ok := false;
  begin
    set local role authenticated;
    insert into public.blocks (id, doc_id, org_id, fingerprint, edited_by)
    values ('blk_fake', 'nb_attr', oa, 'x', ua);
    reset role;
  exception when others then ok := true; reset role;
  end;
  if not ok then raise exception 'FAIL 22b: a client inserted a block row directly'; end if;
  passed := passed + 1;
  raise notice 'ok 22  blocks are readable by the tenant and writable by nobody';

  -- ══ 23. block rows do not outlive their document ════════════════════════
  perform set_config('request.jwt.claims', '', true);
  delete from public.docs where id = 'nb_attr';
  select count(*) into n from public.blocks where doc_id = 'nb_attr';
  if n <> 0 then
    raise exception 'FAIL 23: % block rows survived their document — orphans nothing can name', n;
  end if;
  passed := passed + 1;
  raise notice 'ok 23  purging a document takes its block rows with it';

  raise notice '';
  raise notice '  %/20 schema repairs verified', passed;
end $outer$;


-- ── storage policies, driven as the querying role ───────────────────────────
-- These cannot live in the block above: a policy is evaluated against the role
-- running the statement, and `set local role` inside a DO block does not
-- survive the exception handling that block relies on.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $st$
declare ok boolean;
begin
  -- a legacy {user_uuid}/… object stays READABLE
  if not exists (
    select 1 from storage.objects
     where bucket_id='ds-assets' and name = '11111111-1111-1111-1111-111111111111/image/img_legacy'
  ) then
    raise exception 'FAIL 14: a pre-0004 object at the user-uuid path is no longer readable';
  end if;
  raise notice 'ok 14  a legacy {user_uuid}/… object is still readable after the path moved to {org_id}/…';

  -- but a NEW write to that shape is refused
  ok := false;
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('ds-assets', '11111111-1111-1111-1111-111111111111/image/img_new_legacy', '{"size":10}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then
    raise exception 'FAIL 15: a new object was accepted at the legacy user-uuid path — the two shapes would coexist forever';
  end if;
  raise notice 'ok 15  new writes to the legacy path shape are refused';
end $st$;
rollback;

-- ── a free account cannot write bytes at all ────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $free$
declare ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('ds-assets', 'org_22222222-2222-2222-2222-222222222222/pdf/pdf_free', '{"size":1000000}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then
    raise exception 'FAIL 16: a free account wrote to the bucket. The manifest row was the only quota gate, and a client can simply not insert one.';
  end if;
  raise notice 'ok 16  a free account cannot write bytes to the bucket at all';
  raise notice '';
  raise notice '  20/20 verified';
end $free$;
rollback;
