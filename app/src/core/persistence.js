// ===================================================================
// PERSISTENCE + SAVE STATE  (directive §17)
//
// Two rules drive this file:
//
//  1. The save indicator must reflect ACTUAL state, never a decorative
//     animation. Every status returned here is derived from a real
//     storage outcome, so the UI can never claim "Saved" for a write
//     that failed.
//  2. It is namespaced under `sparkydraft_cad:` so exercising the
//     redesign can never read, overwrite or corrupt a real project saved
//     by the production app (which uses `project:<id>`).
//
// Cloud/Supabase sync is deliberately NOT touched here — the directive
// forbids changing Supabase architecture or auth behaviour without
// approval. Local persistence gives a complete, testable save/load story
// for the redesign without going near that.
// ===================================================================

const PREFIX = 'sparkydraft_cad:project:';
const INDEX_KEY = 'sparkydraft_cad:index';

export const SaveState = {
  SAVED: 'saved',
  UNSAVED: 'unsaved',
  SAVING: 'saving',
  ERROR: 'error',
};

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

export function newProjectId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function listProjects() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const data = safeParse(localStorage.getItem(key), null);
    if (!data) continue;
    out.push({
      id: key.slice(PREFIX.length),
      name: data.name || 'Untitled project',
      updatedAt: data.updatedAt || 0,
      deviceCount: data.drawing && data.drawing.objects ? data.drawing.objects.length : 0,
    });
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

export function loadProject(id) {
  return safeParse(localStorage.getItem(PREFIX + id), null);
}

/**
 * Returns { ok, error } rather than throwing — the caller is a save
 * indicator that needs to show a real failure state (quota exceeded,
 * private-mode storage refusal) instead of silently pretending success.
 */
export function saveProject(id, drawing) {
  const record = {
    id,
    name: drawing.name || 'Untitled project',
    updatedAt: Date.now(),
    drawing,
  };
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(record));
    return { ok: true, record };
  } catch (e) {
    return {
      ok: false,
      error:
        e && e.name === 'QuotaExceededError'
          ? 'Storage is full — free up space or delete an old project.'
          : 'Could not save to this browser’s storage.',
    };
  }
}

export function deleteProject(id) {
  try {
    localStorage.removeItem(PREFIX + id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Could not delete.' };
  }
}

/**
 * Remembers per-project workspace layout (which panels are open, panel
 * widths, last tool). Directive §3: panel state should be "intelligently
 * remembered" rather than reset every time the user opens a drawing.
 * Kept separate from the drawing itself so UI preferences never end up
 * inside project data that might later sync to other users' machines.
 */
const UI_KEY = 'sparkydraft_cad:workspace-ui';

export function loadWorkspaceUI() {
  return safeParse(localStorage.getItem(UI_KEY), null) || {};
}

export function saveWorkspaceUI(ui) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch (e) {
    /* non-critical */
  }
}
