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

import { migrateLegacyCommsData } from './comms.js';

const HISTORY_LIMIT = 100;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createDocument(initial) {
  // A LINEAR TIMELINE of committed states, plus a cursor pointing at the
  // one currently in effect. Undo/redo move the cursor; a new edit
  // truncates anything ahead of it.
  //
  // This replaced a past[]/future[] stack pair. Two stacks handle undo and
  // redo fine but cannot answer "show me every point I could go back to",
  // which is what version history needs — and reconstructing that list
  // from two stacks means merging them in opposite orders and hoping they
  // stay consistent. A timeline is the same information in the shape the
  // feature actually wants, and it matches how production models history.
  const timeline = [{ state: clone(initial), ts: Date.now(), label: 'Opened' }];
  let cursor = 0;

  const listeners = new Set();
  let dirty = false;

  function current() {
    return timeline[cursor].state;
  }

  function emit(detail) {
    for (const fn of listeners) fn(current(), detail);
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
    const draft = clone(current());
    const result = mutator(draft);
    // A mutator may bail out by returning false — e.g. "nothing was
    // actually selected" — and that must not leave a no-op undo entry.
    if (result === false) return false;

    const coalescing = opts.coalesce && cursor > 0 && timeline[cursor].label === label;
    if (coalescing) {
      // Fold into the existing entry: same step, newer contents.
      timeline[cursor] = { state: draft, ts: Date.now(), label };
    } else {
      timeline.length = cursor + 1; // discard any redo branch
      timeline.push({ state: draft, ts: Date.now(), label });
      cursor = timeline.length - 1;
      if (timeline.length > HISTORY_LIMIT) {
        timeline.shift();
        cursor--;
      }
    }
    dirty = true;
    emit({ type: 'commit', label });
    return true;
  }

  /** Ends a coalescing run, so the next same-labelled edit starts a new step. */
  function endCoalesce() {
    // Renaming the head entry breaks the label match that coalescing
    // relies on, without touching the state it holds.
    if (cursor > 0) timeline[cursor] = { ...timeline[cursor], label: timeline[cursor].label + ' ' };
  }

  function undo() {
    if (cursor === 0) return false;
    cursor--;
    dirty = true;
    emit({ type: 'undo' });
    return true;
  }

  function redo() {
    if (cursor >= timeline.length - 1) return false;
    cursor++;
    dirty = true;
    emit({ type: 'redo' });
    return true;
  }

  /**
   * Jump straight to any point in the timeline (version history), rather
   * than stepping through one undo at a time. Deliberately does NOT
   * truncate the future — jumping back to look at something and then
   * forward again must not destroy work. The next actual edit truncates,
   * same as undo-then-edit always has.
   */
  function jumpTo(index) {
    if (index < 0 || index >= timeline.length || index === cursor) return false;
    cursor = index;
    dirty = true;
    emit({ type: 'jump' });
    return true;
  }

  /** Timeline entries, newest last, for the version-history UI. */
  function history() {
    return timeline.map((e, i) => ({
      index: i,
      label: e.label.trim(),
      ts: e.ts,
      current: i === cursor,
    }));
  }

  /**
   * Replace the whole document without creating an undo entry — used when
   * loading a project. Loading is not an edit, and being able to "undo"
   * back into a previous project's contents would be nonsense.
   */
  function load(next) {
    timeline.length = 0;
    timeline.push({ state: clone(next), ts: Date.now(), label: 'Opened' });
    cursor = 0;
    dirty = false;
    emit({ type: 'load' });
  }

  return {
    get state() {
      return current();
    },
    get canUndo() {
      return cursor > 0;
    },
    get canRedo() {
      return cursor < timeline.length - 1;
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
    jumpTo,
    history,
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
    scale: null, // world units per METRE (see geometry.js); null = uncalibrated
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
    boardMainSwitchAmps: {}, // Phase 4
    unassignedCommsPorts: [], // Phase 5

    // User-defined fittings, added on top of the shipped SYMBOL_LIBRARY.
    // Stored on the project (not globally) so a custom fitting travels
    // with the job that uses it, matching production.
    customSymbols: [],

    // Drawn radius of a device symbol, in screen px at zoom 1.
    // Production's values are 12 / 16 / 22 (Small / Medium / Large).
    symbolSize: 16,

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
 * Devices sitting at exactly the same spot on the same floor — almost
 * always a double-click or a bad import rather than intent, and they
 * silently inflate the quote because each one still prices.
 *
 * Ported verbatim from production's findDuplicateDevices(), including
 * the rounding: positions are compared at whole-unit precision, so two
 * devices a hundredth of a unit apart still count as stacked. Grouping
 * by `symbolId@x,y` means two *different* device types at one point are
 * not flagged — a switch above a GPO is a normal thing to draw.
 */
export function findDuplicateDevices(project) {
  const results = [];
  for (const floor of project.floors) {
    const groups = {};
    for (const o of floor.objects) {
      const key = o.symbolId + '@' + Math.round(o.x) + ',' + Math.round(o.y);
      (groups[key] = groups[key] || []).push(o);
    }
    for (const objs of Object.values(groups)) {
      if (objs.length > 1) results.push({ floorId: floor.id, floorName: floor.name, objs });
    }
  }
  return results;
}

/**
 * The one entry point for loading saved data. Runs every migration in
 * dependency order, so a caller can never accidentally apply one and
 * skip another — which is the failure mode that corrupts saves.
 *
 * Order matters: the flat-drawing migration has to produce a project
 * shape before the comms migration can walk `floors[]`.
 */
export function migrateLoadedProject(data) {
  const project = migrateFlatDrawing(data);
  // Old saves modelled comms as kind:'data' circuits. Converting them to
  // rack ports has to happen before anything reads the project, or the
  // circuits UI shows phantom "data circuits" and the devices attached
  // to them keep a circuit id that is about to stop existing.
  const { circuits, unassigned } = migrateLegacyCommsData(project);
  project.circuits = circuits;
  project.unassignedCommsPorts = unassigned;
  return project;
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
