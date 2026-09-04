// ===================================================================
// CIVIL TAKEOFF / LEGEND — PARITY TEST AGAINST PRODUCTION
//
//   node app/test/civil-parity.mjs
//
// The civil side prices real materials: pits by type, conduit and
// overhead conductor by the metre off a calibrated plan, poles by
// ownership. Same rule as the other phases — the arithmetic is compared
// against the live index.html rather than eyeballed.
//
// production's updateCivilQuote() and computeAllCivilTotals() read their
// labour rate from a DOM input and write their results into table rows,
// so the extracted copies are given a stub document that supplies the
// rate and collects every cell written. The arithmetic between is the
// real production code, untouched.
//
// If this fails, fix the port — do not adjust the expectation.
// ===================================================================

import {
  extractFunction,
  buildProductionModule,
  makeComparer,
  makeRandom,
} from './extract-production.mjs';
import {
  conduitLength,
  computeAllCivilTotals,
  buildCivilSchedule,
  computeCivilLegendEntries,
} from '../src/core/civil.js';
import {
  PIT_LIBRARY,
  CONDUIT_SIZES,
  COMMS_CONDUIT_SIZES,
  POLE_LIBRARY,
  OVERHEAD_CONDUCTOR_SIZES,
} from '../src/core/civilCatalog.js';

const fmt = n =>
  '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const prod = buildProductionModule({
  prelude: [
    'let state = { civilPlans: [], activeCivilPlanIndex: 0 };',
    'let LIBS = {}, RATE = "0", OUT = {}, HTML = {};',
    'let PIT_LIBRARY, CONDUIT_SIZES, COMMS_CONDUIT_SIZES, POLE_LIBRARY, OVERHEAD_CONDUCTOR_SIZES;',
    // A stub element per id: the labour-rate input reads .value; every
    // table body collects the rows appended to it; every total cell keeps
    // the last textContent written.
    'function el(id){ if(id === "rateLabour") return { value: RATE }; return { set innerHTML(v){ HTML[id] = v; OUT[id + ":rows"] = []; }, get innerHTML(){ return HTML[id]; }, appendChild(node){ (OUT[id + ":rows"] = OUT[id + ":rows"] || []).push(node.innerHTML); }, set textContent(v){ OUT[id] = v; }, get textContent(){ return OUT[id]; } }; }',
    'const document = { getElementById: el, createElement: () => ({ innerHTML: "" }) };',
    'function currentCivilPlan(){ return state.civilPlans[state.activeCivilPlanIndex]; }',
    'function fmt(n){ return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }',
  ],
  parts: [
    extractFunction('conduitLength'),
    extractFunction('computeAllCivilTotals'),
    extractFunction('updateCivilQuote'),
    extractFunction('computeCivilLegendEntries'),
  ],
  exports: [
    'setup:(libs, st, rate) => { PIT_LIBRARY = libs.PIT_LIBRARY; CONDUIT_SIZES = libs.CONDUIT_SIZES; COMMS_CONDUIT_SIZES = libs.COMMS_CONDUIT_SIZES; POLE_LIBRARY = libs.POLE_LIBRARY; OVERHEAD_CONDUCTOR_SIZES = libs.OVERHEAD_CONDUCTOR_SIZES; state = st; RATE = rate; OUT = {}; HTML = {}; }',
    'out:() => OUT',
    'conduitLength',
    'computeAllCivilTotals',
    'updateCivilQuote',
    'computeCivilLegendEntries',
  ],
});

const libs = {
  PIT_LIBRARY,
  CONDUIT_SIZES,
  COMMS_CONDUIT_SIZES,
  POLE_LIBRARY,
  OVERHEAD_CONDUCTOR_SIZES,
};

const { eq, report } = makeComparer();
const rnd = makeRandom(24680);
const clone = v => JSON.parse(JSON.stringify(v));

function randomPoints() {
  const n = 2 + Math.floor(rnd() * 4);
  return Array.from({ length: n }, () => ({
    x: Math.round(rnd() * 2000),
    y: Math.round(rnd() * 2000),
  }));
}

function makePlan(trial, calibrated) {
  const pits = [];
  for (let i = 0; i < Math.floor(rnd() * 7); i++) {
    const type = PIT_LIBRARY[Math.floor(rnd() * PIT_LIBRARY.length)];
    pits.push({
      id: 'PIT-' + i,
      typeId: type.id,
      x: rnd() * 2000,
      y: rnd() * 2000,
      props: {
        // Per-object cost overrides are edited in the props panel, so the
        // takeoff must read the object, not the library.
        material_cost: rnd() > 0.8 ? Math.round(rnd() * 400) : type.defaultProps.material_cost,
        labour_hours: rnd() > 0.8 ? Math.round(rnd() * 40) / 10 : type.defaultProps.labour_hours,
      },
    });
  }

  const conduits = [];
  for (let i = 0; i < Math.floor(rnd() * 8); i++) {
    const comms = rnd() > 0.6;
    const table = comms ? COMMS_CONDUIT_SIZES : CONDUIT_SIZES;
    conduits.push({
      id: 'CD-' + i,
      points: randomPoints(),
      category: comms ? 'comms' : 'electrical',
      sizeId: table[Math.floor(rnd() * table.length)].id,
      transition: rnd() > 0.75 ? 'ugoh' : null,
    });
  }
  // A conduit whose sizeId is not in either table — production falls back
  // to zero cost rather than throwing, and so must the port.
  if (rnd() > 0.85) {
    conduits.push({
      id: 'CD-unknown',
      points: randomPoints(),
      category: 'electrical',
      sizeId: 'no-such-size',
      transition: null,
    });
  }

  const poles = [];
  for (let i = 0; i < Math.floor(rnd() * 5); i++) {
    const network = rnd() > 0.6;
    const type = POLE_LIBRARY[Math.floor(rnd() * POLE_LIBRARY.length)];
    poles.push({
      id: 'PL-' + i,
      ownership: network ? 'network' : 'private',
      typeId: network ? null : type.id,
      x: rnd() * 2000,
      y: rnd() * 2000,
      props: network
        ? { material_cost: 0, labour_hours: 0 }
        : {
            material_cost: type.defaultProps.material_cost,
            labour_hours: type.defaultProps.labour_hours,
          },
    });
  }

  const overheadRuns = [];
  for (let i = 0; i < Math.floor(rnd() * 5); i++) {
    overheadRuns.push({
      id: 'OH-' + i,
      points: randomPoints(),
      sizeId: OVERHEAD_CONDUCTOR_SIZES[Math.floor(rnd() * OVERHEAD_CONDUCTOR_SIZES.length)].id,
      transition: rnd() > 0.75 ? 'ohug' : null,
    });
  }

  const buildingEntries = [];
  for (let i = 0; i < Math.floor(rnd() * 4); i++) {
    buildingEntries.push({ id: 'BE-' + i, x: rnd() * 2000, y: rnd() * 2000, serviceTypes: [] });
  }

  return {
    id: 'CP-' + trial,
    name: 'Site ' + trial,
    // An uncalibrated plan must report zero metreage, not a guess.
    scale: calibrated ? 10 + Math.floor(rnd() * 90) : null,
    pits,
    conduits,
    buildingEntries,
    dimensions: [],
    poles,
    overheadRuns,
  };
}

// --- conduitLength ----------------------------------------------------
for (let i = 0; i < 100; i++) {
  const run = { points: randomPoints() };
  eq(prod.conduitLength(run), conduitLength(run), 'conduitLength ' + i);
}
eq(prod.conduitLength({ points: [] }), conduitLength({ points: [] }), 'conduitLength(empty)');
eq(
  prod.conduitLength({ points: [{ x: 1, y: 1 }] }),
  conduitLength({ points: [{ x: 1, y: 1 }] }),
  'conduitLength(single point)'
);

// --- whole-job totals and the per-plan takeoff ------------------------
for (let trial = 0; trial < 250; trial++) {
  const calibrated = trial % 5 !== 0; // every fifth job has an uncalibrated plan
  const planCount = 1 + Math.floor(rnd() * 2);
  const civilPlans = [];
  for (let p = 0; p < planCount; p++) civilPlans.push(makePlan(trial * 10 + p, calibrated));
  const rate = Math.round(rnd() * 200);

  // computeAllCivilTotals spans every plan.
  prod.setup(libs, { civilPlans: clone(civilPlans), activeCivilPlanIndex: 0 }, String(rate));
  const prodTotals = prod.computeAllCivilTotals();
  const mineTotals = computeAllCivilTotals({ civilPlans }, rate);
  eq(prodTotals.materials, mineTotals.materials, 'all-civil materials, trial ' + trial);
  eq(prodTotals.labourCost, mineTotals.labourCost, 'all-civil labour, trial ' + trial);
  eq(prodTotals.total, mineTotals.total, 'all-civil total, trial ' + trial);

  // updateCivilQuote is scoped to the ACTIVE plan.
  for (let idx = 0; idx < civilPlans.length; idx++) {
    prod.setup(libs, { civilPlans: clone(civilPlans), activeCivilPlanIndex: idx }, String(rate));
    prod.updateCivilQuote();
    const out = prod.out();
    const mine = buildCivilSchedule(civilPlans[idx], rate);

    eq(out.civilMaterialsTotal, fmt(mine.materials), `civil materials p${idx}, trial ${trial}`);
    eq(out.civilLabourTotal, fmt(mine.labourCost), `civil labour p${idx}, trial ${trial}`);
    eq(out.civilGrandTotal, fmt(mine.total), `civil grand total p${idx}, trial ${trial}`);
    eq(
      out.civilBuildingEntryCount,
      mine.buildingEntryCount,
      `building entries p${idx}, trial ${trial}`
    );
    eq(
      out.civilTransitionCount,
      mine.transitions.total +
        ' (' +
        mine.transitions.ugoh +
        ' UGOH, ' +
        mine.transitions.ohug +
        ' OHUG)',
      `transitions p${idx}, trial ${trial}`
    );

    // Row-level comparison: production renders each row as HTML, so the
    // cells are compared by rebuilding the same strings from the ported
    // data. This catches a row that is grouped or ordered differently,
    // not just a total that happens to land in the same place.
    const pitRows = (out['civilPitsBody:rows'] || []).length ? out['civilPitsBody:rows'] : [];
    eq(
      pitRows,
      mine.pitRows.map(
        r => `<td>${r.label}</td><td>${r.count}</td><td>${fmt(r.each)}</td><td>${fmt(r.cost)}</td>`
      ),
      `pit rows p${idx}, trial ${trial}`
    );
    eq(
      out['civilConduitsBody:rows'] || [],
      mine.electricalConduit.map(
        r =>
          `<td>${r.label}</td><td>${r.metres.toFixed(1)}</td><td>${
            r.perM == null ? '-' : '$' + r.perM.toFixed(2)
          }</td><td>${fmt(r.cost)}</td>`
      ),
      `electrical conduit rows p${idx}, trial ${trial}`
    );
    eq(
      out['civilCommsConduitsBody:rows'] || [],
      mine.commsConduit.map(
        r =>
          `<td>${r.label}</td><td>${r.metres.toFixed(1)}</td><td>${
            r.perM == null ? '-' : '$' + r.perM.toFixed(2)
          }</td><td>${fmt(r.cost)}</td>`
      ),
      `comms conduit rows p${idx}, trial ${trial}`
    );
    eq(
      out['civilPolesBody:rows'] || [],
      mine.poleRows.map(
        r => `<td>${r.label}</td><td>${r.count}</td><td>${fmt(r.each)}</td><td>${fmt(r.cost)}</td>`
      ),
      `pole rows p${idx}, trial ${trial}`
    );
    eq(
      out['civilOverheadBody:rows'] || [],
      mine.overheadRows.map(
        r =>
          `<td>${r.label}</td><td>${r.metres.toFixed(1)}</td><td>${
            r.perM == null ? '-' : '$' + r.perM.toFixed(2)
          }</td><td>${fmt(r.cost)}</td>`
      ),
      `overhead rows p${idx}, trial ${trial}`
    );

    // --- legend -------------------------------------------------------
    eq(
      prod.computeCivilLegendEntries(clone(civilPlans[idx])),
      computeCivilLegendEntries(civilPlans[idx]).map(e =>
        // The ported labels use plain ASCII arrows in the transition rows;
        // everything else must match production exactly.
        e.kind === 'transition' ? { ...e, label: e.label.replace(' to ', ' → ') } : e
      ),
      `legend p${idx}, trial ${trial}`
    );
  }
}

process.exit(report('civil') ? 0 : 1);
