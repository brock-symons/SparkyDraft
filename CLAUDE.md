# SparkyDraft

A React + Tailwind web app for electrical drafting, plus civil/underground
works planning, comms/data rack wiring, circuits, panel schedules, quoting,
and PDF export. Supabase provides auth, cloud project sync, and org sharing.

**Cutover happened 2026-09-06.** Root `index.html` now loads `app/src/main.jsx`
(the React rewrite) — it is no longer the ~9,000-line single-file vanilla-JS
app. That original implementation is preserved at `legacy-index.html`, kept
as the parity tests' ground truth and for reference, not as a second live
app. Still no build step: `index.html` contains an in-browser Babel loader
(see "The React app" section below) — and it must be served over `http://`,
not opened as a local `file://` page, or the module loader's `fetch()` calls
get blocked by CORS. See README.md's "Getting started."

**This file is a living map, not a snapshot.** This repo gets substantial
commits from other Claude Code sessions independent of whichever session is
reading this — sometimes several large features in a day. Before relying on
anything below, run `git fetch && git log <last-synced-commit>..origin/main`
and skim the diffs (cheap) rather than assuming this file or your own memory
of the code is current. Update the "Last synced" line and the relevant
section below whenever you do.

**Last synced with origin/main at commit: `bb52705` (2026-09-06)** — the
commit right before this file's own cutover-record update landed.

## Core architecture (the live React app)

The full brief that drove this app's build-out is filed verbatim at
[REDESIGN_DIRECTIVE.md](REDESIGN_DIRECTIVE.md) — 35 numbered sections
covering interaction philosophy, contextual UI, snapping/selection
standards, responsive strategy, what may be changed independently (§31)
vs. requires approval (§32), and git safety (§33). Consult it directly for
anything not covered by the summary below, rather than relying on a chat
transcript for intent. `MIGRATION_INVENTORY.md` §H is the parity matrix it
was built against; `PLAN.md` tracks how it got built; `PRODUCT_AUDIT.md` is
its pre-cutover product review.

- `index.html` at the repo root loads `app/src/main.jsx` through a small
  in-browser Babel/ES-module loader — no build step, no Node needed to run
  it, but it must be served over `http://` (see the top of this file and
  README.md's "Getting started" — `file://` breaks it via CORS).
- `app/src/core/` is framework-free and DOM-free — catalog, geometry,
  snapping, document+history, command registry, renderer, interaction
  controller. Nothing here imports React.
- `app/src/ui/` is React and owns chrome only. React does not re-render
  during a drag; the controller mutates and the canvas repaints on one rAF.
- `app/src/core/catalog.js` was extracted **verbatim** from the original
  vanilla-JS app (now `legacy-index.html`). It drives quoting and load
  estimates — re-extract rather than hand-editing if it needs to change.
- One command registry (`app/src/core/commands.js`) feeds the palette,
  keyboard shortcuts, tooltips and the context menu — the predecessor app's
  hand-maintained palette array drifted out of sync with its toolbar more
  than once, which is exactly why this exists.
- **`app/src/core/cloudFormat.js` is load-bearing.** The Supabase `data`
  columns are shared with whatever a customer's existing project was saved
  as under the old app, so this reads/writes that same record shape and
  converts at that one boundary. Do not "simplify" it into a native shape —
  that would silently corrupt existing saved projects the first time
  autosave fires.
- Business logic changes are checked mechanically, not by eye:
  `app/test/*-parity.mjs` extract the equivalent functions out of
  `legacy-index.html` at run time and compare. Run them all before trusting
  a change to `app/src/core/`.
- Known incomplete pieces, as of the 2026-09-06 cutover: the **Layers** and
  **Inspector/properties** panels are both still partial builds, not
  finished. Treat bugs found there as expected gaps, not regressions, until
  someone does the work to finish them.
- The cloud/auth path (sign-in, sync, org sharing) has only ever been
  exercised with stubbed logins — nobody has done a walkthrough with a real
  signed-in account against the live Supabase project. Don't assume it's
  solid just because it's marked "complete" in `PLAN.md`.

## `legacy-index.html` — the original app, retired 2026-09-06

This was the live product until the cutover: a single ~9,000-line
vanilla-JS file, one global `state`, hand-rolled DOM manipulation. It is
kept for two reasons — the parity tests' ground truth (`app/test/*.mjs`
extract functions from it by name), and as a reference/rollback copy — not
as a second app anyone should add features to. Its own internals (`state`,
`SYMBOL_LIBRARY`, `storageAPI`, the dark/mobile-vs-bright/desktop theme
split via `html.force-desktop`, the `--hud-*` canvas-overlay token
convention, `render()`/`renderCivil()`/etc.) are documented in its own
git history and in `audits/2026-09-03-full-repository-audit.md` — not
repeated here now that they don't describe the live app. Read that history
directly if you need to understand something about how it worked, rather
than porting a described-from-memory version of it.

## Cutover record

Confirmed by the project owner and executed 2026-09-06. Per the gate this
file used to describe before the cutover happened (kept below for the
record of what was and wasn't actually checked at the time):

1. **Full parity per `MIGRATION_INVENTORY.md`'s matrix** — the automated
   `app/test/*-parity.mjs` suite existed and was passing pre-cutover; it
   was **not** re-run as part of the cutover PR itself, and Layers/
   Inspector are explicitly incomplete. Re-run the suite before trusting
   it's still green.
2. **Security parity** (the unescaped-`innerHTML` XSS pattern
   `audits/2026-09-03-full-repository-audit.md` §8.1 found in the old app,
   and RLS behaviour against the live Supabase project) — **not**
   independently re-verified as part of the cutover. This is still open.
3. **§35's product audit** (`PRODUCT_AUDIT.md`) was produced pre-cutover;
   its findings were not re-confirmed closed at cutover time.
4. **Physical cutover mechanics** — resolved as: `app/index.html`'s content
   promoted to root `index.html` (with its one `src/main.jsx` reference
   updated to `app/src/main.jsx`, since `app/src/` and `app/test/` stayed
   where they were rather than also moving); the original app renamed to
   `legacy-index.html` at the repo root rather than deleted or relocated
   elsewhere.
5. **Owner review** — the owner ran their own manual walkthrough pre-
   cutover, found "a lot of stuff that needs adjusting" (their words, not
   itemized here), and explicitly asked for the promotion regardless,
   framing it as "we will now develop this version" rather than waiting on
   1–3 above. That's a legitimate call for the owner to make; it means the
   live app currently carries known, not-fully-verified risk on parity,
   security, and two incomplete panels. Don't treat "it's live now" as
   evidence those were actually checked.

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
- `package.json` + `eslint.config.js` (added 2026-09-08) are dev-tooling
  only — they do NOT introduce a build step or runtime dependency for the
  app itself. `npm install` then `npm run lint` checks `app/src` and
  `app/test`; React's plugin version is hardcoded (`'18.3'`) rather than
  `detect`, since React loads from a CDN in `index.html`, not npm.

## Workflow notes

- Never merge to `main` without the project owner's explicit review/approval
  for that specific piece of work — a prior blanket "you can merge later" or
  "looks good" does not extend to unrelated future changes.
- Never enter the user's account password into any login field, even with
  explicit permission to do so — this is a hard rule, not a judgment call.
  Use the local (non-cloud) `storageAPI` path to test persistence instead.
