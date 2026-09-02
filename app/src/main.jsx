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

import { createDocument, emptyDrawing } from './core/document.js';
import { createController } from './core/controller.js';
import { createCommandRegistry, matchesShortcut, isTypingTarget } from './core/commands.js';
import { boundsOf, viewForBounds } from './core/geometry.js';
import { SYMBOL_LIBRARY } from './core/catalog.js';
import {
  listProjects, loadProject, saveProject, deleteProject, newProjectId,
  loadWorkspaceUI, saveWorkspaceUI, SaveState,
} from './core/persistence.js';

import { ToastHost, useToasts, useBreakpoint } from './ui/primitives.jsx';
import { Workspace } from './ui/Workspace.jsx';
import { Inspector, inspectorTitle } from './ui/Inspector.jsx';
import { LibraryPanel, LayersPanel } from './ui/Panels.jsx';
import { CommandPalette } from './ui/CommandPalette.jsx';
import { ProjectPicker } from './ui/ProjectPicker.jsx';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const symbolFor = id => SYMBOL_LIBRARY.find(s => s.id === id);
const AUTOSAVE_MS = 1200;

function WorkspaceRoot({ projectId, onExit, pushToast }) {
  const breakpoint = useBreakpoint();

  // --- document ------------------------------------------------------
  const docRef = useRef(null);
  if (!docRef.current) docRef.current = createDocument(emptyDrawing());
  const doc = docRef.current;

  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender(n => n + 1), []);

  // --- view (kept in a ref: panning must not re-render React) --------
  const viewRef = useRef({ zoom: 1, offsetX: 0, offsetY: 0 });
  const viewportRef = useRef({ width: 0, height: 0 });
  const [viewTick, setViewTick] = useState(0);
  const getView = useCallback(() => viewRef.current, []);
  const setView = useCallback(v => { viewRef.current = v; setViewTick(t => t + 1); }, []);
  const getViewport = useCallback(() => viewportRef.current, []);

  // --- controller ----------------------------------------------------
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createController({
      doc, getView, setView, getViewport, onChange: rerender,
    });
    controllerRef.current.setSymbolResolver(symbolFor);
  }
  const controller = controllerRef.current;

  // --- workspace UI state (persisted, §3 "intelligently remembered") -
  const savedUI = useRef(loadWorkspaceUI()).current;
  // Defaults differ by device on purpose (§11). On desktop the inspector
  // is docked beside the drawing and costs nothing, so it starts open.
  // Below desktop it OVERLAYS the drawing, so defaulting it open would
  // bury the canvas behind a sheet the moment a job is opened — the exact
  // opposite of canvas-first. Panels are still remembered per device once
  // the user chooses; this only sets the first-run state.
  const [panels, setPanels] = useState(() => {
    const desktop = window.innerWidth >= 1024;
    // Docked panels are restored; overlay sheets are NOT. Below desktop a
    // panel covers the drawing, so restoring one means reopening a job and
    // finding the plan hidden behind a sheet you have to dismiss before
    // you can see your own work. Docks cost no canvas, so remembering
    // those is a convenience rather than an obstacle.
    if (!desktop) return { left: null, right: null };
    return savedUI.panels || { left: null, right: 'inspector' };
  });
  const [dockWidths, setDockWidths] = useState(savedUI.dockWidths || { left: 232, right: 264 });
  const [favourites, setFavourites] = useState(savedUI.favourites || []);
  const [recent, setRecent] = useState(savedUI.recent || []);
  const [sections, setSections] = useState(
    savedUI.sections || { drawing: true, grid: true, general: true, electrical: true, cost: false, align: true, actions: true }
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

  // --- persistence ---------------------------------------------------
  const [projectName, setProjectName] = useState('Untitled project');
  const [saveState, setSaveState] = useState(SaveState.SAVED);
  const [saveError, setSaveError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const saveTimer = useRef(null);

  const doSave = useCallback(() => {
    clearTimeout(saveTimer.current);
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
    });
  }, [doc, projectId, projectName]);

  // Load once per project.
  useEffect(() => {
    const rec = loadProject(projectId);
    if (rec && rec.drawing) {
      doc.load(rec.drawing);
      setProjectName(rec.name || rec.drawing.name || 'Untitled project');
      setLastSavedAt(rec.updatedAt);
    } else {
      doc.load(emptyDrawing());
    }
    setSaveState(SaveState.SAVED);
    // Frame the drawing once the canvas has its real size.
    const t = setTimeout(() => fit(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Debounced autosave, driven by real document mutations.
  useEffect(() => {
    return doc.subscribe((_, detail) => {
      rerender();
      if (!detail || detail.type === 'saved' || detail.type === 'load') return;
      setSaveState(SaveState.UNSAVED);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(doSave, AUTOSAVE_MS);
    });
  }, [doc, doSave, rerender]);

  // Renaming is a document-level change too — it marks unsaved and
  // autosaves like any other edit, rather than silently not persisting.
  const renameProject = useCallback(name => {
    setProjectName(name);
    setSaveState(SaveState.UNSAVED);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, AUTOSAVE_MS);
  }, [doSave]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Warn before losing unsaved work on tab close (§17).
  useEffect(() => {
    const onBeforeUnload = e => {
      if (doc.isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [doc]);

  // --- view helpers --------------------------------------------------
  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp.width) return;
    const objs = doc.state.objects;
    setView(viewForBounds(boundsOf(objs), vp.width, vp.height));
  }, [doc, setView]);

  const zoomToSelection = useCallback(() => {
    const vp = viewportRef.current;
    const sel = controller.selectedObjects();
    if (!sel.length || !vp.width) return;
    setView(viewForBounds(boundsOf(sel), vp.width, vp.height, 120));
  }, [controller, setView]);

  const onViewportChange = useCallback(size => { viewportRef.current = size; }, []);

  // --- panels --------------------------------------------------------
  const togglePanel = useCallback((slot, value) => {
    setPanels(p => ({ ...p, [slot]: p[slot] === value ? null : value }));
  }, []);

  const onDockResize = useCallback((slot, clientX) => {
    setDockWidths(w => {
      // Left dock sits after a 44px rail; right dock is measured from the
      // window edge. Both clamped so a panel can't be dragged to nothing
      // (use the collapse toggle for that) or swallow the canvas.
      const next = slot === 'left'
        ? Math.max(180, Math.min(420, clientX - 44))
        : Math.max(200, Math.min(460, window.innerWidth - clientX));
      return { ...w, [slot]: next };
    });
  }, []);

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
    const hasSel = c => c.controller.selectedIds.size > 0;
    const hasMulti = c => c.controller.selectedIds.size > 1;

    r.registerAll([
      // Tools
      { id: 'tool.select', title: 'Select tool', group: 'Tools', shortcut: 'V', icon: '⌖',
        keywords: 'arrow pointer pick', run: c => c.controller.setTool('select') },
      { id: 'tool.pan', title: 'Pan tool', group: 'Tools', shortcut: 'H', icon: '✋',
        keywords: 'hand scroll move view', run: c => c.controller.setTool('pan') },
      { id: 'tool.measure', title: 'Measure tool', group: 'Tools', shortcut: 'M', icon: '↔',
        keywords: 'distance dimension ruler', run: c => c.controller.setTool('measure') },

      // Edit
      { id: 'edit.undo', title: 'Undo', group: 'Edit', shortcut: 'Mod+Z', icon: '↶',
        keywords: 'revert back', when: c => c.doc.canUndo, run: c => { c.doc.undo(); c.controller.clearSelection(); } },
      { id: 'edit.redo', title: 'Redo', group: 'Edit', shortcut: 'Mod+Shift+Z', icon: '↷',
        keywords: 'forward again', when: c => c.doc.canRedo, run: c => c.doc.redo() },
      { id: 'edit.duplicate', title: 'Duplicate', group: 'Edit', shortcut: 'Mod+D', icon: '⧉',
        keywords: 'copy clone', when: hasSel, run: c => c.controller.duplicateSelected() },
      { id: 'edit.delete', title: 'Delete', group: 'Edit', shortcut: 'Delete', icon: '⌫',
        keywords: 'remove erase', danger: true, when: hasSel, run: c => c.controller.deleteSelected() },
      { id: 'edit.selectAll', title: 'Select all', group: 'Edit', shortcut: 'Mod+A', icon: '⬚',
        keywords: 'everything', run: c => c.controller.selectAll() },
      { id: 'edit.deselect', title: 'Deselect', group: 'Edit', shortcut: 'Escape',
        keywords: 'clear selection none', when: hasSel, run: c => c.controller.clearSelection() },

      // Arrange
      { id: 'arrange.alignLeft', title: 'Align left', group: 'Arrange', icon: '⇤', when: hasMulti, run: c => c.controller.alignSelected('left') },
      { id: 'arrange.alignRight', title: 'Align right', group: 'Arrange', icon: '⇥', when: hasMulti, run: c => c.controller.alignSelected('right') },
      { id: 'arrange.alignTop', title: 'Align top', group: 'Arrange', icon: '⤒', when: hasMulti, run: c => c.controller.alignSelected('top') },
      { id: 'arrange.alignBottom', title: 'Align bottom', group: 'Arrange', icon: '⤓', when: hasMulti, run: c => c.controller.alignSelected('bottom') },
      { id: 'arrange.distributeH', title: 'Distribute horizontally', group: 'Arrange', icon: '⇹',
        when: c => c.controller.selectedIds.size > 2, run: c => c.controller.distributeSelected('h') },
      { id: 'arrange.distributeV', title: 'Distribute vertically', group: 'Arrange', icon: '⇳',
        when: c => c.controller.selectedIds.size > 2, run: c => c.controller.distributeSelected('v') },

      // View
      { id: 'view.fit', title: 'Fit drawing to screen', group: 'View', shortcut: 'Shift+F', icon: '⛶',
        keywords: 'zoom extents all', run: c => c.fit() },
      { id: 'view.zoomSelection', title: 'Zoom to selection', group: 'View', shortcut: 'Shift+2', icon: '⊙',
        keywords: 'focus', when: hasSel, run: c => c.zoomToSelection() },
      { id: 'view.zoomIn', title: 'Zoom in', group: 'View', icon: '+', run: c => c.controller.zoomBy(1.2) },
      { id: 'view.zoomOut', title: 'Zoom out', group: 'View', icon: '−', run: c => c.controller.zoomBy(1 / 1.2) },
      { id: 'view.toggleSnap', title: 'Toggle snapping', group: 'View', shortcut: 'Shift+S', icon: '⌗',
        keywords: 'grid align magnet',
        run: c => c.doc.commit('Toggle snapping', d => { d.snapEnabled = d.snapEnabled === false; }) },

      // Panels
      { id: 'panel.layers', title: 'Toggle layers panel', group: 'Panels', shortcut: 'L', icon: '▤',
        keywords: 'visibility lock', run: c => c.togglePanel('left', 'layers') },
      { id: 'panel.library', title: 'Toggle component library', group: 'Panels', shortcut: 'P', icon: '⊞',
        keywords: 'place device symbol add', run: c => c.togglePanel('left', 'library') },
      { id: 'panel.inspector', title: 'Toggle properties panel', group: 'Panels', shortcut: 'I', icon: '☰',
        keywords: 'inspector details', run: c => c.togglePanel('right', 'inspector') },

      // Project
      { id: 'project.save', title: 'Save', group: 'Project', shortcut: 'Mod+S', icon: '⤓',
        keywords: 'store write', run: c => c.doSave() },
      { id: 'project.close', title: 'Close drawing', group: 'Project', icon: '←',
        keywords: 'back exit projects', run: c => c.onExit() },

      // App
      { id: 'app.palette', title: 'Command palette', group: 'App', shortcut: 'Mod+K', icon: '⌘',
        keywords: 'search commands actions', run: c => c.openPalette() },
    ]);
    return r;
  }, []);

  // Context object handed to every command's `when` and `run`.
  const ctx = useMemo(() => ({
    doc, controller, fit, zoomToSelection, togglePanel, doSave, onExit,
    openPalette: () => setPaletteOpen(true),
    pushToast,
  }), [doc, controller, fit, zoomToSelection, togglePanel, doSave, onExit, pushToast]);

  // --- keyboard layer (§10) ------------------------------------------
  useEffect(() => {
    function onKeyDown(e) {
      // Palette first: Mod+K must work even while a field has focus, or
      // it stops being a universal entry point.
      if (matchesShortcut(e, 'Mod+K')) { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if (paletteOpen) return;                 // palette owns its own keys
      if (isTypingTarget(document.activeElement)) return;

      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); controller.setSpaceHeld(true); return; }

      // Escape backs out of the current mode before clearing selection —
      // one predictable "get me out of here" key (§10).
      if (e.key === 'Escape') {
        if (controller.tool !== 'select') { controller.setTool('select'); return; }
        if (controller.selectedIds.size) { controller.clearSelection(); return; }
        return;
      }

      // Arrow-key nudging: 1 grid step, or 1 unit with Alt for fine work.
      if (e.key.startsWith('Arrow') && controller.selectedIds.size) {
        const step = e.altKey ? 1 : (doc.state.gridSpacing || 40);
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) { e.preventDefault(); controller.nudgeSelected(d[0], d[1]); return; }
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
    for (const o of doc.state.objects) {
      const s = symbolFor(o.symbolId);
      if (s) counts[s.category] = (counts[s.category] || 0) + 1;
    }
    return counts;
  }, [doc.state.objects]);

  const leftPanel = panels.left === 'layers'
    ? <LayersPanel doc={doc} counts={layerCounts} />
    : panels.left === 'library'
      ? <LibraryPanel
          controller={controller}
          favourites={favourites}
          recent={recent}
          onToggleFavourite={toggleFavourite}
          autoFocus={breakpoint === 'desktop'}
        />
      : null;

  const rightPanel = <Inspector doc={doc} controller={controller} sections={sections} toggleSection={toggleSection} />;

  return (
    <>
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
        leftPanelTitle={panels.left === 'layers' ? 'Layers' : 'Components'}
        rightPanelTitle={inspectorTitle(controller)}
        onFit={fit}
        onViewportChange={onViewportChange}
        breakpoint={breakpoint}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} registry={registry} ctx={ctx} />
    </>
  );
}

function App() {
  const [projectId, setProjectId] = useState(null);
  const [projects, setProjects] = useState(() => listProjects());
  const [storageError, setStorageError] = useState(null);
  const [toasts, pushToast] = useToasts();

  const refresh = useCallback(() => setProjects(listProjects()), []);

  function create() {
    const id = newProjectId();
    const res = saveProject(id, { ...emptyDrawing(), name: 'Untitled drawing' });
    if (!res.ok) { setStorageError(res.error); return; }
    refresh();
    setProjectId(id);
  }

  function remove(id) {
    deleteProject(id);
    refresh();
  }

  function exit() {
    setProjectId(null);
    refresh();
  }

  return (
    <>
      {projectId
        ? <WorkspaceRoot projectId={projectId} onExit={exit} pushToast={pushToast} />
        : <ProjectPicker
            projects={projects}
            onOpen={setProjectId}
            onCreate={create}
            onDelete={remove}
            storageError={storageError}
          />}
      <ToastHost toasts={toasts} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
