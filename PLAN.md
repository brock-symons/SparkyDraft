# Migration plan — remaining work

Working plan for finishing the `app/` migration. Companion to
[MIGRATION_INVENTORY.md](MIGRATION_INVENTORY.md) (what exists and what's
missing) and [REDESIGN_DIRECTIVE.md](REDESIGN_DIRECTIVE.md) (the brief).
This file is the **live checklist**; the inventory is the audit it's built on.

Tracked as a committed file rather than a GitHub Issue to match this repo's
precedent — it has never used issues (0 ever opened); planning lives in
versioned markdown next to the code.

| | |
|---|---|
| Branch | `feature/cad-workspace-redesign` |
| Status | Phases 0-11 complete · **all planned phases done — cutover to `main` awaits the owner's explicit review (see Cutover gate below)** |
| Merged to main | **No — and not without explicit owner review** |
| Last updated | 2026-09-05 |

---

## Where things stand

**Done:** the drafting substrate — canvas, pan/zoom, snapping (with the
"why it snapped" readout), selection/hover/marquee, align/distribute,
undo/redo, layers, plan import + calibration, command registry driving
palette/shortcuts/tooltips/context-menu, three responsive models, and as of
Phase 0 a project-of-floors document model.

**Also done (Phases 2–8):** switch linking + lighting banks, circuits,
panel schedule + load/demand, comms racks, quote + price list, civil/
underground works, elevations + legend — each checked by a parity test
against the live `index.html` (panel schedule, comms migration, quote,
civil, and legend; 13,455 comparisons total, all matching).

**Also done (Phase 10, out of order at the owner's direction):** auth,
cloud project sync, organisations, members, invites, sharing, per-project
access and viewer mode — with the cloud record format made interoperable
with production's, so a project either app writes opens in the other.

**Also done (Phase 9):** print view, jsPDF export, save-as-PDF dialog,
civil pages toggle, JSON project download — all parity-tested against
production's actual capture/export output where that's meaningful (the
legend data, labels, colours and filenames; not byte-for-byte image
comparison, which no parity test in this migration attempts).

**Also done (Phase 11):** full end-to-end workflow, undo/redo and
persistence verified against real stored data, three responsive
breakpoints tested live, RLS re-verified against the live project, one
regression fix (picker device count), and the directive's §35 product
audit filed at [PRODUCT_AUDIT.md](PRODUCT_AUDIT.md).

**Not done:** the local-storage cutover decision (R4), a genuinely
signed-in (non-stubbed) pass over the cloud features, and the physical
cutover mechanics — all explicitly owner-only, per PRODUCT_AUDIT.md's
closing summary.

---

## Phase 0 — Document model ✅ done (`7e3ab07`)

Reshaped `emptyDrawing()` (single flat drawing) into `emptyProject()`
owning `floors[]`, with later-phase collections reserved. Adopted two
production semantics over the redesign's simplifications: real-millimetre
grid spacing, and `scale` as world-units-per-metre. Added
`migrateFlatDrawing()` so pre-Phase-0 test saves aren't orphaned.

Tested in-browser: create → place → autosave → reload → reopen round-trips,
zero console errors.

---

## Remaining phases

Order follows the inventory's dependency analysis (§F), not the directive's
original §7 — the inventory found dependencies that make a different order
safer, and §7 permits that.

### Phase 1 — Canvas primitives ✅ complete

- [x] **Cable routes, walls, dimensions** (`5c4e078`) — shared two-click
      draw with rubber-band preview, production-identical id/shape,
      independent selection, contextual inspector, delete + undo.
- [x] **Rooms** (`83f3ab8`) — name+id model matching production, single and
      bulk assignment, delete unassigns rather than deletes.
- [x] **Custom fittings** (`83f3ab8`) — production-identical shape; fixed a
      real bug where symbol resolution was catalog-only, which would have
      rendered custom devices as '?' and priced them at zero.
- [x] **Version history** (`83f3ab8`) — jump to any point. Required
      replacing the undo stacks with a linear timeline; jumping does not
      truncate the future.
- [x] **Symbol size** (`83f3ab8`) — 12/16/22; hit-test tolerance tracks the
      drawn size so clickable matches visible.
- [x] **Duplicate-device finder** (`83f3ab8`) — detection ported verbatim,
      with a preview before removal.

**Why first:** circuits need cables; the panel schedule's cable-run
estimate needs both cables and calibration.

### Phase 2 — Switch linking + lighting banks ✅ complete

- [x] **Switch links + banks** (`1e32fdd`) — logic stored, physical
      wiring derived; two-way collapses to one bank with several tails.
- [x] **Gang counts** (`1e32fdd`) — by switching function, Tastic rules
      intact, only ever raised.
- [x] **Auto-grouping + explicit new gang** (`1e32fdd`)
- [x] **Bank naming** (`1e32fdd`) — `switchId::group`, derived fallback.

Also fixed here: hidden layers were drawn anyway (only hit-testing
respected them), and arming the link tool from an overlay inspector left
the inspector covering the plan you had to tap.

**Why before circuits:** circuit assignment propagates through switch links.

### Phase 3 — Circuits ✅ complete

- [x] **Circuit CRUD** (`7b891b0`) — production's field shape, panel +
      dialog, duplicate-id guard, delete unassigns across all floors.
- [x] **Assignment** (`7b891b0`) — per device and in bulk; hard-active
      switches propagate to their linked lights.
- [x] **Branching runs** (`7b891b0`) — `computeChainEdges()` ported
      verbatim (degree-constrained tree, board capped at one feed).
- [x] **Isolate view + circuit labels + switch-run overlay** (`7b891b0`)

Fixed here: the linked-switchboard select returned a string against
numeric device ids, so every circuit silently fell back to "whichever
board is on this floor". The link tool's shortcut moved L → K, which
the Layers panel already owned.

### Phase 4 — Panel schedule + load/demand ✅ complete

- [x] **Demand estimate + panel schedule** (`149a0e3`) — grouped by
      board, capacity check, over-rated protection warnings.
- [x] **Cable-run estimate** (`149a0e3`) — follows the same tree drawn on
      the plan; other-floor devices reported, never silently dropped.
- [x] **Board main-switch ratings** (`149a0e3`)
- [x] **Text export** (`149a0e3`) — production's format, line for line.
- [x] **Parity check against production** (`149a0e3`) —
      `app/test/panel-schedule-parity.mjs`, 4,326 comparisons, all match.
      Run it with `node app/test/panel-schedule-parity.mjs`.

The cable estimate covers hard-active runs only. Extending it to the
cable that actually switches a light/fan is an explicit owner decision
(see the scope note in `core/panelSchedule.js`) — not to be built
speculatively.

### Phase 5 — Comms racks ✅ complete

- [x] **Racks + ports** (`2eba280`) — 24 slots on placement, panel to
      manage them, patch panels derived not placed.
- [x] **Home-run assignment** (`2eba280`) — one run per outlet, drawn
      point-to-point, port label on the plan.
- [x] **`migrateLegacyCommsData()`** (`2eba280`) — ported first, run
      through one load entry point, and parity-tested over 300
      randomised old-format projects
      (`node app/test/comms-migration-parity.mjs`).

Also fixed: patch_panel was placeable here but is hidden from
production's placement grid — placing one would have double-counted
against the derived panel.

### Phase 6 — Quote + price list ✅ complete

- [x] **Quote totals** (`3bf0e30`) — verbatim, incl. GST compounding on
      margin and derived patch panels; parity-tested (2,924 comparisons).
- [x] **Itemised / quantity-summary toggle** (`3bf0e30`) — grouping keyed
      by device type + switch gang + floor, as production does.
- [x] **Per-object price/labour overrides** (`3bf0e30`)
- [x] **Labour / margin / equipment / travel** (`3bf0e30`) — persisted on
      the project, production's defaults.
- [x] **Price list editing** (`3bf0e30`) — per project, and persisted
      (see the deviation note below).
- [x] **Quote export** (`3bf0e30`) — production's text format.

**Deviation, flagged for owner review:** the current app edits its global
SYMBOL_LIBRARY and loses the edits on reload. That is not reproducible
here (catalog.js must stay a byte-comparable extraction), so price edits
live on the project and persist with it.

Also landed here: the error boundary from the follow-up list, after a
missing import blanked the page twice in one session.

### Phase 7 — Civil / underground ✅ complete

- [x] **Civil catalog** — five libraries extracted verbatim into
      `core/civilCatalog.js` and .prettierignore'd, same rule as
      `catalog.js`.
- [x] **Plan model + multi-plan management** — `civilPlans[]`, add/
      switch/rename/delete, per-plan view, scale, grid and content.
- [x] **Five entity types** — pits, conduit (electrical + comms), poles
      (private + network), overhead runs, building entries.
- [x] **Multi-point polyline drawing** — click to start, click per bend,
      click a pit/entry/pole to finish and link, Enter finishes
      unlinked, Esc cancels; degenerate runs discarded.
- [x] **Civil snapping** — pit/entry/pole centre → conduit vertex →
      grid, reported in the status bar like the electrical snapper.
- [x] **Civil rendering** — separate pass; three conduit colour families,
      dashed overhead, hollow network poles, rotated-square entries,
      vertex handles, drafts, ghosts.
- [x] **Selection, dragging and vertex editing** — endpoint drags
      re-link or unlink; interior bends carry no link.
- [x] **Civil materials takeoff + legend + text export**
- [x] **Civil quote integration** — whole-job line on the main quote.
- [x] **Mode switching** — segmented control; tools, panels, inspector,
      status bar and canvas all follow the mode.
- [x] **Parity check** — `app/test/civil-parity.mjs`, 4,955 comparisons
      against the live `index.html`, all matching.

### Phase 8 — Elevations + legend ✅ complete

**The blocking owner decision resolved itself on inspection, not by
judgment call.** Production's `#elevCanvas` has no pointer handlers at
all — every item is added through a number-entry form (device, distance
from the left edge in mm, installation height in mm), and the canvas
only ever redraws a live preview of that data. No pan, no zoom, no
snapping, nothing resembling the floor/civil drafting model. So it is
not a third plan type; built as what it actually is: a report-style
dialog (same shape as Quote/Panel Schedule/Civil Materials) with a live
schematic preview. No navigation change, nothing §32 reserves for the
owner. See MIGRATION_INVENTORY.md §I item 1.

- [x] **Elevations** (`core/elevations.js`) — project-level named
      elevations, each a labelled wall (width/height in mm) holding a
      flat item list ({symbolId, x_mm, height_mm}). Add/select/rename/
      delete elevation, add/delete item, all through `doc.commit` so
      undo/redo and persistence come for free.
- [x] **Live schematic preview** — `elevationLayout()`/
      `elevationItemPoint()` port `drawElevation()`'s scale-to-fit math
      verbatim; a small canvas component redraws on data change. Dark
      background + filled-circle markers match the civil renderer's
      visual language (same CAD convention, not app chrome), consistent
      with production's own filled-circle + dark-abbreviation style.
- [x] **Legend** (`core/legend.js`) — per-floor tally grouped by device
      type and switch gang, patch panels derived from each floor's rack
      ports, sorted exactly as production does (including the
      category-vs-CATEGORY_ORDER quirk — preserved, not "fixed", since
      changing it would reorder every legend a job has already printed).
      Symbol lookup goes through the project-aware resolver rather than
      SYMBOL_LIBRARY directly, matching the fix already applied to the
      quote and panel schedule — production's own lookup silently drops
      a custom fitting from the legend.
- [x] **Show circuit/port IDs on plan** and **show switch/cable runs on
      plan** toggles moved from palette-only commands to visible switches
      in the Layers panel, directly above the legend — matching where
      production keeps them, on the same sheet they annotate.
- [x] **Parity check** — `app/test/legend-parity.mjs`, 350 comparisons
      against the live `index.html` (every catalog symbol individually,
      300 randomised floors, patch-panel derivation, unknown-symbol
      handling), all matching. Run with
      `node app/test/legend-parity.mjs`.

Verified in the browser: elevation created and selected automatically,
device item added and positioned correctly on the live preview (checked
against the layout math by hand), a corrupted manual input degraded
safely (item positioned off-canvas, no crash) rather than being
silently clamped, delete/undo/redo round-tripping an entire elevation
with its items, persistence through a full page reload, the two Layers
toggles driving the existing `toggleCircuitLabels`/`toggleSwitchRuns`
controller functions with visible effect on the canvas, and a full
regression pass across Phases 1–7 (circuits, quote, panel schedule,
comms racks, civil materials, civil plan switching) with zero new
console errors.

### Phase 9 — Print / PDF / export ✅ complete

Taken after Phase 10 (which itself jumped ahead of this one at the
owner's direction) — by this point every subsystem it renders (circuits,
panel schedule, comms, quote, civil, elevations, legend) was already
done, so there was nothing left for it to wait on.

- [x] **Print view** (`PrintExportDialog` in `main.jsx`) — a full-screen
      review, not the usual small `Dialog`, matching production's own
      `#printView` being a distinct page-review surface rather than a
      modal card. One page per floor, plus one per civil plan when the
      toggle is on.
- [x] **Capture pipeline** (`core/print.js`) — an OFFSCREEN canvas at
      production's exact 1600×1131 resolution, using the SAME
      `renderScene`/`renderCivilScene` the live canvas uses (now with a
      `printMode` flag: white background, no grid/origin, every switch/
      circuit/comms run and circuit label forced on) rather than a
      parallel print-only renderer that could quietly drift from what the
      live drawing shows. Current layer visibility IS still respected — a
      hidden layer stays hidden on the printed page, exactly like
      production.
- [x] **PDF export** (`drawPdfPage()`) — jsPDF, same CDN and pinned
      version as production. The legend is drawn as real vector text, not
      a screenshot of the HTML preview, so it stays crisp at any zoom.
      Same "Save As" file-picker fallback chain production uses
      (`showSaveFilePicker` where supported, else a plain download).
- [x] **Civil pages toggle** — on by default, rebuilds the page list
      in-place, same as production re-running `openPrintView()`.
- [x] **Download project copy (JSON)** — writes production's own record
      shape (`core/cloudFormat.js`'s `toCloudRecord`), so a downloaded
      backup opens correctly in either app.
- [x] **Parity check** — `app/test/print-parity.mjs`, 238 comparisons:
      `hexToRgb()` (a true standalone function, extracted the normal way)
      plus the legend-row label/colour/abbreviation logic and both
      filename sanitizers, hand-transcribed from index.html's inline
      template-literal fragments (not standalone functions, so
      `extractFunction` can't reach them) and diffed against the quoted
      source lines in the test file itself.

**Verified in the browser:** both a floor page (two devices, correct
legend grouping including the gang suffix) and a civil page (a pit,
correct legend) rendered with a white background and no grid; the civil
toggle removing/restoring the civil page; "Save as PDF" completing with
no thrown error and the button label resetting; the dialog closing
cleanly back to an intact workspace; and a regression check that Quote
still opens correctly afterward.

### Phase 10 — Auth, Supabase, orgs, sharing ✅ complete

### Phase 10 — Auth, Supabase, orgs, sharing
Auth gate, OTP verify, password reset, session handling, account sheet,
cloud project CRUD, organisations, members/roles, invitations, project
sharing, per-project access, read-only viewer mode, report-a-problem.
**Largest security surface.** Deliberately late: wiring cloud sync to a
still-moving data model would mean migrating stored records twice.

### Phase 10 — Auth, Supabase, orgs, sharing ✅ complete

Taken ahead of Phase 9 at the owner's direction (5 Sep 2026). Nothing in
it depended on print/PDF, and the data model it needed was already final.

- [x] **Every Supabase call ported call-for-call** (`core/cloud.js`) —
      same tables, columns, filters, order of operations and RPCs as
      production. No DDL, no policy change, no new table. R3 says the
      permission model is not to be redesigned, and a query rewritten to
      look nicer is a query the RLS policies were never reviewed for.
- [x] **Auth gate** — sign in, sign up, the two 6-digit OTP flows
      (signup confirmation and password recovery), forgotten-password,
      set-new-password. The typed code rather than a clickable link is
      kept deliberately: inbox link scanners burn one-time tokens.
- [x] **Account, organisations, members, invites** — multi-org with an
      active-org switch, admin rename, add-member-by-email through
      `find_user_by_email`, and the accept/decline invite flow via
      `get_my_pending_invites`.
- [x] **Sharing + per-project access + viewer mode** — share a project to
      an org (snapshot, upsert on `org_id,name`), resolve the opener's
      role fresh on every open, and grant/revoke editor access per member.
- [x] **Cloud record interop** (`core/cloudFormat.js`) — the shared
      `data` column keeps PRODUCTION's shape, converted at the boundary.
      This is the difference between a clean cutover and silently
      rewriting every customer's existing job the first time autosave
      fires in the new app.
- [x] **Report a problem** — same `report-problem` edge function.
- [x] **Parity check** — `app/test/cloud-format-parity.mjs`, 6,210
      comparisons: 200 records built by production's own
      `buildProjectData()`, opened and saved by the redesign, compared
      field by field, plus 100 redesign round trips and the edge cases
      (missing `nextId`, out-of-range indices, unedited price lists,
      unknown future fields).

**Security work, beyond parity:**

- [x] **RLS verified against the LIVE project**, not the policy files —
      `app/test/rls-probe.mjs`. Holding the publishable key as an
      anonymous visitor: `projects` returns `[]`, the five org tables and
      all five RPCs return 42501, and an INSERT is refused by policy.
      Closes R14.
- [x] **The XSS pattern the audit found is not reproduced.** Production
      builds its members, invites, org and shared-project screens with
      template literals into `innerHTML`, unescaped — a display name of
      `<img src=x onerror=…>` runs in every colleague's browser. JSX
      escapes by construction; verified in the browser with live
      `<script>` and `<img onerror>` payloads in an org name, an
      inviter's name, a member's name and a sharer's name. All rendered
      as literal text, nothing executed.
- [x] **Viewer mode enforced at the document** (`doc.commit`/`undo`/
      `redo`/`jumpTo`), not by an overlay — one choke point every
      mutation already passes through, so no control, shortcut or palette
      entry can miss it, and pan/zoom keep working. Covered by
      `app/test/readonly-guard.mjs`. Closes R6.
- [x] **Nothing renders behind the gate.** Production overlays its gate on
      a live app, leaving the project list focusable and screen-readable
      underneath. Here the gated branch renders the gate and nothing else.

**Verified in the browser:** the gate's six modes and their validation;
a real `Invalid login credentials` round trip against live Supabase;
cloud and organisation tabs; opening a cloud project (local copy written,
autosave syncing back a production-shaped record); opening a shared
project as a viewer (banner, view-only toast, no local copy written, no
edits accepted, no cloud write); the org sheet's members/invites tabs;
and a regression pass over Phases 1–8 with no console errors.

**Not verified, and it needs the owner:** the signed-in paths were driven
against an in-memory Supabase double, because typing the owner's password
into a login field and creating an account are both off-limits. See
MIGRATION_INVENTORY.md §I item 10.

### Phase 11 — Integration, security, regression ✅ complete

Full workflow end-to-end, security review, responsive/touch regression,
and the directive's §35 product audit. The audit itself is filed in full
at [PRODUCT_AUDIT.md](PRODUCT_AUDIT.md) rather than summarised here —
read it directly for the design/UX/competitor/technical review and the
cutover-readiness summary.

- [x] **Full workflow, one project** — drawing → 5 devices across
      categories → circuit created and assigned via multi-select →
      Panel Schedule → Quote → Civil mode → pit placed (auto-created
      civil plan) → Civil Materials → Elevation created → Comms Rack
      placed (24 ports, patch panel derived) → Comms Racks panel →
      Print/PDF export (floor + civil pages, correct legends) → Save as
      PDF. Zero console errors at any point.
- [x] **Undo/redo** — verified as a real round trip against the
      persisted record, not just a UI flip: undo removed a just-placed
      device from `localStorage`, redo restored it.
- [x] **Persistence** — full page reload (not SPA navigation) reopened a
      6-device project with all 6 devices intact.
- [x] **Responsive/touch** — three breakpoints tested live (375×812,
      768×1024, 1280×800), each a genuinely different layout, not one
      shrunk down. A device placed with a synthetic `pointerType:'touch'`
      event confirmed the touch code path specifically, not just mouse.
- [x] **Security review** — RLS re-verified against the live Supabase
      project (`app/test/rls-probe.mjs`, still clean); the audit's
      flagged unescaped-innerHTML pattern probed directly with
      `<script>`/`<img onerror>` payloads in org/member names — both
      rendered as inert text.
- [x] **Regression fix found in passing** — the project picker's device
      count read the pre-Phase-0 flat drawing shape and had shown "0
      devices" for every real project since Phase 0. Fixed (`59851f4`).
- [x] **§35 product audit** — PRODUCT_AUDIT.md, all ten sections (A–J).

**Not done, and explicitly not this assistant's call:** a genuinely
signed-in (non-stubbed) pass over the cloud features, screen-reader
testing, load testing at production-scale object counts, and the
physical cutover mechanics decision — see PRODUCT_AUDIT.md's closing
summary against CLAUDE.md's five cutover conditions.

---

## Cutover gate

Per CLAUDE.md's confirmed end-state, `app/` eventually replaces
`index.html`. That cutover needs, stated plainly in the PR: full parity
per the inventory's matrix **including the business logic behind it**,
checked against the old app's real output; security parity or better (the
new UI must not reintroduce the unescaped-`innerHTML` pattern the audit
found — escaping helper from the start, and RLS verified against the live
project, not assumed); §35's audit closed out; an explicit decision on the
physical promote-to-root mechanics; and the owner's explicit review of that
specific cutover.

---

## Open decisions — owner input needed

Carried forward from the inventory. None block Phases 1–7.

1. **Document model + scale semantics (new).** Phase 0 changed the document
   model and inverted `scale` to production's units-per-metre. Both were
   necessary and are behaviour-preserving against *production*, but
   CLAUDE.md's AI-authorship policy says document-model changes aren't an
   assistant's call to make unilaterally — flagging for confirmation.
2. **Elevations' architecture** — RESOLVED in Phase 8 by reading
   production's own code rather than guessing: its elevation canvas has
   no pointer interaction at all, so it isn't a plan type. Built as a
   report-style dialog instead. See MIGRATION_INVENTORY.md §I item 1.
3. **Panel schedule / quote as workspace "modes" vs sheets** — §13 raises
   modes; adopting them changes navigation, which §32 puts off-limits
   without approval.
4. **Storage cutover strategy** — convert existing `project:` records in
   place, or run both schemas during transition? Data-loss risk either way.
5. **GST hard-coded at 10%** — correct for AU today; flagged only because
   it's a literal in the total rather than a setting.

---

## Code style / formatting ✅ resolved (`c8a0b43`)

Node was installed on 2026-09-04, which unblocked the Prettier pass
CLAUDE.md requires (it forbids freehand AI reformatting; a formatter
reprints from the syntax tree and cannot change behaviour).

Done: Prettier 3.9.6 over `app/src`, own commit, zero functional changes,
verified in-browser afterwards (place/undo/redo/selection all intact, no
console errors). `.prettierrc.json` is committed so future runs reproduce
the same output.

Two deliberate exclusions, in `.prettierignore` with reasons:
- **`index.html`** — the live product and this migration's fallback;
  §21 says don't modify it while it's serving that role. If it ever is
  reformatted, CLAUDE.md requires that be its own dedicated commit.
- **`app/src/core/catalog.js`** — extracted verbatim from `index.html`;
  its value is being byte-comparable with its source, and reformatting
  would drown the next re-extraction diff.

## Running the parity tests

All seven compare the ported core against the LIVE `index.html`,
extracting its functions by name at run time so they survive edits to
that file:

```bash
node app/test/panel-schedule-parity.mjs
node app/test/comms-migration-parity.mjs
node app/test/quote-parity.mjs
node app/test/civil-parity.mjs
node app/test/legend-parity.mjs
node app/test/cloud-format-parity.mjs
node app/test/print-parity.mjs
```

Two more checks that are not parity comparisons — one is a security
invariant, the other talks to the live Supabase project:

```bash
node app/test/readonly-guard.mjs   # viewers cannot mutate the document
node app/test/rls-probe.mjs        # anonymous access refused, live project
```

If any fails, the port has drifted from the product — fix the port,
not the expectation.

**To run Prettier again:** Node lives at `C:\Program Files\nodejs` but is not on
the Git-Bash PATH — prepend `export PATH="/c/Program Files/nodejs:$PATH"`.
`npx prettier` hung on this machine; installing prettier into a scratch dir
and calling `node_modules/.bin/prettier` directly works and is fast.

---

## Known follow-ups (not blocking a phase)

- ~~No React error boundary~~ — done in Phase 6 (`3bf0e30`) after a
  missing import blanked the page twice. A render crash now shows a
  "your drawing is saved, reload" panel instead of a white screen.
- **Cable/label layer gating.** Layer visibility now hides devices on the
  canvas (fixed in Phase 2), but production also gates cables and labels
  by layer. Small, and best done alongside whichever phase next touches
  the renderer.
