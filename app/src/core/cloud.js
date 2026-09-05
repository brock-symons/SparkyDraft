// ===================================================================
// CLOUD ACCOUNT, ORGANISATIONS AND SHARING  (Phase 10)
//
// Every Supabase call the product makes, ported CALL-FOR-CALL from
// index.html. That phrasing is from the migration inventory's risk
// register (R3) and it is meant literally: the permission model is not
// redesigned here, not tidied, and not "improved". Same tables, same
// columns, same filters, same order of operations, same RPCs. The RLS
// policies in the repo's .sql files were written against exactly these
// queries, and a query rewritten to look nicer is a query those policies
// were never reviewed for.
//
// Two deliberate departures, both structural rather than behavioural:
//
//  * Production keeps `cloudUser`, `myOrgs`, `activeOrgId`, `currentOrg`,
//    `orgRole`, `orgMembers`, `orgProjectContext` and `readOnlyMode` as
//    module-level `let`s and re-renders by calling render functions by
//    hand. Here they live in one snapshot object with a subscribe(), so
//    React can read them through useSyncExternalStore instead of every
//    mutation having to remember which four views to repaint.
//  * Functions return `{ ok, error }` / values instead of calling
//    showToast() themselves. The message strings are unchanged and live
//    at the call sites in the UI — core/ stays DOM-free (house style),
//    and the same call can then be used somewhere that wants to handle a
//    failure differently.
//
// What is NOT here, on purpose: any DDL, any policy change, any new
// table. The schema is whatever the .sql files in the repo root already
// applied to the live project.
// ===================================================================

// -------------------------------------------------------------------
// Config — copied verbatim from index.html L8292. The anon key is a
// PUBLISHABLE key and belongs in client source; it is only safe because
// RLS is on for every table (risk register R14), which is verified
// separately rather than assumed here.
// -------------------------------------------------------------------
export const SUPABASE_URL = 'https://bqknltkzxjxkylxqakau.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_WLC6h8BtnUPbLb77pVOrhA_th3CT1BR';

export const cloudCredentialsSet =
  /^https:\/\//.test(SUPABASE_URL) &&
  !!SUPABASE_ANON_KEY &&
  SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';

// window.supabase comes from the CDN <script> in app/index.html. If it
// fails to load (ad blocker, offline, flaky connection) this stays false
// and every entry point below guards on it, so nothing throws.
//
// It does NOT mean the app falls back to working offline: production's
// gate stays shut and shows "Couldn't reach the login service", locking
// the user out of drawings already saved on their own device. Ported as
// it stands rather than quietly improved — it is a real product
// weakness for someone on a site with no signal, but changing who can
// open the app is a product decision, not a porting one. Flagged in
// MIGRATION_INVENTORY.md §I.
export const cloudLibraryLoaded = typeof window !== 'undefined' && !!window.supabase;
export const cloudConfigured = cloudCredentialsSet && cloudLibraryLoaded;

export const supabaseClient = cloudConfigured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// -------------------------------------------------------------------
// Snapshot + subscription
// -------------------------------------------------------------------

let snapshot = {
  user: null,
  myOrgs: [], // [{id, name, role, created_by}]
  activeOrgId: null,
  currentOrg: null, // {id, name, created_by}
  orgRole: null, // 'admin' | 'member' | null
  orgMembers: [], // [{user_id, user_name, role}]
  // Set only when the open project came from an organisation's shared
  // list. null for a personal project. {id, orgId, role} otherwise.
  orgProjectContext: null,
  readOnly: false,
  // Which account the current auth screen is mid-flow for.
  gateMode: 'signin', // 'signin'|'signup'|'reset'|'resetcode'|'verify'|'newpassword'
  pendingVerifyEmail: '',
  pendingResetEmail: '',
  pendingOrgName: '',
  ready: !cloudConfigured, // false until the first getSession() resolves
};

const listeners = new Set();

export function getCloudState() {
  return snapshot;
}

export function subscribeCloud(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setState(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(fn => fn());
}

/** The name to stamp on records this user writes, as production picks it. */
function displayName(user) {
  return (user && user.user_metadata && user.user_metadata.full_name) || (user && user.email) || '';
}

export function userDisplayName(user) {
  return displayName(user);
}

// -------------------------------------------------------------------
// Auth
// -------------------------------------------------------------------

export async function initCloudAuth(onRecovery) {
  if (!cloudConfigured) {
    setState({ ready: true });
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  setState({ user: data && data.session ? data.session.user : null, ready: true });
  supabaseClient.auth.onAuthStateChange((event, session) => {
    // Clicking a password-reset email link lands back here with a
    // temporary recovery session — route to the "set new password" form
    // instead of treating it as a normal login.
    const patch = { user: session ? session.user : null };
    if (event === 'PASSWORD_RECOVERY') patch.gateMode = 'newpassword';
    setState(patch);
    if (event === 'PASSWORD_RECOVERY' && onRecovery) onRecovery();
  });
}

export function setGateMode(mode) {
  setState({ gateMode: mode });
}

/**
 * Sign-up. Returns one of:
 *   { ok:true, verify:true }   — confirmation code sent, gate moves to 'verify'
 *   { ok:true, user }          — session created immediately
 *   { ok:false, error }
 */
export async function signUp({ email, password, name, org }) {
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { full_name: name, organization: org } },
    });
    if (error) throw error;
    // Supabase deliberately returns a normal-looking user object for an
    // email that's already registered and confirmed, rather than an
    // error — an anti-enumeration measure so signup can't be used to
    // probe which emails exist. identities.length === 0 is the
    // documented way to tell the two cases apart.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { ok: false, error: 'That email is already registered — try logging in instead.' };
    }
    if (data.user && !data.session) {
      setState({ pendingVerifyEmail: email, pendingOrgName: org || '', gateMode: 'verify' });
      return { ok: true, verify: true };
    }
    setState({ user: data.user });
    if (org) await createOrganization(org);
    return { ok: true, user: data.user };
  } catch (err) {
    console.error('SparkyDraft auth error:', err);
    return { ok: false, error: err.message || 'Something went wrong — try again.' };
  }
}

export async function signIn({ email, password }) {
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setState({ user: data.user });
    return { ok: true, user: data.user };
  } catch (err) {
    console.error('SparkyDraft auth error:', err);
    return { ok: false, error: err.message || 'Something went wrong — try again.' };
  }
}

export async function signOut() {
  await supabaseClient.auth.signOut();
  setState({
    user: null,
    myOrgs: [],
    activeOrgId: null,
    currentOrg: null,
    orgRole: null,
    orgMembers: [],
    orgProjectContext: null,
    readOnly: false,
    gateMode: 'signin',
  });
  invitesChecked = false;
}

export async function sendPasswordReset(email) {
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
    setState({ pendingResetEmail: email, gateMode: 'resetcode' });
    return { ok: true };
  } catch (err) {
    console.error('SparkyDraft auth error:', err);
    return { ok: false, error: err.message || 'Something went wrong — try again.' };
  }
}

/**
 * Both OTP flows. `type` is 'signup' (confirm a new account) or
 * 'recovery' (prove ownership before setting a new password) — the same
 * two verifyOtp calls production makes, kept together because they
 * differ only in that argument and which email they read.
 */
export async function verifyCode(type, code) {
  const email = type === 'recovery' ? snapshot.pendingResetEmail : snapshot.pendingVerifyEmail;
  try {
    const { data, error } = await supabaseClient.auth.verifyOtp({ email, token: code, type });
    if (error) throw error;
    if (type === 'recovery') {
      setState({ user: data.user, gateMode: 'newpassword' });
      return { ok: true, user: data.user };
    }
    setState({ user: data.user });
    if (snapshot.pendingOrgName) {
      await createOrganization(snapshot.pendingOrgName);
      setState({ pendingOrgName: '' });
    }
    setState({ gateMode: 'signin' });
    return { ok: true, user: data.user };
  } catch (err) {
    console.error('SparkyDraft auth error:', err);
    return {
      ok: false,
      error: err.message || 'Invalid or expired code — check your email for the latest one.',
    };
  }
}

export async function setNewPassword(password) {
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    setState({ gateMode: 'signin' });
    return { ok: true };
  } catch (err) {
    console.error('SparkyDraft auth error:', err);
    return { ok: false, error: err.message || 'Something went wrong — try again.' };
  }
}

export async function updateProfileName(newName) {
  try {
    const { data, error } = await supabaseClient.auth.updateUser({ data: { full_name: newName } });
    if (error) throw error;
    setState({ user: data.user });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// -------------------------------------------------------------------
// Organisations
// -------------------------------------------------------------------

export async function loadMyOrgs() {
  if (!snapshot.user || !cloudConfigured) {
    setState({ myOrgs: [], currentOrg: null, orgRole: null, orgMembers: [] });
    return;
  }
  try {
    const { data, error } = await supabaseClient
      .from('organization_members')
      .select('org_id, role, organizations(id, name, created_by)')
      .eq('user_id', snapshot.user.id)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    const myOrgs = (data || []).map(row => ({
      id: row.organizations.id,
      name: row.organizations.name,
      role: row.role,
      created_by: row.organizations.created_by,
    }));
    if (!myOrgs.length) {
      setState({ myOrgs, currentOrg: null, orgRole: null, orgMembers: [], activeOrgId: null });
      return;
    }
    let activeOrgId = snapshot.activeOrgId;
    if (!activeOrgId || !myOrgs.some(o => o.id === activeOrgId)) activeOrgId = myOrgs[0].id;
    setState({ myOrgs });
    await setActiveOrg(activeOrgId);
  } catch (err) {
    console.error('Could not load organizations:', err);
  }
}

export async function setActiveOrg(orgId) {
  const org = snapshot.myOrgs.find(o => o.id === orgId);
  if (!org) return;
  setState({
    activeOrgId: orgId,
    currentOrg: { id: org.id, name: org.name, created_by: org.created_by },
    orgRole: org.role,
  });
  await loadOrgMembers();
}

export async function loadOrgMembers() {
  if (!snapshot.currentOrg) return;
  try {
    const { data, error } = await supabaseClient
      .from('organization_members')
      .select('user_id, user_name, role')
      .eq('org_id', snapshot.currentOrg.id)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    setState({ orgMembers: data || [] });
  } catch (err) {
    console.error('Could not load members:', err);
    setState({ orgMembers: [] });
  }
}

export async function createOrganization(name) {
  try {
    const { data, error } = await supabaseClient
      .from('organizations')
      .insert({ name, created_by: snapshot.user.id })
      .select()
      .single();
    if (error) throw error;
    const { error: memErr } = await supabaseClient.from('organization_members').insert({
      org_id: data.id,
      user_id: snapshot.user.id,
      user_name: displayName(snapshot.user),
      role: 'admin',
    });
    if (memErr) throw memErr;
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: 'Could not create organization: ' + err.message };
  }
}

export async function updateOrganizationName(newName) {
  const org = snapshot.currentOrg;
  if (!org || !newName || newName === org.name) return { ok: true };
  try {
    const { error } = await supabaseClient
      .from('organizations')
      .update({ name: newName })
      .eq('id', org.id);
    if (error) throw error;
    setState({
      currentOrg: { ...org, name: newName },
      myOrgs: snapshot.myOrgs.map(o => (o.id === org.id ? { ...o, name: newName } : o)),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Could not rename: ' + err.message };
  }
}

/**
 * Adding someone requires that they ALREADY have an account —
 * find_user_by_email looks up auth.users through a security-definer RPC
 * (supabase-org-member-lookup.sql). This creates a PENDING invite; they
 * become a member only when they accept it.
 *
 * Returns { ok, error, notice, mailto } — the mailto: draft is handed
 * back rather than opened here, since core/ does not touch the window.
 */
export async function inviteToOrg(email) {
  const org = snapshot.currentOrg;
  if (!org) return { ok: false, error: 'Join or create an organization first' };
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return { ok: false, error: 'Enter an email' };
  if (clean === (snapshot.user.email || '').toLowerCase())
    return { ok: false, error: "You can't invite yourself" };
  try {
    const { data: found, error: findErr } = await supabaseClient.rpc('find_user_by_email', {
      p_email: clean,
    });
    if (findErr) throw findErr;
    const target = found && found[0];
    if (!target)
      return {
        ok: false,
        error: 'No Sparky Draft account found for that email -- they need to sign up first.',
      };
    if (snapshot.orgMembers.some(m => m.user_id === target.id))
      return { ok: false, error: 'Already a member of this organization' };
    const { error } = await supabaseClient
      .from('organization_invites')
      .insert({ org_id: org.id, email: clean, invited_by: snapshot.user.id });
    if (error) {
      if (error.code === '23505')
        return { ok: false, error: 'Already invited — waiting on them to accept' };
      throw error;
    }
    const subject = encodeURIComponent(`You've been invited to join ${org.name} on Sparky Draft`);
    const bodyText = encodeURIComponent(
      `Hi,\n\nYou've been invited to join the "${org.name}" organization on Sparky Draft. Sign in with ${clean} and accept the invite notification to join.\n`
    );
    return {
      ok: true,
      notice:
        'Invited ' +
        (target.user_name || clean) +
        ' to ' +
        org.name +
        " — they'll see it next time they sign in",
      mailto: `mailto:${clean}?subject=${subject}&body=${bodyText}`,
    };
  } catch (err) {
    return { ok: false, error: 'Could not send invite: ' + err.message };
  }
}

export async function fetchPendingInvites() {
  if (!snapshot.user || !cloudConfigured) return [];
  try {
    const { data, error } = await supabaseClient.rpc('get_my_pending_invites');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Could not check organization invites:', err);
    return [];
  }
}

// Checked once per page load, right after the auth gate lifts — mirrors
// production's one-shot pattern rather than polling.
let invitesChecked = false;
export async function checkPendingInvitesOnce() {
  if (invitesChecked || !snapshot.user || !cloudConfigured) return null;
  invitesChecked = true;
  return fetchPendingInvites();
}

export async function acceptOrgInvite(inviteId, orgId) {
  try {
    const { error: memErr } = await supabaseClient.from('organization_members').insert({
      org_id: orgId,
      user_id: snapshot.user.id,
      user_name: displayName(snapshot.user),
      role: 'member',
    });
    // already a member somehow -- still fine to clear the invite below
    if (memErr && memErr.code !== '23505') throw memErr;
    const { error: delErr } = await supabaseClient
      .from('organization_invites')
      .delete()
      .eq('id', inviteId);
    if (delErr) throw delErr;
    setState({ activeOrgId: orgId }); // switch straight to the org just joined
    await loadMyOrgs();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Could not accept invite: ' + err.message };
  }
}

export async function declineOrgInvite(inviteId) {
  try {
    const { error } = await supabaseClient.from('organization_invites').delete().eq('id', inviteId);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Could not decline: ' + err.message };
  }
}

export async function removeOrgMember(userId) {
  if (!snapshot.currentOrg) return { ok: false, error: 'No organization' };
  try {
    const { error } = await supabaseClient
      .from('organization_members')
      .delete()
      .eq('org_id', snapshot.currentOrg.id)
      .eq('user_id', userId);
    if (error) throw error;
    await loadOrgMembers();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Could not remove: ' + err.message };
  }
}

// -------------------------------------------------------------------
// Personal cloud projects
// -------------------------------------------------------------------

export async function listCloudProjects() {
  if (!snapshot.user || !cloudConfigured) return [];
  try {
    const { data, error } = await supabaseClient
      .from('projects')
      .select('id,name,updated_at')
      .eq('user_id', snapshot.user.id)
      .order('updated_at', { ascending: false });
    if (error) return [];
    return data || [];
  } catch (err) {
    return [];
  }
}

export async function loadCloudProject(id) {
  const { data, error } = await supabaseClient
    .from('projects')
    .select('data')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data.data;
}

/**
 * Save. Editing a shared org project saves back to that same shared
 * record (so teammates see the change), not a fork into your personal
 * projects — production's rule, kept exactly.
 */
export async function saveCloudProject(record) {
  const user = snapshot.user;
  if (!user) return { ok: false, error: 'Not signed in' };
  if (snapshot.readOnly) return { ok: false, error: "You don't have edit access to this project" };
  const ctx = snapshot.orgProjectContext;
  try {
    if (ctx && ctx.role === 'editor') {
      const { error } = await supabaseClient
        .from('organization_projects')
        .update({ name: record.name, data: record, updated_at: new Date().toISOString() })
        .eq('id', ctx.id);
      if (error) throw error;
      return { ok: true, target: 'org' };
    }
    const { error } = await supabaseClient.from('projects').upsert(
      {
        id: record.id,
        user_id: user.id,
        user_name: displayName(user),
        name: record.name,
        data: record,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
    if (error) throw error;
    return { ok: true, target: 'personal' };
  } catch (err) {
    return { ok: false, error: 'Cloud save failed: ' + err.message };
  }
}

/**
 * Rides on every local save so the cloud copy stays current with no
 * separate "remember to sync" step. Deliberately silent on success and
 * only logs on failure rather than interrupting — the local save it is
 * riding on already succeeded either way.
 */
export function cloudSyncSilently(record) {
  if (!snapshot.user || !cloudConfigured || snapshot.readOnly) return;
  saveCloudProject(record).then(res => {
    if (!res.ok) console.error('Background cloud sync failed:', res.error);
  });
}

export async function deleteCloudProject(id) {
  try {
    const { error } = await supabaseClient.from('projects').delete().eq('id', id);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Delete failed: ' + err.message };
  }
}

/**
 * The cleanup half of a local delete. The picker treats a local save and
 * its auto-synced cloud copy as ONE project (same id, deduped to one
 * row), so deleting locally without this left the cloud row behind and
 * the project reappeared moments after a "cannot be undone" delete.
 */
export async function deleteCloudCopyOf(id) {
  if (!snapshot.user || !cloudConfigured) return;
  try {
    await supabaseClient.from('projects').delete().eq('id', id).eq('user_id', snapshot.user.id);
  } catch (_) {
    /* the local delete already succeeded; this is best-effort cleanup */
  }
}

// -------------------------------------------------------------------
// Sharing into an organisation
// -------------------------------------------------------------------

/**
 * A snapshot copy, not a live link — re-sharing a project with the same
 * name updates that snapshot (unique org_id+name, see
 * supabase-organization-projects.sql). Gated on org membership itself,
 * which is the "permission" to put a project on the org's shared list.
 */
export async function shareProjectToOrg(name, record) {
  const org = snapshot.currentOrg;
  if (!org) return { ok: false, error: 'Join or create an organization first' };
  try {
    const { error } = await supabaseClient.from('organization_projects').upsert(
      {
        org_id: org.id,
        name,
        data: record,
        shared_by: snapshot.user.id,
        shared_by_name: displayName(snapshot.user),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,name' }
    );
    if (error) throw error;
    return { ok: true, orgName: org.name };
  } catch (err) {
    return { ok: false, error: 'Could not share: ' + err.message };
  }
}

export async function listOrgProjects() {
  const org = snapshot.currentOrg;
  if (!org) return { ok: true, rows: [] };
  try {
    const { data, error } = await supabaseClient
      .from('organization_projects')
      .select('id,name,shared_by,shared_by_name,updated_at')
      .eq('org_id', org.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return { ok: true, rows: data || [] };
  } catch (err) {
    return { ok: false, error: 'Could not load organization projects: ' + err.message };
  }
}

/**
 * Any org member can VIEW a shared project; only the person who shared
 * it, an org admin, or someone explicitly granted editor access can
 * edit it. Resolved fresh on every open rather than cached, since access
 * can change between visits.
 */
export async function resolveOrgProjectRole(projectId, sharedBy, orgId) {
  if (sharedBy === snapshot.user.id) return 'editor';
  if (snapshot.orgRole === 'admin' && snapshot.currentOrg && snapshot.currentOrg.id === orgId)
    return 'editor';
  try {
    const { data, error } = await supabaseClient
      .from('organization_project_access')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', snapshot.user.id)
      .maybeSingle();
    if (error) throw error;
    return (data && data.role) || 'viewer';
  } catch (_) {
    // Failing closed: an unreadable grant means view-only, never edit.
    return 'viewer';
  }
}

export async function openOrgProject(id) {
  const { data, error } = await supabaseClient
    .from('organization_projects')
    .select('data, shared_by, shared_by_name, org_id')
    .eq('id', id)
    .single();
  if (error) throw error;
  const role = await resolveOrgProjectRole(id, data.shared_by, data.org_id);
  setState({
    orgProjectContext: { id, orgId: data.org_id, role },
    readOnly: role === 'viewer',
  });
  return { record: data.data, role, sharedByName: data.shared_by_name };
}

export async function deleteOrgProject(id) {
  try {
    const { error } = await supabaseClient.from('organization_projects').delete().eq('id', id);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Delete failed: ' + err.message };
  }
}

/** Clears any shared-project context — opening a personal project. */
export function clearOrgProjectContext() {
  setState({ orgProjectContext: null, readOnly: false });
}

// -------------------------------------------------------------------
// Per-project access
// -------------------------------------------------------------------

/**
 * Who currently holds an explicit editor grant on a shared project.
 * Only the sharer or an org admin can read this (RLS + the 🔑 affordance
 * only rendering for them).
 */
export async function loadProjectAccess(projectId) {
  try {
    const [{ data: project, error: projErr }, { data: grants, error: grantErr }] =
      await Promise.all([
        supabaseClient
          .from('organization_projects')
          .select('shared_by')
          .eq('id', projectId)
          .single(),
        supabaseClient
          .from('organization_project_access')
          .select('user_id')
          .eq('project_id', projectId)
          .eq('role', 'editor'),
      ]);
    if (projErr) throw projErr;
    if (grantErr) throw grantErr;
    return {
      ok: true,
      sharedBy: project.shared_by,
      editorIds: (grants || []).map(g => g.user_id),
    };
  } catch (err) {
    return { ok: false, error: 'Could not load access: ' + err.message };
  }
}

export async function setProjectAccessRole(projectId, userId, canEdit) {
  try {
    if (canEdit) {
      const { error } = await supabaseClient
        .from('organization_project_access')
        .upsert(
          { project_id: projectId, user_id: userId, role: 'editor', granted_by: snapshot.user.id },
          { onConflict: 'project_id,user_id' }
        );
      if (error) throw error;
      return { ok: true, notice: 'Can now edit' };
    }
    const { error } = await supabaseClient
      .from('organization_project_access')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) throw error;
    return { ok: true, notice: 'Now view only' };
  } catch (err) {
    return { ok: false, error: 'Could not update access: ' + err.message };
  }
}

// -------------------------------------------------------------------
// Report a problem
// -------------------------------------------------------------------

/**
 * Goes to the `report-problem` edge function, same as production. The
 * context block is assembled by the caller (it knows the project name)
 * so this stays free of app state.
 */
export async function sendProblemReport(description, context) {
  if (!supabaseClient) return { ok: false, error: 'Sign in to send a report' };
  const { error } = await supabaseClient.functions.invoke('report-problem', {
    body: { description, context },
  });
  if (error) return { ok: false, error: 'Could not send report — try again' };
  return { ok: true };
}
