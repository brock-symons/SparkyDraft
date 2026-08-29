/*
  Phase 3: per-project view/edit permissions on top of organization_projects.

  Default for any org member is view-only. A row in here upgrades one
  specific member to 'editor' on one specific shared project. The project's
  original sharer and any org admin are always editors -- they never need a
  row here (checked in code and in the RLS policy below via
  can_manage_org_project / is_org_admin).

  Run this once in Supabase -> SQL Editor -> New query -> paste -> Run.
  Requires supabase-organizations.sql and supabase-organization-projects.sql
  to already be applied. Safe to re-run.
*/

create table if not exists public.organization_project_access (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.organization_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor')),
  granted_by uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  unique (project_id, user_id)
);

alter table public.organization_project_access enable row level security;

/* Only the project's sharer or an org admin can grant/see/revoke access
   grants on that project -- same rule the update policy below reuses so a
   granted editor can actually save changes back to the shared project. */
create or replace function public.can_manage_org_project(_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_projects
    where id = _project_id
      and (shared_by = auth.uid() or public.is_org_admin(org_id))
  );
$$;

/* Same as is_org_member/is_org_admin: only meant to be called from inside
   other RLS policies, but create/replace grants execute to PUBLIC (which
   anon inherits) by default. Locked down per the security advisor. */
revoke execute on function public.can_manage_org_project(uuid) from public, anon;
grant execute on function public.can_manage_org_project(uuid) to authenticated;

drop policy if exists "Managers and the member can view an access grant" on public.organization_project_access;
create policy "Managers and the member can view an access grant"
  on public.organization_project_access for select
  using (public.can_manage_org_project(project_id) or user_id = auth.uid());

drop policy if exists "Managers can grant access" on public.organization_project_access;
create policy "Managers can grant access"
  on public.organization_project_access for insert
  with check (public.can_manage_org_project(project_id) and granted_by = auth.uid());

drop policy if exists "Managers can change access" on public.organization_project_access;
create policy "Managers can change access"
  on public.organization_project_access for update
  using (public.can_manage_org_project(project_id));

drop policy if exists "Managers can revoke access" on public.organization_project_access;
create policy "Managers can revoke access"
  on public.organization_project_access for delete
  using (public.can_manage_org_project(project_id));

/* Let a granted editor actually save changes back to the shared project,
   not just the sharer/admin. */
drop policy if exists "Sharer or admin can update a shared project" on public.organization_projects;
drop policy if exists "Sharer, admin, or granted editor can update a shared project" on public.organization_projects;
create policy "Sharer, admin, or granted editor can update a shared project"
  on public.organization_projects for update
  using (
    shared_by = auth.uid()
    or public.is_org_admin(org_id)
    or exists (
      select 1 from public.organization_project_access
      where project_id = organization_projects.id and user_id = auth.uid() and role = 'editor'
    )
  );
