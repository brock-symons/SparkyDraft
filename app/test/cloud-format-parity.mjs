// ===================================================================
// CLOUD RECORD FORMAT — PARITY TEST AGAINST PRODUCTION
//
//   node app/test/cloud-format-parity.mjs
//
// The `projects.data` / `organization_projects.data` columns are shared
// between the live app and the redesign, and the redesign is meant to
// REPLACE the live app. So the property that actually matters is not
// "does the redesign save something sensible" but:
//
//   opening a project the production app wrote, and saving it back,
//   must not change a single field production reads.
//
// If that fails, the damage is silent and permanent: a customer opens
// an old job in the new app, autosave fires two seconds later, and the
// record is quietly rewritten into something the old app renders wrong.
//
// The production record used here is built by production's OWN
// buildProjectData(), extracted from the live index.html — not by a
// hand-written fixture that could drift into agreeing with the port for
// the wrong reason. Its DOM reads (project name, the four rate inputs)
// are satisfied by a stub document, and its state by a fabricated one.
// ===================================================================

import {
  extractFunction,
  makeComparer,
  makeRandom,
  productionSource,
} from './extract-production.mjs';
import { toCloudRecord, fromCloudRecord } from '../src/core/cloudFormat.js';
import { SYMBOL_LIBRARY, LAYER_DEFS } from '../src/core/catalog.js';
import { allSymbols } from '../src/core/symbols.js';
import { emptyProject, makeFloor } from '../src/core/document.js';
import { makeCivilPlan } from '../src/core/civil.js';

const { eq, report } = makeComparer();
const rnd = makeRandom(20260905);

// --- production's buildProjectData, driven by a stubbed environment ---

const prod = buildProductionRecordBuilder();

function buildProductionRecordBuilder() {
  const src = [
    'let SYMBOL_LIBRARY = [];',
    'let state = {};',
    'let fields = {};',
    'const document = { getElementById: id => ({ get value(){ return fields[id]; } }) };',
    extractFunction('buildProjectData', productionSource),
    'return { build:(lib,st,f)=>{SYMBOL_LIBRARY=lib;state=st;fields=f;return buildProjectData();} };',
  ].join('\n');
  return new Function(src)();
}

// --- fabricating a production `state` ---------------------------------

function rndInt(n) {
  return Math.floor(rnd() * n);
}

function pick(list) {
  return list[rndInt(list.length)];
}

function makeObjects(n, seq) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const sym = pick(SYMBOL_LIBRARY);
    out.push({
      id: 'OBJ-' + String(seq.v++).padStart(3, '0'),
      symbolId: sym.id,
      x: Math.round(rnd() * 4000),
      y: Math.round(rnd() * 3000),
      layer: sym.category,
      props: { ...sym.defaultProps },
      ...(rnd() < 0.2 ? { gang: 1 + rndInt(4) } : null),
    });
  }
  return out;
}

function makeProductionState(trial) {
  const seq = { v: 1 };
  const floorCount = 1 + rndInt(3);
  const floors = [];
  for (let i = 0; i < floorCount; i++) {
    floors.push({
      id: 'FL-' + i,
      name: 'Level ' + i,
      scale: rnd() < 0.7 ? 40 + rnd() * 20 : null,
      gridSpacingMM: pick([100, 200, 500]),
      snapEnabled: rnd() < 0.8,
      gridOriginX: rndInt(50),
      gridOriginY: rndInt(50),
      gridVisible: rnd() < 0.8,
      gridAlignWallId: rnd() < 0.2 ? 'W-1' : null,
      objects: makeObjects(rndInt(8), seq),
      cables: rnd() < 0.4 ? [{ id: 'C-' + seq.v++, points: [{ x: 0, y: 0 }] }] : [],
      dimensions: [],
      switchLinks: rnd() < 0.3 ? [{ switchId: 'OBJ-001', targetId: 'OBJ-002', group: 1 }] : [],
      walls: rnd() < 0.5 ? [{ id: 'W-1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }] : [],
      rooms: rnd() < 0.3 ? [{ id: 'RM-' + seq.v++, name: 'Kitchen', objectIds: [] }] : [],
      bankNames: rnd() < 0.2 ? { 'OBJ-001::1': 'Bank A' } : {},
      // production stores the loaded <img>; buildProjectData reads .src
      planImage: rnd() < 0.3 ? { src: 'data:image/png;base64,AAAA' + trial } : null,
    });
  }

  const civilCount = rndInt(3);
  const civilPlans = [];
  for (let i = 0; i < civilCount; i++) {
    civilPlans.push({
      id: 'CP-' + i,
      name: 'Site ' + i,
      scale: rnd() < 0.6 ? 10 + rnd() * 5 : null,
      gridSpacingMM: 1000,
      snapEnabled: rnd() < 0.8,
      gridOriginX: 0,
      gridOriginY: 0,
      gridVisible: rnd() < 0.8,
      pits: rnd() < 0.6 ? [{ id: 'PIT-001', x: 10, y: 20, typeId: 'pit_small', props: {} }] : [],
      conduits:
        rnd() < 0.6
          ? [
              {
                id: 'CD-001',
                points: [
                  { x: 0, y: 0 },
                  { x: 50, y: 0 },
                ],
              },
            ]
          : [],
      buildingEntries: [],
      dimensions: [],
      poles: [],
      overheadRuns: [],
      planImage: null,
    });
  }

  // Production's live layer list, including the synthetic 'cable' layer
  // buildProjectData filters out before saving.
  const layers = LAYER_DEFS.map(l => ({
    ...l,
    visible: rnd() < 0.8,
    locked: rnd() < 0.2,
  })).concat([{ id: 'cable', name: 'Cables', color: '#fff', locked: false, visible: true }]);

  return {
    currentProjectId: 'PRJ-' + trial,
    activeFloorIndex: rndInt(floorCount),
    activeCivilPlanIndex: civilCount ? rndInt(civilCount) : 0,
    activePlanType: civilCount && rnd() < 0.4 ? 'civil' : 'floor',
    customSymbols:
      rnd() < 0.3
        ? [
            {
              id: 'custom_' + trial,
              label: 'Custom fitting',
              abbr: 'X',
              color: '#ff0000',
              category: 'power',
              defaultProps: { material_cost: 12.5, labour_hours: 0.4, watts: 60 },
            },
          ]
        : [],
    symbolSize: pick([12, 16, 22]),
    gridOverlay: rnd() < 0.3,
    boardMainSwitchAmps: rnd() < 0.3 ? { MSB: 100 } : {},
    unassignedCommsPorts: rnd() < 0.2 ? [{ id: 'P-1', label: 'Office' }] : [],
    floors,
    civilPlans,
    layers,
    circuits:
      rnd() < 0.5
        ? [
            {
              id: 'C1',
              description: 'Lights',
              board: 'MSB',
              cable: '1.5mm²',
              protectionId: 'rcbo20',
            },
          ]
        : [],
    elevations:
      rnd() < 0.3
        ? [{ id: 'EL-001', name: 'North wall', width_mm: 4200, height_mm: 2400, items: [] }]
        : [],
  };
}

function makeFields(trial) {
  return {
    projName: 'Job ' + trial,
    // Production reads these straight out of DOM inputs, so they arrive
    // as STRINGS. The redesign models them as numbers — the conversion
    // has to survive a round trip without turning "95" into 95 into "95"
    // incorrectly, or the quote silently changes.
    rateLabour: String(90 + rndInt(20)),
    rateMargin: String(15 + rndInt(15)),
    costEquipment: String(rndInt(500)),
    costTravel: String(rndInt(200)),
  };
}

// --- the actual checks ------------------------------------------------

/**
 * Every key production writes, compared before and after a redesign
 * open + save. This is the destructive-rewrite check.
 */
// The four rate fields are the one knowingly-narrowed type: production
// writes the DOM input's string, the redesign writes the number. Compared
// by VALUE rather than identity, because production assigns them back
// into an <input>.value which stringifies on assignment — so it reads the
// same number either way. See the note on num() in cloudFormat.js.
const NUMERIC_FIELDS = new Set(['rateLabour', 'rateMargin', 'costEquipment', 'costTravel']);

function checkProductionRoundTrip(record, trial) {
  const project = fromCloudRecord(
    record,
    allSymbols({ customSymbols: record.customSymbols }),
    record.id
  );
  const back = toCloudRecord(project, allSymbols(project));
  Object.keys(record).forEach(key => {
    const what = `trial ${trial} · production key "${key}" survived open+save`;
    if (NUMERIC_FIELDS.has(key)) eq(Number(record[key]), Number(back[key]), what);
    else eq(record[key], back[key], what);
  });
}

/**
 * A project authored in the redesign, saved and reopened, must come back
 * identical on every field the redesign models — including the ones
 * production has no column for (nextId, priceList, quoteItemized, plan
 * image placement), which ride along additively.
 */
function checkRedesignRoundTrip(trial) {
  const p = emptyProject();
  p.id = 'PRJ-r' + trial;
  p.name = 'Redesign job ' + trial;
  p.floors = [makeFloor('Ground'), makeFloor('First')];
  p.floors[0].objects = makeObjects(3 + rndInt(5), { v: 1 });
  p.floors[0].planImage = {
    src: 'data:image/png;base64,BBBB',
    width: 800,
    height: 600,
    x: -400,
    y: -300,
    scale: 1.25,
    opacity: 0.6,
  };
  p.civilPlans = [makeCivilPlan('Site')];
  p.activeCivilPlanIndex = 0;
  p.hiddenLayers = ['power'];
  p.lockedLayers = ['lighting', 'safety'];
  p.priceList = { gpo_single: { material_cost: 9.99, labour_hours: 0.5 } };
  p.quoteItemized = true;
  p.rateLabour = 110;
  p.rateMargin = 25;
  p.costEquipment = 40;
  p.costTravel = 15;
  p.symbolSize = 22;
  p.nextId = 42;
  p.customSymbols = [
    {
      id: 'custom_r' + trial,
      label: 'Bespoke',
      abbr: 'B',
      color: '#00ff00',
      category: 'lighting',
      defaultProps: { material_cost: 30, labour_hours: 1, watts: 12 },
    },
  ];

  const record = toCloudRecord(p, allSymbols(p));
  const back = fromCloudRecord(record, allSymbols(p), p.id);

  [
    'id',
    'name',
    'activeFloorIndex',
    'activeCivilPlanIndex',
    'activePlanType',
    'customSymbols',
    'symbolSize',
    'boardMainSwitchAmps',
    'unassignedCommsPorts',
    'floors',
    'civilPlans',
    'circuits',
    'elevations',
    'rateLabour',
    'rateMargin',
    'costEquipment',
    'costTravel',
    'quoteItemized',
    'priceList',
    'hiddenLayers',
    'lockedLayers',
    'nextId',
  ].forEach(key => {
    eq(p[key], back[key], `redesign trial ${trial} · "${key}" round-tripped`);
  });
}

// --- specific behaviours worth pinning --------------------------------

function checkSpecifics() {
  // A production record has no nextId. Deriving it from the ids actually
  // present is what stops the redesign minting an id that already exists
  // on the drawing (which would make two objects share an id — the kind
  // of corruption that only shows up later, in a quote or a circuit).
  const rec = {
    name: 'x',
    floors: [{ name: 'F', objects: [{ id: 'OBJ-007' }, { id: 'OBJ-019' }] }],
    civilPlans: [{ name: 'C', pits: [{ id: 'PIT-031' }] }],
  };
  const p = fromCloudRecord(rec, SYMBOL_LIBRARY, 'row-1');
  eq(32, p.nextId, 'nextId derived past the highest id present, across floors AND civil plans');

  // The row id is authoritative when the record predates data.id — same
  // rule production applies, so a legacy project keeps saving to its own
  // slot instead of forking into a second copy under a fresh id.
  eq('row-1', p.id, 'row id used when the record has no id of its own');

  // An out-of-range stored index must not hand the app an undefined
  // current floor.
  const p2 = fromCloudRecord({ floors: [{ name: 'A' }], activeFloorIndex: 9 }, SYMBOL_LIBRARY, 'r');
  eq(0, p2.activeFloorIndex, 'out-of-range activeFloorIndex clamped');

  // activePlanType can only be 'civil' if there is a civil plan to show.
  const p3 = fromCloudRecord({ activePlanType: 'civil', civilPlans: [] }, SYMBOL_LIBRARY, 'r');
  eq('floor', p3.activePlanType, "activePlanType falls back to 'floor' with no civil plans");

  // Layer state survives the two different representations.
  const p4 = fromCloudRecord(
    {
      layers: [
        { id: 'power', visible: false, locked: true },
        { id: 'data', visible: true },
      ],
    },
    SYMBOL_LIBRARY,
    'r'
  );
  eq(['power'], p4.hiddenLayers, 'hidden layers read from production layer list');
  eq(['power'], p4.lockedLayers, 'locked layers read from production layer list');

  // Production writes an override row for EVERY symbol, most of them
  // unchanged. Importing all of them as "edits" would make every project
  // look like its price list had been customised.
  const untouched = SYMBOL_LIBRARY.map(s => ({
    id: s.id,
    label: s.label,
    material_cost: s.defaultProps.material_cost,
    labour_hours: s.defaultProps.labour_hours,
    watts: s.defaultProps.watts,
  }));
  const p5 = fromCloudRecord({ priceListOverrides: untouched }, SYMBOL_LIBRARY, 'r');
  eq({}, p5.priceList, 'an unedited production price list imports as no overrides');

  const edited = untouched.map(o => (o.id === 'gpo_single' ? { ...o, material_cost: 99 } : o));
  const p6 = fromCloudRecord({ priceListOverrides: edited }, SYMBOL_LIBRARY, 'r');
  eq(
    { gpo_single: { material_cost: 99 } },
    p6.priceList,
    'a real price edit imports as one override'
  );

  // A key production writes that the redesign has no model for must come
  // back out unchanged rather than being dropped on save.
  const p7 = fromCloudRecord({ gridOverlay: true, someFutureField: 7 }, SYMBOL_LIBRARY, 'r');
  const back7 = toCloudRecord(p7, SYMBOL_LIBRARY);
  eq(true, back7.gridOverlay, 'unmodelled production field gridOverlay preserved');
  eq(7, back7.someFutureField, 'unknown future field preserved');
}

// --- run --------------------------------------------------------------

for (let trial = 0; trial < 200; trial++) {
  const state = makeProductionState(trial);
  const fields = makeFields(trial);
  const record = prod.build(SYMBOL_LIBRARY.concat(state.customSymbols), state, fields);
  checkProductionRoundTrip(record, trial);
}

for (let trial = 0; trial < 100; trial++) checkRedesignRoundTrip(trial);

checkSpecifics();

process.exit(report('cloud record format') ? 0 : 1);
