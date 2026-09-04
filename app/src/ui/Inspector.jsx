// ===================================================================
// CONTEXTUAL INSPECTOR  (directive §5, §15, §6, §22)
//
// One panel, four states, driven entirely by what the user currently
// has selected:
//
//   nothing        → drawing + workspace properties
//   one device     → identity, position, electrical properties
//   many devices   → composition summary, align/distribute, bulk edit
//   tool active    → what that tool is about to do
//
// The point is subtractive: the user should never scroll past
// circuit/protection fields while nothing is selected, and never hunt
// for alignment tools that only make sense with a multi-selection.
//
// Electrical fields come from the real catalog's defaultProps, so an
// outlet shows cable/protection/load and a light switch does not show a
// wattage it never had.
// ===================================================================

import {
  Section,
  Row,
  NumberInput,
  TextInput,
  Select,
  Toggle,
  Button,
  IconButton,
  EmptyState,
  FieldLabel,
  Divider,
  cx,
  focusRing,
} from './primitives.jsx';
import { currentFloor } from '../core/document.js';
import { CABLE_SIZES, PROTECTION_LIBRARY, CATEGORY_LABELS } from '../core/catalog.js';
import { resolveSymbol } from '../core/symbols.js';
import { formatDistance } from '../core/geometry.js';
import { isCommsRack, patchPanelUnitsForRack, commsPortOptions } from '../core/comms.js';
import {
  isSwitchSymbol,
  isLightSymbol,
  groupsForSwitch,
  linksForLight,
  bankDisplayName,
} from '../core/switching.js';

const { useState, useMemo } = React;

function SymbolChip({ sym, size = 'md' }) {
  if (!sym) return null;
  const dims = size === 'lg' ? 'h-9 w-9 text-xs' : 'h-6 w-6 text-2xs';
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        dims
      )}
      style={{
        background: sym.color + '22',
        color: sym.color,
        border: '1px solid ' + sym.color + '55',
      }}
    >
      {sym.abbr}
    </span>
  );
}

// --- nothing selected -------------------------------------------------

function DrawingProperties({
  doc,
  controller,
  sections,
  toggleSection,
  onImportPlan,
  onCalibrate,
  onAddRoom,
}) {
  const d = currentFloor(doc.state);
  const counts = useMemo(() => {
    const by = {};
    for (const o of d.objects) {
      const s = resolveSymbol(doc.state, o.symbolId);
      const cat = s ? s.category : 'other';
      by[cat] = (by[cat] || 0) + 1;
    }
    return by;
  }, [d.objects]);

  return (
    <>
      {/* Titled "Contents", not "Drawing" — the panel header already says
          Drawing, and repeating it reads as a rendering glitch. */}
      <Section title="Contents" open={sections.drawing} onToggle={() => toggleSection('drawing')}>
        <Row label="Devices">
          <div className="text-sm tnum text-ink-700">{d.objects.length}</div>
        </Row>
        {Object.keys(counts).length > 0 && (
          <div className="px-3 pt-1">
            <div className="flex flex-wrap gap-1">
              {Object.entries(counts).map(([cat, n]) => (
                <span key={cat} className="rounded bg-ink-100 px-1.5 py-0.5 text-2xs text-ink-600">
                  {CATEGORY_LABELS[cat] || cat} <span className="tnum font-medium">{n}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Tracing over an imported floor plan is the normal way an
          electrical drawing starts, so plan controls sit in the
          nothing-selected state rather than behind a menu. */}
      <Section title="Floor plan" open={sections.plan} onToggle={() => toggleSection('plan')}>
        {d.planImage ? (
          <>
            <Row label="Opacity">
              <input
                type="range"
                min="0.15"
                max="1"
                step="0.05"
                aria-label="Floor plan opacity"
                value={d.planImage.opacity == null ? 0.85 : d.planImage.opacity}
                onChange={e =>
                  doc.commit(
                    'Plan opacity',
                    dd => {
                      currentFloor(dd).planImage.opacity = parseFloat(e.target.value);
                    },
                    { coalesce: true }
                  )
                }
                className="w-full accent-accent-500"
              />
            </Row>
            <Row label="Size">
              <NumberInput
                value={d.planImage.scale || 1}
                step={0.05}
                suffix="×"
                onCommit={v =>
                  doc.commit('Plan size', dd => {
                    currentFloor(dd).planImage.scale = Math.max(0.05, v);
                  })
                }
              />
            </Row>
            <div className="flex gap-1.5 px-3 pt-1.5">
              <Button size="sm" className="flex-1" onClick={onImportPlan}>
                Replace…
              </Button>
              <Button
                size="sm"
                variant="danger"
                className="flex-1"
                onClick={() =>
                  doc.commit('Remove plan', dd => {
                    currentFloor(dd).planImage = null;
                  })
                }
              >
                Remove
              </Button>
            </div>
          </>
        ) : (
          <div className="px-3">
            <Button size="sm" className="w-full" onClick={onImportPlan}>
              Import floor plan…
            </Button>
            <div className="mt-1.5 text-2xs leading-relaxed text-ink-400">
              PNG or JPG. Place devices over it, then calibrate to set real distances.
            </div>
          </div>
        )}
      </Section>

      {/* Rooms are a takeoff/grouping aid, not geometry — production
          models them as just a name plus a device list, and the same
          restraint applies here. Devices join a room from their own
          inspector, or in bulk from a multi-selection. */}
      <Section title="Rooms" open={sections.rooms} onToggle={() => toggleSection('rooms')}>
        {d.rooms && d.rooms.length > 0 ? (
          <div className="flex flex-col">
            {d.rooms.map(r => {
              const count = d.objects.filter(o => o.room === r.id).length;
              return (
                <div
                  key={r.id}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-ink-50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{r.name}</span>
                  <span className="tnum text-2xs text-ink-400">
                    {count} device{count === 1 ? '' : 's'}
                  </span>
                  <IconButton
                    label={`Delete room ${r.name}`}
                    size="sm"
                    tooltipSide="left"
                    className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => controller.deleteRoom(r.id)}
                  >
                    ✕
                  </IconButton>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-3 text-2xs leading-relaxed text-ink-400">
            No rooms yet. Add one, then assign devices to it from their properties.
          </div>
        )}
        <div className="px-3 pt-2">
          <Button size="sm" className="w-full" onClick={onAddRoom}>
            Add room…
          </Button>
        </div>
      </Section>

      <Section title="Grid & snapping" open={sections.grid} onToggle={() => toggleSection('grid')}>
        <Row label="Snap">
          <div className="flex items-center gap-2">
            <Toggle
              label="Enable snapping"
              checked={d.snapEnabled !== false}
              onChange={v =>
                doc.commit('Toggle snapping', dd => {
                  currentFloor(dd).snapEnabled = v;
                })
              }
            />
            <span className="text-xs text-ink-400">{d.snapEnabled !== false ? 'On' : 'Off'}</span>
          </div>
        </Row>
        {/* Grid spacing is REAL millimetres, tied to the plan's
            calibration — "300 mm off the corner" means something to an
            electrician in a way that abstract screen units never could. */}
        <Row label="Grid size">
          <NumberInput
            value={d.gridSpacingMM}
            step={50}
            suffix="mm"
            onCommit={v =>
              doc.commit('Set grid size', dd => {
                currentFloor(dd).gridSpacingMM = Math.max(1, v);
              })
            }
          />
        </Row>
        <Row label="Scale">
          <div className="flex items-center gap-1.5">
            {/* Pass null through rather than coercing to '' — NumberInput
                treats null as "empty" and shows the placeholder, whereas
                '' parses to 0 and displays a misleading scale of zero.
                Units are world-units-per-metre, matching production. */}
            <NumberInput
              value={d.scale}
              step={1}
              suffix="px/m"
              placeholder="not set"
              onCommit={v =>
                doc.commit('Set scale', dd => {
                  currentFloor(dd).scale = v > 0 ? v : null;
                })
              }
            />
          </div>
        </Row>
        <div className="px-3 pt-1.5">
          <Button size="sm" className="w-full" onClick={onCalibrate}>
            {d.scale ? 'Re-calibrate…' : 'Calibrate from a known length…'}
          </Button>
          <div className="mt-1.5 text-2xs leading-relaxed text-ink-400">
            {d.scale
              ? 'Measurements are shown in real units.'
              : 'Click two points a known distance apart to set the scale.'}
          </div>
        </div>
      </Section>

      {/* Symbol size is a readability preference, not drawing data — a
          dense job needs small symbols, a presentation print needs large.
          Production offers the same three steps. */}
      <Section title="Display" open={sections.display} onToggle={() => toggleSection('display')}>
        <Row label="Symbols">
          <Select
            value={String(doc.state.symbolSize || 16)}
            onChange={e => controller.setSymbolSize(parseInt(e.target.value, 10))}
          >
            <option value="12">Small</option>
            <option value="16">Medium</option>
            <option value="22">Large</option>
          </Select>
        </Row>
      </Section>
    </>
  );
}

// --- one device -------------------------------------------------------

/** "Kitchen downlights" if named, else "Downlight (7)". */
function deviceDisplayName(project, obj) {
  if (!obj) return '';
  if (obj.props && obj.props.customName) return obj.props.customName;
  const sym = resolveSymbol(project, obj.symbolId);
  return (sym ? sym.label : obj.symbolId) + ' (' + obj.id + ')';
}

function LinkChip({ label, note, onRemove, removeLabel }) {
  return (
    <span className="mb-1 mr-1 inline-flex max-w-full items-center gap-1 rounded-full border border-ink-200 bg-ink-50 py-0.5 pl-2 pr-1 text-2xs text-ink-700">
      <span className="truncate">{label}</span>
      {note && <span className="shrink-0 text-amber-600">{note}</span>}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className={cx(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none',
          'text-ink-400 hover:bg-ink-200 hover:text-ink-700',
          focusRing
        )}
      >
        ✕
      </button>
    </span>
  );
}

/**
 * Switching, from whichever end the user selected.
 *
 * On a SWITCH this is the editable side: one block per gang, each with
 * the bank's name and the devices on it. Gang is shown as an editable
 * override because the auto-count only ever raises (see
 * recomputeSwitchGang) — a 4-gang plate with two functions wired is a
 * real thing, and the app must not argue with it.
 *
 * On a LIGHT it is read-only apart from unlinking: "controlled by" is a
 * consequence of the links, and two or more entries is exactly what
 * two-way switching looks like, so it is called out rather than left for
 * the user to notice.
 */
function SwitchingSection({ obj, doc, controller, sections, toggleSection, onStartLinking }) {
  const beginLink = (id, newGroup) =>
    onStartLinking ? onStartLinking(id, newGroup) : controller.startLinking(id, newGroup);
  const project = doc.state;
  const floor = currentFloor(project);
  const symbolFor = id => resolveSymbol(project, id);
  const isSwitch = isSwitchSymbol(obj.symbolId);
  const controlledBy = linksForLight(floor, obj.id);

  if (!isSwitch && !(isLightSymbol(obj.symbolId) && controlledBy.length)) return null;

  if (!isSwitch) {
    return (
      <Section
        title="Switching"
        open={sections.switching !== false}
        onToggle={() => toggleSection('switching')}
      >
        <div className="px-3 pb-2">
          <FieldLabel className="mb-1.5">
            Controlled by
            {controlledBy.length >= 2 && (
              <span className="ml-1 font-normal text-amber-600">
                two-way — switched from {controlledBy.length} locations
              </span>
            )}
          </FieldLabel>
          <div>
            {controlledBy.map(l => {
              const so = floor.objects.find(o => o.id === l.switchId);
              return (
                <LinkChip
                  key={l.switchId}
                  label={so ? deviceDisplayName(project, so) : String(l.switchId)}
                  note={'gang ' + (l.group || 1)}
                  removeLabel="Unlink this switch"
                  onRemove={() => controller.unlinkLight(l.switchId, obj.id)}
                />
              );
            })}
          </div>
        </div>
      </Section>
    );
  }

  const groups = groupsForSwitch(floor, obj.id);
  const defaults = (resolveSymbol(project, obj.symbolId) || {}).defaultProps || {};

  return (
    <Section
      title="Switching"
      open={sections.switching !== false}
      onToggle={() => toggleSection('switching')}
    >
      <Row label="Gang">
        <Select
          value={(obj.props && obj.props.gang) || 1}
          onChange={e => controller.setObjectProps(obj.id, { gang: parseInt(e.target.value, 10) })}
        >
          {[1, 2, 3, 4, 5, 6].map(n => (
            <option key={n} value={n}>
              {n} gang
            </option>
          ))}
        </Select>
      </Row>
      {groups.length === 0 ? (
        <div className="px-3 pb-2 pt-1">
          <p className="mb-2 text-2xs leading-relaxed text-ink-400">Not linked to anything yet.</p>
          <Button onClick={() => beginLink(obj.id, false)}>Start linking lights</Button>
        </div>
      ) : (
        <div className="px-3 pb-2 pt-1">
          {groups.map(g => (
            <div key={g.group} className="mb-3">
              <FieldLabel className="mb-1">
                Gang {g.group} — {g.lightIds.length} device
                {g.lightIds.length === 1 ? '' : 's'}
              </FieldLabel>
              <TextInput
                className="mb-1.5"
                value={(floor.bankNames || {})[obj.id + '::' + g.group] || ''}
                placeholder={bankDisplayName(floor, obj.id, g.group, g.lightIds, symbolFor)}
                aria-label={'Name for gang ' + g.group}
                onChange={e => controller.setBankName(obj.id, g.group, e.target.value)}
              />
              <div>
                {g.links.map(l => {
                  const lt = floor.objects.find(o => o.id === l.lightId);
                  // A device switched from more than one place is the
                  // signature of two-way switching — worth surfacing here,
                  // because from this switch alone it looks ordinary.
                  const others = linksForLight(floor, l.lightId).filter(x => x.switchId !== obj.id);
                  return (
                    <LinkChip
                      key={l.lightId}
                      label={lt ? deviceDisplayName(project, lt) : String(l.lightId)}
                      note={others.length ? 'also switched elsewhere' : null}
                      removeLabel="Unlink this device"
                      onRemove={() => controller.unlinkLight(obj.id, l.lightId)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <Button onClick={() => beginLink(obj.id, true)}>+ New group (adds a gang)</Button>
        </div>
      )}
    </Section>
  );
}

function DeviceProperties({ obj, doc, controller, sections, toggleSection, onStartLinking }) {
  const rooms = currentFloor(doc.state).rooms || [];
  const sym = resolveSymbol(doc.state, obj.symbolId);
  const props = obj.props || {};
  const defaults = (sym && sym.defaultProps) || {};
  const scale = currentFloor(doc.state).scale;

  // Only show an electrical field when this device type actually has a
  // meaningful value for it — a light switch has no wattage of its own.
  const showCable = defaults.cable && defaults.cable !== '-';
  const showProtection = defaults.protection && defaults.protection !== '-';
  const showWatts = typeof defaults.watts === 'number' && defaults.watts > 0;
  const showHeight = typeof defaults.height_mm === 'number';
  // Rack ports available to this device, computed once per render — the
  // list spans every rack in the project, not just this floor.
  const portOptions = useMemo(
    () => (sym && sym.category === 'data' ? commsPortOptions(doc.state, obj.id) : []),
    [doc.state, obj.id, sym]
  );

  function setProp(patch) {
    controller.setObjectProps(obj.id, patch);
  }

  return (
    <>
      <div className="flex items-center gap-2.5 px-3 py-3">
        <SymbolChip sym={sym} size="lg" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-800">
            {props.customName || (sym ? sym.label : obj.symbolId)}
          </div>
          <div className="text-2xs text-ink-400">
            {sym ? CATEGORY_LABELS[sym.category] : 'Unknown'} · ID {obj.id}
          </div>
        </div>
      </div>
      <Divider />

      <Section title="General" open={sections.general} onToggle={() => toggleSection('general')}>
        <Row label="Name">
          <TextInput
            value={props.customName || ''}
            placeholder={sym ? sym.label : ''}
            onChange={e => setProp({ customName: e.target.value })}
          />
        </Row>
        <Row label="Position">
          <div className="flex gap-1.5">
            <NumberInput
              value={obj.x}
              onCommit={v => controller.setObjectPosition(obj.id, v, undefined)}
            />
            <NumberInput
              value={obj.y}
              onCommit={v => controller.setObjectPosition(obj.id, undefined, v)}
            />
          </div>
        </Row>
        {scale && (
          <div className="px-3 pb-1 pt-0.5 text-2xs text-ink-400 tnum">
            {formatDistance(obj.x, scale)} , {formatDistance(obj.y, scale)} from origin
          </div>
        )}
      </Section>

      {(showCable || showProtection || showWatts || showHeight) && (
        <Section
          title="Electrical"
          open={sections.electrical}
          onToggle={() => toggleSection('electrical')}
        >
          {showHeight && (
            <Row label="Height">
              <NumberInput
                value={props.height_mm ?? defaults.height_mm}
                step={50}
                suffix="mm"
                onCommit={v => setProp({ height_mm: v })}
              />
            </Row>
          )}
          {showCable && (
            <Row label="Cable">
              <Select
                value={props.cable ?? defaults.cable}
                onChange={e => setProp({ cable: e.target.value })}
              >
                <option value={defaults.cable}>{defaults.cable}</option>
                {CABLE_SIZES.map(c => (
                  <option key={c.size} value={c.size + ' TPS'}>
                    {c.size} TPS
                  </option>
                ))}
              </Select>
            </Row>
          )}
          {showProtection && (
            <Row label="Protection">
              <Select
                value={props.protection ?? defaults.protection}
                onChange={e => setProp({ protection: e.target.value })}
              >
                <option value={defaults.protection}>{defaults.protection}</option>
                {PROTECTION_LIBRARY.map(p => (
                  <option key={p.id} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Row>
          )}
          {showWatts && (
            <Row label="Load">
              <NumberInput
                value={props.watts ?? defaults.watts}
                step={10}
                suffix="W"
                onCommit={v => setProp({ watts: v })}
              />
            </Row>
          )}
          {/* Circuit sits with the electrical fields, not in its own
              section: which circuit a device is on is read alongside its
              cable and protection, not separately from them. */}
          <Row label="Circuit">
            <Select
              value={obj.circuit || ''}
              onChange={e => controller.assignCircuit([obj.id], e.target.value)}
            >
              <option value="">— unassigned —</option>
              {(doc.state.circuits || []).map(c => (
                <option key={c.id} value={c.id}>
                  {c.id}
                  {c.description ? ' — ' + c.description : ''}
                </option>
              ))}
            </Select>
          </Row>
          {isSwitchSymbol(obj.symbolId) && obj.circuit && (
            <div className="px-3 pt-1 text-2xs leading-relaxed text-amber-600">
              Hard active — the lights this switch controls are fed from this circuit too.
            </div>
          )}
        </Section>
      )}

      {/* Data outlets are wired point-to-point to a numbered rack port,
          not onto a shared circuit — so this is its own control rather
          than another row in Electrical. Only shown for data devices,
          and only once there is a rack to plug into. */}
      {sym && sym.category === 'data' && !isCommsRack(obj.symbolId) && (
        <Section
          title="Data"
          open={sections.electrical}
          onToggle={() => toggleSection('electrical')}
        >
          {portOptions.length === 0 ? (
            <div className="px-3 pb-1 text-2xs leading-relaxed text-ink-400">
              No comms rack on the plan yet — place one to wire this back to a port.
            </div>
          ) : (
            <Row label="Port">
              <Select
                value={(portOptions.find(p => p.selected) || {}).id || ''}
                onChange={e => controller.assignPort(obj.id, e.target.value || null)}
              >
                <option value="">— not connected —</option>
                {portOptions.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Row>
          )}
          <div className="px-3 pt-1 text-2xs leading-relaxed text-ink-400">
            One home run per outlet — assigning it here clears whichever port it was on before.
          </div>
        </Section>
      )}

      {isCommsRack(obj.symbolId) && (
        <Section
          title="Rack"
          open={sections.electrical}
          onToggle={() => toggleSection('electrical')}
        >
          <Row label="Ports">
            <div className="text-sm tnum text-ink-700">
              {(obj.commsPorts || []).filter(p => p.deviceId).length} of{' '}
              {(obj.commsPorts || []).length} used
            </div>
          </Row>
          <Row label="Patch panels">
            <div className="text-sm tnum text-ink-700">{patchPanelUnitsForRack(obj)}</div>
          </Row>
          <div className="px-3 pt-1 text-2xs leading-relaxed text-ink-400">
            One 24-port patch panel per 24 ports, counted automatically — it is not a device you
            place. Manage the ports themselves in the Comms racks panel.
          </div>
        </Section>
      )}

      {/* Switching sits directly under Electrical because it *is* an
          electrical property — but only for the device types it applies
          to, so the section renders nothing at all for a GPO. */}
      <SwitchingSection
        obj={obj}
        doc={doc}
        controller={controller}
        sections={sections}
        toggleSection={toggleSection}
        onStartLinking={onStartLinking}
      />

      {/* Room is a location property, not an electrical one — it groups
          devices for takeoffs ("how many GPOs in the kitchen"), so it sits
          in its own section rather than under Electrical. */}
      {rooms.length > 0 && (
        <Section title="Location" open={sections.general} onToggle={() => toggleSection('general')}>
          <Row label="Room">
            <Select
              value={obj.room || ''}
              onChange={e => controller.setObjectRoom(obj.id, e.target.value)}
            >
              <option value="">— none —</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Row>
        </Section>
      )}

      <Section title="Cost" open={sections.cost} onToggle={() => toggleSection('cost')} dense>
        <Row label="Material">
          <NumberInput
            value={props.material_cost ?? defaults.material_cost ?? 0}
            step={1}
            suffix="$"
            onCommit={v => setProp({ material_cost: v })}
          />
        </Row>
        <Row label="Labour">
          <NumberInput
            value={props.labour_hours ?? defaults.labour_hours ?? 0}
            step={0.05}
            suffix="h"
            onCommit={v => setProp({ labour_hours: v })}
          />
        </Row>
      </Section>
    </>
  );
}

// --- many devices -----------------------------------------------------

function AlignButton({ label, onClick, children }) {
  return (
    <IconButton label={label} size="sm" onClick={onClick} tooltipSide="top">
      {children}
    </IconButton>
  );
}

function MultiProperties({ objects, controller, sections, toggleSection, project }) {
  const breakdown = useMemo(() => {
    const by = new Map();
    for (const o of objects) {
      const s = resolveSymbol(project, o.symbolId);
      const key = s ? s.label : o.symbolId;
      by.set(key, (by.get(key) || 0) + 1);
    }
    return Array.from(by.entries()).sort((a, b) => b[1] - a[1]);
  }, [objects, project]);

  return (
    <>
      <div className="px-3 py-3">
        <div className="text-sm font-semibold text-ink-800">{objects.length} devices selected</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {breakdown.map(([label, n]) => (
            <span key={label} className="rounded bg-ink-100 px-1.5 py-0.5 text-2xs text-ink-600">
              {label} <span className="tnum font-medium">{n}</span>
            </span>
          ))}
        </div>
      </div>
      <Divider />

      <Section title="Align" open={sections.align} onToggle={() => toggleSection('align')}>
        <div className="px-3">
          <FieldLabel className="mb-1.5">Horizontal</FieldLabel>
          <div className="mb-2.5 flex gap-1">
            <AlignButton label="Align left" onClick={() => controller.alignSelected('left')}>
              ⇤
            </AlignButton>
            <AlignButton label="Align centre" onClick={() => controller.alignSelected('hcentre')}>
              ⇔
            </AlignButton>
            <AlignButton label="Align right" onClick={() => controller.alignSelected('right')}>
              ⇥
            </AlignButton>
            <Divider vertical className="mx-1 self-center" />
            <AlignButton
              label="Distribute horizontally"
              onClick={() => controller.distributeSelected('h')}
            >
              ⇹
            </AlignButton>
          </div>
          <FieldLabel className="mb-1.5">Vertical</FieldLabel>
          <div className="flex gap-1">
            <AlignButton label="Align top" onClick={() => controller.alignSelected('top')}>
              ⤒
            </AlignButton>
            <AlignButton label="Align middle" onClick={() => controller.alignSelected('vcentre')}>
              ⇕
            </AlignButton>
            <AlignButton label="Align bottom" onClick={() => controller.alignSelected('bottom')}>
              ⤓
            </AlignButton>
            <Divider vertical className="mx-1 self-center" />
            <AlignButton
              label="Distribute vertically"
              onClick={() => controller.distributeSelected('v')}
            >
              ⇳
            </AlignButton>
          </div>
          {objects.length < 3 && (
            <div className="mt-2 text-2xs text-ink-400">Distribute needs 3 or more devices.</div>
          )}
        </div>
      </Section>

      <Section title="Actions" open={sections.actions} onToggle={() => toggleSection('actions')}>
        <div className="flex gap-1.5 px-3">
          <Button size="sm" className="flex-1" onClick={() => controller.duplicateSelected()}>
            Duplicate
          </Button>
          <Button
            size="sm"
            variant="danger"
            className="flex-1"
            onClick={() => controller.deleteSelected()}
          >
            Delete
          </Button>
        </div>
      </Section>
    </>
  );
}

// --- tool context -----------------------------------------------------

function ToolContext({ controller, project }) {
  if (controller.tool === 'place' && controller.activeSymbolId) {
    const sym = resolveSymbol(project, controller.activeSymbolId);
    return (
      <div className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          <SymbolChip sym={sym} size="lg" />
          <div>
            <div className="text-sm font-semibold text-ink-800">Placing {sym ? sym.label : ''}</div>
            <div className="text-2xs text-ink-400">Click the plan to place</div>
          </div>
        </div>
        <div className="mt-3 rounded-md bg-ink-50 px-2.5 py-2 text-2xs leading-relaxed text-ink-500">
          Hold <span className="font-semibold text-ink-700">Shift</span> while clicking to place
          several in a row. Press <span className="font-semibold text-ink-700">Esc</span> to stop.
        </div>
      </div>
    );
  }
  if (controller.tool === 'measure' || controller.tool === 'calibrate') {
    const m = controller.measure;
    const calibrating = controller.tool === 'calibrate';
    return (
      <div className="px-3 py-3">
        <div className="text-sm font-semibold text-ink-800">
          {calibrating ? 'Calibrate scale' : 'Measure'}
        </div>
        <div className="mt-1 text-2xs leading-relaxed text-ink-400">
          {!m
            ? calibrating
              ? 'Click one end of a length you know.'
              : 'Click the first point.'
            : !m.b
              ? calibrating
                ? 'Click the other end.'
                : 'Click the second point.'
              : calibrating
                ? 'Enter the real length.'
                : 'Click to start a new measurement.'}
        </div>
        {calibrating && (
          <div className="mt-3 rounded-md bg-ink-50 px-2.5 py-2 text-2xs leading-relaxed text-ink-500">
            Pick something you can verify — a door opening, a room wall, or a dimension printed on
            the plan.
          </div>
        )}
      </div>
    );
  }
  return null;
}

// --- panel ------------------------------------------------------------

/**
 * The inspector's title changes with context, so it is computed here and
 * rendered by the hosting dock/sheet — one header, always accurate.
 */
const SEGMENT_TITLE = { cable: 'Cable', wall: 'Wall', dimension: 'Dimension' };

export function inspectorTitle(controller) {
  const n = controller.selectedIds.size;
  if ((controller.tool === 'place' && controller.activeSymbolId) || controller.tool === 'measure')
    return 'Tool';
  if (n > 1) return 'Selection';
  if (n === 1) return 'Device';
  const seg = controller.selectedSegment;
  if (seg) return SEGMENT_TITLE[seg.kind] || 'Object';
  return 'Drawing';
}

/**
 * A selected cable / wall / dimension. Cables get their size editable
 * here (it drives both how the run reads on the plan and what the quote
 * prices); walls and dimensions carry no properties beyond geometry, so
 * they show length and the delete action rather than inventing fields.
 */
function SegmentProperties({ segment, doc, controller }) {
  const { kind, item } = segment;
  const scale = currentFloor(doc.state).scale;
  const length = Math.hypot(item.x2 - item.x1, item.y2 - item.y1);

  return (
    <>
      <div className="flex items-center gap-2.5 px-3 py-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={
            kind === 'cable'
              ? {
                  background: (item.color || '#c084fc') + '22',
                  color: item.color || '#c084fc',
                  border: '1px solid ' + (item.color || '#c084fc') + '55',
                }
              : { background: '#e0e5ec', color: '#4c5a6e', border: '1px solid #c8d1dc' }
          }
        >
          {kind === 'cable' ? '⌇' : kind === 'wall' ? '▬' : '⟺'}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-800">
            {SEGMENT_TITLE[kind] || 'Object'}
          </div>
          <div className="text-2xs text-ink-400">ID {item.id}</div>
        </div>
      </div>
      <Divider />

      <Section title="General" open={sections_open} onToggle={() => {}}>
        <Row label="Length">
          <div className="tnum text-sm text-ink-700">{formatDistance(length, scale)}</div>
        </Row>
        {!scale && (
          <div className="px-3 pt-1 text-2xs leading-relaxed text-ink-400">
            Calibrate the drawing to show this in real units.
          </div>
        )}
        {kind === 'cable' && (
          <Row label="Size">
            <Select
              value={item.size || ''}
              onChange={e => {
                const size = CABLE_SIZES.find(s => s.size === e.target.value);
                if (size) controller.setSegmentCableSize(item.id, size);
              }}
            >
              {CABLE_SIZES.map(s => (
                <option key={s.size} value={s.size}>
                  {s.size}
                </option>
              ))}
            </Select>
          </Row>
        )}
      </Section>

      <Section title="Actions" open={sections_open} onToggle={() => {}}>
        <div className="px-3">
          <Button
            size="sm"
            variant="danger"
            className="w-full"
            onClick={() => controller.deleteSelectedSegment()}
          >
            Delete {kind}
          </Button>
        </div>
      </Section>
    </>
  );
}
// These two sections are always expanded: a segment has so few fields
// that collapsing them would hide everything the panel exists to show.
const sections_open = true;

export function Inspector({
  doc,
  controller,
  sections,
  toggleSection,
  onImportPlan,
  onCalibrate,
  onAddRoom,
  onStartLinking,
}) {
  const selected = controller.selectedObjects();
  const segment = controller.selectedSegmentObject();
  const toolCtx =
    (controller.tool === 'place' && controller.activeSymbolId) || controller.tool === 'measure';

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {toolCtx && <ToolContext controller={controller} project={doc.state} />}
        {!toolCtx && selected.length === 0 && segment && (
          <SegmentProperties segment={segment} doc={doc} controller={controller} />
        )}
        {!toolCtx && selected.length === 0 && !segment && (
          <DrawingProperties
            doc={doc}
            controller={controller}
            sections={sections}
            toggleSection={toggleSection}
            onImportPlan={onImportPlan}
            onCalibrate={onCalibrate}
            onAddRoom={onAddRoom}
          />
        )}
        {!toolCtx && selected.length === 1 && (
          <DeviceProperties
            obj={selected[0]}
            doc={doc}
            controller={controller}
            sections={sections}
            toggleSection={toggleSection}
            onStartLinking={onStartLinking}
          />
        )}
        {!toolCtx && selected.length > 1 && (
          <MultiProperties
            objects={selected}
            controller={controller}
            project={doc.state}
            sections={sections}
            toggleSection={toggleSection}
          />
        )}
      </div>
    </div>
  );
}
