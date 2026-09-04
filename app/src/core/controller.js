// ===================================================================
// INTERACTION CONTROLLER  (directive §6, §7, §8, §12)
//
// Owns transient interaction state only — hover, drag, marquee, live
// snap result, measurement in progress. Anything that changes the
// DRAWING goes through document.commit(), so undo stays trustworthy
// (§18) and this file can never quietly mutate the doc behind history's
// back.
//
// Input model, chosen so desktop and touch each get the behaviour that
// suits them rather than one compromise that suits neither (§11, §12):
//
//   Mouse, Select tool, on empty space  → marquee select (CAD standard)
//   Mouse, on a device                  → move it
//   Touch, one finger, on empty space   → pan (a marquee is a poor fit
//                                          for a finger, and dragging the
//                                          view is what people expect on
//                                          a phone)
//   Touch, one finger, on a device      → move it
//   Touch, two fingers                  → pan + pinch zoom together
//   Space held / middle button / Pan    → pan regardless of tool
//
// A movement threshold separates taps from drags so a slightly shaky
// finger selects rather than nudging a device 2 mm across the plan.
// ===================================================================

import {
  screenToWorld,
  hitTestObjects,
  hitTestSegments,
  objectsInRect,
  boundsOf,
  zoomAt,
  gridWorldUnits,
  DEVICE_R,
} from './geometry.js';
import { snapPoint } from './snapping.js';
import { currentFloor } from './document.js';
import { CABLE_SIZES } from './catalog.js';
import { makeCircuit } from './circuits.js';
import {
  isSwitchSymbol,
  autoGroupForSwitchLink,
  nextGroupForSwitch,
  recomputeSwitchGang,
  propagateSwitchCircuitToLinkedLights,
  removeLinksForObjects,
} from './switching.js';

const DRAG_THRESHOLD_PX = 4;

export function createController({ doc, getView, setView, getViewport, onChange, onCalibrate }) {
  // Transient (non-document) state.
  let tool = 'select';
  let activeSymbolId = null;
  let selectedIds = new Set();
  let hoverId = null;
  let snap = null;
  let marquee = null;
  let ghost = null;
  let measure = null;
  let spaceHeld = false;
  let cursorWorld = null;
  // In-progress linear primitive (first click placed, second pending).
  let draft = null;
  // Cables/walls/dimensions select independently of devices, matching
  // production's separate selectedCableId — they are not part of a
  // device multi-selection and don't participate in align/distribute.
  let selectedSegment = null;
  // 2.5mm² default matches production's CABLE_SIZES[2].
  let activeCableSize = CABLE_SIZES[2];
  // Link tool: the switch awaiting its lights, and which gang they join.
  // `activeLinkGroup === null` means "work the gang out from device type"
  // (see autoGroupForSwitchLink); a number means the user explicitly
  // started a new group and it must not be auto-merged into an existing
  // one. Same two-variable model as production.
  let linkPendingSwitch = null;
  let activeLinkGroup = null;
  // Last thing the link tool wanted to say — including refusals ("tap a
  // switch first"). Surfaced in the mode hint rather than a toast: the
  // user's eyes are on the plan, not the top of the screen.
  let linkNotice = null;
  // Switch runs are drawn only for the selected device by default, so the
  // plan doesn't turn into spaghetti. This shows all of them at once,
  // matching production's showSwitchRuns toggle.
  let showSwitchRuns = false;
  // Circuit view state: isolate one circuit's run, and stamp circuit ids
  // under the symbols. Both are ways of reading the drawing, not edits,
  // so neither belongs in the document or the undo history.
  let isolatedCircuitId = null;
  let showCircuitLabels = false;

  let gesture = null; // active pointer gesture
  const pointers = new Map(); // pointerId -> {x,y} for multi-touch

  function notify() {
    onChange && onChange();
  }

  // The document is a PROJECT; drafting happens on its active floor.
  // Layer visibility/lock is project-level (hiding Power hides it on
  // every floor), so the two accessors are kept distinct rather than
  // collapsed into one "drawing".
  function project() {
    return doc.state;
  }
  function floor() {
    return currentFloor(doc.state);
  }

  function isLayerHidden(layerId) {
    return (project().hiddenLayers || []).includes(layerId);
  }
  function isLayerLocked(layerId) {
    return (project().lockedLayers || []).includes(layerId);
  }
  function symbolCategoryOf(obj, symbolFor) {
    const s = symbolFor(obj.symbolId);
    return s ? s.category : null;
  }

  // Selectability is layer-driven: hidden layers can't be hit, locked
  // layers can be seen but not grabbed. Both the renderer and hit-testing
  // read the same predicate so what you see is what you can click (§8).
  let symbolFor = () => null;
  function setSymbolResolver(fn) {
    symbolFor = fn;
  }

  function visible(obj) {
    const cat = symbolCategoryOf(obj, symbolFor);
    return !cat || !isLayerHidden(cat);
  }
  function selectable(obj) {
    if (!visible(obj)) return false;
    const cat = symbolCategoryOf(obj, symbolFor);
    return !cat || !isLayerLocked(cat);
  }

  function lockedIds() {
    const out = new Set();
    for (const o of floor().objects) {
      const cat = symbolCategoryOf(o, symbolFor);
      if (cat && isLayerLocked(cat)) out.add(o.id);
    }
    return out;
  }

  /** Project's configured symbol radius, falling back to the default. */
  function symbolRadius() {
    return project().symbolSize || DEVICE_R;
  }

  function toWorld(clientX, clientY, rect) {
    return screenToWorld(getView(), clientX - rect.left, clientY - rect.top);
  }

  function computeSnap(world, excludeId) {
    const f = floor();
    return snapPoint(world, {
      objects: f.objects,
      walls: f.walls,
      // Real-millimetre spacing converted to world units via the plan's
      // calibration — see gridWorldUnits(). Snapping to an abstract
      // screen grid would mean devices land on nothing meaningful.
      gridStep: gridWorldUnits(f),
      gridOriginX: f.gridOriginX,
      gridOriginY: f.gridOriginY,
      zoom: getView().zoom,
      enabled: f.snapEnabled !== false,
      excludeId,
      isSelectable: visible,
    });
  }

  // --- tools ---------------------------------------------------------

  // --- linear primitives (cables / walls / dimensions) ----------------

  /**
   * Production ids are prefixed and zero-padded (`C-001`, `W-002`,
   * `M-003`) and drawn from the same `nextId` counter as devices. Kept
   * identical so ids stay comparable across the old and new apps while
   * both exist, and so a project round-tripped through either looks the
   * same.
   */
  const SEGMENT_KIND = {
    cable: { prefix: 'C', collection: 'cables', label: 'Draw cable' },
    wall: { prefix: 'W', collection: 'walls', label: 'Draw wall' },
    dimension: { prefix: 'M', collection: 'dimensions', label: 'Add dimension' },
  };

  function commitSegment(kind, a, b) {
    const spec = SEGMENT_KIND[kind];
    if (!spec) return;
    doc.commit(spec.label, d => {
      const f = currentFloor(d);
      const id = spec.prefix + '-' + String(d.nextId++).padStart(3, '0');
      const seg = { id, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      if (kind === 'cable') {
        // Cables carry their size + colour so the drawing stays readable
        // and the quote can price the run. Defaults to the active size.
        seg.layer = 'cable';
        seg.size = activeCableSize.size;
        seg.color = activeCableSize.color;
      }
      f[spec.collection].push(seg);
    });
  }

  /** Topmost cable/wall/dimension under the cursor, with its kind. */
  function hitTestLinear(world) {
    const f = floor();
    const tol = 14 / getView().zoom;
    const wallTol = 22 / getView().zoom; // production uses a fatter wall target
    const cable = hitTestSegments(f.cables || [], world, tol);
    if (cable) return { kind: 'cable', item: cable };
    const dim = hitTestSegments(f.dimensions || [], world, tol);
    if (dim) return { kind: 'dimension', item: dim };
    const wall = hitTestSegments(f.walls || [], world, wallTol);
    if (wall) return { kind: 'wall', item: wall };
    return null;
  }

  function deleteSelectedSegment() {
    if (!selectedSegment) return false;
    const spec = SEGMENT_KIND[selectedSegment.kind];
    if (!spec) return false;
    const id = selectedSegment.id;
    doc.commit('Delete ' + selectedSegment.kind, d => {
      const f = currentFloor(d);
      f[spec.collection] = f[spec.collection].filter(s => s.id !== id);
    });
    selectedSegment = null;
    notify();
    return true;
  }

  // --- rooms ----------------------------------------------------------
  //
  // Deliberately lightweight, matching production: a room is a name and
  // an id, and devices point at it by `room`. There is no polygon and no
  // spatial containment — an electrician assigns devices to "Kitchen" by
  // selecting them, which is what takeoffs and grouping actually need.

  function addRoom(name) {
    if (!name || !name.trim()) return false;
    let id = null;
    doc.commit('Add room', d => {
      const f = currentFloor(d);
      id = 'RM-' + String(d.nextId++).padStart(3, '0');
      f.rooms.push({ id, name: name.trim() });
    });
    notify();
    return id;
  }

  function renameRoom(id, name) {
    if (!name || !name.trim()) return false;
    doc.commit('Rename room', d => {
      const r = currentFloor(d).rooms.find(x => x.id === id);
      if (!r) return false;
      r.name = name.trim();
    });
    notify();
    return true;
  }

  /** Deleting a room unassigns its devices rather than deleting them. */
  function deleteRoom(id) {
    doc.commit('Delete room', d => {
      const f = currentFloor(d);
      f.rooms = f.rooms.filter(r => r.id !== id);
      f.objects.forEach(o => {
        if (o.room === id) o.room = '';
      });
    });
    notify();
    return true;
  }

  /** Assign the current device selection to a room (or clear it). */
  function assignSelectionToRoom(roomId) {
    if (!selectedIds.size) return false;
    doc.commit('Assign room', d => {
      currentFloor(d).objects.forEach(o => {
        if (selectedIds.has(o.id)) o.room = roomId || '';
      });
    });
    notify();
    return true;
  }

  // --- custom fittings -------------------------------------------------

  /**
   * A user-defined device. Shape matches production's exactly, including
   * the `custom_<timestamp>` id and the 3-character abbreviation, so a
   * project carrying custom fittings opens the same in either app.
   * Colour is inherited from the chosen layer rather than picked freely —
   * that is what keeps the plan readable by category at a glance.
   */
  function addCustomSymbol({ name, abbr, category, material_cost, labour_hours }, layerColor) {
    if (!name || !name.trim()) return null;
    const sym = {
      id: 'custom_' + Date.now(),
      label: name.trim(),
      abbr: (abbr || name).toUpperCase().slice(0, 3) || '?',
      color: layerColor,
      category,
      defaultProps: {
        height_mm: 300,
        cable: '1.5mm² TPS',
        protection: '-',
        material_cost: material_cost || 0,
        labour_hours: labour_hours || 0,
      },
    };
    doc.commit('Add custom fitting', d => {
      d.customSymbols.push(sym);
    });
    notify();
    return sym;
  }

  function deleteCustomSymbol(symbolId) {
    doc.commit('Delete custom fitting', d => {
      d.customSymbols = d.customSymbols.filter(s => s.id !== symbolId);
    });
    notify();
    return true;
  }

  /**
   * Removes stacked duplicates, keeping the FIRST device found at each
   * spot — same rule production states in its own report ("the first one
   * found in each spot is kept, the rest are removed"). One undo step
   * covers the whole cleanup, since it reads as a single action.
   */
  function removeDuplicates(groups) {
    const doomed = new Set();
    for (const g of groups) g.objs.slice(1).forEach(o => doomed.add(o.id));
    if (!doomed.size) return 0;
    doc.commit('Remove duplicates', d => {
      for (const f of d.floors) {
        f.objects = f.objects.filter(o => !doomed.has(o.id));
        removeLinksForObjects(f, doomed);
      }
    });
    selectedIds = new Set();
    notify();
    return doomed.size;
  }

  function setSymbolSize(px) {
    doc.commit('Set symbol size', d => {
      d.symbolSize = px;
    });
    notify();
  }

  // --- switch links (Phase 2) -----------------------------------------

  /**
   * Record "this switch controls this light". `group` may be null, in
   * which case the gang is worked out from what is already linked.
   * Gang recount and circuit propagation happen inside the same commit,
   * so one link is one undo step and the derived state can never be
   * committed half-updated.
   */
  function linkLight(switchId, lightId, group) {
    let created = false;
    doc.commit('Link switch', d => {
      const f = currentFloor(d);
      f.switchLinks = f.switchLinks || [];
      const exists = f.switchLinks.find(l => l.switchId === switchId && l.lightId === lightId);
      if (exists) return false;
      const light = f.objects.find(o => o.id === lightId);
      if (!light) return false;
      const g = group || autoGroupForSwitchLink(f, switchId, light.symbolId);
      f.switchLinks.push({ switchId, lightId, group: g });
      recomputeSwitchGang(f, switchId);
      const swObj = f.objects.find(o => o.id === switchId);
      if (swObj) propagateSwitchCircuitToLinkedLights(f, swObj);
      created = true;
    });
    return created;
  }

  function unlinkLight(switchId, lightId) {
    doc.commit('Unlink switch', d => {
      const f = currentFloor(d);
      const before = (f.switchLinks || []).length;
      f.switchLinks = (f.switchLinks || []).filter(
        l => !(l.switchId === switchId && l.lightId === lightId)
      );
      if (f.switchLinks.length === before) return false;
      // Gang is only ever raised, so this will not drop the plate size —
      // it keeps the stored count consistent with what is still linked.
      recomputeSwitchGang(f, switchId);
    });
    notify();
  }

  /**
   * Arm the link tool for a specific switch. Passing `newGroup` starts a
   * deliberate new gang instead of letting the next light auto-join an
   * existing one — that's the "+ New group" action in the inspector.
   */
  function startLinking(switchId, newGroup) {
    tool = 'link';
    draft = null;
    linkPendingSwitch = switchId;
    activeLinkGroup = newGroup ? nextGroupForSwitch(floor(), switchId) : null;
    linkNotice = activeLinkGroup
      ? `Tap the light(s) for gang ${activeLinkGroup}`
      : 'Now tap the light(s) this switch controls';
    notify();
  }

  /**
   * Rename a bank; an empty name reverts to the derived description.
   * Coalesced, because this is fed by an input's onChange: without it,
   * typing a twelve-character name would cost twelve undo presses to
   * take back.
   */
  function setBankName(switchId, group, name) {
    doc.commit(
      'Name lighting bank',
      d => {
        const f = currentFloor(d);
        f.bankNames = f.bankNames || {};
        const key = switchId + '::' + (group || 1);
        const val = (name || '').trim();
        if (val) f.bankNames[key] = val;
        else delete f.bankNames[key];
      },
      { coalesce: true }
    );
    notify();
  }

  function toggleSwitchRuns() {
    showSwitchRuns = !showSwitchRuns;
    notify();
    return showSwitchRuns;
  }

  // --- circuits (Phase 3) ---------------------------------------------

  /** Adds a circuit. Returns false if the id is blank or already taken. */
  function addCircuit(fields) {
    const id = (fields.id || '').trim();
    if (!id) return false;
    let ok = false;
    doc.commit('Add circuit', d => {
      d.circuits = d.circuits || [];
      if (d.circuits.some(c => c.id === id)) return false;
      d.circuits.push(makeCircuit({ ...fields, id }));
      ok = true;
    });
    notify();
    return ok;
  }

  function updateCircuit(id, patch) {
    doc.commit('Edit circuit', d => {
      const c = (d.circuits || []).find(x => x.id === id);
      if (!c) return false;
      Object.assign(c, patch);
    });
    notify();
  }

  /**
   * Deletes a circuit and unassigns its devices. Production clears the
   * assignment on the current floor only; circuits are project-level, so
   * that leaves devices on other floors pointing at a circuit that no
   * longer exists — which then shows up as a phantom assignment in the
   * quote and schedule. Cleared across every floor here.
   */
  function deleteCircuit(id) {
    doc.commit('Delete circuit', d => {
      d.circuits = (d.circuits || []).filter(c => c.id !== id);
      for (const f of d.floors) {
        for (const o of f.objects) if (o.circuit === id) o.circuit = '';
      }
    });
    if (isolatedCircuitId === id) isolatedCircuitId = null;
    notify();
  }

  /**
   * Assigns devices to a circuit (or clears it with ''). A switch given
   * its own circuit is a hard active, and its lights loop off that same
   * run — so the assignment propagates, exactly as production does when
   * a switch's circuit is set.
   */
  function assignCircuit(ids, circuitId) {
    const set = new Set(ids);
    if (!set.size) return false;
    doc.commit(set.size > 1 ? `Assign ${set.size} devices` : 'Assign circuit', d => {
      const f = currentFloor(d);
      for (const o of f.objects) {
        if (!set.has(o.id)) continue;
        o.circuit = circuitId;
        propagateSwitchCircuitToLinkedLights(f, o);
      }
    });
    notify();
    return true;
  }

  /** Show one circuit's run alone; passing the current id clears it. */
  function toggleIsolatedCircuit(id) {
    isolatedCircuitId = isolatedCircuitId === id ? null : id;
    notify();
    return isolatedCircuitId;
  }

  /**
   * Main-switch rating for a board, keyed by the board's display label
   * exactly as production keys it — the panel schedule groups by that
   * same label, so the two must agree. A falsy or non-positive value
   * clears the entry rather than storing a zero that would read as a
   * 0 A board.
   */
  function setBoardMainSwitchAmps(boardLabel, amps) {
    doc.commit('Set main switch rating', d => {
      d.boardMainSwitchAmps = d.boardMainSwitchAmps || {};
      const val = parseFloat(amps);
      if (!val || val <= 0) delete d.boardMainSwitchAmps[boardLabel];
      else d.boardMainSwitchAmps[boardLabel] = val;
    });
    notify();
  }

  function toggleCircuitLabels() {
    showCircuitLabels = !showCircuitLabels;
    notify();
    return showCircuitLabels;
  }

  function cancelDraft() {
    draft = null;
    if (linkPendingSwitch) {
      linkPendingSwitch = null;
      activeLinkGroup = null;
      linkNotice = null;
    }
    notify();
  }

  function clearSegmentSelection() {
    selectedSegment = null;
    notify();
  }

  function setCableSize(size) {
    activeCableSize = size;
    notify();
  }

  /** Change an already-drawn cable's size/colour from the inspector. */
  function setSegmentCableSize(id, size) {
    doc.commit('Set cable size', d => {
      const c = currentFloor(d).cables.find(x => x.id === id);
      if (!c) return false;
      c.size = size.size;
      c.color = size.color;
    });
    notify();
  }

  function selectedSegmentObject() {
    if (!selectedSegment) return null;
    const spec = SEGMENT_KIND[selectedSegment.kind];
    if (!spec) return null;
    const item = (floor()[spec.collection] || []).find(s => s.id === selectedSegment.id);
    return item ? { kind: selectedSegment.kind, item } : null;
  }

  function setTool(next) {
    tool = next;
    draft = null;
    // Picking the link tool from the rail starts a fresh link, the same
    // way production's setTool clears both link variables. startLinking()
    // sets them again afterwards when a specific switch is being armed.
    linkPendingSwitch = null;
    activeLinkGroup = null;
    linkNotice = null;
    if (next !== 'place') {
      activeSymbolId = null;
      ghost = null;
    }
    if (next !== 'measure' && next !== 'calibrate') measure = null;
    notify();
  }

  function setActiveSymbol(id) {
    activeSymbolId = id;
    tool = 'place';
    notify();
  }

  // --- selection ------------------------------------------------------

  function select(ids) {
    selectedIds = new Set(ids);
    notify();
  }
  function clearSelection() {
    selectedIds = new Set();
    notify();
  }
  function selectAll() {
    selectedIds = new Set(
      floor()
        .objects.filter(selectable)
        .map(o => o.id)
    );
    notify();
  }

  function selectedObjects() {
    return floor().objects.filter(o => selectedIds.has(o.id));
  }

  // --- mutations (all via doc.commit) ---------------------------------

  function placeAt(world, symbolId) {
    let newId = null;
    doc.commit('Place device', d => {
      const f = currentFloor(d);
      newId = d.nextId++;
      f.objects.push({
        id: newId,
        symbolId,
        x: world.x,
        y: world.y,
        props: {},
      });
    });
    return newId;
  }

  function deleteSelected() {
    // A selected cable/wall/dimension is deleted by the same Delete key
    // and the same command — the user does not think of them as a
    // separate delete action.
    if (!selectedIds.size) return deleteSelectedSegment();

    const n = selectedIds.size;
    doc.commit(n > 1 ? `Delete ${n} devices` : 'Delete device', d => {
      const f = currentFloor(d);
      f.objects = f.objects.filter(o => !selectedIds.has(o.id));
      // Links pointing at a deleted device would otherwise survive as
      // invisible state that still counts towards a switch's gang.
      removeLinksForObjects(f, selectedIds);
    });
    selectedIds = new Set();
    notify();
    return true;
  }

  function duplicateSelected() {
    if (!selectedIds.size) return false;
    const created = [];
    doc.commit(selectedIds.size > 1 ? 'Duplicate devices' : 'Duplicate device', d => {
      const f = currentFloor(d);
      const step = gridWorldUnits(f);
      const copies = f.objects
        .filter(o => selectedIds.has(o.id))
        .map(o => ({
          ...o,
          props: { ...(o.props || {}) },
          id: d.nextId++,
          x: o.x + step,
          y: o.y + step,
        }));
      copies.forEach(c => {
        f.objects.push(c);
        created.push(c.id);
      });
    });
    selectedIds = new Set(created);
    notify();
    return true;
  }

  function nudgeSelected(dx, dy) {
    if (!selectedIds.size) return false;
    doc.commit(
      'Move device',
      d => {
        for (const o of currentFloor(d).objects)
          if (selectedIds.has(o.id)) {
            o.x += dx;
            o.y += dy;
          }
      },
      { coalesce: true }
    );
    notify();
    return true;
  }

  /** Exact numerical positioning from the inspector (§6). */
  function setObjectPosition(id, x, y) {
    doc.commit('Set position', d => {
      const o = currentFloor(d).objects.find(ob => ob.id === id);
      if (!o) return false;
      if (typeof x === 'number' && isFinite(x)) o.x = x;
      if (typeof y === 'number' && isFinite(y)) o.y = y;
    });
    notify();
  }

  /** Assign a single device to a room from the inspector. */
  function setObjectRoom(id, roomId) {
    doc.commit('Set room', d => {
      const o = currentFloor(d).objects.find(ob => ob.id === id);
      if (!o) return false;
      o.room = roomId || '';
    });
    notify();
  }

  function setObjectProps(id, patch) {
    doc.commit('Edit properties', d => {
      const o = currentFloor(d).objects.find(ob => ob.id === id);
      if (!o) return false;
      o.props = { ...(o.props || {}), ...patch };
    });
    notify();
  }

  /** Alignment for a multi-selection (§5: multi-select shows alignment). */
  function alignSelected(mode) {
    if (selectedIds.size < 2) return false;
    doc.commit('Align ' + mode, d => {
      const sel = currentFloor(d).objects.filter(o => selectedIds.has(o.id));
      const b = boundsOf(sel);
      if (!b) return false;
      for (const o of sel) {
        if (mode === 'left') o.x = b.minX;
        else if (mode === 'right') o.x = b.maxX;
        else if (mode === 'top') o.y = b.minY;
        else if (mode === 'bottom') o.y = b.maxY;
        else if (mode === 'hcentre') o.x = b.cx;
        else if (mode === 'vcentre') o.y = b.cy;
      }
    });
    notify();
    return true;
  }

  function distributeSelected(axis) {
    if (selectedIds.size < 3) return false;
    doc.commit('Distribute', d => {
      const sel = currentFloor(d).objects.filter(o => selectedIds.has(o.id));
      const key = axis === 'h' ? 'x' : 'y';
      sel.sort((a, b) => a[key] - b[key]);
      const first = sel[0][key],
        last = sel[sel.length - 1][key];
      const step = (last - first) / (sel.length - 1);
      sel.forEach((o, i) => {
        o[key] = first + step * i;
      });
    });
    notify();
    return true;
  }

  // --- pointer handling ------------------------------------------------

  function onPointerDown(e, rect) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Second finger down → switch to a pan+pinch gesture, abandoning
    // whatever single-finger gesture was starting. Prevents a two-finger
    // zoom from also dragging a device.
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      gesture = {
        type: 'pinch',
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startCentre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        startView: { ...getView() },
      };
      marquee = null;
      notify();
      return;
    }
    if (pointers.size > 2) return;

    const isTouch = e.pointerType === 'touch';
    const world = toWorld(e.clientX, e.clientY, rect);
    // Tolerance tracks the DRAWN symbol size, so what you can click always
    // matches what you can see (§8) — a Large symbol still hit-tested at
    // the default radius would feel dead near its edge.
    const tol = (symbolRadius() + (isTouch ? 10 : 2)) / getView().zoom; // fatter target for fingers (§12)
    const hit = hitTestObjects(floor().objects, world, tol, selectable);

    const wantsPan = spaceHeld || e.button === 1 || tool === 'pan';

    if (wantsPan) {
      gesture = { type: 'pan', startX: e.clientX, startY: e.clientY, startView: { ...getView() } };
      return;
    }

    if (tool === 'place' && activeSymbolId) {
      const s = computeSnap(world, null);
      const id = placeAt(s.point, activeSymbolId);
      selectedIds = new Set([id]);
      // Shift keeps placing (matches the production app's Shift-to-repeat
      // behaviour), otherwise drop back to Select so the thing just placed
      // can be adjusted immediately — the common next action.
      if (!e.shiftKey) {
        tool = 'select';
        activeSymbolId = null;
        ghost = null;
      }
      notify();
      return;
    }

    // Measure and calibrate share the two-point gesture. They differ only
    // in what happens on the second click: measure reports a distance,
    // calibrate asks what that distance really is and derives the
    // drawing's scale from it.
    if (tool === 'measure' || tool === 'calibrate') {
      const s = computeSnap(world, null);
      if (!measure || measure.b) {
        measure = { a: s.point, b: null };
      } else {
        measure = { a: measure.a, b: s.point };
        if (tool === 'calibrate' && onCalibrate) {
          const len = Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y);
          if (len > 0.5) onCalibrate(len);
        }
      }
      notify();
      return;
    }

    // Linear primitives — cable runs, walls and dimensions all share one
    // two-click gesture (click start, click end), matching production.
    // They differ only in which collection they land in and what they
    // carry, so the draw interaction is written once here rather than
    // three times.
    if (tool === 'cable' || tool === 'wall' || tool === 'dimension') {
      const s = computeSnap(world, null);
      if (!draft) {
        draft = { kind: tool, a: s.point, b: null };
      } else {
        const a = draft.a;
        const b = s.point;
        draft = null;
        // A zero-length segment is a mis-click, not a drawing — dropping
        // it here avoids leaving invisible artefacts that still hit-test.
        if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) commitSegment(tool, a, b);
      }
      notify();
      return;
    }

    // Link tool — tap a switch, then tap each light it controls. Ported
    // from production's `activeTool==='link'` branch, including the
    // refusals: tapping a light first, or the pending switch itself, is
    // corrected with a hint rather than silently ignored.
    if (tool === 'link') {
      if (!hit) {
        linkNotice = 'Tap a switch, then tap the light(s) it controls';
        notify();
        return;
      }
      if (!linkPendingSwitch) {
        if (isSwitchSymbol(hit.symbolId)) {
          linkPendingSwitch = hit.id;
          // activeLinkGroup stays as-is: null means "auto-detect the
          // switching function from device type".
          linkNotice = 'Now tap the light(s) this switch controls';
        } else {
          linkNotice = 'Tap a switch first, not a light';
        }
        notify();
        return;
      }
      if (hit.id === linkPendingSwitch) {
        linkNotice = 'Tap a light, not the switch itself';
        notify();
        return;
      }
      if (isSwitchSymbol(hit.symbolId)) {
        // Tapping another switch starts that switch instead — the usual
        // way to move on without going back to the rail.
        linkPendingSwitch = hit.id;
        activeLinkGroup = null;
        linkNotice = 'Now tap the light(s) this switch controls';
        notify();
        return;
      }
      const added = linkLight(linkPendingSwitch, hit.id, activeLinkGroup);
      linkNotice = added
        ? 'Linked. Tap another light, or tap a new switch to start again'
        : 'Already linked to this switch';
      notify();
      return;
    }

    // Select tool
    // Devices win over linear primitives when both are under the cursor:
    // a device is a smaller, more deliberate target, and cables are drawn
    // *between* devices so they overlap constantly.
    if (!hit) {
      const seg = hitTestLinear(world);
      if (seg) {
        selectedIds = new Set();
        selectedSegment = { kind: seg.kind, id: seg.item.id };
        notify();
        return;
      }
      if (selectedSegment) {
        selectedSegment = null;
        notify();
      }
    } else {
      selectedSegment = null;
    }

    if (hit) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (selectedIds.has(hit.id)) selectedIds.delete(hit.id);
        else selectedIds.add(hit.id);
        selectedIds = new Set(selectedIds);
      } else if (!selectedIds.has(hit.id)) {
        selectedIds = new Set([hit.id]);
      }
      const moving = floor().objects.filter(o => selectedIds.has(o.id));
      gesture = {
        type: 'maybe-move',
        startX: e.clientX,
        startY: e.clientY,
        anchorId: hit.id,
        offsets: moving.map(o => ({ id: o.id, dx: o.x - world.x, dy: o.y - world.y })),
      };
      notify();
      return;
    }

    // Empty space
    if (isTouch) {
      gesture = { type: 'pan', startX: e.clientX, startY: e.clientY, startView: { ...getView() } };
    } else {
      if (!e.shiftKey) selectedIds = new Set();
      gesture = {
        type: 'maybe-marquee',
        startX: e.clientX,
        startY: e.clientY,
        startWorld: world,
        additive: e.shiftKey,
      };
    }
    notify();
  }

  function onPointerMove(e, rect) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesture && gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const factor = d / (gesture.startDist || 1);
      let v = { ...gesture.startView };
      // Pan by centre movement, then zoom about the current centre.
      v.offsetX += centre.x - gesture.startCentre.x;
      v.offsetY += centre.y - gesture.startCentre.y;
      v = zoomAt(v, centre.x - rect.left, centre.y - rect.top, factor);
      setView(v);
      notify();
      return;
    }

    const world = toWorld(e.clientX, e.clientY, rect);
    cursorWorld = world;

    if (!gesture) {
      // Hover + live placement ghost.
      const tol = (symbolRadius() + (e.pointerType === 'touch' ? 10 : 2)) / getView().zoom;
      const hit = hitTestObjects(floor().objects, world, tol, selectable);
      const nextHover = hit ? hit.id : null;
      if (tool === 'place' && activeSymbolId) {
        const s = computeSnap(world, null);
        ghost = s.point;
        snap = s;
      } else if ((tool === 'measure' || tool === 'calibrate') && measure && !measure.b) {
        snap = computeSnap(world, null);
      } else {
        snap = null;
      }
      if (nextHover !== hoverId || ghost || snap) {
        hoverId = nextHover;
        notify();
      }
      return;
    }

    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;

    if (gesture.type === 'maybe-move' && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      gesture = { ...gesture, type: 'move' };
    }
    if (gesture.type === 'maybe-marquee' && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      gesture = { ...gesture, type: 'marquee' };
    }

    if (gesture.type === 'pan') {
      setView({
        ...gesture.startView,
        offsetX: gesture.startView.offsetX + dx,
        offsetY: gesture.startView.offsetY + dy,
      });
      notify();
      return;
    }

    if (gesture.type === 'move') {
      const anchorOffset = gesture.offsets.find(o => o.id === gesture.anchorId);
      const anchorTarget = { x: world.x + anchorOffset.dx, y: world.y + anchorOffset.dy };
      // Snap the anchor, then move the whole selection by the same delta,
      // so a group keeps its internal spacing while still snapping.
      const s = computeSnap(anchorTarget, gesture.anchorId);
      snap = s;
      const shiftX = s.point.x - anchorTarget.x;
      const shiftY = s.point.y - anchorTarget.y;
      doc.commit(
        'Move device',
        d => {
          for (const off of gesture.offsets) {
            const o = currentFloor(d).objects.find(ob => ob.id === off.id);
            if (!o) continue;
            let nx = world.x + off.dx + shiftX;
            let ny = world.y + off.dy + shiftY;
            // Shift constrains to one axis — standard CAD modifier (§6).
            if (e.shiftKey) {
              const start = gesture.offsets.find(x => x.id === off.id);
              const originX = world.x + start.dx,
                originY = world.y + start.dy;
              if (Math.abs(dx) > Math.abs(dy)) ny = o.y;
              else nx = o.x;
              void originX;
              void originY;
            }
            o.x = nx;
            o.y = ny;
          }
        },
        { coalesce: true }
      );
      notify();
      return;
    }

    if (gesture.type === 'marquee') {
      marquee = { x1: gesture.startWorld.x, y1: gesture.startWorld.y, x2: world.x, y2: world.y };
      const inRect = objectsInRect(floor().objects, marquee, selectable);
      const ids = new Set(gesture.additive ? Array.from(selectedIds) : []);
      inRect.forEach(o => ids.add(o.id));
      selectedIds = ids;
      notify();
      return;
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2 && gesture && gesture.type === 'pinch') {
      gesture = null;
      notify();
      return;
    }
    if (gesture && gesture.type === 'move') doc.endCoalesce();
    // A press that never exceeded the drag threshold on an already-
    // selected object collapses the selection to just that object — the
    // familiar "click one of many to isolate it" behaviour.
    if (gesture && gesture.type === 'maybe-move' && selectedIds.size > 1 && !e.shiftKey) {
      selectedIds = new Set([gesture.anchorId]);
    }
    gesture = null;
    marquee = null;
    snap = null;
    notify();
  }

  /**
   * Right-click. Selects whatever is under the cursor first (unless it is
   * already part of the selection, so right-clicking one of several
   * selected devices acts on the whole group), then reports what was hit
   * so the menu can offer the right commands.
   */
  function onContextMenu(e, rect) {
    const world = toWorld(e.clientX, e.clientY, rect);
    const tol = (symbolRadius() + (e.pointerType === 'touch' ? 10 : 2)) / getView().zoom;
    const hit = hitTestObjects(floor().objects, world, tol, selectable);
    if (hit && !selectedIds.has(hit.id)) selectedIds = new Set([hit.id]);
    if (!hit) selectedIds = new Set();
    notify();
    return { onDevice: !!hit };
  }

  function onWheel(e, rect) {
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView(zoomAt(getView(), e.clientX - rect.left, e.clientY - rect.top, factor));
    notify();
  }

  function setSpaceHeld(v) {
    spaceHeld = v;
    notify();
  }

  function zoomBy(factor) {
    const vp = getViewport();
    setView(zoomAt(getView(), vp.width / 2, vp.height / 2, factor));
    notify();
  }

  return {
    // state readers
    get tool() {
      return tool;
    },
    get activeSymbolId() {
      return activeSymbolId;
    },
    get selectedIds() {
      return selectedIds;
    },
    get hoverId() {
      return hoverId;
    },
    get snap() {
      return snap;
    },
    get marquee() {
      return marquee;
    },
    get ghost() {
      return ghost;
    },
    get measure() {
      return measure;
    },
    get draft() {
      return draft;
    },
    get selectedSegment() {
      return selectedSegment;
    },
    get activeCableSize() {
      return activeCableSize;
    },
    get linkPendingSwitch() {
      return linkPendingSwitch;
    },
    get activeLinkGroup() {
      return activeLinkGroup;
    },
    get linkNotice() {
      return linkNotice;
    },
    get showSwitchRuns() {
      return showSwitchRuns;
    },
    get isolatedCircuitId() {
      return isolatedCircuitId;
    },
    get showCircuitLabels() {
      return showCircuitLabels;
    },
    get spaceHeld() {
      return spaceHeld;
    },
    get cursorWorld() {
      return cursorWorld;
    },
    get isPanning() {
      return !!gesture && gesture.type === 'pan';
    },
    selectedObjects,
    lockedIds,
    visible,
    selectable,
    isLayerHidden,

    // actions
    setSymbolResolver,
    setTool,
    setActiveSymbol,
    setCableSize,
    setSegmentCableSize,
    cancelDraft,
    clearSegmentSelection,
    addRoom,
    renameRoom,
    deleteRoom,
    assignSelectionToRoom,
    setObjectRoom,
    addCustomSymbol,
    deleteCustomSymbol,
    setSymbolSize,
    removeDuplicates,
    linkLight,
    unlinkLight,
    startLinking,
    setBankName,
    toggleSwitchRuns,
    addCircuit,
    updateCircuit,
    deleteCircuit,
    assignCircuit,
    toggleIsolatedCircuit,
    toggleCircuitLabels,
    setBoardMainSwitchAmps,
    deleteSelectedSegment,
    selectedSegmentObject,
    select,
    clearSelection,
    selectAll,
    placeAt,
    deleteSelected,
    duplicateSelected,
    nudgeSelected,
    setObjectPosition,
    setObjectProps,
    alignSelected,
    distributeSelected,
    clearMeasure() {
      measure = null;
      notify();
    },

    // input
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onContextMenu,
    setSpaceHeld,
    zoomBy,
  };
}
