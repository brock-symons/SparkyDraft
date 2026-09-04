// ===================================================================
// CLOUD CHROME  (Phase 10)
//
// The auth gate, account panel, organisation sheet, per-project access
// editor, pending-invite banner and problem reporter. All of the
// Supabase logic lives in core/cloud.js; this file only renders it and
// reports outcomes.
//
// SECURITY NOTE — the reason this is a React file and not a port of
// production's innerHTML:
//
// Every one of these surfaces prints text that another person controls:
// an organisation's name, a teammate's display name, whoever invited
// you, the name someone gave a shared project. Production builds those
// screens with template literals into innerHTML, unescaped — which is
// the exact pattern the repository audit flagged (§8.1). A member whose
// display name is `<img src=x onerror=…>` executes script in every one
// of their colleagues' browsers the moment the members list renders.
//
// JSX interpolation escapes by construction, so the same values are
// inert here. That is not incidental — it is the "security parity or
// better" requirement in CLAUDE.md's cutover gate, and it is why none of
// these components use dangerouslySetInnerHTML anywhere. If a future
// change needs raw markup on one of these screens, it needs an escaping
// helper and a review, not a quick innerHTML.
// ===================================================================

import {
  Button,
  TextInput,
  Toggle,
  Dialog,
  Spinner,
  EmptyState,
  cx,
  focusRing,
} from './primitives.jsx';
import {
  cloudCredentialsSet,
  cloudLibraryLoaded,
  getCloudState,
  subscribeCloud,
  setGateMode,
  signIn,
  signUp,
  signOut,
  sendPasswordReset,
  verifyCode,
  setNewPassword,
  updateProfileName,
  userDisplayName,
  loadMyOrgs,
  setActiveOrg,
  createOrganization,
  updateOrganizationName,
  inviteToOrg,
  fetchPendingInvites,
  acceptOrgInvite,
  declineOrgInvite,
  removeOrgMember,
  loadProjectAccess,
  setProjectAccessRole,
  sendProblemReport,
} from '../core/cloud.js';

const { useState, useEffect, useCallback, useSyncExternalStore } = React;

/** Subscribes a component to the cloud snapshot in core/cloud.js. */
export function useCloud() {
  return useSyncExternalStore(subscribeCloud, getCloudState);
}

// -------------------------------------------------------------------
// Shared bits
// -------------------------------------------------------------------

function AuthError({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="mt-2 text-xs leading-relaxed text-red-600">
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-2xs leading-relaxed text-ink-400">{hint}</span>}
    </label>
  );
}

/**
 * Wraps an async submit so a slow network cannot be double-submitted —
 * production disables its button and swaps the label for the same
 * reason. Returns [busy, run].
 */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async fn => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run];
}

// -------------------------------------------------------------------
// Auth gate
// -------------------------------------------------------------------

/**
 * The app is gated behind login: the project browser is not reachable
 * until there is a session. One exception, carried over from
 * production's own flow — a password-recovery link signs the user into a
 * temporary session purely so updateUser() can change the password. That
 * is not a real login, so the gate stays up on 'newpassword' regardless.
 */
export function AuthGate({ onSignedIn }) {
  const cloud = useCloud();
  const mode = cloud.gateMode;

  if (mode !== 'newpassword' && cloud.user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-100 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-pop">
        <div className="mb-5 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent-500" />
          <span className="text-base font-semibold text-ink-800">SparkyDraft</span>
        </div>
        {!cloudCredentialsSet ? (
          <p className="text-sm leading-relaxed text-ink-600">
            Cloud login isn’t configured for this build.
          </p>
        ) : !cloudLibraryLoaded ? (
          <p className="text-sm leading-relaxed text-ink-600">
            Couldn’t reach the login service. Check your internet connection and reload the page.
          </p>
        ) : (
          <GateForm mode={mode} onSignedIn={onSignedIn} />
        )}
      </div>
    </div>
  );
}

function GateForm({ mode, onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, run] = useSubmit();
  const cloud = useCloud();

  function go(mode) {
    setError(null);
    setGateMode(mode);
  }

  // --- set a new password (post-recovery) ---
  if (mode === 'newpassword') {
    const submit = () =>
      run(async () => {
        if (password.length < 6) return setError('Password must be at least 6 characters.');
        if (password !== password2) return setError("Passwords don't match.");
        const res = await setNewPassword(password);
        if (!res.ok) return setError(res.error);
        setPassword('');
        setPassword2('');
        onSignedIn && onSignedIn("Password updated — you're logged in.");
      });
    return (
      <form onSubmit={e => (e.preventDefault(), submit())}>
        <p className="text-sm leading-relaxed text-ink-600">Set a new password for your account.</p>
        <Field label="New password">
          <TextInput
            type="password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Repeat new password">
          <TextInput
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            value={password2}
            onChange={e => setPassword2(e.target.value)}
          />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy}>
          {busy ? 'Please wait…' : 'Set new password'}
        </Button>
      </form>
    );
  }

  // --- ask for a reset email ---
  if (mode === 'reset') {
    const submit = () =>
      run(async () => {
        if (!email.trim()) return setError('Enter your email.');
        const res = await sendPasswordReset(email.trim());
        if (!res.ok) setError(res.error);
      });
    return (
      <form onSubmit={e => (e.preventDefault(), submit())}>
        <p className="text-sm leading-relaxed text-ink-600">
          Enter your email and we’ll send you a link to reset your password.
        </p>
        <Field label="Email">
          <TextInput
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
        <p className="mt-3 text-center text-xs text-ink-500">
          Remembered it?{' '}
          <button
            type="button"
            onClick={() => go('signin')}
            className={cx('text-accent-600', focusRing)}
          >
            Log in
          </button>
        </p>
      </form>
    );
  }

  // --- the two 6-digit code screens ---
  //
  // A typed code rather than a clickable link, deliberately: inbox
  // link-safety scanners (Gmail, Microsoft Safe Links) visit a
  // confirmation link before the person ever clicks it, which burns the
  // one-time token and reports it expired no matter how fresh it is.
  // Nothing can "click" a code.
  if (mode === 'verify' || mode === 'resetcode') {
    const recovery = mode === 'resetcode';
    const target = recovery ? cloud.pendingResetEmail : cloud.pendingVerifyEmail;
    const submit = () =>
      run(async () => {
        if (!code.trim()) return setError('Enter the code from your email.');
        const res = await verifyCode(recovery ? 'recovery' : 'signup', code.trim());
        if (!res.ok) return setError(res.error);
        if (!recovery) {
          const uname = res.user && res.user.user_metadata && res.user.user_metadata.full_name;
          onSignedIn && onSignedIn('Welcome' + (uname ? ', ' + uname : '') + '!');
        }
      });
    return (
      <form onSubmit={e => (e.preventDefault(), submit())}>
        <p className="text-sm leading-relaxed text-ink-600">
          We sent a 6-digit code to <span className="font-semibold text-ink-800">{target}</span>.
          Enter it below to {recovery ? 'continue' : 'confirm your account'}.
        </p>
        <Field label={recovery ? 'Reset code' : 'Confirmation code'}>
          <TextInput
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={e => setCode(e.target.value)}
          />
        </Field>
        <AuthError>{error}</AuthError>
        <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy}>
          {busy ? 'Verifying…' : recovery ? 'Continue' : 'Verify'}
        </Button>
        <p className="mt-3 text-center text-xs text-ink-500">
          <button
            type="button"
            onClick={() => go('signin')}
            className={cx('text-accent-600', focusRing)}
          >
            Back to log in
          </button>
        </p>
      </form>
    );
  }

  // --- sign in / sign up ---
  const signup = mode === 'signup';
  const submit = () =>
    run(async () => {
      setError(null);
      const mail = email.trim();
      if (signup) {
        if (!name.trim()) return setError('Enter your name.');
        if (!mail || password.length < 6)
          return setError('Enter a valid email and a password of at least 6 characters.');
        if (password !== password2) return setError("Passwords don't match.");
        const res = await signUp({
          email: mail,
          password,
          name: name.trim(),
          org: org.trim(),
        });
        if (!res.ok) return setError(res.error);
        if (res.verify) return; // gate switches itself to the code screen
        onSignedIn && onSignedIn('Welcome, ' + name.trim() + '!');
        return;
      }
      if (!mail || !password) return setError('Enter your email and password.');
      const res = await signIn({ email: mail, password });
      if (!res.ok) return setError(res.error);
      const uname = res.user && res.user.user_metadata && res.user.user_metadata.full_name;
      onSignedIn && onSignedIn('Welcome back' + (uname ? ', ' + uname : '') + '!');
    });

  return (
    <form onSubmit={e => (e.preventDefault(), submit())}>
      {signup && (
        <>
          <Field label="Full name">
            <TextInput
              autoComplete="name"
              placeholder="Jane Smith"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </Field>
          <Field label="Organisation (optional)">
            <TextInput
              autoComplete="organization"
              placeholder="Company or trading name"
              value={org}
              onChange={e => setOrg(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field label="Email">
        <TextInput
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Password">
        <TextInput
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          placeholder={signup ? 'At least 6 characters' : 'Your password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
      </Field>
      {signup && (
        <Field label="Repeat password">
          <TextInput
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={password2}
            onChange={e => setPassword2(e.target.value)}
          />
        </Field>
      )}
      <AuthError>{error}</AuthError>
      <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy}>
        {busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}
      </Button>
      <p className="mt-3 text-center text-xs text-ink-500">
        {signup ? 'Already have an account? ' : 'Don’t have an account? '}
        <button
          type="button"
          onClick={() => go(signup ? 'signin' : 'signup')}
          className={cx('text-accent-600', focusRing)}
        >
          {signup ? 'Log in' : 'Create one'}
        </button>
      </p>
      {!signup && (
        <p className="mt-1.5 text-center text-xs text-ink-500">
          <button
            type="button"
            onClick={() => go('reset')}
            className={cx('text-accent-600', focusRing)}
          >
            Forgot your password?
          </button>
        </p>
      )}
    </form>
  );
}

// -------------------------------------------------------------------
// Account
// -------------------------------------------------------------------

export function AccountDialog({ open, onClose, pushToast }) {
  const cloud = useCloud();
  const user = cloud.user;
  const [name, setName] = useState('');
  const [confirmOut, setConfirmOut] = useState(false);

  useEffect(() => {
    if (open && user) setName(userDisplayName(user) === user.email ? '' : userDisplayName(user));
  }, [open, user]);

  if (!user) return null;

  const initials = (userDisplayName(user) || '?')
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Account" width="max-w-sm">
        <div className="flex justify-center pb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-500 font-mono text-lg font-bold text-white">
            {initials}
          </div>
        </div>
        <Field label="Name">
          <TextInput value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Button
          size="sm"
          className="mt-2"
          onClick={async () => {
            if (!name.trim()) return pushToast('Enter your name');
            const res = await updateProfileName(name.trim());
            pushToast(res.ok ? 'Profile updated' : 'Could not update profile: ' + res.error);
          }}
        >
          Save profile
        </Button>

        <dl className="mt-5 space-y-2 border-t border-ink-100 pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-400">Email</dt>
            <dd className="truncate text-ink-800">{user.email}</dd>
          </div>
          {memberSince && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-400">Member since</dt>
              <dd className="text-ink-800">{memberSince}</dd>
            </div>
          )}
        </dl>

        <Button variant="danger" className="mt-5 w-full" onClick={() => setConfirmOut(true)}>
          Sign out
        </Button>
      </Dialog>

      <Dialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title="Log out?"
        footer={
          <>
            <Button onClick={() => setConfirmOut(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmOut(false);
                onClose();
                await signOut();
                pushToast('Signed out');
              }}
            >
              Log out
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          You’ll need to log back in to keep using SparkyDraft. Any unsaved changes are autosaved
          locally first.
        </p>
      </Dialog>
    </>
  );
}

// -------------------------------------------------------------------
// Pending invites
// -------------------------------------------------------------------

export function InviteBanner({ invites, onAccept, onDecline }) {
  if (!invites || !invites.length) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      {invites.map(inv => (
        <div
          key={inv.id}
          className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 py-2 text-xs text-ink-700"
        >
          <span className="flex-1">
            🔔 <span className="font-semibold">{inv.invited_by_name}</span> invited you to join{' '}
            <span className="font-semibold">{inv.org_name}</span>
          </span>
          <Button size="sm" variant="primary" onClick={() => onAccept(inv)}>
            Accept
          </Button>
          <Button size="sm" onClick={() => onDecline(inv)}>
            Decline
          </Button>
        </div>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------
// Organisations
// -------------------------------------------------------------------

export function OrgDialog({ open, onClose, pushToast }) {
  const cloud = useCloud();
  const [tab, setTab] = useState(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [, list] = await Promise.all([loadMyOrgs(), fetchPendingInvites()]);
    setInvites(list);
    setTab(t => t || (list.length ? 'invites' : 'orgs'));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  return (
    <Dialog open={open} onClose={onClose} title="Organisations" width="max-w-lg">
      {!cloud.user ? (
        <p className="text-sm text-ink-600">Log in to use organisations.</p>
      ) : loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="mb-4 flex gap-1.5">
            {[
              ['invites', '📨 Invites', invites.length],
              ['orgs', '🏢 My organisations', cloud.myOrgs.length],
            ].map(([id, label, count]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cx(
                  'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  tab === id ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200',
                  focusRing
                )}
              >
                {label}
                {count ? ` (${count})` : ''}
              </button>
            ))}
          </div>
          {tab === 'invites' ? (
            <InvitesTab
              invites={invites}
              pushToast={pushToast}
              onChanged={async goOrgs => {
                setInvites(await fetchPendingInvites());
                if (goOrgs) setTab('orgs');
              }}
            />
          ) : (
            <OrgsTab pushToast={pushToast} />
          )}
        </>
      )}
    </Dialog>
  );
}

function InvitesTab({ invites, pushToast, onChanged }) {
  if (!invites.length)
    return (
      <p className="py-3 text-xs leading-relaxed text-ink-400">No pending invites right now.</p>
    );
  return (
    <div className="divide-y divide-ink-100">
      {invites.map(inv => (
        <div key={inv.id} className="flex flex-col gap-2 py-3">
          <span className="text-xs leading-relaxed text-ink-700">
            <span className="font-semibold">{inv.invited_by_name}</span> invited you to join{' '}
            <span className="font-semibold">{inv.org_name}</span>
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              className="flex-1"
              onClick={async () => {
                const res = await acceptOrgInvite(inv.id, inv.org_id);
                pushToast(res.ok ? 'Joined ' + inv.org_name : res.error);
                onChanged(true);
              }}
            >
              Accept
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={async () => {
                const res = await declineOrgInvite(inv.id);
                pushToast(res.ok ? 'Invite declined' : res.error);
                onChanged(false);
              }}
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrgsTab({ pushToast }) {
  const cloud = useCloud();
  const [newName, setNewName] = useState('');
  const [editName, setEditName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const org = cloud.currentOrg;
  const isAdmin = cloud.orgRole === 'admin';

  useEffect(() => setEditName(org ? org.name : ''), [org && org.id, org && org.name]);

  async function create(name) {
    if (!name.trim()) return pushToast('Enter an organisation name');
    const res = await createOrganization(name.trim());
    if (!res.ok) return pushToast(res.error);
    pushToast('Created "' + name.trim() + '"');
    await setActiveOrgAndReload(res.id);
    setNewName('');
  }

  async function setActiveOrgAndReload(id) {
    await loadMyOrgs();
    await setActiveOrg(id);
  }

  if (!org) {
    return (
      <div>
        <p className="mb-3 text-xs leading-relaxed text-ink-400">
          You’re not part of an organisation yet. Create one to start inviting people to specific
          projects.
        </p>
        <Field label="Organisation name">
          <TextInput
            placeholder="e.g. IJED Electric"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
        </Field>
        <Button variant="primary" size="sm" className="mt-3" onClick={() => create(newName)}>
          + Create organisation
        </Button>
      </div>
    );
  }

  return (
    <div>
      {cloud.myOrgs.length > 1 && (
        <>
          <SectionLabel>Switch organisation</SectionLabel>
          <div className="mb-4">
            {cloud.myOrgs.map(o => (
              <button
                key={o.id}
                onClick={() => o.id !== cloud.activeOrgId && setActiveOrg(o.id)}
                className={cx(
                  'flex w-full items-center gap-2 border-b border-ink-100 py-2 text-left text-sm',
                  o.id === cloud.activeOrgId ? 'text-accent-600' : 'text-ink-700 hover:bg-ink-50',
                  focusRing
                )}
              >
                <span className="flex-1 truncate">
                  {o.id === cloud.activeOrgId ? '● ' : '○ '}
                  {o.name}
                </span>
                {o.role === 'admin' && <RoleTag tone="amber">ADMIN</RoleTag>}
              </button>
            ))}
          </div>
        </>
      )}

      {isAdmin ? (
        <>
          <Field label="Organisation name">
            <TextInput value={editName} onChange={e => setEditName(e.target.value)} />
          </Field>
          <Button
            size="sm"
            className="mt-2"
            onClick={async () => {
              if (!editName.trim()) return pushToast('Enter an organisation name');
              const res = await updateOrganizationName(editName.trim());
              pushToast(res.ok ? 'Renamed to "' + editName.trim() + '"' : res.error);
            }}
          >
            Save name
          </Button>
        </>
      ) : (
        <div className="text-base font-semibold text-ink-800">{org.name}</div>
      )}

      <p className="mb-4 mt-2 text-xs text-ink-400">
        {cloud.orgMembers.length} member{cloud.orgMembers.length === 1 ? '' : 's'}
        {isAdmin ? ' · you’re an admin' : ''}
      </p>

      {isAdmin && (
        <>
          <Field
            label="Add member by email"
            hint="They must already have a Sparky Draft account with this email."
          >
            <TextInput
              type="email"
              placeholder="teammate@example.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            size="sm"
            className="mt-3"
            onClick={async () => {
              if (!inviteEmail.trim()) return pushToast('Enter an email');
              const res = await inviteToOrg(inviteEmail.trim());
              if (!res.ok) return pushToast(res.error);
              pushToast(res.notice);
              setInviteEmail('');
              // There is no server-side mailer here, so the invite
              // notification is a draft in the reporter's own mail app —
              // same reasoning as Report a problem: it genuinely comes
              // from their address with no extra setup.
              window.open(res.mailto, '_blank');
            }}
          >
            Add to organisation
          </Button>
        </>
      )}

      <SectionLabel className="mt-5">Members</SectionLabel>
      <div>
        {cloud.orgMembers.map(m => (
          <div
            key={m.user_id}
            className="flex items-center gap-2 border-b border-ink-100 py-2 text-sm text-ink-700"
          >
            <span className="min-w-0 flex-1 truncate">{m.user_name || m.user_id}</span>
            {m.role === 'admin' && <RoleTag tone="amber">ADMIN</RoleTag>}
            {isAdmin && m.user_id !== cloud.user.id && (
              <button
                onClick={() => setConfirmRemove(m)}
                aria-label={`Remove ${m.user_name || 'member'} from organisation`}
                className={cx('rounded px-1 text-red-600 hover:bg-red-50', focusRing)}
              >
                🗑
              </button>
            )}
          </div>
        ))}
      </div>

      <SectionLabel className="mt-5">Join another organisation</SectionLabel>
      <p className="mb-3 text-xs leading-relaxed text-ink-400">
        You can belong to more than one organisation. Create a new one below — to join an existing
        one, ask an admin to invite the email you sign in with.
      </p>
      <Field label="Organisation name">
        <TextInput
          placeholder="e.g. IJED Electric"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
      </Field>
      <Button size="sm" className="mt-3" onClick={() => create(newName)}>
        + Create organisation
      </Button>

      <Dialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        title="Remove member?"
        footer={
          <>
            <Button onClick={() => setConfirmRemove(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const res = await removeOrgMember(confirmRemove.user_id);
                pushToast(res.ok ? 'Removed' : res.error);
                setConfirmRemove(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          They’ll lose access to any projects shared with them in this organisation.
        </p>
      </Dialog>
    </div>
  );
}

function SectionLabel({ children, className }) {
  return (
    <div
      className={cx(
        'mb-1.5 border-b border-ink-100 pb-1 font-mono text-2xs uppercase tracking-wider text-ink-400',
        className
      )}
    >
      {children}
    </div>
  );
}

function RoleTag({ tone, children }) {
  return (
    <span
      className={cx(
        'shrink-0 rounded px-1 py-0.5 text-2xs font-semibold',
        tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-accent-100 text-accent-700'
      )}
    >
      {children}
    </span>
  );
}

// -------------------------------------------------------------------
// Per-project access
// -------------------------------------------------------------------

/**
 * Everyone in the organisation can already VIEW a shared project — this
 * only controls who can additionally edit it. The sharer and org admins
 * are always editors and their toggles are inert rather than hidden, so
 * the list reads as a complete picture of who can edit.
 */
export function ProjectAccessDialog({ projectId, projectName, onClose, pushToast }) {
  const cloud = useCloud();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let live = true;
    loadProjectAccess(projectId).then(res => {
      if (live) setState({ loading: false, ...res });
    });
    return () => (live = false);
  }, [projectId]);

  const [editorIds, setEditorIds] = useState(null);
  useEffect(() => {
    if (state.editorIds) setEditorIds(new Set(state.editorIds));
  }, [state.editorIds]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={'Access — ' + (projectName || 'project')}
      width="max-w-md"
    >
      {state.loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !state.ok ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : (
        <>
          <p className="mb-3 text-xs leading-relaxed text-ink-400">
            Everyone in the organisation can view this project. Turn on “Can edit” for anyone who
            should be able to change it too.
          </p>
          {cloud.orgMembers.map(m => {
            const isOwner = m.user_id === state.sharedBy;
            const isAdmin = m.role === 'admin';
            const alwaysEditor = isOwner || isAdmin;
            const isEditor = alwaysEditor || (editorIds && editorIds.has(m.user_id));
            return (
              <div
                key={m.user_id}
                className="flex items-center gap-2 border-b border-ink-100 py-2 text-sm text-ink-700"
              >
                <span className="min-w-0 flex-1 truncate">{m.user_name || m.user_id}</span>
                {isOwner && <RoleTag>OWNER</RoleTag>}
                {isAdmin && <RoleTag tone="amber">ADMIN</RoleTag>}
                <span className="text-2xs text-ink-400">Can edit</span>
                <span className={alwaysEditor ? 'pointer-events-none opacity-40' : ''}>
                  <Toggle
                    label={`Can edit — ${m.user_name || m.user_id}`}
                    checked={!!isEditor}
                    onChange={async () => {
                      if (alwaysEditor) return;
                      const nowOn = !isEditor;
                      setEditorIds(prev => {
                        const next = new Set(prev);
                        if (nowOn) next.add(m.user_id);
                        else next.delete(m.user_id);
                        return next;
                      });
                      const res = await setProjectAccessRole(projectId, m.user_id, nowOn);
                      if (!res.ok) {
                        // Put the switch back — leaving it showing a
                        // permission that was never granted is the one
                        // failure mode this screen must not have.
                        setEditorIds(prev => {
                          const next = new Set(prev);
                          if (nowOn) next.delete(m.user_id);
                          else next.add(m.user_id);
                          return next;
                        });
                        pushToast(res.error);
                      } else pushToast(res.notice);
                    }}
                  />
                </span>
              </div>
            );
          })}
          {!cloud.orgMembers.length && (
            <EmptyState title="No members yet" hint="Invite someone to the organisation first." />
          )}
        </>
      )}
    </Dialog>
  );
}

// -------------------------------------------------------------------
// Read-only banner
// -------------------------------------------------------------------

/**
 * Shown across the top of the workspace when the open project is a
 * shared one this account can only view. The actual blocking is done at
 * the controller level (see main.jsx) rather than by an overlay —
 * production covers the canvas with a click-eating div, which also
 * blocks pan and zoom, so a viewer cannot even look around the drawing
 * they were given access to read.
 */
export function ReadOnlyBanner({ sharedByName }) {
  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
      <span aria-hidden="true">👁</span>
      <span>
        View only{sharedByName ? ' — shared by ' + sharedByName : ''}. You don’t have edit access to
        this shared project.
      </span>
    </div>
  );
}

// -------------------------------------------------------------------
// Report a problem
// -------------------------------------------------------------------

export function ReportProblemDialog({ open, onClose, projectName, pushToast }) {
  const cloud = useCloud();
  const [text, setText] = useState('');
  const [busy, run] = useSubmit();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Report a problem"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!text.trim()) return pushToast('Describe the problem first');
                const context = [
                  'Project: ' + (projectName || 'Untitled'),
                  'Account: ' + (cloud.user ? cloud.user.email : 'not signed in'),
                  'When: ' + new Date().toString(),
                  'Browser: ' + navigator.userAgent,
                ].join('\n');
                pushToast('Sending report…');
                const res = await sendProblemReport(text.trim(), context);
                if (!res.ok) return pushToast(res.error);
                pushToast('Report sent — thanks!');
                setText('');
                onClose();
              })
            }
          >
            {busy ? 'Sending…' : 'Send report'}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-400">
          What went wrong?
        </span>
        <textarea
          rows={5}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Describe what happened, and what you expected instead…"
          className={cx(
            'w-full resize-y rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-800 placeholder:text-ink-300',
            focusRing
          )}
        />
      </label>
      <p className="mt-2 text-2xs leading-relaxed text-ink-400">
        Your project name, account email and browser version are sent along with this so the problem
        can be traced.
      </p>
    </Dialog>
  );
}
