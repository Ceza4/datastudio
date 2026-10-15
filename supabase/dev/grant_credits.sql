-- ============================================================================
--  supabase/dev/grant_credits.sql — give an account agent credits by hand
--
--  Until payments are connected, this is how top-ups happen. Run it in the
--  Supabase SQL editor (which runs as the service role). Edit the two values.
--
--  Monthly credits come from the plan (Pro 1,500 / Max 5,000) and need no
--  grant — set the plan with supabase/dev/set_plan.sql. This adds TOP-UP
--  credits on top, which carry over month to month.
-- ============================================================================

do $$
declare
  target_email text := 'you@example.com';   -- ← the account
  credits      int  := 1000;                -- ← how many (1 credit = €0.01)
  uid uuid;
  result jsonb;
begin
  select id into uid from auth.users where lower(email) = lower(target_email);
  if uid is null then raise exception 'No account with the address %', target_email; end if;
  result := public.ai_grant_credits('org_' || uid::text, credits);
  raise notice 'Granted % credits to %. Balance now: %', credits, target_email, result;
end $$;
