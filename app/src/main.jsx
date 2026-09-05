// ===================================================================
// APPLICATION ROOT
//
// Wires the document, the interaction controller, the command registry,
// the keyboard layer and persistence together, and picks between the
// project browser and the workspace.
//
// The command registry is built ONCE here (§9): every action the app can
// perform is declared in one place, and the palette, the shortcut
// handler, and the toolbar buttons all invoke through it. Adding an
// action later means adding one entry, not touching four files.
// ===================================================================

import {
  createDocument,
  emptyProject,
  currentFloor,
  migrateLoadedProject,
  findDuplicateDevices,
} from './core/document.js';
import { createController } from './core/controller.js';
import { createCommandRegistry, matchesShortcut, isTypingTarget } from './core/commands.js';
import { boundsOf, viewForBounds, gridWorldUnits } from './core/geometry.js';
import { SYMBOL_LIBRARY, LAYER_DEFS, CABLE_SIZES, PROTECTION_LIBRARY } from './core/catalog.js';
import { makeSymbolResolver, allSymbols } from './core/symbols.js';
import { computeQuote, quoteLines, quoteText, quoteSettings, formatMoney } from './core/quote.js';
import { findBoardObjects } from './core/circuits.js';
import {
  currentCivilPlan,
  currentPlan,
  buildCivilSchedule,
  computeCivilLegendEntries,
  computeAllCivilTotals,
} from './core/civil.js';
import {
  buildPanelScheduleData,
  panelScheduleText,
  resolveSwitchboardLabel,
  DIVERSITY_TYPE_LABELS,
  MAINS_VOLTAGE,
} from './core/panelSchedule.js';
import { activeElevation, elevationLayout, elevationItemPoint } from './core/elevations.js';
import { PAINT } from './core/renderer.js';
import {
  CAPTURE_W,
  CAPTURE_H,
  buildPrintPages,
  drawPdfPage,
  legendEntryColor,
  legendEntryLabel,
  fileSafeName,
  jsonFileName,
} from './core/print.js';
import {
  listProjects,
  loadProject,
  saveProject,
  deleteProject,
  newProjectId,
  loadWorkspaceUI,
  saveWorkspaceUI,
  SaveState,
} from './core/persistence.js';

import {
  ToastHost,
  useToasts,
  useBreakpoint,
  Dialog,
  Button,
  TextInput,
  Select,
  FieldLabel,
  Toggle,
  Spinner,
  cx,
  focusRing,
} from './ui/primitives.jsx';
import { Workspace } from './ui/Workspace.jsx';
import { Inspector, inspectorTitle } from './ui/Inspector.jsx';
import {
  LibraryPanel,
  LayersPanel,
  CircuitsPanel,
  CommsPanel,
  CivilPalette,
  CivilPlansPanel,
} from './ui/Panels.jsx';
import { CommandPalette } from './ui/CommandPalette.jsx';
import { CanvasContextMenu } from './ui/ContextMenu.jsx';
import { ProjectPicker } from './ui/ProjectPicker.jsx';
import {
  AuthGate,
  ReadOnlyBanner,
  ReportProblemDialog,
  AccountDialog,
  useCloud,
} from './ui/Cloud.jsx';
import {
  cloudConfigured,
  initCloudAuth,
  getCloudState,
  clearOrgProjectContext,
  cloudSyncSilently,
  loadCloudProject,
  openOrgProject,
  shareProjectToOrg,
  deleteCloudCopyOf,
} from './core/cloud.js';
import { toCloudRecord, fromCloudRecord } from './core/cloudFormat.js';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/**
 * Every point on a civil plan, for framing the view. A run contributes
 * all of its vertices, not just its ends, so a long dog-legged conduit
 * frames correctly rather than being clipped at a bend.
 */
function civilPoints(plan) {
  const pts = []
    .concat(plan.pits || [], plan.poles || [], plan.buildingEntries || [])
    .map(o => ({ x: o.x, y: o.y }));
  for (const run of (plan.conduits || []).concat(plan.overheadRuns || [])) {
    for (const p of run.points || []) pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

const AUTOSAVE_MS = 1200;

function WorkspaceRoot({ projectId, initialProject, readOnly, sharedByName, onExit, pushToast }) {
  const breakpoint = useBreakpoint();

  // --- document ------------------------------------------------------
  const docRef = useRef(null);
  if (!docRef.current) {
    docRef.current = createDocument(emptyProject());
    // Armed at creation, not in an effect. Effects run after the first
    // paint, which would leave a window — however brief — where a shared
    // project this account can only view accepts commits. The load
    // effect below re-applies it around load(), which is exempt.
    docRef.current.setReadOnly(!!readOnly);
  }
  const doc = docRef.current;

  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender(n => n + 1), []);

  // --- view (kept in a ref: panning must not re-render React) --------
  const viewRef = useRef({ zoom: 1, offsetX: 0, offsetY: 0 });
  const viewportRef = useRef({ width: 0, height: 0 });
  const [viewTick, setViewTick] = useState(0);
  const getView = useCallback(() => viewRef.current, []);
  const setView = useCallback(v => {
    viewRef.current = v;
    setViewTick(t => t + 1);
  }, []);
  const getViewport = useCallback(() => viewportRef.current, []);

  // "The user has taken control of the view." Until this flips true, the
  // drawing is kept auto-framed on every layout change — which is what
  // makes the initial fit reliable regardless of when the canvas settles
  // to its real size, instead of depending on a one-shot guess about
  // layout timing.
  //
  // It flips on ANY real interaction — panning, zooming, or editing the
  // drawing — not just view changes. Once someone has started placing
  // devices they are working at a chosen position, and having the view
  // jump because a panel opened and changed the canvas width would move
  // the drawing out from under them mid-task.
  const viewTouchedRef = useRef(false);
  const setViewFromUser = useCallback(
    v => {
      viewTouchedRef.current = true;
      setView(v);
    },
    [setView]
  );

  // --- controller ----------------------------------------------------
  // Calibration is a two-step flow: the controller reports the drawn
  // length, then the user says what that length really is. Held in a ref
  // so the controller (created once) can reach the current handler.
  const calibrationRef = useRef(null);
  const [calibrateLength, setCalibrateLength] = useState(null);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [fittingDialogOpen, setFittingDialogOpen] = useState(false);
  const [assignRoomOpen, setAssignRoomOpen] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // null = closed; { id } = editing that circuit; { id: null } = adding.
  const [circuitDialog, setCircuitDialog] = useState(null);
  const [assignCircuitOpen, setAssignCircuitOpen] = useState(false);
  const [panelScheduleOpen, setPanelScheduleOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [priceListOpen, setPriceListOpen] = useState(false);
  const [civilMaterialsOpen, setCivilMaterialsOpen] = useState(false);
  const [elevationsOpen, setElevationsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [printExportOpen, setPrintExportOpen] = useState(false);
  // { title, text } while a text export is on screen.
  const [exportText, setExportText] = useState(null);

  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createController({
      doc,
      getView,
      setView: setViewFromUser,
      getViewport,
      onChange: rerender,
      onCalibrate: len => calibrationRef.current && calibrationRef.current(len),
    });
    controllerRef.current.setSymbolResolver(makeSymbolResolver(() => doc.state));
  }
  const controller = controllerRef.current;
  // Same resolver the controller uses, for rendering and the inspector.
  const symbolFor = useMemo(() => makeSymbolResolver(() => doc.state), [doc]);
  calibrationRef.current = len => setCalibrateLength(len);

  // --- workspace UI state (persisted, §3 "intelligently remembered") -
  const savedUI = useRef(loadWorkspaceUI()).current;
  // Defaults differ by device on purpose (§11). On desktop the inspector
  // is docked beside the drawing and costs nothing, so it starts open.
  // Below desktop it OVERLAYS the drawing, so defaulting it open would
  // bury the canvas behind a sheet the moment a job is opened — the exact
  // opposite of canvas-first. Panels are still remembered per device once
  // the user chooses; this only sets the first-run state.
  const [panels, setPanels] = useState(() => {
    const w = window.innerWidth;
    // Docked panels are restored; overlay sheets are NOT. A restored
    // sheet means reopening a job and finding the drawing hidden behind
    // a panel you must dismiss before you can see your own work. A dock
    // costs no canvas, so remembering it is a convenience.
    // 768 is where the inspector starts docking (see showRightDock).
    if (w < 768) return { left: null, right: null };
    if (w < 1024) return { left: null, right: 'inspector' };
    return savedUI.panels || { left: null, right: 'inspector' };
  });
  // The component library is remembered across sessions, so opening a
  // view-only shared project could restore a docked palette of devices
  // that cannot be placed. Swap it for Layers, which is what a viewer
  // actually wants on a drawing they are reading.
  useEffect(() => {
    if (readOnly) setPanels(p => (p.left === 'library' ? { ...p, left: 'layers' } : p));
  }, [readOnly]);

  const [dockWidths, setDockWidths] = useState(savedUI.dockWidths || { left: 232, right: 264 });
  const [favourites, setFavourites] = useState(savedUI.favourites || []);
  const [recent, setRecent] = useState(savedUI.recent || []);
  const [sections, setSections] = useState(
    savedUI.sections || {
      drawing: true,
      plan: true,
      rooms: false,
      grid: true,
      display: false,
      general: true,
      electrical: true,
      switching: true,
      cost: false,
      align: true,
      actions: true,
    }
  );

  useEffect(() => {
    // Panel open/closed state is only meaningful for docks, so only a
    // desktop session writes it. Without this guard, opening the same
    // drawing on a phone (where sheets always start closed) would write
    // "all closed" back and wipe the dock layout the user set up on their
    // desktop. Favourites/recent/sections/widths are device-agnostic and
    // always persist.
    const desktop = window.innerWidth >= 1024;
    const base = { dockWidths, favourites, recent, sections };
    saveWorkspaceUI(desktop ? { ...base, panels } : { ...base, panels: savedUI.panels });
  }, [panels, dockWidths, favourites, recent, sections, savedUI.panels]);

  const toggleSection = useCallback(k => setSections(s => ({ ...s, [k]: !s[k] })), []);

  // When the window narrows past a dock's threshold, that panel would
  // silently become an overlay sheet. Two of them can end up stacked over
  // the drawing, which is not something the user asked for — they opened
  // a docked column, not a modal. So a dock that loses its dock closes.
  // Only the DOWNWARD crossing is acted on, so this never fights a sheet
  // the user deliberately opened at the narrower size.
  const prevWidthRef = useRef(breakpoint.width);
  useEffect(() => {
    const prev = prevWidthRef.current;
    const now = breakpoint.width;
    prevWidthRef.current = now;
    if (now >= prev) return;
    setPanels(p => {
      const next = { ...p };
      if (prev >= 1024 && now < 1024) next.left = null;
      if (prev >= 768 && now < 768) next.right = null;
      return next.left === p.left && next.right === p.right ? p : next;
    });
  }, [breakpoint.width]);

  // --- persistence ---------------------------------------------------
  const [projectName, setProjectName] = useState('Untitled project');
  const [saveState, setSaveState] = useState(SaveState.SAVED);
  const [saveError, setSaveError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const saveTimer = useRef(null);

  const doSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    // A viewer on a shared project saves nowhere — not locally either.
    // Production takes the same position (its save path returns early on
    // readOnlyMode): someone with view access should not end up with a
    // divergent private copy of a drawing they cannot change.
    if (readOnly) return;
    setSaveState(SaveState.SAVING);
    // A frame's delay so the "saving" state is actually observable on a
    // fast local write; without it the indicator flickers illegibly.
    requestAnimationFrame(() => {
      const payload = { ...doc.state, name: projectName };
      const res = saveProject(projectId, payload);
      if (res.ok) {
        doc.markSaved();
        setSaveState(SaveState.SAVED);
        setSaveError(null);
        setLastSavedAt(res.record.updatedAt);
      } else {
        setSaveState(SaveState.ERROR);
        setSaveError(res.error);
      }
      // Piggybacks on every local save — the 💾 button and the autosave
      // alike — so the cloud copy stays current with no separate "remember
      // to sync" step. Silent on success and only logged on failure: the
      // local save it rides on already succeeded, and autosave fires every
      // few seconds while drawing, so a toast per sync would be constant
      // noise. Writes production's record shape (see core/cloudFormat.js).
      if (cloudConfigured && getCloudState().user) {
        cloudSyncSilently(toCloudRecord({ ...payload, id: projectId }, allSymbols(payload)));
      }
    });
  }, [doc, projectId, projectName, readOnly]);

  // Load once per project.
  useEffect(() => {
    doc.setReadOnly(false); // load() must be allowed through before gating
    if (initialProject) {
      // Opened from the cloud or an organisation's shared list — already
      // converted out of the stored record, so there is nothing to read
      // from local storage.
      doc.load(initialProject);
      setProjectName(initialProject.name || 'Untitled project');
      setLastSavedAt(null);
    } else {
      const rec = loadProject(projectId);
      if (rec && rec.drawing) {
        // Records saved before the Phase 0 model change are flat drawings;
        // migrate rather than orphan them (the redesign has been shared for
        // testing, so such records exist in the wild).
        doc.load(migrateLoadedProject(rec.drawing));
        setProjectName(rec.name || rec.drawing.name || 'Untitled project');
        setLastSavedAt(rec.updatedAt);
      } else {
        doc.load(emptyProject());
      }
    }
    doc.setReadOnly(!!readOnly);
    setSaveState(SaveState.SAVED);
    // Opening a drawing resets view ownership, so it gets auto-framed
    // again (and stays framed while the layout settles) until this user
    // pans or zooms it themselves.
    viewTouchedRef.current = false;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Debounced autosave, driven by real document mutations.
  useEffect(() => {
    return doc.subscribe((_, detail) => {
      rerender();
      if (!detail || detail.type === 'saved' || detail.type === 'load') return;
      // Editing counts as taking control of the view (see viewTouchedRef).
      viewTouchedRef.current = true;
      setSaveState(SaveState.UNSAVED);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(doSave, AUTOSAVE_MS);
    });
  }, [doc, doSave, rerender]);

  // Renaming is a document-level change too — it marks unsaved and
  // autosaves like any other edit, rather than silently not persisting.
  const renameProject = useCallback(
    name => {
      setProjectName(name);
      setSaveState(SaveState.UNSAVED);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(doSave, AUTOSAVE_MS);
    },
    [doSave]
  );

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Warn before losing unsaved work on tab close (§17).
  useEffect(() => {
    const onBeforeUnload = e => {
      if (doc.isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [doc]);

  // --- view helpers --------------------------------------------------
  /**
   * Frame everything in the drawing — devices AND the floor plan. Fitting
   * to devices alone meant that importing a plan into an empty drawing
   * left it half off-screen, because there were no objects to frame.
   */
  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp.width || !vp.height) return;
    const d = doc.state;
    const fl = currentPlan(d);
    // A civil plan has no devices to frame — its content is pits, poles,
    // entries and the vertices of its runs.
    let b = boundsOf(d.activePlanType === 'civil' ? civilPoints(fl) : fl.objects);
    if (fl.planImage) {
      const s = fl.planImage.scale || 1;
      const px1 = fl.planImage.x,
        py1 = fl.planImage.y;
      const px2 = px1 + fl.planImage.width * s,
        py2 = py1 + fl.planImage.height * s;
      b = b
        ? {
            minX: Math.min(b.minX, px1),
            minY: Math.min(b.minY, py1),
            maxX: Math.max(b.maxX, px2),
            maxY: Math.max(b.maxY, py2),
          }
        : { minX: px1, minY: py1, maxX: px2, maxY: py2 };
      b.cx = (b.minX + b.maxX) / 2;
      b.cy = (b.minY + b.maxY) / 2;
    }
    setView(viewForBounds(b, vp.width, vp.height));
  }, [doc, setView]);

  const zoomToSelection = useCallback(() => {
    const vp = viewportRef.current;
    const sel = controller.selectedObjects();
    if (!sel.length || !vp.width) return;
    setView(viewForBounds(boundsOf(sel), vp.width, vp.height, 120));
  }, [controller, setView]);

  const onViewportChange = useCallback(
    size => {
      viewportRef.current = size;
      // Re-frame on every layout change until the user takes over the view.
      // This is what makes the initial fit correct without guessing when
      // layout settles: an early stub measurement simply gets superseded by
      // the next, real one.
      if (!viewTouchedRef.current) fit();
    },
    [fit]
  );

  // --- panels --------------------------------------------------------
  const togglePanel = useCallback((slot, value) => {
    setPanels(p => ({ ...p, [slot]: p[slot] === value ? null : value }));
  }, []);

  // Linking is done ON the plan, so arming it from the inspector has to
  // get the inspector out of the way — but only where it is an overlay.
  // On a desktop dock it costs no canvas, and closing it there would
  // throw away the panel the user is working in. 768 is the same
  // breakpoint the dock itself uses (showRightDock).
  const startLinking = useCallback(
    (switchId, newGroup) => {
      controller.startLinking(switchId, newGroup);
      if (window.innerWidth < 768) setPanels(p => ({ ...p, right: null }));
    },
    [controller]
  );

  const onDockResize = useCallback((slot, clientX) => {
    setDockWidths(w => {
      // Left dock sits after a 44px rail; right dock is measured from the
      // window edge. Both clamped so a panel can't be dragged to nothing
      // (use the collapse toggle for that) or swallow the canvas.
      const next =
        slot === 'left'
          ? Math.max(180, Math.min(420, clientX - 44))
          : Math.max(200, Math.min(460, window.innerWidth - clientX));
      return { ...w, [slot]: next };
    });
  }, []);

  // --- floor plan import ----------------------------------------------
  const fileInputRef = useRef(null);

  const importPlan = useCallback(() => {
    fileInputRef.current && fileInputRef.current.click();
  }, []);

  const onPlanFile = useCallback(
    e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // allow re-picking the same file
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        pushToast('That file is not an image', 'error');
        return;
      }
      // 8MB guard: localStorage tops out around 5–10MB, and a plan larger
      // than this will fail the save rather than the import, which is a far
      // more confusing place to discover the problem.
      if (file.size > 8 * 1024 * 1024) {
        pushToast('Plan is too large — under 8 MB, please', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => pushToast('Could not read that file', 'error');
      reader.onload = () => {
        const src = String(reader.result);
        const probe = new Image();
        probe.onerror = () => pushToast('That image could not be opened', 'error');
        probe.onload = () => {
          doc.commit('Import floor plan', d => {
            // Centre the plan on the origin so it lands somewhere sensible
            // rather than off in a corner the user has to hunt for.
            currentPlan(d).planImage = {
              src,
              width: probe.width,
              height: probe.height,
              x: -probe.width / 2,
              y: -probe.height / 2,
              scale: 1,
              opacity: 0.85,
            };
          });
          setTimeout(() => fit(), 40);
          pushToast('Floor plan imported');
        };
        probe.src = src;
      };
      reader.readAsDataURL(file);
    },
    [doc, fit, pushToast]
  );

  const startCalibrate = useCallback(() => {
    controller.setTool('calibrate');
    // On a narrow screen the inspector overlays the drawing, and you
    // cannot click two points on something you can't see.
    if (breakpoint.width < 768) setPanels(p => ({ ...p, right: null }));
  }, [controller, breakpoint]);

  const applyCalibration = useCallback(
    realMm => {
      if (!calibrateLength || !(realMm > 0)) return;
      doc.commit('Set scale', d => {
        // Production semantics: world units per METRE (see geometry.js).
        // Calibrates whichever plan is on screen — a site plan has its own
        // scale, and calibrating it must not touch the floor plan's.
        const target = d.activePlanType === 'civil' ? currentCivilPlan(d) : currentFloor(d);
        target.scale = calibrateLength / (realMm / 1000);
      });
      setCalibrateLength(null);
      controller.clearMeasure();
      controller.setTool('select');
      pushToast('Scale set');
    },
    [calibrateLength, doc, controller, pushToast]
  );

  const noteRecent = useCallback(symbolId => {
    setRecent(r => [symbolId, ...r.filter(x => x !== symbolId)].slice(0, 6));
  }, []);

  const toggleFavourite = useCallback(id => {
    setFavourites(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id].slice(0, 12)));
  }, []);

  // Track placements for the "Recent" row.
  const lastSymbolRef = useRef(null);
  useEffect(() => {
    if (controller.activeSymbolId && controller.activeSymbolId !== lastSymbolRef.current) {
      lastSymbolRef.current = controller.activeSymbolId;
      noteRecent(controller.activeSymbolId);
    }
  });

  // --- command registry ----------------------------------------------
  const registry = useMemo(() => {
    const r = createCommandRegistry();
    // "Something is selected" has to include cables/walls/dimensions, not
    // just devices — they select independently (production keeps a
    // separate selectedCableId for the same reason). Without this, Delete
    // is greyed out and its shortcut silently does nothing while a cable
    // is visibly selected.
    const hasSel = c => c.controller.selectedIds.size > 0 || !!c.controller.selectedSegment;
    // Device-only: align/distribute operate on device positions and have
    // no meaning for a segment, so these stay strictly device selection.
    const hasMulti = c => c.controller.selectedIds.size > 1;
    // Civil selection is a single object of one of five kinds, held in
    // its own state rather than the electrical selection set.
    const hasCivilSel = c => {
      const s = c.controller.civilSelection || {};
      return !!(s.pitId || s.buildingEntryId || s.poleId || s.conduitId || s.overheadRunId);
    };

    r.registerAll([
      // Tools
      {
        id: 'tool.select',
        title: 'Select tool',
        group: 'Tools',
        shortcut: 'V',
        icon: '⌖',
        keywords: 'arrow pointer pick',
        run: c => c.controller.setTool('select'),
      },
      {
        id: 'tool.pan',
        title: 'Pan tool',
        group: 'Tools',
        shortcut: 'H',
        icon: '✋',
        keywords: 'hand scroll move view',
        run: c => c.controller.setTool('pan'),
      },
      {
        id: 'tool.measure',
        title: 'Measure tool',
        group: 'Tools',
        shortcut: 'M',
        icon: '↔',
        keywords: 'distance dimension ruler',
        run: c => c.controller.setTool('measure'),
      },
      {
        id: 'tool.calibrate',
        title: 'Calibrate scale',
        group: 'Tools',
        shortcut: 'C',
        icon: '⚖',
        keywords: 'scale real units mm metres set',
        run: c => c.startCalibrate(),
      },
      // W goes to the cable tool, not the wall tool, on frequency: cable
      // runs are drawn constantly, walls are traced once at the start of a
      // job. `R` would be the better mnemonic for "run", but CLAUDE.md
      // reserves it for repeat-placement, so it's left alone.
      {
        id: 'tool.cable',
        title: 'Cable route tool',
        group: 'Tools',
        shortcut: 'W',
        icon: '⌇',
        keywords: 'cable run wire route tps circuit line',
        run: c => c.controller.setTool('cable'),
      },
      {
        id: 'tool.wall',
        title: 'Wall tool',
        group: 'Tools',
        shortcut: 'Shift+W',
        icon: '▬',
        keywords: 'wall architecture outline trace',
        run: c => c.controller.setTool('wall'),
      },
      {
        id: 'tool.dimension',
        title: 'Dimension tool',
        group: 'Tools',
        shortcut: 'D',
        icon: '⟺',
        keywords: 'dimension annotate length measurement permanent',
        run: c => c.controller.setTool('dimension'),
      },
      {
        id: 'tool.link',
        title: 'Link switch to lights',
        group: 'Tools',
        // K, not L: L already opens the Layers panel, and a tool quietly
        // shadowing an existing shortcut is exactly the kind of drift the
        // single command registry exists to prevent.
        shortcut: 'K',
        icon: '⚯',
        keywords: 'link switch light bank gang two-way control switching',
        run: c => c.controller.setTool('link'),
      },
      {
        id: 'view.switchRuns',
        title: 'Show all switch runs',
        group: 'View',
        icon: '⚯',
        keywords: 'switch runs banks lighting show all wiring',
        run: c => {
          const on = c.controller.toggleSwitchRuns();
          c.pushToast(on ? 'Showing all switch runs' : 'Switch runs follow the selection');
        },
      },

      // Plan
      {
        id: 'plan.import',
        title: 'Import floor plan',
        group: 'Plan',
        icon: '⇧',
        keywords: 'background image trace pdf png jpg underlay',
        run: c => c.importPlan(),
      },
      {
        id: 'plan.remove',
        title: 'Remove floor plan',
        group: 'Plan',
        icon: '⌫',
        danger: true,
        keywords: 'delete background underlay',
        when: c => !!currentPlan(c.doc.state).planImage,
        run: c =>
          c.doc.commit('Remove plan', d => {
            currentPlan(d).planImage = null;
          }),
      },

      // Edit
      {
        id: 'edit.undo',
        title: 'Undo',
        group: 'Edit',
        shortcut: 'Mod+Z',
        icon: '↶',
        keywords: 'revert back',
        when: c => c.doc.canUndo,
        run: c => {
          c.doc.undo();
          c.controller.clearSelection();
        },
      },
      {
        id: 'edit.redo',
        title: 'Redo',
        group: 'Edit',
        shortcut: 'Mod+Shift+Z',
        icon: '↷',
        keywords: 'forward again',
        when: c => c.doc.canRedo,
        run: c => c.doc.redo(),
      },
      {
        id: 'edit.duplicate',
        title: 'Duplicate',
        group: 'Edit',
        shortcut: 'Mod+D',
        icon: '⧉',
        keywords: 'copy clone',
        when: hasSel,
        run: c => c.controller.duplicateSelected(),
      },
      {
        id: 'edit.delete',
        title: 'Delete',
        group: 'Edit',
        shortcut: 'Delete',
        icon: '⌫',
        keywords: 'remove erase',
        danger: true,
        // In civil mode this deletes whatever civil object is selected;
        // the key and the command stay the same because the user does not
        // think of them as two different deletes.
        when: c => (c.controller.isCivilMode ? hasCivilSel(c) : hasSel(c)),
        run: c =>
          c.controller.isCivilMode
            ? c.controller.deleteCivilSelection()
            : c.controller.deleteSelected(),
      },
      {
        id: 'edit.selectAll',
        title: 'Select all',
        group: 'Edit',
        shortcut: 'Mod+A',
        icon: '⬚',
        keywords: 'everything',
        run: c => c.controller.selectAll(),
      },
      {
        id: 'edit.deselect',
        title: 'Deselect',
        group: 'Edit',
        shortcut: 'Escape',
        keywords: 'clear selection none',
        when: hasSel,
        run: c => c.controller.clearSelection(),
      },

      // Arrange
      {
        id: 'arrange.alignLeft',
        title: 'Align left',
        group: 'Arrange',
        icon: '⇤',
        when: hasMulti,
        run: c => c.controller.alignSelected('left'),
      },
      {
        id: 'arrange.alignRight',
        title: 'Align right',
        group: 'Arrange',
        icon: '⇥',
        when: hasMulti,
        run: c => c.controller.alignSelected('right'),
      },
      {
        id: 'arrange.alignTop',
        title: 'Align top',
        group: 'Arrange',
        icon: '⤒',
        when: hasMulti,
        run: c => c.controller.alignSelected('top'),
      },
      {
        id: 'arrange.alignBottom',
        title: 'Align bottom',
        group: 'Arrange',
        icon: '⤓',
        when: hasMulti,
        run: c => c.controller.alignSelected('bottom'),
      },
      {
        id: 'arrange.distributeH',
        title: 'Distribute horizontally',
        group: 'Arrange',
        icon: '⇹',
        when: c => c.controller.selectedIds.size > 2,
        run: c => c.controller.distributeSelected('h'),
      },
      {
        id: 'arrange.distributeV',
        title: 'Distribute vertically',
        group: 'Arrange',
        icon: '⇳',
        when: c => c.controller.selectedIds.size > 2,
        run: c => c.controller.distributeSelected('v'),
      },

      // View
      {
        id: 'view.fit',
        title: 'Fit drawing to screen',
        group: 'View',
        shortcut: 'Shift+F',
        icon: '⛶',
        keywords: 'zoom extents all',
        run: c => c.fit(),
      },
      {
        id: 'view.zoomSelection',
        title: 'Zoom to selection',
        group: 'View',
        shortcut: 'Shift+2',
        icon: '⊙',
        keywords: 'focus',
        when: hasSel,
        run: c => c.zoomToSelection(),
      },
      {
        id: 'view.zoomIn',
        title: 'Zoom in',
        group: 'View',
        icon: '+',
        run: c => c.controller.zoomBy(1.2),
      },
      {
        id: 'view.zoomOut',
        title: 'Zoom out',
        group: 'View',
        icon: '−',
        run: c => c.controller.zoomBy(1 / 1.2),
      },
      {
        id: 'view.toggleSnap',
        title: 'Toggle snapping',
        group: 'View',
        shortcut: 'Shift+S',
        icon: '⌗',
        keywords: 'grid align magnet',
        run: c =>
          c.doc.commit('Toggle snapping', d => {
            const f = currentPlan(d);
            f.snapEnabled = f.snapEnabled === false;
          }),
      },

      // Panels
      {
        id: 'panel.layers',
        title: 'Toggle layers panel',
        group: 'Panels',
        shortcut: 'L',
        icon: '▤',
        keywords: 'visibility lock',
        run: c => c.togglePanel('left', 'layers'),
      },
      {
        id: 'panel.circuits',
        title: 'Toggle circuits panel',
        group: 'Panels',
        shortcut: 'Shift+C',
        icon: '◎',
        keywords: 'circuit board protection breaker rcbo assign',
        run: c => c.togglePanel('left', 'circuits'),
      },
      {
        id: 'panel.comms',
        title: 'Toggle comms racks panel',
        group: 'Panels',
        icon: '⌸',
        keywords: 'comms data rack port patch panel home run cat6',
        run: c => c.togglePanel('left', 'comms'),
      },
      {
        id: 'circuit.add',
        title: 'New circuit',
        group: 'Circuits',
        icon: '＋',
        keywords: 'circuit add create board protection',
        run: c => c.openCircuitDialog(null),
      },
      {
        id: 'plan.toggleCivil',
        title: 'Switch between electrical and civil',
        group: 'Plans',
        shortcut: 'Shift+U',
        icon: '⛏',
        keywords: 'civil underground site plan mode electrical switch toggle',
        run: c => {
          const toCivil = !c.controller.isCivilMode;
          c.controller.setPlanType(toCivil ? 'civil' : 'floor');
          c.pushToast(toCivil ? 'Civil / underground plan' : 'Electrical plan');
        },
      },
      {
        id: 'panel.civil',
        title: 'Toggle civil palette',
        group: 'Panels',
        icon: '⛏',
        keywords: 'civil palette pit conduit pole overhead entry',
        when: c => c.controller.isCivilMode,
        run: c => c.togglePanel('left', 'civil'),
      },
      {
        id: 'panel.civilPlans',
        title: 'Toggle site plans panel',
        group: 'Panels',
        icon: '▤',
        keywords: 'civil site plans multiple lot street staged',
        when: c => c.controller.isCivilMode,
        run: c => c.togglePanel('left', 'civilPlans'),
      },
      {
        id: 'civil.addPlan',
        title: 'New site plan',
        group: 'Plans',
        icon: '＋',
        keywords: 'civil site plan add new underground',
        run: c => {
          c.controller.setPlanType('civil');
          c.controller.addCivilPlan();
          c.pushToast('Site plan added');
        },
      },
      {
        id: 'report.civilMaterials',
        title: 'Civil materials takeoff',
        group: 'Reports',
        icon: '⛏',
        keywords: 'civil materials takeoff pit conduit pole overhead legend',
        run: c => c.openCivilMaterials(),
      },
      {
        id: 'report.quote',
        title: 'Quote',
        group: 'Reports',
        icon: '$',
        keywords: 'quote price total materials labour margin gst estimate',
        run: c => c.openQuote(),
      },
      {
        id: 'report.priceList',
        title: 'Price list',
        group: 'Reports',
        icon: '☰',
        keywords: 'price list device library cost labour watts rates',
        run: c => c.openPriceList(),
      },
      {
        id: 'report.panelSchedule',
        title: 'Panel schedule',
        group: 'Reports',
        icon: '▦',
        keywords: 'panel schedule board load demand amps protection cable run',
        run: c => c.openPanelSchedule(),
      },
      {
        id: 'report.elevations',
        title: 'Elevations',
        group: 'Reports',
        icon: '▯',
        keywords: 'elevation wall view height mounting schematic',
        run: c => c.openElevations(),
      },
      {
        id: 'export.printPdf',
        title: 'Print / PDF export',
        group: 'Export',
        icon: '🖨',
        keywords: 'print pdf export save takeoff handoff document civil pages',
        run: c => c.openPrintExport(),
      },
      {
        id: 'export.projectJson',
        title: 'Download project copy (JSON)',
        group: 'Export',
        icon: '⬇',
        keywords: 'download json backup copy export project',
        run: c => c.downloadProjectCopy(),
      },
      {
        id: 'account.open',
        title: 'Account',
        group: 'Account',
        icon: '◍',
        keywords: 'account profile sign out log out email name cloud',
        when: () => cloudConfigured,
        run: c => c.openAccount(),
      },
      {
        id: 'app.reportProblem',
        title: 'Report a problem',
        group: 'Account',
        icon: '⚑',
        keywords: 'report bug problem feedback support issue',
        run: c => c.openReportProblem(),
      },
      {
        id: 'circuit.assign',
        title: 'Assign selection to a circuit',
        group: 'Circuits',
        icon: '⌁',
        keywords: 'circuit assign devices selection',
        when: hasSel,
        run: c => c.openAssignCircuit(),
      },
      {
        id: 'view.circuitLabels',
        title: 'Show circuit labels',
        group: 'View',
        icon: '⌗',
        keywords: 'circuit label id stamp plan',
        run: c => {
          const on = c.controller.toggleCircuitLabels();
          c.pushToast(on ? 'Circuit labels on' : 'Circuit labels off');
        },
      },
      {
        id: 'view.clearIsolate',
        title: 'Stop isolating circuit',
        group: 'View',
        icon: '◍',
        keywords: 'isolate circuit clear show all',
        when: c => !!c.controller.isolatedCircuitId,
        run: c => c.controller.toggleIsolatedCircuit(c.controller.isolatedCircuitId),
      },
      {
        id: 'panel.library',
        title: 'Toggle component library',
        group: 'Panels',
        shortcut: 'P',
        icon: '⊞',
        keywords: 'place device symbol add',
        run: c => c.togglePanel('left', 'library'),
      },
      {
        id: 'panel.inspector',
        title: 'Toggle properties panel',
        group: 'Panels',
        shortcut: 'I',
        icon: '☰',
        keywords: 'inspector details',
        run: c => c.togglePanel('right', 'inspector'),
      },

      // Drawing organisation
      {
        id: 'room.add',
        title: 'Add room',
        group: 'Drawing',
        icon: '▭',
        keywords: 'room area zone kitchen group takeoff',
        run: c => c.openRoomDialog(),
      },
      {
        id: 'room.assignSelection',
        title: 'Assign selection to room…',
        group: 'Drawing',
        icon: '▭',
        keywords: 'room assign group bulk',
        // Only meaningful with devices selected AND somewhere to put them.
        when: c =>
          c.controller.selectedIds.size > 0 && (currentFloor(c.doc.state).rooms || []).length > 0,
        run: c => c.openAssignRoom(),
      },
      {
        id: 'library.addFitting',
        title: 'Add custom fitting',
        group: 'Drawing',
        icon: '✚',
        keywords: 'custom device symbol fitting library new',
        run: c => c.openFittingDialog(),
      },
      {
        id: 'project.history',
        title: 'Version history',
        group: 'Project',
        icon: '21ba',
        keywords: 'history versions snapshot revert restore timeline',
        run: c => c.openHistory(),
      },
      {
        id: 'tools.findDuplicates',
        title: 'Find stacked duplicates',
        group: 'Drawing',
        icon: '⧉',
        keywords: 'duplicate stacked overlap cleanup audit qa',
        run: c => c.openDuplicates(),
      },

      // Project
      {
        id: 'project.save',
        title: 'Save',
        group: 'Project',
        shortcut: 'Mod+S',
        icon: '⤓',
        keywords: 'store write',
        run: c => c.doSave(),
      },
      {
        id: 'project.close',
        title: 'Close drawing',
        group: 'Project',
        icon: '←',
        keywords: 'back exit projects',
        run: c => c.onExit(),
      },

      // App
      {
        id: 'app.palette',
        title: 'Command palette',
        group: 'App',
        shortcut: 'Mod+K',
        icon: '⌘',
        keywords: 'search commands actions',
        run: c => c.openPalette(),
      },
    ]);
    return r;
  }, []);

  // Context object handed to every command's `when` and `run`.
  const ctx = useMemo(
    () => ({
      doc,
      controller,
      fit,
      zoomToSelection,
      togglePanel,
      doSave,
      onExit,
      importPlan,
      startCalibrate,
      openPalette: () => setPaletteOpen(true),
      openRoomDialog: () => setRoomDialogOpen(true),
      openFittingDialog: () => setFittingDialogOpen(true),
      openAssignRoom: () => setAssignRoomOpen(true),
      openDuplicates: () => setDuplicateGroups(findDuplicateDevices(doc.state)),
      openHistory: () => setHistoryOpen(true),
      openCircuitDialog: id => setCircuitDialog({ id: id || null }),
      openAssignCircuit: () => setAssignCircuitOpen(true),
      openPanelSchedule: () => setPanelScheduleOpen(true),
      openQuote: () => setQuoteOpen(true),
      openPriceList: () => setPriceListOpen(true),
      openCivilMaterials: () => setCivilMaterialsOpen(true),
      openElevations: () => setElevationsOpen(true),
      openReportProblem: () => setReportOpen(true),
      openAccount: () => setAccountOpen(true),
      openPrintExport: () => setPrintExportOpen(true),
      downloadProjectCopy: () => {
        const record = toCloudRecord(doc.state, allSymbols(doc.state));
        const blob = new Blob([JSON.stringify(record)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = jsonFileName(doc.state.name);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        pushToast('Downloaded a copy of "' + (doc.state.name || 'project') + '"');
      },
      pushToast,
    }),
    [
      doc,
      controller,
      fit,
      zoomToSelection,
      togglePanel,
      doSave,
      onExit,
      importPlan,
      startCalibrate,
      pushToast,
    ]
  );

  // --- keyboard layer (§10) ------------------------------------------
  useEffect(() => {
    function onKeyDown(e) {
      // Palette first: Mod+K must work even while a field has focus, or
      // it stops being a universal entry point.
      if (matchesShortcut(e, 'Mod+K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
        return;
      }
      if (paletteOpen) return; // palette owns its own keys
      if (isTypingTarget(document.activeElement)) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        controller.setSpaceHeld(true);
        return;
      }

      // Escape backs out of the current mode before clearing selection —
      // one predictable "get me out of here" key (§10).
      // Enter finishes a multi-point run that is not landing on anything —
      // a polyline has no natural end, so it needs an explicit one.
      if (e.key === 'Enter' && (controller.conduitDraft || controller.overheadDraft)) {
        controller.finishRunDraft();
        e.preventDefault();
        return;
      }

      if (e.key === 'Escape') {
        // A half-drawn civil run is the same kind of "I started something"
        // state as a half-drawn cable, and unwinds first for the same
        // reason: a mis-clicked start point should not also cost the tool.
        if (controller.cancelRunDraft()) return;
        // Escape unwinds one step at a time rather than dumping the user
        // straight back to Select: cancel the half-drawn segment first,
        // so a mis-clicked start point doesn't also cost you the tool.
        // cancelDraft also clears a half-made switch link, which is the
        // same kind of "I started something" state.
        if (controller.draft || controller.linkPendingSwitch) {
          controller.cancelDraft();
          return;
        }
        if (controller.tool !== 'select') {
          controller.setTool('select');
          return;
        }
        if (controller.selectedIds.size) {
          controller.clearSelection();
          return;
        }
        if (controller.selectedSegment) {
          controller.clearSegmentSelection();
          return;
        }
        if (controller.isCivilMode) controller.clearCivilSelection();
        return;
      }

      // Arrow-key nudging: 1 grid step, or 1 unit with Alt for fine work.
      if (e.key.startsWith('Arrow') && controller.selectedIds.size) {
        const step = e.altKey ? 1 : gridWorldUnits(currentPlan(doc.state));
        const d = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[e.key];
        if (d) {
          e.preventDefault();
          controller.nudgeSelected(d[0], d[1]);
          return;
        }
      }

      for (const cmd of registry.all()) {
        if (cmd.shortcut && matchesShortcut(e, cmd.shortcut)) {
          if (!cmd.when(ctx)) return;
          e.preventDefault();
          cmd.run(ctx);
          return;
        }
      }
    }
    function onKeyUp(e) {
      if (e.code === 'Space') controller.setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [registry, ctx, controller, doc, paletteOpen]);

  // --- layer counts for the panel -------------------------------------
  const layerCounts = useMemo(() => {
    const counts = {};
    for (const o of currentFloor(doc.state).objects) {
      const s = symbolFor(o.symbolId);
      if (s) counts[s.category] = (counts[s.category] || 0) + 1;
    }
    return counts;
  }, [doc.state]);

  const leftPanel =
    panels.left === 'layers' ? (
      <LayersPanel doc={doc} controller={controller} counts={layerCounts} />
    ) : panels.left === 'library' ? (
      <LibraryPanel
        project={doc.state}
        controller={controller}
        favourites={favourites}
        recent={recent}
        onToggleFavourite={toggleFavourite}
        autoFocus={breakpoint.name === 'desktop'}
        onAddFitting={() => setFittingDialogOpen(true)}
      />
    ) : panels.left === 'civil' ? (
      <CivilPalette
        controller={controller}
        onArmed={() => {
          // 1024 is where the left panel stops being an overlay (see
          // showLeftDock in Workspace).
          if (window.innerWidth < 1024) setPanels(p => ({ ...p, left: null }));
        }}
      />
    ) : panels.left === 'civilPlans' ? (
      <CivilPlansPanel doc={doc} controller={controller} />
    ) : panels.left === 'comms' ? (
      <CommsPanel
        doc={doc}
        controller={controller}
        onSelectDevice={id => {
          controller.select([id]);
          zoomToSelection();
        }}
      />
    ) : panels.left === 'circuits' ? (
      <CircuitsPanel
        doc={doc}
        controller={controller}
        onAddCircuit={() => setCircuitDialog({ id: null })}
        onEditCircuit={id => setCircuitDialog({ id })}
      />
    ) : null;

  const rightPanel = (
    <Inspector
      doc={doc}
      controller={controller}
      sections={sections}
      toggleSection={toggleSection}
      onImportPlan={importPlan}
      onCalibrate={startCalibrate}
      onAddRoom={() => setRoomDialogOpen(true)}
      onStartLinking={startLinking}
    />
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onPlanFile}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="flex h-full flex-col">
        {readOnly && <ReadOnlyBanner sharedByName={sharedByName} />}
        <div className="min-h-0 flex-1">
          <Workspace
            doc={doc}
            controller={controller}
            view={viewRef.current}
            registry={registry}
            ctx={ctx}
            symbolFor={symbolFor}
            projectName={projectName}
            onRenameProject={renameProject}
            onExit={onExit}
            saveState={saveState}
            saveError={saveError}
            lastSavedAt={lastSavedAt}
            onSave={doSave}
            panels={panels}
            onTogglePanel={togglePanel}
            dockWidths={dockWidths}
            onDockResize={onDockResize}
            leftPanelContent={leftPanel}
            rightPanelContent={rightPanel}
            leftPanelTitle={
              panels.left === 'layers'
                ? 'Layers'
                : panels.left === 'circuits'
                  ? 'Circuits'
                  : panels.left === 'comms'
                    ? 'Comms racks'
                    : panels.left === 'civil'
                      ? 'Civil palette'
                      : panels.left === 'civilPlans'
                        ? 'Site plans'
                        : 'Components'
            }
            rightPanelTitle={inspectorTitle(controller)}
            onFit={fit}
            onViewportChange={onViewportChange}
            onContextMenu={setContextMenu}
            breakpoint={breakpoint}
            readOnly={!!readOnly}
          />
        </div>
      </div>
      <CanvasContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        registry={registry}
        ctx={ctx}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        registry={registry}
        ctx={ctx}
      />
      <CalibrateDialog
        length={calibrateLength}
        onCancel={() => {
          setCalibrateLength(null);
          controller.clearMeasure();
        }}
        onApply={applyCalibration}
      />
      {civilMaterialsOpen && (
        <CivilMaterialsDialog
          doc={doc}
          symbolFor={symbolFor}
          onClose={() => setCivilMaterialsOpen(false)}
          onExport={(plan, schedule, legend) =>
            setExportText({
              title: 'Civil materials — select and copy',
              text: civilMaterialsText(doc.state, plan, schedule, legend),
            })
          }
        />
      )}
      {quoteOpen && (
        <QuoteDialog
          doc={doc}
          controller={controller}
          symbolFor={symbolFor}
          onClose={() => setQuoteOpen(false)}
          onOpenPriceList={() => setPriceListOpen(true)}
          onExport={itemized =>
            setExportText({
              title: 'Quote summary — select and copy',
              text: quoteText(doc.state, symbolFor, itemized, c =>
                resolveSwitchboardLabel(doc.state, c)
              ),
            })
          }
        />
      )}
      {priceListOpen && (
        <PriceListDialog
          doc={doc}
          controller={controller}
          onClose={() => setPriceListOpen(false)}
        />
      )}
      {panelScheduleOpen && (
        <PanelScheduleDialog
          doc={doc}
          controller={controller}
          symbolFor={symbolFor}
          onClose={() => setPanelScheduleOpen(false)}
          onExport={boards =>
            setExportText({
              title: 'Panel schedule — select and copy',
              text: panelScheduleText(doc.state, boards, doc.state.boardMainSwitchAmps),
            })
          }
        />
      )}
      {elevationsOpen && (
        <ElevationsDialog
          doc={doc}
          controller={controller}
          symbolFor={symbolFor}
          onClose={() => setElevationsOpen(false)}
          pushToast={pushToast}
        />
      )}
      {printExportOpen && (
        <PrintExportDialog
          doc={doc}
          controller={controller}
          symbolFor={symbolFor}
          projectName={projectName}
          onClose={() => setPrintExportOpen(false)}
          pushToast={pushToast}
        />
      )}
      <ReportProblemDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        projectName={projectName}
        pushToast={pushToast}
      />
      <AccountDialog
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        pushToast={pushToast}
      />
      {exportText && (
        <ExportTextDialog
          title={exportText.title}
          text={exportText.text}
          onClose={() => setExportText(null)}
        />
      )}
      {circuitDialog && (
        <CircuitDialog
          circuit={
            circuitDialog.id
              ? (doc.state.circuits || []).find(c => c.id === circuitDialog.id)
              : null
          }
          boards={findBoardObjects(doc.state)}
          onCancel={() => setCircuitDialog(null)}
          onSubmit={fields => {
            if (circuitDialog.id) {
              controller.updateCircuit(circuitDialog.id, fields);
              pushToast('Circuit ' + circuitDialog.id + ' updated');
            } else if (controller.addCircuit(fields)) {
              pushToast('Circuit ' + fields.id + ' added');
            } else {
              pushToast('A circuit called ' + fields.id + ' already exists', 'error');
              return;
            }
            setCircuitDialog(null);
          }}
          onDelete={() => {
            controller.deleteCircuit(circuitDialog.id);
            pushToast('Circuit ' + circuitDialog.id + ' deleted — its devices are unassigned');
            setCircuitDialog(null);
          }}
        />
      )}
      {roomDialogOpen && (
        <RoomDialog
          onCancel={() => setRoomDialogOpen(false)}
          onCreate={name => {
            controller.addRoom(name);
            setRoomDialogOpen(false);
            pushToast('Room "' + name + '" added');
          }}
        />
      )}
      {assignCircuitOpen && (
        <AssignCircuitDialog
          circuits={doc.state.circuits || []}
          count={controller.selectedIds.size}
          onCancel={() => setAssignCircuitOpen(false)}
          onAssign={circuitId => {
            controller.assignCircuit([...controller.selectedIds], circuitId);
            setAssignCircuitOpen(false);
            pushToast(circuitId ? 'Assigned to ' + circuitId : 'Circuit cleared');
          }}
        />
      )}
      {assignRoomOpen && (
        <AssignRoomDialog
          rooms={currentFloor(doc.state).rooms || []}
          count={controller.selectedIds.size}
          onCancel={() => setAssignRoomOpen(false)}
          onAssign={roomId => {
            controller.assignSelectionToRoom(roomId);
            setAssignRoomOpen(false);
          }}
        />
      )}
      {historyOpen && (
        <HistoryDialog
          entries={doc.history()}
          onCancel={() => setHistoryOpen(false)}
          onJump={i => {
            doc.jumpTo(i);
            controller.clearSelection();
            setHistoryOpen(false);
          }}
        />
      )}
      {duplicateGroups && (
        <DuplicatesDialog
          groups={duplicateGroups}
          symbolFor={symbolFor}
          onCancel={() => setDuplicateGroups(null)}
          onRemove={() => {
            const n = controller.removeDuplicates(duplicateGroups);
            setDuplicateGroups(null);
            pushToast(n + ' duplicate' + (n === 1 ? '' : 's') + ' removed');
          }}
        />
      )}
      {fittingDialogOpen && (
        <CustomFittingDialog
          onCancel={() => setFittingDialogOpen(false)}
          onCreate={form => {
            const layer = LAYER_DEFS.find(l => l.id === form.category);
            const sym = controller.addCustomSymbol(form, layer && layer.color);
            setFittingDialogOpen(false);
            if (sym) pushToast('"' + sym.label + '" added to your fittings');
          }}
        />
      )}
    </>
  );
}

/**
 * Asks what the just-measured span really is. Offers metres as well as
 * millimetres because plans get dimensioned both ways and making the
 * user convert in their head is exactly the kind of friction §29 is
 * about.
 */
function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  return Math.round(m / 60) + 'h ago';
}

/**
 * Version history — jump to any point, not just one step back.
 *
 * Labelled by what changed ("Place device", "Draw cable") rather than
 * only by time, because "14:32:07" tells you nothing about which state
 * you're about to restore. Newest first, since recent points are the
 * ones people actually reach for.
 */
function HistoryDialog({ entries, onCancel, onJump }) {
  return (
    <Dialog open onClose={onCancel} title="Version history" width="max-w-md">
      <p className="mb-3 text-sm leading-relaxed text-ink-600">
        Every change in this session. Jumping here doesn’t discard anything — you can jump forward
        again until you make a new edit.
      </p>
      <div className="max-h-72 overflow-y-auto rounded-md border border-ink-200">
        {entries
          .slice()
          .reverse()
          .map((e, i) => (
            <button
              key={e.index}
              disabled={e.current}
              onClick={() => onJump(e.index)}
              className={
                'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ' +
                (i > 0 ? 'border-t border-ink-100 ' : '') +
                (e.current ? 'bg-accent-50' : 'hover:bg-ink-50')
              }
            >
              <span className="w-3 shrink-0 text-center text-2xs text-ink-400">
                {e.current ? '●' : '↺'}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{e.label}</span>
              <span className="tnum shrink-0 text-2xs text-ink-400">
                {e.current ? 'Current' : timeAgo(e.ts)}
              </span>
            </button>
          ))}
      </div>
    </Dialog>
  );
}

/**
 * Bulk room assignment for a multi-selection. Separate from the
 * single-device inspector field because assigning twelve GPOs to
 * "Kitchen" one at a time is exactly the kind of friction §29 targets.
 */

/**
 * Bulk circuit assignment. Separate from the room version because the
 * consequence is different: assigning a switch to a circuit propagates
 * to the lights it controls, so the dialog says so rather than letting
 * the user discover it afterwards.
 */
function AssignCircuitDialog({ circuits, count, onCancel, onAssign }) {
  const [circuitId, setCircuitId] = useState(circuits.length ? circuits[0].id : '');
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Assign to circuit"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onAssign(circuitId)}>
            Assign
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm leading-relaxed text-ink-600">
        Assign {count} selected device{count === 1 ? '' : 's'} to:
      </p>
      <Select value={circuitId} onChange={e => setCircuitId(e.target.value)} aria-label="Circuit">
        <option value="">— none (clear circuit) —</option>
        {circuits.map(c => (
          <option key={c.id} value={c.id}>
            {c.id}
            {c.description ? ' — ' + c.description : ''}
          </option>
        ))}
      </Select>
      <p className="mt-2 text-2xs leading-relaxed text-ink-400">
        A switch assigned to its own circuit is a hard active — the lights it controls move onto
        that circuit too.
      </p>
    </Dialog>
  );
}

function AssignRoomDialog({ rooms, count, onCancel, onAssign }) {
  const [roomId, setRoomId] = useState(rooms.length ? rooms[0].id : '');
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Assign to room"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onAssign(roomId)}>
            Assign
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm leading-relaxed text-ink-600">
        Assign {count} selected device{count === 1 ? '' : 's'} to:
      </p>
      <Select value={roomId} onChange={e => setRoomId(e.target.value)} aria-label="Room">
        <option value="">— none (clear room) —</option>
        {rooms.map(r => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
    </Dialog>
  );
}

/**
 * Stacked-duplicate report. Shows what would be removed BEFORE removing
 * it — this deletes real work, so it is not a one-click "clean up" with
 * no preview.
 */
function DuplicatesDialog({ groups, symbolFor, onCancel, onRemove }) {
  const extras = groups.reduce((s, g) => s + g.objs.length - 1, 0);
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Stacked duplicates"
      width="max-w-lg"
      footer={
        <>
          <Button onClick={onCancel}>Close</Button>
          {groups.length > 0 && (
            <Button variant="danger" onClick={onRemove}>
              Remove {extras} duplicate{extras === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      {groups.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-600">
          No stacked duplicates — every device sits at its own position.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm leading-relaxed text-ink-600">
            Found {groups.length} spot{groups.length === 1 ? '' : 's'} where devices sit exactly on
            top of each other ({extras} extra device{extras === 1 ? '' : 's'}). The first at each
            spot is kept; the rest are removed.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-md border border-ink-200">
            {groups.map((g, i) => {
              const sym = symbolFor(g.objs[0].symbolId);
              return (
                <div key={i} className={cxRow(i)}>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-700">
                    {sym ? sym.label : g.objs[0].symbolId}
                  </span>
                  <span className="text-2xs text-ink-400">{g.floorName}</span>
                  <span className="tnum text-2xs font-medium text-red-600">×{g.objs.length}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Dialog>
  );
}
// Tiny helper so the row classes stay readable inline above.
function cxRow(i) {
  return 'flex items-center gap-2 px-3 py-2' + (i > 0 ? ' border-t border-ink-100' : '');
}

/** Name-only, because that's all a room is in this model. */

/**
 * Add or edit a circuit. Fields mirror production's form exactly, in the
 * same order — the board/cable/protection trio is what the panel
 * schedule and the quote read, so this is data entry an electrician
 * already knows the shape of, not a place to get creative.
 *
 * Editing an existing circuit deliberately does NOT allow changing its
 * id: devices reference a circuit by id, so a rename would orphan every
 * assignment. Production allows it and silently orphans them.
 */

/**
 * Panel schedule. A read-only report, not an editor — the one thing you
 * can change here is each board's main-switch rating, because the
 * capacity check is meaningless without it and the board is what you are
 * looking at when you think of it.
 *
 * Every number is produced by core/panelSchedule.js, which is ported
 * verbatim from the current app and checked against it by
 * app/test/panel-schedule-parity.mjs. The estimate disclaimers are part
 * of the output, not decoration: they must travel with the numbers
 * wherever the numbers go.
 */
/**
 * Quote. Rates and one-off costs at the top because they change the
 * whole number below them, then the schedule, then the totals.
 *
 * The itemised/summary toggle is production's: a summary grouped by
 * device type is what you send a client, and the itemised view is what
 * you check when a line looks wrong. Switch gang and floor are part of
 * the grouping key, so a 1-gang and a 4-gang plate never merge into one
 * line — they are different hardware at different prices.
 *
 * Every figure comes from core/quote.js, ported verbatim and checked
 * against the current app by app/test/quote-parity.mjs.
 */
/**
 * Civil materials takeoff for the ACTIVE site plan, plus that plan's
 * legend. Scoped to one plan on purpose — the same choice the panel
 * schedule makes — because a takeoff is what you hand to a supplier for
 * the dig you are about to do, not a sum across every plan in the job.
 *
 * Electrical and comms conduit are separate sections feeding one total,
 * so "how much comms conduit is on this site" does not require filtering
 * the electrical metreage out by hand.
 *
 * Every figure comes from core/civil.js, ported verbatim and checked
 * against the current app by app/test/civil-parity.mjs.
 */
function CivilMaterialsDialog({ doc, symbolFor, onClose, onExport }) {
  const project = doc.state;
  const plan = currentCivilPlan(project);
  const { rateLabour } = quoteSettings(project);
  const schedule = useMemo(
    () => (plan ? buildCivilSchedule(plan, rateLabour) : null),
    [plan, rateLabour]
  );
  const legend = useMemo(() => (plan ? computeCivilLegendEntries(plan) : []), [plan]);

  if (!plan) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Civil materials"
        footer={
          <>
            <div className="flex-1" />
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <p className="py-2 text-sm text-ink-500">No site plan yet.</p>
      </Dialog>
    );
  }

  const countTable = (title, rows, empty) => (
    <div className="mb-3">
      <FieldLabel className="mb-1">{title}</FieldLabel>
      {rows.length === 0 ? (
        <p className="text-2xs text-ink-400">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr className="text-left text-ink-400">
                <th className="py-1 pr-2 font-medium">Type</th>
                <th className="py-1 pr-2 font-medium">Qty</th>
                <th className="py-1 pr-2 font-medium">Each</th>
                <th className="py-1 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-ink-100">
                  <td className="py-1 pr-2 text-ink-700">{r.label}</td>
                  <td className="py-1 pr-2 tnum text-ink-600">{r.count}</td>
                  <td className="py-1 pr-2 tnum text-ink-600">{formatMoney(r.each)}</td>
                  <td className="py-1 tnum text-ink-800">{formatMoney(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const lengthTable = (title, rows, empty) => (
    <div className="mb-3">
      <FieldLabel className="mb-1">{title}</FieldLabel>
      {rows.length === 0 ? (
        <p className="text-2xs text-ink-400">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr className="text-left text-ink-400">
                <th className="py-1 pr-2 font-medium">Size</th>
                <th className="py-1 pr-2 font-medium">Metres</th>
                <th className="py-1 pr-2 font-medium">$/m</th>
                <th className="py-1 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-ink-100">
                  <td className="py-1 pr-2 text-ink-700">{r.label}</td>
                  <td className="py-1 pr-2 tnum text-ink-600">{r.metres.toFixed(1)}</td>
                  <td className="py-1 pr-2 tnum text-ink-600">
                    {r.perM == null ? '—' : '$' + r.perM.toFixed(2)}
                  </td>
                  <td className="py-1 tnum text-ink-800">{formatMoney(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={'Civil materials — ' + plan.name}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={() => onExport(plan, schedule, legend)}>Export as text…</Button>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="max-h-[65vh] overflow-y-auto pr-1">
        {!schedule.calibrated && (
          <p className="mb-3 rounded-md bg-amber-50 px-2 py-1.5 text-2xs leading-relaxed text-amber-700">
            This site plan is not calibrated — conduit and overhead metreage (and their cost) read
            as zero until you calibrate it.
          </p>
        )}

        {countTable('Pits', schedule.pitRows, 'No pits placed yet')}
        {lengthTable(
          'Underground conduit — electrical',
          schedule.electricalConduit,
          'No electrical conduit runs yet'
        )}
        {lengthTable(
          'Underground conduit — comms',
          schedule.commsConduit,
          'No comms conduit runs yet'
        )}
        {countTable('Poles', schedule.poleRows, 'No poles placed yet')}
        {lengthTable('Overhead conductor', schedule.overheadRows, 'No overhead runs yet')}

        <div className="mb-3 flex flex-wrap gap-4 text-2xs">
          <div>
            <div className="text-ink-400">Building entries</div>
            <div className="tnum text-sm text-ink-800">{schedule.buildingEntryCount}</div>
          </div>
          <div>
            <div className="text-ink-400">Transitions</div>
            <div className="tnum text-sm text-ink-800">
              {schedule.transitions.total} ({schedule.transitions.ugoh} UGOH,{' '}
              {schedule.transitions.ohug} OHUG)
            </div>
          </div>
        </div>

        <div className="max-w-sm border-t border-ink-200 pt-2 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-ink-500">Materials</span>
            <span className="tnum text-ink-800">{formatMoney(schedule.materials)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-ink-500">Labour</span>
            <span className="tnum text-ink-800">{formatMoney(schedule.labourCost)}</span>
          </div>
          <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-semibold">
            <span className="text-ink-900">Total</span>
            <span className="tnum text-ink-900">{formatMoney(schedule.total)}</span>
          </div>
        </div>

        <FieldLabel className="mb-1 mt-4">Legend</FieldLabel>
        {legend.length === 0 ? (
          <p className="text-2xs text-ink-400">Nothing drawn on this plan yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {legend.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-2xs">
                <span
                  className="flex h-5 w-8 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                  style={{
                    background: e.color + '22',
                    color: e.color,
                    border: '1px solid ' + e.color + '55',
                  }}
                >
                  {e.abbr}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-700">{e.label}</span>
                <span className="tnum text-ink-500">
                  ×{e.count}
                  {e.lengthM != null ? ' · ' + e.lengthM.toFixed(1) + 'm' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Copyable civil takeoff, in the same shape as the other text exports. */
function civilMaterialsText(project, plan, schedule, legend) {
  const lines = [];
  lines.push((project.name || 'Untitled project') + ' — Civil materials — ' + plan.name);
  lines.push('Generated ' + new Date().toLocaleDateString('en-AU'));
  if (!schedule.calibrated) {
    lines.push('NOT CALIBRATED — conduit and overhead metreage reads as zero.');
  }
  const countSection = (title, rows) => {
    lines.push('', title.toUpperCase());
    if (!rows.length) lines.push('  (none)');
    rows.forEach(r =>
      lines.push(`  ${r.label}  x${r.count}  @ ${formatMoney(r.each)}  =  ${formatMoney(r.cost)}`)
    );
  };
  const lengthSection = (title, rows) => {
    lines.push('', title.toUpperCase());
    if (!rows.length) lines.push('  (none)');
    rows.forEach(r =>
      lines.push(
        `  ${r.label}  ${r.metres.toFixed(1)}m  @ ${
          r.perM == null ? '-' : '$' + r.perM.toFixed(2) + '/m'
        }  =  ${formatMoney(r.cost)}`
      )
    );
  };
  countSection('Pits', schedule.pitRows);
  lengthSection('Underground conduit — electrical', schedule.electricalConduit);
  lengthSection('Underground conduit — comms', schedule.commsConduit);
  countSection('Poles', schedule.poleRows);
  lengthSection('Overhead conductor', schedule.overheadRows);
  lines.push('', 'BUILDING ENTRIES: ' + schedule.buildingEntryCount);
  lines.push(
    'TRANSITIONS: ' +
      schedule.transitions.total +
      ' (' +
      schedule.transitions.ugoh +
      ' UGOH, ' +
      schedule.transitions.ohug +
      ' OHUG)'
  );
  lines.push('', 'LEGEND');
  if (!legend.length) lines.push('  (nothing drawn)');
  legend.forEach(e =>
    lines.push(
      `  ${e.abbr}  ${e.label}  x${e.count}${
        e.lengthM != null ? '  ' + e.lengthM.toFixed(1) + 'm' : ''
      }`
    )
  );
  lines.push('', 'TOTALS');
  lines.push('Materials: ' + formatMoney(schedule.materials));
  lines.push('Labour: ' + formatMoney(schedule.labourCost));
  lines.push('TOTAL: ' + formatMoney(schedule.total));
  return lines.join('\n');
}

/**
 * Live schematic preview of one elevation — a labelled wall with its
 * items drawn to scale. Ported from production's drawElevation():
 * uniformly scaled to fit (never distorted), centred, sitting on the
 * canvas floor with a fixed margin.
 *
 * Dark background and filled-circle device markers match the visual
 * language the civil renderer already uses for the same reason
 * production does — this is a schematic drafting view, the same CAD
 * convention as the plan canvas, not app chrome. Not interactive: no
 * pointer handlers, no zoom, no pan, mirroring production's #elevCanvas
 * exactly — items are only ever added through the form below.
 */
function ElevationCanvas({ elev }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const cssW = wrap.clientWidth || 300;
    const cssH = 180;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAINT.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (!elev) return;

    const layout = elevationLayout(elev, cssW, cssH, 20);
    ctx.strokeStyle = '#7d8fa3';
    ctx.lineWidth = 2;
    ctx.strokeRect(layout.originX, layout.originY, layout.wallW, layout.wallH);

    elev.items.forEach(item => {
      const sym = SYMBOL_LIBRARY.find(s => s.id === item.symbolId);
      if (!sym) return;
      const p = elevationItemPoint(item, layout);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = sym.color;
      ctx.fill();
      ctx.fillStyle = PAINT.bg;
      ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sym.abbr, p.x, p.y);
    });

    ctx.fillStyle = '#7d8fa3';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(elev.width_mm + 'mm wide, ' + elev.height_mm + 'mm high', cssW / 2, 14);
  }, [elev]);

  return (
    <div ref={wrapRef} className="w-full overflow-hidden rounded-md border border-ink-200">
      <canvas ref={canvasRef} />
    </div>
  );
}

/**
 * Elevations — see core/elevations.js for why this is a report-style
 * dialog rather than a drafting plan: production's own elevation canvas
 * has no pointer interaction at all, only a number-entry form and a live
 * preview. One dialog covers the whole feature, matching that shape:
 * pick or manage the elevation on the left, its item list and add-item
 * form on the right, live preview above the list.
 */
function ElevationsDialog({ doc, controller, symbolFor, onClose, pushToast }) {
  const project = doc.state;
  const elevations = project.elevations || [];
  const elev = activeElevation(project);
  const syms = useMemo(() => allSymbols(project), [project]);

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWidth, setNewWidth] = useState(4200);
  const [newHeight, setNewHeight] = useState(2400);

  const [itemSymbolId, setItemSymbolId] = useState(syms[0] ? syms[0].id : '');
  const [itemX, setItemX] = useState('');
  const [itemHeight, setItemHeight] = useState(1200);

  function createElevation(e) {
    e && e.preventDefault();
    const width = parseFloat(newWidth);
    const height = parseFloat(newHeight);
    if (!newName.trim() || !(width > 0) || !(height > 0)) {
      pushToast('Fill in a name, width and height', 'error');
      return;
    }
    controller.addElevation(newName.trim(), width, height);
    setNewName('');
    setNewOpen(false);
  }

  function addItem(e) {
    e && e.preventDefault();
    if (!elev) return;
    const x = parseFloat(itemX);
    const h = parseFloat(itemHeight);
    if (!itemSymbolId || isNaN(x) || isNaN(h)) {
      pushToast('Enter valid numbers', 'error');
      return;
    }
    controller.addElevationItem(elev.id, itemSymbolId, x, h);
    setItemX('');
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Elevations"
      width="max-w-2xl"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <div className="mb-3 flex items-center gap-2">
          <Select
            value={elev ? elev.id : ''}
            onChange={e => controller.selectElevation(e.target.value)}
            aria-label="Elevation"
            className="flex-1"
          >
            {elevations.length === 0 && <option value="">— none yet —</option>}
            {elevations.map(el => (
              <option key={el.id} value={el.id}>
                {el.name} ({el.width_mm}×{el.height_mm}mm)
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => setNewOpen(o => !o)}>
            + New
          </Button>
          {elev && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                controller.deleteElevation(elev.id);
                pushToast('Deleted "' + elev.name + '"');
              }}
            >
              Delete
            </Button>
          )}
        </div>

        {newOpen && (
          <form
            onSubmit={createElevation}
            className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-ink-200 p-2"
          >
            <label className="flex w-48 flex-col gap-1">
              <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
                Name
              </span>
              <TextInput
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Kitchen north wall"
                aria-label="Elevation name"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
                Width (mm)
              </span>
              <input
                type="number"
                value={newWidth}
                onChange={e => setNewWidth(e.target.value)}
                aria-label="Wall width in millimetres"
                className="w-24 rounded-md border border-ink-200 px-2 py-1 text-sm tnum"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
                Height (mm)
              </span>
              <input
                type="number"
                value={newHeight}
                onChange={e => setNewHeight(e.target.value)}
                aria-label="Wall height in millimetres"
                className="w-24 rounded-md border border-ink-200 px-2 py-1 text-sm tnum"
              />
            </label>
            <Button size="sm" variant="primary" type="submit">
              Create
            </Button>
          </form>
        )}

        {!elev ? (
          <p className="py-2 text-sm text-ink-500">
            No elevations yet — create one to sketch device heights on a wall.
          </p>
        ) : (
          <>
            <ElevationCanvas elev={elev} />

            <FieldLabel className="mb-1 mt-3">
              Devices on this wall
              {elev.items.length > 0 ? ` (${elev.items.length})` : ''}
            </FieldLabel>
            {elev.items.length === 0 ? (
              <p className="pb-2 text-2xs text-ink-400">Nothing added yet.</p>
            ) : (
              <div className="mb-2">
                {elev.items.map((item, i) => {
                  const sym = symbolFor(item.symbolId);
                  return (
                    <div key={i} className="flex items-center gap-2 border-t border-ink-100 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-700">
                        {sym ? sym.label : item.symbolId}
                      </span>
                      <span className="tnum text-2xs text-ink-500">
                        {item.x_mm}mm from left, {item.height_mm}mm high
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => controller.deleteElevationItem(elev.id, i)}
                      >
                        Delete
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <form
              onSubmit={addItem}
              className="flex flex-wrap items-end gap-2 rounded-md border border-ink-200 p-2"
            >
              <label className="flex w-40 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
                  Device
                </span>
                <Select
                  value={itemSymbolId}
                  onChange={e => setItemSymbolId(e.target.value)}
                  aria-label="Device"
                >
                  {syms.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
                  From left (mm)
                </span>
                <input
                  type="number"
                  value={itemX}
                  onChange={e => setItemX(e.target.value)}
                  placeholder={String(Math.round(elev.width_mm / 2))}
                  aria-label="Position from left in millimetres"
                  className="w-24 rounded-md border border-ink-200 px-2 py-1 text-sm tnum"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
                  Height (mm)
                </span>
                <input
                  type="number"
                  value={itemHeight}
                  onChange={e => setItemHeight(e.target.value)}
                  aria-label="Installation height in millimetres"
                  className="w-24 rounded-md border border-ink-200 px-2 py-1 text-sm tnum"
                />
              </label>
              <Button size="sm" variant="primary" type="submit">
                Add
              </Button>
            </form>
          </>
        )}
      </div>
    </Dialog>
  );
}

// --- print / PDF export (Phase 9) --------------------------------------
//
// A full-screen review, not the usual small `Dialog` — production's own
// #printView is a distinct page-review surface, not a modal card, and an
// A4-shaped preview needs the room. The `@media print` rule in
// app/index.html hides everything else on the page (the same
// visibility-swap trick production's CSS uses) so browser Print only
// puts these pages on paper.

function PrintPage({ page, projectName, dateStr }) {
  const emptyLabel =
    page.kind === 'civil'
      ? 'Nothing placed on this civil plan yet.'
      : 'Nothing placed on this floor yet.';
  return (
    <div className="print-page overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
      <div className="flex items-start justify-between border-b border-ink-200 px-4 py-2.5">
        <div className="text-sm font-semibold text-ink-800">
          {projectName} — {page.floorName}
          {page.kind === 'civil' ? ' (Civil)' : ''}
        </div>
        <div className="text-right text-2xs leading-relaxed text-ink-500">
          {dateStr}
          <br />
          {page.calibrated ? 'Calibrated' : 'Not calibrated'}
        </div>
      </div>
      <div className="flex gap-4 p-4">
        <div
          className="flex flex-1 items-center justify-center overflow-hidden rounded border border-ink-100 bg-ink-50"
          style={{ aspectRatio: `${CAPTURE_W} / ${CAPTURE_H}` }}
        >
          {page.hasContent ? (
            <img src={page.imgSrc} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="px-4 text-center text-xs text-ink-400">{emptyLabel}</span>
          )}
        </div>
        <div className="w-48 shrink-0">
          <h3 className="mb-1.5 border-b border-ink-100 pb-1 font-mono text-2xs uppercase tracking-wide text-ink-400">
            Legend
          </h3>
          {page.entries.length ? (
            <>
              <div className="space-y-1">
                {page.entries.map((e, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-ink-700">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: legendEntryColor(page.kind, e) }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {legendEntryLabel(page.kind, e)}
                    </span>
                    <span className="tnum shrink-0 text-ink-400">× {e.count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 border-t border-ink-100 pt-1.5 text-right text-2xs font-semibold text-ink-700">
                {page.total} {page.kind === 'civil' ? 'item' : 'device'}
                {page.total === 1 ? '' : 's'} total
              </div>
            </>
          ) : (
            <p className="text-2xs text-ink-400">{emptyLabel}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PrintExportDialog({ doc, controller, symbolFor, projectName, onClose, pushToast }) {
  // Not part of the project — production keeps this as a plain in-memory
  // flag too (never written by buildProjectData()), a per-session review
  // preference rather than something that travels with the job.
  const [includeCivil, setIncludeCivil] = useState(true);
  const [pages, setPages] = useState(null); // null while (re)building
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setPages(null);
    const categoryOf = o => {
      const s = symbolFor(o.symbolId);
      return s ? s.category : null;
    };
    buildPrintPages(
      doc.state,
      {
        symbolFor,
        isVisible: controller.visible,
        isLayerHidden: controller.isLayerHidden,
        categoryOf,
      },
      includeCivil
    ).then(result => {
      if (live) setPages(result);
    });
    return () => {
      live = false;
    };
    // doc.state is read once per build, not tracked reactively — a print
    // review is a snapshot of "now", the same way production only
    // recaptures on open or on the civil-pages toggle, not on every edit
    // while the dialog sits open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeCivil]);

  const dateStr = new Date().toLocaleDateString('en-AU');

  async function handleSavePdf() {
    if (!pages || !pages.length) {
      pushToast('Nothing to export yet');
      return;
    }
    setSaving(true);
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      pages.forEach((p, i) => {
        if (i > 0) pdf.addPage();
        drawPdfPage(pdf, p, projectName);
      });
      const safe = fileSafeName(projectName);
      // Where supported (Chrome/Edge, HTTPS only), a real "Save As" dialog
      // instead of it silently landing in Downloads — Firefox/Safari/
      // mobile don't implement this API and fall through to the plain
      // download below, exactly as production does.
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: safe + '.pdf',
            types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(pdf.output('blob'));
          await writable.close();
          pushToast('Saved ' + safe + '.pdf');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // cancelled — not a failure
          // any other failure (permissions, etc.) — fall through to the plain download
        }
      }
      pdf.save(safe + '.pdf');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-100">
      <div
        id="print-toolbar"
        className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-4"
      >
        <span className="text-sm font-semibold text-ink-800">Print / PDF export</span>
        <div className="flex-1" />
        <span className="flex items-center gap-2 text-xs text-ink-600">
          Include civil plan pages
          <Toggle
            label="Include civil plan pages"
            checked={includeCivil}
            onChange={() => setIncludeCivil(v => !v)}
          />
        </span>
        <Button size="sm" onClick={() => window.print()} disabled={!pages}>
          🖨 Print
        </Button>
        <Button size="sm" variant="primary" onClick={handleSavePdf} disabled={!pages || saving}>
          {saving ? 'Saving…' : '⬇ Save as PDF'}
        </Button>
        <Button size="sm" onClick={onClose}>
          ✕ Close
        </Button>
      </div>
      <div id="print-pages" className="flex-1 overflow-y-auto p-6">
        {!pages ? (
          <div className="flex justify-center py-24">
            <Spinner className="h-6 w-6 text-accent-500" />
          </div>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            {pages.map((p, i) => (
              <PrintPage
                key={p.kind + ':' + i}
                page={p}
                projectName={projectName}
                dateStr={dateStr}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuoteDialog({ doc, controller, symbolFor, onClose, onExport, onOpenPriceList }) {
  const project = doc.state;
  const itemized = !!project.quoteItemized;
  const totals = useMemo(() => computeQuote(project, symbolFor), [project, symbolFor]);
  const lines = useMemo(
    () => quoteLines(project, symbolFor, itemized),
    [project, symbolFor, itemized]
  );
  const settings = quoteSettings(project);
  const civilTotal = useMemo(
    () => computeAllCivilTotals(project, settings.rateLabour),
    [project, settings.rateLabour]
  );

  const rateField = (key, label, step) => (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">{label}</span>
      <input
        type="number"
        step={step}
        defaultValue={settings[key]}
        aria-label={label}
        onChange={e => controller.setQuoteSetting(key, e.target.value)}
        className="w-24 rounded-md border border-ink-200 px-2 py-1 text-sm tnum"
      />
    </label>
  );

  const totalRow = (label, value, opts = {}) => (
    <div
      className={cx(
        'flex items-baseline justify-between py-1',
        opts.strong && 'border-t border-ink-200 pt-2 text-base font-semibold text-ink-900'
      )}
    >
      <span className={cx('text-ink-500', opts.strong && 'text-ink-900')}>{label}</span>
      <span className="tnum text-ink-800">{formatMoney(value)}</span>
    </div>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title="Quote"
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onOpenPriceList}>Price list…</Button>
          <Button onClick={() => onExport(itemized)}>Export as text…</Button>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="max-h-[65vh] overflow-y-auto pr-1">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          {rateField('rateLabour', 'Labour $/hr', 1)}
          {rateField('rateMargin', 'Margin %', 1)}
          {rateField('costEquipment', 'Equipment $', 1)}
          {rateField('costTravel', 'Travel $', 1)}
        </div>

        <div className="mb-1.5 flex items-center gap-2">
          <FieldLabel>Device schedule</FieldLabel>
          <div className="flex-1" />
          <button
            onClick={() => controller.toggleQuoteItemized()}
            className={cx('text-2xs text-accent-600 hover:underline', focusRing)}
          >
            {itemized ? 'Show quantity summary' : 'Show every device'}
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="py-2 text-sm text-ink-500">Nothing placed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-2xs">
              <thead>
                <tr className="text-left text-ink-400">
                  <th className="py-1 pr-2 font-medium">ID</th>
                  <th className="py-1 pr-2 font-medium">Item</th>
                  <th className="py-1 pr-2 font-medium">Floor</th>
                  <th className="py-1 pr-2 font-medium">Qty</th>
                  <th className="py-1 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-ink-100">
                    <td className="py-1 pr-2 tnum text-ink-500">{l.id == null ? '—' : l.id}</td>
                    <td className="py-1 pr-2 text-ink-700">{l.label}</td>
                    <td className="py-1 pr-2 text-ink-500">{l.floorName}</td>
                    <td className="py-1 pr-2 tnum text-ink-600">{l.qty}</td>
                    <td className="py-1 tnum text-ink-800">{formatMoney(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 max-w-sm text-sm">
          {totalRow('Materials', totals.materials)}
          {totalRow('Labour', totals.labourCost)}
          {totalRow('Protection devices', totals.protection)}
          {totalRow('Equipment', totals.equipment)}
          {totalRow('Travel', totals.travel)}
          {totalRow('Subtotal', totals.subtotal)}
          {totalRow('Margin', totals.margin)}
          {totalRow('GST', totals.gst)}
          {totalRow('Total', totals.total, { strong: true })}
        </div>

        {/* Civil work is quoted on its own sheet per site plan; this is
            the whole-job visibility line, so a job with a dig in it does
            not look cheaper than it is from the electrical quote alone.
            It is shown separately rather than folded into the total
            because production keeps the two quotes apart. */}
        {civilTotal.total > 0 && (
          <div className="mt-3 max-w-sm rounded-md bg-ink-50 px-2.5 py-2 text-2xs">
            <div className="flex justify-between">
              <span className="text-ink-500">Civil / underground (all site plans)</span>
              <span className="tnum font-medium text-ink-800">{formatMoney(civilTotal.total)}</span>
            </div>
            <p className="mt-1 leading-relaxed text-ink-400">
              Not included in the total above — civil work is quoted on its own sheet.
            </p>
          </div>
        )}

        <p className="mt-3 text-2xs leading-relaxed text-ink-400">
          A <span className="font-medium">*</span> next to an item means that device has a price
          override of its own. Patch panels are counted from each rack&rsquo;s port count, not
          placed.
        </p>
      </div>
    </Dialog>
  );
}

/**
 * Device library prices. Editing here changes what every device of that
 * type costs on THIS job — the edits are saved with the project, not
 * with the app, so pricing one job aggressively cannot quietly reprice
 * another. (The current app edits a global list and loses the edits on
 * reload; see core/symbols.js.)
 */
function PriceListDialog({ doc, controller, onClose }) {
  const [query, setQuery] = useState('');
  const project = doc.state;
  const syms = useMemo(() => allSymbols(project), [project]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? syms.filter(s => s.label.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q))
    : syms;
  const overrides = project.priceList || {};

  const field = (sym, key, step, width) => (
    <input
      type="number"
      step={step}
      defaultValue={sym.defaultProps[key] == null ? '' : sym.defaultProps[key]}
      aria-label={sym.label + ' ' + key}
      onChange={e => controller.setPriceListField(sym.id, key, e.target.value)}
      className={cx('rounded-md border border-ink-200 px-1.5 py-1 text-2xs tnum', width)}
    />
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title="Price list"
      width="max-w-3xl"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <TextInput
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search devices…"
        aria-label="Search the price list"
      />
      <div className="mt-2 max-h-[60vh] overflow-y-auto pr-1">
        <div className="flex items-center gap-2 border-b border-ink-100 pb-1 text-2xs text-ink-400">
          <span className="flex-1">Device</span>
          <span className="w-20 text-center">Price $</span>
          <span className="w-16 text-center">Labour hrs</span>
          <span className="w-16 text-center">Watts</span>
        </div>
        {shown.map(sym => (
          <div key={sym.id} className="flex items-center gap-2 border-b border-ink-50 py-1">
            <span
              className="min-w-0 flex-1 truncate text-2xs font-medium"
              style={{ color: sym.color }}
            >
              {sym.label}
              {overrides[sym.id] && <span className="ml-1 text-ink-400">(edited)</span>}
            </span>
            {field(sym, 'material_cost', 0.01, 'w-20')}
            {field(sym, 'labour_hours', 0.05, 'w-16')}
            {field(sym, 'watts', 1, 'w-16')}
          </div>
        ))}
      </div>
      <p className="mt-2 text-2xs leading-relaxed text-ink-400">
        These prices apply to this job only and are saved with it. Clear a field to go back to the
        shipped default.
      </p>
    </Dialog>
  );
}

function PanelScheduleDialog({ doc, controller, symbolFor, onClose, onExport }) {
  const [ceilingMm, setCeilingMm] = useState(3000);
  const [slackPct, setSlackPct] = useState(0);
  const project = doc.state;
  const boards = useMemo(
    () => buildPanelScheduleData(project, { ceilingMm, slackPct }, symbolFor),
    [project, ceilingMm, slackPct, symbolFor]
  );
  const mainAmps = project.boardMainSwitchAmps || {};

  return (
    <Dialog
      open
      onClose={onClose}
      title="Panel schedule"
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={() => onExport(boards)}>Export as text…</Button>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {/* The report can run long; it scrolls inside the dialog so the
          footer actions stay reachable rather than sliding off-screen. */}
      <div className="max-h-[65vh] overflow-y-auto pr-1">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
              Ceiling height
            </span>
            <input
              type="number"
              value={ceilingMm}
              onChange={e => setCeilingMm(parseFloat(e.target.value) || 3000)}
              aria-label="Ceiling height in millimetres"
              className="w-28 rounded-md border border-ink-200 px-2 py-1 text-sm tnum"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
              Slack %
            </span>
            <input
              type="number"
              value={slackPct}
              onChange={e => setSlackPct(parseFloat(e.target.value) || 0)}
              aria-label="Cable slack percentage"
              className="w-24 rounded-md border border-ink-200 px-2 py-1 text-sm tnum"
            />
          </label>
        </div>

        {boards.length === 0 ? (
          <p className="py-3 text-sm leading-relaxed text-ink-500">
            No electrical circuits yet — add circuits and assign devices to them first.
          </p>
        ) : (
          boards.map(b => {
            const demandA = b.demandW / MAINS_VOLTAGE;
            const amps = mainAmps[b.boardLabel];
            const pctOfMain = amps && amps > 0 ? (demandA / amps) * 100 : null;
            const anyOverRated = b.circuits.some(r => r.overRated);
            return (
              <div key={b.boardLabel} className="mb-4 rounded-lg border border-ink-200 p-3">
                <div className="mb-2 text-sm font-semibold text-ink-800">{b.boardLabel}</div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-2xs">
                    <thead>
                      <tr className="text-left text-ink-400">
                        <th className="py-1 pr-2 font-medium">Circuit</th>
                        <th className="py-1 pr-2 font-medium">Description</th>
                        <th className="py-1 pr-2 font-medium">Cable</th>
                        <th className="py-1 pr-2 font-medium">Protection</th>
                        <th className="py-1 pr-2 font-medium">Qty</th>
                        <th className="py-1 pr-2 font-medium">Connected</th>
                        <th className="py-1 pr-2 font-medium">Est. demand</th>
                        <th className="py-1 font-medium">Est. cable run</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.circuits.map(row => {
                        const ce = row.cableEstimate;
                        return (
                          <tr key={row.circuit.id} className="border-t border-ink-100">
                            <td className="py-1 pr-2 font-medium text-ink-800">
                              {row.circuit.id}
                              {row.overRated && <span className="ml-1 text-red-600">⚠</span>}
                            </td>
                            <td className="py-1 pr-2 text-ink-600">
                              {row.circuit.description || '—'}
                            </td>
                            <td className="py-1 pr-2 text-ink-600">{row.circuit.cable || '—'}</td>
                            <td className="py-1 pr-2 text-ink-600">{row.protectionLabel}</td>
                            <td className="py-1 pr-2 tnum text-ink-600">{row.deviceCount}</td>
                            <td className="py-1 pr-2 tnum text-ink-600">
                              {row.connectedW.toFixed(0)}W / {row.connectedA.toFixed(1)}A
                            </td>
                            <td
                              className="py-1 pr-2 tnum text-ink-600"
                              title={DIVERSITY_TYPE_LABELS[row.diversityType]}
                            >
                              {row.demandW.toFixed(0)}W
                            </td>
                            <td className="py-1 tnum text-ink-600">
                              {ce.ok ? (
                                <>
                                  ~{ce.meters.toFixed(1)}m
                                  {ce.otherFloorCount ? (
                                    <span
                                      className="text-ink-400"
                                      title={
                                        ce.otherFloorCount +
                                        ' device(s) on another floor not included'
                                      }
                                    >
                                      {' '}
                                      (+{ce.otherFloorCount} elsewhere)
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-ink-400" title={ce.reason}>
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2 flex flex-wrap items-end gap-4 text-2xs">
                  <div>
                    <div className="text-ink-400">Connected load</div>
                    <div className="tnum text-sm text-ink-800">
                      {(b.connectedW / 1000).toFixed(2)} kW
                    </div>
                  </div>
                  <div>
                    <div className="text-ink-400">Est. demand load</div>
                    <div className="tnum text-sm text-ink-800">
                      {(b.demandW / 1000).toFixed(2)} kW ({demandA.toFixed(1)}A)
                    </div>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-ink-400">Main switch rating (A)</span>
                    <input
                      type="number"
                      defaultValue={amps || ''}
                      placeholder="e.g. 63"
                      aria-label={'Main switch rating for ' + b.boardLabel}
                      onBlur={e => controller.setBoardMainSwitchAmps(b.boardLabel, e.target.value)}
                      className="w-24 rounded-md border border-ink-200 px-2 py-1 text-sm tnum"
                    />
                  </label>
                </div>

                {pctOfMain != null && (
                  <div
                    className={cx(
                      'mt-1.5 text-2xs',
                      pctOfMain > 100 ? 'text-red-600' : 'text-ink-400'
                    )}
                  >
                    {pctOfMain.toFixed(0)}% of main switch capacity used (estimate)
                    {pctOfMain > 100 ? ' — exceeds rating' : ''}
                  </div>
                )}
                {anyOverRated && (
                  <div className="mt-1.5 text-2xs text-red-600">
                    ⚠ One or more circuits have a connected load above their protection device
                    rating — review before relying on this board.
                  </div>
                )}
              </div>
            );
          })
        )}

        <p className="mt-2 text-2xs leading-relaxed text-ink-400">
          Connected load uses each device's typical load from the device library (editable per
          device and per type). Demand load applies a simplified diversity estimate for early
          planning only — always verify against AS/NZS 3000 and your own professional judgement
          before relying on it for a real installation.
        </p>
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-400">
          Est. cable run only covers circuits linked to a switchboard on a calibrated floor. For
          lighting it covers hard-active runs only (switch fed straight from the switchboard) — the
          cable for actually switching the lights or fans is <b>not</b> included, since too many
          cable combinations are possible to estimate generically.
        </p>
      </div>
    </Dialog>
  );
}

/** Read-only text output, selected on open so it can be copied straight out. */
function ExportTextDialog({ title, text, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, []);
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width="max-w-3xl"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <textarea
        ref={ref}
        readOnly
        value={text}
        aria-label={title}
        className="h-72 w-full resize-none rounded-md border border-ink-200 p-2 font-mono text-2xs leading-relaxed"
      />
    </Dialog>
  );
}

function CircuitDialog({ circuit, boards, onCancel, onSubmit, onDelete }) {
  const editing = !!circuit;
  const [id, setId] = useState(circuit ? circuit.id : '');
  const [description, setDescription] = useState(circuit ? circuit.description || '' : '');
  const [switchboardObjectId, setSwitchboard] = useState(
    circuit ? circuit.switchboardObjectId || '' : ''
  );
  const [board, setBoard] = useState(circuit ? circuit.board || '' : 'MSB');
  const [cable, setCable] = useState(circuit ? circuit.cable : '2.5mm²');
  const [protectionId, setProtection] = useState(circuit ? circuit.protectionId : 'rcbo20');

  const valid = id.trim().length > 0;
  function submit(e) {
    e && e.preventDefault();
    if (!valid) return;
    onSubmit({
      id: id.trim(),
      description,
      // A <select> hands back a string; device ids are numbers. Map the
      // choice back to the real id or the board lookup silently never
      // matches, and every circuit quietly falls back to "whichever
      // board happens to be on this floor".
      switchboardObjectId:
        (boards.find(b => String(b.id) === String(switchboardObjectId)) || {}).id ?? null,
      board,
      cable,
      protectionId,
    });
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title={editing ? 'Circuit ' + circuit.id : 'New circuit'}
      footer={
        <>
          {editing && (
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {editing ? 'Save' : 'Add circuit'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label className="text-2xs font-medium uppercase tracking-wide text-ink-400">
          Circuit ID
        </label>
        <TextInput
          autoFocus={!editing}
          disabled={editing}
          value={id}
          onChange={e => setId(e.target.value)}
          placeholder="e.g. GPO-01"
          aria-label="Circuit ID"
        />
        <label className="mt-1 text-2xs font-medium uppercase tracking-wide text-ink-400">
          Description
        </label>
        <TextInput
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g. General power — kitchen"
          aria-label="Circuit description"
        />
        <label className="mt-1 text-2xs font-medium uppercase tracking-wide text-ink-400">
          Switchboard
        </label>
        <Select
          value={switchboardObjectId}
          onChange={e => setSwitchboard(e.target.value)}
          aria-label="Linked switchboard"
        >
          <option value="">— name the board below instead —</option>
          {boards.map(b => (
            <option key={b.id} value={b.id}>
              {b.label} ({b.floorName})
            </option>
          ))}
        </Select>
        {!switchboardObjectId && (
          <TextInput
            value={board}
            onChange={e => setBoard(e.target.value)}
            placeholder="MSB"
            aria-label="Board name"
          />
        )}
        <label className="mt-1 text-2xs font-medium uppercase tracking-wide text-ink-400">
          Cable
        </label>
        <Select value={cable} onChange={e => setCable(e.target.value)} aria-label="Circuit cable">
          {CABLE_SIZES.map(cs => (
            <option key={cs.size} value={cs.size}>
              {cs.size}
            </option>
          ))}
        </Select>
        <label className="mt-1 text-2xs font-medium uppercase tracking-wide text-ink-400">
          Protection
        </label>
        <Select
          value={protectionId}
          onChange={e => setProtection(e.target.value)}
          aria-label="Protection device"
        >
          {PROTECTION_LIBRARY.map(p => (
            <option key={p.id} value={p.id}>
              {p.label} — ${p.cost}
            </option>
          ))}
        </Select>
      </form>
    </Dialog>
  );
}

function RoomDialog({ onCancel, onCreate }) {
  const [name, setName] = useState('');
  const valid = name.trim().length > 0;
  function submit(e) {
    e && e.preventDefault();
    if (valid) onCreate(name.trim());
  }
  return (
    <Dialog
      open
      onClose={onCancel}
      title="New room"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            Add room
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <TextInput
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Kitchen"
          aria-label="Room name"
        />
        <p className="mt-2 text-2xs leading-relaxed text-ink-400">
          Assign devices to this room from their properties, or select several and assign them at
          once.
        </p>
      </form>
    </Dialog>
  );
}

/**
 * Custom fitting. Colour is taken from the chosen layer rather than being
 * a free choice — that's what keeps a plan readable by category, and it
 * matches production, which does the same.
 */
function CustomFittingDialog({ onCancel, onCreate }) {
  const [form, setForm] = useState({
    name: '',
    abbr: '',
    category: 'power',
    material_cost: '20',
    labour_hours: '0.3',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const valid = form.name.trim().length > 0;

  function submit(e) {
    e && e.preventDefault();
    if (!valid) return;
    onCreate({
      name: form.name,
      abbr: form.abbr,
      category: form.category,
      material_cost: parseFloat(form.material_cost) || 0,
      labour_hours: parseFloat(form.labour_hours) || 0,
    });
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Add a custom fitting"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            Add fitting
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Name</span>
          <TextInput
            autoFocus
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Oven outlet"
          />
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
              Plan label
            </span>
            <TextInput
              value={form.abbr}
              onChange={e => set('abbr', e.target.value.slice(0, 3))}
              placeholder="max 3 chars"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Layer</span>
            <Select value={form.category} onChange={e => set('category', e.target.value)}>
              {LAYER_DEFS.filter(l => l.id !== 'architectural').map(l => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
              Material $
            </span>
            <TextInput
              inputMode="decimal"
              value={form.material_cost}
              onChange={e => set('material_cost', e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">
              Labour (hrs)
            </span>
            <TextInput
              inputMode="decimal"
              value={form.labour_hours}
              onChange={e => set('labour_hours', e.target.value)}
            />
          </label>
        </div>
        <p className="text-2xs leading-relaxed text-ink-400">
          Saved with this project and priced like any catalog device. Its colour comes from the
          layer you pick.
        </p>
      </form>
    </Dialog>
  );
}

function CalibrateDialog({ length, onCancel, onApply }) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('mm');

  useEffect(() => {
    if (length != null) {
      setValue('');
      setUnit('mm');
    }
  }, [length]);
  if (length == null) return null;

  const n = parseFloat(value);
  const valid = isFinite(n) && n > 0;
  const mm = unit === 'm' ? n * 1000 : n;

  function submit(e) {
    e && e.preventDefault();
    if (valid) onApply(mm);
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Set scale"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            Set scale
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <p className="mb-3 text-sm leading-relaxed text-ink-600">
          How long is the line you just drew?
        </p>
        <div className="flex gap-2">
          <TextInput
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="e.g. 820"
            aria-label="Real length"
          />
          <Select
            value={unit}
            onChange={e => setUnit(e.target.value)}
            className="w-20"
            aria-label="Unit"
          >
            <option value="mm">mm</option>
            <option value="m">m</option>
          </Select>
        </div>
        {valid && (
          <p className="mt-2.5 text-2xs text-ink-400 tnum">
            Scale becomes {(mm / length).toFixed(2)} mm per drawing unit.
          </p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Last line of defence. Without one of these, a single render error
 * unmounts the whole tree and the user is left staring at a white page
 * with their drawing apparently gone — which happened twice while
 * building the reports, both times from a missing import.
 *
 * The drawing itself is safe (it is in localStorage, saved on a debounce
 * before the crash), so the most useful thing this can do is say so and
 * offer a reload, rather than let a blank page imply lost work.
 *
 * A class component because that is the only way to catch render errors
 * in React 18 — there is no hook equivalent.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('SparkyDraft crashed while rendering:', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
        <div className="max-w-md rounded-xl bg-white p-5 shadow-pop">
          <h1 className="text-base font-semibold text-ink-900">Something broke on screen</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            Your drawing is saved — this is a display problem, not lost work. Reloading usually
            fixes it.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-ink-50 p-2 font-mono text-2xs text-ink-500">
            {String(this.state.error && this.state.error.message)}
          </pre>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

function App() {
  // `open` is the whole "what is on screen" decision, in one object so a
  // cloud open (which also carries a pre-loaded project and a role) can
  // never land half-applied — e.g. the id switched but the read-only flag
  // still from the last project, which is the failure mode that would
  // silently give a viewer edit rights.
  const [open, setOpen] = useState(null); // { key, projectId, project?, readOnly, sharedByName }
  const [projects, setProjects] = useState(() => listProjects());
  const [storageError, setStorageError] = useState(null);
  const [toasts, pushToast] = useToasts();
  const cloud = useCloud();

  const refresh = useCallback(() => setProjects(listProjects()), []);

  useEffect(() => {
    initCloudAuth();
  }, []);

  const openLocal = useCallback(id => {
    clearOrgProjectContext();
    setOpen({ key: 'local:' + id + ':' + Date.now(), projectId: id, readOnly: false });
  }, []);

  function create() {
    const id = newProjectId();
    const res = saveProject(id, { ...emptyProject(), name: 'Untitled drawing' });
    if (!res.ok) {
      setStorageError(res.error);
      return;
    }
    refresh();
    openLocal(id);
  }

  /**
   * Opening a personal cloud project writes the converted record to local
   * storage first, then opens it like any other local project. That is
   * what makes the two lists one list: same id in both places, autosave
   * keeps both current, and the drawing survives losing connectivity
   * mid-job — which for someone standing in a half-built house is the
   * normal case, not the edge case.
   */
  async function openCloud(id) {
    try {
      const record = await loadCloudProject(id);
      const project = fromCloudRecord(record, allSymbols(record || {}), id);
      const res = saveProject(id, project);
      if (!res.ok) {
        setStorageError(res.error);
        return;
      }
      refresh();
      clearOrgProjectContext();
      setOpen({ key: 'cloud:' + id + ':' + Date.now(), projectId: id, project, readOnly: false });
      pushToast('Opened from cloud');
    } catch (err) {
      pushToast('Could not open: ' + err.message);
    }
  }

  /**
   * A shared organisation project. The role is resolved server-side on
   * every open (never cached) and decides both whether edits are possible
   * and where a save goes — back to the shared record, not a fork into
   * personal projects.
   *
   * A VIEWER deliberately gets no local copy: nothing they do is saved
   * anywhere, so there is no divergent private version of a drawing they
   * cannot change.
   */
  async function openOrg(id) {
    try {
      const { record, role, sharedByName } = await openOrgProject(id);
      const project = fromCloudRecord(record, allSymbols(record || {}), id);
      if (role !== 'viewer') {
        const res = saveProject(project.id, project);
        if (res.ok) refresh();
      }
      setOpen({
        key: 'org:' + id + ':' + Date.now(),
        projectId: project.id,
        project,
        readOnly: role === 'viewer',
        sharedByName,
      });
      pushToast(role === 'viewer' ? 'Opened (view only)' : 'Opened shared project');
    } catch (err) {
      pushToast('Could not open: ' + err.message);
    }
  }

  async function share(p) {
    // Share what is stored, not what is on screen — the picker is not
    // inside a drawing, and a cloud-only project has no local copy to
    // read from.
    let name = p.name;
    let record = null;
    if (p.where === 'cloud') {
      // Already in the stored shape — copy it across untouched rather
      // than round-tripping it through the redesign's model, which would
      // rewrite fields for no reason on a pure copy operation.
      try {
        record = await loadCloudProject(p.id);
        name = (record && record.name) || name;
      } catch (err) {
        return pushToast('Could not share: ' + err.message);
      }
    } else {
      const rec = loadProject(p.id);
      if (!rec || !rec.drawing) return pushToast('Not found');
      const project = migrateLoadedProject(rec.drawing);
      name = rec.name || project.name || name;
      record = toCloudRecord({ ...project, id: p.id, name }, allSymbols(project));
    }
    const res = await shareProjectToOrg(name, record);
    pushToast(res.ok ? 'Shared "' + name + '" with ' + res.orgName : res.error);
  }

  function remove(id, opts) {
    deleteProject(id);
    // The picker treats a local save and its auto-synced cloud copy as one
    // project. Deleting only one half means the "permanently deleted"
    // drawing reappears from the other on the next refresh.
    if (opts && opts.alsoCloud) deleteCloudCopyOf(id);
    refresh();
  }

  function exit() {
    clearOrgProjectContext();
    setOpen(null);
    refresh();
  }

  // Signing out from inside a drawing must not leave that drawing on
  // screen behind the gate — the gate covers it, but a stale document
  // would still be there (and still autosaving) for the next account.
  useEffect(() => {
    if (!cloud.user && open && cloudConfigured) exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.user]);

  // Nothing is reachable until the session is known. Rendering the picker
  // first and swapping it for the gate a moment later flashes someone
  // else's project list on a shared machine.
  if (cloudConfigured && !cloud.ready) return null;

  // Gated. Production overlays its gate on top of a live app, which
  // leaves the project list underneath focusable by keyboard and
  // readable by a screen reader — visually covered is not the same as
  // unreachable. Nothing behind the gate is rendered at all here.
  const gated = cloudConfigured && (!cloud.user || cloud.gateMode === 'newpassword');
  if (gated) {
    return (
      <>
        <AuthGate onSignedIn={msg => msg && pushToast(msg)} />
        <ToastHost toasts={toasts} />
      </>
    );
  }

  return (
    <>
      {open ? (
        <WorkspaceRoot
          key={open.key}
          projectId={open.projectId}
          initialProject={open.project}
          readOnly={open.readOnly}
          sharedByName={open.sharedByName}
          onExit={exit}
          pushToast={pushToast}
        />
      ) : (
        <ProjectPicker
          projects={projects}
          onOpen={openLocal}
          onOpenCloud={openCloud}
          onOpenOrgProject={openOrg}
          onCreate={create}
          onDelete={remove}
          onShare={share}
          storageError={storageError}
          pushToast={pushToast}
        />
      )}
      <ToastHost toasts={toasts} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
