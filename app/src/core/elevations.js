// ===================================================================
// ELEVATIONS  (migration Phase 8)
//
// A resolved reading of the inventory's open owner-review item (§I.1,
// "elevations as a separate view or a third plan type"): production's
// elevation is NOT a drafting plan. Its canvas (#elevCanvas) has no
// pointer handlers at all — items are added exclusively through a
// number-entry form (device, distance from the left edge in mm,
// installation height in mm) and the canvas only ever redraws a live
// preview of that data. There is no pan, no zoom, no snapping, no tool
// rail, nothing that resembles the floor/civil drafting model.
//
// So this is built as what it actually is: a project-level list of
// named elevations (a labelled wall, its width/height in mm, and a flat
// list of {symbolId, x_mm, height_mm} items), shown in a report-style
// dialog with a live schematic preview — the same shape as the Quote,
// Panel Schedule and Civil Materials dialogs already in this app. No
// new plan type, no navigation change, nothing that needed the owner's
// sign-off §32 reserves for fundamental navigation changes.
//
// Kept project-level (not per-floor), matching production: an elevation
// is a wall in the building, not a floor-plan artifact, and a job with
// several floors still shares one elevation list.
// ===================================================================

/** Matches production's field shape exactly. */
export function makeElevation(nextId, name, width_mm, height_mm) {
  return {
    id: 'EL-' + String(nextId).padStart(3, '0'),
    name,
    width_mm,
    height_mm,
    items: [],
  };
}

export function makeElevationItem(symbolId, x_mm, height_mm) {
  return { symbolId, x_mm, height_mm };
}

export function findElevation(project, id) {
  return (project.elevations || []).find(e => e.id === id) || null;
}

/**
 * The elevation to show when none is explicitly selected — production
 * falls back to the first one in the list rather than showing nothing.
 */
export function activeElevation(project) {
  const list = project.elevations || [];
  if (!list.length) return null;
  return findElevation(project, project.activeElevationId) || list[0];
}

/**
 * Layout math for the schematic preview, ported verbatim from
 * drawElevation(): the wall is scaled to fit the canvas (uniformly, so
 * it never distorts), centred horizontally, and sits on the canvas
 * floor with `margin` clearance above and below.
 */
export function elevationLayout(elev, canvasWidth, canvasHeight, margin = 20) {
  const scaleX = (canvasWidth - margin * 2) / elev.width_mm;
  const scaleY = (canvasHeight - margin * 2) / elev.height_mm;
  const scale = Math.min(scaleX, scaleY);
  const wallW = elev.width_mm * scale;
  const wallH = elev.height_mm * scale;
  const originX = (canvasWidth - wallW) / 2;
  const originY = canvasHeight - margin - wallH;
  return { scale, wallW, wallH, originX, originY };
}

/** An item's centre point in canvas pixels, given the wall's layout. */
export function elevationItemPoint(item, layout) {
  return {
    x: layout.originX + item.x_mm * layout.scale,
    y: layout.originY + layout.wallH - item.height_mm * layout.scale,
  };
}
