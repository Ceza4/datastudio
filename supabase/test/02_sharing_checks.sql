-- ============================================================================
--  02_sharing_checks.sql — does 0008 actually share the thing it says it does
--
--  0008's own self-test is structural: the table exists, the grants are
--  narrow, the helpers are executable. None of that answers the only question
--  that matters, which is whether a person handed ONE SHEET can see the sheet
--  next to it.
--
--  So this file is two people. It runs as `authenticated` with a real JWT
--  claim, exactly like rls_pentest.sql, because RLS does not apply to the
--  superuser and a sharing test run as superuser proves nothing at all.
--
--  Everything happens inside a transaction that ROLLS BACK.
--
--  Run:
--    psql -v ON_ERROR_STOP=1 -f supabase/test/00_supabase_shim.sql
--    psql -v ON_ERROR_STOP=1 -f supabase/migrations/0*.sql
--    psql -v ON_ERROR_STOP=1 -f supabase/test/02_sharing_checks.sql
-- ============================================================================

\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ── fixtures ────────────────────────────────────────────────────────────────
--   A  owns the project
--   B  a stranger, in his own organisation — the friend
--   C  a member of A's organisation — the colleague
--   D  has no account at all yet — the pending invite
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','share-a@datastudio.invalid', now(), now()),
  ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','share-b@datastudio.invalid', now(), now()),
  ('c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','share-c@datastudio.invalid', now(), now());

insert into public.org_members (org_id, user_id, role)
values ('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5','member');

update public.subscriptions set plan = 'pro'
 where org_id in ('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
                  'org_b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5');

-- Two sheets. Sheet one holds a text block and an image; sheet two holds a
-- different image. That asymmetry is the whole point: a grant on sheet one
-- must not reach sheet two's picture.
insert into public.docs (id, owner_id, org_id, kind, name, doc)
values ('nb_share','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
        'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','notebook','Shared project',
 '{"sheets":[
     {"id":"sh_1","name":"Sheet 1","blocks":[
        {"id":"blk_1","type":"text","content":"one"},
        {"id":"blk_2","type":"image","imageId":"img_one"}]},
     {"id":"sh_2","name":"Sheet 2","blocks":[
        {"id":"blk_3","type":"image","imageId":"img_two"}]}
   ]}'::jsonb);

insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values
 ('ds-assets','org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5/image/img_one',
  'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','{"size":10}'::jsonb),
 ('ds-assets','org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5/image/img_two',
  'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','{"size":10}'::jsonb);

insert into public.assets (id, owner_id, org_id, kind, doc_id, path, name)
values
 ('img_one','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
  'image','nb_share','org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5/image/img_one','one.png'),
 ('img_two','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
  'image','nb_share','org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5/image/img_two','two.png');

do $do$
declare n int;
begin
  select count(*) into n from public.blocks where doc_id = 'nb_share';
  if n <> 3 then raise exception 'FIXTURE: 0007 projected % blocks, expected 3', n; end if;
  select count(*) into n from public.blocks where doc_id = 'nb_share' and data is not null;
  if n <> 0 then raise exception 'FIXTURE: % block(s) already carry content before any share exists', n; end if;
  raise notice 'ok  0  three blocks projected, none carrying content';
end $do$;


-- ══ 1. the baseline: a stranger sees nothing ════════════════════════════════
-- Without this every check below could pass because the policies deny
-- everybody, which is not the same thing as denying the right people.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.docs where id = 'nb_share';
  if n <> 0 then raise exception 'FAIL 1: a stranger reads the project'; end if;
  select count(*) into n from public.blocks where doc_id = 'nb_share';
  if n <> 0 then raise exception 'FAIL 1: a stranger reads % block(s)', n; end if;
  select count(*) into n from public.assets where doc_id = 'nb_share';
  if n <> 0 then raise exception 'FAIL 1: a stranger reads the asset manifest'; end if;
  raise notice 'ok  1  a stranger reads no project, no blocks, no assets';
end $do$;


-- ══ 2. LEVEL ONE: a whole project ═══════════════════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
insert into public.shares (id, doc_id, subject_kind, grantee_email, role)
values ('shr_doc','nb_share','doc','share-b@datastudio.invalid','viewer');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.docs where id = 'nb_share';
  if n <> 1 then raise exception 'FAIL 2: a project grant did not make the project readable'; end if;
  select count(*) into n from public.blocks where doc_id = 'nb_share';
  if n <> 3 then raise exception 'FAIL 2: a project grant showed % of 3 blocks', n; end if;
  select count(*) into n from public.assets where doc_id = 'nb_share';
  if n <> 2 then raise exception 'FAIL 2: a project grant showed % of 2 assets', n; end if;
  raise notice 'ok  2  a project grant carries the project, its blocks and its assets';
end $do$;

-- A VIEWER may not write. This is the check that separates a share from a
-- handover.
do $do$
declare n int;
begin
  update public.docs set name = 'stolen' where id = 'nb_share';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3: a viewer rewrote the project'; end if;
  raise notice 'ok  3  a viewer on a project cannot write it';
end $do$;


-- ══ 4. no content was duplicated for a PROJECT grant ════════════════════════
-- A doc-level grantee reads docs.doc directly, so mirroring content into
-- blocks.data would be pure waste. §6's coverage test excludes doc grants, and
-- this is the assertion that keeps it that way.
reset role;
do $do$
declare n int;
begin
  select count(*) into n from public.blocks where doc_id = 'nb_share' and data is not null;
  if n <> 0 then
    raise exception 'FAIL 4: a project grant duplicated % block(s) into blocks.data for nothing', n;
  end if;
  raise notice 'ok  4  a project grant duplicates no content';
end $do$;


-- ══ 5. LEVEL TWO: one sheet, and not the one beside it ══════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
update public.shares set revoked_at = now() where id = 'shr_doc';
insert into public.shares (id, doc_id, subject_kind, sheet_id, grantee_email, role)
values ('shr_sheet','nb_share','sheet','sh_1','share-b@datastudio.invalid','viewer');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int; ids text;
begin
  -- THE HEADLINE. A sheet grantee must NOT get the document row, because the
  -- document row is every sheet.
  select count(*) into n from public.docs where id = 'nb_share';
  if n <> 0 then
    raise exception 'FAIL 5: a SHEET grant handed over the whole project row — every other sheet with it';
  end if;

  select count(*), string_agg(id, ',' order by id) into n, ids
    from public.blocks where doc_id = 'nb_share';
  if n <> 2 or ids <> 'blk_1,blk_2' then
    raise exception 'FAIL 5: a sheet grant showed % block(s) [%], expected blk_1,blk_2', n, ids;
  end if;

  -- and the content actually arrived, or the grantee has an address and no page
  select count(*) into n from public.blocks where doc_id = 'nb_share' and data is not null;
  if n <> 2 then raise exception 'FAIL 5: % of 2 shared blocks carry content', n; end if;

  raise notice 'ok  5  a sheet grant carries that sheet''s blocks with content, and not the project row';
end $do$;

-- The asset half of the same question.
do $do$
declare n int; ids text;
begin
  select count(*), string_agg(id, ',' order by id) into n, ids
    from public.assets where doc_id = 'nb_share';
  if n <> 1 or ids <> 'img_one' then
    raise exception 'FAIL 6: a sheet grant exposed % asset(s) [%], expected img_one only', n, ids;
  end if;
  select count(*) into n from storage.objects
   where bucket_id = 'ds-assets' and name like '%/image/img_two';
  if n <> 0 then
    raise exception 'FAIL 6: the OBJECT for the unshared sheet''s image is readable — the manifest was scoped and the bucket was not';
  end if;
  select count(*) into n from storage.objects
   where bucket_id = 'ds-assets' and name like '%/image/img_one';
  if n <> 1 then raise exception 'FAIL 6: the shared sheet''s image object is NOT readable'; end if;
  raise notice 'ok  6  a sheet grant reaches that sheet''s image and no other, in the manifest and in the bucket';
end $do$;


-- ══ 7. only the shared blocks were duplicated ═══════════════════════════════
reset role;
do $do$
declare n int; who text;
begin
  select count(*) into n from public.blocks where doc_id = 'nb_share' and data is not null;
  if n <> 2 then raise exception 'FAIL 7: % block(s) carry content, expected exactly the 2 shared ones', n; end if;
  select string_agg(id, ',' order by id) into who from public.blocks where data is not null;
  if who <> 'blk_1,blk_2' then raise exception 'FAIL 7: the wrong blocks carry content: %', who; end if;
  raise notice 'ok  7  content is mirrored for the shared sheet only';
end $do$;


-- ══ 8. LEVEL THREE: one block ═══════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
update public.shares set revoked_at = now() where id = 'shr_sheet';
insert into public.shares (id, doc_id, subject_kind, block_id, grantee_email, role)
values ('shr_block','nb_share','block','blk_3','share-b@datastudio.invalid','viewer');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int; ids text;
begin
  select count(*), string_agg(id, ',' order by id) into n, ids
    from public.blocks where doc_id = 'nb_share';
  if n <> 1 or ids <> 'blk_3' then
    raise exception 'FAIL 8: a block grant showed % block(s) [%], expected blk_3', n, ids;
  end if;
  select count(*), string_agg(id, ',' order by id) into n, ids from public.assets;
  if n <> 1 or ids <> 'img_two' then
    raise exception 'FAIL 8: a block grant exposed % asset(s) [%], expected img_two', n, ids;
  end if;
  raise notice 'ok  8  a block grant carries one block and the one image it names';
end $do$;


-- ══ 9. REVOCATION TAKES THE BYTES WITH IT ═══════════════════════════════════
-- A revoke that leaves the content mirrored is a revoke in the UI only.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
update public.shares set revoked_at = now() where id = 'shr_block';

reset role;
do $do$
declare n int;
begin
  select count(*) into n from public.blocks where doc_id = 'nb_share' and data is not null;
  if n <> 0 then raise exception 'FAIL 9: % block(s) still carry content after every grant was revoked', n; end if;
  raise notice 'ok  9  revoking the last grant removes the mirrored content';
end $do$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.blocks where doc_id = 'nb_share';
  if n <> 0 then raise exception 'FAIL 10: a revoked grantee still reads % block(s)', n; end if;
  select count(*) into n from public.docs where id = 'nb_share';
  if n <> 0 then raise exception 'FAIL 10: a revoked grantee still reads the project'; end if;
  raise notice 'ok 10  a revoked grantee reads nothing again';
end $do$;


-- ══ 11. AN EDITOR'S WRITE REACHES THE OWNER'S DOCUMENT ══════════════════════
-- The one piece of genuinely new machinery: blocks.data is writable by a
-- grantee, and a trigger has to put that value back inside docs.doc without
-- the two triggers calling each other forever.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
insert into public.shares (id, doc_id, subject_kind, sheet_id, grantee_email, role)
values ('shr_edit','nb_share','sheet','sh_1','share-b@datastudio.invalid','editor');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int;
begin
  update public.blocks
     set data = '{"id":"blk_1","type":"text","content":"edited by the friend"}'::jsonb
   where id = 'blk_1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 11: an editor''s write matched % rows', n; end if;
  raise notice 'ok 11  an editor on a shared sheet can write the block';
end $do$;

reset role;
do $do$
declare body text; who uuid; r bigint; fp text;
begin
  select d.doc #>> '{sheets,0,blocks,0,content}', d.rev into body, r
    from public.docs d where d.id = 'nb_share';
  if body is distinct from 'edited by the friend' then
    raise exception 'FAIL 12: the edit did not reach docs.doc (found %)', coalesce(body,'<null>');
  end if;
  if r < 2 then raise exception 'FAIL 12: rev did not move (%), so the owner''s client would never pull', r; end if;

  select edited_by, fingerprint into who, fp from public.blocks where id = 'blk_1';
  if who is distinct from 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5'::uuid then
    raise exception 'FAIL 12: the block is attributed to % , not to the person who edited it', coalesce(who::text,'<null>');
  end if;
  if fp is distinct from md5((select d.doc #> '{sheets,0,blocks,0}' from public.docs d where d.id='nb_share')::text) then
    raise exception 'FAIL 12: fingerprint disagrees with the document — the projection and the clamp computed different things';
  end if;
  raise notice 'ok 12  the edit landed in docs.doc, bumped rev, and is attributed to the editor';
end $do$;

-- The other half: an editor on a sheet must not be able to write the block
-- next door. Same grant, different sheet.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int;
begin
  update public.blocks set data = '{"id":"blk_3","type":"text","content":"reached too far"}'::jsonb
   where id = 'blk_3';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 13: an editor on sheet one wrote a block on sheet two'; end if;
  raise notice 'ok 13  an editor''s reach stops at the subject they were granted';
end $do$;

-- And a VIEWER cannot write at all.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
update public.shares set revoked_at = now() where id = 'shr_edit';
insert into public.shares (id, doc_id, subject_kind, sheet_id, grantee_email, role)
values ('shr_view','nb_share','sheet','sh_1','share-b@datastudio.invalid','viewer');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int;
begin
  update public.blocks set data = '{"id":"blk_1","type":"text","content":"viewer wrote this"}'::jsonb
   where id = 'blk_1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 14: a VIEWER wrote a shared block'; end if;
  raise notice 'ok 14  a viewer on a shared sheet cannot write it';
end $do$;


-- ══ 15. A PRIVATE PROJECT IS PRIVATE FROM ITS OWN ORGANISATION ══════════════
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.docs where id = 'nb_share';
  if n <> 1 then raise exception 'FAIL 15: a colleague cannot read an ORG-visible project — the baseline is broken'; end if;
  raise notice 'ok 15  a colleague reads an org-visible project';
end $do$;

-- C tries to make somebody else's project private.
do $do$
declare ok boolean := false;
begin
  begin
    update public.docs set visibility = 'private' where id = 'nb_share';
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then
    -- The policy may simply match zero rows instead of raising; either is a
    -- refusal, but the value must not have moved.
    if (select visibility from public.docs where id = 'nb_share') = 'private' then
      raise exception 'FAIL 16: a non-owner made somebody else''s project private';
    end if;
  end if;
  raise notice 'ok 16  only the owner can change a project''s visibility';
end $do$;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
update public.docs set visibility = 'private' where id = 'nb_share';

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.docs where id = 'nb_share';
  if n <> 0 then raise exception 'FAIL 17: a private project is still visible to the organisation'; end if;
  select count(*) into n from public.blocks where doc_id = 'nb_share';
  if n <> 0 then
    raise exception 'FAIL 17: the project is hidden but its % block(s) are not — attribution flags would leak the contents of a private project', n;
  end if;
  raise notice 'ok 17  a private project hides itself AND its blocks from the rest of the organisation';
end $do$;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.docs where id = 'nb_share';
  if n <> 1 then raise exception 'FAIL 18: the owner locked themselves out of their own private project'; end if;
  raise notice 'ok 18  the owner still reads their own private project';
end $do$;

-- A grantee keeps access to a private project: privacy is about the org, not
-- about people you deliberately invited.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.blocks where doc_id = 'nb_share';
  if n <> 2 then
    raise exception 'FAIL 19: making a project private revoked an explicit grant (% blocks visible, expected 2)', n;
  end if;
  raise notice 'ok 19  going private does not silently revoke people you invited';
end $do$;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
update public.docs set visibility = 'org' where id = 'nb_share';


-- ══ 20. THE ORGANISATION'S SWITCH ═══════════════════════════════════════════
reset role;
update public.organizations set sharing_policy = 'off'
 where id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';

set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
do $do$
declare ok boolean := false; n int;
begin
  begin
    insert into public.shares (id, doc_id, subject_kind, grantee_email, role)
    values ('shr_off','nb_share','doc','share-b@datastudio.invalid','viewer');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 20: sharing_policy=off did not stop a new grant'; end if;

  -- and the grants already out there keep working
  select count(*) into n from public.shares where id = 'shr_view' and revoked_at is null;
  if n <> 1 then raise exception 'FAIL 20: turning sharing off voided an existing grant'; end if;
  raise notice 'ok 20  sharing_policy=off blocks new grants and leaves existing ones alone';
end $do$;

reset role;
update public.organizations set sharing_policy = 'internal'
 where id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';

set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
do $do$
declare ok boolean := false;
begin
  begin
    insert into public.shares (id, doc_id, subject_kind, grantee_email, role)
    values ('shr_out','nb_share','doc','share-b@datastudio.invalid','viewer');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 21: sharing_policy=internal let a grant leave the organisation'; end if;

  -- but a colleague is fine
  insert into public.shares (id, doc_id, subject_kind, sheet_id, grantee_email, role)
  values ('shr_in','nb_share','sheet','sh_2','share-c@datastudio.invalid','viewer');
  raise notice 'ok 21  sharing_policy=internal keeps grants inside the organisation without disabling them';
end $do$;

reset role;
update public.organizations set sharing_policy = 'open'
 where id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';


-- ══ 22. A PENDING INVITE, CLAIMED AT SIGNUP ═════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
insert into public.shares (id, doc_id, subject_kind, sheet_id, grantee_email, role)
values ('shr_pending','nb_share','sheet','sh_1','newcomer@datastudio.invalid','viewer');

reset role;
do $do$
declare g uuid;
begin
  select grantee_id into g from public.shares where id = 'shr_pending';
  if g is not null then raise exception 'FAIL 22: a grant to an address with no account resolved to somebody'; end if;
  raise notice 'ok 22  a grant to an unknown address is a pending invite, not an error';
end $do$;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('d5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','newcomer@datastudio.invalid', now(), now());

do $do$
declare g uuid;
begin
  select grantee_id into g from public.shares where id = 'shr_pending';
  if g is distinct from 'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5'::uuid then
    raise exception 'FAIL 23: signing up did not claim the pending invite (grantee_id = %)', coalesce(g::text,'<null>');
  end if;
  raise notice 'ok 23  signing up claims the invitations waiting for that address';
end $do$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5","role":"authenticated"}';
do $do$
declare n int;
begin
  select count(*) into n from public.blocks where doc_id = 'nb_share';
  if n <> 2 then raise exception 'FAIL 24: the newcomer sees % block(s), expected the 2 on the shared sheet', n; end if;
  raise notice 'ok 24  and the invitation works the moment they arrive';
end $do$;


-- ══ 25. grantee_id is not readable, so shares are not an account oracle ═════
do $do$
declare ok boolean := false; g uuid;
begin
  begin
    select grantee_id into g from public.shares where id = 'shr_pending';
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then
    raise exception 'FAIL 25: a client can read shares.grantee_id — share to an address, read it back, and you know whether that person has an account';
  end if;
  raise notice 'ok 25  shares.grantee_id is server-side only';
end $do$;


-- ══ 26. the payload cannot lie ══════════════════════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';
do $do$
declare ok boolean := false; t text;
begin
  -- a block that belongs to a different document
  insert into public.docs (id, owner_id, org_id, kind, name, doc)
  values ('nb_other','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
          'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','notebook','other',
          '{"sheets":[{"id":"sh_x","blocks":[{"id":"blk_x","type":"text"}]}]}'::jsonb);
  begin
    insert into public.shares (id, doc_id, subject_kind, block_id, grantee_email, role)
    values ('shr_liar','nb_share','block','blk_x','share-b@datastudio.invalid','viewer');
  exception when foreign_key_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL 26: a grant named a block that is not in the document it claims'; end if;

  -- A client cannot even NAME the tenant: `org_id` is outside the column-level
  -- INSERT grant, so this is refused by privilege before any trigger runs.
  ok := false;
  begin
    insert into public.shares (id, org_id, doc_id, subject_kind, grantee_email, role)
    values ('shr_pinned','org_b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5','nb_share','doc',
            'share-b@datastudio.invalid','viewer');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 26: a client named org_id on a grant and was allowed to'; end if;
  raise notice 'ok 26  a grant cannot name a foreign block, and cannot name a tenant at all';
end $do$;

-- The belt behind that brace: even a caller who CAN write the column — the
-- service role, a future server route — has it overwritten from the document.
-- Two independent defences, because 0004 shipped with one that turned out to
-- be zero.
reset role;
do $do$
declare t text;
begin
  perform set_config('request.jwt.claim.sub','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', true);
  insert into public.shares (id, org_id, doc_id, subject_kind, grantee_email, role)
  values ('shr_pinned','org_b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5','nb_share','doc',
          'share-b@datastudio.invalid','viewer');
  select org_id into t from public.shares where id = 'shr_pinned';
  if t <> 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5' then
    raise exception 'FAIL 26b: a supplied org_id survived the trigger (landed in %)', t;
  end if;
  perform set_config('request.jwt.claim.sub','', true);
  raise notice 'ok 26b a supplied tenant is overwritten from the document it grants';
end $do$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';

-- Widening an existing grant by PATCH — the obvious attack on any permission
-- row. Refused twice: the UPDATE grant covers `revoked_at` and nothing else,
-- and §4's trigger pins the rest even for a caller who holds the columns.
do $do$
declare ok boolean := false;
begin
  begin
    update public.shares set role = 'editor', subject_kind = 'doc' where id = 'shr_view';
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 27: a client patched role/subject_kind on an existing grant'; end if;
  raise notice 'ok 27  a client cannot name role or subject_kind on an update at all';
end $do$;

reset role;
do $do$
declare t text;
begin
  perform set_config('request.jwt.claim.sub','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', true);
  update public.shares set role = 'editor', subject_kind = 'doc' where id = 'shr_view';
  select role into t from public.shares where id = 'shr_view';
  if t <> 'viewer' then raise exception 'FAIL 27b: a viewer grant was upgraded to % by an update', t; end if;
  select subject_kind into t from public.shares where id = 'shr_view';
  if t <> 'sheet' then raise exception 'FAIL 27b: a sheet grant was widened to % by an update', t; end if;
  perform set_config('request.jwt.claim.sub','', true);
  raise notice 'ok 27b a grant''s scope survives an update that tries to widen it';
end $do$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';

do $do$
declare ok boolean := false;
begin
  begin
    delete from public.shares where id = 'shr_view';
    if (select count(*) from public.shares where id = 'shr_view') = 0 then
      raise exception 'FAIL 28: a grant was erased rather than revoked — the access history is gone';
    end if;
    ok := true;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 28: unexpected'; end if;
  raise notice 'ok 28  grants are revoked, never deleted';
end $do$;


-- ══ 29. the usage bookkeeping still adds up, statement-level ════════════════
reset role;
do $do$
declare live bigint; direct bigint;
begin
  perform public.recompute_usage_org('org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5');
  select doc_bytes into live from public.usage
   where org_id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';
  select coalesce(sum(bytes),0) into direct from public.docs
   where org_id = 'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5' and deleted_at is null;
  if live is distinct from direct then
    raise exception 'FAIL 29: usage says % bytes, the documents say % — the statement-level trigger lost a row', live, direct;
  end if;
  raise notice 'ok 29  statement-level usage triggers agree with the source tables';
end $do$;

-- A multi-row insert now costs ONE recompute rather than one per row. Proven
-- by counting the triggers rather than by timing, which is stable in CI.
do $do$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgrelid in ('public.docs'::regclass,'public.assets'::regclass)
     and not tgisinternal and tgname like '%usage%' and (tgtype & 1) = 1;
  if n > 0 then raise exception 'FAIL 30: % usage trigger(s) are still per-row', n; end if;
  select count(*) into n from pg_trigger
   where tgrelid in ('public.docs'::regclass,'public.assets'::regclass)
     and not tgisinternal and tgname like '%usage%';
  if n <> 6 then raise exception 'FAIL 30: expected 6 statement-level usage triggers, found %', n; end if;
  raise notice 'ok 30  six statement-level usage triggers, none per-row';
end $do$;


-- ══ 31. an imported workbook does not go through the block projection ═══════
do $do$
declare n int;
begin
  insert into public.docs (id, owner_id, org_id, kind, name, doc)
  values ('sf_book','a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
          'org_a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5','sheetfile','book',
          '{"sheets":[{"name":"Tab","headers":["a"],"rows":[[1]]}]}'::jsonb);
  select count(*) into n from public.blocks where doc_id = 'sf_book';
  if n <> 0 then raise exception 'FAIL 31: an imported workbook projected % block row(s)', n; end if;
  raise notice 'ok 31  a workbook''s sheets are not a notebook''s sheets, and the projection knows it';
end $do$;

do $do$ begin raise notice ' '; raise notice '  31/31 sharing behaviours verified'; end $do$;

rollback;
