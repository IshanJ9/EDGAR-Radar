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
- **Real-world 48h run on the Azure VM, checked 2026-09-15 (~105h in): NOT met.** The poller completed 41 cycles exactly 30 minutes apart, then died after ~20.5h when an Ubuntu unattended-upgrade (`libc6`) restarted Postgres: the resulting `FATAL 57P01` went unhandled (no `pool.on('error')` handler) and nothing restarted the process. Zero duplicates ✅; nightly reconciliation ran all 4 nights (fixed 2 discrepancies) but new-filing discovery stopped — gap open, expected to be recoverable via the poller's cursor; heartbeat detected the outage within 75 min but sent **68** alerts (repeat window = 60-min threshold) instead of one; no failure was injected on purpose. Root cause and fix plan in PROGRESS.md.
- **Re-run after the fix, checked 2026-09-21 (~136h in): the 48h bar is MET.** On tag `phase-3-complete-v3` (the pool error handler) under systemd, the poller ran **274 consecutive completed cycles** with a **maximum gap of 30.00 min inside the first 48h** (30.02 min over the whole 136h), **0 gaps over 45 min**, 0 errors in `poll.log`, **0 duplicate `filing_facts` keys**, 0 quarantined companies, and `NRestarts=0` on all three units across 10 days of host uptime. The heartbeat ran 553 checks and sent **0 alerts** — correct, since nothing went silent. **Two things this run does not prove:** Postgres never restarted during it (`pg_postmaster_start_time()` is still the first run's 2026-09-12 06:30:38), so the pool fix was exercised only by the separate restart probe, not by this run; and no failure was injected, so "exactly one alert when you break something on purpose" — the 68-alert repeat defect, deliberately left unfixed — is still untested. A real unplanned failure did occur and was survived: the 2026-09-18 reconciliation died mid-download on a dropped SEC connection, was recorded `failed` rather than silently lost, and the next night completed 196/196. See PROGRESS.md.

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
- [x] Wire these into the (previously stubbed) Scoring Worker
- [x] "Not enough history yet" fallback for companies with too few quarters
- [x] Pick an embeddings approach (start with a hosted API) and implement risk-factor-section diffing between a company's consecutive 10-Ks
- [x] Store and expose diff results via the API
- [x] Back-test ratio scores against 2–3 publicly known historical accounting-irregularity cases; write up results honestly, including where they fail

**Tech:** plain TypeScript for ratios; hosted embeddings API (or a Python microservice using `sentence-transformers`, as an explicit later stretch)

**Do NOT use yet:** real-time inference, GPU, any custom-trained deep model

**Test these failure cases:**
- [x] Company with too few historical quarters — degrade gracefully, don't output nonsense
- [x] A filing whose risk-factors section failed to extract in Phase 2 — skip, don't crash
- [x] Embeddings API down/rate-limited — treat as best-effort, don't block the scoring stage

**Done when:** every ingested company has ratio scores (in practice: a real score *or* an honest "not enough history" result — real coverage is 27-73% depending on the score, see PROGRESS.md); 5+ companies show a meaningful, human-readable risk-factor diff; every flagged anomaly is explainable from its inputs.

---

## Phase 6 — Productionization
**Goal:** reproducible, tested, deployed — not just working on your machine.

**Build:**
- [x] Dockerfiles for the API and each worker — one multi-stage `Dockerfile`, four `CMD`s (see PROGRESS.md for why one image rather than four files)
- [x] `docker-compose.yml` wiring API + workers + Postgres + Redis
- [x] Unit tests for parsers/scorers with fixture data
- [x] Integration tests against a throwaway test Postgres
- [x] Contract tests for the SEC client using `nock` — **remove any test that hits real SEC**
- [x] Structured logging (`pino`)
- [x] GitHub Actions: lint + test + build on every PR
- [x] Azure setup: Azure Database for PostgreSQL, Container Apps, Blob Storage, an email-sending service, Key Vault
      (originally written as AWS - RDS/EC2-Fargate/S3/SES/Secrets Manager - before this step started; changed to Azure since the user has an Azure account, not AWS, and Phase 3's real-world 48h validation already ran on a separate Azure VM. See PROGRESS.md for the full reasoning and service-by-service mapping.)
      **IN PROGRESS, blocked on one user action. See PROGRESS.md's two dated step-8 entries for the full story - the second (2026-09-13) corrects a wrong conclusion in the first.** The user does not want to incur any Azure cost, and that constraint decides this whole step.
      - [x] Resource group — `edgar-radar-rg` (genuinely free).
      - [x] Blob Storage — `edgarradarij` (`Standard_LRS`/StorageV2/Hot, TLS 1.2 min, public blob access off). No standing charge; $0.00 at this volume. Write path not yet exercised.
      - [x] Key Vault — `edgar-radar-kv-ij` (`standard`). Standard vaults have no per-vault charge at all, only $0.03/10k operations, so this is genuinely $0 here. Write path not yet exercised.
      - [ ] ~~Container Apps~~ — blocked by a real, confirmed platform restriction on this subscription (policy-disallowed in every region tried except Central India, which reports zero quota with nothing deployed). **But the first attempt's conclusion that this meant "no free Azure compute exists" was wrong:** App Service was never tested. An `F1` Linux plan (`tier: LinuxFree`) created fine in Central India and — contrary to the common claim that the Linux Free tier can't run custom containers — served a real Docker image at **HTTP 200** on a live URL. Created, verified, then deleted once hosting moved off Azure; recreatable in two commands.
      - [ ] Azure Database for PostgreSQL — no free tier on any SKU. Neon's Azure-native integration (the user's first choice) is genuinely unavailable here: the `Neon.Postgres` namespace is *invalid*, not merely unregistered, consistent with Azure for Students blocking Marketplace offers.
      - [ ] Email-sending service — **deliberately dropped, not blocked.** Azure Communication Services Email has no free tier, and Phase 3 step 5 already built and tested Slack webhook alerting at $0, which the user chose over email at the time. Superseded rather than deferred.

      **Hosting decision (deviates from the locked "Cloud: Azure" choice; put to the user explicitly, not taken unilaterally):** Azure cannot host this stack at $0 — F1 gives 60 CPU-min/day with no Always On and 1GB RAM shared across all apps, which won't hold an API plus three Node workers. Re-checked against current sources, **no mainstream PaaS offered a genuinely free always-on background worker in 2026** (Fly.io free tier gone since 2024; Koyeb closed free signups after its Feb 2026 Mistral acquisition; Render free spins down, always-on starts at $7/mo/service). The user chose to run the entire existing `docker-compose.yml` — API + 3 workers + Redis + Postgres — on a single **Oracle Cloud Always Free VM** (2 OCPU/12GB ARM after Oracle's quiet June 2026 halving; 200GB storage). No re-architecture needed, since step 2's compose file already wires exactly those services. Supabase free Postgres (500MB, pauses after 7 days idle) is the documented fallback and is a one-line `DATABASE_URL` change.

      **DONE 2026-09-13 — deployed and serving at `http://80.225.253.10:3000`, at genuinely $0.** Oracle Always Free VM `edgar-radar-vm` (`VM.Standard.A1.Flex`, exactly 2 OCPU/12GB, Ubuntu 24.04 `aarch64`, `ap-mumbai-1`) runs the full `docker-compose.yml` stack — API, all 3 workers, Redis, Postgres. Verified from the public internet, not just from inside the box: `GET /companies/0000320193` returns **HTTP 200** `{"cik":"0000320193","entityName":"Apple Inc."}`, exercising Express → repository → live rate-limited SEC call → Postgres → response; `migrate` exited 0 with all 16 tables created; all 4 services at `RestartCount=0`; all 3 BullMQ queues registered in Redis. The `arm64` build risk did not materialise — all 5 images built cleanly on the VM, which also avoided needing a container registry.
      - Hardened during deployment: ingress limited to TCP 22/3000 only, with **port 5432 confirmed refused from outside**; Oracle's Ubuntu `iptables` `REJECT` rule (which would have silently blocked 3000 despite the cloud security list) opened and persisted; Postgres rebound to loopback via a **deployment-only, uncommitted** `docker-compose.override.yml`, since the base file's `5432:5432` is correct for local development but unsafe on a public host — and Docker's published ports bypass the host firewall, so only the cloud security list would otherwise have protected it. That override needs Compose's `!override` tag, because Compose merges rather than replaces sequence values. It also sets `restart: unless-stopped` on all long-running services for Oracle's maintenance reboots.
      - [ ] **Known gap — no off-box Postgres backup yet.** Oracle Always Free has a documented idle-reclamation policy and has already changed its terms without announcement (June 2026 ARM halving). Since this project's whole value is the ingested data, a scheduled `pg_dump` pushed off the VM is the next real hardening step.
- [x] Deploy-on-merge-to-main added to the GitHub Actions workflow
      **VERIFIED end to end on its first real run (2026-09-13):** PR #1 merged → run #2 on `74b68ef` → `lint`/`test`/`build`/`test-integration` all green → `deploy` green including its public-URL smoke check (44s). Independently confirmed on the VM (HEAD `74b68ef`, clean tree apart from the intended untracked override) and from the open internet (`/companies/0000320193` 200, `/admin/queues` 404). Originally written and left unchecked until it had actually run once; details of the design follow. `.github/workflows/ci.yml` gains a `deploy` job plus a second trigger (`push` to `Main`). It `needs: [lint, test, build, test-integration]`, so the same suite that gates a PR also gates production, and `if:` restricts it to pushes on `Main` - forks cannot push, so fork PRs can never reach it even though it uses secrets.
      - How this satisfies "a deploy with a broken migration fails the pipeline **before** reaching prod": `test-integration` already runs the real `node-pg-migrate up` against a throwaway Postgres (step 4), so a broken migration fails on a disposable database and `deploy` never starts.
      - Deploy uses a **dedicated** SSH key (`edgar_radar_deploy`), separate from the local admin key so the two can be revoked independently, and pins the server host key via `StrictHostKeyChecking=yes` rather than disabling host verification - a job holding a private key must not authenticate itself to whatever answers on that IP. Verified working.
      - Ends with a smoke check against the **public** URL, so a green deploy proves firewall, security list, Express and Postgres end to end, not merely that a container started. It targets an already-ingested company so it is served from Postgres and never calls SEC, per CLAUDE.md.
      - Uses 3 repo secrets (`DEPLOY_HOST`, `DEPLOY_HOST_KEY`, `DEPLOY_SSH_KEY`), added by the user in GitHub settings - not something a commit can configure.
      - Before the first run, only the key-auth-with-pinned-host-key step could be rehearsed (the `git reset --hard` + rebuild portion was blocked by the sandbox's permission classifier, not worked around). The first real merge then exercised the whole script successfully. One limit of that first run: the deploy step took 30s, so the Docker build was almost entirely layer-cached - a cold rebuild (e.g. after a dependency change) has not yet gone through the pipeline.

**Windows note:** use Docker Desktop with the WSL2 backend.

**Do NOT use yet:** Kubernetes (not justified at this container count)

**Test these failure cases:**
- [x] A deploy with a broken migration fails the pipeline before reaching prod
      **Verified 2026-09-13, locally and on GitHub's runners (PR #2, run #3, closed unmerged).** A deliberately broken migration (a typo'd table name - valid SQL that only fails when executed) failed `test-integration` with `relation "companys" does not exist` (`42P01`) while `lint`/`test`/`build` stayed green, `deploy` was skipped and `Main` was untouched. Jest never ran against the half-migrated database, and `node-pg-migrate` rolled back the whole pending batch rather than leaving earlier migrations applied.
      - **Limit:** `deploy` is skipped on every PR run regardless, so "this would also block a real deploy on `Main`" rests on `deploy`'s `needs: [..., test-integration]`, not on something the PR demonstrated.
      - **Known gap, logged by choice rather than tested:** CI migrates an *empty* throwaway database, so a migration that only fails against real rows (e.g. adding a `NOT NULL` column to a populated table) would pass CI and first fail in production. The production-side safety nets - batch rollback, and `docker-compose.yml` starting nothing until `migrate` completes successfully - are expected to hold but have not been exercised. See PROGRESS.md.
- [x] A container missing a required env var fails fast with a clear error
      **Verified 2026-09-13 - after fixing it, because testing showed it was not true.** Tested first against 17 real containers from the production image, each missing exactly one required variable: only `EDGAR_CONTACT_EMAIL` and `JWT_SECRET` failed fast. Every missing-`DATABASE_URL` case started and logged exactly like a healthy service (`pg` silently falls back to localhost and connects lazily), and every missing-`REDIS_URL` case kept running while logging `ECONNREFUSED 127.0.0.1:6379` roughly 30 times a second without naming the variable - 8 of 13 cases failed the bar.
      - **Fix:** `src/config.ts` (zod) defines each required variable once, with a per-service list, and each of the 4 entrypoints runs it first through a bootstrap module. It reports every problem at once, exits 1, uses container-accurate wording, treats a blank value as missing (what `docker compose` passes for an undefined variable), and never prints a value. Values are read through the same module via `requireEnv`, replacing the old scattered checks and `REDIS_URL!` assertions.
      - **After:** 20/20 container cases pass - each missing, blank or malformed variable exits 1 in 0.4-0.5s with e.g. `[api] Refusing to start - ... - DATABASE_URL is not set`, all four are listed when all four are missing, and a malformed value is rejected without appearing in the logs. Real `docker compose` with `JWT_SECRET`/`EDGAR_CONTACT_EMAIL` defined nowhere exits 1 naming both.
      - **Deployed (PR #4, `e77bfc9`):** CI and deploy green; on the VM all four containers were recreated inside the deploy window under the new validator, with 0 restarts and 0 refusals, and the public smoke check returned 200. See PROGRESS.md.
- [x] A flaky, un-mocked, third-party-dependent test in CI is treated as a bug and fixed
      **Verified 2026-09-14.** An audit found no such test to fix: unit suite 10/10 repeat runs and 5/5 randomized test orders, integration suite 3/3 repeat runs, no test reads the clock or random numbers, and the integration-tested repository functions never call SEC. What prevents one is `nock.disableNetConnect()` in `jest.setup.ts`, proven against a real host (`fetch` refused in 2ms, `https.get` in 13ms).
      - **Hardened:** nothing previously noticed if that guard line were deleted - CI would stay green. `src/__tests__/networkGuard.test.ts` now requests a real host and asserts refusal; a mutation check with the guard removed turned both of its tests red ("promise resolved instead of rejected", "unexpectedly received HTTP 200").
      - **Proven on GitHub's runners (PR #6, run #10, closed unmerged):** a test that forgets to mock SEC made `test` fail with `Nock: Disallowed net connect for "data.sec.gov:443/..."` while `lint`/`build`/`test-integration` stayed green and `deploy` was skipped - a deterministic red, never a pass that depends on SEC being up.
      - **Logged, not changed:** a forgotten mock fails only after 2.2-2.6s of real retry backoff (the refusal counts as a network error); and CI's integration job pulls the moving `postgres:16-alpine` tag from Docker Hub each run.
      - **Deployed (PR #7, `996f1af`):** the guard regression test ran on GitHub for the first time and passed (7 suites / 70 tests); push run #12 and its deploy and smoke check were green. See PROGRESS.md.

**Done when:** `docker-compose up` works from a clean checkout with only `.env.example` copied; a failing-test PR can't merge; merge to `main` deploys automatically; a secret-scan finds nothing.
- **"`docker-compose up` works from a clean checkout with only `.env.example` copied" - verified 2026-09-15, on a fresh GitHub Ubuntu runner** (throwaway PR #11, `clean-checkout` run #2, closed unmerged). The only `.env*` file in the checkout was `.env.example`; after copying it, `docker compose up -d --build` built all five images from scratch (npm ci, TypeScript build, embedding model warmed in 1.0s) and returned in 48s; `migrate` exited 0 ("Migrations complete!"); API and all three workers `running`, 0 restarts, 0 "Refusing to start"; register 201, login issued a JWT, `/watchlist` 200, `/admin/queues` 404. Only database-backed endpoints were exercised, so no SEC calls.
  - **Not verified on the developer machine.** Locally the image build failed there that day: the build-time model download from Hugging Face's CDN was slow (~0.2-0.26 MB/s, versus a 15s step two days earlier) and twice timed out connecting, while plain containers and minimal builds on the same machine reached the CDN - a real build-time third-party dependency, logged rather than changed. A separate local `up --build` of all five targets also hung before its first step, unexplained. See PROGRESS.md.
- **Phase 6 "Done when" bar: all four items met.**
- **"a secret-scan finds nothing" - verified 2026-09-14.** All 63 commits GitHub serves, including every PR's `refs/pull/N/head`: gitleaks 8.30.1 found no leaks (and the 6 merge commits it skips add no content of their own); a literal search for the local `JWT_SECRET` and slices of all four private keys found none; the VM's generated secrets, compared by SHA-256 only, are absent. Each detector was proven to fire first - gitleaks caught a planted token that had been committed and then deleted. Not covered: GitHub content outside git (PR text, Actions logs) and GitHub's own scanning alerts. See PROGRESS.md.
- **"a failing-test PR can't merge" - enforced and verified 2026-09-14.** Ruleset "Protect Main" (Active, targets the default branch `Main`, empty bypass list): restrict deletions, block force pushes, require a pull request (0 approvals, solo repo), and require `lint`/`test`/`build`/`test-integration` to pass. Proof: PR #6, still carrying its failing `test` check, went from a mergeable `unstable` state to a **disabled Merge button** - "Merging is blocked due to failing merge requirements" - with no bypass option offered. See PROGRESS.md.

---

## Phase 7 — Scale
**Goal:** a real, numbered scaling story — plus one bottleneck actually built and measured.

**Build:**
- [x] Write `ARCHITECTURE.md` documenting the 100 → 10,000 → 1,000,000-user scaling narrative (see the full planning doc for the detailed version)
      **Done 2026-09-16.** No planning doc existed (`docs/` is empty), so it was written from the code and from measurements taken that day on the dev database, the Oracle production VM and the Azure Phase 3 VM. Separates the data axis (companies, capped by SEC's 10 req/s) from the user axis (read traffic and notification fan-out); ranks 8 bottlenecks present in today's code, including a **real bug** — the SEC rate limiter is per process, so the API and parser worker together can exceed SEC's limit; then names specific components per stage with stated assumptions and derived load. Measured vs assumed numbers are labelled. See PROGRESS.md.
- [x] Implement an Azure Database for PostgreSQL read replica; route read-heavy endpoints to it
      **Done 2026-09-26, as a streaming-replication Postgres container rather than Azure** (user's decision): Azure Database for PostgreSQL has no free tier on any SKU, and Oracle's Always Free A1 allowance (2 OCPU / 12 GB, per Oracle's docs) is fully used by the production VM, so the replica runs beside the primary on the same host. It therefore adds **no read capacity** — it builds and measures the replication and routing mechanics, and moving it to its own host later changes only connection strings. The API's `GET /companies/...` endpoints read from it; a replica miss is checked on the primary before any SEC fetch (replication lag); read-after-write stays on the primary; a failed replica read falls back to the primary, with a circuit breaker added after measurement showed a stopped replica made every read take ~3.4s. Verified on a production-shaped existing volume: clone in ~6s, replay lag 1.5ms, writes rejected on the replica, lag path with replay paused, outage + recovery through the slot. See PROGRESS.md.
- [x] Add Redis response caching for hot endpoints
      **Done 2026-09-26.** Cache-aside on `GET /companies/:cik`, `/facts` and `/risk-factor-diff`, on a separate `redis-cache` (64 MB, `allkeys-lru`, no persistence) — the queue Redis must stay `noeviction`, so they cannot share a server. Invalidated at the three repository write functions every writer goes through (so reconciliation's corrections are covered, not only `filing.parsed`), deleted twice to close the read-before-write race that the async replica widens, with a 5-minute TTL as a backstop. Fails open: with the cache stopped, reads stayed 200 in ≤17 ms with one warning per 30 s. Verified in real containers: miss then hit with byte-identical bodies, a hit touching neither database, and a real `upsertFact` write invalidating the entry so the next read served the new value. See PROGRESS.md.
- [x] Load-test before/after with `autocannon`; record real numbers
      **Done 2026-09-26, on the production VM** (user's choice), with `scripts/load-test.sh`: three configurations as temporary API containers against the real databases, the live API untouched, 0 errors in 420,861 requests. At 50 connections: primary only **1,499 req/s**, p50 32 ms / p99 56 ms; read replica **1,486 req/s**, 32 / 56 ms (no change — same host, same CPUs); replica + cache **4,165 req/s**, 11 / 20 ms (2.8×, databases ~0% CPU). With the cache the bottleneck moves to the single-threaded API process (~100% of one core). Best-case numbers — one hot key, co-located load generator; full table and limits in `ARCHITECTURE.md` §5 and PROGRESS.md.

**Done when:** the documented narrative names specific components at each stage (not "add more servers"), and at least one stage is actually implemented and load-tested.
- **MET 2026-09-26.** `ARCHITECTURE.md` names specific components per stage (step 1), and two of Stage 2's components — the Postgres read replica and the Redis response cache — are implemented, deployed, and load-tested on production with before/after numbers (steps 2–4).

---

## Post-Phase 7 — Production ingestion
**Added 2026-09-26 at the user's request; not part of the original roadmap.** Phases 0–7 are complete, but the deployed system never discovers new filings: the poller, nightly reconciliation and heartbeat (Phase 3) were never deployed, because they resolve `data/company-universe.json` via `__dirname`, which breaks once compiled. Deploying them safely takes more than the path fix, so it is split into steps, done one at a time like every phase above.

**Goal:** production finds, ingests and reconciles new filings on its own, without ever exceeding SEC's rate limit.

**Build:**
- [x] One SEC request budget shared across processes. Each process has its own token bucket at 7 req/s with a burst of 7, so the API and parser worker together could already exceed SEC's 10 req/s in theory, and adding the poller makes it three processes. Split a single budget between them so that no alignment of bursts can exceed 10 in any second.
      **Done 2026-09-26.** `SEC_REQUESTS_PER_SECOND` sets each process's share (validated: >0 and ≤8), and every bucket's burst is now 1, so a process sends at most rate + 1 in any second. Compose shares: API 1, parser worker 2 (poller 2 and reconciliation 1 arrive in step 2: 6/s sustained, at most 10 in any second). `secBudget.test.ts` reads the real `docker-compose.yml` and fails if the shares could exceed 10 in a second or 8 sustained. Verified in the compiled image with `fetch` stubbed: 1/s → requests exactly 1,000 ms apart; 2/s → 501 ms apart. See PROGRESS.md.
- [x] Deploy the poller, reconciliation and heartbeat as Compose services: fix the path resolution; give reconciliation a writable volume for its 1.4 GB download; skip companies not yet stored (their facts would violate the foreign key and fail the whole run); run reconciliation only on its nightly schedule, not on every container start. Verify a real poll cycle end to end in production.
      **Built and verified locally 2026-09-27; production verification after merge.** `src/universe.ts` finds the project root by walking up to `package.json` (right under ts-node and compiled), used by the poller, reconciliation and backfill; reconciliation skips companies not yet stored and writes to `/app/.cache`, made writable in the image (a directory, not a volume — the zip never outlives a run); `RECONCILE_ON_START=false` in Compose. Three new services, `poller` (SEC share 2), `reconcile` (1), `heartbeat` (none). Verified offline — a Docker network with no internet, so zero SEC requests: the poller ran a cycle, recorded it and correctly did not advance its cursor; reconciliation skipped its startup run; its cache directory was writable as `node`. See PROGRESS.md.
- [x] One-time backfill of the 196-company universe into production (about 196 SEC requests, inside the budget) — subject to the user's go-ahead at that point.
      **Done 2026-09-26, with the user's go-ahead.** The poller was stopped and the backfill run as a one-off container of the poller service, inheriting its SEC share of 2, so the budget held. **196/196 companies succeeded, 0 failed, in 105 s** (196 requests ÷ 2 per second = 98 s); 6,035 facts, 0 quarantined, identical on the replica; no SEC errors. The poller was paused ~2 min 20 s and its next cycle completed cleanly. See PROGRESS.md.
- [x] Heartbeat sends one alert per outage, not one every ~75 minutes; then stop the poller in production on purpose to test detection and recovery. This closes Phase 3's two failure cases that were never tested.
      **Done 2026-09-27.** The alert rule now fires only if no alert has been sent since the poller's last success, and a fresh deploy gets the full threshold before a "no cycle yet" alert (PR #22). **Production outage:** poller stopped 07:13:35 UTC (last success 07:01:37), restarted by a server-side timer at 09:43:47 — 2 h 42 min of silence. **Exactly one alert**, at the 08:15 check (73 min silent); none at 08:00 (58 min) and none at the six checks from 08:30 to 09:45, where the old rule would have repeated. The catch-up cycle completed at 09:45:26 and the next check was quiet. Delivery went to the log fallback: production has no Slack webhook configured. See PROGRESS.md.
- [x] The poller finds every filing, exactly once. *Added 2026-09-28, found while checking the first "Done when" item:* SEC's `filingDate` has no time, so comparing it with the cursor's timestamp skipped every filing made during the day — production ran 86 cycles and found 0. Fix: consider filings dated within a 2-day lookback of the cursor and record each enqueued filing by accession number (new `discovered_filings` table) so none is enqueued twice.
      **Done and verified in production 2026-09-28** (PR #24, deployed 14:35 UTC): in its first two cycles the poller found **82 filings** from 10 companies, each enqueued once (82 rows, 82 distinct); the parser worker processed all 82 with **0 failed jobs** and no SEC errors. 7 new poller unit tests on a simulated clock (a mid-day filing is found; nothing is enqueued twice across a day of cycles; after-hours and late-listed filings are found; a failed enqueue is retried), and 3 integration tests for the new SQL. Six deliberate mutations, including the original bug, were all caught. See PROGRESS.md.

**Done when:** a poll cycle runs in production every 30 minutes and its discovered filings are ingested by the parser worker; reconciliation completes nightly; the heartbeat detects a deliberately stopped poller and alerts exactly once; and the configured SEC budget provably cannot exceed 10 requests in any second.
- **MET 2026-09-28.** A cycle runs every 30 minutes in production, and on 2026-09-28 the parser worker ingested all 82 filings the poller discovered (step 5 — after fixing a defect that had hidden every daytime filing); reconciliation completed its first nightly run on 2026-09-27 (196 companies, 0 discrepancies); a deliberate 2 h 42 min poller outage produced exactly one alert (step 4); `secBudget.test.ts` enforces the ≤10-per-second bound on the real Compose file (step 1).

## Post-Phase 7 — Hardening and presentation
**Added 2026-09-30 at the user's request; not part of the original roadmap.** Production now ingests filings on its own, but it has no backup, its alerts reach no one, and nothing presents it to a non-technical visitor. Phase 8 (India) is skipped for now by the user's decision. Done one step at a time, like every phase above.

**Goal:** production survives losing its VM, tells a human when something breaks, stops making redundant SEC requests, and can be understood and used by someone with no technical background.

**Build:**
- [x] Nightly off-box database backup to Oracle Object Storage (Always Free: 20 GB, 50,000 requests/month — verified against Oracle's documentation 2026-09-30). A write-only pre-authenticated upload link on the VM, one dump per day of the month so a month of history rotates without deletes. *Azure Blob was considered and rejected: the Azure for Students subscription stops every resource when its credit expires within 12 months.*
      **Built 2026-09-30; a real production backup restored with every table matching; the scheduled service deploys on merge.** A `backup` Compose service (Postgres 16 + curl) dumps, checks and uploads at 03:00 UTC. A production dump (242,568 bytes) was downloaded with the account owner's credentials and restored into a fresh Postgres: 17/17 tables, identical row counts to production. See PROGRESS.md.
- [x] Slack webhook for alerts — the user creates the free webhook; wire it into production and test that a real alert arrives.
      **Done 2026-09-30** (PR #27, deploy run #52 green; both fixes confirmed in the running container). The user's webhook (saved on the VM without passing through this session) delivered a test message and a real heartbeat alert — the production alert rule, run once with a 1-minute threshold — both confirmed arriving by the user. Fixed: a rejected delivery was recorded as sent and never retried; any failed heartbeat check crashed the process. See PROGRESS.md.
- [ ] Frontend for non-technical visitors — planned 2026-09-30 with the user; built in the sub-steps below.
      **Decisions (user):** an attractive UI; hosted on **Vercel** (Hobby plan: free, no billing cycles — usage over a limit pauses for the month rather than billing; personal/non-commercial use, which a portfolio is; verified against Vercel's docs 2026-09-30), which also gives HTTPS and a `*.vercel.app` address, replacing the DuckDNS + Caddy idea; browse-only (no login or watchlist in the UI yet).
      **Proposed stack (new technology, awaiting the user's approval):** React + Vite + TypeScript in a `web/` folder, Tailwind CSS, Recharts for charts; Vitest for component tests. The browser talks only to Vercel; a Vercel rewrite forwards `/api/*` to the Oracle API, so the page stays HTTPS with no mixed content and no CORS. If Vercel will not proxy to a plain-HTTP origin, a small Vercel function proxies instead.
  - [ ] **F1 — API endpoints the UI needs**, test-first with Supertest (closing the gap that no HTTP route has an automated test): `GET /companies` (the 196-company universe, for search by name or ticker); `GET /companies/:cik/scores` (Altman Z″, Piotroski F, Beneish M with their inputs and a plain-English band); `GET /stats` (companies monitored, last poll, filings found today, last reconciliation). The UI shows only *stored* risk-factor diffs, so a visitor's click can never trigger SEC downloads or embedding work. **Added after the mockups (2026-10-01), which used real production data:** `GET /filings/recent` (the live feed, grouping routine bond paperwork — 618 of 662 filings in one 24-hour window); each company's industry from SEC's `sicDescription` (so banks get "these scores don't fit banks" instead of a blank); **more years of history** — facts hold about two years per figure, so only **33 of 196** companies have all three scores and **43 have none**, and charts have 2–3 points; and computing a company's risk-factor diff when a new 10-K arrives, since the UI will no longer trigger it.
    Split 2026-10-01, once the mockups had added a feed, industry labels, more history and automatic diffs — too much for one step:
    - [x] **F1a — read-only endpoints.** `GET /companies`, `GET /companies/:cik/scores`, `GET /stats`, `GET /filings/recent`; Supertest route tests. **Done 2026-09-30** (PRs #29, #30): all four verified in production with real data and no SEC requests; a cache defect found by that check (the company list cleared on every fact write) fixed. None can fetch from SEC (tested). 204 unit tests (+30), 23 integration (+4); mutation checks 7/7 caught. See PROGRESS.md.
    - [x] **F1b — deeper data.** More years of history per figure (so more of the 196 can be scored; 33 have all three scores today) and each company's industry from SEC's `sicDescription`.
      **Found while starting it (2026-09-30): annual values were chosen by the fiscal year of the *filing*, not of the period** — every stored annual figure's year label was wrong for restated years, the newest years were never stored, and every score paired stale, mismatched years. Fixed with the user's approval (plan: fix selection, relabel stored rows, industry columns, then a 196-request backfill). **Done 2026-09-30** (PR #31, backfill run #2: 196/196, 0 SEC errors; facts 6,191 → 14,706; every company has an industry; 0 mislabelled years; Apple's FY2025 inputs match its 10-K). Coverage is now honest but still low — 27 of 196 have all three scores — and the remaining gaps are mostly figures reported under other names (gross profit missing for 127 companies, SG&A 88, receivables 59, shares 54), not history. See PROGRESS.md.
    - [x] **F1b-2 — score coverage.** Added 2026-09-30 at the user's request after F1b showed the remaining gaps are figures reported under other names, not history. Fallback tags and derivations chosen from what the 196 companies actually report (SEC's bulk file, one download); scores now use the newest year every figure has. **Done 2026-10-01** (PR #34; re-ingest from the bulk file in 29 s, 0 SEC requests): all three scores **27 → 56**, none 44 → 37; Piotroski 104, Beneish 71, Altman 138. Logged: a stale reported figure blocks its derivation (3 companies' Altman), and XOM's universe CIK has no annual history yet. See PROGRESS.md.
    - [ ] **F1b-3 — a stale reported figure no longer blocks its derivation.** Added 2026-10-01 at the user's request, from F1b-2's production check: Danaher, AT&T and T-Mobile last reported total liabilities in 2010–2015, and derivation ran only when a figure was never reported. Now the derived series wins when it reaches a newer year — used for every year, never mixed with reported values. **Built and tested locally; deploy and a production check next** (no re-ingest: the data is unchanged). See PROGRESS.md.
    - [ ] **F1c — risk-factor diffs computed when a new 10-K arrives**, and only then `GET /companies/:cik/risk-factor-diff` switched to stored-only — switching it earlier would mean no new diffs were ever made.
  - [ ] **F2 — Scaffold, home page, Vercel.** The `web/` app, its design system, a home page with instant search; the user creates the Vercel account and imports the repo; the proxy verified end to end; CI builds and tests `web/`.
  - [ ] **F3 — Company page.** Health scores as plain-English badges with "why", financial charts over the years, the risk-factor changes as added/removed lists; loading, empty and error states.
  - [ ] **F4 — "How it works" page.** The pipeline explained visually, with live stats from `GET /stats`.
  - [ ] **F5 — Polish and a real test.** Mobile layout, accessibility, page titles and link previews; then a non-technical person uses it unaided, and what confuses them gets fixed.
- [ ] Skip redundant SEC downloads — a filing that carries no financial data (e.g. bond prospectuses: 424B2, FWP) should not trigger a `companyfacts` re-download.
- [ ] Heartbeat blind spot — alert when poll cycles complete but fail to check companies (e.g. SEC blocking the host), not only when cycles stop.
- [x] README for the repository.
      **Done 2026-09-30, at the user's request ahead of steps 2–5** (for their portfolio). What it does, an architecture diagram, engineering highlights with measured numbers, tech stack, API reference, how to run and test, project structure, and an honest status table. Every claim was checked against the code or PROGRESS.md; three were corrected before handing over. See PROGRESS.md.

**Done when:** a backup taken in production has been restored into a fresh database with matching row counts; a deliberate outage delivers a real Slack message; a filing with no financial data causes no `companyfacts` request; a poll cycle in which every company check fails raises one alert; a non-technical person can find a company and read its scores without help; and the repository has a README.

---

## Phase 8 — India Extension (later)
Not started. Come back to this once Phase 6 (ideally Phase 7) is solid.
Full detail in `docs/india-first-project-roadmap.md` — NSE/BSE ingestion
with session/cookie handling, raw XBRL parsing, NSE-vs-BSE reconciliation,
and MCA Company Master Data enrichment, layered onto the same backend and
worker architecture built above.
