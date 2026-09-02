// ===================================================================
// WORKSPACE SHELL  (directive §3, §11, §16, §22)
//
// Layout priority is literal: the canvas is the only element that grows.
// Everything else is fixed-width chrome that can be collapsed away, and
// the layout is built so that collapsing every panel leaves a full-bleed
// drawing surface with nothing but a 44px rail.
//
// Three genuinely different interaction models rather than one shrunk
// down (§11):
//
//   desktop (≥1024) — vertical tool rail, docked resizable side panels,
//                     persistent inspector. Optimised for a mouse and a
//                     large screen: nothing overlaps the drawing.
//   tablet  (≥640)  — vertical rail kept, but panels become a single
//                     overlay column. Screen is too narrow to show the
//                     drawing AND two panels usefully.
//   mobile  (<640)  — no rail. A bottom action bar (thumb reach) and
//                     panels as bottom sheets over the drawing, since a
//                     phone cannot show chrome and canvas side by side.
// ===================================================================

import { IconButton, Button, Tooltip, Divider, Spinner, cx, focusRing } from './primitives.jsx';
import { CanvasStage } from './CanvasStage.jsx';
import { formatShortcut } from '../core/commands.js';
import { SaveState } from '../core/persistence.js';
import { formatDistance } from '../core/geometry.js';

const { useState, useRef, useEffect, useCallback } = React;

// --- save state (§17) -------------------------------------------------
// Reflects real persistence outcomes. There is no timer-driven "Saved!"
// that appears regardless of whether the write succeeded.

function SaveIndicator({ state, error, lastSavedAt, onSave }) {
  const map = {
    [SaveState.SAVED]: { dot: 'bg-emerald-500', text: 'Saved', tone: 'text-ink-400' },
    [SaveState.UNSAVED]: { dot: 'bg-amber-400', text: 'Unsaved changes', tone: 'text-ink-500' },
    [SaveState.SAVING]: { dot: 'bg-accent-400', text: 'Saving…', tone: 'text-ink-400' },
    [SaveState.ERROR]: { dot: 'bg-red-500', text: 'Not saved', tone: 'text-red-600' },
  }[state] || { dot: 'bg-ink-300', text: '', tone: 'text-ink-400' };

  const title = state === SaveState.ERROR
    ? error
    : state === SaveState.SAVED && lastSavedAt
      ? 'Last saved ' + new Date(lastSavedAt).toLocaleTimeString()
      : undefined;

  return (
    <Tooltip label={title || map.text}>
      <button
        onClick={onSave}
        className={cx('flex items-center gap-1.5 rounded px-1.5 py-1 text-2xs transition-colors hover:bg-ink-100', map.tone, focusRing)}
      >
        {state === SaveState.SAVING
          ? <Spinner className="h-3 w-3 text-accent-500" />
          : <span className={cx('h-1.5 w-1.5 rounded-full', map.dot)} />}
        <span className="hidden sm:inline">{map.text}</span>
      </button>
    </Tooltip>
  );
}

// --- resizable dock ---------------------------------------------------

function ResizeHandle({ side, onResize }) {
  const dragging = useRef(false);
  useEffect(() => {
    function move(e) { if (dragging.current) onResize(e.clientX); }
    function up() { dragging.current = false; document.body.style.cursor = ''; }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [onResize]);
  return (
    <div
      onPointerDown={() => { dragging.current = true; document.body.style.cursor = 'col-resize'; }}
      className={cx(
        'absolute top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-accent-400/40',
        side === 'right' ? '-right-0.5' : '-left-0.5'
      )}
      role="separator"
      aria-orientation="vertical"
    />
  );
}

/**
 * Panel chrome (the title bar) lives HERE rather than inside each panel,
 * so a panel component renders only its content. Previously each panel
 * drew its own header and the sheet drew one too, which showed the title
 * twice on tablet/mobile.
 */
function Dock({ side, width, title, onClose, onResize, children }) {
  return (
    // Visibility is decided in JS (see showLeftDock/showRightDock), not by
    // responsive utility classes — the two docks appear at different
    // widths, so a single `lg:` prefix can't express it.
    <div
      className={cx(
        'relative flex shrink-0 flex-col bg-white',
        side === 'left' ? 'border-r border-ink-200 animate-slide-l' : 'border-l border-ink-200 animate-slide-r'
      )}
      style={{ width }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-ink-100 pl-3 pr-1">
        <span className="text-2xs font-semibold uppercase tracking-wide text-ink-500">{title}</span>
        <IconButton label={`Close ${title} panel`} size="sm" onClick={onClose}>✕</IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <ResizeHandle side={side === 'left' ? 'right' : 'left'} onResize={onResize} />
    </div>
  );
}

// --- bottom sheet (tablet/mobile) -------------------------------------

function Sheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink-950/20 animate-fade-in" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[68%] flex-col rounded-t-xl bg-white shadow-pop animate-sheet-up">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-100 px-3">
          <div className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-ink-200" />
          <span className="text-2xs font-semibold uppercase tracking-wide text-ink-500">{title}</span>
          <IconButton label="Close" size="sm" onClick={onClose}>✕</IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// --- status bar (§16) -------------------------------------------------
// Answers "where am I / what's selected / what will snapping do" without
// the user having to ask.

function StatusBar({ controller, doc, view }) {
  const d = doc.state;
  const sel = controller.selectedIds.size;
  const cur = controller.cursorWorld;
  const snapOn = d.snapEnabled !== false;

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-ink-200 bg-white px-3 text-2xs text-ink-400">
      <span className="tnum">{Math.round(view.zoom * 100)}%</span>
      <Divider vertical className="h-3" />
      {cur ? (
        <span className="tnum hidden sm:inline">
          {d.scale
            ? `${formatDistance(cur.x, d.scale)}, ${formatDistance(cur.y, d.scale)}`
            : `${Math.round(cur.x)}, ${Math.round(cur.y)}`}
        </span>
      ) : (
        <span className="hidden sm:inline text-ink-300">—</span>
      )}
      <Divider vertical className="hidden h-3 sm:block" />
      <span className={cx('flex items-center gap-1', snapOn ? 'text-ink-500' : 'text-ink-300')}>
        <span className={cx('h-1.5 w-1.5 rounded-full', snapOn ? 'bg-emerald-500' : 'bg-ink-300')} />
        Snap {snapOn ? 'on' : 'off'}
      </span>
      {/* Live snap explanation — the "why did it move there" answer (§7). */}
      {controller.snap && controller.snap.reason && (
        <>
          <Divider vertical className="h-3" />
          <span className="text-accent-600">{controller.snap.reason}</span>
        </>
      )}
      <div className="flex-1" />
      {sel > 0 && <span className="tnum">{sel} selected</span>}
      <span className="tnum hidden sm:inline">
        {d.objects.length} {d.objects.length === 1 ? 'device' : 'devices'}
      </span>
    </div>
  );
}

// --- tool rail --------------------------------------------------------

function ToolRail({ tools, controller, registry, ctx, panels, onTogglePanel }) {
  return (
    <div className="hidden w-11 shrink-0 flex-col items-center gap-0.5 border-r border-ink-200 bg-white py-2 sm:flex">
      {tools.map(t =>
        t.divider ? (
          <Divider key={t.key} className="my-1.5 w-5" />
        ) : (
          <IconButton
            key={t.key}
            label={t.label}
            shortcut={t.shortcut ? formatShortcut(t.shortcut) : undefined}
            tooltipSide="right"
            active={t.isActive ? t.isActive() : false}
            onClick={t.onClick}
          >
            {t.icon}
          </IconButton>
        )
      )}
      <div className="flex-1" />
      <IconButton
        label="Layers" shortcut="L" tooltipSide="right"
        active={panels.left === 'layers'}
        onClick={() => onTogglePanel('left', 'layers')}
      >▤</IconButton>
      <IconButton
        label="Components" shortcut="P" tooltipSide="right"
        active={panels.left === 'library'}
        onClick={() => onTogglePanel('left', 'library')}
      >⊞</IconButton>
    </div>
  );
}

// --- mobile action bar ------------------------------------------------

function MobileBar({ tools, panels, onTogglePanel }) {
  return (
    <div
      className="flex h-14 shrink-0 items-center justify-around border-t border-ink-200 bg-white sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tools.filter(t => !t.divider && t.primary).map(t => (
        <button
          key={t.key}
          onClick={t.onClick}
          aria-label={t.label}
          aria-pressed={t.isActive ? t.isActive() : undefined}
          className={cx(
            'flex h-11 w-14 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors',
            t.isActive && t.isActive() ? 'bg-accent-50 text-accent-700' : 'text-ink-500 active:bg-ink-100',
            focusRing
          )}
        >
          <span className="text-[17px] leading-none">{t.icon}</span>
          <span className="text-[9px] leading-none">{t.shortLabel || t.label}</span>
        </button>
      ))}
      <button
        onClick={() => onTogglePanel('left', 'library')}
        aria-label="Components"
        className={cx(
          'flex h-11 w-14 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors',
          panels.left === 'library' ? 'bg-accent-50 text-accent-700' : 'text-ink-500 active:bg-ink-100',
          focusRing
        )}
      >
        <span className="text-[17px] leading-none">⊞</span>
        <span className="text-[9px] leading-none">Place</span>
      </button>
      <button
        onClick={() => onTogglePanel('left', 'layers')}
        aria-label="Layers"
        className={cx(
          'flex h-11 w-14 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors',
          panels.left === 'layers' ? 'bg-accent-50 text-accent-700' : 'text-ink-500 active:bg-ink-100',
          focusRing
        )}
      >
        <span className="text-[17px] leading-none">▤</span>
        <span className="text-[9px] leading-none">Layers</span>
      </button>
    </div>
  );
}

// --- canvas overlays --------------------------------------------------

function ZoomCluster({ controller, onFit }) {
  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1 rounded-lg border border-white/10 bg-ink-900/85 p-1 backdrop-blur">
      <IconButton label="Zoom in" size="sm" tooltipSide="left" onDark onClick={() => controller.zoomBy(1.2)}>+</IconButton>
      <IconButton label="Zoom out" size="sm" tooltipSide="left" onDark onClick={() => controller.zoomBy(1 / 1.2)}>−</IconButton>
      <IconButton label="Fit to drawing" shortcut="⇧F" size="sm" tooltipSide="left" onDark onClick={onFit}>⛶</IconButton>
    </div>
  );
}

/**
 * Transient hint strip. Only rendered when a mode is actually active, so
 * it costs nothing in the default drafting state — the opposite of a
 * permanent instruction bar (§5).
 */
function ModeHint({ controller }) {
  let text = null;
  if (controller.tool === 'place' && controller.activeSymbolId) text = 'Click to place · Shift-click for several · Esc to stop';
  else if (controller.tool === 'calibrate') text = 'Click both ends of a length you know · Esc to exit';
  else if (controller.tool === 'measure') text = 'Click two points to measure · Esc to exit';
  else if (controller.tool === 'pan') text = 'Drag to pan · V to go back to Select';
  else if (controller.spaceHeld) text = 'Pan';
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 animate-fade-in rounded-full border border-white/10 bg-ink-900/85 px-3 py-1.5 text-2xs font-medium text-white/90 backdrop-blur">
      {text}
    </div>
  );
}

/**
 * Shown only while the drawing has no devices. Once a floor plan has been
 * imported it moves out of the centre and shrinks to a hint strip — the
 * plan is the thing the user just added and wants to look at, and a card
 * sitting on top of it is in the way.
 */
function EmptyCanvasHint({ onOpenLibrary, hasPlan }) {
  if (hasPlan) {
    return (
      <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 -translate-x-1/2 animate-fade-in">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-ink-900/85 py-1.5 pl-3.5 pr-1.5 backdrop-blur">
          <span className="text-2xs text-white/70">No devices placed yet</span>
          <Button size="sm" variant="primary" onClick={onOpenLibrary}>Add devices</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto max-w-[300px] rounded-xl border border-white/10 bg-ink-900/70 px-5 py-4 text-center backdrop-blur">
        <div className="text-sm font-medium text-white/90">Empty drawing</div>
        <div className="mt-1 text-2xs leading-relaxed text-white/50">
          Import a floor plan to trace over, or place devices straight onto the grid.
        </div>
        <Button size="sm" variant="primary" className="mt-3" onClick={onOpenLibrary}>Open components</Button>
      </div>
    </div>
  );
}

// --- shell ------------------------------------------------------------

export function Workspace({
  doc, controller, view, registry, ctx, symbolFor,
  projectName, onRenameProject, onExit,
  saveState, saveError, lastSavedAt, onSave,
  panels, onTogglePanel, dockWidths, onDockResize,
  leftPanelContent, rightPanelContent, leftPanelTitle, rightPanelTitle,
  onFit, onViewportChange, onContextMenu, breakpoint,
}) {
  const tools = [
    { key: 'select', label: 'Select', shortLabel: 'Select', shortcut: 'V', icon: '⌖', primary: true,
      isActive: () => controller.tool === 'select', onClick: () => controller.setTool('select') },
    { key: 'pan', label: 'Pan', shortLabel: 'Pan', shortcut: 'H', icon: '✋', primary: true,
      isActive: () => controller.tool === 'pan', onClick: () => controller.setTool('pan') },
    { key: 'measure', label: 'Measure', shortLabel: 'Measure', shortcut: 'M', icon: '↔', primary: true,
      isActive: () => controller.tool === 'measure', onClick: () => controller.setTool('measure') },
    { key: 'div1', divider: true },
    // Calibrate is deliberately NOT in the mobile primary bar: it's a
    // once-per-drawing setup action, not something reached mid-draft.
    { key: 'calibrate', label: 'Calibrate scale', shortcut: 'C', icon: '⚖',
      isActive: () => controller.tool === 'calibrate', onClick: () => registry.run('tool.calibrate', ctx) },
    { key: 'plan', label: 'Import floor plan', icon: '⇧',
      isActive: () => false, onClick: () => registry.run('plan.import', ctx) },
  ];

  const cursorClass =
    controller.tool === 'pan' || controller.spaceHeld
      ? (controller.isPanning ? 'cursor-grabbing' : 'cursor-grab')
      : controller.tool === 'place' ? 'cursor-crosshair'
      : controller.tool === 'measure' ? 'cursor-crosshair'
      : 'cursor-default';

  const isEmpty = doc.state.objects.length === 0;
  // Two different thresholds, because the two docks cost different
  // amounts of canvas. The left (library/layers) dock only earns its
  // ~232px once there is desktop width to spare. The right inspector is
  // worth docking from tablet-portrait up: at 800px a docked 264px panel
  // leaves ~490px of drawing, whereas the same panel as a bottom sheet
  // covers two thirds of the screen.
  const showLeftDock = breakpoint.name === 'desktop' && panels.left;
  const showRightDock = breakpoint.width >= 768 && panels.right;
  const overlayLeft = !showLeftDock && panels.left;
  const overlayRight = !showRightDock && panels.right;

  return (
    <div className="flex h-full flex-col bg-ink-100">
      {/* Chrome: project identity, document state, history */}
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-ink-200 bg-white px-2">
        <IconButton label="All projects" size="sm" onClick={onExit}>←</IconButton>
        <input
          value={projectName}
          onChange={e => onRenameProject(e.target.value)}
          aria-label="Project name"
          className={cx(
            'min-w-0 max-w-[240px] flex-1 rounded px-1.5 py-1 text-sm font-semibold text-ink-800',
            'hover:bg-ink-50 focus:bg-ink-50 outline-none transition-colors sm:flex-none sm:w-56', focusRing
          )}
        />
        <SaveIndicator state={saveState} error={saveError} lastSavedAt={lastSavedAt} onSave={onSave} />

        <div className="flex-1" />

        <IconButton label="Undo" shortcut={formatShortcut('Mod+Z')} size="sm" disabled={!doc.canUndo} onClick={() => registry.run('edit.undo', ctx)}>↶</IconButton>
        <IconButton label="Redo" shortcut={formatShortcut('Mod+Shift+Z')} size="sm" disabled={!doc.canRedo} onClick={() => registry.run('edit.redo', ctx)}>↷</IconButton>
        <Divider vertical className="mx-1" />
        <Tooltip label="Commands" shortcut={formatShortcut('Mod+K')}>
          <button
            onClick={() => registry.run('app.palette', ctx)}
            className={cx('flex h-7 items-center gap-1.5 rounded-md border border-ink-200 px-2 text-xs text-ink-500 transition-colors hover:bg-ink-50', focusRing)}
          >
            <span>⌘</span><span className="hidden md:inline">Commands</span>
          </button>
        </Tooltip>
        <IconButton
          label="Properties" size="sm"
          active={!!panels.right}
          onClick={() => onTogglePanel('right', 'inspector')}
        >☰</IconButton>
      </header>

      <div className="flex min-h-0 flex-1">
        <ToolRail tools={tools} controller={controller} registry={registry} ctx={ctx} panels={panels} onTogglePanel={onTogglePanel} />

        {showLeftDock && (
          <Dock
            side="left"
            width={dockWidths.left}
            title={leftPanelTitle}
            onClose={() => onTogglePanel('left', null)}
            onResize={x => onDockResize('left', x)}
          >
            {leftPanelContent}
          </Dock>
        )}

        <main className="relative min-w-0 flex-1">
          <CanvasStage
            controller={controller} doc={doc} view={view} symbolFor={symbolFor}
            cursorClass={cursorClass} onViewportChange={onViewportChange}
            onContextMenu={onContextMenu}
          />
          <ModeHint controller={controller} />
          <ZoomCluster controller={controller} onFit={onFit} />
          {isEmpty && (
            <EmptyCanvasHint
              onOpenLibrary={() => onTogglePanel('left', 'library')}
              hasPlan={!!doc.state.planImage}
            />
          )}
        </main>

        {showRightDock && (
          <Dock
            side="right"
            width={dockWidths.right}
            title={rightPanelTitle}
            onClose={() => onTogglePanel('right', null)}
            onResize={x => onDockResize('right', x)}
          >
            {rightPanelContent}
          </Dock>
        )}
      </div>

      <StatusBar controller={controller} doc={doc} view={view} />
      <MobileBar tools={tools} panels={panels} onTogglePanel={onTogglePanel} />

      {/* Whatever didn't earn a dock at this width overlays as a sheet. */}
      <Sheet open={!!overlayLeft} title={leftPanelTitle} onClose={() => onTogglePanel('left', null)}>
        {leftPanelContent}
      </Sheet>
      <Sheet open={!!overlayRight} title={rightPanelTitle} onClose={() => onTogglePanel('right', null)}>
        {rightPanelContent}
      </Sheet>
    </div>
  );
}
