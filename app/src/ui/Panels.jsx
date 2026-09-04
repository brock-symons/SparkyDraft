// ===================================================================
// LIBRARY + LAYERS PANELS  (directive §14, §8)
// ===================================================================

import {
  Section,
  TextInput,
  Toggle,
  IconButton,
  EmptyState,
  FieldLabel,
  cx,
  focusRing,
} from './primitives.jsx';
import { SYMBOL_LIBRARY, CATEGORY_LABELS, CATEGORY_ORDER, LAYER_DEFS } from '../core/catalog.js';
import { currentFloor } from '../core/document.js';

const { useState, useMemo, useRef, useEffect } = React;

// ===================================================================
// COMPONENT LIBRARY
//
// Target flow (§14): search → find → place → keep working. Search is
// focused on open so the keyboard path is "P, type 'gpo', Enter" without
// ever touching the mouse. Recent and favourites sit above the full
// catalog because in practice a sparky places the same six devices all
// day and should not scroll a 60-item list to reach them.
// ===================================================================

function SymbolTile({ sym, active, favourite, onPick, onToggleFavourite }) {
  return (
    <div className="group relative">
      <button
        onClick={onPick}
        aria-label={sym.label}
        aria-pressed={active}
        className={cx(
          'flex w-full flex-col items-center gap-1.5 rounded-lg border px-1 py-2 transition-colors duration-100',
          active
            ? 'border-accent-300 bg-accent-50'
            : 'border-transparent hover:border-ink-200 hover:bg-ink-50',
          focusRing
        )}
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-2xs font-bold"
          style={{
            background: sym.color + '22',
            color: sym.color,
            border: '1px solid ' + sym.color + '55',
          }}
        >
          {sym.abbr}
        </span>
        <span className="line-clamp-2 text-center text-2xs leading-tight text-ink-600">
          {sym.label}
        </span>
      </button>
      <button
        onClick={e => {
          e.stopPropagation();
          onToggleFavourite();
        }}
        aria-label={
          favourite ? `Remove ${sym.label} from favourites` : `Add ${sym.label} to favourites`
        }
        className={cx(
          'absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded text-[11px] transition-opacity',
          favourite
            ? 'text-amber-400 opacity-100'
            : 'text-ink-300 opacity-0 group-hover:opacity-100 hover:text-amber-400',
          focusRing
        )}
      >
        {favourite ? '★' : '☆'}
      </button>
    </div>
  );
}

export function LibraryPanel({
  controller,
  favourites,
  recent,
  onToggleFavourite,
  autoFocus,
  customSymbols = [],
  onAddFitting,
}) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const inputRef = useRef(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  // Custom fittings are searched and browsed alongside catalog devices —
  // a user who added "Oven outlet" expects to find it by typing "oven",
  // not to remember it lives in a separate list.
  const allSymbols = useMemo(() => SYMBOL_LIBRARY.concat(customSymbols), [customSymbols]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return allSymbols.filter(
      s =>
        s.label.toLowerCase().includes(q) ||
        s.abbr.toLowerCase().includes(q) ||
        (CATEGORY_LABELS[s.category] || '').toLowerCase().includes(q)
    );
  }, [q, allSymbols]);

  const favSyms = favourites.map(id => allSymbols.find(s => s.id === id)).filter(Boolean);
  const recentSyms = recent.map(id => allSymbols.find(s => s.id === id)).filter(Boolean);

  function pick(sym) {
    controller.setActiveSymbol(sym.id);
  }

  const tileProps = sym => ({
    sym,
    active: controller.activeSymbolId === sym.id,
    favourite: favourites.includes(sym.id),
    onPick: () => pick(sym),
    onToggleFavourite: () => onToggleFavourite(sym.id),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-ink-100 p-2">
        <TextInput
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search devices…"
          aria-label="Search devices"
          onKeyDown={e => {
            if (e.key === 'Enter' && matches && matches.length) {
              pick(matches[0]);
            }
            if (e.key === 'Escape') {
              setQuery('');
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {matches ? (
          matches.length ? (
            <div className="p-2">
              <FieldLabel className="mb-1.5 px-1">
                {matches.length} result{matches.length === 1 ? '' : 's'}
              </FieldLabel>
              <div className="grid grid-cols-3 gap-1">
                {matches.map(sym => (
                  <SymbolTile key={sym.id} {...tileProps(sym)} />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No matching device"
              hint={`Nothing in the library matches “${query}”.`}
            />
          )
        ) : (
          <>
            {favSyms.length > 0 && (
              <Section
                title="Favourites"
                open={!collapsed.fav}
                onToggle={() => setCollapsed(c => ({ ...c, fav: !c.fav }))}
              >
                <div className="grid grid-cols-3 gap-1 px-2">
                  {favSyms.map(sym => (
                    <SymbolTile key={sym.id} {...tileProps(sym)} />
                  ))}
                </div>
              </Section>
            )}
            {recentSyms.length > 0 && (
              <Section
                title="Recent"
                open={!collapsed.recent}
                onToggle={() => setCollapsed(c => ({ ...c, recent: !c.recent }))}
              >
                <div className="grid grid-cols-3 gap-1 px-2">
                  {recentSyms.map(sym => (
                    <SymbolTile key={sym.id} {...tileProps(sym)} />
                  ))}
                </div>
              </Section>
            )}
            {CATEGORY_ORDER.map(cat => {
              const items = SYMBOL_LIBRARY.filter(s => s.category === cat);
              if (!items.length) return null;
              return (
                <Section
                  key={cat}
                  title={CATEGORY_LABELS[cat] || cat}
                  open={!collapsed[cat]}
                  onToggle={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}
                >
                  <div className="grid grid-cols-3 gap-1 px-2">
                    {items.map(sym => (
                      <SymbolTile key={sym.id} {...tileProps(sym)} />
                    ))}
                  </div>
                </Section>
              );
            })}

            {/* Custom fittings last: the shipped catalog is what people
                reach for constantly, and a job-specific fitting is the
                exception rather than the thing you scroll past daily. */}
            <Section
              title="Custom"
              open={!collapsed.custom}
              onToggle={() => setCollapsed(c => ({ ...c, custom: !c.custom }))}
            >
              {customSymbols.length > 0 && (
                <div className="mb-2 grid grid-cols-3 gap-1 px-2">
                  {customSymbols.map(sym => (
                    <SymbolTile key={sym.id} {...tileProps(sym)} />
                  ))}
                </div>
              )}
              <div className="px-2">
                <button
                  onClick={onAddFitting}
                  className={cx(
                    'flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed',
                    'border-ink-300 py-2 text-2xs font-medium text-ink-500',
                    'transition-colors hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700',
                    focusRing
                  )}
                >
                  <span className="text-sm leading-none">＋</span> Add fitting
                </button>
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

// ===================================================================
// LAYERS
//
// Visibility and lock are separate controls on purpose: hiding is about
// reading the drawing, locking is about protecting work you can still
// see. Conflating them (the usual shortcut) forces you to hide the
// architectural background you are tracing over just to stop selecting it.
// ===================================================================

export function LayersPanel({ doc, counts }) {
  // Layer visibility/lock is PROJECT-level, not per-floor: hiding Power
  // hides it on every floor at once, matching production. Only the device
  // count is floor-scoped.
  const project = doc.state;
  const hidden = project.hiddenLayers || [];
  const locked = project.lockedLayers || [];

  function toggle(list, id, label) {
    doc.commit(label, dd => {
      const arr = dd[list] || (dd[list] = []);
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(id);
    });
  }

  // No title bar here — the dock/sheet that hosts this panel renders it
  // (see Dock/Sheet in Workspace.jsx), so it appears exactly once.
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {LAYER_DEFS.map(layer => {
          const isHidden = hidden.includes(layer.id);
          const isLocked = locked.includes(layer.id);
          const n = counts[layer.id] || 0;
          return (
            <div
              key={layer.id}
              className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-ink-50"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: layer.color }}
              />
              <span
                className={cx(
                  'flex-1 truncate text-sm',
                  isHidden ? 'text-ink-300' : 'text-ink-700'
                )}
              >
                {layer.name}
              </span>
              <span className="text-2xs tabular-nums text-ink-400">{n || ''}</span>
              <IconButton
                label={isLocked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                size="sm"
                active={isLocked}
                tooltipSide="left"
                onClick={() =>
                  toggle('lockedLayers', layer.id, isLocked ? 'Unlock layer' : 'Lock layer')
                }
              >
                {isLocked ? '🔒' : '🔓'}
              </IconButton>
              <Toggle
                label={isHidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
                checked={!isHidden}
                onChange={() =>
                  toggle('hiddenLayers', layer.id, isHidden ? 'Show layer' : 'Hide layer')
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===================================================================
// CIRCUITS  (migration Phase 3)
//
// A circuit is project-level: it can feed devices on any floor, so the
// device count here is deliberately project-wide rather than scoped to
// the floor on screen. Isolate is the panel's most useful control on a
// busy plan — "show me this circuit and nothing else" — so it sits on
// the row rather than behind an edit dialog.
// ===================================================================

export function CircuitsPanel({ doc, controller, onAddCircuit, onEditCircuit }) {
  const project = doc.state;
  const circuits = project.circuits || [];
  const counts = useMemo(() => {
    const by = {};
    for (const f of project.floors) {
      for (const o of f.objects) if (o.circuit) by[o.circuit] = (by[o.circuit] || 0) + 1;
    }
    return by;
  }, [project.floors]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {circuits.length === 0 ? (
          <EmptyState
            title="No circuits yet"
            hint="Add a circuit, then assign devices to it from the inspector."
          />
        ) : (
          circuits.map(c => {
            const isolated = controller.isolatedCircuitId === c.id;
            const n = counts[c.id] || 0;
            return (
              <div
                key={c.id}
                className={cx(
                  'flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-ink-50',
                  isolated && 'bg-accent-50'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-800">{c.id}</div>
                  <div className="truncate text-2xs text-ink-400">
                    {c.description || c.board || '—'} · {c.cable}
                  </div>
                </div>
                <span className="tnum text-2xs text-ink-400">{n || ''}</span>
                <IconButton
                  label={isolated ? `Stop isolating ${c.id}` : `Isolate ${c.id}`}
                  size="sm"
                  active={isolated}
                  tooltipSide="left"
                  onClick={() => controller.toggleIsolatedCircuit(c.id)}
                >
                  ◎
                </IconButton>
                <IconButton
                  label={`Edit ${c.id}`}
                  size="sm"
                  tooltipSide="left"
                  onClick={() => onEditCircuit(c.id)}
                >
                  ⋯
                </IconButton>
              </div>
            );
          })
        )}
      </div>
      <div className="shrink-0 border-t border-ink-100 p-2">
        <button
          onClick={onAddCircuit}
          className={cx(
            'flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed',
            'border-ink-300 py-2 text-2xs font-medium text-ink-500',
            'transition-colors hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700',
            focusRing
          )}
        >
          <span className="text-sm leading-none">＋</span> Add circuit
        </button>
      </div>
    </div>
  );
}
