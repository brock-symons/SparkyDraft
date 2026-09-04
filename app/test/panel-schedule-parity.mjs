// ===================================================================
// PANEL SCHEDULE / LOAD ESTIMATE — PARITY TEST AGAINST PRODUCTION
//
//   node app/test/panel-schedule-parity.mjs
//
// MIGRATION_INVENTORY.md's risk register (R2) requires the quote and
// demand formulas to be "checked against the old app's actual output,
// not re-derived from memory". Reading the two implementations side by
// side is not that check — this is.
//
// The script pulls the relevant functions OUT of the live index.html at
// run time (by name, not by line number, so it survives edits to that
// file), evaluates them in a stub scope, and compares them against the
// ported versions in app/src/core over a wide sweep of inputs: every
// diversity breakpoint, every catalog symbol and every pair of them,
// randomised device layouts, and randomised calibrated floors.
//
// If this ever fails, the port has drifted from the product. Fix the
// port — do not adjust the expectation.
// ===================================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import * as ported from '../src/core/panelSchedule.js';
import { computeChainEdges as portedChainEdges } from '../src/core/circuits.js';
import { SYMBOL_LIBRARY } from '../src/core/catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', '..', 'index.html'), 'utf8');

/** Pulls one top-level `function name(...){...}` out of the source by
 *  brace matching, so line numbers in index.html can move freely. */
function extractFunction(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('could not find function ' + name + ' in index.html');
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces reading ' + name);
}

/** Pulls one top-level `const NAME = ...;` line. */
function extractConst(name) {
  const m = source.match(new RegExp('\\nconst ' + name + ' = [^\\n]+', ''));
  if (!m) throw new Error('could not find const ' + name);
  return m[0];
}

const prodSource = [
  'let SYMBOL_LIBRARY = [], state = { floors: [] };',
  'const CIRCUIT_JUNCTION_MAX_CABLES = 3;',
  'function allObjects(){ return state.floors.flatMap(f=>f.objects.map(o=>({...o,__floorName:f.name}))); }',
  'function findObjectAnywhere(id){ for(const f of state.floors){ const o=f.objects.find(x=>x.id===id); if(o) return {obj:o,floor:f}; } return null; }',
  extractConst('FIXED_LOAD_SYMBOL_IDS'),
  extractConst('MAINS_VOLTAGE'),
  extractFunction('effectiveWatts'),
  extractFunction('computeChainEdges'),
  extractFunction('classifyCircuitDiversity'),
  extractFunction('diversifiedWatts'),
  extractFunction('deviceHeightMm'),
  extractFunction('estimateCircuitCableLength'),
  'return { setup:(lib,st)=>{SYMBOL_LIBRARY=lib;state=st;}, effectiveWatts, computeChainEdges, classifyCircuitDiversity, diversifiedWatts, deviceHeightMm, estimateCircuitCableLength, MAINS_VOLTAGE };',
].join('\n');

const prod = new Function(prodSource)();

const symbolFor = id => SYMBOL_LIBRARY.find(s => s.id === id);
const ids = SYMBOL_LIBRARY.map(s => s.id);
let checks = 0;
let fails = 0;

function eq(a, b, what) {
  checks++;
  const same =
    typeof a === 'number' && typeof b === 'number'
      ? Math.abs(a - b) < 1e-9
      : JSON.stringify(a) === JSON.stringify(b);
  if (!same) {
    fails++;
    if (fails <= 20) console.log('MISMATCH', what, '\n  production:', a, '\n  ported:    ', b);
  }
}

// Deterministic PRNG so a failure is reproducible.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

prod.setup(SYMBOL_LIBRARY, { floors: [] });

// --- MAINS_VOLTAGE ----------------------------------------------------
eq(prod.MAINS_VOLTAGE, ported.MAINS_VOLTAGE, 'MAINS_VOLTAGE');

// --- diversity factors, including every breakpoint --------------------
for (const type of ['lighting', 'power', 'fixed', 'none', 'unrecognised']) {
  for (let w = 0; w <= 20000; w += 137) {
    eq(
      prod.diversifiedWatts(w, type),
      ported.diversifiedWatts(w, type),
      `diversifiedWatts(${w},${type})`
    );
  }
  for (const w of [2299, 2300, 2301, 2999, 3000, 3001, 0.5, 1e6]) {
    eq(
      prod.diversifiedWatts(w, type),
      ported.diversifiedWatts(w, type),
      `diversifiedWatts(${w},${type})`
    );
  }
}

// --- circuit classification, every symbol and every pair --------------
const mk = id => ({ symbolId: id, props: {} });
eq(
  prod.classifyCircuitDiversity([]),
  ported.classifyCircuitDiversity([], symbolFor),
  'classify([])'
);
for (const a of ids) {
  eq(
    prod.classifyCircuitDiversity([mk(a)]),
    ported.classifyCircuitDiversity([mk(a)], symbolFor),
    `classify(${a})`
  );
  for (const b of ids) {
    const devs = [mk(a), mk(b)];
    eq(
      prod.classifyCircuitDiversity(devs),
      ported.classifyCircuitDiversity(devs, symbolFor),
      `classify(${a},${b})`
    );
  }
}

// --- per-device load and mounting height ------------------------------
const propShapes = [
  {},
  { watts: 0 },
  { watts: 55 },
  { watts: '90' },
  { watts: null },
  { height_mm: 0 },
  { height_mm: '' },
  { height_mm: 2400 },
];
for (const id of ids) {
  for (const props of propShapes) {
    const o = { symbolId: id, props };
    eq(prod.effectiveWatts(o), ported.effectiveWatts(o, symbolFor), `effectiveWatts(${id})`);
    eq(prod.deviceHeightMm(o), ported.deviceHeightMm(o, symbolFor), `deviceHeightMm(${id})`);
  }
}

// --- the branching run, edge for edge ---------------------------------
for (let trial = 0; trial < 200; trial++) {
  const n = 2 + Math.floor(rnd() * 12);
  const objects = [];
  for (let i = 0; i < n; i++) {
    objects.push({
      id: i + 1,
      symbolId: 'gpo_single',
      x: Math.round(rnd() * 1000),
      y: Math.round(rnd() * 1000),
      props: {},
    });
  }
  const board = {
    id: 999,
    symbolId: 'switchboard',
    x: Math.round(rnd() * 1000),
    y: Math.round(rnd() * 1000),
    props: {},
  };
  const floor = { objects: objects.concat([board]) };
  const idsArr = objects.map(o => o.id);
  const seedObj = rnd() > 0.3 ? board : null;
  eq(
    prod.computeChainEdges(floor, idsArr, seedObj, 3).edges.map(e => e.from.id + '>' + e.to.id),
    portedChainEdges(floor, idsArr, seedObj, 3).edges.map(e => e.from.id + '>' + e.to.id),
    'computeChainEdges trial ' + trial
  );
}

// --- cable-run estimate, end to end -----------------------------------
for (let trial = 0; trial < 60; trial++) {
  const objects = [];
  const n = 2 + Math.floor(rnd() * 8);
  for (let i = 0; i < n; i++) {
    objects.push({
      id: i + 1,
      symbolId: ids[Math.floor(rnd() * ids.length)],
      x: Math.round(rnd() * 800),
      y: Math.round(rnd() * 800),
      props: {},
      circuit: 'C1',
    });
  }
  const board = { id: 900, symbolId: 'switchboard', x: 10, y: 10, props: {}, circuit: '' };
  const floor = {
    name: 'Ground',
    scale: 40 + Math.floor(rnd() * 60),
    objects: objects.concat([board]),
  };
  prod.setup(SYMBOL_LIBRARY, { floors: [floor] });
  const circuit = { id: 'C1', switchboardObjectId: 900 };
  const ceiling = 2400 + Math.floor(rnd() * 1200);
  const slack = Math.floor(rnd() * 20);
  const a = prod.estimateCircuitCableLength(circuit, ceiling, slack);
  const b = ported.estimateCircuitCableLength(
    { floors: [floor], circuits: [] },
    circuit,
    ceiling,
    slack,
    symbolFor
  );
  eq(a.ok, b.ok, 'cable ok trial ' + trial);
  if (a.ok) eq(a.meters, b.meters, 'cable metres trial ' + trial);
}

console.log(
  fails === 0
    ? `PARITY OK — ${checks} comparisons, every one matched production`
    : `${fails} MISMATCHES out of ${checks} comparisons`
);
process.exit(fails === 0 ? 0 : 1);
