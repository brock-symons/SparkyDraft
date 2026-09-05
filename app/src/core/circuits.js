// ===================================================================
// CIRCUITS + POWER RUNS  (migration Phase 3)
//
// Ported from index.html. A CIRCUIT is a project-level record (it can
// feed devices on any floor) holding the board, cable and protection
// device; a device belongs to one by carrying its id in `obj.circuit`.
//
// The run drawn on the plan is derived, not stored — same principle as
// the lighting banks in switching.js, and for the same reason: moving a
// device has to re-route its run, and a stored route would silently go
// wrong instead.
//
// Where this differs from lighting is the shape of the route. A lighting
// bank is a strict chain (one tail, then device to device). A power
// circuit is a degree-constrained TREE: each device is fed from
// whichever already-connected device is nearest, not from the last one
// wired, so the run branches the way real power wiring does. That is
// computeChainEdges below, and it is ported verbatim — a "tidier" MST or
// a plain chain would produce different, wrong cable-run lengths once
// the panel schedule (Phase 4) starts measuring them.
// ===================================================================

import { isSwitchSymbol } from './switching.js';

/**
 * Max cables that may physically meet at one power device — beyond this
 * a junction isn't realistic, so growth stops feeding through it even if
 * it is the nearest point. Ported verbatim; the switchboard itself is
 * capped at exactly 1 per circuit (one feed out per board terminal),
 * which computeChainEdges applies to the seed regardless of this value.
 */
export const CIRCUIT_JUNCTION_MAX_CABLES = 3;

/** Default shape of a new circuit, matching production's field-for-field. */
export function makeCircuit({ id, description, switchboardObjectId, board, cable, protectionId }) {
  return {
    id,
    description: description || '',
    kind: 'electrical',
    switchboardObjectId: switchboardObjectId || null,
    board: board || 'MSB',
    cable: cable || '2.5mm²',
    protectionId: protectionId || 'rcbo20',
    protectionCostOverride: null,
  };
}

/** Every device assigned to a circuit, across all floors. */
export function devicesOnCircuit(project, circuitId) {
  const out = [];
  for (const f of project.floors) {
    for (const o of f.objects) if (o.circuit === circuitId) out.push({ obj: o, floor: f });
  }
  return out;
}

/** Switchboards/distribution boards a circuit can be fed from. */
export function findBoardObjects(project) {
  const out = [];
  for (const f of project.floors) {
    for (const o of f.objects) {
      if (o.symbolId === 'switchboard' || o.symbolId === 'dist_board') {
        out.push({ id: o.id, label: (o.props && o.props.customName) || o.id, floorName: f.name });
      }
    }
  }
  return out;
}

/**
 * Degree-constrained nearest-neighbour tree. Ported verbatim.
 *
 * Each remaining device joins via whichever ALREADY-CONNECTED device is
 * closest — not necessarily the one added last — which is what makes the
 * run branch instead of snaking. A device stops accepting feeds at
 * `maxCables`; the seed (the board) is capped at one, because a circuit
 * leaves the board on a single feed.
 *
 * Returns edges rather than an ordered list, because the result is a
 * tree and generally has no single sequential path.
 */
export function computeChainEdges(floor, ids, seedObj, maxCables) {
  const nodes = ids.map(id => floor.objects.find(o => o.id === id)).filter(Boolean);
  if (!nodes.length) return { edges: [] };
  const cap = new Map(),
    degree = new Map();
  nodes.forEach(n => {
    cap.set(n, maxCables);
    degree.set(n, 0);
  });
  const remaining = nodes.slice();
  let root = seedObj;
  if (root) {
    cap.set(root, 1);
    degree.set(root, 0);
  } else {
    root = remaining.shift();
  }
  const inTree = [root];
  const edges = [];
  while (remaining.length) {
    let bestU = null,
      bestVIdx = -1,
      bestDist = Infinity;
    inTree.forEach(u => {
      if (degree.get(u) >= cap.get(u)) return;
      remaining.forEach((v, i) => {
        const d = Math.hypot(u.x - v.x, u.y - v.y);
        if (d < bestDist) {
          bestDist = d;
          bestU = u;
          bestVIdx = i;
        }
      });
    });
    // Every in-tree node is at its cable cap — cannot happen with
    // maxCables >= 2, but bail rather than loop forever if it ever does.
    if (!bestU) break;
    const v = remaining.splice(bestVIdx, 1)[0];
    degree.set(bestU, degree.get(bestU) + 1);
    degree.set(v, degree.get(v) + 1);
    inTree.push(v);
    edges.push({ from: bestU, to: v });
  }
  return { edges };
}

/**
 * Power circuit runs for one floor, grouped by circuit assignment.
 * Ported verbatim from computeGpoChains().
 *
 * Membership is by LAYER, not by symbol shape: every device on the Power
 * layer counts (GPOs, isolators, HWS, ovens), so a circuit mixing device
 * types still shows a complete run — which is what "isolate circuit"
 * depends on. A switch carrying its own circuit is a "hard active" (fed
 * straight from the board rather than looped off its light) and joins
 * the run system despite living on the Lighting layer; the caller draws
 * those differently.
 *
 * `categoryOf(obj)` supplies the layer. Production stores it on the
 * object; the redesign derives it from the symbol, which resolves to the
 * same value and cannot drift out of date if a symbol is recategorised.
 */
export function computeGpoChains(project, floor, categoryOf) {
  const byCircuit = {};
  floor.objects.forEach(o => {
    if (!o.circuit) return;
    const hardActiveSwitch = isSwitchSymbol(o.symbolId);
    if (categoryOf(o) !== 'power' && !hardActiveSwitch) return;
    (byCircuit[o.circuit] = byCircuit[o.circuit] || []).push(o.id);
  });
  return Object.keys(byCircuit).map(circuitId => {
    const gpoIds = byCircuit[circuitId];
    const circuit = (project.circuits || []).find(c => c.id === circuitId);
    let boardObj = null;
    if (circuit && circuit.switchboardObjectId) {
      boardObj = floor.objects.find(o => o.id === circuit.switchboardObjectId);
      // A circuit's board can live on another floor; the run still has
      // to know it exists, even though it can't be drawn to from here.
      if (!boardObj) {
        for (const f of project.floors) {
          boardObj = f.objects.find(o => o.id === circuit.switchboardObjectId);
          if (boardObj) break;
        }
      }
    }
    if (!boardObj) {
      boardObj =
        floor.objects.find(o => o.symbolId === 'switchboard' || o.symbolId === 'dist_board') ||
        null;
    }
    const { edges } = computeChainEdges(floor, gpoIds, boardObj, CIRCUIT_JUNCTION_MAX_CABLES);
    const hardActive = gpoIds.some(id =>
      isSwitchSymbol((floor.objects.find(o => o.id === id) || {}).symbolId)
    );
    return { circuitId, gpoIds, edges, boardObj, hardActive };
  });
}
