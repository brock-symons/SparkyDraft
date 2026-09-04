// ===================================================================
// CIVIL CANVAS RENDERER  (migration Phase 7)
//
// A separate render pass, deliberately — the same choice production
// makes. Nothing on the electrical side (devices, circuits, switch
// links, comms home runs, layers) applies to a civil plan, so threading
// conditionals through the rough-in renderer would only make both
// harder to change. The plan-type-agnostic parts (plan image, grid,
// origin, dimensions, snap feedback, measure) are shared from
// renderer.js rather than duplicated.
//
// The visual language is ported: conduit and overhead runs are
// polylines coloured by their own size table (electrical orange, comms
// blue, overhead purple — three families that must never be mistaken
// for each other), overhead is dashed so it reads as "not buried",
// pits are filled circles like electrical devices, a private pole is
// filled because the job owns it while a network pole is hollow because
// it does not, and a building entry is a rotated square so it never
// reads as "just another pit".
// ===================================================================

import { worldToScreen } from './geometry.js';
import {
  PAINT,
  drawPlanImage,
  drawGrid,
  drawOrigin,
  drawDimensions,
  drawSnapGuides,
  drawSnapTarget,
  drawMeasure,
} from './renderer.js';
import { conduitLength, conduitSizeTable } from './civil.js';
import { PIT_LIBRARY, POLE_LIBRARY, OVERHEAD_CONDUCTOR_SIZES } from './civilCatalog.js';

const LABEL_FONT = '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
const BADGE_FONT = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';

/** Mid-run label with a backing plate, so it stays readable over a plan. */
function runLabel(ctx, view, points, text, color) {
  const mid = points[Math.floor((points.length - 1) / 2)];
  const mid2 = points[Math.ceil((points.length - 1) / 2)];
  if (!mid || !mid2 || !text) return;
  const p1 = worldToScreen(view, mid.x, mid.y);
  const p2 = worldToScreen(view, mid2.x, mid2.y);
  const mx = (p1.x + p2.x) / 2,
    my = (p1.y + p2.y) / 2;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(11,15,20,0.92)';
  ctx.fillRect(mx - w / 2, my - 8, w, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, mx, my);
}

/** Draggable vertex handles, shown only on the selected run. */
function vertexHandles(ctx, view, points, color) {
  for (const pt of points) {
    const p = worldToScreen(view, pt.x, pt.y);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
  }
}

function polyline(ctx, view, points) {
  ctx.beginPath();
  points.forEach((pt, i) => {
    const p = worldToScreen(view, pt.x, pt.y);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
}

function drawConduits(ctx, view, plan, selectedId) {
  for (const cd of plan.conduits || []) {
    const table = conduitSizeTable(cd.category);
    const size = table.find(s => s.id === cd.sizeId) || table[0];
    const selected = cd.id === selectedId;
    ctx.strokeStyle = size.color;
    ctx.lineWidth = selected ? 5 : 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    polyline(ctx, view, cd.points);
    ctx.stroke();
    if (selected) vertexHandles(ctx, view, cd.points, size.color);

    const len = conduitLength(cd);
    const label =
      size.size +
      (cd.category === 'comms' ? ' comms' : '') +
      (cd.transition === 'ugoh' ? ' · UGOH' : '') +
      (plan.scale ? ' · ' + (len / plan.scale).toFixed(1) + 'm' : '');
    runLabel(ctx, view, cd.points, label, size.color);
  }
}

function drawOverheadRuns(ctx, view, plan, selectedId) {
  for (const run of plan.overheadRuns || []) {
    const size =
      OVERHEAD_CONDUCTOR_SIZES.find(s => s.id === run.sizeId) || OVERHEAD_CONDUCTOR_SIZES[0];
    const selected = run.id === selectedId;
    ctx.strokeStyle = size.color;
    ctx.lineWidth = selected ? 4.5 : 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Dashed so an aerial run reads as "not buried" at a glance.
    ctx.setLineDash([10, 6]);
    polyline(ctx, view, run.points);
    ctx.stroke();
    ctx.setLineDash([]);
    if (selected) vertexHandles(ctx, view, run.points, size.color);

    const len = conduitLength(run);
    const label =
      size.label +
      (run.transition === 'ohug' ? ' · OHUG' : '') +
      (plan.scale ? ' · ' + (len / plan.scale).toFixed(1) + 'm' : '');
    runLabel(ctx, view, run.points, label, size.color);
  }
}

/** In-progress polyline: dashed, with a rubber band out to the cursor. */
function drawRunDraft(ctx, view, draft, hover, color) {
  if (!draft || !draft.points.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  polyline(ctx, view, draft.points);
  if (hover) {
    const p = worldToScreen(view, hover.x, hover.y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const pt of draft.points) {
    const p = worldToScreen(view, pt.x, pt.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawBuildingEntry(ctx, view, be, r, selected) {
  const p = worldToScreen(view, be.x, be.y);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#38bdf8' + (selected ? 'ff' : 'dd');
  ctx.fillRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
  if (selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
  }
  ctx.restore();
  ctx.fillStyle = '#0b0f14';
  ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BE', p.x, p.y);
  // Role tags stack underneath so a switchboard/NBN/eave connection is
  // readable without opening properties.
  const tags = [
    be.isSwitchboardConnection ? 'SB' : null,
    be.isNbnConnection ? 'NBN' : null,
    be.isOverheadAttachment ? 'EAVE' : null,
  ].filter(Boolean);
  if (tags.length) {
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(tags.join('/'), p.x, p.y + r + 10);
  }
}

function drawPit(ctx, view, pit, r, selected) {
  const type = PIT_LIBRARY.find(t => t.id === pit.typeId) || PIT_LIBRARY[0];
  const p = worldToScreen(view, pit.x, pit.y);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = type.color + (selected ? 'ff' : 'dd');
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.fillStyle = '#0b0f14';
  ctx.font = BADGE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(type.abbr, p.x, p.y);
}

function drawPole(ctx, view, pole, r, selected) {
  const isPrivate = pole.ownership === 'private';
  const type = isPrivate ? POLE_LIBRARY.find(t => t.id === pole.typeId) || POLE_LIBRARY[0] : null;
  const color = isPrivate ? type.color : '#94a3b8';
  const p = worldToScreen(view, pole.x, pole.y);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  if (isPrivate) {
    // Filled: an owned asset, same visual weight as a pit.
    ctx.fillStyle = color + (selected ? 'ff' : 'dd');
    ctx.fill();
  } else {
    // Hollow and dashed: a network pole is an attachment point this job
    // neither owns nor installs, and must never read as one it does.
    ctx.fillStyle = PAINT.bg;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    ctx.stroke();
  }
  ctx.fillStyle = isPrivate ? '#0b0f14' : color;
  ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isPrivate ? type.abbr : 'NP', p.x, p.y);
}

/** Ghost of the thing about to be placed, following the cursor. */
function drawGhost(ctx, view, scene, r) {
  const g = scene.ghost;
  if (!g) return;
  const p = worldToScreen(view, g.x, g.y);
  ctx.save();
  ctx.globalAlpha = 0.5;
  if (scene.tool === 'civil.pit') {
    const type = PIT_LIBRARY.find(t => t.id === scene.activePitTypeId) || PIT_LIBRARY[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = type.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#0b0f14';
    ctx.font = BADGE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(type.abbr, p.x, p.y);
  } else if (scene.tool === 'civil.buildingEntry') {
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
  } else if (scene.tool === 'civil.pole') {
    const isPrivate = (scene.activePoleOwnership || 'private') === 'private';
    const type = isPrivate
      ? POLE_LIBRARY.find(t => t.id === scene.activePoleTypeId) || POLE_LIBRARY[0]
      : null;
    const color = isPrivate ? type.color : '#94a3b8';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = isPrivate ? '#0b0f14' : color;
    ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isPrivate ? type.abbr : 'NP', p.x, p.y);
  }
  ctx.restore();
}

/**
 * Draw order, deliberate: plan image → grid → dimensions → runs →
 * building entries → pits → poles. Runs sit under the point objects they
 * connect, so an endpoint badge is never crossed by its own conduit.
 */
export function renderCivilScene(ctx, cssW, cssH, scene) {
  const { plan, view } = scene;

  ctx.fillStyle = PAINT.bg;
  ctx.fillRect(0, 0, cssW, cssH);

  if (plan.planImage) drawPlanImage(ctx, view, plan.planImage, scene.planImg);
  if (plan.gridVisible !== false) {
    drawGrid(ctx, view, cssW, cssH, plan);
    drawOrigin(ctx, view, cssW, cssH, plan);
  }

  drawDimensions(ctx, view, plan.dimensions || [], plan.scale, scene.formatDistance, null);

  const sel = scene.selection || {};
  drawConduits(ctx, view, plan, sel.conduitId);
  drawRunDraft(ctx, view, scene.conduitDraft, scene.draftHover, scene.draftColor);
  drawOverheadRuns(ctx, view, plan, sel.overheadRunId);
  drawRunDraft(ctx, view, scene.overheadDraft, scene.draftHover, scene.draftColor);

  const r = scene.symbolSize;
  for (const be of plan.buildingEntries || []) {
    drawBuildingEntry(ctx, view, be, r, be.id === sel.buildingEntryId);
  }
  for (const pit of plan.pits || []) {
    drawPit(ctx, view, pit, r, pit.id === sel.pitId);
  }
  for (const pole of plan.poles || []) {
    drawPole(ctx, view, pole, r, pole.id === sel.poleId);
  }

  if (scene.snap) {
    drawSnapGuides(ctx, view, scene.snap.guides, cssW, cssH);
    drawSnapTarget(ctx, view, scene.snap.target);
  }
  drawGhost(ctx, view, scene, r);
  drawMeasure(ctx, view, scene.measure, plan.scale, scene.formatDistance);
}
