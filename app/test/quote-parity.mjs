// ===================================================================
// QUOTE — PARITY TEST AGAINST PRODUCTION
//
//   node app/test/quote-parity.mjs
//
// R2/R7 in the risk register: the quote totals and the derived
// patch-panel count are what a job is priced from, and getting either
// slightly wrong under-quotes real money. Checked mechanically rather
// than by reading the two implementations side by side.
//
// production's updateQuote() reads its inputs from the DOM and writes
// its results back into it, so the extracted copy is given a tiny stub
// document whose getElementById returns the rate/cost fields and
// collects the output cells. The arithmetic in between is the real
// production code, untouched.
// ===================================================================

import {
  extractFunction,
  buildProductionModule,
  makeComparer,
  makeRandom,
} from './extract-production.mjs';
import { computeQuote, quoteLines, effectivePrice, effectiveLabour } from '../src/core/quote.js';
import { SYMBOL_LIBRARY, PROTECTION_LIBRARY } from '../src/core/catalog.js';

const prod = buildProductionModule({
  prelude: [
    'let SYMBOL_LIBRARY = [], PROTECTION_LIBRARY = [], state = { floors: [], circuits: [], civilPlans: [] };',
    'let FIELDS = {}, OUT = {};',
    // Stub just enough DOM for the extracted functions: the four inputs
    // they read, and the output cells they write.
    'const document = { getElementById: id => (id in FIELDS ? { value: FIELDS[id] } : { set textContent(v){ OUT[id] = v; }, get textContent(){ return OUT[id]; } }) };',
    'function allObjects(){ return state.floors.flatMap(f=>f.objects.map(o=>({...o,__floorName:f.name}))); }',
    'const CONDUIT_SIZES = [];',
    'function conduitLength(){ return 0; }',
    'function currentFloor(){ return state.floors[0]; }',
    'function deviceDisplayName(o){ return (o.props && o.props.customName) || String(o.id); }',
    'function isSwitchSymbol(id){ return ["switch_1g","switch_2way","switch_intermediate","dimmer"].includes(id); }',
    'const PATCH_PANEL_PORTS_PER_UNIT = 24;',
    'function patchPanelUnitsForRack(rack){ const n = (rack.commsPorts||[]).length; return n > 0 ? Math.ceil(n / PATCH_PANEL_PORTS_PER_UNIT) : 0; }',
    'function allCommsRacks(){ const out=[]; state.floors.forEach((f,i)=>f.objects.forEach(o=>{ if(o.symbolId==="comms_rack") out.push({rack:o, floorIndex:i}); })); return out; }',
    'function allPatchPanelLines(){ const lines=[]; allCommsRacks().forEach(({rack,floorIndex})=>{ const units=patchPanelUnitsForRack(rack); if(units>0) lines.push({rack,floorIndex,floorName:state.floors[floorIndex].name,units}); }); return lines; }',
    'function computeAllCivilTotals(){ return { materials:0, labourCost:0, total:0 }; }',
  ],
  parts: [
    extractFunction('effectivePrice'),
    extractFunction('effectiveLabour'),
    extractFunction('effectiveProtectionCost'),
    extractFunction('fmt'),
    extractFunction('updateQuote'),
  ],
  exports: [
    'setup:(lib,prot,st,fields)=>{SYMBOL_LIBRARY=lib;PROTECTION_LIBRARY=prot;state=st;FIELDS=fields;OUT={};}',
    'out:()=>OUT',
    'effectivePrice',
    'effectiveLabour',
    'effectiveProtectionCost',
    'updateQuote',
    'fmt',
  ],
});

const symbolFor = id => SYMBOL_LIBRARY.find(s => s.id === id);
const ids = SYMBOL_LIBRARY.map(s => s.id);
const { eq, report } = makeComparer();
const rnd = makeRandom(555);

// --- per-object price/labour, including every override shape ----------
const overrideShapes = [
  {},
  { priceOverride: null },
  { priceOverride: '' },
  { priceOverride: 0 },
  { priceOverride: 12.5 },
  { priceOverride: '33' },
  { labourOverride: null },
  { labourOverride: '' },
  { labourOverride: 0 },
  { labourOverride: 1.25 },
  { labourOverride: '2' },
];
prod.setup(SYMBOL_LIBRARY, PROTECTION_LIBRARY, { floors: [], circuits: [] }, {});
for (const id of ids) {
  for (const props of overrideShapes) {
    const o = { symbolId: id, props };
    eq(prod.effectivePrice(o), effectivePrice(o, symbolFor), `effectivePrice(${id})`);
    eq(prod.effectiveLabour(o), effectiveLabour(o, symbolFor), `effectiveLabour(${id})`);
  }
}

// --- protection cost, including overrides -----------------------------
for (const p of PROTECTION_LIBRARY) {
  for (const ov of [null, '', 0, 9.99, '15']) {
    const c = { protectionId: p.id, protectionCostOverride: ov };
    const { effectiveProtectionCost } = await import('../src/core/quote.js');
    eq(
      prod.effectiveProtectionCost(c),
      effectiveProtectionCost(c),
      `protectionCost(${p.id},${ov})`
    );
  }
}
{
  const c = { protectionId: 'does-not-exist', protectionCostOverride: null };
  const { effectiveProtectionCost } = await import('../src/core/quote.js');
  eq(prod.effectiveProtectionCost(c), effectiveProtectionCost(c), 'protectionCost(unknown)');
}

// --- whole-quote totals over randomised jobs --------------------------
function makeJob(trial) {
  const floors = [];
  const floorCount = 1 + Math.floor(rnd() * 2);
  for (let f = 0; f < floorCount; f++) {
    const objects = [];
    const n = Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) {
      const symbolId = ids[Math.floor(rnd() * ids.length)];
      const props = {};
      if (rnd() > 0.7) props.quantity = 1 + Math.floor(rnd() * 4);
      if (rnd() > 0.75) props.priceOverride = Math.round(rnd() * 200);
      if (rnd() > 0.8) props.labourOverride = Math.round(rnd() * 30) / 10;
      if (rnd() > 0.8) props.gang = 1 + Math.floor(rnd() * 4);
      const o = { id: f * 100 + i, symbolId, x: rnd() * 100, y: rnd() * 100, props };
      // Some racks, with varying port counts, so the derived patch-panel
      // arithmetic is exercised across the 24-port boundary.
      if (symbolId === 'comms_rack') {
        const ports = Math.floor(rnd() * 60);
        o.commsPorts = Array.from({ length: ports }, (_, k) => ({
          id: o.id + '-P' + (k + 1),
          number: k + 1,
          deviceId: null,
        }));
      }
      objects.push(o);
    }
    floors.push({ name: 'Floor ' + f, objects });
  }
  const circuits = [];
  const circuitCount = Math.floor(rnd() * 5);
  for (let c = 0; c < circuitCount; c++) {
    const prot = PROTECTION_LIBRARY[Math.floor(rnd() * PROTECTION_LIBRARY.length)];
    circuits.push({
      id: 'C' + trial + '-' + c,
      // Data circuits must be excluded from the protection total.
      kind: rnd() > 0.8 ? 'data' : 'electrical',
      description: '',
      protectionId: prot.id,
      protectionCostOverride: rnd() > 0.85 ? Math.round(rnd() * 50) : null,
    });
  }
  return { floors, circuits };
}

for (let trial = 0; trial < 200; trial++) {
  const job = makeJob(trial);
  const fields = {
    rateLabour: String(Math.round(rnd() * 200)),
    rateMargin: String(Math.round(rnd() * 60)),
    costEquipment: String(Math.round(rnd() * 5000)),
    costTravel: String(Math.round(rnd() * 800)),
  };

  prod.setup(SYMBOL_LIBRARY, PROTECTION_LIBRARY, { ...job, civilPlans: [] }, fields);
  prod.updateQuote();
  const out = prod.out();

  const project = {
    ...job,
    rateLabour: fields.rateLabour,
    rateMargin: fields.rateMargin,
    costEquipment: fields.costEquipment,
    costTravel: fields.costTravel,
  };
  const mine = computeQuote(project, symbolFor);

  eq(out.qMaterials, prod.fmt(mine.materials), 'materials, trial ' + trial);
  eq(out.qLabour, prod.fmt(mine.labourCost), 'labour, trial ' + trial);
  eq(out.qProtection, prod.fmt(mine.protection), 'protection, trial ' + trial);
  eq(out.qSubtotal, prod.fmt(mine.subtotal), 'subtotal, trial ' + trial);
  eq(out.qMargin, prod.fmt(mine.margin), 'margin, trial ' + trial);
  eq(out.qGst, prod.fmt(mine.gst), 'gst, trial ' + trial);
  eq(out.qTotal, prod.fmt(mine.total), 'total, trial ' + trial);

  // The schedule lines: quantities and totals must agree in both views.
  for (const itemized of [false, true]) {
    const rows = quoteLines(project, symbolFor, itemized);
    const sum = rows.reduce((s, r) => s + r.total, 0);
    const expected = mine.materials + mine.labourCost;
    eq(
      Math.round(expected * 1e6) / 1e6,
      Math.round(sum * 1e6) / 1e6,
      `schedule lines sum to materials+labour (itemized=${itemized}), trial ${trial}`
    );
  }
}

process.exit(report('quote') ? 0 : 1);
