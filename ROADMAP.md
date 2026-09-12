# ROADMAP — EDGAR Radar

Full reasoning for every decision here lives in the longer planning docs
(`docs/one-serious-project-roadmap.md`, `docs/india-first-project-roadmap.md`)
if you added them. This file is the execution checklist — work top to
bottom, one unchecked step at a time, per `CLAUDE.md`.

---

## Phase 0 — Fundamentals
**Goal:** one throwaway script that proves you can pull real data from SEC's API.

**Build:**
- [x] Scaffold project: `npm init`, TypeScript, `ts-node`, `tsconfig.json`
- [x] Initialize git, add a `.gitignore` (`node_modules/`, `.env`, `dist/`, logs), make the first commit
- [x] Create the GitHub repo (manually via github.com, or `gh repo create` if available) and push
- [x] Script accepts a CIK as a CLI argument
- [x] Calls `https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit-padded}.json` with a descriptive `User-Agent` header (your name/project + a real contact email)
- [x] Parses the response and prints the most recent `Revenues` and `NetIncomeLoss` values
- [x] Falls back to at least one alternate tag name when the primary one is missing (e.g. `RevenueFromContractWithCustomerExcludingAssessedTax`)
- [x] Handles a 404 (bad CIK) and a company with no XBRL data at all, without crashing

**Tech:** Node + TypeScript, `ts-node`, `axios` or `fetch`, `dotenv`

**Do NOT use yet:** database, Express, queue, Docker, auth, scheduling

**Test these failure cases:**
- [x] Nonexistent CIK
- [x] A company that reports no XBRL data
- [x] Request sent without a `User-Agent` (should 403)

**Done when:** runs correctly against 5 different real companies, one of which fails gracefully.

---

## Phase 1 — Backend
**Goal:** a real Express + Postgres API wrapping Phase 0's logic.

**Build:**
- [x] Install Express, `pg`, `zod`, `bcrypt`, `jsonwebtoken`
- [x] Stand up Postgres (Docker container or native Windows install), confirm connection
- [x] Set up `node-pg-migrate`; write first migration: `companies` table
- [x] Service/repository function that upserts a company + facts into Postgres (reusing Phase 0 logic)
- [x] `GET /companies/:cik` and `GET /companies/:cik/facts`
- [x] `users` table migration; `POST /auth/register` (bcrypt hash)
- [x] `POST /auth/login` issuing a JWT
- [x] JWT verification middleware
- [x] `watchlists` table migration; `GET/POST/DELETE /watchlist` behind the middleware
- [x] `zod` validation on every endpoint accepting a body

**Tech:** Express, TypeScript, PostgreSQL, `node-pg-migrate` (or raw SQL migrations), `zod`, `bcrypt`, `jsonwebtoken`

**Key decision:** CIK as natural key (not a surrogate ID). Represent XBRL facts as a **long/EAV table**, not wide columns.

**Do NOT use yet:** Redis/queue, scheduling, full docker-compose stack, cloud deployment

**Test these failure cases:**
- [x] Duplicate email registration
- [x] Expired/tampered JWT
- [x] SQL-injection attempt in a search param (confirm parameterized queries protect you)
- [x] Watchlisting the same company twice (should reject cleanly)

**Done when:** register → login → watchlist 3 companies → fetch their facts, all via curl/Postman, backed by Postgres.

---

## Phase 2 — Data Engineering
**Goal:** idempotent, resumable ingestion at real scale (~200 companies), not one-at-a-time.

**Build:**
- [x] Pick your ~200-company universe (e.g. S&P 500 constituents), store the list
- [x] Migrate the proper EAV `filing_facts` table (extend/replace Phase 1's storage)
- [x] Token-bucket rate limiter targeting 5–8 req/s
- [x] Resumable backfill script: iterate companies, fetch + upsert, checkpoint progress in an `ingestion_runs`/cursor table
- [x] Data-quality checks (numeric values, known units) that quarantine bad rows instead of crashing
- [x] Full-text ingestion: fetch a filing's primary HTML doc, extract plaintext with `cheerio`, store in `filing_text_sections` with a `tsvector` column
- [x] `effective_from` pattern on `filing_facts` so restatements append, never overwrite

**Tech:** same stack + `cheerio`

**Do NOT use yet:** Kafka, Airflow, Spark (data fits comfortably in Postgres; this is one linear job, not a DAG)

**Test these failure cases:**
- [x] Kill the backfill mid-run (`kill -9`) — confirm it resumes without duplicating rows
- [x] A company that changes SIC code/taxonomy version between filings
- [x] An HTML filing whose structure breaks the text extractor — must skip, not crash
- [x] Deliberately trigger a rate-limit breach — confirm you detect the 403 and back off

**Done when:** `npm run backfill` ingests 200+ companies end-to-end, is safely re-runnable, survives a kill/restart, and quarantines bad records via 3+ automated checks.

---

## Phase 3 — Automation
**Goal:** the pipeline stays correct unattended, without a human running commands.

**Build:**
- [x] Interval poller (`node-cron`) detecting new filings since the last successful run
- [x] Nightly reconciliation job against bulk `companyfacts.zip`
- [x] Retry with exponential backoff on transient errors
- [x] Max-retry + quarantine path for permanently failing filings
- [x] Heartbeat/silence alerting (email or Slack webhook) if no successful run in N minutes

**Tech:** `node-cron`, `ingestion_runs` as source of truth for "last processed," `nodemailer` or a Slack webhook

**Do NOT use yet:** a dedicated message queue (still one poller doing sequential work), Airflow (two scheduled jobs isn't a DAG)

**Test these failure cases:**
- [x] Kill the poller process — does it restart, or stay silently dead? **Tested; stays silently dead** — no process supervisor exists in this phase's tech stack (Docker/Kubernetes are explicitly Phase 6). Accepted as a known limitation for now; see PROGRESS.md.
- [x] Simulate an SEC outage for an hour — does it catch up cleanly after?
- [x] A permanently malformed filing retried forever — confirm the dead-letter path catches it
- [x] Deliberately skip one filing — confirm nightly reconciliation finds and backfills it

**Done when:** runs unattended 48+ hours (not verified within this session — see PROGRESS.md), zero duplicates, zero permanent gaps, survives one injected failure, sends exactly one alert when you break something on purpose.

---

## Phase 4 — Distributed/Event-driven Architecture
**Goal:** decouple ingestion, parsing, scoring, and notification into independently scalable stages.

**Build:**
- [x] Stand up Redis; install BullMQ
- [x] Ingestion Poller enqueues `filing.discovered`
- [x] Parser Worker consumes it, does Phase 2's parse work, enqueues `filing.parsed`
- [x] Scoring Worker consumes `filing.parsed` (can stub the actual scoring until Phase 5), enqueues `scores.updated`
- [x] Notification Worker consumes `scores.updated`, checks watchlists, sends (or logs) an alert
- [x] Every consumer is idempotent — upsert keyed on (accession number, stage)
- [x] Bull Board wired up for queue visibility

**Tech:** Redis + BullMQ

**Do NOT use yet:** Kafka (four consumer *stages*, not many independent consumer *groups* replaying history), Kubernetes (a handful of containers doesn't need an orchestrator)

**Test these failure cases:**
- [x] Kill each worker type mid-job, one at a time — job returns to queue, no data loss
- [x] A job processed twice (at-least-once delivery) — confirm no duplicate rows/emails
- [x] Restart Redis — confirm in-flight jobs aren't silently lost
- [x] Stop the notification worker for an hour — confirm earlier stages keep working and the backlog drains after

**Done when:** you can kill any one worker at any time with zero data loss and no duplicate side effects, and can watch a filing move through all four stages via Bull Board.

---

## Phase 5 — ML
**Goal:** add value where it's genuinely earned — not everywhere.

**Build:**
- [x] Implement Beneish M-Score, Altman Z-Score, Piotroski F-Score as pure functions over `filing_facts` (no ML — this is math)
- [ ] Wire these into the (previously stubbed) Scoring Worker
- [ ] "Not enough history yet" fallback for companies with too few quarters
- [ ] Pick an embeddings approach (start with a hosted API) and implement risk-factor-section diffing between a company's consecutive 10-Ks
- [ ] Store and expose diff results via the API
- [ ] Back-test ratio scores against 2–3 publicly known historical accounting-irregularity cases; write up results honestly, including where they fail

**Tech:** plain TypeScript for ratios; hosted embeddings API (or a Python microservice using `sentence-transformers`, as an explicit later stretch)

**Do NOT use yet:** real-time inference, GPU, any custom-trained deep model

**Test these failure cases:**
- [ ] Company with too few historical quarters — degrade gracefully, don't output nonsense
- [ ] A filing whose risk-factors section failed to extract in Phase 2 — skip, don't crash
- [ ] Embeddings API down/rate-limited — treat as best-effort, don't block the scoring stage

**Done when:** every ingested company has ratio scores; 5+ companies show a meaningful, human-readable risk-factor diff; every flagged anomaly is explainable from its inputs.

---

## Phase 6 — Productionization
**Goal:** reproducible, tested, deployed — not just working on your machine.

**Build:**
- [ ] Dockerfiles for the API and each worker
- [ ] `docker-compose.yml` wiring API + workers + Postgres + Redis
- [ ] Unit tests for parsers/scorers with fixture data
- [ ] Integration tests against a throwaway test Postgres
- [ ] Contract tests for the SEC client using `nock` — **remove any test that hits real SEC**
- [ ] Structured logging (`pino`)
- [ ] GitHub Actions: lint + test + build on every PR
- [ ] AWS setup: RDS, EC2/Fargate, S3, SES, Secrets Manager
- [ ] Deploy-on-merge-to-main added to the GitHub Actions workflow

**Windows note:** use Docker Desktop with the WSL2 backend.

**Do NOT use yet:** Kubernetes (not justified at this container count)

**Test these failure cases:**
- [ ] A deploy with a broken migration fails the pipeline before reaching prod
- [ ] A container missing a required env var fails fast with a clear error
- [ ] A flaky, un-mocked, third-party-dependent test in CI is treated as a bug and fixed

**Done when:** `docker-compose up` works from a clean checkout with only `.env.example` copied; a failing-test PR can't merge; merge to `main` deploys automatically; a secret-scan finds nothing.

---

## Phase 7 — Scale
**Goal:** a real, numbered scaling story — plus one bottleneck actually built and measured.

**Build:**
- [ ] Write `ARCHITECTURE.md` documenting the 100 → 10,000 → 1,000,000-user scaling narrative (see the full planning doc for the detailed version)
- [ ] Implement an RDS read replica; route read-heavy endpoints to it
- [ ] Add Redis response caching for hot endpoints
- [ ] Load-test before/after with `autocannon`; record real numbers

**Done when:** the documented narrative names specific components at each stage (not "add more servers"), and at least one stage is actually implemented and load-tested.

---

## Phase 8 — India Extension (later)
Not started. Come back to this once Phase 6 (ideally Phase 7) is solid.
Full detail in `docs/india-first-project-roadmap.md` — NSE/BSE ingestion
with session/cookie handling, raw XBRL parsing, NSE-vs-BSE reconciliation,
and MCA Company Master Data enrichment, layered onto the same backend and
worker architecture built above.
