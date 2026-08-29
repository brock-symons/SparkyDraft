/*
  Fixes cloud project saves being keyed by name instead of a stable id.

  The app used to upsert a saved project by (user_id, name) -- so two
  projects with the same name (e.g. every new project defaults to
  "New Project") would silently overwrite each other in the cloud, and
  renaming a project would fork a second cloud row instead of updating
  the existing one in place. The app now generates a stable id for every
  project and upserts by that id instead, so this constraint needs to go
  -- two projects are allowed to share a name now, same as they always
  could on your own device.

  Run this once in Supabase -> SQL Editor -> New query -> paste -> Run.
  Safe to re-run. Existing rows and their data are untouched; this only
  changes what's enforced going forward.
*/

alter table public.projects drop constraint if exists projects_user_id_name_key;
