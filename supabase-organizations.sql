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

/*
  Helper functions, used instead of a policy querying organization_members
  from within organization_members' own policy. That direct self-reference
  is what causes "infinite recursion detected in policy": Postgres has to
  re-check the same policy for every row the inner query touches, forever.
  security definer runs the function's own query as the function's owner,
  which bypasses RLS just for that one internal check, breaking the loop.
*/
create or replace function public.is_org_member(_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = _org_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organizations
    where id = _org_id and created_by = auth.uid()
  ) or exists (
    select 1 from public.organization_members
    where org_id = _org_id and user_id = auth.uid() and role = 'admin'
  );
$$;

/* These are only meant to be called from inside other tables' RLS policies
   (evaluated as the querying role, so authenticated genuinely needs
   execute) -- Postgres grants execute to PUBLIC by default on every
   create/replace, which silently included anon (fully unauthenticated
   requests) too. Locked down after being flagged by Supabase's security
   advisor: anon should never be able to call these directly. */
revoke execute on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
revoke execute on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_admin(uuid) to authenticated;

/* organizations: any member can view it; only the creator can rename/delete it */
drop policy if exists "Members can view their organization" on public.organizations;
create policy "Members can view their organization"
  on public.organizations for select
  using (created_by = auth.uid() or public.is_org_member(id));

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

/* organization_members: uses the helper functions above, never a direct
   self-reference to organization_members inside its own policy */
drop policy if exists "Members can view other members of their org" on public.organization_members;
create policy "Members can view other members of their org"
  on public.organization_members for select
  using (public.is_org_member(org_id));

drop policy if exists "Org admins can add members" on public.organization_members;
create policy "Org admins can add members"
  on public.organization_members for insert
  with check (public.is_org_admin(org_id) or user_id = auth.uid());

drop policy if exists "Org admins can remove members" on public.organization_members;
create policy "Org admins can remove members"
  on public.organization_members for delete
  using (public.is_org_admin(org_id) or user_id = auth.uid());

/* organization_invites: org admins manage invites for their org; anyone can
   see (and thereby accept) an invite addressed to their own email */
drop policy if exists "Org admins can view their org invites" on public.organization_invites;
create policy "Org admins can view their org invites"
  on public.organization_invites for select
  using (public.is_org_admin(org_id) or email = auth.jwt() ->> 'email');

drop policy if exists "Org admins can create invites" on public.organization_invites;
create policy "Org admins can create invites"
  on public.organization_invites for insert
  with check (invited_by = auth.uid() and public.is_org_admin(org_id));

drop policy if exists "Invited user can accept their own invite" on public.organization_invites;
create policy "Invited user can accept their own invite"
  on public.organization_invites for update
  using (email = auth.jwt() ->> 'email');

drop policy if exists "Org admins can delete invites" on public.organization_invites;
create policy "Org admins can delete invites"
  on public.organization_invites for delete
  using (public.is_org_admin(org_id));
