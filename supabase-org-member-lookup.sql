/*
  Lets an org admin check whether an email belongs to an existing Sparky
  Draft account before adding them to the organization. auth.users isn't
  directly readable by normal client queries, so this is a small
  security definer function that looks it up on the caller's behalf and
  returns only what's needed (id + display name) -- never the full user
  record, and never usable by signed-out visitors.

  Run this once in Supabase -> SQL Editor -> New query -> paste -> Run.
  Safe to re-run.
*/

create or replace function public.find_user_by_email(p_email text)
returns table(id uuid, user_name text)
language sql
security definer
set search_path = public
stable
as $$
  select id, coalesce(raw_user_meta_data->>'full_name', '') as user_name
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;
$$;

revoke execute on function public.find_user_by_email(text) from public, anon;
grant execute on function public.find_user_by_email(text) to authenticated;
