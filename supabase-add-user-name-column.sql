/*
  Adds a user_name column to the projects table so the Table Editor
  shows a readable name instead of just the user_id UUID.
  Also backfills it for any projects already saved before this column
  existed, using each account's name (or email if no name was set).
*/

alter table public.projects
  add column if not exists user_name text;

update public.projects p
set user_name = coalesce(u.raw_user_meta_data ->> 'full_name', u.email)
from auth.users u
where u.id = p.user_id
  and p.user_name is null;
