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
  function endCoalesce() {
    lastLabel = null;
  }

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
    get state() {
      return state;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    get isDirty() {
      return dirty;
    },
    markSaved() {
      dirty = false;
      emit({ type: 'saved' });
    },
    commit,
    endCoalesce,
    undo,
    redo,
    load,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ===================================================================
// PROJECT MODEL  (migration Phase 0 — see MIGRATION_INVENTORY.md)
//
// The shape below deliberately mirrors the production app's `state`:
// a PROJECT that owns many plans, plus project-level collections that
// cut across them.
//
// The redesign originally modelled a single flat drawing (objects +
// walls, no floors). That could not represent production data — no
// floors, circuits, cables, dimensions, rooms or switch links — and
// every unported subsystem depends on those. Reshaping first avoids
// building the electrical/commercial half against a model that would
// then have to be torn out.
//
// Two deliberate carry-overs from production rather than "improvements":
//
//  * `gridSpacingMM` — grid spacing is REAL MILLIMETRES tied to the
//    plan's calibration, not abstract screen units. The grid means
//    something physical to an electrician ("300 mm off the corner"), so
//    the production semantics are preserved rather than simplified.
//  * Per-floor `view` — each floor remembers its own pan/zoom, so
//    switching floors returns you to where you were on that floor
//    instead of resetting the viewport.
// ===================================================================

let idCounter = 0;
function localId(prefix) {
  idCounter += 1;
  return prefix + '-' + Date.now().toString(36) + '-' + idCounter.toString(36);
}

/**
 * One building level. Matches production's makeFloor() field-for-field
 * for the fields the redesign has reached; later phases fill the rest.
 */
export function makeFloor(name) {
  return {
    id: localId('FL'),
    name,
    planImage: null, // { src, width, height, x, y, scale, opacity }
    scale: null, // mm per world unit; null = uncalibrated
    objects: [],
    cables: [], // cable routes (Phase 1)
    dimensions: [], // persistent dimension annotations (Phase 1)
    switchLinks: [], // switch → lights (Phase 2)
    walls: [],
    rooms: [], // (Phase 1)
    bankNames: {}, // 'switchId::group' → display name (Phase 2)
    view: { zoom: 1, offsetX: 0, offsetY: 0 },
    gridSpacingMM: 100,
    snapEnabled: true,
    gridOriginX: 0,
    gridOriginY: 0,
    gridVisible: true,
    gridAlignWallId: null,
  };
}

/** A blank project containing one floor. */
export function emptyProject() {
  return {
    id: localId('PRJ'),
    name: 'Untitled project',
    floors: [makeFloor('Ground Floor')],
    activeFloorIndex: 0,

    // Reserved so later phases extend rather than reshape the model
    // again. Empty until their phase lands.
    civilPlans: [],
    activeCivilPlanIndex: 0,
    activePlanType: 'floor', // 'floor' | 'civil'
    circuits: [], // Phase 3 — project-level, spans floors
    elevations: [], // Phase 8
    customSymbols: [], // Phase 1
    boardMainSwitchAmps: {}, // Phase 4
    unassignedCommsPorts: [], // Phase 5

    // Project-level layer state (production keeps this outside floors so
    // hiding Power hides it on every floor at once).
    hiddenLayers: [],
    lockedLayers: [],

    nextId: 1, // shared object-id counter across floors
  };
}

/** The floor currently being drafted. */
export function currentFloor(project) {
  return project.floors[project.activeFloorIndex] || project.floors[0];
}

/**
 * Every object across every floor, tagged with its floor — the shape
 * quoting and the panel schedule need, since both are project-wide.
 * Mirrors production's allObjects().
 */
export function allObjects(project) {
  return project.floors.flatMap(f =>
    f.objects.map(o => ({ ...o, __floorId: f.id, __floorName: f.name }))
  );
}

/**
 * Migrates a record saved by the pre-Phase-0 redesign (a single flat
 * drawing) into the project shape. Kept because the redesign has been
 * shared for testing and those local saves should not be orphaned.
 */
export function migrateFlatDrawing(data) {
  if (!data || Array.isArray(data.floors)) return data; // already a project
  const project = emptyProject();
  const floor = project.floors[0];
  project.name = data.name || 'Untitled project';
  floor.objects = data.objects || [];
  floor.walls = data.walls || [];
  floor.planImage = data.planImage || null;
  floor.scale = data.scale ?? null;
  floor.snapEnabled = data.snapEnabled !== false;
  floor.gridOriginX = data.gridOriginX || 0;
  floor.gridOriginY = data.gridOriginY || 0;
  // The flat model stored grid spacing in abstract world units; the
  // project model stores real millimetres. Without a calibration there
  // is no honest conversion, so fall back to the default rather than
  // inventing a scale that would silently change what the grid means.
  if (data.scale && data.gridSpacing) floor.gridSpacingMM = data.gridSpacing * data.scale;
  project.hiddenLayers = data.hiddenLayers || [];
  project.lockedLayers = data.lockedLayers || [];
  project.nextId = data.nextId || 1;
  return project;
}
