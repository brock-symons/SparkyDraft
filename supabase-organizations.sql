/*
  Phase 1: organizations + invites.

  Run this once in Supabase -> SQL Editor -> New query -> paste -> Run,
  the same way as the earlier setup scripts. Safe to re-run.

  This does NOT yet change project sharing/permissions -- that's project_access,
  added in a later phase. This just lets people create an organization,
  invite others by email, and see who's in it.
*/

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;

/* organizations: any member can view it; only the creator can rename/delete it */
drop policy if exists "Members can view their organization" on public.organizations;
create policy "Members can view their organization"
  on public.organizations for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.organization_members m
      where m.org_id = organizations.id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Anyone signed in can create an organization" on public.organizations;
create policy "Anyone signed in can create an organization"
  on public.organizations for insert
  with check (created_by = auth.uid());

drop policy if exists "Creator can update their organization" on public.organizations;
create policy "Creator can update their organization"
  on public.organizations for update
  using (created_by = auth.uid());

drop policy if exists "Creator can delete their organization" on public.organizations;
create policy "Creator can delete their organization"
  on public.organizations for delete
  using (created_by = auth.uid());

/* organization_members: any member of an org can see the other members of
   that same org (this is the standard "self-referencing EXISTS" pattern for
   membership tables -- it is not recursive, it just checks "is the current
   user also a row in this table for the same org") */
drop policy if exists "Members can view other members of their org" on public.organization_members;
create policy "Members can view other members of their org"
  on public.organization_members for select
  using (
    exists (
      select 1 from public.organization_members m2
      where m2.org_id = organization_members.org_id and m2.user_id = auth.uid()
    )
  );

drop policy if exists "Org admins can add members" on public.organization_members;
create policy "Org admins can add members"
  on public.organization_members for insert
  with check (
    exists (
      select 1 from public.organizations o
      where o.id = org_id and o.created_by = auth.uid()
    )
    or exists (
      select 1 from public.organization_members m2
      where m2.org_id = organization_members.org_id and m2.user_id = auth.uid() and m2.role = 'admin'
    )
    or user_id = auth.uid()
  );

drop policy if exists "Org admins can remove members" on public.organization_members;
create policy "Org admins can remove members"
  on public.organization_members for delete
  using (
    exists (
      select 1 from public.organizations o
      where o.id = org_id and o.created_by = auth.uid()
    )
    or user_id = auth.uid()
  );

/* organization_invites: org admins manage invites for their org; anyone can
   see (and thereby accept) an invite addressed to their own email */
drop policy if exists "Org admins can view their org invites" on public.organization_invites;
create policy "Org admins can view their org invites"
  on public.organization_invites for select
  using (
    exists (
      select 1 from public.organizations o
      where o.id = org_id and o.created_by = auth.uid()
    )
    or email = auth.jwt() ->> 'email'
  );

drop policy if exists "Org admins can create invites" on public.organization_invites;
create policy "Org admins can create invites"
  on public.organization_invites for insert
  with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.organizations o
      where o.id = org_id and o.created_by = auth.uid()
    )
  );

drop policy if exists "Invited user can accept their own invite" on public.organization_invites;
create policy "Invited user can accept their own invite"
  on public.organization_invites for update
  using (email = auth.jwt() ->> 'email');

drop policy if exists "Org admins can delete invites" on public.organization_invites;
create policy "Org admins can delete invites"
  on public.organization_invites for delete
  using (
    exists (
      select 1 from public.organizations o
      where o.id = org_id and o.created_by = auth.uid()
    )
  );
