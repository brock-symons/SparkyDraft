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
 * the main quote. Ported VERBATIM, including two things that look like
 * omissions and are reproduced exactly rather than corrected:
 *
 *  * It counts pits and conduit only — poles and overhead runs are not
 *    in this total at all, even though the per-plan takeoff prices them.
 *  * Conduit size is looked up in CONDUIT_SIZES only, never
 *    COMMS_CONDUIT_SIZES, so a comms run (sizeId 'nbn40' etc.) finds no
 *    size and is skipped. Comms conduit therefore contributes nothing
 *    here while contributing normally to buildCivilSchedule() below.
 *
 * Both change a money figure, so neither is mine to "fix" — they are
 * recorded in MIGRATION_INVENTORY.md §I for the owner to decide. Using
 * the category-aware lookup here instead raised whole-job civil totals
 * by 10–50% on randomised jobs in the parity test, which is exactly the
 * kind of silent change this migration must not make on its own.
 *
 * Conduit metreage needs the plan's calibration — an uncalibrated plan
 * contributes zero length (and so zero cost) rather than guessing.
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
      const size = CONDUIT_SIZES.find(s => s.id === cd.sizeId);
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

// --- snapping ---------------------------------------------------------

/**
 * Civil snap precedence, ported verbatim from snapPointCivil(). This is
 * NOT a generalisation of the electrical snapPoint() — the electrical
 * semantics (layer visibility, wall projection, axis-align to device
 * centres) mean nothing on a civil plan. The order is:
 *
 *   1. a pit / building-entry / pole centre — so a conduit endpoint
 *      lands exactly on it and can record fromPitId / toPoleId / etc.
 *   2. an existing conduit vertex — so runs can share a junction
 *   3. the grid
 *
 * Returned in the same shape as the electrical snapper (point / guides /
 * target / reason) so the same HUD reports why it snapped.
 */
export function snapPointCivil(world, ctx) {
  const empty = {
    point: { x: world.x, y: world.y },
    guides: [],
    target: null,
    reason: null,
    hit: null,
  };
  if (!ctx || ctx.enabled === false) return empty;

  const plan = ctx.plan;
  const tol = 14 / ctx.zoom;
  const opts = ctx.exclude || {};

  let best = null,
    bestDist = tol * 1.25;
  const consider = (item, kind, excludeId, label) => {
    if (item.id === excludeId) return;
    const d = Math.hypot(item.x - world.x, item.y - world.y);
    if (d < bestDist) {
      bestDist = d;
      best = { x: item.x, y: item.y, hit: { kind, id: item.id }, label };
    }
  };
  (plan.pits || []).forEach(p => consider(p, 'pit', opts.pitId, 'Pit centre'));
  (plan.buildingEntries || []).forEach(b =>
    consider(b, 'buildingEntry', opts.buildingEntryId, 'Building entry')
  );
  (plan.poles || []).forEach(pl => consider(pl, 'pole', opts.poleId, 'Pole centre'));
  if (best) {
    return {
      point: { x: best.x, y: best.y },
      guides: [],
      target: { x: best.x, y: best.y },
      reason: best.label,
      hit: best.hit,
    };
  }

  let bestV = null,
    bestVDist = tol;
  (plan.conduits || []).forEach(cd => {
    (cd.points || []).forEach((pt, idx) => {
      if (opts.vertex && opts.vertex.runId === cd.id && opts.vertex.vertexIndex === idx) return;
      const d = Math.hypot(pt.x - world.x, pt.y - world.y);
      if (d < bestVDist) {
        bestVDist = d;
        bestV = { x: pt.x, y: pt.y };
      }
    });
  });
  if (bestV) {
    return {
      point: { x: bestV.x, y: bestV.y },
      guides: [],
      target: { x: bestV.x, y: bestV.y },
      reason: 'Conduit vertex',
      hit: null,
    };
  }

  const gridStep = ctx.gridStep;
  const ox = plan.gridOriginX || 0,
    oy = plan.gridOriginY || 0;
  const guides = [];
  const point = {
    x: Math.round((world.x - ox) / gridStep) * gridStep + ox,
    y: Math.round((world.y - oy) / gridStep) * gridStep + oy,
  };
  if (Math.abs(point.x - world.x) < tol * 1.5)
    guides.push({ axis: 'x', value: point.x, kind: 'grid', label: 'Grid' });
  if (Math.abs(point.y - world.y) < tol * 1.5)
    guides.push({ axis: 'y', value: point.y, kind: 'grid', label: 'Grid' });
  return { point, guides, target: null, reason: guides.length ? 'Grid' : null, hit: null };
}

// --- hit testing ------------------------------------------------------
//
// Kept as separate entry points per entity type rather than one generic
// helper, matching production's own convention for civil entities. The
// types genuinely diverge (a pole carries ownership, a run carries
// vertices) and collapsing them would only move the branching elsewhere.

function pointHit(list, world, tol) {
  return list
    .slice()
    .reverse()
    .find(p => Math.hypot(p.x - world.x, p.y - world.y) < tol);
}

export function hitTestPit(plan, world, symbolSize, zoom) {
  return pointHit(plan.pits || [], world, (symbolSize + 4) / zoom);
}
export function hitTestBuildingEntry(plan, world, symbolSize, zoom) {
  return pointHit(plan.buildingEntries || [], world, (symbolSize + 4) / zoom);
}
export function hitTestPole(plan, world, symbolSize, zoom) {
  return pointHit(plan.poles || [], world, (symbolSize + 4) / zoom);
}

function distToSegment(p, a, b) {
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function segmentHit(runs, world, tol) {
  let best = null,
    bestDist = tol;
  runs
    .slice()
    .reverse()
    .forEach(run => {
      for (let i = 0; i < run.points.length - 1; i++) {
        const d = distToSegment(world, run.points[i], run.points[i + 1]);
        if (d < bestDist) {
          bestDist = d;
          best = { run, segmentIndex: i };
        }
      }
    });
  return best;
}

export function hitTestConduitSegment(plan, world, zoom) {
  return segmentHit(plan.conduits || [], world, 14 / zoom);
}
export function hitTestOverheadRunSegment(plan, world, zoom) {
  return segmentHit(plan.overheadRuns || [], world, 14 / zoom);
}

/**
 * Only ever called against the ALREADY-selected run: vertex handles are
 * drawn, and interactive, only on a selected run — hit-testing every
 * vertex of every run on every pointerdown would be wasted work.
 */
export function hitTestVertex(run, world, zoom) {
  if (!run) return null;
  const tol = 10 / zoom;
  for (let i = 0; i < run.points.length; i++) {
    if (Math.hypot(run.points[i].x - world.x, run.points[i].y - world.y) < tol) return i;
  }
  return null;
}

// --- legend -----------------------------------------------------------

/**
 * Legend rows for a civil plan. Ported verbatim.
 *
 * Conduits are split by CATEGORY before grouping by size, each category
 * looking up its own size table — otherwise an electrical 40 mm and a
 * comms 40 mm would merge into one row despite being different products,
 * because they share a sizeId string.
 *
 * UGOH/OHUG transitions are counted as their own legend concept rather
 * than folded into run metreage: a run that changes medium at a pole is
 * a different thing to another length of the same conduit.
 */
export function computeCivilLegendEntries(plan) {
  const pitEntries = [...new Set((plan.pits || []).map(p => p.typeId))].map(typeId => {
    const type = PIT_LIBRARY.find(t => t.id === typeId);
    return {
      kind: 'pit',
      color: type ? type.color : '#94a3b8',
      abbr: type ? type.abbr : '?',
      label: type ? type.label : typeId,
      count: (plan.pits || []).filter(p => p.typeId === typeId).length,
    };
  });

  const conduitGroup = (list, sizeTable, prefix, kind, fallbackColor) =>
    [...new Set(list.map(cd => cd.sizeId))].map(sizeId => {
      const size = sizeTable.find(s => s.id === sizeId);
      const cds = list.filter(cd => cd.sizeId === sizeId);
      const lenWorld = cds.reduce((s, cd) => s + conduitLength(cd), 0);
      return {
        kind,
        color: size ? size.color : fallbackColor,
        abbr: size ? size.size.replace('mm', '') : '?',
        label: prefix + ' — ' + (size ? size.size : sizeId) + ' conduit',
        count: cds.length,
        lengthM: plan.scale ? lenWorld / plan.scale : null,
      };
    });

  const conduitEntries = conduitGroup(
    (plan.conduits || []).filter(cd => cd.category !== 'comms'),
    CONDUIT_SIZES,
    'UG electrical',
    'conduit',
    '#f97316'
  );
  const commsConduitEntries = conduitGroup(
    (plan.conduits || []).filter(cd => cd.category === 'comms'),
    COMMS_CONDUIT_SIZES,
    'UG comms',
    'conduit-comms',
    '#38bdf8'
  );

  const overheadEntries = [...new Set((plan.overheadRuns || []).map(r => r.sizeId))].map(sizeId => {
    const size = OVERHEAD_CONDUCTOR_SIZES.find(s => s.id === sizeId);
    const runs = (plan.overheadRuns || []).filter(r => r.sizeId === sizeId);
    const lenWorld = runs.reduce((s, r) => s + conduitLength(r), 0);
    return {
      kind: 'overhead',
      color: size ? size.color : '#7c3aed',
      abbr: 'OH',
      label: 'OH electrical — ' + (size ? size.label : sizeId),
      count: runs.length,
      lengthM: plan.scale ? lenWorld / plan.scale : null,
    };
  });

  const beCount = (plan.buildingEntries || []).length;
  const beEntry = beCount
    ? [
        {
          kind: 'buildingEntry',
          color: '#38bdf8',
          abbr: 'BE',
          label: 'Building entry',
          count: beCount,
        },
      ]
    : [];

  const poleEntries = [
    ...new Set((plan.poles || []).map(p => p.ownership + '|' + (p.typeId || ''))),
  ].map(key => {
    const [ownership, typeId] = key.split('|');
    const type = ownership === 'private' ? POLE_LIBRARY.find(t => t.id === typeId) : null;
    const poles = (plan.poles || []).filter(
      p => p.ownership === ownership && (p.typeId || '') === typeId
    );
    return {
      kind: 'pole',
      color: type ? type.color : '#94a3b8',
      abbr: type ? type.abbr : 'NP',
      label: ownership === 'network' ? 'Network pole' : type ? type.label : 'Pole',
      count: poles.length,
    };
  });

  const ugohCount = (plan.conduits || []).filter(cd => cd.transition === 'ugoh').length;
  const ohugCount = (plan.overheadRuns || []).filter(r => r.transition === 'ohug').length;
  const transitionEntries = [
    ...(ugohCount
      ? [
          {
            kind: 'transition',
            color: '#facc15',
            abbr: 'UGOH',
            label: 'UGOH transition (underground to overhead)',
            count: ugohCount,
          },
        ]
      : []),
    ...(ohugCount
      ? [
          {
            kind: 'transition',
            color: '#facc15',
            abbr: 'OHUG',
            label: 'OHUG transition (overhead to underground)',
            count: ohugCount,
          },
        ]
      : []),
  ];

  return [
    ...pitEntries,
    ...conduitEntries,
    ...commsConduitEntries,
    ...overheadEntries,
    ...beEntry,
    ...poleEntries,
    ...transitionEntries,
  ];
}
