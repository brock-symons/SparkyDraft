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

**Last synced with origin/main at commit: `c930a57` (2026-09-05)**

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

The full brief driving this work is filed verbatim at
[REDESIGN_DIRECTIVE.md](REDESIGN_DIRECTIVE.md) — 35 numbered sections
covering interaction philosophy, contextual UI, snapping/selection
standards, responsive strategy, what may be changed independently (§31)
vs. requires approval (§32), git safety (§33), and the final product-audit
deliverable expected (§35). Consult it directly for anything not covered
by the summary below, rather than relying on a chat transcript for intent.

`app/` holds an in-progress React + Tailwind redesign of the drafting
workspace. **`index.html` at the repo root is still the live product** and
remains the source of truth for every feature.

As of Phase 11 (2026-09-05) all planned migration phases are complete:
the drafting core, switch linking, circuits, panel schedule + load/
demand, comms racks, quote + price list, civil/underground works,
elevations + legend, print/PDF/export, the whole cloud half (auth, sync,
organisations, sharing, viewer mode), and the integration/security
review + directive §35 product audit (filed at `PRODUCT_AUDIT.md`).
**Still open:** two long-standing partials (Layers, Inspector/
properties), the local-storage cutover decision (R4), a genuinely
signed-in (non-stubbed) pass over the cloud features, and — the actual
gate — the owner's explicit review of the physical cutover itself.
`MIGRATION_INVENTORY.md` §H is the authoritative parity matrix; `PLAN.md`
tracks the phases; `PRODUCT_AUDIT.md` is the §35 deliverable.

- Business logic ported from `index.html` is checked mechanically, not by
  eye: `app/test/*-parity.mjs` extract functions from the LIVE
  `index.html` at run time and compare. Run them all before trusting a
  change to `app/src/core/`.
- **`app/src/core/cloudFormat.js` is load-bearing for the cutover.** The
  Supabase `data` columns are shared with production, so the redesign
  reads and writes PRODUCTION's record shape and converts at that one
  boundary. Do not "simplify" it into writing the redesign's own shape —
  that would silently rewrite existing customer projects into something
  `index.html` renders wrong, the first time autosave fires.

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

### Target end-state (confirmed by the project owner, 2026-09-03)

`app/` is not a permanent side branch or a design experiment — it is meant
to **replace `index.html` as the live product**. Once every feature in
`MIGRATION_INVENTORY.md`'s parity matrix is ported, verified, and `main` is
updated to run `app/`, the root `index.html` app is retired. Plan and
communicate with that end-state in mind, not as an indefinitely-parallel
"redesign branch."

That doesn't change how you get there — the migration inventory's phased
order (§F) and risk register (§G) already reflect the right amount of
caution and don't need re-litigating. It does mean the cutover itself needs
an explicit gate, not just "the last feature got ported." Before `app/` is
proposed as the replacement for `main`, confirm and state plainly in the
PR:

1. **Full parity**, per `MIGRATION_INVENTORY.md`'s own parity matrix (§H) —
   not just the features, the *business logic behind them* (R2, R3, R7, R8
   in the risk register — quote/demand formulas, RLS/permission behaviour,
   derived patch-panel counts, circuit branching) checked against the old
   app's actual output, not re-derived from memory.
2. **Security parity or better**, specifically: the new app is being built
   fresh, which means it can just as easily reintroduce the unescaped-
   `innerHTML` XSS pattern the audit found in the current app
   (`audits/2026-09-03-full-repository-audit.md`, §8.1) — any place org/
   project/user-supplied text reaches the DOM in the new UI needs to go
   through an escaping helper from the start, not bolted on after. RLS
   behaviour (R3/R6/R14) gets verified against the live Supabase project,
   not assumed from reading the policy files.
3. **§35's product audit (per the directive) actually happened** and its
   findings are closed or explicitly accepted by the owner, not just
   produced.
4. **The physical cutover mechanics are a real decision, not an implicit
   one** — does `app/` get promoted to replace the repo root, or does
   `main` start deploying `app/`'s build output while `index.html` moves
   elsewhere for reference? Flag this for the owner rather than picking
   one; it affects every existing link/bookmark/deploy config.
5. Still applies regardless of how close to done this looks: **no push to
   `main` without the project owner's explicit review of that specific
   cutover**, same as every other merge (see Workflow notes below). A full
   product swap is the single highest-stakes merge this repo will see —
   treat the review bar accordingly, not as a formality.

### Code style + AI-authorship policy

**`README.md` is the source of truth for this** (its "Code style for new
work" and "AI-assisted development" sections) — it was merged to `main` in
PR #14 (2026-09-05) after sitting unmerged on a side branch for two days.
Read it there rather than expecting a restatement here; the short version:
`core/` stays framework-free, `ui/` owns chrome only, ported business logic
is extracted verbatim and checked against production's actual output (never
re-derived from memory), and Prettier — not a freehand AI pass — is the only
way dense legacy code gets reformatted.

## Repo / GitHub process

- `main` has branch protection on (enabled 2026-09-05): PRs required, no
  direct push, no force-push. Every change goes through a PR now — the
  git history before this date has several commits that landed by direct
  push instead, which is exactly what this closes off.
- Two CI checks run automatically: `.github/workflows/boot-check.yml` loads
  `index.html` headlessly and fails on any console error;
  `.github/workflows/app-parity-tests.yml` runs `app/test/*.mjs` on any PR
  touching `app/` or `index.html`. Neither existed before PR #14 — the
  parity suite previously only ran when someone remembered to by hand.
- `.github/PULL_REQUEST_TEMPLATE.md` and `.github/ISSUE_TEMPLATE/*` are in
  place; `CONTRIBUTING.md` has the branch/commit/PR conventions in full.
- `audits/2026-09-03-full-repository-audit.md` is the full repo audit
  referenced elsewhere in this file and in `PLAN.md` — it now actually
  exists on `main` (it was written back on 2026-09-03 but stranded on an
  unmerged branch until PR #14).
- Branches are kept clean: once a PR merges, delete its branch. As of
  2026-09-05 the repo has exactly one branch, `main`.

## Workflow notes

- Never merge to `main` without the project owner's explicit review/approval
  for that specific piece of work — a prior blanket "you can merge later" or
  "looks good" does not extend to unrelated future changes.
- Never enter the user's account password into any login field, even with
  explicit permission to do so — this is a hard rule, not a judgment call.
  Use the local (non-cloud) `storageAPI` path to test persistence instead.
