// ===================================================================
// CANVAS RENDERER  (directive §3, §7, §8, §27)
//
// The drawing surface is the product, so this file gets the most care.
//
// Colour note: the drawing surface stays a fixed dark neutral regardless
// of the surrounding chrome. This is an existing, deliberate convention
// in SparkyDraft (documented in CLAUDE.md) and matches professional CAD
// practice — light chrome around a dark drawing field, so the coloured
// device symbols read at a glance. Anything drawn here must therefore
// use this file's own palette, never the app's light-theme tokens.
//
// Performance (§27): one full repaint per frame, no per-object DOM, no
// allocation in the hot loop beyond what's unavoidable. Objects are
// culled against the viewport before drawing, so a large drawing costs
// roughly what's on screen rather than what's in the file.
// ===================================================================

import { worldToScreen, gridWorldUnits, DEVICE_R } from './geometry.js';

export const PAINT = {
  bg: '#0b0f14',
  gridMinor: 'rgba(255,255,255,0.045)',
  gridMajor: 'rgba(255,255,255,0.085)',
  originX: 'rgba(248,113,113,0.55)',
  originY: 'rgba(74,222,128,0.55)',
  hover: 'rgba(255,255,255,0.5)',
  selection: '#ffffff',
  selectionSoft: 'rgba(255,255,255,0.32)',
  marqueeFill: 'rgba(32,129,245,0.12)',
  marqueeStroke: 'rgba(120,180,255,0.9)',
  snapDevice: '#ff5cf4', // magenta — matches CAD convention for object snaps
  snapWall: '#4ade80',
  snapGrid: 'rgba(255,255,255,0.28)',
  measure: '#facc15',
  label: '#eef3f9',
  labelDim: '#9fb0c4',
};

// Decoded plan images, keyed by data URL. Decoding is async and costs
// real time, so it happens once per source and the result is reused on
// every frame — re-decoding inside the paint loop would drop frames on
// every pan.
const imageCache = new Map();

export function getPlanImage(src, onReady) {
  if (!src) return null;
  const hit = imageCache.get(src);
  if (hit) return hit.complete ? hit : null;
  const img = new Image();
  img.onload = () => onReady && onReady();
  img.src = src;
  imageCache.set(src, img);
  return null;
}

function drawPlanImage(ctx, view, plan, img) {
  if (!img || !plan) return;
  const s = plan.scale || 1;
  const tl = worldToScreen(view, plan.x || 0, plan.y || 0);
  ctx.save();
  ctx.globalAlpha = plan.opacity == null ? 0.85 : plan.opacity;
  // Smoothing off when magnified past 1:1 — a scanned plan's linework
  // stays legible sharp, and turns to mush interpolated.
  ctx.imageSmoothingEnabled = view.zoom * s < 1.5;
  ctx.drawImage(img, tl.x, tl.y, img.width * s * view.zoom, img.height * s * view.zoom);
  ctx.restore();
}

/** Grid step chosen so lines never get denser than ~8px on screen. */
function gridStepsFor(spacing, zoom) {
  let step = spacing;
  while (step * zoom < 8) step *= 5;
  return { minor: step, major: step * 5 };
}

function drawGrid(ctx, view, w, h, drawing) {
  const spacing = gridWorldUnits(drawing);
  if (spacing <= 0) return;
  const { minor, major } = gridStepsFor(spacing, view.zoom);
  const ox = drawing.gridOriginX || 0;
  const oy = drawing.gridOriginY || 0;

  function lines(step, color, width) {
    const sx = step * view.zoom;
    if (sx < 4) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    const startWorldX = Math.floor(((0 - view.offsetX) / view.zoom - ox) / step) * step + ox;
    for (let wx = startWorldX; ; wx += step) {
      const x = wx * view.zoom + view.offsetX;
      if (x > w) break;
      if (x >= 0) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, h);
      }
    }
    const startWorldY = Math.floor(((0 - view.offsetY) / view.zoom - oy) / step) * step + oy;
    for (let wy = startWorldY; ; wy += step) {
      const y = wy * view.zoom + view.offsetY;
      if (y > h) break;
      if (y >= 0) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(w, Math.round(y) + 0.5);
      }
    }
    ctx.stroke();
  }

  lines(minor, PAINT.gridMinor, 1);
  lines(major, PAINT.gridMajor, 1);
}

function drawOrigin(ctx, view, w, h, drawing) {
  const o = worldToScreen(view, drawing.gridOriginX || 0, drawing.gridOriginY || 0);
  if (o.x >= -50 && o.x <= w + 50) {
    ctx.beginPath();
    ctx.strokeStyle = PAINT.originY;
    ctx.lineWidth = 1;
    ctx.moveTo(Math.round(o.x) + 0.5, 0);
    ctx.lineTo(Math.round(o.x) + 0.5, h);
    ctx.stroke();
  }
  if (o.y >= -50 && o.y <= h + 50) {
    ctx.beginPath();
    ctx.strokeStyle = PAINT.originX;
    ctx.lineWidth = 1;
    ctx.moveTo(0, Math.round(o.y) + 0.5);
    ctx.lineTo(w, Math.round(o.y) + 0.5);
    ctx.stroke();
  }
}

function drawWalls(ctx, view, walls) {
  if (!walls || !walls.length) return;
  ctx.strokeStyle = 'rgba(190,205,220,0.55)';
  ctx.lineWidth = Math.max(1.5, 3 * view.zoom * 0.5);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const wl of walls) {
    const a = worldToScreen(view, wl.x1, wl.y1);
    const b = worldToScreen(view, wl.x2, wl.y2);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

function deviceRadius(zoom) {
  // Symbols grow with zoom but clamp, so a zoomed-out overview stays
  // readable and a zoomed-in view doesn't produce absurd blobs.
  return Math.max(7, Math.min(DEVICE_R * zoom, 26));
}

function drawDevice(ctx, view, obj, sym, opts) {
  const p = worldToScreen(view, obj.x, obj.y);
  const r = deviceRadius(view.zoom);
  const color = sym ? sym.color : '#94a3b8';

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color + '2e';
  ctx.fill();
  ctx.lineWidth = opts.selected ? 2.4 : 1.5;
  ctx.strokeStyle = opts.selected ? PAINT.selection : color;
  ctx.stroke();

  if (r >= 9) {
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(8, r * 0.66)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym ? sym.abbr : '?', p.x, p.y + 0.5);
  }

  // Hover reads as a soft halo; selection as a hard dashed ring. Keeping
  // them visually distinct means the user always knows the difference
  // between "this is what I'd hit" and "this is what I have" (§8).
  if (opts.hovered && !opts.selected) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = PAINT.hover;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
  if (opts.selected) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = PAINT.selectionSoft;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (opts.locked) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `${Math.max(8, r * 0.5)}px Inter, sans-serif`;
    ctx.fillText('🔒', p.x + r, p.y - r);
  }
  if (opts.label && r >= 11) {
    ctx.fillStyle = PAINT.labelDim;
    ctx.font = '500 10px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.label, p.x, p.y + r + 4);
  }
}

/**
 * Snap guides, drawn per kind so the user can tell WHY it snapped —
 * magenta = locked to another device, green = on a wall, faint white =
 * grid. Directive §7: never rely on invisible logic.
 */
function drawSnapGuides(ctx, view, guides, w, h) {
  if (!guides || !guides.length) return;
  for (const g of guides) {
    ctx.beginPath();
    ctx.lineWidth = 1;
    if (g.kind === 'device') {
      ctx.strokeStyle = PAINT.snapDevice;
      ctx.setLineDash([]);
    } else if (g.kind === 'wall') {
      ctx.strokeStyle = PAINT.snapWall;
      ctx.setLineDash([6, 4]);
    } else {
      ctx.strokeStyle = PAINT.snapGrid;
      ctx.setLineDash([2, 4]);
    }
    if (g.axis === 'x') {
      const x = Math.round(g.value * view.zoom + view.offsetX) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    } else {
      const y = Math.round(g.value * view.zoom + view.offsetY) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawSnapTarget(ctx, view, target) {
  if (!target) return;
  const p = worldToScreen(view, target.x, target.y);
  const s = 5;
  ctx.strokeStyle = PAINT.snapDevice;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  ctx.moveTo(p.x - s, p.y - s);
  ctx.lineTo(p.x + s, p.y + s);
  ctx.moveTo(p.x + s, p.y - s);
  ctx.lineTo(p.x - s, p.y + s);
  ctx.stroke();
}

function drawMarquee(ctx, view, marquee) {
  if (!marquee) return;
  const a = worldToScreen(view, marquee.x1, marquee.y1);
  const b = worldToScreen(view, marquee.x2, marquee.y2);
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x),
    h = Math.abs(b.y - a.y);
  ctx.fillStyle = PAINT.marqueeFill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PAINT.marqueeStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  ctx.setLineDash([]);
}

/** Bounding box + corner ticks around a multi-selection (§8). */
function drawSelectionBounds(ctx, view, bounds) {
  if (!bounds) return;
  const a = worldToScreen(view, bounds.minX, bounds.minY);
  const b = worldToScreen(view, bounds.maxX, bounds.maxY);
  const pad = deviceRadius(view.zoom) + 8;
  const x = a.x - pad,
    y = a.y - pad;
  const w = b.x - a.x + pad * 2,
    h = b.y - a.y + pad * 2;
  ctx.strokeStyle = PAINT.selectionSoft;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  ctx.setLineDash([]);
  const t = 7;
  ctx.strokeStyle = PAINT.selection;
  ctx.lineWidth = 1.5;
  const corners = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of corners) {
    ctx.moveTo(cx, cy + dy * t);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * t, cy);
  }
  ctx.stroke();
}

function drawMeasure(ctx, view, measure, scale, formatDistance) {
  if (!measure || !measure.b) return;
  const a = worldToScreen(view, measure.a.x, measure.a.y);
  const b = worldToScreen(view, measure.b.x, measure.b.y);
  ctx.strokeStyle = PAINT.measure;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = PAINT.measure;
    ctx.fill();
  }
  const worldLen = Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y);
  const text = formatDistance(worldLen, scale);
  const mx = (a.x + b.x) / 2,
    my = (a.y + b.y) / 2;
  ctx.font = '600 11.5px Inter, ui-sans-serif, system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(16,22,30,0.92)';
  ctx.fillRect(mx - tw / 2 - 6, my - 18, tw + 12, 18);
  ctx.fillStyle = PAINT.measure;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, mx, my - 9);
}

/** Ghost preview of the device about to be placed, at the snapped point. */
function drawPlacementGhost(ctx, view, ghost, sym) {
  if (!ghost || !sym) return;
  const p = worldToScreen(view, ghost.x, ghost.y);
  const r = deviceRadius(view.zoom);
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = sym.color + '33';
  ctx.fill();
  ctx.strokeStyle = sym.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (r >= 9) {
    ctx.fillStyle = sym.color;
    ctx.font = `600 ${Math.max(8, r * 0.66)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym.abbr, p.x, p.y + 0.5);
  }
  ctx.globalAlpha = 1;
}

/**
 * Full repaint.
 * @param scene { drawing, view, symbolFor, selectedIds, hoverId, snap,
 *                marquee, measure, ghost, bounds, lockedIds, showLabels,
 *                formatDistance }
 */
export function renderScene(ctx, cssW, cssH, scene) {
  const { drawing, view } = scene;

  ctx.fillStyle = PAINT.bg;
  ctx.fillRect(0, 0, cssW, cssH);

  // Plan first, then grid over it — the grid is a drafting aid and needs
  // to stay readable against a dense scanned floor plan.
  if (drawing.planImage) {
    drawPlanImage(ctx, view, drawing.planImage, scene.planImg);
  }
  drawGrid(ctx, view, cssW, cssH, drawing);
  drawOrigin(ctx, view, cssW, cssH, drawing);
  drawWalls(ctx, view, drawing.walls);

  // Viewport culling — only pay for what's visible (§27).
  const pad = 60;
  const visible = [];
  for (const o of drawing.objects) {
    const p = worldToScreen(view, o.x, o.y);
    if (p.x < -pad || p.x > cssW + pad || p.y < -pad || p.y > cssH + pad) continue;
    visible.push({ o, p });
  }

  for (const { o } of visible) {
    drawDevice(ctx, view, o, scene.symbolFor(o.symbolId), {
      selected: scene.selectedIds.has(o.id),
      hovered: scene.hoverId === o.id,
      locked: scene.lockedIds ? scene.lockedIds.has(o.id) : false,
      label: scene.showLabels ? (o.props && o.props.customName) || null : null,
    });
  }

  if (scene.selectedIds.size > 1) drawSelectionBounds(ctx, view, scene.bounds);
  if (scene.snap) {
    drawSnapGuides(ctx, view, scene.snap.guides, cssW, cssH);
    drawSnapTarget(ctx, view, scene.snap.target);
  }
  drawPlacementGhost(ctx, view, scene.ghost, scene.ghostSymbol);
  drawMarquee(ctx, view, scene.marquee);
  drawMeasure(ctx, view, scene.measure, drawing.scale, scene.formatDistance);
}
