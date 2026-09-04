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
  objectsInRect,
  boundsOf,
  zoomAt,
  gridWorldUnits,
  DEVICE_R,
} from './geometry.js';
import { snapPoint } from './snapping.js';
import { currentFloor } from './document.js';

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

  function setTool(next) {
    tool = next;
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
    if (!selectedIds.size) return false;
    const n = selectedIds.size;
    doc.commit(n > 1 ? `Delete ${n} devices` : 'Delete device', d => {
      const f = currentFloor(d);
      f.objects = f.objects.filter(o => !selectedIds.has(o.id));
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
    const tol = (DEVICE_R + (isTouch ? 10 : 2)) / getView().zoom; // fatter target for fingers (§12)
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

    // Select tool
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
      const tol = (DEVICE_R + (e.pointerType === 'touch' ? 10 : 2)) / getView().zoom;
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
    const tol = (DEVICE_R + (e.pointerType === 'touch' ? 10 : 2)) / getView().zoom;
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

    // actions
    setSymbolResolver,
    setTool,
    setActiveSymbol,
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
