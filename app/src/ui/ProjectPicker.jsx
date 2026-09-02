// ===================================================================
// PROJECT BROWSER  (directive §19, §26)
//
// Deliberately restrained. §19 warns against the project side turning
// into an unrelated SaaS dashboard, so this uses the same chrome height,
// same type scale, same density and same neutral palette as the
// workspace — it reads as the tool's "open" screen, not a marketing
// surface. No hero, no big cards, no gradient.
//
// Rows rather than large tiles: an electrician with forty jobs wants to
// scan a list, not scroll a gallery.
// ===================================================================

import { Button, IconButton, TextInput, EmptyState, Dialog, cx, focusRing } from './primitives.jsx';

const { useState, useMemo } = React;

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
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ProjectPicker({ projects, onOpen, onCreate, onDelete, storageError }) {
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(p => (p.name || '').toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-ink-200 px-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
          <span className="h-2 w-2 rounded-full bg-accent-500" />
          SparkyDraft
        </span>
        <div className="flex-1" />
        <Button variant="primary" size="sm" onClick={onCreate}>New drawing</Button>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-ink-800">Drawings</h1>
          {projects.length > 0 && (
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

        {storageError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {storageError}
          </div>
        )}

        {projects.length === 0 ? (
          <EmptyState
            icon="▦"
            title="No drawings yet"
            hint="Create a drawing to start placing devices on a plan."
            action={<Button variant="primary" size="sm" onClick={onCreate}>New drawing</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nothing matches" hint={`No drawing named like “${query}”.`} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink-200">
            {filtered.map((p, i) => (
              <div
                key={p.id}
                className={cx(
                  'group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-ink-50',
                  i > 0 && 'border-t border-ink-100'
                )}
              >
                <button
                  onClick={() => onOpen(p.id)}
                  className={cx('flex min-w-0 flex-1 items-center gap-3 text-left', focusRing)}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-100 text-ink-400">▦</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-800">{p.name || 'Untitled'}</span>
                    <span className="block text-2xs text-ink-400">
                      {p.deviceCount} device{p.deviceCount === 1 ? '' : 's'} · {relativeTime(p.updatedAt)}
                    </span>
                  </span>
                </button>
                <IconButton
                  label={`Delete ${p.name || 'drawing'}`}
                  size="sm"
                  className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => setConfirmDelete(p)}
                >
                  ✕
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete drawing"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          Delete <span className="font-medium text-ink-800">{confirmDelete && confirmDelete.name}</span> and
          everything on it? This can’t be undone.
        </p>
      </Dialog>
    </div>
  );
}
