// ===================================================================
// QUOTE + PRICE LIST  (migration Phase 6)
//
// Business-logic critical (inventory R2/R7): these numbers are what a
// job is priced from. Ported verbatim from index.html and checked
// mechanically by app/test/quote-parity.mjs.
//
// The order of operations matters and is preserved exactly:
//
//   materials  = Σ effectivePrice(obj) × qty   (+ derived patch panels)
//   labourCost = Σ effectiveLabour(obj) × qty × labourRate  (+ panels)
//   protection = Σ effectiveProtectionCost(circuit)  — electrical only
//   subtotal   = materials + labour + protection + equipment + travel
//   margin     = subtotal × marginPct
//   gst        = (subtotal + margin) × 0.10
//   total      = subtotal + margin + gst
//
// Note GST compounds on margin, not on the subtotal alone. That is
// production's behaviour and it changes the total, so it is preserved
// rather than "corrected".
//
// Patch panels are priced from the same (still editable) catalog entry a
// placed patch_panel would have used, but their COUNT is derived from
// each rack's port count — see comms.js. Dropping that is R7 in the risk
// register: it silently under-quotes.
// ===================================================================

import { allObjects } from './document.js';
import { allPatchPanelLines } from './comms.js';
import { isSwitchSymbol } from './switching.js';
import { PROTECTION_LIBRARY } from './catalog.js';

/** GST rate. A literal in production too — flagged for owner review in
 *  MIGRATION_INVENTORY.md §I rather than quietly made configurable. */
export const GST_RATE = 0.1;

export const QUOTE_DEFAULTS = {
  rateLabour: 95,
  rateMargin: 20,
  costEquipment: 0,
  costTravel: 0,
};

/** Per-object price override wins over the catalog default. Verbatim. */
export function effectivePrice(obj, symbolFor) {
  const sym = symbolFor(obj.symbolId);
  const ov = obj.props ? obj.props.priceOverride : undefined;
  return ov != null && ov !== '' ? Number(ov) : sym ? sym.defaultProps.material_cost : 0;
}

export function effectiveLabour(obj, symbolFor) {
  const sym = symbolFor(obj.symbolId);
  const ov = obj.props ? obj.props.labourOverride : undefined;
  return ov != null && ov !== '' ? Number(ov) : sym ? sym.defaultProps.labour_hours : 0;
}

/** A circuit's protection cost: its own override, else the library price. */
export function effectiveProtectionCost(circuit) {
  const ov = circuit.protectionCostOverride;
  if (ov != null && ov !== '') return Number(ov);
  const p = PROTECTION_LIBRARY.find(x => x.id === circuit.protectionId);
  return p ? p.cost : 0;
}

/** Quote settings live on the project; missing ones fall back to
 *  production's own defaults rather than to zero. */
export function quoteSettings(project) {
  const num = (v, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    rateLabour: num(project.rateLabour, QUOTE_DEFAULTS.rateLabour),
    rateMargin: num(project.rateMargin, QUOTE_DEFAULTS.rateMargin),
    costEquipment: num(project.costEquipment, QUOTE_DEFAULTS.costEquipment),
    costTravel: num(project.costTravel, QUOTE_DEFAULTS.costTravel),
  };
}

/** The totals, in production's exact order of operations. */
export function computeQuote(project, symbolFor) {
  const { rateLabour, rateMargin, costEquipment, costTravel } = quoteSettings(project);
  const marginPct = rateMargin / 100;

  let materials = 0,
    labourCost = 0;
  allObjects(project).forEach(o => {
    const qty = (o.props && o.props.quantity) || 1;
    materials += effectivePrice(o, symbolFor) * qty;
    labourCost += effectiveLabour(o, symbolFor) * qty * rateLabour;
  });

  const patchPanelSym = symbolFor('patch_panel');
  if (patchPanelSym) {
    allPatchPanelLines(project).forEach(line => {
      materials += patchPanelSym.defaultProps.material_cost * line.units;
      labourCost += patchPanelSym.defaultProps.labour_hours * line.units * rateLabour;
    });
  }

  const protection = (project.circuits || [])
    .filter(c => c.kind !== 'data')
    .reduce((sum, c) => sum + effectiveProtectionCost(c), 0);

  const subtotal = materials + labourCost + protection + costEquipment + costTravel;
  const margin = subtotal * marginPct;
  const gst = (subtotal + margin) * GST_RATE;
  const total = subtotal + margin + gst;

  return {
    materials,
    labourCost,
    protection,
    equipment: costEquipment,
    travel: costTravel,
    subtotal,
    margin,
    gst,
    total,
  };
}

/**
 * Schedule lines. Two views, both ported verbatim:
 *
 *  * itemised — one row per device, with a `*` where a price override is
 *    in play, so an unusual line total is explained rather than
 *    mysterious.
 *  * summary — grouped by device type, and by SWITCH GANG and floor as
 *    well, because a 1-gang and a 4-gang plate are different hardware
 *    and must not be counted as one line.
 */
export function quoteLines(project, symbolFor, itemized) {
  const { rateLabour } = quoteSettings(project);
  const patchPanelSym = symbolFor('patch_panel');
  const lines = [];

  if (itemized) {
    allObjects(project).forEach(o => {
      const sym = symbolFor(o.symbolId);
      const qty = (o.props && o.props.quantity) || 1;
      const lineTotal =
        effectivePrice(o, symbolFor) * qty + effectiveLabour(o, symbolFor) * qty * rateLabour;
      const overridden = o.props && o.props.priceOverride != null;
      lines.push({
        id: o.id,
        label: (sym ? sym.label : o.symbolId) + (overridden ? ' *' : ''),
        floorName: o.__floorName,
        qty,
        total: lineTotal,
      });
    });
    if (patchPanelSym) {
      allPatchPanelLines(project).forEach(line => {
        const lineTotal =
          patchPanelSym.defaultProps.material_cost * line.units +
          patchPanelSym.defaultProps.labour_hours * line.units * rateLabour;
        const rackName = (line.rack.props && line.rack.props.customName) || 'Rack ' + line.rack.id;
        lines.push({
          id: line.rack.id,
          label: patchPanelSym.label + ' (' + rackName + ')',
          floorName: line.floorName,
          qty: line.units,
          total: lineTotal,
        });
      });
    }
    return lines;
  }

  const groups = {};
  const order = [];
  const addQty = (key, label, floorName, qty, total) => {
    if (!groups[key]) {
      groups[key] = { id: null, label, floorName, qty: 0, total: 0 };
      order.push(key);
    }
    groups[key].qty += qty;
    groups[key].total += total;
  };
  allObjects(project).forEach(o => {
    const sym = symbolFor(o.symbolId);
    const qty = (o.props && o.props.quantity) || 1;
    const lineTotal =
      effectivePrice(o, symbolFor) * qty + effectiveLabour(o, symbolFor) * qty * rateLabour;
    const gang = isSwitchSymbol(o.symbolId) ? (o.props && o.props.gang) || 1 : null;
    const label = (sym ? sym.label : o.symbolId) + (gang != null ? ' — ' + gang + ' gang' : '');
    addQty(
      o.symbolId + (gang != null ? '::' + gang : '') + '::' + o.__floorName,
      label,
      o.__floorName,
      qty,
      lineTotal
    );
  });
  if (patchPanelSym) {
    allPatchPanelLines(project).forEach(line => {
      const lineTotal =
        patchPanelSym.defaultProps.material_cost * line.units +
        patchPanelSym.defaultProps.labour_hours * line.units * rateLabour;
      addQty(
        'patch_panel::' + line.floorName,
        patchPanelSym.label,
        line.floorName,
        line.units,
        lineTotal
      );
    });
  }
  return order.map(k => groups[k]);
}

export function formatMoney(n) {
  return (
    '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/**
 * Copyable quote summary. Ported line-for-line from production's export
 * so a quote pasted into an email reads identically to one produced by
 * the current app.
 */
export function quoteText(project, symbolFor, itemized, resolveBoardLabel) {
  const totals = computeQuote(project, symbolFor);
  const lines = [];
  lines.push(project.name || 'Untitled project');
  lines.push('Generated ' + new Date().toLocaleDateString('en-AU'));
  lines.push('');
  lines.push('DEVICE SCHEDULE');
  if (itemized) {
    allObjects(project).forEach(o => {
      const sym = symbolFor(o.symbolId);
      lines.push(
        `${o.id}  ${sym ? sym.label : o.symbolId}  x${(o.props && o.props.quantity) || 1}  [${
          o.__floorName
        }]${o.circuit ? '  circuit:' + o.circuit : ''}`
      );
    });
  } else {
    const groups = {};
    const order = [];
    allObjects(project).forEach(o => {
      const sym = symbolFor(o.symbolId);
      const gang = isSwitchSymbol(o.symbolId) ? (o.props && o.props.gang) || 1 : null;
      const label = (sym ? sym.label : o.symbolId) + (gang != null ? ' — ' + gang + ' gang' : '');
      const key = o.symbolId + (gang != null ? '::' + gang : '') + '::' + o.__floorName;
      if (!groups[key]) {
        groups[key] = { label, floorName: o.__floorName, qty: 0 };
        order.push(key);
      }
      groups[key].qty += (o.props && o.props.quantity) || 1;
    });
    order.forEach(key => {
      const g = groups[key];
      lines.push(`${g.label}  x${g.qty}  [${g.floorName}]`);
    });
  }
  lines.push('');
  lines.push('SWITCHBOARD / CIRCUIT SCHEDULE');
  const circuits = project.circuits || [];
  if (circuits.length === 0) lines.push('(none defined)');
  circuits.forEach(c => {
    const p = PROTECTION_LIBRARY.find(x => x.id === c.protectionId);
    const boardLabel = resolveBoardLabel(c);
    const count = allObjects(project).filter(o => o.circuit === c.id).length;
    lines.push(
      `${c.id}  ${c.description || ''}  |  Board: ${boardLabel}  |  ${c.cable || '-'}  |  ${
        p ? p.label : '-'
      } (${formatMoney(effectiveProtectionCost(c))})  |  ${count} device(s)`
    );
  });
  lines.push('');
  lines.push('QUOTE SUMMARY');
  lines.push('Materials: ' + formatMoney(totals.materials));
  lines.push('Labour: ' + formatMoney(totals.labourCost));
  lines.push('Protection devices: ' + formatMoney(totals.protection));
  lines.push('Equipment: ' + formatMoney(totals.equipment));
  lines.push('Travel: ' + formatMoney(totals.travel));
  lines.push('Subtotal: ' + formatMoney(totals.subtotal));
  lines.push('Margin: ' + formatMoney(totals.margin));
  lines.push('GST: ' + formatMoney(totals.gst));
  lines.push('TOTAL: ' + formatMoney(totals.total));
  return lines.join('\n');
}
