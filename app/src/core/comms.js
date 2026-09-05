// ===================================================================
// COMMS RACKS + PORTS  (migration Phase 5)
//
// Ported from index.html. Deliberately separate from the electrical
// circuit system, and the reason is physical, not architectural:
// an electrical circuit is a SHARED daisy chain (one cable feeds several
// devices), while real structured comms cabling is the opposite — every
// outlet gets its OWN dedicated home run straight back to a numbered
// port on a rack. The current app used to model comms as circuits
// (`kind:'data'`) and that misrepresented how it works, so ports live
// directly on their rack object instead: a comms_rack device carries a
// `commsPorts` array, each port a fixed numbered slot (matching a real
// patch panel — ports are never deleted, only left unassigned) that
// holds at most one device.
//
// migrateLegacyCommsData() below converts an old-format save's data
// circuits into ports. It is data-integrity critical and must run on
// load BEFORE anything reads the project, which is why this module
// exists before any comms UI does.
// ===================================================================

/** A standard patch panel. Ported verbatim. */
export const DEFAULT_COMMS_PORT_COUNT = 24;

/**
 * A rack physically needs one 24-port patch panel per 24 ports, so the
 * count is DERIVED from the port count rather than being a device the
 * user places and then has to keep in sync. The catalog still carries
 * 'patch_panel' so its price stays editable; it is just not placeable.
 */
export const PATCH_PANEL_PORTS_PER_UNIT = 24;

export function makeCommsPort(rackId, number) {
  return {
    id: rackId + '-P' + number,
    number,
    label: String(number),
    description: '',
    cable: 'Cat6',
    deviceId: null,
  };
}

export function defaultCommsPorts(rackId) {
  return Array.from({ length: DEFAULT_COMMS_PORT_COUNT }, (_, i) => makeCommsPort(rackId, i + 1));
}

export function isCommsRack(symbolId) {
  return symbolId === 'comms_rack';
}

export function patchPanelUnitsForRack(rack) {
  const portCount = (rack.commsPorts || []).length;
  return portCount > 0 ? Math.ceil(portCount / PATCH_PANEL_PORTS_PER_UNIT) : 0;
}

/**
 * Every rack in the PROJECT, not just the open floor — unlike the
 * switchboard lookup, the comms panel lists racks across floors because
 * that is how a rack is thought about (there is one comms cupboard for
 * the building, not one per level).
 */
export function allCommsRacks(project) {
  const out = [];
  project.floors.forEach((f, floorIndex) => {
    f.objects.forEach(o => {
      if (isCommsRack(o.symbolId)) out.push({ rack: o, floorIndex, floorName: f.name });
    });
  });
  return out;
}

export function allPatchPanelLines(project) {
  const lines = [];
  allCommsRacks(project).forEach(({ rack, floorIndex, floorName }) => {
    const units = patchPanelUnitsForRack(rack);
    if (units > 0) lines.push({ rack, floorIndex, floorName, units });
  });
  return lines;
}

export function findCommsPort(project, portId) {
  for (const entry of allCommsRacks(project)) {
    const port = (entry.rack.commsPorts || []).find(p => p.id === portId);
    if (port) return { ...entry, port };
  }
  return null;
}

/**
 * The port a device occupies, if any — used to label a data outlet on
 * the plan with the sparky's own port label (they usually number data
 * points 1, 2, 3…) rather than a circuit id, which comms devices have
 * no concept of.
 */
export function portForDevice(floor, deviceId) {
  for (const rack of floor.objects.filter(o => isCommsRack(o.symbolId))) {
    const port = (rack.commsPorts || []).find(p => p.deviceId === deviceId);
    if (port) return port;
  }
  return null;
}

export function nextCommsPortNumber(rack) {
  const ports = rack.commsPorts || [];
  return ports.length ? Math.max(...ports.map(p => p.number)) + 1 : 1;
}

/**
 * Ports a device may be assigned to: every port on every rack minus the
 * ones already taken by a DIFFERENT device, plus whichever port this
 * device currently holds so it shows as selected. One home run per
 * device, one device per port — the rule a real installation follows.
 */
export function commsPortOptions(project, deviceId) {
  const out = [];
  allCommsRacks(project).forEach(({ rack, floorName }) => {
    (rack.commsPorts || []).forEach(port => {
      if (port.deviceId && port.deviceId !== deviceId) return;
      const rackName = (rack.props && rack.props.customName) || 'Rack ' + rack.id;
      out.push({
        id: port.id,
        label: rackName + ' — ' + (port.label || 'Port ' + port.number),
        floorName,
        selected: port.deviceId === deviceId,
      });
    });
  });
  return out;
}

/**
 * Home-run lines for the canvas: one per occupied port, rack straight to
 * its device. Restricted to devices on the same floor as their rack,
 * since only one floor is drawn at a time.
 */
export function computeCommsRuns(floor) {
  const runs = [];
  floor.objects
    .filter(o => isCommsRack(o.symbolId))
    .forEach(rack => {
      (rack.commsPorts || []).forEach(port => {
        if (!port.deviceId) return;
        const device = floor.objects.find(o => o.id === port.deviceId);
        if (device) runs.push({ rack, port, device });
      });
    });
  return runs;
}

/**
 * Assign a device to a port, clearing wherever it was before — a device
 * can hold at most one home run. A falsy portId just unassigns.
 * Mutates the project draft; the caller owns the commit.
 */
export function assignDeviceToPort(project, deviceId, portId) {
  allCommsRacks(project).forEach(({ rack }) =>
    (rack.commsPorts || []).forEach(p => {
      if (p.deviceId === deviceId) p.deviceId = null;
    })
  );
  if (portId) {
    const found = findCommsPort(project, portId);
    if (found) found.port.deviceId = deviceId;
  }
}

/**
 * Converts leftover `kind:'data'` circuits from the old shared-circuit
 * comms model into ports on their linked rack. Ported verbatim.
 *
 * A connection whose rack is missing (or was never linked) cannot be
 * attached to anything physical, so it is kept in
 * `unassignedCommsPorts` rather than silently dropped, and surfaced in
 * the comms panel so it can be placed by hand. The old `circuit`
 * reference on each device is cleared, because the port's `deviceId` now
 * represents that link and a stale value would sit there pointing at a
 * circuit id that no longer exists.
 *
 * Runs on load against the raw loaded data, before anything reads it.
 */
export function migrateLegacyCommsData(d) {
  const legacy = (d.circuits || []).filter(c => c.kind === 'data');
  const unassigned = (d.unassignedCommsPorts || []).slice();
  legacy.forEach(c => {
    let rackObj = null;
    if (c.switchboardObjectId) {
      (d.floors || []).forEach(f => {
        const r = (f.objects || []).find(o => o.id === c.switchboardObjectId);
        if (r) rackObj = r;
      });
    }
    const linkedDeviceIds = [];
    (d.floors || []).forEach(f =>
      (f.objects || []).forEach(o => {
        if (o.circuit === c.id) {
          linkedDeviceIds.push(o.id);
          o.circuit = '';
        }
      })
    );
    const portsToMake = linkedDeviceIds.length
      ? linkedDeviceIds.map(id => ({ deviceId: id }))
      : [{ deviceId: null }];
    if (rackObj) {
      if (!rackObj.commsPorts) rackObj.commsPorts = [];
      portsToMake.forEach((p, i) => {
        const num = nextCommsPortNumber(rackObj);
        rackObj.commsPorts.push({
          ...makeCommsPort(rackObj.id, num),
          label: portsToMake.length > 1 ? c.id + ' (' + (i + 1) + ')' : c.id,
          description: c.description || '',
          cable: c.cable || 'Cat6',
          deviceId: p.deviceId,
        });
      });
    } else {
      portsToMake.forEach((p, i) => {
        unassigned.push({
          id: 'LEGACY-' + c.id + (portsToMake.length > 1 ? '-' + (i + 1) : ''),
          label: portsToMake.length > 1 ? c.id + ' (' + (i + 1) + ')' : c.id,
          description: c.description || '',
          cable: c.cable || 'Cat6',
          deviceId: p.deviceId,
        });
      });
    }
  });
  return { circuits: (d.circuits || []).filter(c => c.kind !== 'data'), unassigned };
}
