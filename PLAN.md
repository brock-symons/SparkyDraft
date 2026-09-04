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
| Status | Phase 0 complete, Phase 1 next |
| Merged to main | **No — and not without explicit owner review** |
| Last updated | 2026-09-04 |

---

## Where things stand

**Done:** the drafting substrate — canvas, pan/zoom, snapping (with the
"why it snapped" readout), selection/hover/marquee, align/distribute,
undo/redo, layers, plan import + calibration, command registry driving
palette/shortcuts/tooltips/context-menu, three responsive models, and as of
Phase 0 a project-of-floors document model.

**Not done:** the electrical, commercial, output and cloud halves of the
product. 5 of 23 parity areas complete.

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

### Phase 1 — Canvas primitives the later phases consume
Walls (draw, not just read-for-snapping), cable routes (`line` tool),
dimensions, rooms, custom symbols, version history, symbol size, duplicate
finder.
**Why first:** circuits need cables; the panel schedule's cable-run
estimate needs both cables and calibration.

### Phase 2 — Switch linking + lighting banks
`switchLinks[]`, `computeLightingBanks()`, `computeChainOrder()`,
`computeBankAttachPoints()`, gang counts, bank naming.
**Why before circuits:** circuit assignment propagates through switch links.

### Phase 3 — Circuits
CRUD, assignment, branching runs (`computeGpoChains()`,
`computeChainEdges()` — branching, *not* a strict chain),
`propagateSwitchCircuitToLinkedLights()`, isolate view, circuit labels,
switch-run overlay.

### Phase 4 — Panel schedule + load/demand
Panel schedule, the demand estimate, cable-run estimate, board main-switch
ratings. **Highest business-logic risk in the migration** — formulas are
recorded verbatim in inventory §B3/§B4 and must be checked against the old
app's actual output, not re-derived.

### Phase 5 — Comms racks
Racks, ports, home-run assignment, derived patch panels, comms run
rendering, **and `migrateLegacyCommsData()`** (data-integrity critical —
port it before the UI, or old saves corrupt on load).

### Phase 6 — Quote + price list
Quote totals, itemised/summary toggle, price list editing, per-object price
overrides, labour/margin/equipment/travel inputs, quote export.
Formulas verbatim per inventory §B1/§B2 (including the deliberate
"current product default" indirection in `effectivePrice()`).

### Phase 7 — Civil / underground
Civil plans as a parallel plan type, pits/conduits/building entries/poles/
overhead runs, civil materials schedule, civil quote, mode toggle.
Self-contained — safe here once the core is stable.

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

## Code style note (why no "condense" pass happened)

A condensing/simplification pass was requested. CLAUDE.md's only rule on
this says the opposite of what a freehand pass would do:

> **Reformatting for readability goes through an actual formatter
> (Prettier), never a freehand AI rewrite** … an AI manually "cleaning up"
> dense code can drift into small semantic changes without meaning to.

Prettier can't run here — no Node, no npx, no `prettier` binary on this
machine. So the compliant options are: install Node and run Prettier as its
own zero-functional-change commit, or leave formatting alone. A freehand
condensing pass would violate the rule it was meant to follow, so it wasn't
done. Raised for the owner rather than silently skipped.

Note the rule targets *the legacy `index.html`'s* dense single-line areas.
`app/src/` was written fresh in the house style (framework-free `core/`,
React-only `ui/`, one command registry) and isn't the code that rule is
aimed at.
