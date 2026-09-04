// ===================================================================
// GEOMETRY / VIEW MATH
//
// Pure functions — no canvas, no DOM, no app state. Kept separate so
// hit-testing and coordinate maths can be reasoned about (and later
// unit-tested) without standing up a renderer.
// ===================================================================

/** Screen-space radius used for a device's clickable/drawn footprint. */
export const DEVICE_R = 15;

export function worldToScreen(view, x, y) {
  return { x: x * view.zoom + view.offsetX, y: y * view.zoom + view.offsetY };
}

export function screenToWorld(view, x, y) {
  return { x: (x - view.offsetX) / view.zoom, y: (y - view.offsetY) / view.zoom };
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Nearest object to a world point within `tolerance` world units.
 * `isSelectable` lets the caller exclude hidden/locked layers without this
 * module needing to know what a layer is.
 */
export function hitTestObjects(objects, world, tolerance, isSelectable) {
  let best = null;
  let bestD = tolerance;
  for (const o of objects) {
    if (isSelectable && !isSelectable(o)) continue;
    const d = dist(o.x, o.y, world.x, world.y);
    if (d <= bestD) { best = o; bestD = d; }
  }
  return best;
}

/** Objects whose centres fall inside a world-space rectangle (marquee select). */
export function objectsInRect(objects, rect, isSelectable) {
  const x1 = Math.min(rect.x1, rect.x2), x2 = Math.max(rect.x1, rect.x2);
  const y1 = Math.min(rect.y1, rect.y2), y2 = Math.max(rect.y1, rect.y2);
  return objects.filter(o => {
    if (isSelectable && !isSelectable(o)) return false;
    return o.x >= x1 && o.x <= x2 && o.y >= y1 && o.y <= y2;
  });
}

/** Axis-aligned bounds of a set of objects, or null when empty. */
export function boundsOf(objects) {
  if (!objects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objects) {
    if (o.x < minX) minX = o.x;
    if (o.x > maxX) maxX = o.x;
    if (o.y < minY) minY = o.y;
    if (o.y > maxY) maxY = o.y;
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/**
 * View that frames `bounds` inside a viewport, with padding in screen px.
 * Falls back to a centred identity view when there is nothing to frame, so
 * callers never have to special-case an empty drawing.
 */
export function viewForBounds(bounds, viewportW, viewportH, padPx = 80, maxZoom = 4) {
  if (!bounds || !isFinite(bounds.minX)) {
    return { zoom: 1, offsetX: viewportW / 2, offsetY: viewportH / 2 };
  }
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  // Padding must never consume the whole viewport. A fixed 80px inset
  // against a short viewport made the available height NEGATIVE, which
  // produced a negative zoom that then failed the `> 0` check and fell
  // back to 1:1 — the drawing silently didn't fit, with no error.
  const pad = Math.max(0, Math.min(padPx, viewportW * 0.15, viewportH * 0.15));
  const zoom = Math.min(
    (viewportW - pad * 2) / w,
    (viewportH - pad * 2) / h,
    maxZoom
  );
  const z = isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    zoom: z,
    offsetX: viewportW / 2 - bounds.cx * z,
    offsetY: viewportH / 2 - bounds.cy * z,
  };
}

/** Zoom about a fixed screen point, so the point under the cursor stays put. */
export function zoomAt(view, screenX, screenY, factor, min = 0.05, max = 12) {
  const before = screenToWorld(view, screenX, screenY);
  const zoom = Math.min(max, Math.max(min, view.zoom * factor));
  const next = { ...view, zoom };
  const after = worldToScreen(next, before.x, before.y);
  next.offsetX += screenX - after.x;
  next.offsetY += screenY - after.y;
  return next;
}

// SCALE SEMANTICS — matches the production app exactly.
//
//   scale = world units (canvas px) per METRE
//
// Set by calibration as `distancePx / realMetres`. The redesign
// originally stored mm-per-unit, which is a different quantity in
// different units; every ported calculation (cable-run estimates, the
// panel schedule, dimension readouts) is written against production's
// definition, so the production one is authoritative here. Getting this
// backwards silently produces plausible-looking but wrong lengths.

/** World units → metres. Null scale means uncalibrated. */
export function worldToMetres(worldUnits, scale) {
  if (!scale) return null;
  return worldUnits / scale;
}

/** Metres → world units. */
export function metresToWorld(metres, scale) {
  if (!scale) return null;
  return metres * scale;
}

/** Format a world-unit distance for display, given a units-per-metre scale. */
export function formatDistance(worldUnits, scale) {
  if (!scale) return Math.round(worldUnits) + ' u';
  const metres = worldUnits / scale;
  const mm = metres * 1000;
  if (mm >= 1000) return metres.toFixed(2) + ' m';
  return Math.round(mm) + ' mm';
}

/**
 * Grid spacing in world units, from the floor's real-millimetre setting.
 * Ported from production's effectiveGridWorldUnits(): before calibration
 * there is no metre reference, so fall back to a fixed screen spacing
 * that still gives a usable drafting grid.
 */
export function gridWorldUnits(floor) {
  if (floor && floor.scale) return (floor.gridSpacingMM / 1000) * floor.scale;
  return 25;
}
