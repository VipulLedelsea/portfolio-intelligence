# Portfolio Intelligence

A read-only market research tool: a Cloudflare Worker (API, scans, cron jobs) with a D1 database, a single-page web dashboard, a Python research engine, and an iPhone app. It never places orders and is not investment advice.

## Layout
- `worker/runtime.js` — the Worker: API routes, scans, holdings monitor, debate, learning, pairing.
- `engine/portfolio_intel/dashboard.html` — the web page (embedded into the Worker by `scripts/build-site.mjs`).
- `engine/` — Python engine and its unit tests (`cd engine && python3 -m unittest discover -s tests`).
- `ios/` — the iPhone app (XcodeGen `project.yml`).
- `db/`, `drizzle/` — schema and D1 migrations.
- `qa/` — the end-to-end test plan (`E2E_TEST_PLAN.md`), reports (`E2E_REPORT.md`) and harnesses.
- `docs/` — Cloudflare, paywall and TestFlight setup.

## Everyday commands
```bash
node scripts/build-site.mjs && npm run validate                      # build and quick checks
node qa/api-harness.mjs && node qa/api-harness-extended.mjs && node qa/api-harness-new.mjs   # API harnesses
npm run db:migrate                                                   # apply D1 migrations (remote)
npm run deploy                                                       # build, validate, wrangler deploy
```
Note: the `npm run validate` step makes live network calls, so it can print "scan refresh failed" lines without failing.

## Release checklist
See `qa/E2E_TEST_PLAN.md` (Phase 7) and `docs/TESTFLIGHT.md`. Keep the local iOS signing team out of commits.
