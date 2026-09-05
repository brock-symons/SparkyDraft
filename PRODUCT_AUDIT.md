# Final Product Review — `app/` CAD workspace redesign

Per REDESIGN_DIRECTIVE.md §35, produced at the close of Phase 11
(2026-09-05), with Phases 0–10 complete and parity-tested. This is a
review, not a decision — nothing here authorises a merge to `main`; that
still requires the owner's explicit review of the specific cutover
(CLAUDE.md, "Target end-state" and "Workflow notes").

---

## A. Design review

**What changed and why.**

The redesign replaces a single 9,000-line `index.html` — one shared
global `state`, hand-wired DOM manipulation, one dark mobile theme
force-toggled to a bright desktop theme by a class on `<html>` — with a
React + Tailwind app split along one seam: `core/` (framework-free
catalog, geometry, snapping, document/history, the command registry, the
canvas renderer, the interaction controller — nothing here imports
React) and `ui/` (React, owns chrome only, never re-renders during a
drag). That split is the single decision most of the rest of the design
follows from:

- **One command registry** (`core/commands.js`) feeds the palette,
  keyboard shortcuts, tooltips and the context menu from one list.
  Production's palette is a hand-maintained array that has already
  drifted from the toolbar once; structurally, that bug cannot recur
  here — there is nowhere else for an action to be declared.
- **The document is a timeline, not a state mutation.** `core/document.js`
  keeps every committed state and a cursor into it (`commit`/`undo`/
  `redo`/`jumpTo`), which is also what makes version history a feature
  (production has none) rather than a second thing to build.
- **Three real responsive layouts**, not one shrunk down (directive §11):
  desktop docks Layers/Inspector as permanent panels with a tool rail;
  tablet keeps the rail but panels become a single overlay column;
  mobile drops the rail for a bottom action bar and bottom sheets. Tested
  in the browser this session at 375×812, 768×1024 and 1280×800 — see §I.
- **Read-only enforcement moved from an overlay to the document itself**
  (Phase 10). Production blocks a viewer with a click-eating div over the
  canvas, which also blocks pan/zoom. The redesign refuses at
  `doc.commit`/`undo`/`redo`/`jumpTo` — one choke point every mutation
  already passes through, so no control, shortcut, or palette entry can
  miss it, and a viewer can still look around the drawing.
- **The cloud record format is production's own shape**
  (`core/cloudFormat.js`), not the redesign's native model. This was the
  one design decision in the whole migration made for a reason outside
  the redesign itself: the two apps share a database, so the wire format
  had to be a decision about EITHER app's cutover story, not a modelling
  convenience for this one.

## B. CAD UX review

Patterns brought over from professional CAD/drafting tools, not present
in production:

- **Snap reason readout** — the status bar says *why* something snapped
  (device centre, wall, grid), not just that it did. Production snaps
  silently.
- **Contextual inspector with four real states** (nothing selected / one
  object / multiple objects / a tool is active) rather than one panel
  that either shows something or is blank.
- **A single source of truth for "what can I do right now"** — the
  command registry means the right-click context menu, the palette, and
  the keyboard layer can never disagree about what a shortcut does or
  whether an action is currently valid (`when` predicates gate all
  three).
- **Version history as a real timeline** users can jump into, not just
  linear undo.
- **Marquee selection, multi-select bounds, and a dedicated measure tool**
  independent of placement — small, but each is a CAD-standard
  interaction production's toolbar-driven UI doesn't offer as cleanly.

## C. Electrical workflow review

What makes this specifically an electrical-drafting tool rather than a
generic 2D CAD shell:

- The **symbol catalog IS the domain model** — `defaultProps` on a
  symbol carries its cable size, protection device, labour hours and
  wattage, so placing a device is also declaring its electrical
  characteristics. Nothing in the UI asks the user to describe a GPO;
  picking "Double GPO" already says 2.5mm² TPS, 20A RCBO, 200W.
- **Circuits are graph-derived, not manually drawn.** `computeGpoChains`/
  switch-run derivation reconstruct what's actually wired from device
  positions and switch links, so the panel schedule and cable-run
  estimate stay honest to the drawing instead of a parallel diagram that
  can drift from it.
- **Patch panels are derived, never placed** — a comms rack's port count
  determines its patch-panel line on the legend and quote; there is no
  way to have a rack and a patch-panel count that disagree.
- **Civil/underground works as a genuinely different plan type** (pits,
  conduit by category, poles, overhead runs) rather than a reskinned
  version of the electrical canvas, because a site plan and a rough-in
  plan are different documents with different content, not the same tool
  pointed at different symbols.
- **Elevations as a report, not a drafting surface** — Phase 8 resolved
  this by reading production's actual code rather than guessing:
  `#elevCanvas` has no pointer handlers at all, so building it as a third
  plan type would have been inventing complexity the product never had.

## D. Competitor gap analysis

Relative to general CAD/design tools (Figma, AutoCAD-family) and
trade-specific competitors (an electrical-estimating tool's typical
feature set):

**ESSENTIAL**
- Nothing essential is missing for the *drafting* workflow — placement,
  circuits, panel schedule, quote, civil, print/export and cloud sharing
  are all present and parity-tested.

**HIGH VALUE**
- **Multi-user real-time presence/co-editing.** Sharing exists (Phase
  10), but it's save-and-reload, not live cursors. A competitor with
  live collaboration reads as more "modern" even if single-editor-at-
  a-time is perfectly workable for a two-to-five-person trade business.
- **A component/device search that ranks by usage frequency**, not just
  alphabetically within a category — the "Recent" section already
  exists; ranking the full search results the same way would compound
  that.
- **Cable schedule export** (a flat list: circuit, cable type, length,
  from/to) alongside the panel schedule — the data already exists
  (`buildPanelScheduleData`), this would be a view over it, not new
  computation.

**USEFUL**
- **Templates** (a "Ground Floor" starter with common boards pre-placed)
  for a new project, reducing the empty-canvas cold start.
- **A device count / cost budget bar** while drafting, so a user sees the
  quote trending as they place devices instead of only on opening Quote.

**OPTIONAL**
- Layer-level opacity/dim (vs. hide/show only).
- A measurement-units toggle (mm/inch) — production and the redesign are
  both AU-market and metric-only; only worth building if there's an
  actual export market.

**NOT WORTH COPYING**
- Full parametric/BIM modelling (wall thickness, 3D). This is a 2D
  rough-in and takeoff tool for licensed electricians; a 3D authoring
  pipeline is a different product with a different buyer.
- A plugin/extension marketplace. Directive §30 already rules this out
  explicitly ("do not turn it into a generic CAD clone") and it would
  dilute the one thing this tool is for.

## E. UX problems

What's currently unnecessarily complicated, found while actually
building and testing each phase rather than inspecting the code cold:

- **Two sizing conventions for panels** (docked width in px vs. bottom
  sheet height as a % of viewport) mean the same content is laid out
  twice in the CSS. Not visibly broken, but it's the kind of duplication
  that drifts silently when one is edited and the other isn't.
- **The Elevations dialog and the Civil Materials dialog are both
  report-style modals reachable only from the command palette**, with no
  visual hint from the drafting surface itself that they exist. A first-
  time user has no way to discover Elevations without already knowing to
  search for it.
- **The read-only viewer inspector still offers "Import floor plan…" and
  "Calibrate from a known length…"**, which do nothing for a viewer.
  Flagged already in MIGRATION_INVENTORY.md §I item 9 rather than fixed
  during Phase 10, since it's cosmetic (inert, not unsafe) and touching
  1,450 lines of Inspector for two buttons felt disproportionate mid-
  phase; worth a small pass now that Inspector is otherwise unchanged.

## F. Features we should consider

🔴 **Critical**
- *None.* Everything load-bearing for the electrical-drafting-to-quote
  workflow is built and parity-tested.

🟠 **High value**
- **Cable schedule export.** What it is: a flat per-circuit table (cable
  size, run length, from/to board) derived from the same data the panel
  schedule already computes. Why users want it: it's the document an
  electrician hands to a supplier for a materials order, separate from
  the panel schedule's per-board view. Business value: closes a real gap
  against dedicated estimating tools. Complexity: low — the redesign
  already computes cable-run estimates (`panelSchedule.js`); this is a
  new view, not new logic. Competitor precedent: standard in
  trade-estimating software. Recommend: yes, once Phase 9's print/export
  work is stable (it already is).

🟡 **Useful**
- **Project templates.** What: a "starting point" project with a board
  and a couple of common circuits pre-wired. Why: reduces cold-start
  friction for a new job. Business value: minor retention/onboarding
  improvement. Complexity: low (a canned `emptyProject()` variant).
  Competitor precedent: common in general design tools, less common in
  trade-specific ones. Recommend: yes, low cost.
- **Usage-ranked component search.** Already discussed in §D. Recommend:
  yes, small change to an existing sort.

🟢 **Nice-to-have**
- **Layer opacity.** Recommend: only if a specific job (e.g., overlaying
  a scanned plan under dense device placement) surfaces demand for it.

⚪ **Do not build**
- Plugin marketplace, 3D/BIM, parametric modelling — see §D.

## G. Features we should remove or simplify

Per the directive: **not removed, recommended for approval only.**

- **The Save Options three-way sheet** (local / cloud / download) that
  production offers is NOT replicated as a UI concept in the redesign —
  autosave + silent cloud sync already covers the first two, and
  "Download project copy (JSON)" covers the third as a palette command.
  This is already a simplification made during Phase 9/10; flagging it
  explicitly here in case the owner wants the three-way chooser back for
  parity's sake rather than the implicit version.
- **Print view's separate "Print" vs "Save as PDF" buttons** could
  arguably collapse to one (a PDF can be printed from any PDF viewer),
  but production has always drawn this distinction (a fast on-screen/
  browser-print path vs. a portable file), so it's carried over rather
  than simplified unilaterally.

## H. Technical review

- **Architecture:** the `core`/`ui` split holds up under real load — ten
  phases of business logic (circuits, panel schedule, quote, comms,
  civil, elevations, cloud, print) were added without a single instance
  of `core/` needing to import React or `ui/` needing to duplicate
  business logic. That's the strongest evidence the split was the right
  one, not just a nice idea at Phase 0.
- **Component structure:** consistent — each dialog is a self-contained
  function component taking `doc`/`controller`/`symbolFor` and rendering
  through the shared `primitives.jsx` (Button, Dialog, Toggle, etc.), so
  a new dialog looks and behaves like every other one by construction
  rather than by discipline.
- **Design system:** one token set (ink/accent ramps, contrast-audited
  against WCAG 2.1 AA per app/index.html's own comments), applied
  through Tailwind utility classes rather than a component library with
  its own opinions to fight.
- **Performance:** viewport culling in `renderScene` (only visible
  objects get their hit-test/paint work), React re-renders are decoupled
  from canvas paints (CanvasStage paints via one rAF, not on every
  pointermove), and DPI-scaled canvas backing stores. Not load-tested at
  production device counts (hundreds of objects across many floors) in
  this session — flagged as untested, not assumed fine.
- **Responsiveness:** verified in the browser this session at three
  breakpoints (375×812, 768×1024, 1280×800) — see §I. All three actually
  usable, not just "doesn't overflow."
- **Accessibility:** interactive elements carry `aria-label`s
  consistently (verified by querying the live DOM during testing — every
  tool-rail and library button has one); toggles use `role="switch"` +
  `aria-checked`; dialogs use `role="dialog"`. Not independently screen-
  reader-tested this session — that's a real gap, not a claim of full
  compliance.
- **Maintainability:** the parity-test suite (7 files, 19,918
  comparisons as of this phase) is the load-bearing maintainability
  asset here — it means "did I just change quote/panel-schedule/civil/
  legend/cloud-format behaviour" is a machine-checkable question, not a
  code-review judgment call, for every phase built so far.
- **Scalability:** the document model (`project.floors[]`,
  `project.civilPlans[]`, project-level `circuits[]`/`elevations[]`)
  scales to multi-floor, multi-site-plan jobs by construction — nothing
  assumes a single floor. Cloud sync scales per-project, not
  per-organisation; an organisation with many shared projects re-fetches
  its whole list on every picker open (`listOrgProjects()`), which is
  fine at the scale a trade business operates at (tens of projects, not
  thousands) and would need pagination before it wouldn't be.
- **Technical debt, named plainly:**
  1. **No build step.** `app/index.html`'s in-browser Babel/ES-module
     loader is explicitly acknowledged debt (its own comment calls it
     "deletable in one commit once Vite is introduced"). It works, but
     it means no tree-shaking, no minification, and a slower first paint
     than a built bundle would give.
  2. **Local storage namespace duplication.** The redesign's
     `sparkydraft_cad:` prefix is deliberate (protects real production
     data during development) but means local persistence isn't
     interoperable the way cloud persistence now is — R4 in the risk
     register, still an open owner decision.
  3. **Inspector/Layers partial parity** — both have been "Partial" since
     early phases and were never brought current as later phases landed
     (see §E, §H's own accessibility caveat, and MIGRATION_INVENTORY.md
     §H).

## I. Testing

Actually exercised in the browser this session (not code-inspection-only
claims), against a fresh local dev server with a stubbed Supabase client
(injecting deliberately hostile `<script>`/`<img onerror>` payloads and
verifying they render as inert text) since real credentials aren't
something this assistant will enter — see CLAUDE.md's hard rule on that.

**Full workflow, one project, start to finish:**
Created a drawing → placed 5 electrical devices across categories (2×
Double GPO, 2× 1-gang switch, 1 downlight) → created circuit "C2" →
multi-selected all 5 devices (Ctrl+A) and assigned them to the circuit →
opened Panel Schedule (correct qty/connected-load/demand numbers) →
opened Quote (correct per-item pricing, materials/labour/protection/GST/
total) → switched to Civil mode → placed a pit (auto-created a civil
plan) → opened Civil Materials (correct pit cost, calibration warning) →
switched back to Electrical → created an Elevation ("North wall") →
placed a Comms Rack (confirmed 24 default ports, patch panel derived) →
opened the Comms Racks panel (correct "0/24 ports used · 1 patch panel")
→ opened Print/PDF export (both a floor page and a civil page rendered
with correct legends, 7 devices total on the floor page) → ran Save as
PDF (completed with no thrown error) → **zero console errors at any
point in this sequence.**

**Undo/redo:** verified as a real round trip, not just a UI state flip —
undo removed the just-placed comms rack from the persisted
`localStorage` record; redo restored it, confirmed against the stored
data both times.

**Persistence:** reloaded the page (full navigation, not SPA state) and
confirmed the 6-device project reopened with all 6 devices intact from
`localStorage`.

**Responsive/touch:** tested at 375×812 (mobile), 768×1024 (tablet) and
1280×800 (desktop) — three visually and structurally distinct layouts,
matching the directive's "not desktop shrunk down" requirement. Placed a
device using a synthetic `pointerType:'touch'` event at mobile width to
confirm the touch code path (not just mouse) places correctly.

**Supabase interactions:** the auth gate's real error path was exercised
against **live Supabase** (an actual `Invalid login credentials` round
trip with a non-existent account), confirming the network call, error
handling and UI message all work end-to-end. Every signed-in feature
(organisations, invites, members, sharing, per-project access, viewer
mode) was exercised against an in-memory stub, per the credentials
constraint above — genuinely signed-in verification of those paths is
still owner-only work, tracked as MIGRATION_INVENTORY.md §I item 10.

**Security-relevant testing:** RLS was checked against the LIVE Supabase
project as an anonymous visitor holding the publishable key — every
table the app touches returns empty or 401, every RPC returns 401, and a
write attempt is refused by policy (`app/test/rls-probe.mjs`, re-run
during this phase, still clean). The audit's flagged unescaped-innerHTML
pattern was probed directly: a `<script>alert()</script>` payload in an
org invite's name and an `<img src=x onerror=...>` payload in a member's
name both rendered as literal visible text with nothing executing.

**Console errors:** none observed across the entire testing session,
including the full workflow, undo/redo, responsive checks, and dialog
open/close cycles.

**What was NOT tested:** load at production-scale object counts;
screen-reader behaviour; the real (non-stubbed) signed-in Supabase paths;
a genuinely concurrent two-user editing scenario.

## J. Git status

- **Branch:** `feature/cad-workspace-redesign`
- **Commits on this branch, not on `main`:** 33 (Phase 0 through this
  Phase 11 documentation pass), most recent: `59851f4` (device-count
  picker fix), preceded by `47df88f` (Phase 9), `f618ae5` (Phase 10),
  and back through every phase to `cf77801` (Phase 0's predecessor,
  the original core architecture commit).
- **Pushed:** yes — every commit through Phase 10 is pushed to
  `origin/feature/cad-workspace-redesign`. This audit and its
  accompanying doc updates will be committed and pushed the same way.
- **Confirmation nothing was merged:** confirmed. `main` has not been
  touched by this migration at any point. `git log main..feature/cad-
  workspace-redesign` shows all 33 commits as ahead-of and absent-from
  `main`; no merge commit exists anywhere in this branch's history.

---

## Summary for the cutover decision

Per CLAUDE.md's cutover gate, here is where each of its five conditions
stands as of this audit:

1. **Full parity (§H's own matrix):** 20 of 23 areas ✅, two long-
   standing partials (Layers, Inspector/properties) and one deliberate
   architectural difference (local storage namespace, R4).
2. **Security parity or better:** the flagged XSS pattern is not
   reproduced (verified live, not just by code reading); RLS is verified
   against the live project; read-only enforcement is structurally
   stronger than production's. Signed-in Supabase paths still need a
   genuine (not stubbed) pass — see §I.
3. **This §35 audit:** done, filed here.
4. **Physical cutover mechanics:** still undecided — promote `app/` to
   replace the repo root, or point `main`'s deploy at `app/`'s build
   output while `index.html` moves elsewhere? Not this assistant's call.
5. **No push to `main` without explicit owner review:** holds. Nothing
   in this session touched `main`.
