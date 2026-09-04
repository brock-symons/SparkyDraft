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
  Select,
  cx,
  focusRing,
} from './primitives.jsx';
import { CATEGORY_LABELS, CATEGORY_ORDER, LAYER_DEFS } from '../core/catalog.js';
import { allSymbols, resolveSymbol } from '../core/symbols.js';
import { currentFloor } from '../core/document.js';
import { allCommsRacks, patchPanelUnitsForRack } from '../core/comms.js';

/** Custom fittings carry a `custom_` id prefix (see addCustomSymbol). */
function isCustomId(id) {
  return typeof id === 'string' && id.startsWith('custom_');
}

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
  project,
  controller,
  favourites,
  recent,
  onToggleFavourite,
  autoFocus,
  onAddFitting,
}) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const inputRef = useRef(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  // Custom fittings are SEARCHED alongside catalog devices — someone who
  // added "Oven outlet" expects to find it by typing "oven", not to
  // remember it lives in a separate list — but they are BROWSED in their
  // own section, so they don't appear twice.
  //
  // patch_panel is deliberately not placeable: a rack needs one per 24
  // ports, so it is derived from the rack's port count rather than being
  // a device you position and then have to keep in sync. It stays in the
  // catalog so its price is still editable and quotes still resolve it —
  // production hides it from its placement grid for exactly this reason.
  // Resolved through the project so a price-list rename shows here too,
  // not just in the quote.
  const placeable = useMemo(
    () => allSymbols(project).filter(s => s.id !== 'patch_panel'),
    [project]
  );
  // Search spans everything; the browsable sections keep catalog and
  // custom apart, so a job-specific fitting doesn't appear twice.
  const catalogSyms = useMemo(() => placeable.filter(s => !isCustomId(s.id)), [placeable]);
  const customSyms = useMemo(() => placeable.filter(s => isCustomId(s.id)), [placeable]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return placeable.filter(
      s =>
        s.label.toLowerCase().includes(q) ||
        s.abbr.toLowerCase().includes(q) ||
        (CATEGORY_LABELS[s.category] || '').toLowerCase().includes(q)
    );
  }, [q, placeable]);

  const favSyms = favourites.map(id => placeable.find(s => s.id === id)).filter(Boolean);
  const recentSyms = recent.map(id => placeable.find(s => s.id === id)).filter(Boolean);

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
              const items = catalogSyms.filter(s => s.category === cat);
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
              {customSyms.length > 0 && (
                <div className="mb-2 grid grid-cols-3 gap-1 px-2">
                  {customSyms.map(sym => (
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

// ===================================================================
// COMMS RACKS  (migration Phase 5)
//
// Racks are listed across every floor, not just the open one: a building
// has one comms cupboard, and you think about it as the building's rack
// rather than "the rack on level 2".
//
// Ports are slots, not rows you create and delete — a patch panel has 24
// of them whether or not they are used. So the panel shows every port
// and lets you fill them in, rather than making you add a port before
// you can wire a point to it.
// ===================================================================

export function CommsPanel({ doc, controller, onSelectDevice }) {
  const project = doc.state;
  const racks = useMemo(() => allCommsRacks(project), [project]);
  const legacy = project.unassignedCommsPorts || [];
  const [openRack, setOpenRack] = useState(null);
  const [showUsedOnly, setShowUsedOnly] = useState(true);

  if (!racks.length && !legacy.length) {
    return (
      <EmptyState
        title="No comms racks"
        hint="Place a comms rack on the plan — it arrives with a full 24-port patch panel."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {racks.map(({ rack, floorName }) => {
          const ports = rack.commsPorts || [];
          const used = ports.filter(p => p.deviceId).length;
          const units = patchPanelUnitsForRack(rack);
          const open = openRack === rack.id;
          const shown = open ? (showUsedOnly ? ports.filter(p => p.deviceId) : ports) : [];
          return (
            <div key={rack.id} className="border-b border-ink-100 last:border-0">
              <button
                onClick={() => setOpenRack(open ? null : rack.id)}
                className={cx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink-50',
                  focusRing
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-800">
                    {(rack.props && rack.props.customName) || 'Rack ' + rack.id}
                  </span>
                  <span className="block truncate text-2xs text-ink-400">
                    {floorName} · {used}/{ports.length} ports used · {units} patch panel
                    {units === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="text-2xs text-ink-400">{open ? '▾' : '▸'}</span>
              </button>

              {open && (
                <div className="px-3 pb-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    <button
                      onClick={() => setShowUsedOnly(v => !v)}
                      className={cx('text-2xs text-accent-600 hover:underline', focusRing)}
                    >
                      {showUsedOnly ? `Show all ${ports.length} ports` : 'Show used ports only'}
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => controller.addCommsPort(rack.id)}
                      className={cx('text-2xs text-accent-600 hover:underline', focusRing)}
                    >
                      + Add port
                    </button>
                  </div>
                  {shown.length === 0 ? (
                    <p className="py-1 text-2xs text-ink-400">
                      No ports in use yet — assign one from a data outlet&rsquo;s properties.
                    </p>
                  ) : (
                    shown.map(port => {
                      const device = findDeviceAnywhere(project, port.deviceId);
                      return (
                        <div
                          key={port.id}
                          className="mb-1 rounded-md border border-ink-100 px-2 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-7 shrink-0 tnum text-2xs text-ink-400">
                              {port.number}
                            </span>
                            <TextInput
                              value={port.label}
                              aria-label={'Label for port ' + port.number}
                              onChange={e =>
                                controller.setCommsPortFields(port.id, { label: e.target.value })
                              }
                            />
                          </div>
                          <div className="mt-1 flex items-center gap-2 pl-9">
                            <span className="truncate text-2xs text-ink-500">
                              {device ? deviceLabel(project, device) : 'Not connected'}
                            </span>
                            {device && (
                              <>
                                <div className="flex-1" />
                                <button
                                  onClick={() => onSelectDevice(device.id)}
                                  className={cx(
                                    'text-2xs text-accent-600 hover:underline',
                                    focusRing
                                  )}
                                >
                                  Show
                                </button>
                                <button
                                  onClick={() => controller.assignPort(device.id, null)}
                                  className={cx('text-2xs text-ink-400 hover:underline', focusRing)}
                                >
                                  Unassign
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Ports recovered from an old-format save whose rack could not
            be found. The migration keeps them rather than dropping a real
            connection on the floor; they live here until someone says
            which rack they belong to. */}
        {legacy.length > 0 && (
          <div className="border-t border-amber-200 bg-amber-50/50 px-3 py-2">
            <FieldLabel className="mb-1">Recovered from an older save</FieldLabel>
            <p className="mb-2 text-2xs leading-relaxed text-ink-500">
              These data connections had no rack to attach to. Pick one to keep them.
            </p>
            {legacy.map(p => (
              <div key={p.id} className="mb-1.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-700">{p.label}</span>
                <Select
                  value=""
                  aria-label={'Rack for ' + p.label}
                  onChange={e => e.target.value && controller.placeLegacyPort(p.id, e.target.value)}
                >
                  <option value="">Move to…</option>
                  {racks.map(({ rack }) => (
                    <option key={rack.id} value={rack.id}>
                      {(rack.props && rack.props.customName) || 'Rack ' + rack.id}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function findDeviceAnywhere(project, id) {
  if (!id) return null;
  for (const f of project.floors) {
    const o = f.objects.find(x => x.id === id);
    if (o) return o;
  }
  return null;
}

function deviceLabel(project, obj) {
  if (obj.props && obj.props.customName) return obj.props.customName;
  const sym = resolveSymbol(project, obj.symbolId);
  return (sym ? sym.label : obj.symbolId) + ' (' + obj.id + ')';
}
