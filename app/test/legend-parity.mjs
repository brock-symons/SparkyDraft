// ===================================================================
// LEGEND — PARITY TEST AGAINST PRODUCTION
//
//   node app/test/legend-parity.mjs
//
// computeLegendEntries() feeds both the Layers panel's legend and the
// print/PDF export's legend table, so a grouping or sort mistake here
// shows up on a printed drawing. Checked mechanically against the live
// index.html implementation, the same as every other business-logic
// port in this migration.
//
// The ported version resolves symbols through the caller's resolver
// (so a custom fitting shows up, matching the fix already applied to
// the quote and panel schedule) rather than SYMBOL_LIBRARY directly, so
// this test supplies a SYMBOL_LIBRARY-only resolver on both sides —
// that isolates exactly the part that must match production: grouping
// by device+gang, quantity summation, derived patch-panel counting, and
// the sort order (including its category-vs-CATEGORY_ORDER quirk).
// ===================================================================

import {
  extractFunction,
  extractConst,
  buildProductionModule,
  makeComparer,
  makeRandom,
} from './extract-production.mjs';
import { computeLegendEntries } from '../src/core/legend.js';
import { SYMBOL_LIBRARY } from '../src/core/catalog.js';

const prod = buildProductionModule({
  prelude: ['let SYMBOL_LIBRARY = [];'],
  parts: [
    extractConst('SWITCH_IDS'),
    extractFunction('isSwitchSymbol'),
    extractConst('PATCH_PANEL_PORTS_PER_UNIT'),
    extractFunction('patchPanelUnitsForRack'),
    extractFunction('computeLegendEntries'),
  ],
  exports: ['setup:(lib)=>{SYMBOL_LIBRARY=lib;}', 'computeLegendEntries'],
});

prod.setup(SYMBOL_LIBRARY);
const symbolFor = id => SYMBOL_LIBRARY.find(s => s.id === id);
const ids = SYMBOL_LIBRARY.map(s => s.id);
const { eq, report } = makeComparer();
const rnd = makeRandom(864213);

function makeFloor(trial) {
  const objects = [];
  const n = Math.floor(rnd() * 20);
  for (let i = 0; i < n; i++) {
    const symbolId = ids[Math.floor(rnd() * ids.length)];
    const props = {};
    if (rnd() > 0.6) props.quantity = 1 + Math.floor(rnd() * 5);
    if (rnd() > 0.6) props.gang = 1 + Math.floor(rnd() * 6);
    const o = { id: trial * 1000 + i, symbolId, x: 0, y: 0, props };
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
  // A symbolId with no catalog match at all — production silently drops
  // it (`if(!sym) return`), and so must the port when given the same
  // catalog-only resolver.
  if (rnd() > 0.85) {
    objects.push({ id: trial * 1000 + 999, symbolId: 'not-a-real-symbol', x: 0, y: 0, props: {} });
  }
  return { objects };
}

// Empty floor.
eq(
  prod.computeLegendEntries({ objects: [] }),
  computeLegendEntries({ objects: [] }, symbolFor),
  'empty floor'
);

for (let trial = 0; trial < 300; trial++) {
  const floor = makeFloor(trial);
  eq(
    prod.computeLegendEntries(floor),
    computeLegendEntries(floor, symbolFor),
    'legend entries, trial ' + trial
  );
}

// Every device type on its own, so a single-symbol floor's sort/grouping
// (no gang, one entry) is exercised for every catalog entry, not just
// whatever randomised trials happened to draw.
for (const id of ids) {
  const floor = { objects: [{ id: 1, symbolId: id, x: 0, y: 0, props: {} }] };
  eq(
    prod.computeLegendEntries(floor),
    computeLegendEntries(floor, symbolFor),
    'single-device floor: ' + id
  );
}

process.exit(report('legend') ? 0 : 1);
