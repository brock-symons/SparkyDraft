// ===================================================================
// LEGEND  (migration Phase 8)
//
// A per-floor tally of everything placed, grouped by device type (and
// by switch GANG, since a 1-gang and a 4-gang plate are different plate
// hardware and read as one undifferentiated "Light switch" line
// otherwise — exactly the ambiguity a legend exists to remove).
//
// Ported verbatim from computeLegendEntries(), including the sort key:
// category is compared with plain localeCompare, NOT the curated
// CATEGORY_ORDER the component library uses elsewhere in this app. That
// looks like an oversight next to CATEGORY_ORDER, but changing it would
// reorder every legend a job has already printed, so it stays exactly
// as production sorts it.
//
// Symbol lookup goes through the caller's resolver rather than the raw
// catalog, matching the fix already applied to the quote and panel
// schedule in earlier phases: production's own SYMBOL_LIBRARY-only
// lookup silently drops a custom fitting from the legend (`if(!sym)
// return`), the same class of bug already found and fixed for pricing
// and rendering. The grouping/counting/sort logic itself is untouched.
// ===================================================================

import { isSwitchSymbol } from './switching.js';
import { patchPanelUnitsForRack } from './comms.js';

export function computeLegendEntries(floor, symbolFor) {
  const buckets = {};
  floor.objects.forEach(o => {
    const sym = symbolFor(o.symbolId);
    if (!sym) return;
    const gang = isSwitchSymbol(o.symbolId) ? (o.props && o.props.gang) || 1 : null;
    const key = o.symbolId + (gang != null ? '::' + gang : '');
    if (!buckets[key]) buckets[key] = { sym, gang, count: 0 };
    buckets[key].count += (o.props && o.props.quantity) || 1;
  });

  // Patch panels aren't placed — derived from each rack's port count on
  // THIS floor, same "legend is per-floor" scope as everything else here.
  floor.objects
    .filter(o => o.symbolId === 'comms_rack')
    .forEach(rack => {
      const units = patchPanelUnitsForRack(rack);
      if (units) {
        if (!buckets.patch_panel) {
          buckets.patch_panel = { sym: symbolFor('patch_panel'), gang: null, count: 0 };
        }
        buckets.patch_panel.count += units;
      }
    });

  return Object.values(buckets)
    .filter(e => e.sym)
    .sort((a, b) => {
      if (a.sym.category !== b.sym.category) return a.sym.category.localeCompare(b.sym.category);
      if (a.sym.label !== b.sym.label) return a.sym.label.localeCompare(b.sym.label);
      return (a.gang || 0) - (b.gang || 0);
    });
}
