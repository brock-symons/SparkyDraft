/*
  Phase 2: sharing a personal project into an organization so every member
  can see it from a separate "Organization" tab in the project picker.

  This is a snapshot, not a live link -- sharing copies the project's
  current data into organization_projects. Re-sharing the same project
  name updates that snapshot (see the unique constraint below).

  Note: this does NOT yet enforce view-only access for non-owners -- any
  org member who opens a shared project can currently edit it, same as
  the person who shared it. Locking that down per project/per member is
  a later phase.

  Run this once in Supabase -> SQL Editor -> New query -> paste -> Run.
  Requires supabase-organizations.sql to already be applied (uses its
  is_org_member/is_org_admin helper functions). Safe to re-run.
*/

create table if not exists public.organization_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  data jsonb not null,
  shared_by uuid not null references auth.users(id) on delete cascade,
  shared_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

alter table public.organization_projects enable row level security;

drop policy if exists "Org members can view shared projects" on public.organization_projects;
create policy "Org members can view shared projects"
  on public.organization_projects for select
  using (public.is_org_member(org_id));

drop policy if exists "Org members can share a project" on public.organization_projects;
create policy "Org members can share a project"
  on public.organization_projects for insert
  with check (public.is_org_member(org_id) and shared_by = auth.uid());

drop policy if exists "Sharer or admin can update a shared project" on public.organization_projects;
create policy "Sharer or admin can update a shared project"
  on public.organization_projects for update
  using (shared_by = auth.uid() or public.is_org_admin(org_id));

drop policy if exists "Sharer or admin can remove a shared project" on public.organization_projects;
create policy "Sharer or admin can remove a shared project"
  on public.organization_projects for delete
  using (shared_by = auth.uid() or public.is_org_admin(org_id));
