// ===================================================================
// CLOUD RECORD FORMAT  (Phase 10)
//
// The `projects.data` / `organization_projects.data` jsonb columns hold
// whatever shape the app that wrote them used. Production writes
// buildProjectData()'s shape; the redesign's document model (Phase 0)
// is close but not identical.
//
// The end-state confirmed in CLAUDE.md is that `app/` REPLACES
// index.html. That makes interop non-optional rather than a nicety:
// every project already in a customer's cloud account was written by
// production and has to keep opening after the cutover, and while both
// apps are live the same row may be written by either one. So the wire
// format on those columns stays PRODUCTION'S shape, and this file is
// the only place that converts.
//
// Three rules it follows:
//
//  1. **Production's field names win.** `planImageData`, `layers`,
//     `priceListOverrides` — the redesign's own names never reach the
//     column. A record this file writes is one production can open.
//  2. **Nothing production wrote is thrown away.** Keys production
//     saves that the redesign has no model for (`gridOverlay` today)
//     ride along in `__extras` and are re-emitted verbatim, so opening
//     a project in the redesign and saving it back cannot silently
//     strip a field the other app still reads.
//  3. **Redesign-only fields are additive.** `nextId`, `priceList`,
//     `quoteItemized` and per-plan image placement are written as extra
//     top-level keys. Production's applyLoadedProject() reads by name
//     and ignores what it does not recognise, so they are invisible to
//     it — but if production re-saves that project, buildProjectData()
//     rebuilds the record from its own state and those keys are gone.
//     That loss is real and one-directional; see the note on
//     `planImagePlacement` below and MIGRATION_INVENTORY.md §I.
// ===================================================================

import { LAYER_DEFS } from './catalog.js';
import { emptyProject, makeFloor } from './document.js';
import { makeCivilPlan } from './civil.js';

/** Production keys this module maps explicitly; everything else is kept in __extras. */
const MAPPED_KEYS = new Set([
  'id',
  'name',
  'activeFloorIndex',
  'activeCivilPlanIndex',
  'activePlanType',
  'customSymbols',
  'symbolSize',
  'priceListOverrides',
  'boardMainSwitchAmps',
  'unassignedCommsPorts',
  'floors',
  'civilPlans',
  'layers',
  'circuits',
  'elevations',
  'rateLabour',
  'rateMargin',
  'costEquipment',
  'costTravel',
  // redesign-only additive keys — read back, not treated as unknown
  'nextId',
  'priceList',
  'quoteItemized',
  'activeElevationId',
  'hiddenLayers',
  'lockedLayers',
]);

/**
 * Production stores the four money/rate fields as DOM input strings
 * ("95"), because that is literally what it reads out of the inputs. The
 * redesign models them as numbers, so a record it saves narrows the type
 * — the ONE format difference this module knowingly introduces.
 *
 * Production is unaffected: applyLoadedProject() writes each value
 * straight into an <input>.value, and the DOM stringifies on assignment,
 * so it reads back exactly the string it had before and its next save
 * writes a string again. Nothing else in either app reads these off the
 * record. Recorded in MIGRATION_INVENTORY.md rather than worked around,
 * because faking a string here would mean the redesign carrying a type
 * it does not use purely to look untouched.
 */
function num(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// --- floors ----------------------------------------------------------

function floorToProduction(f) {
  const out = {
    id: f.id,
    name: f.name,
    scale: f.scale,
    gridSpacingMM: f.gridSpacingMM,
    snapEnabled: f.snapEnabled,
    gridOriginX: f.gridOriginX || 0,
    gridOriginY: f.gridOriginY || 0,
    gridVisible: f.gridVisible !== false,
    gridAlignWallId: f.gridAlignWallId || null,
    objects: f.objects,
    cables: f.cables,
    dimensions: f.dimensions,
    switchLinks: f.switchLinks,
    walls: f.walls,
    rooms: f.rooms,
    bankNames: f.bankNames || {},
    planImageData: f.planImage ? f.planImage.src : null,
  };
  // Production keeps only the data URL — it has no concept of an underlay
  // being moved, scaled or faded, so a round trip THROUGH production loses
  // placement and the plan snaps back to the origin at 100%. Carried in an
  // additive key so redesign→cloud→redesign is lossless; redesign→cloud→
  // production→cloud→redesign is not, and cannot be without production
  // learning the field.
  // Only when there is real placement to carry. A record production
  // wrote has no dimensions to reconstruct, so planImage comes back with
  // width 0 — writing that back as a "placement" would both add a key to
  // a record the redesign only opened and read, and later be mistaken
  // for a deliberate 0×0 underlay rather than an unknown one.
  if (f.planImage && f.planImage.width) out.planImagePlacement = imagePlacement(f.planImage);
  return out;
}

function imagePlacement(img) {
  return {
    width: img.width,
    height: img.height,
    x: img.x,
    y: img.y,
    scale: img.scale,
    opacity: img.opacity,
  };
}

/**
 * Rebuilds the redesign's planImage from production's flat data URL.
 * width/height stay 0 when production wrote the record: the natural size
 * is only knowable once the image decodes, and core/ is DOM-free so it
 * cannot decode one. Nothing renders wrong — drawPlanImage() measures the
 * loaded <img>, not these fields; only "fit to plan" bounds ignore an
 * underlay of unknown size, which is what production does too.
 */
function planImageFrom(src, placement) {
  if (!src) return null;
  const p = placement || {};
  return {
    src,
    width: p.width || 0,
    height: p.height || 0,
    x: p.x || 0,
    y: p.y || 0,
    scale: p.scale || 1,
    opacity: p.opacity == null ? 0.85 : p.opacity,
  };
}

function floorFromProduction(fd) {
  const base = makeFloor(fd.name || 'Floor');
  return {
    ...base,
    id: fd.id || base.id,
    name: fd.name || 'Floor',
    scale: fd.scale || null,
    gridSpacingMM: fd.gridSpacingMM || 100,
    snapEnabled: fd.snapEnabled !== false,
    gridOriginX: fd.gridOriginX || 0,
    gridOriginY: fd.gridOriginY || 0,
    gridVisible: fd.gridVisible !== false,
    gridAlignWallId: fd.gridAlignWallId || null,
    objects: fd.objects || [],
    cables: fd.cables || [],
    dimensions: fd.dimensions || [],
    switchLinks: fd.switchLinks || [],
    walls: fd.walls || [],
    rooms: fd.rooms || [],
    bankNames: fd.bankNames || {},
    planImage: planImageFrom(fd.planImageData, fd.planImagePlacement),
  };
}

// --- civil plans -----------------------------------------------------

function civilToProduction(cp) {
  const out = {
    id: cp.id,
    name: cp.name,
    scale: cp.scale,
    gridSpacingMM: cp.gridSpacingMM,
    snapEnabled: cp.snapEnabled,
    gridOriginX: cp.gridOriginX || 0,
    gridOriginY: cp.gridOriginY || 0,
    gridVisible: cp.gridVisible !== false,
    pits: cp.pits,
    conduits: cp.conduits,
    buildingEntries: cp.buildingEntries,
    dimensions: cp.dimensions,
    poles: cp.poles,
    overheadRuns: cp.overheadRuns,
    planImageData: cp.planImage ? cp.planImage.src : null,
  };
  if (cp.planImage && cp.planImage.width) out.planImagePlacement = imagePlacement(cp.planImage);
  return out;
}

function civilFromProduction(cd) {
  const base = makeCivilPlan(cd.name || 'Civil');
  return {
    ...base,
    id: cd.id || base.id,
    name: cd.name || 'Civil',
    scale: cd.scale || null,
    gridSpacingMM: cd.gridSpacingMM || 1000,
    snapEnabled: cd.snapEnabled !== false,
    gridOriginX: cd.gridOriginX || 0,
    gridOriginY: cd.gridOriginY || 0,
    gridVisible: cd.gridVisible !== false,
    pits: cd.pits || [],
    conduits: cd.conduits || [],
    buildingEntries: cd.buildingEntries || [],
    dimensions: cd.dimensions || [],
    poles: cd.poles || [],
    overheadRuns: cd.overheadRuns || [],
    planImage: planImageFrom(cd.planImageData, cd.planImagePlacement),
  };
}

// --- layers ----------------------------------------------------------
//
// Production persists the whole layer list with per-layer visible/locked
// flags; the redesign persists only the two id lists and rebuilds the
// rest from LAYER_DEFS (identical in both apps). Production filters the
// synthetic 'cable' layer out before saving, so this does too.

function layersToProduction(project) {
  const hidden = project.hiddenLayers || [];
  const locked = project.lockedLayers || [];
  return LAYER_DEFS.map(l => ({
    ...l,
    visible: !hidden.includes(l.id),
    locked: locked.includes(l.id),
  }));
}

function layersFromProduction(layers) {
  if (!Array.isArray(layers)) return { hiddenLayers: [], lockedLayers: [] };
  return {
    hiddenLayers: layers.filter(l => l && l.visible === false).map(l => l.id),
    lockedLayers: layers.filter(l => l && l.locked).map(l => l.id),
  };
}

// --- price list ------------------------------------------------------
//
// Production saves an entry for EVERY symbol (its whole live library) and
// applies them back onto SYMBOL_LIBRARY on load. The redesign stores only
// actual edits, keyed by id (see core/symbols.js). Converting out writes
// production's full-library form so production still applies the edits;
// converting in keeps only entries that differ from the shipped catalog,
// so a project that never touched the price list does not arrive with 40
// no-op overrides.

function priceListToProduction(project, catalog) {
  const edits = project.priceList || {};
  return catalog.map(s => {
    const o = edits[s.id] || {};
    return {
      id: s.id,
      label: o.label != null && o.label !== '' ? o.label : s.label,
      material_cost: o.material_cost != null ? o.material_cost : s.defaultProps.material_cost,
      labour_hours: o.labour_hours != null ? o.labour_hours : s.defaultProps.labour_hours,
      watts: o.watts != null ? o.watts : s.defaultProps.watts,
    };
  });
}

function priceListFromProduction(overrides, catalog) {
  const out = {};
  if (!Array.isArray(overrides)) return out;
  const byId = new Map(catalog.map(s => [s.id, s]));
  overrides.forEach(po => {
    if (!po || !po.id) return;
    const base = byId.get(po.id);
    // A custom fitting has no catalog entry to differ from — its own
    // record already carries its prices, so an override row for it is
    // only meaningful if the price list was actually edited afterwards.
    if (!base) return;
    const entry = {};
    if (po.label != null && po.label !== '' && po.label !== base.label) entry.label = po.label;
    if (po.material_cost != null && po.material_cost !== base.defaultProps.material_cost)
      entry.material_cost = po.material_cost;
    if (po.labour_hours != null && po.labour_hours !== base.defaultProps.labour_hours)
      entry.labour_hours = po.labour_hours;
    if (po.watts != null && po.watts !== base.defaultProps.watts) entry.watts = po.watts;
    if (Object.keys(entry).length) out[po.id] = entry;
  });
  return out;
}

// --- the two public conversions --------------------------------------

/**
 * Redesign project → the shape written to `data`. `catalog` is passed in
 * rather than imported so the price-list conversion sees custom fittings
 * too; callers pass allSymbols(project).
 */
export function toCloudRecord(project, catalog) {
  const extras = project.__extras || {};
  return {
    // Anything production wrote that the redesign has no model for goes
    // back first, so an explicit field below always wins over a stale
    // copy of itself.
    ...extras,

    id: project.id,
    name: project.name,
    activeFloorIndex: project.activeFloorIndex,
    activeCivilPlanIndex: project.activeCivilPlanIndex,
    activePlanType: project.activePlanType,
    customSymbols: project.customSymbols || [],
    symbolSize: project.symbolSize,
    priceListOverrides: priceListToProduction(project, catalog),
    boardMainSwitchAmps: project.boardMainSwitchAmps || {},
    unassignedCommsPorts: project.unassignedCommsPorts || [],
    floors: (project.floors || []).map(floorToProduction),
    civilPlans: (project.civilPlans || []).map(civilToProduction),
    layers: layersToProduction(project),
    circuits: project.circuits || [],
    elevations: project.elevations || [],
    rateLabour: project.rateLabour,
    rateMargin: project.rateMargin,
    costEquipment: project.costEquipment,
    costTravel: project.costTravel,

    // Additive — production ignores these on read and drops them if it
    // re-saves. nextId matters most: without it the redesign restarts its
    // object-id counter and can collide with ids already on the drawing,
    // so it is rebuilt defensively on the way in rather than trusted.
    nextId: project.nextId,
    priceList: project.priceList || {},
    quoteItemized: !!project.quoteItemized,
    activeElevationId: project.activeElevationId || null,
  };
}

/**
 * `data` from a cloud row → a redesign project. Tolerates both shapes:
 * a record production wrote (no additive keys) and one this module
 * wrote. `id` is passed separately because the row id is authoritative
 * for older records saved before `data.id` existed — the same reason
 * production's applyLoadedProject() takes it from the caller.
 */
export function fromCloudRecord(data, catalog, rowId) {
  const base = emptyProject();
  const d = data || {};

  const extras = {};
  Object.keys(d).forEach(k => {
    if (!MAPPED_KEYS.has(k)) extras[k] = d[k];
  });

  const floors = (d.floors && d.floors.length ? d.floors : [{ name: 'Ground Floor' }]).map(
    floorFromProduction
  );
  const civilPlans = (d.civilPlans || []).map(civilFromProduction);
  const layerState = d.layers
    ? layersFromProduction(d.layers)
    : { hiddenLayers: d.hiddenLayers || [], lockedLayers: d.lockedLayers || [] };

  const project = {
    ...base,
    id: d.id || rowId || base.id,
    name: d.name || 'Untitled project',
    floors,
    // A stored index can point past the end if the record was written by
    // an app version with more floors — clamp rather than hand the rest
    // of the app an undefined current floor.
    activeFloorIndex: clampIndex(d.activeFloorIndex, floors.length),
    civilPlans,
    activeCivilPlanIndex: clampIndex(d.activeCivilPlanIndex, civilPlans.length),
    activePlanType: d.activePlanType === 'civil' && civilPlans.length ? 'civil' : 'floor',
    circuits: d.circuits || [],
    elevations: d.elevations || [],
    activeElevationId: d.activeElevationId || null,
    boardMainSwitchAmps: d.boardMainSwitchAmps || {},
    unassignedCommsPorts: d.unassignedCommsPorts || [],
    customSymbols: d.customSymbols || [],
    rateLabour: num(d.rateLabour, 95),
    rateMargin: num(d.rateMargin, 20),
    costEquipment: num(d.costEquipment, 0),
    costTravel: num(d.costTravel, 0),
    quoteItemized: !!d.quoteItemized,
    priceList: d.priceList || priceListFromProduction(d.priceListOverrides, catalog),
    symbolSize: d.symbolSize || 16,
    hiddenLayers: layerState.hiddenLayers,
    lockedLayers: layerState.lockedLayers,
    nextId: nextIdFor(d, floors),
  };
  if (Object.keys(extras).length) project.__extras = extras;
  return project;
}

function clampIndex(v, len) {
  const n = typeof v === 'number' ? v : 0;
  if (!len) return 0;
  return n >= 0 && n < len ? n : 0;
}

/**
 * A record production wrote has no nextId, and trusting a stale one from
 * any source risks minting an id that is already on the drawing. Derived
 * from the highest numeric suffix actually present, which is correct for
 * both cases.
 */
function nextIdFor(d, floors) {
  let max = 0;
  const scan = list =>
    (list || []).forEach(o => {
      // Every generated id is `PREFIX-NNN` (see controller.js) — the
      // trailing number is the counter value that produced it.
      const m = /(\d+)\s*$/.exec(String(o && o.id));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });

  floors.forEach(f => {
    scan(f.objects);
    scan(f.cables);
    scan(f.dimensions);
    scan(f.rooms);
  });
  (d.civilPlans || []).forEach(cp => {
    scan(cp.pits);
    scan(cp.conduits);
    scan(cp.buildingEntries);
    scan(cp.poles);
    scan(cp.overheadRuns);
    scan(cp.dimensions);
  });
  scan(d.elevations);

  const stored = typeof d.nextId === 'number' ? d.nextId : 0;
  return Math.max(stored, max + 1, 1);
}
