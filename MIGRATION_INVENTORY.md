# SparkyDraft — Migration Inventory

**Required deliverable per [REDESIGN_DIRECTIVE.md](REDESIGN_DIRECTIVE.md) §4 / §4A.**
Produced by inspecting the actual code on both sides, not from prior descriptions.

| | |
|---|---|
| Current app (source of behaviour) | `index.html` on `main` — 9,182 lines, single file |
| New app (source of architecture/UX) | `app/` on `feature/cad-workspace-redesign` — 4,416 lines across 16 modules |
| Branch | `feature/cad-workspace-redesign` (6 commits ahead of `main`, nothing merged) |
| Inventory date | 2026-09-03 |

**Claude-mem (§3):** unavailable this session — the `claude-mem` MCP server failed
to connect (`CONNECTION_CLOSED`). Historical context below is drawn from the
file-based memory, `CLAUDE.md`, and the code itself. Items where historical
intent would have been useful are flagged **[no historical context]**.

---

## ⚠️ HEADLINE FINDING — read before planning any work

**The new app's document model cannot represent the current app's data.**

The current app's `state` is a *project* containing many plans and
project-level collections:

```
state = {
  floors[]        // each: objects, cables, dimensions, switchLinks, walls,
                  //        rooms, bankNames, view, scale, grid*
  civilPlans[]    // each: pits, conduits, buildingEntries, poles,
                  //        overheadRuns, dimensions, view, scale, grid*
  circuits[]      // project-level, referenced by objects on any floor
  elevations[]    // project-level
  layers[]        // project-level visibility/lock
  customSymbols[] // user-defined symbols, project-level
  boardMainSwitchAmps{}, unassignedCommsPorts[], ...
}
```

The new app's `emptyDrawing()` is a **single flat drawing**:

```
{ name, objects[], walls[], nextId, scale, gridSpacing, gridOrigin*,
  snapEnabled, hiddenLayers[], lockedLayers[], planImage }
```

There is no floors array, no civil plans, no circuits, no elevations, no
cables, no dimensions, no rooms, no switch links, no custom symbols.

**Consequence:** almost every remaining subsystem (circuits, panel schedule,
quote, comms, civil, elevations) depends on data the new model cannot hold.
Porting any of them before the model is reshaped would either produce a
second incompatible model or force a painful rewrite later.

**Therefore the migration order in §7 is amended:** a new *Phase 0 — Document
model* must come first. This is the single highest-risk item in this
inventory and the reason the phases are re-sequenced in section F.

---

## A. Feature inventory

Status key: **✅ complete** · **◐ partial** · **✗ missing** · **⚙ needs architectural integration** · **? requires investigation**

### A1. Drafting / canvas

| Feature | Current (index.html) | New app | Status | Notes |
|---|---|---|---|---|
| Canvas render loop | `render()` L2057 | `core/renderer.js` | ✅ | New is rAF-batched + viewport-culled; better |
| Pan / zoom | L2046+ | `geometry.zoomAt`, controller | ✅ | |
| Grid + adaptive density | `openGridSheet()` L4252 | renderer `drawGrid` | ◐ | New lacks grid-visible toggle, grid-align-to-wall, mm-based spacing (`gridSpacingMM`) |
| Snapping (device/wall/axis/grid) | `snapPoint()` L2761 | `core/snapping.js` | ✅ | Ported faithfully + now reports *why* it snapped |
| Selection / hover | scattered | controller + renderer | ✅ | New is stronger (hover vs select states, locked/hidden gating) |
| Multi-select + marquee | `btnMultiSelect` L3736 | controller marquee | ✅ | New: marquee is default drag on empty (mouse) |
| Align / distribute | L3733 block | `alignSelected`/`distributeSelected` | ✅ | |
| Move / nudge | pointer handlers | controller | ✅ | New adds arrow-key nudge + Alt fine nudge |
| Duplicate / delete | multi-action bar | controller | ✅ | |
| Undo / redo | `pushHistory()` L2043 | `core/document.js` | ✅ | New is stronger: single commit funnel, coalescing |
| Version history (browse snapshots) | `renderVersionHistory()` L4794 | — | ✗ | Separate from undo; browse/jump to any past snapshot |
| Layers (visibility/lock) | `renderLayersMobile()` L5483 | `Panels.jsx` | ◐ | New has 6 category layers; current also gates cables/labels |
| Object properties | `openProps()` L5942 (~780 lines) | `Inspector.jsx` | ◐ | New covers general/electrical/cost; missing circuit assign, comms port, switch link, gang config, per-object price override UI |
| Measure tool | `data-dtool="measure"` | controller | ✅ | |
| Calibrate scale | `data-dtool="calibrate"` | controller + `plan.calibrate` | ✅ | |
| Import floor plan (image/PDF) | L7138 `fileImport` | `plan.import` | ✅ | Both accept image + PDF |
| **Cable routing (`line` tool)** | `activeTool==='line'`, `f.cables[]` | — | ✗ | Draw cable runs between devices; feeds quote + legend |
| **Wall tool** | `activeTool==='wall'`, `f.walls[]` | — | ✗ | New app *reads* walls for snapping but cannot draw them |
| **Switch linking (`link` tool)** | `switchLinks[]`, `computeLightingBanks()` L1764 | `core/switching.js` | ✅ | Links switches→lights, drives banks/gangs + auto circuit propagation |
| **Dimensions** | `f.dimensions[]`, `dimStart` | — | ✗ | Persistent dimension annotations (distinct from measure) |
| **Rooms** | `renderRooms()` L5352, `f.rooms[]` | — | ✗ | |
| **Multiple floors** | `state.floors[]`, `renderFloors()` L4609 | — | ✗ ⚙ | **Architectural** — see headline finding |
| Custom symbols | `state.customSymbols[]` | — | ✗ | User-defined devices added to library |
| Duplicate-device finder | `findDuplicateDevices()` L4138 | — | ✗ | QA tool: finds overlapping/duplicated devices |
| Symbol size setting | `state.symbolSize` | — | ✗ | |
| Circuit isolate view | `state.isolatedCircuitId` | controller + renderer | ✅ | Overrides selection and show-all |
| Circuit label / switch-run overlays | `showCircuitLabels`, `showSwitchRuns` | controller + renderer | ✅ | |

### A2. Electrical systems

| Feature | Current | New | Status | Notes |
|---|---|---|---|---|
| Circuits CRUD | `renderCircuits()` L5121 | `core/circuits.js` + Circuits panel | ✅ | `data` kind lands with comms (Phase 5) |
| Circuit assignment to devices | `openProps` circuit select | Inspector + bulk assign | ✅ | |
| Auto-assign circuit to linked lights | `propagateSwitchCircuitToLinkedLights()` | `core/switching.js` | ✅ | Ported verbatim |
| Branching circuit runs | `computeGpoChains()` L1863, `computeChainEdges()` L1822 | `core/circuits.js` | ✅ | Degree-constrained tree, ported verbatim |
| Lighting banks / gangs | `computeLightingBanks()` L1764, `bankNames{}` | `core/switching.js` | ✅ | Ported verbatim; gang only ever raised |
| Panel schedule | `renderPanelSchedule()` L7051 | `core/panelSchedule.js` | ✅ | Grouped by board, capacity check, text export |
| Load / demand estimate | L6937–7050 | `core/panelSchedule.js` | ✅ | Verbatim; checked by `app/test/panel-schedule-parity.mjs` |
| Cable-run length estimate | `estimateCircuitCableLength()` L7000 | `core/panelSchedule.js` | ✅ | Hard-active runs only — extending it is an owner decision |
| Board main-switch rating | `state.boardMainSwitchAmps{}` | controller + panel schedule | ✅ | Feeds capacity-used estimate |
| Cable size library | `CABLE_SIZES` | catalog.js ✅ (data only) | ◐ | Data ported; no UI |
| Protection library | `PROTECTION_LIBRARY` | catalog.js + circuit dialog | ◐ | Selectable per circuit; costing lands with the quote (Phase 6) |

### A3. Commercial

| Feature | Current | New | Status |
|---|---|---|---|
| Quote totals | `updateQuote()` L6726 | `core/quote.js` | ✅ |
| Quote itemised / quantity-summary toggle | `state.quoteItemized` | Quote dialog | ✅ |
| Price list / device library editing | `renderPriceList()` L4189 | Price list dialog | ✅ |
| Per-object price override | `effectivePrice()` L1658 | `core/quote.js` | ✅ |
| Labour rate / margin / equipment / travel inputs | quote sheet | Quote dialog, persisted | ✅ |
| Export quote summary (copyable text) | L4813 | `quoteText()` | ✅ |

### A4. Comms / data

| Feature | Current | New | Status |
|---|---|---|---|
| Comms racks + ports | L1906+, `renderCommsRacksSheet()` L5254 | `core/comms.js` + Comms panel | ✅ |
| Port assignment (home runs) | `commsPortOptions()` | Inspector Data section | ✅ |
| Derived patch panels | `PATCH_PANEL_PORTS_PER_UNIT` | `core/comms.js` | ✅ |
| Comms run rendering | `computeCommsRuns()` L1992 | `core/renderer.js` | ✅ |
| Legacy comms migration | `migrateLegacyCommsData()` | — | ✗ ⚠ | Data-integrity: converts old saves |

### A5. Civil / underground

| Feature | Current | New | Status |
|---|---|---|---|
| Civil plans (parallel plan type) | `state.civilPlans[]`, `makeCivilPlan()` | `core/civil.js` + Site plans panel | ✅ |
| Pits, conduits, building entries, poles, overhead runs | `PIT_LIBRARY` etc. L1494+ | `core/civilCatalog.js` (verbatim) + civil palette | ✅ |
| Civil render/interaction pipeline | `renderCivil()` L2360, `pointerdownCivil()` L3445 | `core/civilRenderer.js` + controller civil branch | ✅ |
| Civil materials schedule | `sheetCivilMaterials` | Civil materials dialog + legend + text export | ✅ |
| Civil quote totals | `computeAllCivilTotals()` L6769, `updateCivilQuote()` L6788 | `core/civil.js` | ✅ (parity-tested) |
| Civil mode toggle | `civilModeToggle` | Segmented control in the toolbar | ✅ |

### A6. Other drawing systems

| Feature | Current | New | Status |
|---|---|---|---|
| Elevations | `renderElevationSelect()` L5391, `state.elevations[]` | `core/elevations.js` + Elevations dialog | ✅ |
| Legend | `computeLegendEntries()` L5529 | `core/legend.js` + Layers panel | ✅ |

### A7. Output — ported in Phase 9

| Feature | Current | New | Status |
|---|---|---|---|
| Print view | `printView`, L5577+ | `PrintExportDialog` (`main.jsx`) | ✅ |
| PDF export (jsPDF) | `downloadPdfExport()` | `core/print.js` `drawPdfPage()` | ✅ (parity-tested) |
| Save-as-PDF dialog | L5577+ block | Same dialog, "Save as PDF" button | ✅ |
| Civil pages in export | `includeCivilInExport` | Toggle in the same dialog, default on | ✅ |
| Download project copy (JSON) | `downloadProjectCopy()` L7646 | `export.projectJson` command | ✅ |

Captured onto an OFFSCREEN canvas rather than production's live one —
the redesign's canvas is owned by React (`CanvasStage.jsx`), and reusing
it for a multi-page capture would mean fighting React for control of an
element it re-renders on its own schedule. `core/print.js` builds the
same `printPagesData` shape production assembles in `openPrintView()`,
consumed by both the on-screen review and the PDF export so neither can
drift from what the other shows. `renderScene`/`renderCivilScene` gained
a `printMode` flag (white background, no grid/origin) rather than a
parallel renderer, so the print capture and the live canvas can never
draw the same drawing two different ways by accident.

### A8. Projects / persistence

| Feature | Current | New | Status | Notes |
|---|---|---|---|---|
| Project picker | L7881+ | `ProjectPicker.jsx` | ✅ | Cloud + organisation tabs added Phase 10 |
| Local save/load | `storageAPI` L7208 | `core/persistence.js` | ◐ | Different LOCAL key namespace (deliberate, so exercising the redesign cannot corrupt a real `project:` record). The CLOUD record format IS interoperable as of Phase 10 — see `core/cloudFormat.js` |
| Autosave + save status | L7670+ | main.jsx autosave | ✅ | Both real-state driven |
| Session recovery banner | `recoveryBanner` | — | ✗ |
| Project rename / identity | `state.currentProjectId` | ◐ | New has id but no cloud identity |
| Save options sheet (local/cloud/download) | `sheetSaveOptions` | — | ✗ |

### A9. Cloud / collaboration — ported in Phase 10

Every Supabase call is ported call-for-call (risk R3): same tables, same
columns, same filters, same order of operations, same RPCs. No DDL, no
policy change, no new table — the schema is whatever the repo's `.sql`
files already applied to the live project.

| Feature | Current | New | Status |
|---|---|---|---|
| Supabase client + config | L8286+ | `core/cloud.js` | ✅ |
| Auth gate (login/signup) | `renderAuthGate()` L8335 | `ui/Cloud.jsx` `AuthGate` | ✅ |
| Email verification (OTP) | `verifyOtp` type `signup` | `verifyCode('signup')` | ✅ |
| Password reset (OTP + update) | L8445–8500 | `sendPasswordReset`/`verifyCode('recovery')`/`setNewPassword` | ✅ |
| Session handling | `onAuthStateChange` L8313 | `initCloudAuth` + snapshot store | ✅ |
| Account sheet | `renderAccountSheet()` L8604 | `AccountDialog` | ✅ |
| Cloud project list/load/save/delete | L7991–8261 | `core/cloud.js` project fns | ✅ |
| Organizations (multi-org) | L8757+ | `loadMyOrgs`/`setActiveOrg`, `OrgDialog` | ✅ |
| Org members + roles | `organization_members` | `loadOrgMembers`, `OrgsTab` | ✅ |
| Invitations (send/accept/decline) | L8838–8920 | `inviteToOrg`, `InviteBanner`, invites tab | ✅ |
| Project sharing to org | `organization_projects` | `shareProjectToOrg` + picker tab | ✅ |
| Per-project access roles | `organization_project_access` | `ProjectAccessDialog` | ✅ |
| Read-only mode for viewers | `readOnlyMode`, `readOnlyBanner` | Document-level gate + banner | ✅ (better — see §I item 9) |
| Report a problem (Edge Function) | L4052 | `ReportProblemDialog` | ✅ |
| Cloud record interop | `buildProjectData()` shape | `core/cloudFormat.js` | ✅ (parity-tested) |

### A10. Present in new app, not in current app (net-new UX)

| Feature | Notes |
|---|---|
| Unified command registry | Palette + shortcuts + tooltips + context menu from one source. Fixes a real drift bug in the current app. |
| Right-click context menu | Contextual, registry-driven |
| Contextual inspector (4 states) | Nothing / one / many / tool-active |
| Snap reason readout | Status bar explains *why* it snapped |
| Resizable + remembered docks | Persisted per device |
| Component favourites / recent | |
| Three deliberate responsive models | Desktop dock / tablet / mobile sheets |
| WCAG-audited colour ramp | Contrast-checked, documented in `app/index.html` |

---

## B. Business logic that must be preserved

Verified by reading the implementations. **Do not alter these** (§8, §20).

### B1. Quote totals — `updateQuote()` (L6726)
```
materials   = Σ effectivePrice(obj) × (obj.props.quantity || 1)
labourCost  = Σ effectiveLabour(obj) × qty × labourRate
            + derived patch-panel units × (material_cost, labour_hours × labourRate)
protection  = Σ effectiveProtectionCost(circuit)   // circuits where kind !== 'data'
subtotal    = materials + labourCost + protection + equipment + travel
margin      = subtotal × (marginPct / 100)
gst         = (subtotal + margin) × 0.10
total       = subtotal + margin + gst
```
Currency formatted `en-AU`, 2dp. GST is hard-coded 10%.

### B2. Price resolution — `effectivePrice()` (L1658)
Per-object override if present, else **the current** product default from
`SYMBOL_LIBRARY` — so editing a default retroactively reprices every
un-overridden object. This indirection is intentional; preserve it.

### B3. Load / demand estimate (L6937–7050)
```
MAINS_VOLTAGE = 230                      // nominal AU single-phase
lighting: connectedW ≤ 3000 → connectedW × 0.66
          connectedW > 3000 → 3000 × 0.66 + (connectedW − 3000) × 0.40
power:    cap = 2300
          connectedW ≤ cap → connectedW
          connectedW > cap → cap + (connectedW − cap) × 0.75
FIXED_LOAD_SYMBOL_IDS = {hws, oven, cooktop, tastic_2h, tastic_4h,
                         elec_heater, gpo_dedicated, outlet_3ph,
                         outlet_32a, solar_inverter, towel_rail}
```
Explicitly documented in-code as a *simplified approximation*, not AS/NZS 3000
diversity tables. Three-phase shown at single-phase-equivalent current. The
UI carries a disclaimer — **that disclaimer must travel with the numbers.**

### B4. Cable-run estimate — `estimateCircuitCableLength()` (L7000)
Requires a calibrated floor **and** a visible cable route. Lighting covers
hard-active runs only (switch fed from board); switch-to-light cable is
deliberately excluded. Preserve the exclusion and its UI explanation.

### B5. Circuit topology
- `computeGpoChains()` / `computeChainEdges()` — power and hard-active runs
  **branch**, not strict chain.
- `computeLightingBanks()` / `computeChainOrder()` / `computeBankAttachPoints()`
  — switch→light banks, gang counts, bank naming.
- `propagateSwitchCircuitToLinkedLights()` — assigning a switch's circuit
  propagates to its linked lights.

### B6. Comms
- One port holds at most one home run; comms devices link within their own floor only.
- Patch panels are **derived** from rack port count (`PATCH_PANEL_PORTS_PER_UNIT`),
  never placed — and `patch_panel` is excluded from the placement grid while
  remaining in `SYMBOL_LIBRARY` so pricing still resolves.
- `migrateLegacyCommsData()` converts old `kind:'data'` circuits into rack
  ports. **Data-integrity critical.**

### B7. Catalog
`app/src/core/catalog.js` is already an exact extraction of `SYMBOL_LIBRARY`,
`LAYER_DEFS`, `CABLE_SIZES`, `PROTECTION_LIBRARY`. Re-extract rather than
hand-edit if the root catalog changes.

---

## C. Data / Supabase inventory

Config at L8292: `SUPABASE_URL = https://bqknltkzxjxkylxqakau.supabase.co`
(URL + anon key are in client source — normal for anon keys, **provided RLS
is correct**; see risk register).

**Tables in use**

| Table | Operations | Purpose |
|---|---|---|
| `projects` | select, upsert, delete | Personal cloud projects (`user_id` scoped) |
| `organizations` | insert, update, select | Org records |
| `organization_members` | select, insert, delete | Membership + role (`admin`/`member`) |
| `organization_invites` | insert, delete | Pending invites by email |
| `organization_projects` | select, upsert, update, delete | Projects shared to an org |
| `organization_project_access` | select, upsert, delete | Per-project role (`viewer`/`editor`) |

**RPCs:** `find_user_by_email(p_email)`, `get_my_pending_invites()`
**Edge function:** `report-problem`
**SQL in repo:** `supabase-organization-invite-accept.sql`

**Auth surface:** `getSession`, `onAuthStateChange`, `signUp`,
`signInWithPassword`, `signOut`, `resetPasswordForEmail`,
`verifyOtp` (`signup` + `recovery`), `updateUser` (password, `full_name`).

**In the new app:** none of this exists. `core/persistence.js` is
localStorage-only under `sparkydraft_cad:` — deliberately namespaced so
testing the redesign cannot corrupt real projects. **The two storage schemas
are not interoperable**; a conversion path is required (see risk R4).

---

## D. Workflow inventory

| Workflow | Current | Target in new app |
|---|---|---|
| Sign in → pick project → draft | authGate → projectPicker → canvas | Same spine; auth screen must be built in new design system |
| Create/open project | Picker tiles, local + cloud + org tabs | Extend `ProjectPicker` with cloud/org sources |
| Trace a plan | Import image/PDF → calibrate → place | ✅ already ported |
| Place devices | Symbols sheet → tap canvas | ✅ ported (library panel + ghost preview) |
| Multi-floor work | Floors sheet, switch active floor | **Needs floor switcher in chrome** |
| Assign circuits | Props sheet → circuit select | Inspector "Electrical" section (currently a stub note) |
| Link switches to lights | `link` tool → assign sheet | Needs tool + bank UI |
| Route cables | `line` tool | Needs tool |
| Panel schedule | Sheet with inputs + table | Likely a workspace *mode* rather than a sheet |
| Quote | Sheet, itemised toggle, rates | Mode; §20 wants it visibly connected to drafting |
| Comms racks | Sheet per rack, port rows | Inspector for rack + dedicated view |
| Civil works | Mode toggle, own palette + plans | Plan-type switch in new shell |
| Elevations | Sheet + own canvas | Report-style dialog + live preview canvas — resolved, see §I item 1 |
| Print / PDF | Print view → paged output | Dedicated output mode |
| Share to org | Save options → share | Project-level action in picker/chrome |
| Manage members/invites | Org sheet tabs | Settings surface |

---

## E. Architecture inventory

| Concern | Current | New | Risk |
|---|---|---|---|
| Structure | 1 file, 9,182 lines, globals | 16 ES modules, `core/` (no React) + `ui/` | — |
| Build | None (static) | None — in-browser Babel loader | Medium: dev-only tooling, needs Vite |
| State | One mutable `state` global + direct DOM writes | `createDocument()` commit funnel + React chrome | — |
| Rendering | Full repaint on demand | rAF-batched, viewport-culled, no React re-render during drag | New is better |
| Undo | Snapshot on `pushHistory()` calls sprinkled through code | Single commit funnel, structurally cannot miss | New is better |
| Persistence | `storageAPI` + Supabase | localStorage only | **High** |
| Auth | Supabase, gate-on-boot | None | **Critical** |
| Data model | Project → floors/civilPlans + project-level collections | Single flat drawing | **Critical** |
| Commands | Hand-maintained palette array (has drifted) | One registry feeding everything | New is better |
| Styling | Hand-written CSS, dual theme via class | Tailwind tokens, audited contrast | New is better |

---

## F. Dependency analysis → amended migration order

Dependencies found:
```
Document model ─┬→ Floors ──┬→ Circuits ─┬→ Panel schedule
                │           │            └→ Quote (needs circuits for protection cost)
                │           ├→ Switch links → lighting banks → circuits
                │           ├→ Cables (line tool) → cable-run estimate → panel schedule
                │           └→ Comms racks → patch panels → quote
                ├→ Civil plans → civil materials → civil quote
                └→ Elevations
Auth → Org → Project access → Sharing → Cloud persistence
Everything → Print/PDF (renders whatever exists)
```

**Amended order** (replaces §7; §7 permits this where dependency analysis shows a safer path):

| Phase | Scope | Why here |
|---|---|---|
| **0** | **Document model + floors + project shell** | Everything else depends on it. Non-negotiable first. |
| 1 | Remaining canvas primitives: walls, cables, dimensions, rooms, custom symbols, version history | Data these produce is consumed by later phases |
| 2 | Switch linking + lighting banks | Circuits depend on bank/gang logic |
| 3 | Circuits (+ isolate view, labels, runs overlay) | |
| 4 | Panel schedule + load/demand + cable-run estimate | Depends on circuits + cables + calibration |
| 5 | Comms racks + ports + derived patch panels | Feeds quote |
| 6 | Quote + price list + overrides | Depends on circuits, comms, catalog |
| 7 | Civil plans subsystem + civil materials + civil quote | Self-contained; safe to do after core is stable |
| 8 | Elevations + legend | Report-style dialog, not a plan type — no drafting deps at all |
| 9 | Print / PDF / export | Renders everything above |
| 10 | Auth → Supabase → orgs → members/invites → sharing → access/read-only → cloud sync | Largest security surface; done once data model is final. **Done out of order, ahead of Phase 9, at the owner's direction (5 Sep 2026)** — nothing in it depends on print/PDF |
| 11 | Full integration pass + security review + regression — ✅ complete, see PRODUCT_AUDIT.md | §23 |

Auth (§7 Phase 8) stays late deliberately: wiring cloud sync to a data model
still in flux would mean migrating stored cloud records twice.

---

## G. Risk register

| # | Risk | Area | Priority | Mitigation |
|---|---|---|---|---|
| R1 | New document model can't hold current data (floors, circuits, civil, elevations) | Architecture | **Critical** | Phase 0 before any subsystem work |
| R2 | Load/demand + quote formulas silently altered during port | Business logic | **Critical** | Extract verbatim into pure modules; unit-check against current output |
| R3 | RLS/permission behaviour weakened when rebuilding auth/org — ADDRESSED Phase 10 | Security | **Critical** | Ported call-for-call: same tables, columns, filters and RPCs, no DDL and no policy change. Still needs the §23 review and a signed-in end-to-end pass (see §I item 10) |
| R4 | Storage schema mismatch → user data loss on cutover — ADDRESSED Phase 10 for the CLOUD half | Data integrity | **Critical** | `core/cloudFormat.js` converts both ways and the cloud column keeps PRODUCTION's shape, so a record either app writes opens in the other. Proven by `app/test/cloud-format-parity.mjs`: 200 records built by production's own `buildProjectData()`, opened and saved by the redesign, compared field by field — 6,210 comparisons, no drift. The LOCAL `project:` keys are still deliberately untouched by the redesign |
| R5 | `migrateLegacyCommsData()` not carried over → old saves corrupt on load | Data integrity | **High** | Port migration before comms UI |
| R6 | Read-only/viewer mode omitted → viewers can edit shared projects — RESOLVED Phase 10 | Security | **High** | Enforced at `doc.commit`/`undo`/`redo`/`jumpTo` — one choke point every mutation already passes through, so no control, shortcut or palette entry can miss it. Covered by `app/test/readonly-guard.mjs` and verified in the browser (a viewer's clicks changed nothing and wrote nothing) |
| R7 | Derived patch-panel logic dropped → quotes under-count | Business logic | **High** | Port with comms phase; verify against current totals |
| R8 | Circuit branching simplified to a chain | Business logic | **High** | Port `computeChainEdges`/`computeGpoChains` as-is |
| R9 | No build step; in-browser Babel loader ships to users | Performance/tech debt | **High** | Introduce Vite before any production cutover (needs Node) |
| R10 | Canvas performance with many objects + multiple floors | Performance | Medium | Culling already in place; re-test at scale each phase |
| R11 | Touch regressions as tools multiply | Responsive | Medium | Re-run touch tests per phase (§17) |
| R12 | Elevations' correct home in new architecture — RESOLVED Phase 8 | Architecture | Medium | Confirmed by reading production: #elevCanvas has no pointer handlers at all, items are added only through a number-entry form. Not a plan type; built as a report-style dialog. |
| R13 | Print/PDF depends on every subsystem's render | Output | Medium | Do last |
| R14 | Anon key + URL in client source — VERIFIED Phase 10 | Security | Medium | Checked against the LIVE project, not the policy files: `app/test/rls-probe.mjs` holds the publishable key as an anonymous visitor and every table and RPC the app uses refuses it (`projects` returns `[]`; the five org tables and all five RPCs return 42501; an INSERT is refused by policy). Re-runnable |
| R15 | Dual apps coexisting invites drift on `main` | Process | Medium | Keep `index.html` untouched; re-sync inventory if `main` moves |

---

## H. Parity matrix

| Area | Current | New | Gap | Business-logic risk | Priority | Status |
|---|---|---|---|---|---|---|
| Document model / floors | Complete | Complete (model) | Floor-switching UI still to come | Critical | Done | ✅ |
| Canvas core (pan/zoom/grid/snap/select) | Complete | Complete | Minor | Low | Done | ✅ |
| Undo/redo | Complete | Complete (better) | None | Medium | Done | ✅ |
| Plan import + calibration | Complete | Complete | None | Low | Done | ✅ |
| Layers | Complete | Partial | Cables/labels not layer-gated (device visibility fixed in Phase 2) | Low | Medium | Pending |
| Inspector / properties | Complete | Partial | Significant | Medium | High | Pending |
| Walls / cables / dimensions / rooms | Complete | Complete | None | Medium | Done | ✅ |
| Switch links + banks | Complete | Complete | None | High | Done | ✅ |
| Circuits | Complete | Complete | None | **Critical** | Done | ✅ |
| Panel schedule + load estimate | Complete | Complete | None | **Critical** | Done | ✅ (parity-tested) |
| Quote + price list | Complete | Complete | Price edits persist (deviation, §I) | **Critical** | Done | ✅ (parity-tested) |
| Comms racks | Complete | Complete | None | High | Done | ✅ (parity-tested) |
| Civil / underground | Complete | Complete | Print/PDF pages land with Phase 10 | High | Done | ✅ (parity-tested) |
| Elevations | Complete | Complete | None | Medium | Done | ✅ (parity-tested) |
| Print / PDF / export | Complete | Complete | None | Medium | Done | ✅ (parity-tested) |
| Version history | Complete | Complete | None | Low | Done | ✅ |
| Local persistence | Complete | Partial (own local namespace) | Local keys deliberately separate; cloud format now interoperable | **Critical** | High | Pending (local cutover, R4) |
| Auth | Complete | Complete | None | **Critical** | Done | ✅ (signed-in pass outstanding, §I item 10) |
| Supabase sync | Complete | Complete | None | **Critical** | Done | ✅ (parity-tested) |
| Organizations / members / invites | Complete | Complete | None | **Critical** | Done | ✅ (signed-in pass outstanding) |
| Sharing / access / read-only | Complete | Complete | None | **Critical** | Done | ✅ (read-only guard tested) |
| Command palette / context menu | Basic | Complete (better) | None | Low | Done | ✅ |
| Responsive (3 models) | Partial | Complete | None | Low | Done | ✅ |

**Scale of remaining work:** 20 of 23 areas complete. What is left is
two long-standing Partials predating this phase (Layers — cables/labels
not layer-gated; Inspector/properties), the local-storage cutover
decision (R4), and the §23 integration and security review in Phase 11.

---

## I. Items flagged for owner review

Per §8/§20 — these change product behaviour and are **not** mine to decide:

1. **R12 — Elevations' architecture.** RESOLVED in Phase 8 — reading
   production's own code settles this rather than requiring a judgment
   call: `#elevCanvas` has no pointer handlers at all. Every item is
   added through a number-entry form (device, distance from the left
   edge in mm, installation height in mm); the canvas only ever redraws
   a live preview of that data. There is no pan, no zoom, no snapping,
   nothing resembling the floor/civil drafting model. So it is not a
   third plan type — it is a report-style dialog (the same shape as the
   Quote, Panel Schedule and Civil Materials dialogs), with a live
   schematic preview. No navigation change, nothing §32 reserves for the
   owner. Left listed so the decision is visible rather than silently made.
2. **Panel schedule / quote as "modes" vs sheets.** §13 of the directive
   raises workspace modes; adopting them changes navigation (§32 forbids
   fundamental navigation changes without approval).
3. **Storage cutover strategy (R4).** Convert existing `project:` records
   in place, or run both schemas during a transition? Data-loss risk either way.
4. **GST hard-coded at 10%.** Correct for AU today; flagging only because it
   is a literal in the total, not a setting.
5. **Grid spacing units.** RESOLVED in Phase 0 — the new model now stores
   `gridSpacingMM` in real millimetres like production, converted through the
   plan's calibration by `gridWorldUnits()`. Left listed so the decision is
   visible rather than silently made.
6. **Price-list edits now persist.** The current app edits its global
   SYMBOL_LIBRARY and loses every edit on reload. The redesign cannot
   mutate its catalog (it is a byte-comparable extraction), so edits are
   stored per project and saved with it. Strictly better, but it IS a
   behaviour change to how a job is priced, so it is on this list rather
   than buried in a commit.
7. **Whole-job civil total omits comms conduit, poles and overhead.**
   `computeAllCivilTotals()` — the civil line shown on the main quote —
   counts pits and ELECTRICAL conduit only. Comms conduit is looked up in
   `CONDUIT_SIZES`, where an `nbn*` size id never matches, so it silently
   contributes nothing; poles and overhead runs are not iterated at all.
   The per-plan civil takeoff prices all of them correctly, so the two
   figures disagree. Ported verbatim because correcting it raised
   whole-job civil totals by 10–50% on randomised jobs, and that is a
   money change, not a bug fix I can make unilaterally.
8. **Cloud login gates access to LOCAL drawings too.** Ported as
   production behaves: if the Supabase library fails to load (ad
   blocker, no signal, CDN blocked) the gate stays shut and says
   "Couldn't reach the login service" — locking someone out of drawings
   already saved on their own device. For an electrician standing in a
   half-built house with no reception that is a real problem, but
   changing who can open the app is a product decision, not a porting
   one. Flagging rather than quietly improving.
9. **Read-only enforcement moved from an overlay to the document.**
   Production covers the canvas and toolbars with a click-eating overlay,
   which also blocks pan and zoom — a viewer cannot look around the
   drawing they were given access to read. The redesign refuses edits at
   `doc.commit` instead, so navigation keeps working and nothing that
   mutates can slip past. Strictly better and it closes R6 more tightly,
   but it IS a behaviour change to what a viewer can do, so it is on this
   list. One rough edge left: the inspector's "Import floor plan…" and
   "Calibrate from a known length…" buttons are still shown to a viewer
   and do nothing when clicked. Inert, not unsafe — worth tidying in the
   §35 audit pass rather than auditing 1,450 lines of inspector now.
10. **Signed-in end-to-end verification still outstanding.** Everything
   reachable without an account was verified live: the gate's six modes,
   real Supabase error handling, and RLS against the live project. The
   signed-in half (cloud list/save, orgs, members, invites, sharing,
   per-project access, viewer mode) was verified against an in-memory
   Supabase double, because I am not permitted to type the owner's
   password into a login field or to create an account. That leaves one
   gap only a signed-in session can close, and it should be closed before
   cutover: sign in, and I can drive the same checks against the real
   project in a few minutes.
11. **Rate fields narrow from string to number in the cloud record.**
   Production writes the four money/rate fields as the DOM input's string
   ("95"); the redesign writes the number. Harmless in practice —
   production assigns them straight back into an `<input>.value`, which
   stringifies — and it is the only format difference the adapter
   knowingly introduces. Listed because it is a change to bytes already
   in customers' cloud records.
12. **Cable-run estimate for switched lighting.** The estimate covers
   hard-active runs only. Production's source carries the owner's own
   instruction (30 Aug 2026) that extending it needs a redesign around a
   switch's view of what it feeds, and that it must not be built
   speculatively. Carried across verbatim in `core/panelSchedule.js`;
   still awaiting that conversation.

---

## J. Inventory completion (§4A-I)

- [x] Current application inspected (structure, sections, business logic, Supabase surface, UI surfaces)
- [x] New React application inspected (all 16 modules, data model, command set)
- [x] Major feature areas identified
- [x] Missing functionality identified
- [x] Partial functionality identified
- [x] Important business logic identified and recorded verbatim
- [x] Supabase/data dependencies identified (6 tables, 2 RPCs, 1 edge function, 9 auth calls)
- [x] Authentication/permission dependencies identified
- [x] Important workflows identified
- [x] Architectural dependencies identified
- [x] Major migration risks identified (15, prioritised)
- [x] Defensible migration order established (amended, with rationale)

**Status: complete.** This document is the working migration checklist and
will be updated as phases land. The final report (§26) must reference it and
show the final status of every row.
