-- Fixes cloud project saves being keyed by name instead of a stable id.
-- The app used to upsert a saved project by (user_id, name), so two
-- projects with the same name would silently overwrite each other in
-- the cloud. It now upserts by a stable id instead, so this old
-- uniqueness constraint needs to go. Safe to re-run.
--
-- Run this once in Supabase -> SQL Editor -> New query -> paste -> Run.

alter table public.projects drop constraint if exists projects_user_id_name_key;
