# SparkyDraft — Full Repository Audit & Redesign Assessment

**Repository:** brock-symons/sparkydraft · **Commit reviewed:** `82be509` (main) · **Prepared:** 2026-09-03
**Method:** Static code review + full git-history analysis (90 commits, the project's entire lifetime) · **Live testing:** none performed

This is a static read of the repository as it exists today, plus its full git history. No exploit was attempted, no dependency was upgraded, no code was written to produce this report. Where it says a feature is broken or missing, that's from reading the function that would implement it — not from assuming it based on a file or button name. Every risk and compliance item below is a flag for a qualified human, not a finding you can close by having Claude Code write more code.

---

## 1. Full repository inspection

### 1.1 Architecture

SparkyDraft is a single static file, `index.html` (9,182 lines, ~528 KB): a `<style>` block (lines 7–1348), then one `<script>` block (1350–9182) holding the entire application — 242 top-level functions, no modules, no bundler, no `package.json`. There is no build step by design; you open the file in a browser and it runs. The whole app is one global `state` object (initialised at line 1611) mutated in place by event handlers, with a hand-rolled JSON-snapshot undo/redo stack layered over it.

This is a genuinely hard-mode way to build an app of this size, and the surprising finding of this audit is that it's been done carefully — comments explain *why*, not just what; there isn't a single `TODO`/`FIXME`/`HACK` marker anywhere in the file; and the one intentionally-disabled feature (Mark Wall) is marked as such in a documented convention (`.hidden-feature`, line 1112) rather than silently commented out. The problems here are architectural — no framework, no build, no tests, no separation of concerns — not the "vibe-coded mess" pattern this kind of audit usually finds. That distinction matters for §5.

### 1.2 Frameworks and libraries

| Library | Source | Version pin | Used for |
|---|---|---|---|
| None (vanilla JS/HTML/CSS) | — | — | Entire UI, state, canvas rendering — no React/Vue/etc. |
| `@supabase/supabase-js` | cdn.jsdelivr.net | **`@2`** — unpinned major | Auth, Postgres access, Edge Function invocation |
| jsPDF | cdn.jsdelivr.net | `2.5.2` — pinned | Native vector PDF export |
| pdf.js | cdnjs.cloudflare.com | `3.11.174` — pinned | Rasterising an imported PDF floor plan to an image |

No package manager, no lockfile, no Dependabot-visible manifest. The one real dependency-hygiene gap is `@supabase/supabase-js@2` loading whatever the current 2.x release is on every page load, with no changelog review before a new minor/patch reaches production users.

### 1.3 Frontend architecture

A single global `state` object holds `floors[]` (electrical rough-in plans), `civilPlans[]` (underground/civil works, structurally parallel to `floors[]`), `circuits[]`, `layers[]`, `customSymbols[]`, and UI/session flags. Two render loops — `render()` for electrical and `renderCivil()` for civil — share one pan/zoom/coordinate-transform layer (`worldToScreen`/`screenToWorld`, 2054–2055) but otherwise draw independently by deliberate design ("mirror, don't abstract" convention, documented in comments). The undo/redo system is genuinely well built: full-state JSON snapshots capped at 60 entries, restored via id-based reconciliation (not index-based) so a restore correctly handles floors/objects added or removed since the snapshot was taken (4733–4767).

### 1.4 Backend architecture

There isn't one, beyond Supabase-as-a-service and a single Supabase Edge Function. No custom server, no API layer, no ORM. The client talks to Postgres directly through the Supabase JS client, with authorization enforced entirely by Row-Level Security policies (§8). The one piece of genuine backend logic — the "Report a problem" mailer — lives in a Supabase Edge Function that is **not present in this repository**; its source, secrets, and JWT-verification setting couldn't be audited here and should be reviewed directly in the Supabase project.

### 1.5 Database / storage architecture

Postgres via Supabase, schema defined across seven hand-run SQL scripts (no migration tool — run manually, in order, per README): `supabase-schema.sql` → `organizations.sql` → `organization-projects.sql` → `organization-project-access.sql` → `org-member-lookup.sql` → `add-user-name-column.sql` → `fix-project-identity.sql`.

Two problems worth flagging (see §4): **`supabase-schema.sql` is now stale** — it still declares `unique (user_id, name)` on `projects`, a constraint `fix-project-identity.sql` later drops in production, so re-running schema.sql from scratch against a fresh Supabase project would silently reproduce the exact bug that fix was written to eliminate. And there is no rollback script for any of the seven files.

Project data itself is stored as an opaque `jsonb` blob (the entire in-memory `state`, minus the floor-plan background image) per row — no relational modelling of floors, circuits, or devices at the database level.

### 1.6 Authentication / user system

Supabase Auth, email+password. A full-screen gate blocks all use of the app until signed in (commit `0001a41`). Signup collects name/organisation, forgot-password and reset flows exist, and — deliberately, per an in-code comment (8389–8393) — email confirmation and password reset use a typed 6-digit code rather than a clickable magic link, specifically to avoid corporate email-scanner bots burning single-use links before the user clicks them. Session/token handling is the Supabase SDK default (JWT pair in `localStorage`) — see §8 for why that matters more than usual here.

### 1.7 File / document storage

No Supabase Storage bucket, no S3, no CDN upload path. Imported floor-plan images and PDFs are converted client-side to a base64 `data:` URL and embedded directly inside the project's JSON blob. Simple, but every project save/load round-trips the full image payload, and there's no size cap on the imported file (§8).

### 1.8 PDF functionality

**Export** is real: `downloadPdfExport()` (5845) builds a genuine vector PDF via jsPDF — legend and quote text are drawn natively, not rasterised from a screenshot — with a Save-As file picker where supported and a correctly-handled cancel-vs-failure distinction. **Import** is also real: an uploaded PDF floor plan is parsed by pdf.js in an offscreen canvas and flattened to a raster image before being used as the drawing background — a safe pattern that doesn't execute embedded PDF JavaScript. One inconsistency: PDF export has no guard if the jsDelivr CDN fails to serve jsPDF (throws an uncaught error) where the equivalent Supabase CDN-failure path elsewhere degrades gracefully with a toast.

### 1.9 CAD / floor-plan implementation

A genuine 2D CAD-lite: calibrated scale (two-point tap + real-world distance, sets `plan.scale` in px/metre), snap-to-grid/device/wall (four-tier priority in `snapPoint()`, 2761), architectural layers with lock/visibility enforced consistently at placement, drag, hit-test, and render, multi-floor support, a measure tool, and a parallel civil/underground-works canvas for pits, conduits, poles, and overhead runs. This is the strongest-built part of the app.

### 1.10 Electrical design functionality — the honest version

Full detail and code citations in §9; summary:

| Capability | What actually exists |
|---|---|
| Lighting / GPO / switch placement | Real — a full symbol library with AU-appropriate defaults, wall-snapping, gang counts, two-way switching, switch-to-light linking |
| Switchboard | A symbol acting as a logical feed point for circuit trees — no internal pole/way layout |
| Circuits | Real, non-trivial routing: a degree-constrained nearest-neighbour tree, not a naive chain or straight lines |
| Cable sizing (AS/NZS 3008) | **Does not exist.** Cable size is a free-text field the user types |
| Voltage drop | **Does not exist anywhere in the file** — zero code, zero UI mention |
| Maximum demand / diversity | Exists, self-labelled "not AS/NZS 3000, planning estimate only" in both code and UI |
| Protection (MCB/RCD/RCBO) sizing | User pick only, one shallow over-current sanity check against connected load |
| Cable-run length estimate | Real, routed, includes ceiling-to-device vertical drops — better engineered than expected, but explicitly hard-active-circuit-only |

### 1.11 Data/comms, quoting, materials, job management

**Comms/data racks** are a deliberately separate model from electrical circuits — fixed numbered "home run" ports per rack, patch-panel count derived from port count rather than placed, with a legacy-data migration path that preserves rather than drops orphaned old-format connections. **Quoting** is real, transparent arithmetic (materials + labour×rate + protection + equipment + travel, then margin, then GST) over a hardcoded pricing table — not a database, a JS object literal with an in-app editor bolted on. GST is hardcoded at 10% with no field to change it. **Job management** — local (localStorage) and cloud (Supabase) save/load both work, projects get a real UUID at creation, and the historical name-keyed collision bug (fixed in commit `7a733c5`) was verified still fixed in current code.

### 1.12 API integrations / third-party services

- Supabase — auth, Postgres, RLS, one Edge Function
- Resend — transactional email for the "Report a problem" form, called only from the (unauditable, not in this repo) Edge Function, never directly from the client
- jsDelivr / cdnjs — static library CDN, not a service integration

### 1.13 AI functionality

None found. No client-side call to an LLM/AI API, no "AI" branded feature, no auto-suggest/auto-generate function. SparkyDraft itself contains no AI; it has been *built* using Claude Code (visible throughout the commit history), which is a different thing worth being precise about when talking to customers.

### 1.14 Security, testing, error handling, validation, permissions — headline only

Full detail in §4 and §8. Security has one real High-severity stored-XSS chain and is otherwise sound for a Supabase-RLS SPA; testing is **completely absent** — zero automated tests, zero CI, no `.github/` directory at all; error handling is unusually good for a codebase this size (every `JSON.parse` guarded, most async calls wrapped with user-facing toasts); input validation is sparse (only two numeric fields in the whole app have a `min` attribute); permissions are enforced at the database (RLS) layer correctly in principle, with the client trusting its own role flags for UI gating only — the normal, correct shape for this architecture, provided the RLS policies are exactly right (they mostly are — see §8).

---

## 2. What has changed

The entire git history is 90 commits across six calendar days (28 Aug – 3 Sep), authored through Claude Code by both developers. There is no older history — this *is* the project's whole lifetime so far.

### 2.1 Phase 1 — Auth & cloud save (28 Aug)

Full-screen login gate, signup, forgot-password, and a switch from clickable email links to typed confirmation codes — all in one day. **Complete, no debt found.** This phase also shipped the first cloud-save schema and its first bug: projects were upserted by `(user_id, name)`, so two differently-intentioned projects sharing a name silently overwrote each other — not fixed until Phase 3.

### 2.2 Phase 2 — Organizations, in three undocumented phases (29–31 Aug)

Multi-tenant sharing was built incrementally and each increment is candid about what it doesn't yet do:

- **Phase 1** (`a909d88`, explicitly commit-tagged "not merged to main yet"): organizations + invites. Shipped with an infinite-recursion bug in its own RLS policies, fixed twice in the same day (`df64cd0`, `64869da` — two commits with the identical message).
- **Phase 2** (`supabase-organization-projects.sql`): sharing a project into an org. Its own header comment states plainly: *"this does NOT yet enforce view-only access for non-owners — any org member who opens a shared project can currently edit it."* That gap existed in production until Phase 3.
- **Phase 3** (`supabase-organization-project-access.sql`, `a5bb6cc`): per-project editor grants, closing the Phase 2 gap.

Separately, invites originally added a person to `organization_members` immediately, with no accept/decline step at all — only fixed later (`47b3f48`, `supabase-organization-invite-accept.sql`).

**Assessment: complete now, but this whole subsystem shipped three separate times with a known hole, then closed the hole after the fact, rather than being designed access-control-first.** That pattern — and the still-live XSS chain riding on exactly this invite/sharing subsystem — is why organizations is the single area of the app this audit weighs most heavily in §8.

### 2.3 Phase 3 — Project-identity fix, twice (29–30 Aug)

The name-keyed collision bug from Phase 1 was fixed locally first (original PR #3), then had to be **re-applied** in commit `7a733c5` because the organization-sharing work landed on `main` in the meantime and touched the same save/load code, making the two branches unmergeable cleanly. The second pass extended the fix to the cloud path too and required a corresponding SQL migration. Confirmed fully applied today, no regression — but a clean example of two parallel efforts touching the same subsystem without a branch strategy that would have caught the conflict earlier.

### 2.4 Phase 4 — The "unhide" saga (30 Aug)

Four separate PRs — **#8 Floors, #9 Rooms, #10 Cable route, #11 Elevation** — each titled "Re-enable the X feature". These were fully-implemented features deliberately hidden behind a `.hidden-feature` CSS convention during an earlier scoping pass, then individually un-hidden once someone needed them. The Cable-route PR is instructive: the feature was *fully implemented* for editing/rendering/persisting an existing cable, but the only UI path that could *create* a new one had been hidden — a fresh project literally could not have a cable route drawn on it. Invisible from reading the feature's own code; only shows up by tracing the whole user journey. **Complete, no debt** — but confirms the codebase does periodically ship states where a feature exists but has no way in.

### 2.5 Phase 5 — Comms racks rebuilt, then re-merged (30 Aug)

Commit `a8b44e8`, "Rebuild comms/data racks as a fully separate system from circuits" — a deliberate architectural split into the current fixed-port "home run" model with legacy-data migration that preserves rather than drops old connections. `6b0a8b6` then merges main "(Brae's feature re-enables)" back into the comms-rack branch — this rebuild was happening in parallel with Phase 4's unhide work, on separate branches, reconciled by hand. **Complete, well-executed**, but another example of two significant structural changes racing on parallel branches against the same file.

### 2.6 Phase 6 — Panel schedule, circuits, quote, PDF, desktop redesign (30 Aug)

The busiest single day: a panel schedule with a diversity/demand estimate, branching (not strict-chain) circuit routing, per-circuit cable-run length estimates, a print/PDF export view, a quote quantity-summary toggle, and — largest of all — a full desktop redesign merge (`d3b5513`) bringing docked panels, a command palette, a hot-task rail, keyboard shortcuts, and a bright desktop theme alongside the original dark mobile one. The redesign branch required a same-day "fix bugs found while retesting" commit (`b6fb369`) — the theme switch initially broke HUD text contrast on the new bright theme, since fixed and now guarded by an explicit `--hud-*` token convention documented in CLAUDE.md. **Complete**, and the one place in the whole history where a regression was caught, root-caused, and turned into a documented invariant rather than just patched.

### 2.7 Phase 7 — Civil/underground works module (1 Sep)

A full parallel planning system for pits, conduits, building entries, poles, and overhead runs — own canvas render loop, own snapping, own quote calculation, own legend/PDF export — added in essentially one day, immediately followed by layout and zoom bug fixes found in "the full test/visual pass". Every duplicated concept between this and the electrical module carries an explicit comment explaining why it's a deliberate mirror rather than a shared abstraction. **Complete and feature-comparable in depth to the electrical side.**

### 2.8 Naming: "Cable Routes → Cable Links"?

Doesn't hold up against the actual code: there is no "Cable Links" feature or terminology anywhere in the repository. "Cable route" is a single, continuously-present feature (temporarily hidden then un-hidden in Phase 4, never renamed or replaced). Comms racks use "home run"/"port" language; civil plans use "conduit"/"transition" language. If a rename is remembered from elsewhere, it's either outside this repository or being conflated with the comms-rack rebuild (Phase 5), which replaced one data model with another under the hood without a user-facing rename.

### 2.9 What this history tells you about how the team works

- Both developers (and/or parallel Claude Code sessions) frequently work the same file on separate branches at the same time, producing repeated "merge main in, fix what retesting found" commits rather than conflicts being caught earlier.
- Security-relevant features (organizations, invites, sharing) shipped in visibly incremental, sometimes-open states more than once, with the gap named in the commit/SQL comment at the time — good transparency, but this report is the first pass to actually collect and cross-check it end to end.
- No evidence anywhere in the history of automated testing being run before a merge — every "fix bugs found in the full test/visual pass" was manual.
- No feature was found to have been silently, permanently removed without a clear replacement.

---

## 3. Current feature status

| Feature | Status | Quality | Major problems | Recommendation |
|---|---|---|---|---|
| CAD / Floor Plan | COMPLETE | High | Undo/redo excludes the background plan image by design (memory) — undocumented to the end user | Keep as-is; surface the image-not-undoable behaviour in the UI |
| Architectural Layers | COMPLETE | High | None found | Keep |
| Grid / Snapping | COMPLETE | High | Two genuinely separate implementations (electrical vs civil) — deliberate, documented, not debt | Keep; document the split in ARCHITECTURE.md if written |
| Calibration | COMPLETE | High | None found — every downstream consumer handles "uncalibrated" gracefully | Keep |
| Lighting | COMPLETE | High | None found | Keep |
| GPOs | COMPLETE | High | None found | Keep |
| Switches | COMPLETE | High | None — gang-count auto-growth and hard-active linking handled with real care | Keep |
| Switchboard | PARTIAL | Adequate | Logical feed-point only — no internal pole/way layout | Fine as-is unless a physical-panel-layout feature is explicitly wanted |
| Circuits | COMPLETE | High | No auto-assignment/auto-balancing (manual per-device only) — absence, not a bug | Keep; auto-assign is a legitimate future feature, not a fix |
| Cable Links / Cable Route | COMPLETE | High | No standalone "Cable Links" feature exists — see §2.8 | Clarify terminology with the team before scoping redesign work here |
| Data / Communications | COMPLETE | High | None found; legacy-data migration unusually careful | Keep |
| Measurements | COMPLETE | High | None found | Keep |
| Quoting | COMPLETE | Good | Hardcoded 10% GST, no negative-input guards on rate/margin/travel fields | Add basic input validation; keep the arithmetic model |
| Materials | PARTIAL | Adequate for one user | Hardcoded JS literal, not a shared/updatable database | NEEDS REDESIGN if pricing is meant to be a real shared catalog |
| Documentation (in-app) | PARTIAL | Adequate | Panel-schedule/quote disclaimers exist but are visually secondary to the numbers they qualify | Strengthen at point of use — see §9 |
| PDF Export | COMPLETE | High | One ungraceful failure path if the CDN is blocked | Add the same CDN-failure guard used elsewhere |
| Job Management | PARTIAL | Good, one real bug | Custom symbols/prices leak across projects switched in the same browser session | Fix — small, well-scoped bug |
| Authentication | COMPLETE | High | Only a 6-char client-side password minimum; server-side rate limiting unverified from this repo | Verify Supabase Auth project settings (§8, §13) |
| Database | PARTIAL | Good, drifted | schema.sql is stale vs. production; project data is an opaque jsonb blob; no migration tooling | Reconcile schema.sql now; consider a migration tool during redesign |
| Security | BROKEN | Mixed | One High-severity stored-XSS → session-token-theft chain via org invites/sharing (§8) | Fix immediately — see §13 MUST HAVE |
| Testing | MISSING | — | Zero automated tests, zero CI, no `.github/` directory | NEEDS REDESIGN — foundational gap for a commercial release |

---

## 4. The biggest architectural problems

### 4.1 Fix now

**No automated tests, no CI, at all.** Zero test files, no `.github/workflows`, no lint step. Every regression in the git history (§2) was caught by a human doing a manual "full test/visual pass" after the fact, on a codebase that's already 9,182 lines and growing by hundreds of lines a day. This is the single change that would most reduce the rate of new bugs.

**Stored XSS via unescaped `innerHTML`, reachable cross-account** (`index.html:8873, 7935, 8073`). No HTML-escaping utility exists anywhere in the file, across 110 `innerHTML`/`insertAdjacentHTML` call sites. Two of them render org-invite and shared-project-tile text with no escaping at all, and both are reachable by any authenticated user against any other org member with no prior relationship required. Full chain in §8. This is the one item in this whole report that is a live, exploitable vulnerability today.

**`supabase-schema.sql` is stale relative to production.** `schema.sql` still declares `unique (user_id, name)` on `projects`; a later script drops that exact constraint in production. Running the setup scripts in README order against a brand-new Supabase project reproduces the original name-collision bug `fix-project-identity.sql` exists to eliminate. A five-minute fix.

### 4.2 Fix during the redesign, not urgently before it

**Everything is one file, one global `state`, one script scope.** 242 functions with no module boundaries means every function can reach every other function and mutate the same global object. Nothing observed suggests this has caused a bug yet, but it is the ceiling on how large this codebase can grow before that discipline stops being enough, and it makes automated testing much harder to retrofit than with real module boundaries.

**Materials/pricing is a hardcoded array, not a real database** (`index.html:1358–1571`). `SYMBOL_LIBRARY`, `CABLE_SIZES`, `PROTECTION_LIBRARY`, and five more catalogs are JS object literals baked into the file. The in-app "Price List" editor mutates them in memory for one session/project — no shared, versioned, cross-user pricing source of truth.

**One confirmed data-hygiene bug: cross-project symbol leakage** (`index.html:7778–7781`). `SYMBOL_LIBRARY` is a single global array. Loading a project only ever *adds* missing custom symbols to it, never removes ones that belonged to a previously-open project in the same browser tab — opening Project A (with a custom fitting), then Project B, leaves Project B's device palette showing Project A's fitting, and placing it can throw later on a fresh reload where that symbol id no longer resolves.

**Command palette drifts from the real action list** (`index.html:7402–7431`). Confirmed still true today: "Mark wall" and "Detect walls from plan" are real, working, reachable features with no command-palette entry. CLAUDE.md already documents this as a known recurring pattern.

### 4.3 What this audit did *not* find

No dead code of any real size, no duplicated business logic that isn't a deliberate documented mirror (civil vs. electrical), no conflicting parallel implementations of the same concept, no evidence of features silently and permanently deleted. Naming is consistent. This matters for §5: the usual justification for "just rewrite it" — an unreadable, self-contradicting codebase — isn't present here.

---

## 5. Full redesign assessment

### Option A — Continue as-is
- **Advantages:** Zero migration risk, fastest to ship the next feature, team already knows the file
- **Disadvantages:** Test/CI gap never closes; every new feature adds to one 9k-line file; onboarding a third developer gets harder each month
- **Risk:** Low near-term, rising long-term · **Complexity:** None · **Reuse:** Everything
- **Dev speed:** Fine now, degrades as the file grows · **Scalability:** Poor beyond ~2 developers

### Option B — Progressive refactor
- **Advantages:** Incremental, low risk per step, ships alongside features
- **Disadvantages:** No forcing function to actually finish it; easy to stall once the urgent feature backlog crowds it out
- **Risk:** Low per-change, moderate overall (can drift indefinitely) · **Complexity:** Low-moderate, spread over time · **Reuse:** Nearly everything
- **Dev speed:** Slight short-term drag, improving · **Scalability:** Good, eventually

### Option C — Architectural redesign, logic preserved ⭐ Recommended
- **Advantages:** Real module boundaries + a test suite become possible; the well-designed parts (circuit routing, undo/redo, diversity calc) are ported deliberately, not re-derived from memory
- **Disadvantages:** Needs a defined scope and timeline or it becomes Option D by accident; a genuine multi-week commitment
- **Risk:** Moderate, managed by porting logic under characterisation tests before restructuring around it · **Complexity:** Moderate-high, one-time
- **Reuse:** All domain logic (circuit tree, diversity/demand calc, quote arithmetic, snapping, undo/redo reconciliation) — these took real engineering thought and are correct today
- **Discard:** The single-file/global-state shell around that logic; the ad-hoc SQL-script schema process
- **Dev speed:** Slower for one release cycle, faster after · **Scalability:** Good — this is what actually fixes §4.2's ceiling

### Option D — Rebuild from scratch
- **Advantages:** Cleanest possible starting point; no legacy constraints
- **Disadvantages:** Discards subtle, already-debugged logic (degree-constrained circuit routing, id-reconciled undo/redo, wall-snap heuristics) with real risk of silently reintroducing bugs already found and fixed once
- **Risk:** High — long dark period with no shippable product, and no automated tests exist to prove the rebuild matches current behaviour · **Complexity:** Very high
- **Reuse:** Domain knowledge only, not code · **Dev speed:** Large stall, uncertain recovery time · **Scalability:** Best case, if it's ever finished

### Recommendation

**Option C — a real architectural redesign that preserves the existing domain logic**, not a rewrite. The evidence in §4 doesn't support Option D: this codebase isn't the tangled, self-contradicting mess that normally justifies starting over. Its most valuable code — the circuit-routing tree, the id-reconciled undo/redo, the diversity/demand estimate, the cable-run length estimate — is subtle, already correct, and already once-debugged; re-deriving it from a blank file is a real chance to reintroduce bugs that have already been found and fixed. What actually needs to change is the shell around that logic: split the one file into real modules, add a build step, and — most importantly — put a characterisation-test harness around the existing business logic *before* restructuring it, so the redesign can prove behavioural equivalence rather than assert it. Option B is the second choice if the team genuinely cannot free up a dedicated block of time; it's lower-risk per step but has repeatedly stalled in codebases this shape once feature pressure returns, and it doesn't reliably produce the test coverage §4.1 calls a release blocker.

---

## 6. A better GitHub structure

Today: one long-lived `main` branch, short-lived feature branches merged via PR, no CI, no issue tracker use visible in the history, no PR template, no tags. Workable for one or two people, but §2 already shows real collisions from working the same file on parallel branches without a shared draft point. The fix is small, not an enterprise process.

**Branching**
- `main` — always deployable, protected (no direct pushes, PR required)
- Add one `develop` branch only if Brock and Brae are ever both mid-feature on unrelated things at once — otherwise skip it
- Short-lived `feature/…` / `fix/…` branches, one per task, deleted on merge — the existing naming convention is already good
- Rebase or merge from `main` daily on anything touching `index.html`, given how often the history shows two branches racing on the same file

**Review & merge**
- Every PR gets at least a self-review diff read before merge — cheap, and would have caught the schema.sql drift in §4
- A short PR template: what changed, why, what was tested, any SQL to run manually
- Squash-merge to keep `main`'s history as one entry per feature

**Releases & rollback**
- Tag `main` at every meaningful milestone (`v0.1.0`, etc.) — right now there is no way to say "roll back to the last known-good state" other than picking a commit by reading messages
- Keep a one-paragraph release note per tag, naming any required manual SQL step

**Backups**
- Confirm Supabase's automatic Postgres backups are enabled, and that someone has tested a restore once
- Git itself is not a data backup — customer project data lives in Postgres/localStorage, not in this repository

### 6.1 Minimum viable CI/CD

No build step means CI doesn't need to be elaborate — but that's not a reason to have none at all:
- **Secret scanning + push protection** — free, built into GitHub, currently off. Enable it now.
- **Dependabot alerts** — of limited use with no package.json, but pin `@supabase/supabase-js` to an exact version so there's something to actually track.
- **A GitHub Action that opens `index.html` in headless Chromium and asserts the app boots without a console error** — a few hours of Playwright work, and the single highest-leverage CI step available given there's no test suite yet.
- **HTML/JS lint** (even just a syntax check) on every PR.

### 6.2 Issues & Projects

No evidence GitHub Issues has been used at all — the commit history is currently the only record of what was fixed and why. A lightweight GitHub Projects board (Backlog / In Progress / Review / Done) with Issues for anything that isn't a same-day fix is enough; skip Epics, custom workflows, or a separate Jira-style tool.

---

## 7. Claude Code workflow

The existing CLAUDE.md is genuinely good — honest about being a "living map, not a snapshot," names a real previously-fixed bug class (the HUD-contrast token rule) as a standing invariant, and tells a session to `git fetch` and skim recent diffs before trusting its own memory. Keep that pattern.

### 7.1 What to add to CLAUDE.md

- **A standing security rule**: any user-controlled or cross-org text (names, descriptions, invite metadata) reaching `innerHTML`/`insertAdjacentHTML` must go through an escaping helper — non-negotiable given §8's finding.
- **A standing "trace the whole journey" rule**: §2.4 shows a feature was fully implemented but had no way to create a new instance of it, invisible from reading the feature's own code. Any session re-enabling or adding a feature should walk the full user journey (create → edit → persist → reload → delete).
- **Never delete or hide a feature without being asked** — make explicit, since the `.hidden-feature` convention shows this has been done deliberately before and needs to stay a conscious, reversible, documented action.
- **Require the CDN-failure-guard pattern everywhere a CDN script is used** — one inconsistency (jsPDF) was found; name the correct pattern (the Supabase one) as the standard to copy.
- **A short "before claiming a UI change works" checklist**: start it, click through the golden path and one edge case, don't just report success from reading the diff.

### 7.2 Additional documents — keep it small

Adding ARCHITECTURE.md, REQUIREMENTS.md, DECISIONS.md, CURRENT_STATE.md, SECURITY.md, TESTING.md, and CONTRIBUTING.md all at once would be exactly the "unnecessarily complicated enterprise workflow" to avoid.

| Doc | Add it? | Why |
|---|---|---|
| SECURITY.md | Yes, now | One real vulnerability class exists today (§8). Write the escaping rule down where it can't be missed. |
| ARCHITECTURE.md | Yes, if Option C proceeds | Only worth a separate file once there are real module boundaries to describe |
| TESTING.md | Yes, once tests exist | Premature before §4.1 is addressed |
| CONTRIBUTING.md | Short version, yes | Fold §6's branch/PR/commit conventions into one short file |
| CURRENT_STATE.md | Skip | CLAUDE.md's "living map" already fills this role |
| REQUIREMENTS.md | Skip for now | Nothing suggests requirements are unclear between two founders |
| DECISIONS.md | Skip, use PR descriptions | Commit messages already function as a decision log |

---

## 8. Security audit

Read-only static review of `index.html` and the seven `supabase-*.sql` files. No exploit attempted, no network calls made, no live Supabase project accessed. Severity reflects realistic exploitability for a client-only SPA backed by Supabase RLS — the public anon key, for instance, is flagged for completeness but is not itself a vulnerability in this architecture.

### 8.1 Findings

**[HIGH] Stored XSS → session-token theft, via org invites and shared-project names** — `index.html:8873–8887, 7935–7952, 8073–8095`

Zero HTML-escaping utility exists anywhere in the file, across 110 `innerHTML`/`insertAdjacentHTML` sites. Two are reachable with no prior relationship to the victim: the invite banner renders `invited_by_name` and `org_name` unescaped, and any authenticated user can self-serve create an org and invite any email address; the org-project-picker tile renders shared project `name`/`shared_by_name` unescaped, reachable by sharing a maliciously-named project into an org the victim belongs to.

```js
// index.html:8873 — renderOrgInviteBanner
el.innerHTML = invites.map(inv => `
  <div class="org-invite-row" data-invite="${inv.id}">
    <span>🔔 <b>${inv.invited_by_name}</b> invited you to join <b>${inv.org_name}</b></span>
```

Because `createClient()` (8301) uses Supabase's default token storage, the session JWT sits in `localStorage` under a predictable key — readable by any script running on the page. A successful payload here is a path to a stolen session and full account access as the victim, not just defacement. **Fix before anything else in this report, including before the redesign begins.**

*Fix:* one reusable `escapeHtml()`/`escapeAttr()` helper, applied at minimum to: full name, org name, project name, `shared_by_name`, and the device/circuit/room free-text fields below. Alternative: switch these sinks to `textContent`/`setAttribute`.

**[MEDIUM-HIGH] Same pattern, attribute-context breakout, on device/circuit/room fields** — `index.html:6088, 6097–6098, 5144, 5364`

Custom name, manufacturer, model, circuit description, and room name are interpolated into HTML attribute values with no quote-escaping, e.g. `<input id="p_customName" value="${obj.props.customName||''}">`. A value containing a bare `"` breaks out of the attribute. Reachable cross-account the same way as above, since a malicious editor can plant a payload and share the project.

**[MEDIUM, architectural/expected] Client-side role/permission flags are trusted for both UI and the write call itself** — `index.html:8700–8711, 9022–9073`

`readOnlyMode` and `isAdmin` are resolved client-side once and then trusted to gate both what's shown and what write call is attempted, with zero re-validation before the Supabase call. This is the *correct* shape for a Supabase-RLS app — the client is never meant to be the trust boundary — but it means every one of these actions is only as safe as the underlying RLS policy, with no defence-in-depth if a policy is ever loosened by mistake. Cross-referenced against the SQL files: the policies checked out as intended (§8.2).

**[LOW] Unpinned major-version CDN dependency** — `index.html:1348`. `@supabase/supabase-js@2` loads whatever the current 2.x release is, with no version review before it reaches production. Pin to an exact version.

**[LOW] No file-size limit on floor-plan image/PDF import** — `index.html:7142–7165`. Client-side DoS risk only; non-image/PDF files simply fail to decode rather than executing.

**[LOW, needs verification] 6-digit numeric reset/verify codes** — `index.html:8461–8483`. A sensible choice over magic links, but 1,000,000 possibilities is brute-forceable without server-side rate limiting and a short code expiry — neither visible from this repository. Verify directly in the Supabase Auth project settings.

**[INFO, expected] Supabase publishable anon key hardcoded in the client** — `index.html:8292–8293`. `sb_publishable_…` is designed to be public and relies on RLS, not a leaked secret. Confirmed no `service_role` key or any second credential exists anywhere in the file.

**[INFO, needs follow-up] "Report a problem" edge function source not in this repository.** The client correctly routes through `supabaseClient.functions.invoke()`, which attaches auth automatically. But the function's own JWT-verification setting and what it does with `description`/`context` before handing them to Resend can't be assessed here. Review the function source directly in Supabase.

### 8.2 Database / RLS review (the seven SQL files)

The organizations subsystem uses `security definer` helper functions (`is_org_member`, `is_org_admin`, `can_manage_org_project`) specifically to avoid the infinite-recursion bug that hit production once already (§2.2) — a sound, documented pattern, correctly locked down to `authenticated` only. Every table has RLS enabled with policies scoped to the owning user or resolved org role. The one loose end already flagged: `schema.sql` is stale against the constraint `fix-project-identity.sql` drops in production.

### 8.3 What was not found

No `eval()`/`Function()` construction, no hardcoded debug/bypass flags, no non-HTTPS endpoints, no password logged or placed in a URL, sensible `autocomplete` attributes throughout the auth gate, correct anti-enumeration handling on signup, no raw stack traces surfaced to users, and no evidence of a second Supabase project or leaked service-role key anywhere in the git history.

---

## 9. Electrical software risk

Every place SparkyDraft performs or informs an electrical decision, and what independent validation it needs before anyone relies on its output for a real installation. **Nothing in this section should be read as confirmation that any calculation is correct or AS/NZS 3000–compliant** — that determination requires a qualified electrical engineer, not this audit.

| Area | What exists | Risk if trusted blindly |
|---|---|---|
| Cable sizing (AS/NZS 3008) | Nothing — a free-text field the user types | N/A — no calc exists |
| Voltage drop | Nothing — zero code, zero UI mention anywhere in the file | High if assumed present |
| Maximum demand / diversity | Real, simplified, disclosed as non-authoritative | High |
| Protection (MCB/RCD/RCBO) selection | User pick + one shallow over-current check | Medium |
| Panel schedule generation | Real computation for connected/demand load, pass-through for cable/protection specs | Medium — see visual-weight note below |
| Cable-run length estimate | Real, routed, includes vertical drops; explicitly hard-active-only | Medium |
| Quoting / pricing | Real arithmetic over hardcoded, editable prices | Low |
| Materials data | Hardcoded, not standards-linked | Low |
| Input validation on electrical fields | Minimal — only quantity and main-switch-amps are guarded | Low-Medium |

### 9.1 Maximum demand / diversity — the exact formula

Applied per-circuit, then summed per board — not a whole-installation AS/NZS 3000 Table C1 calculation:

```js
// index.html:6964–6968 — diversifiedWatts
if(type==='lighting') return connectedW<=3000 ? connectedW*0.66 : 3000*0.66 + (connectedW-3000)*0.40;
if(type==='power'){ const cap=2300; return connectedW<=cap ? connectedW : cap + (connectedW-cap)*0.75; }
return connectedW; // fixed appliance or mixed circuit: no reduction at all
```

230V single-phase assumed throughout (`MAINS_VOLTAGE = 230`, line 6969); three-phase circuits are explicitly shown at single-phase-equivalent current — a stated simplification, not a real per-phase balance. The code's own comment: *"This is NOT a reproduction of the AS/NZS 3000 diversity tables, which are copyrighted and considerably more detailed — it's a deliberately transparent estimate for early planning."* That disclaimer appears in the UI three times. The gap this audit flags isn't dishonesty — it's that the on-screen presentation (a red "exceeds capacity" flag, a %-of-main-switch bar) carries more visual authority than the underlying math supports.

### 9.2 Protection sizing — the one automated check

The only automated protection check compares a circuit's raw connected current against the breaker's own rating (`connectedA > protectionA`, line 7041) — it never checks the breaker against cable current-carrying capacity, because no cable-ampacity table exists anywhere in the app. It cannot catch a breaker over-rated for an undersized cable, which is the actual AS/NZS 3000 protection-coordination requirement.

### 9.3 Cable-run length — better engineered than it first appears

Reuses the same degree-constrained routing tree the on-screen cable drawing uses (so the estimate matches what's drawn), includes per-hop vertical rise/drop to a configurable ceiling height, and applies a user-editable slack percentage. It refuses to produce a number at all on an uncalibrated floor rather than fabricating one. Explicitly, correctly scoped to hard-active runs only — the second cable a switched light/fan needs is deliberately out of scope, both in a code comment and the UI text. A genuine planning-stage estimate, not a naive straight-line guess — but it feeds nothing else in the app.

### 9.4 What requires independent engineering validation before any commercial claim

1. The diversity/demand percentages themselves (66%/40% lighting, 100%/75% power, no reduction on mixed/fixed circuits) — confirm against current AS/NZS 3000 and whether they're even the right *category* of calculation to show without the full occupancy-class table.
2. Whether a cable-sizing/AS3008 module, if built, should live in this app at all versus deliberately staying out of scope.
3. Whether a voltage-drop check should be added before any commercial release, given its complete absence today.
4. The protection-sizing check's scope (connected-load-only, no cable-ampacity coordination) against what a professional would consider the minimum acceptable automated check to ship at all.

> **Do not treat AI-generated calculations as automatically correct.** These formulas were written by Claude Code and have not been independently verified by a qualified electrical engineer as part of this audit or, as far as this repository's history shows, at any point before now. Every number in §9.1–9.3 needs that review before it appears in front of a customer as anything other than a clearly-labelled planning estimate.

---

## 10. Australian compliance requirements

Areas to investigate before commercial publication — not a compliance opinion, and not something this audit is qualified to close out. **A disclaimer in the app does not, by itself, eliminate liability** — several items below exist specifically because a disclaimer alone doesn't discharge the underlying duty.

**Consumer & contract law**
- Australian Consumer Law consumer guarantees — can't be excluded by a disclaimer, only limited in narrow ways
- Terms of use / SaaS agreement — doesn't exist yet in this repository
- Liability-limitation clauses — need drafting by a lawyer who understands ACL's limits on what can actually be excluded
- Marketing claims — any statement implying AS/NZS 3000 compliance, accuracy, or "electrician-grade" calculation needs to be true, not just qualified in fine print

**Privacy & data**
- Privacy Act / Australian Privacy Principles — applies once turnover/data-handling thresholds are met, or voluntarily as a trust signal
- No privacy policy exists in this repository today
- Notifiable Data Breaches scheme — needs an actual incident-response plan; the §8 XSS finding is exactly the kind of issue that scheme exists for
- Data retention/deletion — no "delete my account and all data" flow was found

**IP & licensing**
- **No LICENSE file exists in this repository at all** — resolve ownership/licensing terms explicitly
- Third-party licences to check: Supabase JS, jsPDF, pdf.js — none observed to be a blocker, but confirm and record
- The AS/NZS 3000 diversity tables are explicitly *not* reproduced in the code (per its own comment) because they're copyrighted — a good instinct already present; keep it deliberate if a fuller demand-calc module is ever built

**Electrical regulatory**
- AS/NZS 3000 (Wiring Rules) — the relevant standard for §9; state/territory regulators layer additional licensing/certification requirements for the *installer*, separate from the software
- Whether the app needs to state prominently that it is a planning/documentation aid, not a design-certification tool
- State/territory differences — not assessed here, needs an electrical professional

**Liability & insurance**
- Professional indemnity / technology E&O insurance for a tool whose output could influence a real electrical installation
- Whether disclaimers reduce but do not eliminate exposure if a customer's installation is later found non-compliant

**Security-specific**
- The §8 XSS finding, if exploited against real customer data, would very plausibly meet the Notifiable Data Breaches threshold — treat this as a live compliance-relevant issue, not just a code bug

---

## 11. Security standards worth using — and which ones aren't

| Standard / practice | Worth it here? | Why |
|---|---|---|
| OWASP Top 10 | Yes | Directly maps to §8 (A03 Injection/XSS is the live finding); cheap to keep in mind for future PRs |
| OWASP ASVS — Level 1 | Yes | The right bar for a commercial SaaS handling customer business data |
| OWASP ASVS — Level 2/3 | Not yet | Built for higher-assurance/regulated software; disproportionate here |
| Secure SDLC / lightweight threat modelling | Yes, informally | A 30-minute "what could go wrong" pass before any auth/sharing/permissions feature ships would have caught §8 earlier |
| SAST (static analysis) | Lightweight yes | A JS linter with basic security rules in CI catches the unescaped-interpolation pattern class going forward |
| DAST | Only as part of a pen test | Not worth a standing tool for an app this size |
| SCA / dependency scanning | Limited value today | Only three CDN dependencies, no package.json — pin versions and review changelogs manually |
| Penetration testing | Yes, before commercial release | See §12 |
| ACSC guidance (general) | Yes, as a reference | Free, Australia-specific, practical |
| Essential Eight | Not applicable as a framework | Designed for an organisation's internal IT environment, not "we ship one web app" — the individual ideas (patch promptly, limit admin access, MFA on GitHub/Supabase accounts) are worth doing regardless of the framework label |

---

## 12. Independent human audits

AI analysis — this report included — is not a substitute for any of the below. Each should produce a document Brock and Brae actually keep, not just a conversation.

**A. Cybersecurity audit** — *Who:* a small Australian security consultancy or an experienced freelance AppSec reviewer with SaaS/Supabase experience. *When:* after the §8 XSS fix, before any paid customer onboarding, and again after the redesign lands. *Receive:* this report, repo access, org/sharing model description. *Test:* the full RLS policy set against every role combination, the escaping fix's completeness, session/token handling, the Edge Function's own security. *Evidence:* a written findings report with severity and reproduction steps. *Repeat:* after any change to auth, sharing, or permissions.

**B. Penetration test** — *Scope:* the live app plus Supabase project — auth flows (including the OTP brute-force question), multi-tenant RLS boundary testing, the XSS chain post-fix, the Edge Function endpoint. *When:* once before the first paying customer, then annually or after major redesigns. *Evidence:* a report distinguishing confirmed-exploited findings from theoretical ones, with a retest after fixes land.

**C. Electrical / software validation** — *Who:* a licensed Australian electrical engineer or senior electrician with design-certification experience. *Receive:* §9 of this report verbatim, plus the code around lines 6944–7049. *Test:* whether the diversity percentages match current AS/NZS 3000 practice, whether shipping a demand estimate without a cable-sizing or volt-drop check is defensible versus misleading by omission, and what disclaimer language/placement would be adequate. *Repeat:* before any change to §9's calculations, and before any compliance/accuracy marketing claim.

**D. Legal review** — *Who:* an Australian commercial/technology lawyer with SaaS and consumer-law experience, plus possibly a specialist in trade/construction-software liability. *Receive:* §10, the current lack of a LICENSE/terms of use, a plain description of what the app calculates vs. discloses. *Produce:* terms of use, an ACL-enforceable liability-limitation approach, a privacy policy, and a view on professional indemnity insurance.

**E. Privacy review** — *Who:* the same lawyer as D if they have privacy depth, or a dedicated privacy consultant once the customer base justifies it. *Review:* what's collected/stored, retention/deletion, whether §8's finding would have triggered an NDB obligation. *When:* before commercial launch and after any confirmed incident.

**F. Independent code/architecture audit** — Worth it, but timed well: a second opinion on the redesign's target architecture (before committing engineering weeks to Option C) is more valuable than reviewing the current single-file app, which this report already covers in depth. *Who:* an independent senior engineer or small dev shop with monolith-to-modular migration experience. *Repeat:* once, at the architecture-proposal stage — not an ongoing retainer for a team this size.

---

## 13. Release gate

### MUST HAVE
- Fix the stored-XSS chain (§8.1) and add the escaping rule to SECURITY.md
- Independent electrical validation of every calculation in §9, with disclaimer language and placement signed off
- Penetration test completed, findings closed, retest passed (§12B)
- Terms of use, privacy policy, and a lawyer-reviewed liability position (§10, §12D)
- Confirmed Supabase Auth rate limiting and OTP expiry/attempt limits (§8)
- A tested account-deletion / data-deletion flow
- schema.sql reconciled with production (§4.1)
- Confirmed automated Postgres backups + one tested restore
- An incident-response plan covering the Notifiable Data Breaches scheme
- LICENSE file and third-party licence review completed (§10)

### SHOULD HAVE
- Automated test coverage for circuit routing, diversity calc, and quote arithmetic at minimum
- CI running that suite plus the headless-boot smoke test on every PR
- Cybersecurity audit beyond the pentest (§12A)
- The cross-project symbol-leak bug fixed (§4.2)
- Version-pinned CDN dependencies, all of them
- Input validation on the currently-unguarded numeric fields (§9)
- A support process — where does a customer report a bug/data problem, who owns responding
- Monitoring/error logging for the production app (currently none beyond browser console)

### NICE TO HAVE
- Progress on the Option C architectural redesign (§5)
- A real shared materials/pricing database instead of the hardcoded catalog
- A cable-sizing (AS/NZS 3008) and/or voltage-drop module, if the product decision in §9.4 is to build one
- Command-palette-to-action-list consistency tooling
- An independent code/architecture audit of the redesign's target shape (§12F)
- Release tags and a rollback runbook (§6)

---

## 14. Final report

### 14.1 Current state

SparkyDraft is a single 9,182-line HTML file with no framework, no build step, and no tests, built almost entirely in six days through Claude Code. Despite that, the code itself is unusually disciplined for its shape — well-commented, free of dead code and TODO debt, with a genuinely well-engineered circuit-routing and undo/redo system. It is backed by Supabase for auth, storage, and multi-tenant sharing, with row-level security that is mostly correct. It has one live, exploitable security vulnerability, zero automated testing, no CI, and a set of electrical calculations that are honestly disclaimed in the code but visually over-weighted in the UI relative to what they actually verify.

### 14.2 The 10 biggest problems, in order

1. Stored XSS in the org-invite/sharing flow → session-token theft (§8.1) — live and exploitable today
2. Zero automated tests and zero CI on a 9,182-line, fast-growing codebase (§4.1)
3. No independent validation has ever been done on the electrical calculations in §9, several of which look more authoritative in the UI than the code itself claims to be
4. No LICENSE file, no terms of use, no privacy policy (§10)
5. Voltage drop and cable-sizing (AS/NZS 3008) don't exist at all, with no in-app signal that they're absent rather than just "not shown right now"
6. The organizations/sharing subsystem shipped three separate times with a known, self-documented access-control gap each time before being closed (§2.2) — a process problem, not just a code one
7. Materials/pricing is a hardcoded array, not a shared source of truth, which will become a real product problem the moment two people need the same current price (§4.2)
8. `supabase-schema.sql` is stale against production — a fresh environment bootstrap silently reintroduces an already-fixed bug (§4.1)
9. No branch/PR/CI discipline sized to two developers regularly working the same file in parallel, which has already caused repeated same-day merge-and-fix cycles (§2, §6)
10. Everything lives in one global-state, one-file JS scope, which is the ceiling on how far this can scale before the current discipline stops being enough (§4.2)

### 14.3 What to keep

The circuit-routing tree, the id-reconciled undo/redo, the layer lock/visibility enforcement, the calibration-aware snapping, the comms-rack legacy-data migration, the civil/underground module's deliberate parallel design, the honest in-code disclaimers on every estimate, and the overall discipline of commenting *why*. None of this needs to be rewritten — it needs a better shell around it.

### 14.4 What to remove or retire

Nothing was found that should simply be deleted. The closest candidates are process artifacts, not features: the ad-hoc "run seven SQL files in order by hand" schema process (replace with real migrations during the redesign) and the unpinned CDN dependency (pin it, don't remove Supabase).

### 14.5 What needs architectural redesign

The single-file/global-state shell (not the logic inside it), the pricing/materials model (from hardcoded array to a real shared catalog), and the schema/migration process. See §5 for the full option comparison.

### 14.6 Recommended architecture

Option C from §5: a modular rebuild of the shell around the existing, preserved domain logic, done under characterisation tests written against the current app *before* restructuring, with real module boundaries, a build step, and CI from day one — not a ground-up rewrite from a blank file.

### 14.7 Recommended GitHub structure

`main` protected and always deployable, short-lived feature branches with mandatory PR self-review, a lightweight PR template, squash merges, release tags at milestones, GitHub secret scanning and push protection turned on, and a minimal CI pipeline (headless-boot smoke test + lint) given there's no build step to hang a heavier pipeline off. See §6 in full.

### 14.8 Security requirements

Fix the XSS chain immediately; add a standing escaping rule to CLAUDE.md/SECURITY.md; verify Supabase Auth rate limiting and OTP expiry; pin the unpinned dependency; commission a penetration test before commercial launch. Full detail in §8 and §13.

### 14.9 Legal / compliance requirements

A LICENSE file, terms of use, and a privacy policy do not currently exist and need drafting by an Australian lawyer before commercial launch, alongside a liability position that accounts for what ACL actually permits excluding. Full detail in §10.

### 14.10 Human audits, in order

Electrical/software validation of §9's calculations first (it's the product's core credibility claim), in parallel with the XSS fix; then a cybersecurity audit and penetration test before any paid customer; legal and privacy review alongside those; an independent architecture review once the Option C redesign is scoped, not before. Full detail in §12.

### 14.11 Release plan

1. Fix the §8.1 XSS chain and the §4.1 schema.sql drift — days, not weeks
2. Commission the electrical validation (§12C) and legal review (§12D) in parallel — these have the longest external lead time, start them now
3. Stand up the minimum CI (§6.1) and write characterisation tests around the domain logic named in §14.3 — this is also the prerequisite for §5's Option C
4. Execute the Option C architectural redesign against those tests
5. Cybersecurity audit + penetration test against the redesigned app (§12A, §12B)
6. Close every MUST HAVE in §13, verified, not assumed
7. Commercial release
8. Repeat the security and electrical audits after any future change to auth, sharing, or the calculations in §9

### 14.12 Top 20 next actions, in priority order

1. Fix the stored-XSS chain in the org-invite banner and shared-project tiles (§8.1) — add one escaping helper, apply it everywhere user/cross-org text reaches `innerHTML`
2. Reconcile `supabase-schema.sql` with the constraint `fix-project-identity.sql` drops in production (§4.1)
3. Add a LICENSE file and start the terms-of-use/privacy-policy drafting process with a lawyer (§10, §12D)
4. Commission independent electrical validation of the diversity/demand formula and protection check in §9 (§12C)
5. Verify Supabase Auth rate limiting and OTP code expiry/attempt limits directly in the project dashboard (§8)
6. Pin `@supabase/supabase-js` to an exact version (§4.1)
7. Enable GitHub secret scanning and push protection (§6.1)
8. Protect `main`, require PRs, adopt the lightweight PR template (§6)
9. Fix the cross-project custom-symbol leak (§4.2)
10. Write SECURITY.md with the escaping rule as a hard, non-negotiable line (§7.1)
11. Add the CDN-failure guard to the PDF export path, matching the existing Supabase pattern (§4.1)
12. Stand up the headless-boot smoke-test CI job (§6.1)
13. Write characterisation tests for circuit routing, diversity calc, and quote arithmetic before touching their code further (§4.1, §14.11)
14. Scope the Option C module boundaries and get a second engineering opinion on the plan before starting (§12F)
15. Add input validation (min values) to the currently-unguarded numeric fields (§9)
16. Commission the penetration test, timed for after the XSS fix (§12B)
17. Build and test an account/data-deletion flow (§13)
18. Confirm Supabase automatic backups are on and test one restore (§6)
19. Tag the current state as a release baseline before the redesign begins, so there's a clean rollback point (§6)
20. Decide, as a product call informed by §12C, whether a cable-sizing/volt-drop module is ever in scope — and until it is, strengthen the in-app disclaimer at the exact point the demand/protection numbers are shown, not just once per screen (§9.4)

---

*Prepared by static code review and full git-history analysis of the SparkyDraft repository at commit `82be509`. No files were modified, no dependencies were changed, no live systems were tested or exploited to produce this report. Every status, risk rating, and recommendation above should be re-verified by the qualified professionals named in §12 before being relied on commercially — this document is a technical baseline, not a compliance sign-off, a security clearance, or an engineering certification.*
