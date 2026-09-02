# SparkyDraft

Single-file vanilla-JS web app for electrical drafting, plus civil/underground
works planning, comms/data rack wiring, circuits, panel schedules, quoting,
and PDF export. The entire app lives in `index.html` (~9,000 lines), no build
step. Supabase provides auth, cloud project sync, and org sharing.

**This file is a living map, not a snapshot.** This repo gets substantial
commits from other Claude Code sessions independent of whichever session is
reading this — sometimes several large features in a day. Before relying on
anything below, run `git fetch && git log <last-synced-commit>..origin/main`
and skim the diffs (cheap) rather than assuming this file or your own memory
of the code is current. Update the "Last synced" line and the relevant
section below whenever you do.

**Last synced with origin/main at commit: `da1ec6d` (2026-09-03)**

## Core architecture

- `state` holds `floors[]` (electrical rough-in plans), `civilPlans[]` (a
  parallel structure for underground/civil works), `circuits[]`, `layers[]`,
  `customSymbols[]`.
- `currentPlan()` returns `currentFloor()` or `currentCivilPlan()` depending
  on `state.activePlanType`, toggled via the `#civilModeToggle` button
  (`html.civil-mode` class mirrors this for CSS).
- `SYMBOL_LIBRARY` is the master device/symbol catalog: `id`, `category`,
  `defaultProps`, `color`, `abbr`. `sym.id==='patch_panel'` is excluded from
  the placement grid (it's derived from a comms rack's port count, not a
  placeable device) but stays in the library so price-list edits and quote
  lookups still resolve it.
- `storageAPI` is dual-mode persistence: `window.storage` when running
  inside the Claude artifact sandbox, otherwise a `localStorage` fallback.
  Keys are `project:<id>` plus a `last-open-project` pointer. Local save/load
  works with no login at all — useful for testing persistence without
  needing real credentials.
- Supabase handles auth, cloud project sync, and multi-org sharing
  (`activeOrgId` global; an org can have multiple members with an
  accept/decline invite flow — see `supabase-organization-invite-accept.sql`).

## Desktop vs. mobile layout

- Dark/compact mobile is the base CSS. A separate bright "desktop" theme is
  applied via the `html.force-desktop` class — **not** a media query. (It
  used to be `@media (min-width:1400px)`; that was removed because a
  width-based rule can't be overridden by an explicit user choice.)
- The layout is chosen once, via a chooser shown right after sign-in
  (`initLayoutPref`, `localStorage['sparkydraft_layout_pref']` =
  `'desktop'|'mobile'`), and changed later only from the projects screen (🖥
  button) — never from inside an open project.
- **Critical invariant:** the plan canvas always paints itself dark
  (`#0c1116`) regardless of theme — deliberate, light chrome around a dark
  drawing surface, a common CAD convention. Any UI floating *over* the
  canvas (tool hint, zoom badge, fit button, multi-select bar) must use the
  theme-independent `--hud-*` tokens, never `--text`/`--panel` — those flip
  to dark-on-light in the desktop theme and go invisible against the canvas.
  This exact bug has already been found and fixed once; don't reintroduce it
  when adding new canvas-overlay UI.
- Desktop docks Layers (left) and Symbols/Props (right, mutually exclusive
  via `html.props-active`) as permanent sidebars sized by the
  `--layers-w`/`--symbols-w`/`--rail-w` CSS vars, plus a hot-task rail
  (select/pan/place/measure/link/calibrate/layers) on the far left.
- **Any JS that changes the docked-panel layout** (layout switch, dock
  collapse/expand) **must dispatch a `resize` event** — fired immediately
  and again ~260ms later (to survive the CSS `.2s` panel-width transition) —
  or the `<canvas>` bitmap goes stale. Its pixel size is set imperatively
  from `wrap.clientWidth/Height` in `resizeCanvas()`, not automatically by
  CSS. This has already caused one real bug (dock-collapse never resizing
  the canvas); the pattern to copy is in `initLayoutPref`'s `apply()`.

## Feature subsystems (search by function-name prefix)

- **Electrical rough-in** — the original/default mode. `render()`, and
  `pointerdown`/`move`/`up` handlers on `#canvas`.
- **Civil/underground works** (added after the desktop redesign, by another
  session) — `renderCivil()`, `pointerdownCivil()`, `snapPointCivil()`,
  `endPointerCivil()`. `state.civilPlans[]` holds `pits`, `conduits`,
  `buildingEntries`, `poles`, `overheadRuns`, `dimensions` per plan — same
  shape idea as `floors[]`. Has its own quote (`updateCivilQuote()`,
  `computeAllCivilTotals()`) and legend/PDF export
  (`computeCivilLegendEntries()`).
- **Comms/data racks** — a separate "home run" wiring system from
  electrical circuits. `symbolId==='comms_rack'`, ports live on
  `obj.commsPorts[]`, managed via `renderCommsRacksSheet()`.
- **Circuits** — `state.circuits[]`, branching power/hard-active runs.
  `renderCircuits()` feeds the Panel Schedule (`renderPanelSchedule()`,
  per-circuit cable-run estimates) and the Quote (`updateQuote()`, with a
  quantity-summary toggle).
- **Print/PDF export** — `openPrintView()` (on-screen preview) and
  `downloadPdfExport()` (a real local PDF via jsPDF, loaded from CDN).
- **Desktop-only conveniences** (from the redesign) — command palette
  (Ctrl+K), right-click context menu, resizable docked panels, dock-collapse
  toggles. The command palette's command list is hand-maintained
  (`initCommandPalette`'s `commands` array) — it has already fallen behind
  once when a new sheet/toolbar action was added elsewhere and not mirrored
  there. Check it whenever you add a new top-level action.
- **Placement hotkeys** — `R` resumes placing `state.lastPlacedSymbolId`;
  holding Shift while placing keeps placement mode active instead of
  reverting to Select. Don't repurpose `R`/Shift in placement-adjacent code.

## `app/` — the React CAD workspace redesign (branch work, NOT live)

`app/` holds an in-progress React + Tailwind redesign of the drafting
workspace. **`index.html` at the repo root is still the live product** and
remains the source of truth for every feature. `app/` currently covers the
core drafting experience only (project browser, canvas, place/select/move,
layers, contextual inspector, floor-plan underlay, calibration, command
palette, context menu, local save/load). It does NOT yet include civil
works, comms racks, circuits, panel schedule, quoting, PDF export or
multi-org.

- `app/src/core/` is framework-free and DOM-free — catalog, geometry,
  snapping, document+history, command registry, renderer, interaction
  controller. Nothing here imports React.
- `app/src/ui/` is React and owns chrome only. React does not re-render
  during a drag; the controller mutates and the canvas repaints on one rAF.
- `app/src/core/catalog.js` is extracted **verbatim** from the root
  `index.html`. It drives quoting and load estimates, so re-extract rather
  than hand-editing if the root catalog changes.
- One command registry (`core/commands.js`) feeds the palette, keyboard
  shortcuts, tooltips and the context menu. Add an action there once and it
  appears everywhere — this exists specifically because the live app's
  hand-maintained palette array drifted out of sync with its toolbar.
- There is **no build step** (no Node on the build machine). `app/index.html`
  contains a small in-browser ES-module loader that Babel-transforms JSX and
  caches modules by URL. It is deliberately isolated and deletable in one
  commit once Vite is introduced.

## Workflow notes

- Never merge to `main` without the project owner's explicit review/approval
  for that specific piece of work — a prior blanket "you can merge later" or
  "looks good" does not extend to unrelated future changes.
- Never enter the user's account password into any login field, even with
  explicit permission to do so — this is a hard rule, not a judgment call.
  Use the local (non-cloud) `storageAPI` path to test persistence instead.
