/*
  Wires up a real accept/decline flow for organization_invites, which
  already existed (see supabase-organizations.sql) but the app never
  actually used -- inviteToOrg() added people to organization_members
  immediately instead, with no acceptance step at all.

  This adds only what's needed for the invited user to see and act on
  their own pending invites:

  1. get_my_pending_invites() -- a security definer function returning
     the CALLER's own pending invites, with the org name and inviter's
     display name resolved server-side. The invited user has no RLS
     access to organizations or organization_members for an org they're
     not in yet, so a direct client-side join would just come back empty.
  2. Lets the invited user delete their own invite row (previously only
     an org admin could) -- used for declining, and for clearing the
     invite once they've accepted (accepting itself is just a normal
     organization_members insert, which already worked and already
     required org-admin permission from the inviter, same as before).

  Run this once in Supabase -> SQL Editor -> New query -> paste -> Run.
  Safe to re-run.
*/

create or replace function public.get_my_pending_invites()
returns table(id uuid, org_id uuid, org_name text, invited_by_name text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select i.id, i.org_id, o.name as org_name,
    coalesce(u.raw_user_meta_data->>'full_name', u.email) as invited_by_name,
    i.created_at
  from public.organization_invites i
  join public.organizations o on o.id = i.org_id
  join auth.users u on u.id = i.invited_by
  where lower(i.email) = lower(auth.jwt() ->> 'email')
    and i.accepted_at is null
  order by i.created_at asc;
$$;

revoke execute on function public.get_my_pending_invites() from public, anon;
grant execute on function public.get_my_pending_invites() to authenticated;

drop policy if exists "Org admins can delete invites" on public.organization_invites;
create policy "Org admins or the invited user can delete an invite"
  on public.organization_invites for delete
  using (public.is_org_admin(org_id) or lower(email) = lower(auth.jwt() ->> 'email'));
