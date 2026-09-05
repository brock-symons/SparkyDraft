// ===================================================================
// SYMBOL RESOLUTION
//
// One place that answers "what is this symbolId?", because three
// different answers is how a custom fitting ends up rendering as '?' in
// one view and pricing at zero in another — which already happened once
// in this migration.
//
// A resolved symbol is the shipped catalog entry, with the project's own
// custom fittings on top, and the project's price-list edits on top of
// that.
//
// PRICE LIST — a deliberate deviation from production, flagged in
// MIGRATION_INVENTORY.md §I:
//
// The current app edits SYMBOL_LIBRARY in place, and does NOT save the
// result — reopen the job and every price edit is gone. That cannot be
// reproduced here even if it were desirable: catalog.js is a verbatim
// extraction that has to stay byte-comparable with its source, so it is
// not something to mutate. Edits are stored per project in
// `project.priceList` and applied here, which persists them and keeps
// one job's prices from silently changing another's.
// ===================================================================

import { SYMBOL_LIBRARY } from './catalog.js';

/** Applies a project's price-list entry to a catalog symbol. */
function withOverrides(sym, overrides) {
  if (!sym || !overrides) return sym;
  const o = overrides[sym.id];
  if (!o) return sym;
  return {
    ...sym,
    label: o.label != null && o.label !== '' ? o.label : sym.label,
    defaultProps: {
      ...sym.defaultProps,
      ...(o.material_cost != null ? { material_cost: o.material_cost } : null),
      ...(o.labour_hours != null ? { labour_hours: o.labour_hours } : null),
      ...(o.watts != null ? { watts: o.watts } : null),
    },
  };
}

/** Resolve one symbol against a project. */
export function resolveSymbol(project, id) {
  const p = project || {};
  const base =
    (p.customSymbols || []).find(s => s.id === id) || SYMBOL_LIBRARY.find(s => s.id === id);
  return withOverrides(base, p.priceList);
}

/**
 * A resolver bound to a live project getter, for the controller and the
 * renderer — both of which resolve symbols on every frame and cannot
 * take the project as an argument each time.
 */
export function makeSymbolResolver(getProject) {
  return id => resolveSymbol(getProject(), id);
}

/**
 * Every symbol a project knows about, catalog + custom, with price-list
 * edits applied — the list the price editor and the component library
 * are both built from.
 */
export function allSymbols(project) {
  const p = project || {};
  return SYMBOL_LIBRARY.concat(p.customSymbols || []).map(s => withOverrides(s, p.priceList));
}
