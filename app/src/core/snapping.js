// ===================================================================
// SNAPPING
//
// A faithful port of the production snapPoint() precedence — device
// centre (strongest) → wall projection → axis-align to device centres →
// grid — kept deliberately identical so drafting behaviour does not
// change under the redesign. Two things are different, both additive:
//
//  1. It is PURE. Input world point + context in, result out. The
//     original wrote its guides into global mutable state, which made
//     the snap result impossible to inspect without also rendering.
//  2. It reports WHY it snapped (`reason`, and a label per guide), so
//     the UI can actually tell the user what they snapped to instead of
//     leaving it as invisible logic. Directive §7.
// ===================================================================

/** Snap strength in screen pixels — converted to world units via zoom. */
const TOL_PX = 14;

function projectOntoSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * vx, y: a.y + t * vy };
}

/**
 * @param world      {x,y} pointer position in world units
 * @param ctx        { objects, walls, gridStep, gridOriginX, gridOriginY,
 *                     zoom, enabled, excludeId, isSelectable }
 * @returns { point, guides:[{axis,value,kind,label}], target, reason }
 *          `target` is a hard point-snap (device centre / wall point);
 *          `reason` is a short human-readable string for the HUD, or null.
 */
export function snapPoint(world, ctx) {
  const empty = { point: { x: world.x, y: world.y }, guides: [], target: null, reason: null };
  if (!ctx || ctx.enabled === false) return empty;

  const zoom = ctx.zoom || 1;
  const tol = TOL_PX / zoom;
  const objects = ctx.objects || [];
  const walls = ctx.walls || [];
  const gridStep = ctx.gridStep || 0;
  const ox = ctx.gridOriginX || 0;
  const oy = ctx.gridOriginY || 0;
  const guides = [];

  const usable = objects.filter(o =>
    o.id !== ctx.excludeId && (!ctx.isSelectable || ctx.isSelectable(o))
  );

  // 1) Device centre — strongest. Snapping onto an existing device is
  //    almost always deliberate (stacking a switch under a GPO, etc.), so
  //    it wins outright and gets a slightly wider catch radius.
  let bestCentre = null, bestCentreDist = tol * 1.25;
  for (const o of usable) {
    const d = Math.hypot(o.x - world.x, o.y - world.y);
    if (d < bestCentreDist) { bestCentreDist = d; bestCentre = o; }
  }
  if (bestCentre) {
    return {
      point: { x: bestCentre.x, y: bestCentre.y },
      guides: [
        { axis: 'x', value: bestCentre.x, kind: 'device' },
        { axis: 'y', value: bestCentre.y, kind: 'device' },
      ],
      target: { x: bestCentre.x, y: bestCentre.y, id: bestCentre.id },
      reason: 'Centre of device',
    };
  }

  // 2) Wall projection — put the device on the wall line it is near.
  if (walls.length) {
    let wallPoint = null, wallDist = tol * 1.6, nearWall = null;
    for (const w of walls) {
      const proj = projectOntoSegment(world, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      const d = Math.hypot(proj.x - world.x, proj.y - world.y);
      if (d < wallDist) { wallDist = d; wallPoint = proj; nearWall = w; }
    }
    if (wallPoint) {
      const dx = Math.abs(nearWall.x2 - nearWall.x1);
      const dy = Math.abs(nearWall.y2 - nearWall.y1);
      // Guide along the wall's dominant axis only — a guide across the
      // wall would be noise.
      if (dx >= dy) guides.push({ axis: 'y', value: wallPoint.y, kind: 'wall' });
      else guides.push({ axis: 'x', value: wallPoint.x, kind: 'wall' });
      return { point: wallPoint, guides, target: null, reason: 'On wall' };
    }
  }

  // 3) Axis-align to another device's centre, falling back to the grid
  //    per axis independently — so you can be grid-aligned horizontally
  //    while lining up vertically with an existing device.
  let bestX = null, bestY = null;
  for (const o of usable) {
    const dx = Math.abs(o.x - world.x);
    const dy = Math.abs(o.y - world.y);
    if (dx < tol && (!bestX || dx < bestX.d)) bestX = { value: o.x, d: dx };
    if (dy < tol && (!bestY || dy < bestY.d)) bestY = { value: o.y, d: dy };
  }

  const point = { x: world.x, y: world.y };
  let alignedX = false, alignedY = false, grid = false;

  if (bestX) {
    point.x = bestX.value;
    guides.push({ axis: 'x', value: bestX.value, kind: 'device' });
    alignedX = true;
  } else if (gridStep > 0) {
    point.x = Math.round((world.x - ox) / gridStep) * gridStep + ox;
    if (Math.abs(point.x - world.x) < tol * 1.5) {
      guides.push({ axis: 'x', value: point.x, kind: 'grid' });
      grid = true;
    }
  }

  if (bestY) {
    point.y = bestY.value;
    guides.push({ axis: 'y', value: bestY.value, kind: 'device' });
    alignedY = true;
  } else if (gridStep > 0) {
    point.y = Math.round((world.y - oy) / gridStep) * gridStep + oy;
    if (Math.abs(point.y - world.y) < tol * 1.5) {
      guides.push({ axis: 'y', value: point.y, kind: 'grid' });
      grid = true;
    }
  }

  let reason = null;
  if (alignedX && alignedY) reason = 'Aligned to devices';
  else if (alignedX) reason = 'Aligned vertically';
  else if (alignedY) reason = 'Aligned horizontally';
  else if (grid) reason = 'Grid';

  return { point, guides, target: null, reason };
}
