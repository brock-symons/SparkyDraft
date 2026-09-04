// ===================================================================
// CIVIL / UNDERGROUND WORKS  (migration Phase 7)
//
// A parallel plan type, not a layer on the electrical plan. Production
// keeps `civilPlans[]` alongside `floors[]` and switches between them
// with `activePlanType`, and keeps the two render passes completely
// separate — none of the electrical drafting (devices, circuits,
// switch links, comms) means anything on a civil plan, and vice versa.
// That separation is preserved here for the same reason: it is what
// stops civil changes from touching rough-in code and back again.
//
// The libraries (pit types, conduit sizes, comms conduit sizes,
// building-entry services, poles, overhead conductors) are extracted
// verbatim into civilCatalog.js. Everything in this file is ported
// behaviour, not new design.
// ===================================================================

import {
  PIT_LIBRARY,
  CONDUIT_SIZES,
  COMMS_CONDUIT_SIZES,
  POLE_LIBRARY,
  OVERHEAD_CONDUCTOR_SIZES,
} from './civilCatalog.js';

/**
 * One civil plan. Matches production's makeCivilPlan() field-for-field.
 *
 * Note the grid default: 1000 mm, not the 100 mm a floor plan uses.
 * Civil work is measured in metres across a site, not millimetres across
 * a room, and the default has to match the job.
 */
export function makeCivilPlan(name) {
  return {
    id: 'CP-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    name,
    planImage: null,
    scale: null,
    view: { zoom: 1, offsetX: 0, offsetY: 0 },
    gridSpacingMM: 1000,
    snapEnabled: true,
    gridOriginX: 0,
    gridOriginY: 0,
    gridVisible: true,
    pits: [],
    conduits: [],
    buildingEntries: [],
    dimensions: [],
    poles: [],
    overheadRuns: [],
  };
}

export function currentCivilPlan(project) {
  return project.civilPlans[project.activeCivilPlanIndex] || project.civilPlans[0];
}

/** The plan being drafted, whichever type is active. */
export function currentPlan(project) {
  return project.activePlanType === 'civil'
    ? currentCivilPlan(project)
    : project.floors[project.activeFloorIndex] || project.floors[0];
}

/** Total world length of a multi-point run. Ported verbatim. */
export function conduitLength(conduit) {
  let total = 0;
  const pts = conduit.points || [];
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return total;
}

// --- object constructors, matching production's shapes ---------------

export function makePit(nextId, type, x, y) {
  return {
    id: 'PIT-' + String(nextId).padStart(3, '0'),
    typeId: type.id,
    x,
    y,
    label: '',
    notes: '',
    props: {
      material_cost: type.defaultProps.material_cost,
      labour_hours: type.defaultProps.labour_hours,
    },
  };
}

export function makeBuildingEntry(nextId, x, y, serviceTypes) {
  return {
    id: 'BE-' + String(nextId).padStart(3, '0'),
    x,
    y,
    label: '',
    serviceTypes: [...serviceTypes],
    notes: '',
  };
}

/**
 * A NETWORK pole (Ausgrid/Endeavour-owned) is an attachment point, not a
 * costed object — it deliberately has no type, height or stay wire, and
 * zero cost. Ported as-is: quoting for a pole the network owns would be
 * wrong.
 */
export function makePole(nextId, ownership, type, x, y) {
  const isPrivate = ownership === 'private';
  return {
    id: 'PL-' + String(nextId).padStart(3, '0'),
    ownership,
    typeId: isPrivate ? type.id : null,
    x,
    y,
    label: '',
    notes: '',
    height: isPrivate ? 8 : null,
    stayWire: false,
    stayRod: false,
    props: isPrivate
      ? {
          material_cost: type.defaultProps.material_cost,
          labour_hours: type.defaultProps.labour_hours,
        }
      : { material_cost: 0, labour_hours: 0 },
  };
}

export function makeConduit(nextId, points, category, sizeId) {
  return {
    id: 'CD-' + String(nextId).padStart(3, '0'),
    points,
    category: category || 'electrical',
    sizeId,
    fromPitId: null,
    fromBuildingEntryId: null,
    fromPoleId: null,
    toPitId: null,
    toBuildingEntryId: null,
    toPoleId: null,
    // 'ugoh' (underground → overhead) once linked to a pole.
    transition: null,
  };
}

export function makeOverheadRun(nextId, points, sizeId) {
  return {
    id: 'OH-' + String(nextId).padStart(3, '0'),
    points,
    sizeId,
    fromPoleId: null,
    fromBuildingEntryId: null,
    toPoleId: null,
    toBuildingEntryId: null,
    // 'ohug' (overhead → underground) once linked to a pole.
    transition: null,
  };
}

export function conduitSizeTable(category) {
  return category === 'comms' ? COMMS_CONDUIT_SIZES : CONDUIT_SIZES;
}

export function conduitSize(conduit) {
  return conduitSizeTable(conduit.category).find(s => s.id === conduit.sizeId) || null;
}

export function overheadSize(run) {
  return OVERHEAD_CONDUCTOR_SIZES.find(s => s.id === run.sizeId) || null;
}

// --- takeoff / quoting ------------------------------------------------

/**
 * Materials + labour across EVERY civil plan, for the whole-job line on
 * the main quote. Ported verbatim, including the deliberate simplicity:
 * no per-type breakdown, because this only answers "does civil work add
 * real money to this job".
 *
 * Note conduit metreage needs the plan's calibration — an uncalibrated
 * plan contributes zero length (and so zero cost) rather than guessing.
 */
export function computeAllCivilTotals(project, labourRate) {
  let materials = 0,
    labourCost = 0;
  (project.civilPlans || []).forEach(plan => {
    (plan.pits || []).forEach(p => {
      materials += p.props.material_cost || 0;
      labourCost += (p.props.labour_hours || 0) * labourRate;
    });
    (plan.conduits || []).forEach(cd => {
      const size = conduitSize(cd);
      if (!size || !plan.scale) return;
      const lenM = conduitLength(cd) / plan.scale;
      materials += lenM * size.material_cost_per_m;
      labourCost += lenM * size.labour_hours_per_m * labourRate;
    });
  });
  return { materials, labourCost, total: materials + labourCost };
}

/**
 * The civil materials takeoff for ONE plan — the data behind
 * production's Civil Materials sheet, with the DOM writing stripped out.
 *
 * Electrical and comms conduit are reported as separate sections feeding
 * one shared total, deliberately: "how much comms conduit is on this
 * job" should not require filtering the electrical metreage out by hand.
 *
 * Poles group by ownership AND type, so network poles (which cost
 * nothing) never merge into a private pole line.
 */
export function buildCivilSchedule(plan, labourRate) {
  let materials = 0,
    labourCost = 0;

  const pitRows = [...new Set((plan.pits || []).map(p => p.typeId))].map(typeId => {
    const type = PIT_LIBRARY.find(t => t.id === typeId);
    const of = (plan.pits || []).filter(p => p.typeId === typeId);
    const cost = of.reduce((s, p) => s + (p.props.material_cost || 0), 0);
    const labour = of.reduce((s, p) => s + (p.props.labour_hours || 0), 0);
    materials += cost;
    labourCost += labour * labourRate;
    return {
      label: type ? type.label : typeId,
      count: of.length,
      each: of.length ? cost / of.length : 0,
      cost,
    };
  });

  function conduitRows(list, sizeTable) {
    return [...new Set(list.map(cd => cd.sizeId))].map(sizeId => {
      const size = sizeTable.find(s => s.id === sizeId);
      const group = list.filter(cd => cd.sizeId === sizeId);
      const lenWorld = group.reduce((s, cd) => s + conduitLength(cd), 0);
      const lenM = plan.scale ? lenWorld / plan.scale : 0;
      const cost = size ? lenM * size.material_cost_per_m : 0;
      const labour = size ? lenM * size.labour_hours_per_m : 0;
      materials += cost;
      labourCost += labour * labourRate;
      return {
        label: size ? size.size || size.label : sizeId,
        metres: lenM,
        perM: size ? size.material_cost_per_m : null,
        cost,
      };
    });
  }

  const electricalConduit = conduitRows(
    (plan.conduits || []).filter(cd => cd.category !== 'comms'),
    CONDUIT_SIZES
  );
  const commsConduit = conduitRows(
    (plan.conduits || []).filter(cd => cd.category === 'comms'),
    COMMS_CONDUIT_SIZES
  );

  const poleRows = [
    ...new Set((plan.poles || []).map(p => p.ownership + '|' + (p.typeId || ''))),
  ].map(key => {
    const [ownership, typeId] = key.split('|');
    const type = ownership === 'private' ? POLE_LIBRARY.find(t => t.id === typeId) : null;
    const of = (plan.poles || []).filter(
      p => p.ownership === ownership && (p.typeId || '') === typeId
    );
    const cost = of.reduce((s, p) => s + (p.props.material_cost || 0), 0);
    const labour = of.reduce((s, p) => s + (p.props.labour_hours || 0), 0);
    materials += cost;
    labourCost += labour * labourRate;
    return {
      label: ownership === 'network' ? 'Network pole' : type ? type.label : 'Pole',
      count: of.length,
      each: of.length ? cost / of.length : 0,
      cost,
    };
  });

  const overheadRows = [...new Set((plan.overheadRuns || []).map(r => r.sizeId))].map(sizeId => {
    const size = OVERHEAD_CONDUCTOR_SIZES.find(s => s.id === sizeId);
    const runs = (plan.overheadRuns || []).filter(r => r.sizeId === sizeId);
    const lenWorld = runs.reduce((s, r) => s + conduitLength(r), 0);
    const lenM = plan.scale ? lenWorld / plan.scale : 0;
    const cost = size ? lenM * size.material_cost_per_m : 0;
    const labour = size ? lenM * size.labour_hours_per_m : 0;
    materials += cost;
    labourCost += labour * labourRate;
    return {
      label: size ? size.label : sizeId,
      metres: lenM,
      perM: size ? size.material_cost_per_m : null,
      cost,
    };
  });

  const ugoh = (plan.conduits || []).filter(cd => cd.transition === 'ugoh').length;
  const ohug = (plan.overheadRuns || []).filter(r => r.transition === 'ohug').length;

  return {
    pitRows,
    electricalConduit,
    commsConduit,
    poleRows,
    overheadRows,
    buildingEntryCount: (plan.buildingEntries || []).length,
    transitions: { ugoh, ohug, total: ugoh + ohug },
    materials,
    labourCost,
    total: materials + labourCost,
    calibrated: !!plan.scale,
  };
}
