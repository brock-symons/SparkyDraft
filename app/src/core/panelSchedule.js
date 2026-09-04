// ===================================================================
// PANEL SCHEDULE + LOAD ESTIMATE  (migration Phase 4)
//
// The highest business-logic risk in the migration (inventory §G, R2).
// Everything here is ported verbatim from index.html — the numbers this
// file produces are what an electrician plans a board around, so nothing
// is re-derived, rounded differently, or "tidied up".
//
// The diversity factors are a common simplified approximation used for
// planning (lighting: 66% of the first 3 kW + 40% of the remainder;
// general power: 100% of the first ~10 A + 75% of the remainder;
// anything else — fixed appliances, mixed circuits — gets no reduction,
// the conservative default). They are NOT a reproduction of the AS/NZS
// 3000 diversity tables, which are copyrighted and considerably more
// detailed (occupancy type, number of circuits, and so on). This is a
// deliberately transparent estimate for early planning, and it must stay
// labelled as such everywhere it is shown. Always verify against AS/NZS
// 3000 and professional judgement before relying on it.
// ===================================================================

import { allObjects } from './document.js';
import { computeChainEdges, CIRCUIT_JUNCTION_MAX_CABLES } from './circuits.js';
import { PROTECTION_LIBRARY } from './catalog.js';

/** Nominal AU single-phase. Three-phase circuits are shown at their
 *  single-phase-equivalent current — a simplification flagged in the UI. */
export const MAINS_VOLTAGE = 230;

/** Devices whose load gets no diversity reduction. Ported verbatim. */
const FIXED_LOAD_SYMBOL_IDS = new Set([
  'hws',
  'oven',
  'cooktop',
  'tastic_2h',
  'tastic_4h',
  'elec_heater',
  'gpo_dedicated',
  'outlet_3ph',
  'outlet_32a',
  'solar_inverter',
  'towel_rail',
]);

export const DIVERSITY_TYPE_LABELS = {
  lighting: 'Lighting (66%/40%)',
  power: 'General power (100%/75%)',
  fixed: 'Fixed load (no reduction)',
  none: '—',
};

/** Ported verbatim. Mixed or safety-only circuits fall through to
 *  'fixed', i.e. no reduction — the conservative default. */
export function classifyCircuitDiversity(devices, symbolFor) {
  if (!devices.length) return 'none';
  if (devices.some(d => FIXED_LOAD_SYMBOL_IDS.has(d.symbolId))) return 'fixed';
  const categories = devices.map(d => (symbolFor(d.symbolId) || {}).category);
  if (categories.every(c => c === 'lighting')) return 'lighting';
  if (categories.every(c => c === 'power')) return 'power';
  return 'fixed';
}

/** Ported verbatim — do not "simplify" these breakpoints. */
export function diversifiedWatts(connectedW, type) {
  if (type === 'lighting')
    return connectedW <= 3000 ? connectedW * 0.66 : 3000 * 0.66 + (connectedW - 3000) * 0.4;
  if (type === 'power') {
    const cap = 2300;
    return connectedW <= cap ? connectedW : cap + (connectedW - cap) * 0.75;
  }
  return connectedW;
}

/** A device's load: its own override if set, else the catalog default. */
export function effectiveWatts(obj, symbolFor) {
  const sym = symbolFor(obj.symbolId);
  const own = obj.props ? obj.props.watts : undefined;
  return own != null ? Number(own) : sym ? sym.defaultProps.watts || 0 : 0;
}

/** Mounting height, falling back to 1200 mm — ported verbatim. */
export function deviceHeightMm(obj, symbolFor) {
  const sym = symbolFor(obj.symbolId);
  const v = obj.props ? obj.props.height_mm : undefined;
  if (v != null && v !== '') return Number(v);
  return sym && sym.defaultProps.height_mm != null ? sym.defaultProps.height_mm : 1200;
}

function findObjectAnywhere(project, id) {
  for (const f of project.floors) {
    const o = f.objects.find(x => x.id === id);
    if (o) return { obj: o, floor: f };
  }
  return null;
}

/** Board name for a circuit: its linked switchboard's name, else the
 *  typed fallback. Ported verbatim. */
export function resolveSwitchboardLabel(project, c) {
  if (c.switchboardObjectId) {
    const found = findObjectAnywhere(project, c.switchboardObjectId);
    if (found) {
      const o = found.obj;
      return (o.props && o.props.customName) || String(o.id);
    }
  }
  return c.board || '—';
}

export function naturalCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function sortedCircuits(project) {
  return (project.circuits || []).slice().sort((a, b) => naturalCompare(a.id, b.id));
}

/**
 * Estimated cable length for a circuit: through the roof space and down
 * to each device in turn, following the SAME degree-constrained tree
 * that is drawn on the plan (computeChainEdges) so the metres reported
 * here can never disagree with the run the user is looking at.
 *
 * Only devices on the switchboard's own floor have usable geometry;
 * anything on another floor is excluded from the length and reported
 * separately rather than silently dropped.
 *
 * SCOPE NOTE, carried over verbatim from production and deliberately NOT
 * extended here: this estimates hard-active runs (switchboard → switch)
 * only. It does NOT estimate the cable needed to actually switch a
 * light/fan — a single switched point can need several cables of
 * different types at once (a light/fan combo commonly needs a Twin &
 * Earth run plus a separate SDI/3-core for the fan speed), so it cannot
 * be estimated the same generic way GPOs and hard actives are. The
 * project owner's framing was that this needs a redesign around a
 * switch's own view of what it feeds, and asked that it not be built
 * speculatively. Leave it alone until that conversation happens.
 */
export function estimateCircuitCableLength(project, circuit, ceilingMm, slackPct, symbolFor) {
  if (!circuit.switchboardObjectId)
    return { ok: false, reason: 'No switchboard placed on the plan for this circuit yet' };
  const found = findObjectAnywhere(project, circuit.switchboardObjectId);
  if (!found) return { ok: false, reason: 'Linked switchboard could not be found' };
  const { obj: board, floor } = found;
  if (!floor.scale)
    return {
      ok: false,
      reason: floor.name + " isn't calibrated — use Calibrate for a real-world estimate",
    };

  const allDevices = allObjects(project).filter(o => o.circuit === circuit.id);
  const sameFloor = allDevices.filter(o => o.__floorName === floor.name);
  const otherFloorCount = allDevices.length - sameFloor.length;
  if (!sameFloor.length)
    return {
      ok: false,
      reason: "No devices assigned to this circuit on the switchboard's floor",
      otherFloorCount,
    };

  const { edges } = computeChainEdges(
    floor,
    sameFloor.map(o => o.id),
    board,
    CIRCUIT_JUNCTION_MAX_CABLES
  );
  let totalMm = 0;
  edges.forEach(({ from, to }) => {
    const distPx = Math.hypot(from.x - to.x, from.y - to.y);
    // scale is world units per metre (see geometry.js), so distPx/scale
    // is metres and ×1000 is millimetres.
    const horizontalMm = (distPx / floor.scale) * 1000;
    const riseMm = Math.max(ceilingMm - deviceHeightMm(from, symbolFor), 0);
    const dropMm = Math.max(ceilingMm - deviceHeightMm(to, symbolFor), 0);
    totalMm += riseMm + horizontalMm + dropMm;
  });
  const meters = (totalMm * (1 + (slackPct || 0) / 100)) / 1000;
  return { ok: true, meters, deviceCount: sameFloor.length, otherFloorCount };
}

/**
 * The whole schedule, grouped by board. Data circuits are excluded —
 * they belong to the comms system, not the switchboard.
 */
export function buildPanelScheduleData(project, { ceilingMm = 3000, slackPct = 0 }, symbolFor) {
  const boards = {};
  sortedCircuits(project)
    .filter(c => c.kind !== 'data')
    .forEach(c => {
      const boardLabel = resolveSwitchboardLabel(project, c);
      const devices = allObjects(project).filter(o => o.circuit === c.id);
      const connectedW = devices.reduce(
        (sum, o) => sum + effectiveWatts(o, symbolFor) * ((o.props && o.props.quantity) || 1),
        0
      );
      const diversityType = classifyCircuitDiversity(devices, symbolFor);
      const demandW = diversifiedWatts(connectedW, diversityType);
      const connectedA = connectedW / MAINS_VOLTAGE;
      const prot = PROTECTION_LIBRARY.find(p => p.id === c.protectionId);
      const protectionA = prot ? prot.amps : null;
      const overRated = protectionA != null && connectedA > protectionA;
      const cableEstimate = estimateCircuitCableLength(project, c, ceilingMm, slackPct, symbolFor);
      if (!boards[boardLabel])
        boards[boardLabel] = { boardLabel, circuits: [], connectedW: 0, demandW: 0 };
      boards[boardLabel].circuits.push({
        circuit: c,
        deviceCount: devices.length,
        connectedW,
        connectedA,
        demandW,
        protectionA,
        protectionLabel: prot ? prot.label : '—',
        overRated,
        diversityType,
        cableEstimate,
      });
      boards[boardLabel].connectedW += connectedW;
      boards[boardLabel].demandW += demandW;
    });
  return Object.keys(boards)
    .sort(naturalCompare)
    .map(k => boards[k]);
}

/**
 * Plain-text panel schedule for copying out. Ported line-for-line from
 * production's export so a schedule pasted into an email or a job file
 * reads identically to one produced by the current app.
 */
export function panelScheduleText(project, boards, mainSwitchAmps) {
  const lines = [];
  lines.push((project.name || 'Untitled project') + ' — Panel Schedule');
  lines.push('Generated ' + new Date().toLocaleDateString('en-AU'));
  lines.push(
    'Estimate for planning only — verify against AS/NZS 3000 and your own professional judgement.'
  );
  if (!boards.length) lines.push('', '(no electrical circuits defined)');
  boards.forEach(b => {
    lines.push('', b.boardLabel.toUpperCase());
    b.circuits.forEach(row => {
      const ce = row.cableEstimate;
      const cableTxt = ce.ok
        ? `~${ce.meters.toFixed(1)}m est. cable${
            ce.otherFloorCount
              ? ` (+${ce.otherFloorCount} device(s) on another floor not included)`
              : ''
          }`
        : `est. cable: n/a (${ce.reason})`;
      lines.push(
        `  ${row.circuit.id}  ${row.circuit.description || ''}  |  ${row.circuit.cable || '-'}  |  ${
          row.protectionLabel
        }  |  ${row.deviceCount} device(s)  |  connected ${row.connectedW.toFixed(
          0
        )}W / ${row.connectedA.toFixed(1)}A  |  est. demand ${row.demandW.toFixed(0)}W  |  ${cableTxt}${
          row.overRated ? '  ⚠ EXCEEDS PROTECTION RATING' : ''
        }`
      );
    });
    const mainAmps = (mainSwitchAmps || {})[b.boardLabel];
    const demandA = b.demandW / MAINS_VOLTAGE;
    lines.push(
      `  TOTAL — connected ${(b.connectedW / 1000).toFixed(2)}kW, est. demand ${(
        b.demandW / 1000
      ).toFixed(2)}kW (${demandA.toFixed(1)}A)` +
        (mainAmps
          ? `, ${((demandA / mainAmps) * 100).toFixed(0)}% of ${mainAmps}A main switch`
          : '')
    );
  });
  return lines.join('\n');
}
