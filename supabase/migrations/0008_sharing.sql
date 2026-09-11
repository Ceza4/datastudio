-- ============================================================================
--  0008_sharing.sql
--
--  THREE LEVELS OF SHARING, AND THE ONE THAT DOES NOT EXIST.
--
--  Matas asked for three: a BLOCK thrown into a chat, a SHEET a friend opens
--  from their sidebar, and a whole PROJECT. Plus a private/shared switch on a
--  project, plus an org-level control over whether members may share outward
--  at all.
--
--  Two of those three are cheap. The third is the interesting one, and it is
--  the reason this file is long.
--
--  ── WHY A SHEET SHARE IS HARD AND A PROJECT SHARE IS NOT ───────────────────
--
--  A project is a row. Granting somebody a project is one extra clause in one
--  RLS policy: they may read `docs` row X. Done.
--
--  A sheet is not a row. It is an element of `docs.doc -> 'sheets'`, and the
--  document is read and written whole. Handing a friend the `docs` row so they
--  can see sheet 2 hands them sheets 1, 3 and 4 as well — silently, with no UI
--  anywhere admitting it. That is not a sharing feature; it is a disclosure
--  bug wearing a sharing feature's name.
--
--  0007 already built the address space: `public.blocks`, one row per block,
--  carrying `doc_id` and `sheet_id`. What it deliberately did NOT carry was
--  content — a `data` column would store every block twice and halve
--  everybody's quota overnight (0007's header argues this at length, and the
--  argument still holds).
--
--  So this migration takes the narrow version of that column:
--
--      `blocks.data` is populated ONLY for blocks a live share actually
--      reaches, and set back to NULL the moment that share is revoked.
--
--  A workspace with no shares stores exactly what it stored yesterday. A
--  workspace that shares one sheet duplicates that one sheet. The duplication
--  is bounded by the thing the user explicitly asked for, which is the only
--  kind of duplication worth paying for. `docs.doc` remains the single source
--  of truth; `blocks.data` is a projection of it maintained in the same
--  statement, exactly like `fingerprint`.
--
--  ── WHAT MATAS ASKED FOR THAT IS NOT HERE, AND WHY ─────────────────────────
--
--  "a setting in the sheet/project somewhere that lets you choose whether to
--  make it private or not"
--
--  PROJECT-level private works and is §2: a private project is invisible to
--  the rest of your organisation, visible to you and to anyone you grant it
--  to. SHEET-level private does NOT work and is not faked here. Hiding sheet 3
--  from a colleague who legitimately syncs the project means the client can no
--  longer push the project as one document — that is a rewrite of the sync
--  engine, not a permission. Sheet-level sharing OUTWARD is fully supported;
--  sheet-level hiding INWARD is refused rather than pretended.
--
--  ── THE RULE THIS FILE INHERITS ────────────────────────────────────────────
--
--  Everything that decides access is server-computed. `shares.org_id`,
--  `shares.created_by` and `shares.grantee_id` are stamped by a BEFORE trigger
--  from `auth.uid()` and from the document being shared — never from the
--  payload. 0005 §1 established this for `org_id`, 0007 for `edited_by`. A
--  client that can name the grantor can grant itself access.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.blocks') is null then
    raise exception '0007 has not been applied — public.blocks is missing.';
  end if;
  if to_regclass('public.organizations') is null then
    raise exception '0004 has not been applied — run it first.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  1. THE ORGANISATION'S SAY IN WHETHER ANYTHING LEAVES IT
-- ════════════════════════════════════════════════════════════════════════════
--
-- Three settings rather than a boolean, because "can members share?" has three
-- real answers and a boolean forces two of them together:
--
--   open      members may grant to anybody, inside the organisation or outside
--   internal  members may grant only to people already in the organisation.
--             Sheet- and block-level grants still work — this is how you give
--             one colleague one sheet without giving them the project — but
--             nothing crosses the tenant boundary.
--   off       no NEW grants. Existing grants keep working; revoking them is a
--             separate deliberate act. A switch that silently voids access
--             people are relying on is how you break a customer's morning.
alter table public.organizations
  add column if not exists sharing_policy text not null default 'open';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.organizations'::regclass
       and conname = 'organizations_sharing_policy_check'
  ) then
    alter table public.organizations
      add constraint organizations_sharing_policy_check
      check (sharing_policy in ('open', 'internal', 'off'));
  end if;
end $$;

comment on column public.organizations.sharing_policy is
  'open | internal | off. Whether members may create NEW shares. Never voids existing grants — 0008 §1.';

-- 0004 revoked table-wide UPDATE and granted exactly one column (`name`). This
-- is the second column, and it stays column-scoped for the same reason: the
-- "orgs renamable by admins" policy restricts WHO, the grant restricts WHAT,
-- and a policy is one careless `create policy` away from being loosened.
grant update (sharing_policy) on public.organizations to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  2. A PROJECT CAN BE PRIVATE FROM ITS OWN ORGANISATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- Default 'org' is exactly today's behaviour, so applying this file changes
-- nothing anybody can see until somebody flips a switch.
alter table public.docs
  add column if not exists visibility text not null default 'org';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.docs'::regclass and conname = 'docs_visibility_check'
  ) then
    alter table public.docs
      add constraint docs_visibility_check check (visibility in ('org', 'private'));
  end if;
end $$;

comment on column public.docs.visibility is
  'org | private. A private document is readable by its owner and by explicit grants only, not by the rest of the organisation. 0008 §2.';

-- THE CLAMP. Only the owner may move this, and the trigger refuses out loud
-- rather than silently restoring the old value: a privacy control that appears
-- to work and does not is worse than one that says no.
--
-- `docs_1_visibility` sorts after `docs_0_org_pin` and before
-- `docs_before_write`. BEFORE-ROW triggers fire in alphabetical order and that
-- ordering is load-bearing — 0005 §2 exists because it was got wrong once.
create or replace function public.docs_clamp_visibility()
returns trigger
language plpgsql
as $fn$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.visibility is distinct from old.visibility then
    -- actor IS NULL means the service role, a migration, or a definer function
    -- doing bookkeeping. Those are not the threat model and must not be blocked.
    if actor is not null and actor is distinct from old.owner_id then
      raise exception 'Only the owner of a project can change who can see it.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists docs_1_visibility on public.docs;
create trigger docs_1_visibility
  before insert or update on public.docs
  for each row execute function public.docs_clamp_visibility();

grant update (visibility) on public.docs to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  3. THE GRANT TABLE
-- ════════════════════════════════════════════════════════════════════════════
--
-- `doc_id` is NOT NULL for all three subject kinds, including block shares.
-- The block already knows its document, so this is denormalised — and it is
-- denormalised on purpose, because it lets every policy and every index below
-- reach the tenant without a join, the same argument 0007 made for
-- `blocks.org_id`.
create table if not exists public.shares (
  id           text primary key,

  -- The tenant the CONTENT belongs to, pinned from the document by trigger.
  -- Not the grantee's org: a share is an act by the owning side.
  org_id       text not null references public.organizations(id) on delete cascade,
  doc_id       text not null references public.docs(id) on delete cascade,

  subject_kind text not null check (subject_kind in ('doc', 'sheet', 'block')),
  -- Sheets are not rows, so a sheet is addressed by (doc_id, sheet_id). Blocks
  -- ARE rows as of 0007, so a block share carries a real foreign key and dies
  -- with the block.
  sheet_id     text,
  block_id     text references public.blocks(id) on delete cascade,

  -- EXACTLY ONE of these is meaningful at a time, and which one tells you
  -- whether the invite has been claimed. A grant to an address nobody has
  -- signed up with yet is a pending invite, not an error.
  grantee_id    uuid references auth.users(id) on delete cascade,
  grantee_email text,

  role         text not null default 'viewer' check (role in ('viewer', 'editor')),

  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- Soft revoke, never DELETE. Same reasoning as `docs.deleted_at` (0003):
  -- "who could see this, and until when" is a question somebody eventually
  -- has to answer, and a deleted row answers it with silence.
  revoked_at   timestamptz,

  constraint shares_subject_shape check (
    (subject_kind = 'doc'   and sheet_id is null     and block_id is null)
 or (subject_kind = 'sheet' and sheet_id is not null and block_id is null)
 or (subject_kind = 'block' and block_id is not null)
  ),
  constraint shares_has_grantee check (grantee_id is not null or grantee_email is not null)
);

comment on table public.shares is
  'One grant of one subject (project | sheet | block) to one person. Written by clients, but org_id / created_by / grantee_id are trigger-stamped. See 0008.';

-- The read path: "what has been shared with me". Partial, because a revoked
-- grant is dead weight in the index that answers every policy on every query.
create index if not exists shares_grantee_live_idx
  on public.shares (grantee_id) where revoked_at is null;

-- The write path: "who can see this document", for the share sheet UI.
create index if not exists shares_doc_idx on public.shares (doc_id);

-- Pending invites, resolved when the invitee signs up (§11).
create index if not exists shares_pending_email_idx
  on public.shares (lower(grantee_email))
  where revoked_at is null and grantee_id is null;

-- One live grant per (subject, person). Without this, "share" clicked twice
-- produces two rows, revoking one leaves the other, and the UI truthfully
-- reports that access was removed while it was not.
create unique index if not exists shares_one_live_per_subject
  on public.shares (doc_id, subject_kind, coalesce(sheet_id, ''), coalesce(block_id, ''),
                    coalesce(grantee_id::text, lower(grantee_email)))
  where revoked_at is null;


-- The content column lands here rather than in §6 where it is explained,
-- because §5's helpers read it and a `language sql` function is validated
-- against the catalogue at CREATE time, not at first call.
alter table public.blocks add column if not exists data jsonb;

comment on column public.blocks.data is
  'The block''s JSON, mirrored from docs.doc — and ONLY while a live sheet- or block-level share reaches it. NULL otherwise, which is the overwhelming majority of rows. 0008 §6.';

-- Partial: the only question ever asked of this column is "which blocks are
-- shared", and indexing the NULLs would mean indexing the whole table to find
-- the exception.
create index if not exists blocks_shared_idx on public.blocks (doc_id) where data is not null;


-- ════════════════════════════════════════════════════════════════════════════
--  4. WHAT THE CLIENT MAY SAY, AND WHAT THE SERVER DECIDES
-- ════════════════════════════════════════════════════════════════════════════
--
-- The client supplies: id, doc_id, subject_kind, sheet_id/block_id, role, and
-- an email. Everything else is computed here. In particular `grantee_id` is
-- resolved server-side from the email — a client that could set it directly
-- could grant access to an arbitrary uuid, which is every account in the
-- system, addressed by guessing.
create or replace function public.shares_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  actor    uuid := (select auth.uid());
  d        record;
  policy   text;
  resolved uuid;
begin
  if tg_op = 'UPDATE' then
    -- The ONLY mutable field. Everything else is pinned to what it was, so a
    -- PATCH that tries to widen `role` or re-point `doc_id` silently becomes a
    -- no-op rather than a privilege escalation.
    new.id            := old.id;
    new.org_id        := old.org_id;
    new.doc_id        := old.doc_id;
    new.subject_kind  := old.subject_kind;
    new.sheet_id      := old.sheet_id;
    new.block_id      := old.block_id;
    -- NULL → somebody is allowed; somebody → somebody else is not. That one
    -- transition IS the pending-invite claim in §11, and pinning it outright
    -- (the first draft did) makes every invitation to a not-yet-registered
    -- address permanently dead. Re-pointing stays impossible, and the client
    -- cannot reach this column anyway: its UPDATE grant covers `revoked_at`
    -- and nothing else.
    new.grantee_id    := coalesce(old.grantee_id, new.grantee_id);
    new.grantee_email := old.grantee_email;
    new.role          := old.role;
    new.created_by    := old.created_by;
    new.created_at    := old.created_at;
    -- revoked_at may only ever move from NULL to a time, and the time is ours.
    if new.revoked_at is not null and old.revoked_at is null then
      new.revoked_at := now();
    else
      new.revoked_at := old.revoked_at;
    end if;
    return new;
  end if;

  select id, org_id, owner_id into d from public.docs where id = new.doc_id;
  if d.id is null then
    raise exception 'That project no longer exists.' using errcode = 'foreign_key_violation';
  end if;

  new.org_id     := d.org_id;
  new.created_by := coalesce(actor, d.owner_id);
  new.created_at := now();
  new.revoked_at := null;

  -- A block share must name a block that really belongs to the named document.
  -- Without this a grant could point at somebody else's block id and the
  -- policy below would honour it.
  if new.subject_kind = 'block' then
    if not exists (select 1 from public.blocks b where b.id = new.block_id and b.doc_id = new.doc_id) then
      raise exception 'That block is not part of that project.' using errcode = 'foreign_key_violation';
    end if;
    select b.sheet_id into new.sheet_id from public.blocks b where b.id = new.block_id;
  end if;

  -- Resolve the invite. A miss is not an error: it is an invitation to
  -- somebody who has not signed up yet, and §11 claims it when they do.
  if new.grantee_id is null and new.grantee_email is not null then
    select p.id into resolved from public.profiles p
     where lower(p.email) = lower(new.grantee_email) limit 1;
    new.grantee_id := resolved;
  elsif new.grantee_id is not null then
    -- A client-supplied uuid is not trusted. It is accepted only when it also
    -- matches the email supplied alongside it, which makes it a hint rather
    -- than an authority.
    select p.id into resolved from public.profiles p
     where p.id = new.grantee_id
       and (new.grantee_email is null or lower(p.email) = lower(new.grantee_email))
     limit 1;
    if resolved is null then
      raise exception 'That person could not be found.' using errcode = 'foreign_key_violation';
    end if;
    new.grantee_id := resolved;
  end if;

  if new.grantee_id is not null and new.grantee_id = actor then
    raise exception 'You already have access to this.' using errcode = 'check_violation';
  end if;

  select o.sharing_policy into policy from public.organizations o where o.id = new.org_id;

  if policy = 'off' then
    raise exception 'Sharing is turned off for this workspace.' using errcode = 'insufficient_privilege';
  end if;

  if policy = 'internal' then
    if new.grantee_id is null
       or not exists (select 1 from public.org_members m
                       where m.org_id = new.org_id and m.user_id = new.grantee_id) then
      raise exception 'This workspace only allows sharing with its own members.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end $fn$;

drop trigger if exists shares_0_before_write on public.shares;
create trigger shares_0_before_write
  before insert or update on public.shares
  for each row execute function public.shares_before_write();


-- ════════════════════════════════════════════════════════════════════════════
--  5. THE ACCESS HELPERS
-- ════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER for the reason 0004 gives at length: `shares` has RLS of
-- its own, and a policy on `docs` that read `shares` directly would evaluate
-- that table's policy inside this one. A policy that reads a table that reads
-- it back is infinite recursion, reported as a stack-depth error at query time
-- rather than at migration time.
--
-- SET-RETURNING rather than boolean-per-row, so a policy reads
-- `id in (select ...)` — one hash join per query — instead of a function call
-- per candidate row. On a workspace with a few thousand blocks that is the
-- difference between a pull that feels instant and one that does not.

-- Documents granted to me WHOLE. A sheet or block grant does NOT appear here:
-- the whole point is that it must not hand over the document row.
create or replace function public.my_shared_doc_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select s.doc_id from public.shares s
   where s.revoked_at is null
     and s.subject_kind = 'doc'
     and s.grantee_id = (select auth.uid())
$fn$;

-- Blocks I can read through any grant, at any of the three levels.
create or replace function public.my_shared_block_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select b.id
    from public.blocks b
    join public.shares s on s.doc_id = b.doc_id
   where s.revoked_at is null
     and s.grantee_id = (select auth.uid())
     and ( s.subject_kind = 'doc'
        or (s.subject_kind = 'sheet' and s.sheet_id = b.sheet_id)
        or (s.subject_kind = 'block' and s.block_id  = b.id) )
$fn$;

-- Documents I may WRITE through a grant. Same shape as the read helper, and a
-- separate function for the same reason the read one exists: a policy that
-- reaches into `public.shares` itself is evaluated as the QUERYING role, which
-- means it needs SELECT on every column it names — including `grantee_id`,
-- which is deliberately withheld (§9). The first draft of this file inlined
-- the subquery and every editor's write died with "permission denied for table
-- shares". A definer is not a convenience here; it is the only spelling that
-- works.
create or replace function public.my_editable_doc_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select s.doc_id from public.shares s
   where s.revoked_at is null
     and s.subject_kind = 'doc'
     and s.role = 'editor'
     and s.grantee_id = (select auth.uid())
$fn$;

-- Blocks I may WRITE. Deliberately excludes doc-level grants: an editor on a
-- whole project edits it through `docs` like any collaborator, and letting the
-- same person write through two different paths means two different conflict
-- rules for one document.
create or replace function public.my_editable_block_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select b.id
    from public.blocks b
    join public.shares s on s.doc_id = b.doc_id
   where s.revoked_at is null
     and s.role = 'editor'
     and s.grantee_id = (select auth.uid())
     and ( (s.subject_kind = 'sheet' and s.sheet_id = b.sheet_id)
        or (s.subject_kind = 'block' and s.block_id  = b.id) )
$fn$;

-- Documents inside my own organisations that are NOT mine and are marked
-- private. Subtracted from the org-membership branch of every policy below.
create or replace function public.my_hidden_doc_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select d.id from public.docs d
   where d.visibility = 'private'
     and d.owner_id is distinct from (select auth.uid())
$fn$;

-- Assets reachable through a grant.
--
-- A doc-level grant carries every asset attached to the document. A sheet- or
-- block-level grant carries only the assets NAMED BY a block the grantee can
-- actually read — anything else would leak the images of sheets they were
-- never given, which is the same disclosure bug this whole file exists to
-- avoid, one level down.
create or replace function public.shared_asset_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select a.id
    from public.assets a
   where a.doc_id in (select public.my_shared_doc_ids())
  union
  select x.asset_id from (
    select coalesce(b.data ->> 'imageId', b.data ->> 'pdfId', b.data ->> 'fileId') as asset_id
      from public.blocks b
      join public.shares s on s.doc_id = b.doc_id
     where b.data is not null
       and s.revoked_at is null
       and s.grantee_id = (select auth.uid())
       and ( (s.subject_kind = 'sheet' and s.sheet_id = b.sheet_id)
          or (s.subject_kind = 'block' and s.block_id  = b.id) )
  ) x
   where x.asset_id is not null
$fn$;


-- ════════════════════════════════════════════════════════════════════════════
--  6. blocks.data — CONTENT, BUT ONLY WHERE A GRANT REACHES
-- ════════════════════════════════════════════════════════════════════════════
-- The column itself is declared at the end of §3, for a catalogue-ordering
-- reason explained there. This is the part that matters.
--
-- The maintainer. Two set-based statements whatever the document size — same
-- discipline as 0007 §3, and for the same reason: this runs on the hot save
-- path and a per-block loop would put a round trip per block inside a trigger.
--
-- QUOTA: these bytes are NOT metered. They are a duplicate of bytes already
-- counted once in `docs.bytes`, and charging a customer twice for choosing to
-- share is a product decision nobody would defend out loud. The exposure is
-- bounded by what has actually been shared, which is the reason the column is
-- narrow in the first place. If sharing ever becomes heavy this is the line to
-- revisit, and `blocks_shared_idx` makes the measurement a single index scan.
create or replace function public.sync_shared_block_data(target_doc text, doc_json jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if doc_json is null or jsonb_typeof(doc_json -> 'sheets') is distinct from 'array' then
    update public.blocks set data = null where doc_id = target_doc and data is not null;
    return;
  end if;

  -- 1. blocks a live grant reaches: mirror the content.
  update public.blocks tgt
     set data = ct.body
    from (
      select distinct on (b.value ->> 'id')
             b.value ->> 'id' as id,
             b.value          as body
        from jsonb_array_elements(doc_json -> 'sheets') s
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(s.value -> 'blocks') = 'array'
               then s.value -> 'blocks' else '[]'::jsonb end
        ) b
       where b.value ->> 'id' is not null
       order by b.value ->> 'id'
    ) ct
   where tgt.doc_id = target_doc
     and tgt.id = ct.id
     and tgt.data is distinct from ct.body
     and exists (
       select 1 from public.shares s
        where s.doc_id = target_doc
          and s.revoked_at is null
          and ( (s.subject_kind = 'sheet' and s.sheet_id = tgt.sheet_id)
             or (s.subject_kind = 'block' and s.block_id  = tgt.id) )
     );

  -- 2. blocks no grant reaches any more: drop the copy. This is what makes
  --    revocation real rather than cosmetic — the bytes leave with the access.
  update public.blocks tgt
     set data = null
   where tgt.doc_id = target_doc
     and tgt.data is not null
     and not exists (
       select 1 from public.shares s
        where s.doc_id = target_doc
          and s.revoked_at is null
          and ( (s.subject_kind = 'sheet' and s.sheet_id = tgt.sheet_id)
             or (s.subject_kind = 'block' and s.block_id  = tgt.id) )
     );
end $fn$;


-- ════════════════════════════════════════════════════════════════════════════
--  7. THE PROJECTION, REVISED
-- ════════════════════════════════════════════════════════════════════════════
--
-- Two changes to 0007's function, both small:
--
--   (a) it now maintains `data` by calling §6 at the end;
--   (b) it no longer runs for documents that are not notebooks.
--
-- (b) is a real bug fix, found while mapping the client. 0007's guard was
--     `jsonb_typeof(new.doc -> 'sheets') = 'array'`, and its comment claimed
--     that excluded everything but notebooks. It does not: an IMPORTED
--     WORKBOOK (`kind = 'sheetfile'`) also has a `sheets` array — a different
--     shape entirely, `{name, headers, rows}`, with no `id` and no `blocks`.
--     It projected zero rows so nothing was ever wrong in the data, but every
--     workbook save ran the full lateral scan and the tombstone DELETE for
--     nothing. And had that shape ever gained ids, every row would have landed
--     with a NULL sheet_id. The guard now says what it meant.
create or replace function public.project_blocks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  actor uuid := (select auth.uid());
begin
  -- Only notebooks have blocks. See (b) above.
  if new.kind is distinct from 'notebook' then
    return null;
  end if;

  if new.doc is null or jsonb_typeof(new.doc -> 'sheets') is distinct from 'array' then
    -- A notebook that lost its sheets (or was tombstoned into an empty doc)
    -- must lose its block rows too, or the flags outlive the blocks.
    delete from public.blocks b where b.doc_id = new.id;
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
    -- THE WHOLE POINT. The stamp moves only when the block itself changed, so
    -- "Mara edited this" means she edited THIS, not that she saved a document
    -- that happens to contain it.
    edited_by = case when public.blocks.fingerprint is distinct from excluded.fingerprint
                     then excluded.edited_by else public.blocks.edited_by end,
    edited_at = case when public.blocks.fingerprint is distinct from excluded.fingerprint
                     then excluded.edited_at else public.blocks.edited_at end;

  -- Tombstone blocks that are no longer in the document.
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

  perform public.sync_shared_block_data(new.id, new.doc);
  return null;
end $fn$;


-- A grant appearing or disappearing changes which blocks carry content, and no
-- document write is involved — so the shares table has to drive the same
-- maintainer. AFTER, because a refused insert must not leave content behind.
create or replace function public.shares_resync_data()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  target text := coalesce(new.doc_id, old.doc_id);
  body   jsonb;
begin
  select d.doc into body from public.docs d where d.id = target;
  perform public.sync_shared_block_data(target, body);
  return null;
end $fn$;

drop trigger if exists shares_sync_data on public.shares;
create trigger shares_sync_data
  after insert or update or delete on public.shares
  for each row execute function public.shares_resync_data();


-- ════════════════════════════════════════════════════════════════════════════
--  8. AN EDITOR'S WRITE, AND HOW IT GETS BACK INTO THE DOCUMENT
-- ════════════════════════════════════════════════════════════════════════════
--
-- A friend granted `editor` on one sheet writes `blocks.data`. That is the
-- only column they can touch (see the grant below — 0007 revoked UPDATE
-- entirely and this re-opens exactly one column). Their write then has to
-- reach `docs.doc`, or the owner never sees it.
--
-- ── THE RECURSION, AND THE ONE LINE THAT STOPS IT ──────────────────────────
--
-- blocks UPDATE → reverse projection → docs UPDATE → project_blocks() →
-- blocks UPDATE → ... forever.
--
-- `pg_trigger_depth()` cuts it exactly once and in the right place: a client
-- write arrives at depth 1, the docs update it causes runs project_blocks at
-- depth 2, and the blocks writes THAT causes arrive at depth 3, where both
-- triggers below return immediately. Nothing is skipped, because by then
-- project_blocks has already recomputed the fingerprint and the stamp from the
-- document it just wrote.
create or replace function public.blocks_clamp_client_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if pg_trigger_depth() > 1 then
    return new;   -- our own projection; already correct
  end if;

  -- Belt for the column grant's braces. If a future migration widens the grant
  -- by accident, this still refuses to let anything but content move.
  new.id          := old.id;
  new.doc_id      := old.doc_id;
  new.org_id      := old.org_id;
  new.sheet_id    := old.sheet_id;
  new.kind        := old.kind;
  new.created_at  := old.created_at;

  if new.data is null then
    raise exception 'A shared block edit has to carry the block.'
      using errcode = 'check_violation';
  end if;

  -- Recomputed, never accepted. `fingerprint` is what decides whether the
  -- attribution stamp moves, so a client that could set it could edit a block
  -- and leave somebody else's name on it.
  new.fingerprint := md5(new.data::text);
  new.edited_by   := (select auth.uid());
  new.edited_at   := now();
  return new;
end $fn$;

drop trigger if exists blocks_0_clamp on public.blocks;
create trigger blocks_0_clamp
  before update on public.blocks
  for each row execute function public.blocks_clamp_client_write();


create or replace function public.reverse_project_block()
returns trigger
language plpgsql
security definer          -- the editor has no write policy on `docs`; this does
set search_path = public, pg_temp
as $fn$
declare
  si int;
  bi int;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.data is null or new.data is not distinct from old.data then return null; end if;

  -- Locate the block inside the document by id rather than by any stored
  -- index. Indexes move every time a block is added or removed, and a stale
  -- one would write the edit over an unrelated block.
  select s.ord - 1, b.ord - 1 into si, bi
    from public.docs d
    cross join lateral jsonb_array_elements(d.doc -> 'sheets') with ordinality as s(value, ord)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.value -> 'blocks') = 'array'
           then s.value -> 'blocks' else '[]'::jsonb end
    ) with ordinality as b(value, ord)
   where d.id = new.doc_id
     and b.value ->> 'id' = new.id
   limit 1;

  if si is null then return null; end if;

  -- This bumps `rev` through docs_before_write, which is exactly what makes
  -- the owner's client notice: it sees a revision it did not write and pulls.
  update public.docs
     set doc = jsonb_set(doc, array['sheets', si::text, 'blocks', bi::text], new.data, false)
   where id = new.doc_id;

  return null;
end $fn$;

drop trigger if exists blocks_reverse_project on public.blocks;
create trigger blocks_reverse_project
  after update of data on public.blocks
  for each row execute function public.reverse_project_block();

-- Exactly one column, to exactly one role. Everything else on this table stays
-- as 0007 left it: written by triggers, by nobody else.
grant update (data) on public.blocks to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  9. THE POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- ── docs ───────────────────────────────────────────────────────────────────
drop policy if exists "docs select" on public.docs;
create policy "docs select" on public.docs
  for select using (
    (
      org_id in (select public.my_org_ids())
      and id not in (select public.my_hidden_doc_ids())
    )
    or id in (select public.my_shared_doc_ids())
  );

-- A doc-level EDITOR may write the document. A doc-level VIEWER may not, and
-- neither may a sheet- or block-level grantee at any role — their writes go
-- through `blocks.data` and the reverse projection in §8.
drop policy if exists "docs update" on public.docs;
create policy "docs update" on public.docs
  for update using (
    ( public.has_org_role(org_id, array['owner','admin','member'])
      and id not in (select public.my_hidden_doc_ids()) )
    or id in (select public.my_editable_doc_ids())
  )
  with check (
    ( public.has_org_role(org_id, array['owner','admin','member'])
      and id not in (select public.my_hidden_doc_ids()) )
    or id in (select public.my_editable_doc_ids())
  );

-- ── blocks ─────────────────────────────────────────────────────────────────
drop policy if exists "blocks readable by members" on public.blocks;
drop policy if exists "blocks readable" on public.blocks;
create policy "blocks readable" on public.blocks
  for select using (
    (
      org_id in (select public.my_org_ids())
      and doc_id not in (select public.my_hidden_doc_ids())
    )
    or id in (select public.my_shared_block_ids())
  );

drop policy if exists "blocks editable by grant" on public.blocks;
create policy "blocks editable by grant" on public.blocks
  for update using  (id in (select public.my_editable_block_ids()))
          with check (id in (select public.my_editable_block_ids()));

-- ── assets ─────────────────────────────────────────────────────────────────
drop policy if exists "assets select" on public.assets;
create policy "assets select" on public.assets
  for select using (
    org_id in (select public.my_org_ids())
    or id in (select public.shared_asset_ids())
  );

-- ── storage ────────────────────────────────────────────────────────────────
-- Read only. A grantee never writes or deletes objects: their edits are block
-- content, and an image is immutable source bytes plus an overlay (0003 §5).
drop policy if exists "ds assets read" on storage.objects;
create policy "ds assets read" on storage.objects
  for select using (
    bucket_id = 'ds-assets'
    and (
      public.is_org_member((storage.foldername(name))[1])
      or (storage.foldername(name))[1] = (select auth.uid())::text   -- legacy, pre-0004
      or name in (select a.path from public.assets a
                   where a.id in (select public.shared_asset_ids()))
    )
  );

-- ── shares ─────────────────────────────────────────────────────────────────
alter table public.shares enable row level security;

drop policy if exists "shares readable" on public.shares;
create policy "shares readable" on public.shares
  for select using (
    created_by = (select auth.uid())
    or grantee_id = (select auth.uid())
    or public.has_org_role(org_id, array['owner','admin'])
  );

-- You may grant what you may write. `has_org_role` is the same test the docs
-- update policy uses, so "can share" and "can edit" cannot drift apart.
drop policy if exists "shares insertable" on public.shares;
create policy "shares insertable" on public.shares
  for insert with check (
    public.has_org_role(org_id, array['owner','admin','member'])
    and doc_id not in (select public.my_hidden_doc_ids())
  );

-- Revoke. The trigger in §4 has already pinned every other column, so this
-- policy only has to decide WHO may revoke, not what they may change.
drop policy if exists "shares revocable" on public.shares;
create policy "shares revocable" on public.shares
  for update using (
    created_by = (select auth.uid())
    or public.has_org_role(org_id, array['owner','admin'])
  )
  with check (
    created_by = (select auth.uid())
    or public.has_org_role(org_id, array['owner','admin'])
  );

-- No DELETE policy and no DELETE grant: a grant is revoked, never erased.
-- "Who could see this, and until when" has to stay answerable.
revoke all on public.shares from anon, authenticated;

-- THE ENUMERATION ORACLE, AND WHY THESE GRANTS ARE COLUMN-BY-COLUMN.
--
-- The obvious spelling is `grant select on public.shares` followed by
-- `revoke select (grantee_id)`. That does NOTHING. Column privileges in
-- Postgres are ADDITIVE to table privileges — a revoke aimed at one column of
-- a table-wide grant is silently a no-op, in exactly the way 0004's
-- `revoke ... from anon` was a no-op against PUBLIC's implicit grant. Both
-- mistakes read as defence and are decoration. The only way to withhold a
-- column is never to grant the table.
--
-- Why withhold it at all: share to an address, read `grantee_id` back, and a
-- non-NULL answer tells you that address has an account here. One row per
-- guess, at API speed. Resolution happens in §4's trigger and the policies
-- match the column server-side, so nothing needs the client to see it.
--
-- CONSEQUENCE FOR THE CLIENT: `select=*` on this table is a permission error.
-- lib/shares.js names its columns, always. That is deliberate friction.
grant select (id, org_id, doc_id, subject_kind, sheet_id, block_id,
              grantee_email, role, created_by, created_at, revoked_at)
  on public.shares to authenticated;

-- INSERT is column-scoped for the same reason it is on `docs`: the columns a
-- client may name are the columns it may name, rather than the columns a
-- trigger happens to overwrite today.
grant insert (id, doc_id, subject_kind, sheet_id, block_id, grantee_email, role)
  on public.shares to authenticated;

grant update (revoked_at) on public.shares to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  10. USAGE BOOKKEEPING WAS O(rows), NOT O(statements)
-- ════════════════════════════════════════════════════════════════════════════
--
-- `docs_usage_trigger` was AFTER ... FOR EACH ROW, and its function calls
-- `recompute_usage_org`, which takes a transaction-scoped advisory lock and
-- recomputes the ENTIRE tenant from source tables. A fifty-row insert
-- therefore ran fifty full recomputes of the same organisation, serialised
-- behind the same lock, to arrive at the answer the last one would have given
-- anyway.
--
-- Statement-level triggers with transition tables collapse that to one
-- recompute per affected organisation per statement. Three triggers rather
-- than one because Postgres allows OLD TABLE and NEW TABLE together only on
-- UPDATE — INSERT has no OLD, DELETE has no NEW.
create or replace function public.trg_recompute_usage_org_stmt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  o text;
begin
  for o in select distinct org_id from touched where org_id is not null loop
    perform public.recompute_usage_org(o);
  end loop;
  return null;
end $fn$;

-- `touched` is supplied by each trigger's REFERENCING clause, so one function
-- serves four of the six. plpgsql resolves the name at execution time, which
-- is why a function can be created against a table that does not exist yet.
drop trigger if exists docs_usage_trigger    on public.docs;
drop trigger if exists assets_usage_trigger  on public.assets;

drop trigger if exists docs_usage_ins   on public.docs;
drop trigger if exists docs_usage_upd   on public.docs;
drop trigger if exists docs_usage_del   on public.docs;
drop trigger if exists assets_usage_ins on public.assets;
drop trigger if exists assets_usage_upd on public.assets;
drop trigger if exists assets_usage_del on public.assets;

create trigger docs_usage_ins after insert on public.docs
  referencing new table as touched
  for each statement execute function public.trg_recompute_usage_org_stmt();
create trigger docs_usage_del after delete on public.docs
  referencing old table as touched
  for each statement execute function public.trg_recompute_usage_org_stmt();

create trigger assets_usage_ins after insert on public.assets
  referencing new table as touched
  for each statement execute function public.trg_recompute_usage_org_stmt();
create trigger assets_usage_del after delete on public.assets
  referencing old table as touched
  for each statement execute function public.trg_recompute_usage_org_stmt();

-- UPDATE needs both sides: a row whose org_id moved has to decrement the old
-- tenant as well as increment the new one. `own_org_id()` pins org_id on
-- update so it should never move — "should never" is not "cannot", and this
-- costs one extra scan of a transition table that is already in memory.
create or replace function public.trg_recompute_usage_org_upd()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  o text;
begin
  for o in
    select distinct org_id from (
      select org_id from touched_new
      union
      select org_id from touched_old
    ) t where org_id is not null
  loop
    perform public.recompute_usage_org(o);
  end loop;
  return null;
end $fn$;

create trigger docs_usage_upd after update on public.docs
  referencing new table as touched_new old table as touched_old
  for each statement execute function public.trg_recompute_usage_org_upd();
create trigger assets_usage_upd after update on public.assets
  referencing new table as touched_new old table as touched_old
  for each statement execute function public.trg_recompute_usage_org_upd();


-- ════════════════════════════════════════════════════════════════════════════
--  11. A PENDING INVITE BECOMES A REAL ONE WHEN ITS OWNER SIGNS UP
-- ════════════════════════════════════════════════════════════════════════════
--
-- On `public.profiles`, NOT on `auth.users`. `handle_new_user` is the single
-- most dangerous function in this database — it has broken signup twice, and
-- 0005 §11 had to repair it — so this does not touch it. profiles is created
-- BY that function and carries the email, which makes it the correct and much
-- cheaper attachment point.
create or replace function public.claim_pending_shares()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.email is null then return null; end if;
  update public.shares
     set grantee_id = new.id
   where grantee_id is null
     and revoked_at is null
     and lower(grantee_email) = lower(new.email);
  return null;
end $fn$;

drop trigger if exists profiles_claim_shares on public.profiles;
create trigger profiles_claim_shares
  after insert on public.profiles
  for each row execute function public.claim_pending_shares();


-- ════════════════════════════════════════════════════════════════════════════
--  12. THE DEFINER SURFACE, RE-CLOSED
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0006 made this an invariant rather than a list, precisely so that a later
-- migration adding SECURITY DEFINER functions could not quietly reopen the
-- hole. This file adds nine of them. Re-running the sweep is what the
-- invariant is for.
do $$
declare
  fn record;
  keep_for_authenticated text[] := array[
    'is_org_member', 'has_org_role', 'org_plan', 'my_org_ids', 'my_account', 'default_org',
    -- new in 0008, all called from inside RLS policies, which are evaluated as
    -- the QUERYING role — revoking these locks every signed-in user out.
    'my_shared_doc_ids', 'my_shared_block_ids', 'my_editable_block_ids',
    'my_hidden_doc_ids', 'shared_asset_ids', 'my_editable_doc_ids'
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
--  13. SELF-TEST
-- ════════════════════════════════════════════════════════════════════════════
--
-- Structural only. The behavioural proof — a grantee reading exactly one sheet
-- and no more, an editor's write reaching docs.doc, a revoke taking the bytes
-- with it — lives in supabase/test/02_sharing_checks.sql, which can set
-- request.jwt.claims and therefore actually be two different people.
do $$
declare
  n int;
begin
  if to_regclass('public.shares') is null then
    raise exception '0008: shares table missing';
  end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'blocks' and column_name = 'data';
  if n <> 1 then raise exception '0008: blocks.data missing'; end if;

  -- The client may write exactly one column of `blocks`, and exactly two of
  -- `shares`. Anything else means a grant went in wider than intended.
  select count(*) into n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'blocks'
     and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if n <> 1 then
    raise exception '0008: blocks has % client-updatable column(s), expected exactly 1 (data)', n;
  end if;

  select count(*) into n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'shares'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if n = 0 then
    raise exception '0008: shares is not readable by authenticated at all';
  end if;

  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'shares'
       and grantee in ('authenticated', 'anon')
       and column_name = 'grantee_id' and privilege_type = 'SELECT'
  ) then
    raise exception '0008: shares.grantee_id is client-readable — that is an account-enumeration oracle';
  end if;

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'shares'
     and grantee in ('anon', 'authenticated') and privilege_type = 'DELETE';
  if n > 0 then raise exception '0008: shares is client-deletable; grants must be revoked, not erased'; end if;

  -- The lockout check, same shape as 0006 §3. If a policy helper lost EXECUTE
  -- for `authenticated`, every signed-in read fails.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('is_org_member','has_org_role','org_plan','my_org_ids',
                       'my_shared_doc_ids','my_shared_block_ids','my_editable_block_ids',
                       'my_hidden_doc_ids','shared_asset_ids','my_editable_doc_ids')
     and array_to_string(coalesce(p.proacl, '{}'), ',') not like '%authenticated=X%';
  if n > 0 then
    raise exception '0008: % policy helper(s) are not executable by authenticated — every signed-in query would fail', n;
  end if;

  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and array_to_string(coalesce(p.proacl, '{}'), ',') like '=X/%';
  if n > 0 then raise exception '0008: % SECURITY DEFINER function(s) are PUBLIC-executable', n; end if;

  -- The usage triggers must be statement-level now, or §10 did nothing.
  select count(*) into n from pg_trigger
   where tgrelid in ('public.docs'::regclass, 'public.assets'::regclass)
     and not tgisinternal
     and tgname like '%usage%'
     and (tgtype & 1) = 1;          -- bit 0 set = FOR EACH ROW
  if n > 0 then
    raise exception '0008: % usage trigger(s) are still FOR EACH ROW', n;
  end if;

  raise notice '0008: sharing in place — 3 levels, private projects, org policy, statement-level usage.';
end $$;

commit;
