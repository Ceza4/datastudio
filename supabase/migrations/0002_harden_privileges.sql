-- =============================================================================
-- DataStudio — privilege hardening (follows 0001_init.sql)
-- =============================================================================
-- WHY THIS EXISTS
--   0001 secured *rows* — every policy asks "is this your row?" and answers
--   correctly. None of them ask "are you allowed to change this particular
--   column?" RLS cannot express that; column-level GRANTs are the mechanism.
--   Without them, `for all using (auth.uid() = owner_id)` hands the client
--   write access to every column of every row it owns — including the ones
--   that decide what the user is entitled to and what they get billed for.
--
--   Run this in the SQL Editor the same way as 0001. Safe to re-run.
-- =============================================================================


-- ── 1. profiles.plan must not be client-writable ────────────────────────────
-- Before this: `update profiles set plan = 'team' where id = auth.uid()` from
-- the browser console is a legal write under the "own profile" policy — it IS
-- their own row. Free Team tier for anyone who opens devtools.
--
-- NOTE ON THE REVOKE/GRANT PAIR: revoking a *column* privilege out of a
-- table-wide grant is a silent no-op in Postgres. The table-level UPDATE has
-- to come off first, then the safe columns get granted back individually.
-- `revoke update (plan) ...` on its own would look like it worked and change
-- nothing.
revoke update on public.profiles from anon, authenticated;
grant  update (email, display_name) on public.profiles to authenticated;

-- Profile rows are created exclusively by handle_new_user() (security
-- definer, so it is unaffected by these grants). A client never needs to
-- insert one, and deleting one would orphan the account from its plan with
-- no trigger left to recreate it.
revoke insert, delete on public.profiles from anon, authenticated;


-- ── 2. notebooks.bytes must be computed, not asserted ───────────────────────
-- recompute_usage() sums notebooks.bytes. That column arrives from the
-- client, so `bytes = 0` on every write makes metered usage permanently zero.
-- lib/limits.js has ENFORCE = false today, which is the only reason this
-- isn't already exploitable — the number it will eventually enforce against
-- is attacker-supplied.
--
-- A BEFORE trigger overwrites whatever the client sent, which is why no
-- grant surgery is needed here: the column stays writable and the value is
-- simply discarded. Fires before notebooks_usage_trigger (BEFORE row
-- triggers always precede AFTER row triggers), so usage recomputes from the
-- corrected figure.
create or replace function public.set_notebook_bytes()
returns trigger
language plpgsql
as $fn$
begin
  new.bytes := octet_length(new.doc::text);
  return new;
end;
$fn$;

drop trigger if exists notebooks_set_bytes on public.notebooks;
create trigger notebooks_set_bytes
  before insert or update on public.notebooks
  for each row execute function public.set_notebook_bytes();


-- ── 3. images: close the same hole, and fix the trigger asymmetry ───────────
-- The images manifest is append-only by design: a row describes a blob that
-- already exists in Storage. Nothing legitimate updates one.
revoke update on public.images from anon, authenticated;

-- 0001's images_usage_trigger fired on `insert or delete` while the comment
-- above it claimed "fires on every write" and the notebooks equivalent
-- included `update`. Aligned here so a server-side size correction actually
-- recomputes usage.
drop trigger if exists images_usage_trigger on public.images;
create trigger images_usage_trigger
  after insert or update or delete on public.images
  for each row execute function public.trg_recompute_usage_images();

-- images.bytes on INSERT is still client-asserted: nothing stops a client
-- uploading 10 MB to Storage and then inserting a manifest row claiming 4 KB.
-- The authoritative size lives on the storage object itself, so read it from
-- there when it's available.
--
-- ORDERING DEPENDENCY — READ BEFORE RELYING ON THIS: it only corrects the
-- value if the object has already been uploaded when the manifest row is
-- inserted. Image upload is plan step 5 and isn't built yet; whoever builds
-- it must upload first, then insert the manifest, or this silently falls back
-- to trusting the client. The fallback is deliberate (a manifest insert must
-- not hard-fail on a missing object mid-rollout) and is therefore the thing
-- to re-check once uploads exist.
create or replace function public.set_image_bytes()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $fn$
declare
  real_size bigint;
begin
  select (o.metadata->>'size')::bigint
    into real_size
    from storage.objects o
   where o.bucket_id = 'notebook-images'
     and o.name = new.path;

  if real_size is not null then
    new.bytes := real_size;
  end if;

  return new;
end;
$fn$;

drop trigger if exists images_set_bytes on public.images;
create trigger images_set_bytes
  before insert or update on public.images
  for each row execute function public.set_image_bytes();


-- ── 4. usage stays read-only to clients (already true in 0001) ──────────────
-- Stated here only so the invariant is greppable: `usage` has RLS enabled and
-- exactly one policy, "read own usage" (for select). No insert/update/delete
-- policy exists, and under RLS an absent policy is a denial — so the table is
-- unwritable by any client regardless of the grants Supabase applies by
-- default to `authenticated`. The triggers in 0001 write it as security
-- definer and bypass RLS. Don't add a broader policy here without re-reading
-- this comment.
