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

import { Section, Row, NumberInput, TextInput, Select, Toggle, Button, IconButton, EmptyState, FieldLabel, Divider, cx } from './primitives.jsx';
import { SYMBOL_LIBRARY, CABLE_SIZES, PROTECTION_LIBRARY, CATEGORY_LABELS } from '../core/catalog.js';
import { formatDistance } from '../core/geometry.js';

const { useState, useMemo } = React;

function symbolFor(id) { return SYMBOL_LIBRARY.find(s => s.id === id); }

function SymbolChip({ sym, size = 'md' }) {
  if (!sym) return null;
  const dims = size === 'lg' ? 'h-9 w-9 text-xs' : 'h-6 w-6 text-2xs';
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold', dims)}
      style={{ background: sym.color + '22', color: sym.color, border: '1px solid ' + sym.color + '55' }}
    >
      {sym.abbr}
    </span>
  );
}

// --- nothing selected -------------------------------------------------

function DrawingProperties({ doc, controller, sections, toggleSection }) {
  const d = doc.state;
  const counts = useMemo(() => {
    const by = {};
    for (const o of d.objects) {
      const s = symbolFor(o.symbolId);
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

      <Section title="Grid & snapping" open={sections.grid} onToggle={() => toggleSection('grid')}>
        <Row label="Snap">
          <div className="flex items-center gap-2">
            <Toggle
              label="Enable snapping"
              checked={d.snapEnabled !== false}
              onChange={v => doc.commit('Toggle snapping', dd => { dd.snapEnabled = v; })}
            />
            <span className="text-xs text-ink-400">{d.snapEnabled !== false ? 'On' : 'Off'}</span>
          </div>
        </Row>
        <Row label="Grid size">
          <NumberInput
            value={d.gridSpacing}
            step={5}
            suffix="u"
            onCommit={v => doc.commit('Set grid size', dd => { dd.gridSpacing = Math.max(2, v); })}
          />
        </Row>
        <Row label="Scale">
          <div className="flex items-center gap-1.5">
            {/* Pass null through rather than coercing to '' — NumberInput
                treats null as "empty" and shows the placeholder, whereas
                '' parses to 0 and displays a misleading scale of zero. */}
            <NumberInput
              value={d.scale}
              step={1}
              suffix="mm/u"
              placeholder="not set"
              onCommit={v => doc.commit('Set scale', dd => { dd.scale = v > 0 ? v : null; })}
            />
          </div>
        </Row>
        {!d.scale && (
          <div className="px-3 pt-1 text-2xs leading-relaxed text-ink-400">
            Set a scale to show real measurements instead of drawing units.
          </div>
        )}
      </Section>
    </>
  );
}

// --- one device -------------------------------------------------------

function DeviceProperties({ obj, doc, controller, sections, toggleSection }) {
  const sym = symbolFor(obj.symbolId);
  const props = obj.props || {};
  const defaults = (sym && sym.defaultProps) || {};
  const scale = doc.state.scale;

  // Only show an electrical field when this device type actually has a
  // meaningful value for it — a light switch has no wattage of its own.
  const showCable = defaults.cable && defaults.cable !== '-';
  const showProtection = defaults.protection && defaults.protection !== '-';
  const showWatts = typeof defaults.watts === 'number' && defaults.watts > 0;
  const showHeight = typeof defaults.height_mm === 'number';

  function setProp(patch) { controller.setObjectProps(obj.id, patch); }

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
            <NumberInput value={obj.x} onCommit={v => controller.setObjectPosition(obj.id, v, undefined)} />
            <NumberInput value={obj.y} onCommit={v => controller.setObjectPosition(obj.id, undefined, v)} />
          </div>
        </Row>
        {scale && (
          <div className="px-3 pb-1 pt-0.5 text-2xs text-ink-400 tnum">
            {formatDistance(obj.x, scale)} , {formatDistance(obj.y, scale)} from origin
          </div>
        )}
      </Section>

      {(showCable || showProtection || showWatts || showHeight) && (
        <Section title="Electrical" open={sections.electrical} onToggle={() => toggleSection('electrical')}>
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
              <Select value={props.cable ?? defaults.cable} onChange={e => setProp({ cable: e.target.value })}>
                <option value={defaults.cable}>{defaults.cable}</option>
                {CABLE_SIZES.map(c => (
                  <option key={c.size} value={c.size + ' TPS'}>{c.size} TPS</option>
                ))}
              </Select>
            </Row>
          )}
          {showProtection && (
            <Row label="Protection">
              <Select value={props.protection ?? defaults.protection} onChange={e => setProp({ protection: e.target.value })}>
                <option value={defaults.protection}>{defaults.protection}</option>
                {PROTECTION_LIBRARY.map(p => (
                  <option key={p.id} value={p.label}>{p.label}</option>
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
          <div className="px-3 pt-1.5 text-2xs leading-relaxed text-ink-400">
            Circuit assignment, comms ports and switch linking live in the full
            app — not yet ported into this workspace.
          </div>
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
    <IconButton label={label} size="sm" onClick={onClick} tooltipSide="top">{children}</IconButton>
  );
}

function MultiProperties({ objects, controller, sections, toggleSection }) {
  const breakdown = useMemo(() => {
    const by = new Map();
    for (const o of objects) {
      const s = symbolFor(o.symbolId);
      const key = s ? s.label : o.symbolId;
      by.set(key, (by.get(key) || 0) + 1);
    }
    return Array.from(by.entries()).sort((a, b) => b[1] - a[1]);
  }, [objects]);

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
            <AlignButton label="Align left" onClick={() => controller.alignSelected('left')}>⇤</AlignButton>
            <AlignButton label="Align centre" onClick={() => controller.alignSelected('hcentre')}>⇔</AlignButton>
            <AlignButton label="Align right" onClick={() => controller.alignSelected('right')}>⇥</AlignButton>
            <Divider vertical className="mx-1 self-center" />
            <AlignButton label="Distribute horizontally" onClick={() => controller.distributeSelected('h')}>⇹</AlignButton>
          </div>
          <FieldLabel className="mb-1.5">Vertical</FieldLabel>
          <div className="flex gap-1">
            <AlignButton label="Align top" onClick={() => controller.alignSelected('top')}>⤒</AlignButton>
            <AlignButton label="Align middle" onClick={() => controller.alignSelected('vcentre')}>⇕</AlignButton>
            <AlignButton label="Align bottom" onClick={() => controller.alignSelected('bottom')}>⤓</AlignButton>
            <Divider vertical className="mx-1 self-center" />
            <AlignButton label="Distribute vertically" onClick={() => controller.distributeSelected('v')}>⇳</AlignButton>
          </div>
          {objects.length < 3 && (
            <div className="mt-2 text-2xs text-ink-400">Distribute needs 3 or more devices.</div>
          )}
        </div>
      </Section>

      <Section title="Actions" open={sections.actions} onToggle={() => toggleSection('actions')}>
        <div className="flex gap-1.5 px-3">
          <Button size="sm" className="flex-1" onClick={() => controller.duplicateSelected()}>Duplicate</Button>
          <Button size="sm" variant="danger" className="flex-1" onClick={() => controller.deleteSelected()}>Delete</Button>
        </div>
      </Section>
    </>
  );
}

// --- tool context -----------------------------------------------------

function ToolContext({ controller }) {
  if (controller.tool === 'place' && controller.activeSymbolId) {
    const sym = symbolFor(controller.activeSymbolId);
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
          Hold <span className="font-semibold text-ink-700">Shift</span> while clicking to place several in a row.
          Press <span className="font-semibold text-ink-700">Esc</span> to stop.
        </div>
      </div>
    );
  }
  if (controller.tool === 'measure') {
    const m = controller.measure;
    return (
      <div className="px-3 py-3">
        <div className="text-sm font-semibold text-ink-800">Measure</div>
        <div className="mt-1 text-2xs text-ink-400">
          {!m ? 'Click the first point.' : !m.b ? 'Click the second point.' : 'Click to start a new measurement.'}
        </div>
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
export function inspectorTitle(controller) {
  const n = controller.selectedIds.size;
  if ((controller.tool === 'place' && controller.activeSymbolId) || controller.tool === 'measure') return 'Tool';
  if (n > 1) return 'Selection';
  if (n === 1) return 'Device';
  return 'Drawing';
}

export function Inspector({ doc, controller, sections, toggleSection }) {
  const selected = controller.selectedObjects();
  const toolCtx = (controller.tool === 'place' && controller.activeSymbolId) || controller.tool === 'measure';

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {toolCtx && <ToolContext controller={controller} />}
        {!toolCtx && selected.length === 0 && (
          <DrawingProperties doc={doc} controller={controller} sections={sections} toggleSection={toggleSection} />
        )}
        {!toolCtx && selected.length === 1 && (
          <DeviceProperties obj={selected[0]} doc={doc} controller={controller} sections={sections} toggleSection={toggleSection} />
        )}
        {!toolCtx && selected.length > 1 && (
          <MultiProperties objects={selected} controller={controller} sections={sections} toggleSection={toggleSection} />
        )}
      </div>
    </div>
  );
}
