# EDGAR Radar — Project Instructions for Claude Code

## What this project is
A backend/data-engineering portfolio project: ingest SEC EDGAR filings,
normalize the financial data (XBRL), score anomalies, and diff filing text
over time. Built incrementally through 8 phases (see `ROADMAP.md`), then
extended to Indian (NSE/BSE) data as a second track once this version is
solid through Phase 6/7.

## The one rule that matters most
**Work one step at a time.**

1. Read `PROGRESS.md` first, every session, before doing anything else.
2. Do exactly the next unchecked step — not the whole phase, not several
   steps ahead, even if a later step looks easy to knock out while you're
   in there.
3. After finishing a step: stop, summarize what you did and what you
   tested, update `PROGRESS.md`, and wait for confirmation before starting
   the next step.
4. Do not advance to a new phase until `ROADMAP.md`'s "Done when" checklist
   for the current phase is actually satisfied and tested — not "looks like
   it works."

If you (Claude Code) are ever tempted to add something because "it would be
easy while I'm in here" — don't. That instinct is exactly what this rule
exists to stop.

## Locked technology decisions
Don't deviate from these without asking first:
- Language/runtime: Node.js + TypeScript
- Web framework: Express
- Database: PostgreSQL
- Queue (from Phase 4 onward, not before): Redis + BullMQ
- Cloud (from Phase 6 onward, not before): AWS
- Testing: Jest + Supertest; `nock` for mocking external HTTP calls

## Explicit "do not use yet"
Check the relevant phase in `ROADMAP.md` before introducing any of:
Docker, Redis, a message queue, any scheduler beyond a single manual
script, Kubernetes, Kafka, Airflow, Spark, Terraform, or any ML library.
Each has an assigned phase. Introducing one earlier than its phase is a
mistake, not a shortcut — say so and hold off, even if asked.

## Git & GitHub workflow
- Before the first commit: initialize git and add a `.gitignore` covering
  `node_modules/`, `.env` and `.env.*` (except `.env.example`), `dist/`,
  build output, and logs. Never retrofit a `.gitignore` after secrets or
  `node_modules` are already tracked — get it right before committing
  anything.
- Commit after each completed step, not just at the end of a phase. Use
  commit messages in the form `Phase N, step M: <what changed>` (e.g.
  `Phase 0, step 3: parse companyfacts response with tag fallback`).
- Push to `main` after each commit through Phase 5 — this is a solo
  project in the early phases, so committing straight to `main` is fine.
- From Phase 6 onward (once GitHub Actions CI exists), switch to feature
  branches + pull requests — that's the point where "a failing-test PR
  can't merge" actually means something. Don't bother with PRs before then.
- Never commit secrets: `.env` values, JWT signing secrets, AWS
  credentials, database passwords. If one is accidentally committed,
  treat it as compromised and rotate it — removing it in a later commit
  isn't enough, since git history keeps it either way.
- Creating the actual GitHub repository (the remote) is a one-time step
  for the user, done via github.com or `gh repo create` if the GitHub CLI
  is installed and authenticated. Don't assume `gh` is available — ask if
  a remote doesn't already exist rather than guessing how to create one.

## Ground rules for external API calls
- **SEC EDGAR**: hard limit is 10 requests/second — stay at 5–8/s. Always
  send a descriptive `User-Agent` header with a real contact email. Never
  call the real SEC API from an automated test; mock it with `nock`.
- **NSE/BSE** (Phase 8, India track, later): no documented rate limit
  exists — default to a few requests per minute, and never call these from
  CI either.

## Where things live
- `ROADMAP.md` — full phase-by-phase plan: what to build, tech choices,
  what to avoid, failure cases to test, and the "done" bar per phase.
- `PROGRESS.md` — current phase/step and a running log. Update after every
  completed step, without exception.
- `docs/` — optional: the original longer-form planning documents, if
  added, with the full reasoning behind each decision.

## When something is ambiguous
Ask rather than guess — especially for schema decisions (expensive to
change later) and anything that means calling a real external API more
than a couple of times.
