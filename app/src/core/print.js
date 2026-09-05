// ===================================================================
// PRINT / PDF / EXPORT  (Phase 9)
//
// Production builds a takeoff/handoff document by temporarily resizing
// its ONE live canvas to export resolution, forcing print-only render
// flags (white background, no grid, every switch/circuit run visible,
// circuit labels on), painting each floor/civil plan in turn, and
// capturing each as a JPEG data URL — then restores the live view
// exactly as it was. `printPagesData` in index.html is the result.
//
// Ported here as the same idea with an OFFSCREEN canvas instead of the
// live one, because the redesign's canvas is owned by React
// (CanvasStage.jsx) and reusing it for a multi-page capture would mean
// fighting React for control of an element it re-renders on its own
// schedule. Nothing about the live canvas is touched by any function in
// this file — no save/restore dance is needed because there is nothing
// shared to disturb.
//
// This module is framework-free like the rest of core/ (no React), but
// unlike catalog/geometry/document it does touch the canvas and Image
// APIs directly — the same category of DOM contact renderer.js already
// has, since both take a real CanvasRenderingContext2D.
// ===================================================================

import { boundsOf, viewForBounds, formatDistance } from './geometry.js';
import { renderScene } from './renderer.js';
import { renderCivilScene } from './civilRenderer.js';
import { computeLegendEntries } from './legend.js';
import { computeCivilLegendEntries } from './civil.js';

// ~A4 landscape ratio, matching production's capture resolution exactly
// (index.html: `canvas.width = 1600; canvas.height = 1131`) — the PDF
// page layout math (margins, column widths) was tuned against this
// aspect ratio, so it is carried over rather than picked afresh.
export const CAPTURE_W = 1600;
export const CAPTURE_H = 1131;
const MARGIN = 30;

const EMPTY_SET = new Set();

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    // A broken/unreadable image degrades to "no underlay" rather than
    // failing the whole export — the devices and legend are still the
    // useful part of the page.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Same fit-to-content math as the live Fit button and production's
 * fitViewToContent()/fitViewToContentCivil(), at the fixed capture
 * resolution instead of the viewport's actual size.
 */
function fitView(bounds, planImage) {
  if (planImage) {
    const sX = (CAPTURE_W - MARGIN * 2) / planImage.width;
    const sY = (CAPTURE_H - MARGIN * 2) / planImage.height;
    const zoom = Math.min(sX, sY, 4);
    return {
      zoom,
      offsetX: (CAPTURE_W - planImage.width * zoom) / 2,
      offsetY: (CAPTURE_H - planImage.height * zoom) / 2,
    };
  }
  return viewForBounds(bounds, CAPTURE_W, CAPTURE_H, MARGIN, 4);
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = CAPTURE_W;
  canvas.height = CAPTURE_H;
  return canvas;
}

/**
 * One floor, captured exactly as production's captureFloorSnapshot()
 * does: current layer visibility respected (this is NOT a "show
 * everything" render — a hidden layer stays hidden on the printed page,
 * same as the live drawing), but every switch/circuit/comms run and
 * every circuit label forced ON regardless of the live toggles, because
 * a takeoff document is read by someone who was not sitting at this
 * screen deciding what to declutter.
 */
async function captureFloorSnapshot(
  floor,
  { project, symbolFor, isVisible, isLayerHidden, categoryOf, symbolSize }
) {
  const planImg = await loadImage(floor.planImage && floor.planImage.src);
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const view = fitView(boundsOf(floor.objects), floor.planImage);

  renderScene(ctx, CAPTURE_W, CAPTURE_H, {
    planImg,
    drawing: floor,
    view,
    symbolFor,
    selectedIds: EMPTY_SET,
    hoverId: null,
    lockedIds: EMPTY_SET,
    isVisible,
    isLayerHidden,
    showSwitchRuns: true,
    project,
    categoryOf,
    isolatedCircuitId: null,
    showCircuitLabels: true,
    snap: null,
    marquee: null,
    measure: null,
    draft: null,
    cursorWorld: null,
    selectedSegment: null,
    symbolSize,
    activeCableColor: null,
    ghost: null,
    ghostSymbol: null,
    bounds: null,
    showLabels: false,
    formatDistance,
    printMode: true,
  });

  // JPEG, not PNG, for the same reason production picked it: the capture
  // is a fully opaque white-background render with nothing needing real
  // transparency, and some PDF viewers render PNGs embedded via jsPDF
  // with washed-out colour. JPEG has no alpha channel, so that class of
  // bug cannot happen.
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** Every point a civil plan places, for framing — mirrors production's civilContentBounds(). */
function civilContentBounds(plan) {
  const pts = []
    .concat(plan.pits || [], plan.poles || [], plan.buildingEntries || [])
    .map(o => ({ x: o.x, y: o.y }));
  for (const run of (plan.conduits || []).concat(plan.overheadRuns || [])) {
    for (const p of run.points || []) pts.push({ x: p.x, y: p.y });
  }
  return boundsOf(pts);
}

async function captureCivilPlanSnapshot(plan, { symbolSize }) {
  const planImg = await loadImage(plan.planImage && plan.planImage.src);
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const view = fitView(civilContentBounds(plan), plan.planImage);

  renderCivilScene(ctx, CAPTURE_W, CAPTURE_H, {
    plan,
    view,
    planImg,
    symbolSize,
    selection: {},
    conduitDraft: null,
    overheadDraft: null,
    draftHover: null,
    draftColor: null,
    tool: null,
    ghost: null,
    activePitTypeId: null,
    activePoleTypeId: null,
    activePoleOwnership: null,
    snap: null,
    measure: null,
    formatDistance,
    printMode: true,
  });

  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * The three kinds of civil legend entry that carry a run length —
 * matches the `e.kind==='conduit' || e.kind==='conduit-comms' ||
 * e.kind==='overhead'` check production repeats at both call sites (the
 * print/PDF pages and the Civil Materials sheet). Named once here so it
 * cannot drift between the two renderers this module feeds.
 */
const CIVIL_LENGTH_KINDS = new Set(['conduit', 'conduit-comms', 'overhead']);

/** "Double GPO — 2 gang" / "UG electrical — 25mm conduit — 12.4m", for both the HTML preview and the PDF's vector text. */
export function legendEntryLabel(kind, e) {
  if (kind === 'civil') {
    if (!CIVIL_LENGTH_KINDS.has(e.kind)) return e.label;
    return e.label + (e.lengthM != null ? ' — ' + e.lengthM.toFixed(1) + 'm' : ' — not calibrated');
  }
  return e.sym.label + (e.gang ? ' — ' + e.gang + ' gang' : '');
}

export function legendEntryColor(kind, e) {
  return kind === 'civil' ? e.color : e.sym.color;
}

export function legendEntryAbbr(kind, e) {
  return kind === 'civil' ? e.abbr : e.gang ? e.gang + 'G' : e.sym.abbr;
}

/**
 * Builds every print page for the current project: one per floor, plus
 * one per civil plan when `includeCivil` is on — the same
 * `printPagesData` shape production assembles in openPrintView(), reused
 * by both the on-screen preview and the PDF export so neither can drift
 * from what the other shows.
 *
 * `ctx` supplies what only the live app knows: the project-aware symbol
 * resolver and the controller's current layer-visibility predicates
 * (bound functions, not raw state — this module has no controller of its
 * own to derive them from).
 */
export async function buildPrintPages(project, ctx, includeCivil) {
  const floorPages = await Promise.all(
    project.floors.map(async floor => {
      const imgSrc = await captureFloorSnapshot(floor, {
        project,
        symbolFor: ctx.symbolFor,
        isVisible: ctx.isVisible,
        isLayerHidden: ctx.isLayerHidden,
        categoryOf: ctx.categoryOf,
        symbolSize: project.symbolSize,
      });
      const entries = computeLegendEntries(floor, ctx.symbolFor);
      const total = entries.reduce((s, e) => s + e.count, 0);
      const hasContent = !!(floor.planImage || floor.objects.length);
      return {
        kind: 'floor',
        floorName: floor.name,
        calibrated: !!floor.scale,
        imgSrc,
        hasContent,
        entries,
        total,
      };
    })
  );

  if (!includeCivil) return floorPages;

  const civilPages = await Promise.all(
    (project.civilPlans || []).map(async plan => {
      const imgSrc = await captureCivilPlanSnapshot(plan, { symbolSize: project.symbolSize });
      const entries = computeCivilLegendEntries(plan);
      const total = entries.reduce((s, e) => s + e.count, 0);
      const hasContent = !!(
        plan.planImage ||
        plan.pits.length ||
        plan.conduits.length ||
        plan.buildingEntries.length ||
        (plan.poles || []).length ||
        (plan.overheadRuns || []).length
      );
      return {
        kind: 'civil',
        floorName: plan.name,
        calibrated: !!plan.scale,
        imgSrc,
        hasContent,
        entries,
        total,
      };
    })
  );

  return floorPages.concat(civilPages);
}

/** `#rrggbb` → `[r,g,b]`, for jsPDF's numeric colour setters. Ported verbatim from production's hexToRgb(). */
export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#888888') || [
    null,
    '88',
    '88',
    '88',
  ];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Draws one page into a jsPDF document exactly as production's
 * downloadPdfExport() does — the legend as real vector text, not a
 * screenshot of the HTML preview, so it stays crisp at any zoom.
 * `doc` is a jsPDF instance the caller has already added a page to (or
 * is the first page of).
 */
export function drawPdfPage(doc, page, projectName) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(17, 17, 17);
  doc.text(
    `${projectName} — ${page.floorName}${page.kind === 'civil' ? ' (Civil)' : ''}`,
    margin,
    margin + 2
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  doc.text(
    new Date().toLocaleDateString('en-AU') +
      (page.calibrated ? ' · Calibrated' : ' · Not calibrated'),
    pageW - margin,
    margin + 2,
    { align: 'right' }
  );
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(0.5);
  doc.line(margin, margin + 5, pageW - margin, margin + 5);

  const bodyTop = margin + 10;
  const bodyBottom = pageH - margin;
  const bodyH = bodyBottom - bodyTop;
  const legendW = 55;
  const gap = 6;
  const planX = margin;
  const planW = pageW - margin * 2 - legendW - gap;
  const legendX = planX + planW + gap;

  if (page.hasContent) {
    const imgProps = doc.getImageProperties(page.imgSrc);
    const scale = Math.min(planW / imgProps.width, bodyH / imgProps.height);
    const drawW = imgProps.width * scale;
    const drawH = imgProps.height * scale;
    const dx = planX + (planW - drawW) / 2;
    const dy = bodyTop + (bodyH - drawH) / 2;
    doc.setDrawColor(200, 200, 200);
    doc.rect(planX, bodyTop, planW, bodyH);
    doc.addImage(page.imgSrc, 'JPEG', dx, dy, drawW, drawH);
  } else {
    doc.setDrawColor(200, 200, 200);
    doc.rect(planX, bodyTop, planW, bodyH);
    doc.setFontSize(9);
    doc.setTextColor(136, 136, 136);
    doc.text(
      page.kind === 'civil' ? 'Nothing on this civil plan yet' : 'Nothing on this floor yet',
      planX + planW / 2,
      bodyTop + bodyH / 2,
      { align: 'center' }
    );
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  doc.text('LEGEND', legendX, bodyTop + 3);
  doc.setDrawColor(200, 200, 200);
  doc.line(legendX, bodyTop + 5, legendX + legendW, bodyTop + 5);

  let ly = bodyTop + 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  page.entries.forEach(e => {
    if (ly > bodyBottom - 6) return; // ran out of room on the page — rare, but don't draw off the edge
    const [r, g, b] = hexToRgb(legendEntryColor(page.kind, e));
    doc.setFillColor(r, g, b);
    doc.circle(legendX + 2, ly - 1, 1.6, 'F');
    doc.setTextColor(30, 30, 30);
    // The PDF's length suffix is abbreviated ("n/c") where the HTML
    // preview spells it out ("not calibrated") — ported as production
    // draws it, not unified, since the two use different label helpers
    // in index.html too (the HTML builder inlines its own suffix).
    const label =
      page.kind === 'civil'
        ? e.label +
          (CIVIL_LENGTH_KINDS.has(e.kind)
            ? e.lengthM != null
              ? ' — ' + e.lengthM.toFixed(1) + 'm'
              : ' — n/c'
            : '')
        : e.sym.label + (e.gang ? ' — ' + e.gang + 'g' : '');
    doc.text(label, legendX + 5.5, ly, { maxWidth: legendW - 13 });
    doc.text('×' + e.count, legendX + legendW, ly, { align: 'right' });
    ly += 6;
  });
  if (page.entries.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(17, 17, 17);
    doc.text(page.total + ' total', legendX + legendW, bodyBottom - 2, { align: 'right' });
  } else {
    doc.setFontSize(8.5);
    doc.setTextColor(136, 136, 136);
    doc.text('Nothing placed', legendX, ly);
  }
}

/** `sparky-draft` from an arbitrary project name, for the PDF download filename. */
export function fileSafeName(name) {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'sparky-draft';
}

/**
 * `project_name.json`, exactly as production's downloadProjectCopy()
 * names its file — underscores and lowercase, a different convention
 * from fileSafeName() above (hyphens, case preserved). Not unified with
 * it: that is literally what production does, and changing it would
 * rename every JSON backup a user downloads from here on relative to
 * ones they already have from production.
 */
export function jsonFileName(name) {
  return (name || 'project').replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.json';
}
