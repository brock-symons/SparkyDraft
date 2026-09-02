// ===================================================================
// DOCUMENT MODEL + UNDO/REDO
//
// Directive §18 treats undo/redo as a core system, not a feature. The
// design goal here is that undo is *trustworthy*: every mutation goes
// through one funnel (`commit`), so it is structurally impossible to
// change the drawing without producing an undo entry. There is no
// "mutate directly and remember to push history afterwards" path — that
// pattern is what makes undo unreliable in drafting tools.
//
// Snapshot-based rather than diff/patch-based, deliberately: the
// drawing payload is small (hundreds of objects, not millions), and
// snapshots cannot desynchronise from the live state the way a
// hand-written inverse-operation for every command eventually does.
// ===================================================================

const HISTORY_LIMIT = 100;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createDocument(initial) {
  let state = clone(initial);

  // past[] holds snapshots BEFORE each committed change; future[] holds
  // snapshots undone but not yet discarded by a new edit.
  const past = [];
  const future = [];
  let lastLabel = null;

  const listeners = new Set();
  let dirty = false;

  function emit(detail) {
    for (const fn of listeners) fn(state, detail);
  }

  /**
   * The only way to change the document.
   *
   * @param label   short human-readable name, shown in undo tooltips
   * @param mutator receives a draft copy; mutate it freely
   * @param opts    { coalesce } — when true, a run of same-labelled
   *                changes collapses into one undo step. Used for
   *                continuous gestures (dragging an object) so one drag
   *                is one undo, not sixty.
   */
  function commit(label, mutator, opts = {}) {
    const before = state;
    const draft = clone(state);
    const result = mutator(draft);
    // A mutator may bail out by returning false — e.g. "nothing was
    // actually selected" — and that must not leave a no-op undo entry.
    if (result === false) return false;

    const coalescing = opts.coalesce && lastLabel === label && past.length > 0;
    if (!coalescing) {
      past.push(before);
      if (past.length > HISTORY_LIMIT) past.shift();
    }
    future.length = 0;
    lastLabel = label;
    state = draft;
    dirty = true;
    emit({ type: 'commit', label });
    return true;
  }

  /** Ends a coalescing run, so the next same-labelled edit starts a new undo step. */
  function endCoalesce() { lastLabel = null; }

  function undo() {
    if (!past.length) return false;
    future.push(state);
    state = past.pop();
    lastLabel = null;
    dirty = true;
    emit({ type: 'undo' });
    return true;
  }

  function redo() {
    if (!future.length) return false;
    past.push(state);
    state = future.pop();
    lastLabel = null;
    dirty = true;
    emit({ type: 'redo' });
    return true;
  }

  /**
   * Replace the whole document without creating an undo entry — used when
   * loading a project. Loading is not an edit, and being able to "undo"
   * back into a previous project's contents would be nonsense.
   */
  function load(next) {
    state = clone(next);
    past.length = 0;
    future.length = 0;
    lastLabel = null;
    dirty = false;
    emit({ type: 'load' });
  }

  return {
    get state() { return state; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get isDirty() { return dirty; },
    markSaved() { dirty = false; emit({ type: 'saved' }); },
    commit,
    endCoalesce,
    undo,
    redo,
    load,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** A blank drawing. Mirrors the production floor shape's relevant fields. */
export function emptyDrawing() {
  return {
    name: 'Untitled project',
    objects: [],
    walls: [],
    nextId: 1,
    scale: null,             // mm per world unit; null = uncalibrated
    gridSpacing: 40,         // world units between grid lines
    gridOriginX: 0,
    gridOriginY: 0,
    snapEnabled: true,
    hiddenLayers: [],
    lockedLayers: [],
    // Background floor plan traced over while drafting. Stored as a data
    // URL so a drawing stays a single self-contained record — the same
    // approach the production app takes (planImageData).
    planImage: null,         // { src, width, height, x, y, scale, opacity }
  };
}
