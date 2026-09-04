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
| Quote totals | `updateQuote()` L6726 | — | ✗ |
| Quote itemised / quantity-summary toggle | `state.quoteItemized` | — | ✗ |
| Price list / device library editing | `renderPriceList()` L4189 | — | ✗ |
| Per-object price override | `effectivePrice()` L1658 | — | ✗ |
| Labour rate / margin / equipment / travel inputs | quote sheet | — | ✗ |
| Export quote summary (copyable text) | L4813 | — | ✗ |

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
| Civil plans (parallel plan type) | `state.civilPlans[]`, `makeCivilPlan()` | — | ✗ ⚙ |
| Pits, conduits, building entries, poles, overhead runs | `PIT_LIBRARY` etc. L1494+ | — | ✗ |
| Civil render/interaction pipeline | `renderCivil()` L2360, `pointerdownCivil()` L3445 | — | ✗ |
| Civil materials schedule | `sheetCivilMaterials` | — | ✗ |
| Civil quote totals | `computeAllCivilTotals()` L6769, `updateCivilQuote()` L6788 | — | ✗ |
| Civil mode toggle | `civilModeToggle` | — | ✗ |

### A6. Other drawing systems

| Feature | Current | New | Status |
|---|---|---|---|
| Elevations | `renderElevationSelect()` L5391, `state.elevations[]` | — | ✗ |
| Legend | `computeLegendEntries()` L5529 | — | ✗ |

### A7. Output

| Feature | Current | New | Status |
|---|---|---|---|
| Print view | `printView`, L5577+ | — | ✗ |
| PDF export (jsPDF) | `downloadPdfExport()` | — | ✗ |
| Save-as-PDF dialog | L5577+ block | — | ✗ |
| Civil pages in export | `includeCivilInExport` | — | ✗ |
| Download project copy (JSON) | `downloadProjectCopy()` L7646 | — | ✗ |

### A8. Projects / persistence

| Feature | Current | New | Status | Notes |
|---|---|---|---|---|
| Project picker | L7881+ | `ProjectPicker.jsx` | ◐ | New is local-only; no cloud/org tabs |
| Local save/load | `storageAPI` L7208 | `core/persistence.js` | ◐ | **Different key namespace and schema** — not interoperable |
| Autosave + save status | L7670+ | main.jsx autosave | ✅ | Both real-state driven |
| Session recovery banner | `recoveryBanner` | — | ✗ |
| Project rename / identity | `state.currentProjectId` | ◐ | New has id but no cloud identity |
| Save options sheet (local/cloud/download) | `sheetSaveOptions` | — | ✗ |

### A9. Cloud / collaboration — **entirely absent from new app**

| Feature | Current | New | Status |
|---|---|---|---|
| Supabase client + config | L8286+ | — | ✗ |
| Auth gate (login/signup) | `renderAuthGate()` L8335 | — | ✗ |
| Email verification (OTP) | `verifyOtp` type `signup` | — | ✗ |
| Password reset (OTP + update) | L8445–8500 | — | ✗ |
| Session handling | `onAuthStateChange` L8313 | — | ✗ |
| Account sheet | `renderAccountSheet()` L8604 | — | ✗ |
| Cloud project list/load/save/delete | L7991–8261 | — | ✗ |
| Organizations (multi-org) | L8757+ | — | ✗ |
| Org members + roles | `organization_members` | — | ✗ |
| Invitations (send/accept/decline) | L8838–8920 | — | ✗ |
| Project sharing to org | `organization_projects` | — | ✗ |
| Per-project access roles | `organization_project_access` | — | ✗ |
| Read-only mode for viewers | `readOnlyMode`, `readOnlyBanner` | — | ✗ |
| Report a problem (Edge Function) | L4052 | — | ✗ |

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
| Elevations | Sheet + own canvas | Needs decision: separate view vs plan type **?** |
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
| 8 | Elevations + legend | |
| 9 | Print / PDF / export | Renders everything above |
| 10 | Auth → Supabase → orgs → members/invites → sharing → access/read-only → cloud sync | Largest security surface; done once data model is final |
| 11 | Full integration pass + security review + regression | §23 |

Auth (§7 Phase 8) stays late deliberately: wiring cloud sync to a data model
still in flux would mean migrating stored cloud records twice.

---

## G. Risk register

| # | Risk | Area | Priority | Mitigation |
|---|---|---|---|---|
| R1 | New document model can't hold current data (floors, circuits, civil, elevations) | Architecture | **Critical** | Phase 0 before any subsystem work |
| R2 | Load/demand + quote formulas silently altered during port | Business logic | **Critical** | Extract verbatim into pure modules; unit-check against current output |
| R3 | RLS/permission behaviour weakened when rebuilding auth/org | Security | **Critical** | Do not redesign the permission model; port call-for-call. Security review before completion (§16/§23) |
| R4 | Storage schema mismatch → user data loss on cutover | Data integrity | **Critical** | Write a conversion path; never overwrite `project:` keys from the new app until proven |
| R5 | `migrateLegacyCommsData()` not carried over → old saves corrupt on load | Data integrity | **High** | Port migration before comms UI |
| R6 | Read-only/viewer mode omitted → viewers can edit shared projects | Security | **High** | Port `readOnlyMode` with the sharing phase |
| R7 | Derived patch-panel logic dropped → quotes under-count | Business logic | **High** | Port with comms phase; verify against current totals |
| R8 | Circuit branching simplified to a chain | Business logic | **High** | Port `computeChainEdges`/`computeGpoChains` as-is |
| R9 | No build step; in-browser Babel loader ships to users | Performance/tech debt | **High** | Introduce Vite before any production cutover (needs Node) |
| R10 | Canvas performance with many objects + multiple floors | Performance | Medium | Culling already in place; re-test at scale each phase |
| R11 | Touch regressions as tools multiply | Responsive | Medium | Re-run touch tests per phase (§17) |
| R12 | Elevations' correct home in new architecture unclear | Architecture | Medium | **Flag for review** — separate view vs plan type |
| R13 | Print/PDF depends on every subsystem's render | Output | Medium | Do last |
| R14 | Anon key + URL in client source | Security | Medium | Normal *if* RLS is sound — **verify RLS policies during Phase 10** |
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
| Quote + price list | Complete | Missing | Significant | **Critical** | **Critical** | Pending |
| Comms racks | Complete | Complete | None | High | Done | ✅ (parity-tested) |
| Civil / underground | Complete | Missing | Significant | High | High | Pending |
| Elevations | Complete | Missing | Significant | Medium | Medium | Pending |
| Print / PDF / export | Complete | Missing | Significant | Medium | Medium | Pending |
| Version history | Complete | Complete | None | Low | Done | ✅ |
| Local persistence | Complete | Partial (own schema) | Significant | **Critical** | High | Pending |
| Auth | Complete | Missing | Fundamental | **Critical** | **Critical** | Pending |
| Supabase sync | Complete | Missing | Fundamental | **Critical** | **Critical** | Pending |
| Organizations / members / invites | Complete | Missing | Fundamental | **Critical** | **Critical** | Pending |
| Sharing / access / read-only | Complete | Missing | Fundamental | **Critical** | **Critical** | Pending |
| Command palette / context menu | Basic | Complete (better) | None | Low | Done | ✅ |
| Responsive (3 models) | Partial | Complete | None | Low | Done | ✅ |

**Scale of remaining work:** 4 of 23 areas complete. The new app currently
implements roughly the drafting substrate; the electrical, commercial,
output and cloud halves of the product are entirely unported.

---

## I. Items flagged for owner review

Per §8/§20 — these change product behaviour and are **not** mine to decide:

1. **R12 — Elevations' architecture.** Separate view, or a third plan type
   alongside floors/civil? Affects the Phase 0 model. **[no historical context]**
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
6. **Cable-run estimate for switched lighting.** The estimate covers
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
