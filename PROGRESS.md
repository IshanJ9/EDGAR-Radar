# PROGRESS

Update this file after every completed step. Read it first, every session,
before doing anything else.

## Current status
**Phase:** 0 — Fundamentals
**Next step:** Phase 0, step 6 — Handle bad-CIK and no-XBRL-data cases without crashing

## Log
- [x] Phase 0, step 1 — Project scaffolded: `npm init`, TypeScript, `ts-node`, `@types/node`, `tsconfig.json` generated. (Re-verified/redone 2026-09-09 — the scaffold files were missing from disk despite being checked off, so `npm init`, dev-dep install, and `tsc --init` were re-run before continuing.)
- [x] Phase 0, step 2 — git initialized, `.gitignore` added (`node_modules/`, `dist/`, `build/`, logs, `.env`/`.env.*` except `.env.example`), first commit made (later squashed to `55d6cf3` to drop a commit trailer the user didn't want).
- [x] Phase 0, step 3 — GitHub repo created (`IshanJ9/EDGAR-Radar`), remote `origin` added, pushed to `Main`.
- [x] Phase 0, step 4 — `index.ts` accepts a CIK CLI arg, pads it to 10 digits, and calls `data.sec.gov/api/xbrl/companyfacts/CIK{...}.json` with `User-Agent: EDGAR Radar (<email>)` read from `.env` via `dotenv` (see `.env.example`). Verified against CIK 320193 (Apple) — 200 response, printed `entityName`. Also fixed: `typescript` had resolved to the new v7 native compiler, which isn't yet supported by `ts-node`; pinned to `^5.7` to fix.
- [x] Phase 0, step 5 — `mostRecentFact()` reads `facts.us-gaap.<tag>.units.USD`, tries `Revenues` then falls back to `RevenueFromContractWithCustomerExcludingAssessedTax` (and `NetIncomeLoss` then `ProfitLoss`), picking whichever candidate tag has the most recent `end` date rather than just the first tag present — needed because e.g. Apple stopped reporting under `Revenues` after 2018 and switched tags, so "first tag that exists" alone returned 2018 data. Verified against Apple, Tesla, Microsoft — all print current-quarter Revenue/NetIncomeLoss with the correct tag and period. Also fixed number formatting (`toLocaleString('en-US')`) after it defaulted to Indian digit grouping.
- [ ] Phase 0, step 5 — Parse + print most recent Revenues / NetIncomeLoss, with tag fallback
- [ ] Phase 0, step 6 — Handle bad-CIK and no-XBRL-data cases without crashing
- [ ] Phase 0, step 7 — Verified against 5 real companies including a failure case
