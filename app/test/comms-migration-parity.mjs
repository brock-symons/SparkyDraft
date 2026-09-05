// ===================================================================
// LEGACY COMMS MIGRATION — PARITY TEST AGAINST PRODUCTION
//
//   node app/test/comms-migration-parity.mjs
//
// migrateLegacyCommsData() converts an old-format save's `kind:'data'`
// circuits into ports on a rack. It runs on load, mutates the loaded
// data in place, and is the one piece of this migration that can
// silently destroy someone's real wiring if it is even slightly wrong —
// PLAN.md flags it as data-integrity critical for exactly that reason.
//
// So it is compared against the live index.html implementation over
// randomised old-format projects: circuits with and without a linked
// rack, with none / one / several devices attached, racks that already
// have ports, racks the migration cannot find, and pre-existing
// unassigned entries carried over from an earlier load.
//
// If this fails, do not adjust the expectation — fix the port.
// ===================================================================

import {
  extractFunction,
  extractConst,
  buildProductionModule,
  makeComparer,
  makeRandom,
} from './extract-production.mjs';
import { migrateLegacyCommsData } from '../src/core/comms.js';

const prod = buildProductionModule({
  parts: [
    extractConst('DEFAULT_COMMS_PORT_COUNT'),
    extractFunction('makeCommsPort'),
    extractFunction('nextCommsPortNumber'),
    extractFunction('migrateLegacyCommsData'),
  ],
  exports: ['migrateLegacyCommsData'],
});

const { eq, report } = makeComparer();
const rnd = makeRandom(987654);

const clone = v => JSON.parse(JSON.stringify(v));

/** An old-format project: data circuits, devices pointing at them by id. */
function makeLegacyProject(trial) {
  const rackCount = Math.floor(rnd() * 3); // 0..2 racks
  const racks = [];
  for (let r = 0; r < rackCount; r++) {
    const rack = { id: 100 + r, symbolId: 'comms_rack', x: r * 50, y: 0, props: {} };
    // Some racks already carry ports, so port numbering has to continue
    // from what is there rather than restarting at 1.
    if (rnd() > 0.5) {
      rack.commsPorts = [
        {
          id: rack.id + '-P1',
          number: 1,
          label: '1',
          description: '',
          cable: 'Cat6',
          deviceId: null,
        },
        {
          id: rack.id + '-P2',
          number: 2,
          label: '2',
          description: '',
          cable: 'Cat6',
          deviceId: null,
        },
      ];
    }
    racks.push(rack);
  }

  const devices = [];
  const circuits = [];
  const circuitCount = Math.floor(rnd() * 4);
  for (let c = 0; c < circuitCount; c++) {
    const id = 'DATA-' + trial + '-' + c;
    const linkKind = rnd();
    const circuit = {
      id,
      kind: 'data',
      description: rnd() > 0.5 ? 'run ' + c : '',
      cable: rnd() > 0.5 ? 'Cat6A' : '',
      // Sometimes linked to a real rack, sometimes to a rack id that does
      // not exist, sometimes not linked at all.
      switchboardObjectId:
        linkKind > 0.66 && racks.length
          ? racks[Math.floor(rnd() * racks.length)].id
          : linkKind > 0.33
            ? 999
            : null,
    };
    circuits.push(circuit);
    const deviceCount = Math.floor(rnd() * 3); // 0, 1 or 2 attached devices
    for (let dvc = 0; dvc < deviceCount; dvc++) {
      devices.push({
        id: 200 + devices.length,
        symbolId: 'data_outlet',
        x: rnd() * 100,
        y: rnd() * 100,
        props: {},
        circuit: id,
      });
    }
  }

  // A couple of ordinary electrical circuits, which must survive untouched.
  circuits.push({ id: 'GPO-' + trial, kind: 'electrical', description: 'power' });
  devices.push({
    id: 900 + trial,
    symbolId: 'gpo_single',
    x: 5,
    y: 5,
    props: {},
    circuit: 'GPO-' + trial,
  });

  return {
    floors: [{ name: 'Ground', objects: racks.concat(devices) }],
    circuits,
    unassignedCommsPorts:
      rnd() > 0.7
        ? [{ id: 'LEGACY-OLD', label: 'carried over', cable: 'Cat6', deviceId: null }]
        : [],
  };
}

for (let trial = 0; trial < 300; trial++) {
  const base = makeLegacyProject(trial);
  const a = clone(base);
  const b = clone(base);

  const prodResult = prod.migrateLegacyCommsData(a);
  const portedResult = migrateLegacyCommsData(b);

  // The return value: which circuits survive, and what could not be placed.
  eq(prodResult.circuits, portedResult.circuits, 'surviving circuits, trial ' + trial);
  eq(prodResult.unassigned, portedResult.unassigned, 'unassigned ports, trial ' + trial);

  // And the in-place mutation, which is the part that actually matters:
  // ports appended to racks, and cleared circuit references on devices.
  eq(a.floors, b.floors, 'mutated floors, trial ' + trial);
}

process.exit(report('comms migration') ? 0 : 1);
