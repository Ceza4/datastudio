-- ============================================================================
--  0007_blocks_and_attribution.sql
--
--  A BLOCK BECOMES A ROW.
--
--  Two features were asked for — a block that can be shared into a chat and
--  opened live somewhere else, and a flag showing who last changed a block —
--  and they turn out to be the same piece of work. Neither is possible while a
--  notebook is one `jsonb` blob: the client pushes the whole document as a
--  unit, so the server only ever sees "this user replaced everything". There
--  is nothing smaller to link to, and nothing smaller to attribute.
--
--  This is the foundation, and deliberately nothing else. No chat, no sharing,
--  no invites. Those are small once this exists and are built twice if it does
--  not.
--
--  ── THE DESIGN DECISION THAT MATTERS ───────────────────────────────────────
--
--  `blocks` does NOT hold block content. It holds a FINGERPRINT of it.
--
--  The obvious version of this table has a `data jsonb` column and stores each
--  block twice — once inside `docs.doc` and once here. That is where the
--  design goes wrong, for three reasons and in that order:
--
--    · it DOUBLES stored bytes for every account, and the quota triggers in
--      0005 count real disk. Everyone's plan would shrink by half overnight.
--    · two copies of the same value drift. The whole reason `assets.bytes` is
--      read from storage.objects rather than from the client (0003 §5) is that
--      a second copy of a fact is a second thing to be wrong.
--    · it is not needed. Attribution needs to know THAT a block changed and
--      who changed it. Linking needs a stable address. Neither needs the
--      bytes, which are already one join away.
--
--  So this table is small, cheap, and cannot disagree with the document: it is
--  a projection maintained inside the same statement as the write it projects.
--  When the client eventually pushes blocks individually, `data` moves here and
--  `docs.doc` slims down — and that migration starts from a table whose shape
--  and policies have already been proven in production.
--
--  ── WHY A TRIGGER AND NOT THE CLIENT ───────────────────────────────────────
--
--  `edited_by` is stamped from `auth.uid()` inside the trigger, exactly like
--  `org_id` (0005 §1), `owner_id` and `rev`. A client that can name the author
--  of a change can name somebody else as the author of a change, and an
--  attribution flag that can be forged is worse than no flag: it is a false
--  statement about a colleague, rendered in the UI as fact.
--
--  Doing it server-side also means the client needs no changes to START
--  producing correct attribution. The whole-document push it already sends is
--  decomposed here, diffed against the previous version, and only genuinely
--  changed blocks get a new stamp. That matters after 0004: a schema change
--  whose client half is subtle is exactly the shape of the bug that broke
--  every write for two days. This one has no client half.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.docs') is null then
    raise exception '0003 has not been applied — public.docs is missing.';
  end if;
  if to_regclass('public.organizations') is null then
    raise exception '0004 has not been applied — run it first.';
  end if;
end $$;


-- ── 1. the table ────────────────────────────────────────────────────────────
create table if not exists public.blocks (
  -- The id already minted by lib/ids.js and already written into the document.
  -- Not a new identity: the whole point is that this row ADDRESSES a block the
  -- application already has, so a link can point at it and a flag can hang off
  -- it without the client learning a second id scheme.
  id          text primary key,

  doc_id      text not null references public.docs(id) on delete cascade,
  -- Denormalised from the document so every policy and index on this table can
  -- be tenant-scoped without a join. Kept in step by the projection, which
  -- reads it from the row it is projecting.
  org_id      text not null references public.organizations(id) on delete cascade,
  sheet_id    text,
  kind        text,

  -- md5 of the block's canonical JSON. The ONLY thing that decides whether a
  -- write counts as a change to this block, and therefore the only thing that
  -- moves `edited_by`. A document saved with no edit to this block leaves the
  -- fingerprint identical and the attribution untouched — which is what makes
  -- "Mara edited this" true rather than "Mara saved the document that contains
  -- this".
  fingerprint text not null,

  -- ON DELETE SET NULL, not CASCADE. When somebody deletes their account the
  -- blocks they touched must not vanish out of everyone else's notebooks; the
  -- change becomes unattributed, which is the honest outcome.
  edited_by   uuid references auth.users(id) on delete set null,
  edited_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

comment on table public.blocks is
  'Addressable metadata for every block inside docs.doc. A projection, not a copy: no content, maintained by project_blocks() in the same statement as the document write. See 0007.';


-- ── 2. indexes for the two questions this table exists to answer ────────────
-- "what is in this document" — the read the client makes on every pull.
create index if not exists blocks_doc_idx on public.blocks (doc_id);
-- "what has changed in my workspace lately" — the flag feed, newest first.
create index if not exists blocks_org_edited_idx on public.blocks (org_id, edited_at desc);


-- ── 3. the projection ───────────────────────────────────────────────────────
--
-- TWO STATEMENTS, WHATEVER THE DOCUMENT SIZE. The naive version loops over
-- blocks and issues an upsert each, which on a 200-block notebook is 200 round
-- trips inside a trigger on the hot save path. Both statements below are
-- set-based, so a large notebook costs the same number of statements as a
-- small one.
create or replace function public.project_blocks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  actor uuid := (select auth.uid());
begin
  -- Folders and any other document without a `sheets` array project nothing.
  -- Written as a guard rather than relying on the extraction to return no rows
  -- so that the DELETE below cannot fire against a shape it did not read.
  if new.doc is null or jsonb_typeof(new.doc -> 'sheets') is distinct from 'array' then
    return null;
  end if;

  with incoming as (
    select
      b.value ->> 'id'                        as id,
      s.value ->> 'id'                        as sheet_id,
      coalesce(b.value ->> 'type', 'unknown') as kind,
      md5(b.value::text)                      as fingerprint
      from jsonb_array_elements(new.doc -> 'sheets') s
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(s.value -> 'blocks') = 'array'
             then s.value -> 'blocks' else '[]'::jsonb end
      ) b
     where b.value ->> 'id' is not null
  ),
  -- A malformed document with the same block id twice would make the upsert
  -- raise "ON CONFLICT DO UPDATE command cannot affect row a second time".
  -- Keeping the first occurrence is arbitrary and safe; raising here would
  -- refuse a SAVE because of a duplicate the user cannot see or fix.
  deduped as (
    select distinct on (id) id, sheet_id, kind, fingerprint from incoming order by id
  )
  insert into public.blocks (id, doc_id, org_id, sheet_id, kind, fingerprint, edited_by, edited_at)
  select d.id, new.id, new.org_id, d.sheet_id, d.kind, d.fingerprint, actor, now()
    from deduped d
  on conflict (id) do update set
    doc_id      = excluded.doc_id,
    org_id      = excluded.org_id,
    sheet_id    = excluded.sheet_id,
    kind        = excluded.kind,
    fingerprint = excluded.fingerprint,
    -- THE HEART OF IT. The stamp moves only when the content actually moved.
    -- `is distinct from` rather than `<>` so a NULL on either side compares
    -- correctly instead of silently skipping the update.
    edited_by   = case when public.blocks.fingerprint is distinct from excluded.fingerprint
                       then excluded.edited_by else public.blocks.edited_by end,
    edited_at   = case when public.blocks.fingerprint is distinct from excluded.fingerprint
                       then excluded.edited_at else public.blocks.edited_at end;

  -- Blocks the user removed. Scoped to THIS document: a block id that has moved
  -- to another document (a cut and paste across notebooks) is re-pointed by the
  -- upsert above and must not then be deleted by this statement, which is why
  -- the predicate names doc_id rather than just the absent ids.
  delete from public.blocks b
   where b.doc_id = new.id
     and not exists (
       select 1
         from jsonb_array_elements(new.doc -> 'sheets') s
         cross join lateral jsonb_array_elements(
           case when jsonb_typeof(s.value -> 'blocks') = 'array'
                then s.value -> 'blocks' else '[]'::jsonb end
         ) bb
        where bb.value ->> 'id' = b.id
     );

  return null;   -- AFTER trigger; the return value is ignored
end;
$fn$;

-- AFTER, not BEFORE: this must run against the row as it was actually written,
-- with org_id pinned (0005 §2) and the quota checks already passed. A rejected
-- write must not leave block rows behind describing a document that does not
-- exist.
drop trigger if exists docs_project_blocks on public.docs;
create trigger docs_project_blocks
  after insert or update of doc on public.docs
  for each row execute function public.project_blocks();


-- ── 4. RLS: readable by the tenant, writable by nobody ──────────────────────
-- There is no INSERT, UPDATE or DELETE policy, and that is the whole security
-- model of this table. Every row is written by the definer function above, so
-- `edited_by` cannot be chosen by the party it names. rls_pentest.sql check 12
-- makes the same argument for `usage`: RLS with no write policy is a denial,
-- and 0006 added the matching GRANT revoke so it is denied twice.
alter table public.blocks enable row level security;

drop policy if exists "blocks readable by members" on public.blocks;
create policy "blocks readable by members" on public.blocks
  for select using (org_id in (select public.my_org_ids()));

revoke insert, update, delete on public.blocks from anon, authenticated;
revoke truncate, trigger, references on public.blocks from anon, authenticated;

-- The projection is trigger-only. Nothing should be able to call it directly,
-- and 0006's sweep would not have covered a function created after it ran.
revoke all on function public.project_blocks() from public, anon, authenticated;


-- ── 5. backfill ─────────────────────────────────────────────────────────────
-- Existing documents have never been projected. Touching `doc` would fire the
-- trigger but would also bump `rev` on every document in the database and hand
-- every connected client a spurious pull, so the backfill runs the same
-- extraction directly.
--
-- `edited_by` is left NULL. There is no honest answer for work that predates
-- attribution, and inventing one — stamping the owner — would put a name
-- against changes that person may not have made. The client renders NULL as no
-- flag, which is correct: we do not know.
insert into public.blocks (id, doc_id, org_id, sheet_id, kind, fingerprint, edited_by, edited_at)
select distinct on (b.value ->> 'id')
       b.value ->> 'id',
       d.id,
       d.org_id,
       s.value ->> 'id',
       coalesce(b.value ->> 'type', 'unknown'),
       md5(b.value::text),
       null,
       coalesce(d.updated_at, now())
  from public.docs d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.doc -> 'sheets') = 'array' then d.doc -> 'sheets' else '[]'::jsonb end
  ) s
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(s.value -> 'blocks') = 'array' then s.value -> 'blocks' else '[]'::jsonb end
  ) b
 where b.value ->> 'id' is not null
 order by b.value ->> 'id', d.updated_at desc
on conflict (id) do nothing;


-- ── 6. self-test ────────────────────────────────────────────────────────────
-- Same principle as 0005 §14: exercise the projection against a document
-- shaped the way the CLIENT shapes one, and prove the attribution rule rather
-- than assuming it. Runs inside the migration so a failure is a rolled-back
-- migration instead of a wrong flag in somebody's notebook.
do $$
declare
  u        uuid;
  org      text;
  n        int;
  fp_first text;
  fp_after text;
  who      uuid;
begin
  select id into u from auth.users order by created_at limit 1;
  if u is null then
    raise notice '0007 self-test skipped: no users yet.';
    return;
  end if;
  org := 'org_' || u::text;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', u::text, 'role', 'authenticated')::text, true);

  -- A two-block notebook, in the shape lib/syncdocs.js produces.
  --
  -- WRAPPED, BECAUSE THIS IS THE SECOND TIME. 0005's self-test failed to apply
  -- against production for exactly this reason: a free tenant has cloud = false
  -- and enforce_doc_quota refuses EVERY document write, so a self-test that
  -- creates a document cannot run there. That is the tier behaving correctly,
  -- and a migration must not refuse to apply because of it.
  --
  -- The rule worth carrying forward: any migration self-test that WRITES a
  -- document has to tolerate the plan gate. Reaching the gate is still
  -- evidence — it means every trigger before it ran — but the projection this
  -- file exists to prove cannot be exercised without a document, so on a free
  -- tenant it says so and stops rather than pretending.
  begin
    insert into public.docs (id, owner_id, kind, name, doc, org_id)
    values ('nb_probe_0007', u, 'notebook', 'probe',
            '{"id":"nb_probe_0007","sheets":[{"id":"s1","blocks":[
                {"id":"blk_p1","type":"text","content":"one"},
                {"id":"blk_p2","type":"table","content":"two"}]}]}'::jsonb,
            org);
  exception when check_violation then
    perform set_config('request.jwt.claims', '', true);
    raise notice '0007 self-test skipped: this organisation is on a plan without cloud sync, so no document can be written to project blocks from. Run supabase/test/run.sh, which uses a paid tenant.';
    return;
  end;

  select count(*) into n from public.blocks where doc_id = 'nb_probe_0007';
  if n <> 2 then raise exception '0007 self-test: projected % blocks, expected 2', n; end if;

  select fingerprint into fp_first from public.blocks where id = 'blk_p2';
  select edited_by   into who      from public.blocks where id = 'blk_p1';
  if who is distinct from u then
    raise exception '0007 self-test: edited_by is %, expected the acting user', who;
  end if;

  -- Change ONLY the first block. The second must keep its fingerprint AND its
  -- stamp, or "who edited this block" degrades into "who last saved the file",
  -- which is the distinction this table exists to make.
  update public.docs set doc =
    '{"id":"nb_probe_0007","sheets":[{"id":"s1","blocks":[
        {"id":"blk_p1","type":"text","content":"CHANGED"},
        {"id":"blk_p2","type":"table","content":"two"}]}]}'::jsonb
   where id = 'nb_probe_0007';

  select fingerprint into fp_after from public.blocks where id = 'blk_p2';
  if fp_after is distinct from fp_first then
    raise exception '0007 self-test: an untouched block changed fingerprint';
  end if;

  -- And a removed block leaves.
  update public.docs set doc =
    '{"id":"nb_probe_0007","sheets":[{"id":"s1","blocks":[
        {"id":"blk_p1","type":"text","content":"CHANGED"}]}]}'::jsonb
   where id = 'nb_probe_0007';

  select count(*) into n from public.blocks where doc_id = 'nb_probe_0007';
  if n <> 1 then raise exception '0007 self-test: % blocks after a removal, expected 1', n; end if;

  delete from public.docs where id = 'nb_probe_0007';
  select count(*) into n from public.blocks where doc_id = 'nb_probe_0007';
  if n <> 0 then raise exception '0007 self-test: % orphan block rows after the document went', n; end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice '0007 self-test passed: projection, per-block attribution, removal and cascade.';
end $$;

commit;

-- ============================================================================
--  AFTERWARDS
--
--    select kind, count(*), count(edited_by) as attributed from public.blocks
--     group by kind order by 2 desc;
--
--  WHAT THIS DELIBERATELY DOES NOT DO YET
--    · block content still lives in docs.doc. The client is unchanged.
--    · pushes are still whole-document, so two people editing DIFFERENT blocks
--      of one notebook still collide. Fixing that is the next step and it is a
--      client change, not a schema one — this table is the address space it
--      needs.
--    · nothing links a block into two documents yet. The column that will do
--      it is `doc_id`, and the shape of the change is a join table; it is not
--      added now because an unused table is a shape guess.
-- ============================================================================
