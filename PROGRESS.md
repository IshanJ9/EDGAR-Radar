# PROGRESS

Update this file after every completed step. Read it first, every session,
before doing anything else.

## Current status
**Phase:** 0 — Fundamentals
**Next step:** Phase 0, step 3 — GitHub repo created and code pushed

## Log
- [x] Phase 0, step 1 — Project scaffolded: `npm init`, TypeScript, `ts-node`, `@types/node`, `tsconfig.json` generated. (Re-verified/redone 2026-09-09 — the scaffold files were missing from disk despite being checked off, so `npm init`, dev-dep install, and `tsc --init` were re-run before continuing.)
- [x] Phase 0, step 2 — git initialized, `.gitignore` added (`node_modules/`, `dist/`, `build/`, logs, `.env`/`.env.*` except `.env.example`), first commit made (`3579ff7`).
- [ ] Phase 0, step 3 — GitHub repo created and code pushed
- [ ] Phase 0, step 4 — Script accepts a CIK argument and calls `data.sec.gov/api/xbrl/companyfacts/CIK{...}.json` with a descriptive User-Agent
- [ ] Phase 0, step 5 — Parse + print most recent Revenues / NetIncomeLoss, with tag fallback
- [ ] Phase 0, step 6 — Handle bad-CIK and no-XBRL-data cases without crashing
- [ ] Phase 0, step 7 — Verified against 5 real companies including a failure case
