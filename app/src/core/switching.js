// ===================================================================
// SWITCH LINKING + LIGHTING BANKS  (migration Phase 2)
//
// Ported from index.html §30/§31 — the switching model is business
// logic, not UI, so everything here mirrors production's behaviour
// rather than being re-derived. Two ideas do the work:
//
//  * A SWITCH LINK is switching *logic*: "switch S, gang G controls
//    light L". It is stored (floor.switchLinks) because only the user
//    knows it.
//  * A LIGHTING BANK is the *physical wiring* that logic implies: one
//    daisy-chained run through the controlled devices, with a tail from
//    each controlling switch. It is DERIVED on demand, never stored, so
//    it re-routes by itself when a device is moved and can never go
//    stale against the links.
//
// The only thing this module cannot do framework-free is look up a
// symbol, because the redesign lets a project add custom fittings on
// top of the shipped catalog. Callers pass a `symbolFor(id)` resolver
// so a custom fitting names its bank correctly instead of resolving to
// nothing (the same catalog-only bug Phase 1 hit in the renderer).
// ===================================================================

// Ported verbatim — these are explicit lists in production, not a
// category filter, and the distinction matters: a PIR sensor and a PE
// cell are catalogued under lighting but are not switches you link
// from, and a Tastic is a light you link *to*.
export const SWITCH_IDS = ['switch_1g', 'switch_2way', 'switch_intermediate', 'dimmer'];
export const LIGHT_IDS = [
  'downlight',
  'batten',
  'pendant',
  'wall_light',
  'sensor_light',
  'flood_light',
  'led_strip',
  'ceiling_light',
  'exit_light',
  'emergency_light',
  'tastic_2h',
  'tastic_4h',
  'exhaust_fan',
  'ceiling_fan',
];

export function isSwitchSymbol(symbolId) {
  return SWITCH_IDS.includes(symbolId);
}
export function isLightSymbol(symbolId) {
  return LIGHT_IDS.includes(symbolId);
}

/** Links belonging to one switch, in stored order. */
export function linksForSwitch(floor, switchId) {
  return (floor.switchLinks || []).filter(l => l.switchId === switchId);
}
/** Links pointing at one light — more than one means two-way switching. */
export function linksForLight(floor, lightId) {
  return (floor.switchLinks || []).filter(l => l.lightId === lightId);
}

/** Links bucketed by gang number, ascending. */
export function groupsForSwitch(floor, switchId) {
  const byGroup = {};
  for (const l of linksForSwitch(floor, switchId)) {
    const g = l.group || 1;
    (byGroup[g] = byGroup[g] || []).push(l);
  }
  return Object.keys(byGroup)
    .map(Number)
    .sort((a, b) => a - b)
    .map(g => ({ group: g, links: byGroup[g], lightIds: byGroup[g].map(l => l.lightId) }));
}

// -------------------------------------------------------------------
// Gang count
//
// Ported verbatim from recomputeSwitchGang(). Gang is driven by
// switching *functions*, not device count: a bank of downlights on one
// group is 1 gang, a 4-heat Tastic is 4 functions, a 2-heat Tastic is 3.
// -------------------------------------------------------------------

export function recomputeSwitchGang(floor, switchId) {
  const sw = floor.objects.find(o => o.id === switchId);
  if (!sw || !isSwitchSymbol(sw.symbolId)) return;
  const links = linksForSwitch(floor, switchId);
  const byGroup = {};
  links.forEach(l => {
    const g = l.group || 1;
    (byGroup[g] = byGroup[g] || []).push(l.lightId);
  });
  let total = 0;
  Object.keys(byGroup).forEach(g => {
    const types = byGroup[g].map(id => {
      const o = floor.objects.find(x => x.id === id);
      return o ? o.symbolId : '';
    });
    if (types.includes('tastic_4h')) total += 4;
    else if (types.includes('tastic_2h')) total += 3;
    else total += 1;
  });
  // Only ever RAISE the gang count, never lower it: unlinking a light
  // must not silently undo a gang the user set deliberately for a
  // physical plate that hasn't changed.
  if (!sw.props) sw.props = {};
  sw.props.gang = Math.max(sw.props.gang || 1, total);
}

/**
 * Which gang a newly linked device joins when the user hasn't chosen
 * one. Ported verbatim: devices of a type already linked to this switch
 * are assumed to be the same switching function (four downlights on one
 * switch = one function); a genuinely new device type gets its own gang.
 */
export function autoGroupForSwitchLink(floor, switchId, lightSymbolId) {
  const links = linksForSwitch(floor, switchId);
  const sameType = links.find(l => {
    const lt = floor.objects.find(o => o.id === l.lightId);
    return lt && lt.symbolId === lightSymbolId;
  });
  if (sameType) return sameType.group || 1;
  const groups = links.map(l => l.group || 1);
  return groups.length ? Math.max(...groups) + 1 : 1;
}

/** The gang number "+ New group" should start. */
export function nextGroupForSwitch(floor, switchId) {
  const groups = linksForSwitch(floor, switchId).map(l => l.group || 1);
  return groups.length ? Math.max(...groups) + 1 : 1;
}

// -------------------------------------------------------------------
// Bank naming
// -------------------------------------------------------------------

/**
 * Display name for one bank. Ported verbatim from bankDisplayName():
 * an explicit name wins; otherwise a shared custom name on every device
 * in the bank wins; otherwise a "2 x Downlight" type summary.
 */
export function bankDisplayName(floor, switchId, group, lightIds, symbolFor) {
  const key = switchId + '::' + (group || 1);
  if (floor.bankNames && floor.bankNames[key]) return floor.bankNames[key];
  const objs = (lightIds || []).map(id => floor.objects.find(o => o.id === id)).filter(Boolean);
  if (
    objs.length &&
    objs.every(
      o => o.props && o.props.customName && o.props.customName === objs[0].props.customName
    )
  ) {
    return objs[0].props.customName;
  }
  const counts = {};
  objs.forEach(o => {
    const sym = symbolFor ? symbolFor(o.symbolId) : null;
    const label = sym ? sym.label : o.symbolId;
    counts[label] = (counts[label] || 0) + 1;
  });
  return (
    Object.entries(counts)
      .map(([label, n]) => n + ' × ' + label)
      .join(', ') || 'Group ' + (group || 1)
  );
}

export function bankKey(switchId, group) {
  return switchId + '::' + (group || 1);
}

// -------------------------------------------------------------------
// Derived physical wiring
// -------------------------------------------------------------------

/**
 * Ported verbatim from computeLightingBanks(). Switch/gang assignments
 * that control the EXACT same set of device ids collapse into one bank —
 * that is how two-way and intermediate switching is represented (one
 * lighting group, several control points), so the result is one daisy
 * chain fed by several switches rather than a chain per switch.
 */
export function computeLightingBanks(floor) {
  const assignMap = {};
  (floor.switchLinks || []).forEach(l => {
    const key = l.switchId + '::' + (l.group || 1);
    if (!assignMap[key])
      assignMap[key] = { switchId: l.switchId, group: l.group || 1, lightIds: [] };
    assignMap[key].lightIds.push(l.lightId);
  });
  const bankMap = {};
  Object.values(assignMap).forEach(a => {
    if (!a.lightIds.length) return;
    const sig = a.lightIds.slice().sort().join('|');
    if (!bankMap[sig]) bankMap[sig] = { lightIds: a.lightIds.slice(), switches: [] };
    bankMap[sig].switches.push({ switchId: a.switchId, group: a.group });
  });
  return Object.values(bankMap);
}

/**
 * Greedy nearest-neighbour route through a set of device ids, starting
 * from seedPos (normally the controlling switch). Ported verbatim.
 * Favours short, logical runs over device creation order, and because
 * it is recomputed from live positions it re-routes automatically when
 * a device moves — there is no stored order to go stale.
 */
export function computeChainOrder(floor, lightIds, seedPos) {
  const remaining = lightIds.map(id => floor.objects.find(o => o.id === id)).filter(Boolean);
  const order = [];
  let cur = seedPos;
  while (remaining.length) {
    let bestIdx = 0,
      bestDist = Infinity;
    remaining.forEach((o, i) => {
      const d = Math.hypot(o.x - cur.x, o.y - cur.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    const next = remaining.splice(bestIdx, 1)[0];
    order.push(next);
    cur = next;
  }
  return order;
}

/**
 * Where each controlling switch's single tail lands: the nearest device
 * in the chain, not a separate feed to every device. Ported verbatim.
 */
export function computeBankAttachPoints(floor, bank, order) {
  return bank.switches
    .map(s => {
      const swObj = floor.objects.find(o => o.id === s.switchId);
      if (!swObj || !order.length) return null;
      let nearest = order[0],
        nd = Infinity;
      order.forEach(o => {
        const d = Math.hypot(o.x - swObj.x, o.y - swObj.y);
        if (d < nd) {
          nd = d;
          nearest = o;
        }
      });
      return { switchObj: swObj, attachTo: nearest };
    })
    .filter(Boolean);
}

/**
 * A switch is fed from its circuit's run, and the lights it controls
 * loop off that same run — so they belong on the same circuit. Ported
 * verbatim; called whenever a switch's circuit is set or a new link is
 * made on a switch that already has one.
 *
 * No-op until circuits land (Phase 3), but it lives here because this
 * is the operation it belongs to, not the circuits UI — adding it later
 * would mean revisiting every link call site.
 */
export function propagateSwitchCircuitToLinkedLights(floor, switchObj) {
  if (!isSwitchSymbol(switchObj.symbolId) || !switchObj.circuit) return;
  linksForSwitch(floor, switchObj.id).forEach(l => {
    const light = floor.objects.find(o => o.id === l.lightId);
    if (light) light.circuit = switchObj.circuit;
  });
}

/**
 * Drop every link touching the given device ids and re-derive the gang
 * count on the switches that survive. Used by delete — production does
 * this inline at each delete site; centralising it here means a new
 * delete path cannot forget one half of it and leave orphan links
 * pointing at devices that no longer exist.
 */
export function removeLinksForObjects(floor, ids) {
  const affected = new Set(
    (floor.switchLinks || []).filter(l => ids.has(l.lightId)).map(l => l.switchId)
  );
  floor.switchLinks = (floor.switchLinks || []).filter(
    l => !ids.has(l.switchId) && !ids.has(l.lightId)
  );
  affected.forEach(swId => {
    if (!ids.has(swId)) recomputeSwitchGang(floor, swId);
  });
}
