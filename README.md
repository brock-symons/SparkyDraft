# Sparky Draft

Sparky Draft is a mobile-first web app for drafting electrical switchboard and floor plan layouts. It supports quotes, elevations, floor plans, grid layouts, and circuit/comms rack assignment, with projects synced through Supabase and shared across organization members.

## Getting started

Open `index.html` in a browser — it's a self-contained single-page app with no build step.

## Database

The `supabase-*.sql` files set up the Supabase schema and RPC functions used for authentication, organizations, projects, and member lookups. Run them against your Supabase project in the following order:

1. `supabase-schema.sql`
2. `supabase-organizations.sql`
3. `supabase-organization-projects.sql`
4. `supabase-organization-project-access.sql`
5. `supabase-org-member-lookup.sql`
6. `supabase-add-user-name-column.sql`
7. `supabase-fix-project-identity.sql`

## Code style for new work

There isn't one style guide across the whole repo yet — the project is mid-transition from a single legacy file to a modular redesign (see `app/` and its `REDESIGN_DIRECTIVE.md` / `MIGRATION_INVENTORY.md`; the redesign branch has merged to `main`, but `index.html` at the repo root is still the live product per CLAUDE.md's "Target end-state" until the cutover itself is explicitly approved). Until that cutover lands, match whichever part of the codebase you're actually touching rather than mixing conventions into it.

**Editing the live app (`index.html`)**
- Stay vanilla JS/HTML/CSS — no framework, no build step. This file is still the live product.
- Follow the existing patterns exactly: comment *why*, not *what*; mirror rather than abstract when a concept is deliberately kept parallel (e.g. civil vs. electrical plans) — see CLAUDE.md for the specific conventions already in use.
- Don't introduce a second, competing way of doing something the file already does one way (a second escaping helper, a second undo mechanism, a second snapping system).
- Any new CDN dependency must be version-pinned (not `@latest`/unpinned major) and get the same CDN-failure-guard pattern already used for the Supabase client, so a blocked/offline CDN degrades gracefully instead of throwing.

**Working in `app/` (the in-progress redesign)**
- Follow the conventions `REDESIGN_DIRECTIVE.md` and CLAUDE.md's `app/` section already set: `core/` stays framework-free and DOM-free (nothing in it imports React); `ui/` owns chrome only; one command registry feeds the palette, keyboard shortcuts, and context menu so they can't drift out of sync.
- Business logic ported from `index.html` (quote totals, the load/demand estimate, circuit routing, the cable-run estimate) must be extracted verbatim and checked against the original's output — not re-derived from memory. `MIGRATION_INVENTORY.md`'s "Business logic that must be preserved" section has the exact functions and line numbers.

**Once real tooling is adopted (Vite/ESLint/Prettier/tests — not yet in the repo)**
- Prettier for formatting, ESLint for lint — including a security-focused ruleset (e.g. `eslint-plugin-no-unsanitized`) so an unescaped `innerHTML` interpolation gets caught automatically on the next PR rather than by an audit.
- TypeScript, or at minimum JSDoc types, on anything doing an electrical or quoting calculation — that code's correctness matters more than anywhere else in the app.
- A test that pins a function's current behaviour before that behaviour is changed, not written after the fact.

## AI-assisted development

This repository is developed substantially with AI coding assistants (Claude Code). That's expected and welcome — the policy is about *how*, not *whether*.

- An AI assistant may write and suggest code for a new feature on its own initiative, provided the change is (a) actually run and traced through, not just read, and shown not to introduce a regression, and (b) written to match the style and patterns of the file or module it's added to, not a new pattern of its own. "It looks right" is not the bar — "I ran the affected flow and it still works" is.
- Porting or touching existing business logic (quoting, the load/demand estimate, circuit routing, pricing) must preserve its behaviour exactly unless a behaviour change was explicitly requested. See `audits/2026-09-03-full-repository-audit.md` for why this matters here specifically — several of this app's calculations are genuinely subtle and have already been debugged once.
- Anything that changes navigation, the data model, security/permission behaviour, or is already flagged as needing a decision (see `MIGRATION_INVENTORY.md`'s "Items flagged for owner review") is not an AI assistant's call to make unilaterally — raise it for Brock or Brae to decide, don't just pick one.
- Never merge to `main` without the project owner's explicit review and approval for that specific piece of work (see CLAUDE.md's Workflow notes) — a prior "looks good" on something else doesn't extend to this change.

See `CONTRIBUTING.md` for branch, commit, and PR conventions.
