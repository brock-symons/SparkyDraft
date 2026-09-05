// ===================================================================
// PROJECT BROWSER  (directive §19, §26 — cloud sources added in Phase 10)
//
// Deliberately restrained. §19 warns against the project side turning
// into an unrelated SaaS dashboard, so this uses the same chrome height,
// same type scale, same density and same neutral palette as the
// workspace — it reads as the tool's "open" screen, not a marketing
// surface. No hero, no big cards, no gradient.
//
// Rows rather than large tiles: an electrician with forty jobs wants to
// scan a list, not scroll a gallery.
//
// Phase 10 added the cloud and organisation sources. One rule from
// production is load-bearing and kept exactly: once signed in, the CLOUD
// list is the source of truth and a local save only earns its own row if
// its id is not already in the cloud. Every local save auto-syncs, so
// without that dedupe the same job appears twice — once per storage
// location — which is how it looked before production fixed it.
// ===================================================================

import {
  Button,
  IconButton,
  TextInput,
  EmptyState,
  Dialog,
  Spinner,
  cx,
  focusRing,
} from './primitives.jsx';
import { useCloud, InviteBanner, AccountDialog, OrgDialog, ProjectAccessDialog } from './Cloud.jsx';
import {
  cloudConfigured,
  listCloudProjects,
  listOrgProjects,
  deleteCloudProject,
  deleteOrgProject,
  loadMyOrgs,
  checkPendingInvitesOnce,
  fetchPendingInvites,
  acceptOrgInvite,
  declineOrgInvite,
} from '../core/cloud.js';

const { useState, useMemo, useEffect, useCallback } = React;

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + ' hr ago';
  const days = Math.round(hr / 24);
  if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
  return new Date(ts).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ProjectPicker({
  projects,
  onOpen,
  onOpenCloud,
  onOpenOrgProject,
  onCreate,
  onDelete,
  onShare,
  storageError,
  pushToast,
}) {
  const cloud = useCloud();
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [tab, setTab] = useState('mine');
  const [accountOpen, setAccountOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const [manageAccess, setManageAccess] = useState(null);
  const [cloudRows, setCloudRows] = useState([]);
  const [orgRows, setOrgRows] = useState([]);
  const [orgError, setOrgError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [invites, setInvites] = useState([]);

  const signedIn = !!cloud.user && cloudConfigured;

  // Knowing about org membership up front decides whether the
  // organisation tab even shows, and keeps currentOrg fresh for the
  // account/org dialogs, which read the same snapshot.
  const refreshCloud = useCallback(async () => {
    if (!signedIn) {
      setCloudRows([]);
      setOrgRows([]);
      return;
    }
    setLoading(true);
    await loadMyOrgs();
    setCloudRows(await listCloudProjects());
    setLoading(false);
  }, [signedIn]);

  useEffect(() => {
    refreshCloud();
  }, [refreshCloud]);

  // Checked once per sign-in, right after the gate lifts.
  useEffect(() => {
    if (!signedIn) return;
    checkPendingInvitesOnce().then(list => list && setInvites(list));
  }, [signedIn]);

  useEffect(() => {
    if (tab !== 'org' || !cloud.currentOrg) return;
    let live = true;
    setLoading(true);
    listOrgProjects().then(res => {
      if (!live) return;
      setLoading(false);
      if (res.ok) {
        setOrgRows(res.rows);
        setOrgError(null);
      } else setOrgError(res.error);
    });
    return () => (live = false);
  }, [tab, cloud.currentOrg && cloud.currentOrg.id]);

  // Falling back to the personal tab when the active org goes away (left
  // it, or it was renamed out from under a stale snapshot) — an org tab
  // with no org behind it would render an empty screen with no way back.
  useEffect(() => {
    if (!cloud.currentOrg && tab === 'org') setTab('mine');
  }, [cloud.currentOrg, tab]);

  /**
   * The merged personal list. Cloud first (newest first, as the query
   * ordered them), then any local project whose id is not already up
   * there.
   */
  const mine = useMemo(() => {
    const rows = cloudRows.map(r => ({
      id: r.id,
      name: r.name,
      updatedAt: new Date(r.updated_at).getTime(),
      where: 'cloud',
    }));
    const cloudIds = new Set(rows.map(r => r.id));
    projects.forEach(p => {
      if (cloudIds.has(p.id)) return;
      rows.push({ ...p, where: 'local' });
    });
    return rows;
  }, [cloudRows, projects]);

  const list = tab === 'org' ? orgRows.map(orgRow) : mine;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => (p.name || '').toLowerCase().includes(q));
  }, [list, query]);

  function orgRow(r) {
    const canManage = r.shared_by === cloud.user.id || cloud.orgRole === 'admin';
    return {
      id: r.id,
      name: r.name,
      updatedAt: new Date(r.updated_at).getTime(),
      where: 'org',
      sharedByName: r.shared_by_name,
      canManage,
    };
  }

  async function handleDelete(p) {
    if (p.where === 'org') {
      const res = await deleteOrgProject(p.id);
      pushToast(res.ok ? 'Removed' : res.error);
      setOrgRows(rows => rows.filter(r => r.id !== p.id));
      return;
    }
    if (p.where === 'cloud') {
      const res = await deleteCloudProject(p.id);
      if (!res.ok) return pushToast(res.error);
      // Same project, same id — clear the local copy too, or this
      // "cannot be undone" delete immediately reappears as a local row.
      onDelete(p.id, { alsoCloud: false });
      pushToast('Deleted');
      refreshCloud();
      return;
    }
    onDelete(p.id, { alsoCloud: true });
    pushToast('Deleted');
    refreshCloud();
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-ink-200 px-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
          <span className="h-2 w-2 rounded-full bg-accent-500" />
          SparkyDraft
        </span>
        <div className="flex-1" />
        {signedIn && (
          <>
            <Button size="sm" onClick={() => setOrgOpen(true)}>
              Organisations
            </Button>
            <Button size="sm" onClick={() => setAccountOpen(true)}>
              Account
            </Button>
          </>
        )}
        <Button variant="primary" size="sm" onClick={onCreate}>
          New drawing
        </Button>
      </header>

      <InviteBanner
        invites={invites}
        onAccept={async inv => {
          const res = await acceptOrgInvite(inv.id, inv.org_id);
          pushToast(res.ok ? 'Joined ' + inv.org_name : res.error);
          setInvites(await fetchPendingInvites());
          refreshCloud();
        }}
        onDecline={async inv => {
          const res = await declineOrgInvite(inv.id);
          pushToast(res.ok ? 'Invite declined' : res.error);
          setInvites(await fetchPendingInvites());
        }}
      />

      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-ink-800">Drawings</h1>
          {list.length > 0 && (
            <div className="w-48">
              <TextInput
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter…"
                aria-label="Filter drawings"
              />
            </div>
          )}
        </div>

        {cloud.currentOrg && (
          <div className="mb-4 flex gap-1.5" role="tablist">
            {[
              ['mine', 'My drawings'],
              ['org', cloud.currentOrg.name],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cx(
                  'max-w-[16rem] truncate rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  tab === id ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200',
                  focusRing
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {storageError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {storageError}
          </div>
        )}
        {tab === 'org' && orgError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {orgError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          tab === 'org' ? (
            <EmptyState
              icon="👥"
              title="Nothing shared yet"
              hint={`No drawings shared with ${cloud.currentOrg.name}. Share one from My drawings.`}
            />
          ) : (
            <EmptyState
              icon="▦"
              title="No drawings yet"
              hint="Create a drawing to start placing devices on a plan."
              action={
                <Button variant="primary" size="sm" onClick={onCreate}>
                  New drawing
                </Button>
              }
            />
          )
        ) : filtered.length === 0 ? (
          <EmptyState title="Nothing matches" hint={`No drawing named like “${query}”.`} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink-200">
            {filtered.map((p, i) => (
              <div
                key={p.where + ':' + p.id}
                className={cx(
                  'group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-ink-50',
                  i > 0 && 'border-t border-ink-100'
                )}
              >
                <button
                  onClick={() =>
                    p.where === 'org'
                      ? onOpenOrgProject(p.id)
                      : p.where === 'cloud'
                        ? onOpenCloud(p.id)
                        : onOpen(p.id)
                  }
                  className={cx('flex min-w-0 flex-1 items-center gap-3 text-left', focusRing)}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-100 text-ink-400">
                    {p.where === 'org' ? '👥' : p.where === 'cloud' ? '☁' : '▦'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-800">
                      {p.name || 'Untitled'}
                    </span>
                    <span className="block text-2xs text-ink-400">
                      {p.where === 'org'
                        ? (p.sharedByName || 'Shared') + ' · '
                        : p.where === 'cloud'
                          ? 'Cloud · '
                          : p.deviceCount != null
                            ? `${p.deviceCount} device${p.deviceCount === 1 ? '' : 's'} · `
                            : 'On this device · '}
                      {relativeTime(p.updatedAt)}
                    </span>
                  </span>
                </button>

                {p.where === 'org'
                  ? p.canManage && (
                      <IconButton
                        label={`Manage who can edit ${p.name || 'drawing'}`}
                        size="sm"
                        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => setManageAccess(p)}
                      >
                        🔑
                      </IconButton>
                    )
                  : cloud.currentOrg && (
                      <IconButton
                        label={`Share ${p.name || 'drawing'} to ${cloud.currentOrg.name}`}
                        size="sm"
                        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => onShare(p)}
                      >
                        👥
                      </IconButton>
                    )}

                {(p.where !== 'org' || p.canManage) && (
                  <IconButton
                    label={`Delete ${p.name || 'drawing'}`}
                    size="sm"
                    className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => setConfirmDelete(p)}
                  >
                    ✕
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={
          confirmDelete && confirmDelete.where === 'org'
            ? 'Remove shared drawing'
            : 'Delete drawing'
        }
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                handleDelete(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              {confirmDelete && confirmDelete.where === 'org' ? 'Remove' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          {confirmDelete && confirmDelete.where === 'org' ? (
            <>
              Remove{' '}
              <span className="font-medium text-ink-800">
                {confirmDelete && confirmDelete.name}
              </span>{' '}
              from the organisation’s shared drawings. This does not delete anyone’s personal copy.
            </>
          ) : (
            <>
              Delete{' '}
              <span className="font-medium text-ink-800">
                {confirmDelete && confirmDelete.name}
              </span>{' '}
              and everything on it? This can’t be undone.
            </>
          )}
        </p>
      </Dialog>

      <AccountDialog
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        pushToast={pushToast}
      />
      <OrgDialog
        open={orgOpen}
        onClose={() => {
          setOrgOpen(false);
          refreshCloud();
        }}
        pushToast={pushToast}
      />
      {manageAccess && (
        <ProjectAccessDialog
          projectId={manageAccess.id}
          projectName={manageAccess.name}
          onClose={() => setManageAccess(null)}
          pushToast={pushToast}
        />
      )}
    </div>
  );
}
