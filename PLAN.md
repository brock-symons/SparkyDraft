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
| Status | Phases 0-7 complete · **stopped at the phase boundary, awaiting approval for Phase 8** |
| Merged to main | **No — and not without explicit owner review** |
| Last updated | 2026-09-04 |

---

## Where things stand

**Done:** the drafting substrate — canvas, pan/zoom, snapping (with the
"why it snapped" readout), selection/hover/marquee, align/distribute,
undo/redo, layers, plan import + calibration, command registry driving
palette/shortcuts/tooltips/context-menu, three responsive models, and as of
Phase 0 a project-of-floors document model.

**Not done:** the commercial, output and cloud halves of the product.
Panel schedule, load/demand, quoting, comms, civil, elevations, print/PDF
and all cloud/auth features remain.

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

### Phase 8 — Elevations + legend
**Blocked on an owner decision** — see open decisions below.

### Phase 9 — Print / PDF / export
Print view, jsPDF export, save-as-PDF dialog, civil pages toggle, JSON
download. Last because it renders everything above.

### Phase 10 — Auth, Supabase, orgs, sharing
Auth gate, OTP verify, password reset, session handling, account sheet,
cloud project CRUD, organisations, members/roles, invitations, project
sharing, per-project access, read-only viewer mode, report-a-problem.
**Largest security surface.** Deliberately late: wiring cloud sync to a
still-moving data model would mean migrating stored records twice.

### Phase 11 — Integration, security, regression
Full workflow end-to-end (Project → Drawings → Components → Circuits →
Panel Schedule → Quote → Export), security review, responsive/touch
regression, then the directive's §35 product audit.

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
2. **Elevations' architecture** — separate view, or a third plan type
   alongside floors/civil? Blocks Phase 8.
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

Both compare the ported core against the LIVE `index.html`, extracting
its functions by name at run time so they survive edits to that file:

```bash
node app/test/panel-schedule-parity.mjs
node app/test/comms-migration-parity.mjs
node app/test/quote-parity.mjs
node app/test/civil-parity.mjs
```

If either fails, the port has drifted from the product — fix the port,
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
