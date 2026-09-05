# Contributing to SparkyDraft

Practical notes for Brock, Brae, and any AI assistant (Claude Code) working in this repo. See `README.md` for code style and the AI-assisted-development policy, and `CLAUDE.md` for the architecture map — both are living documents, keep them current as you go.

## Branches

- `main` is always deployable. Don't push to it directly — open a pull request.
- One short-lived branch per task: `feature/…` for new functionality, `fix/…` for bug fixes. Delete the branch once it's merged.
- If you're touching `index.html`, `app/`, or anything the other person might also be mid-way through, pull/rebase from `main` before you start and again before you open the PR. This repo's own history has more than one same-day "merge main in, fix what broke" commit from two branches racing on the same file — a daily sync avoids that.

## Commits

- Descriptive messages, explain *why* a change was made, not just *what* changed — this repo's existing commit history already does this well; keep matching it.
- When a commit fixes something the audit or migration inventory flagged, reference it by section (e.g. "fixes §8.1 of audits/2026-09-03-full-repository-audit.md") so the reasoning stays traceable.

## Pull requests

- Fill in the PR template — what changed, why, and what you actually tested (not just read).
- Self-review your own diff before requesting review, as if you were the reviewer.
- Anything touching auth, sharing/permissions, or a calculation in the Panel Schedule/Quote gets a second pair of eyes before merge — no exceptions, given how easy those are to silently break.
- Never merge to `main` without the project owner's explicit sign-off for that specific piece of work. A prior "looks good" on something else doesn't carry over.

## Reporting a bug or proposing a feature

- Use the Issue templates. Check existing open issues first so work doesn't get duplicated.
- Found a security issue? Don't open a public issue for it — message Brock or Brae directly first.

## Database changes

- New SQL goes in its own `supabase-*.sql` file, added to the numbered run order in `README.md` — never edit a script that's already been run against the live project, since there's no way to know who's already applied it.
- If/when the project moves to real Supabase CLI migrations, that replaces this convention — update this file when it does.
