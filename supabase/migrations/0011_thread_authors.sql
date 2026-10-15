-- ============================================================================
--  0011_thread_authors.sql
--
--  NAMES FOR THE PEOPLE WHO HAVE SPOKEN IN A CONVERSATION.
--
--  A message carries its author's account id (0009 grants SELECT on
--  author_id), but `profiles` is readable only inside your own organisation,
--  so a friend from another workspace rendered as "Someone" in every bubble.
--  This returns a name for each person who has WRITTEN in a thread you are
--  in — nobody else, so it reveals nothing the messages did not: 0010's rule
--  that an account is shown only once its owner takes part still holds.
-- ============================================================================

begin;

create or replace function public.chat_thread_authors(p_thread text)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select distinct p.id, coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1))
    from public.chat_messages x
    join public.profiles p on p.id = x.author_id
   where x.thread_id = p_thread
     and p_thread in (select public.my_thread_ids())
$fn$;

revoke all on function public.chat_thread_authors(text) from public, anon;
grant execute on function public.chat_thread_authors(text) to authenticated;

commit;
