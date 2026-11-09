# E2E run 1: Phase 0 and Phase 1 (2026-11-09, main @ ac0878a)

Scope run: Phase 0 (baseline), live read-only smoke, and the automated part of Phase 1 for the features added after round 2. **Not yet run:** Phases 2 to 7 (data cross-checks, live UI, iPhone, over-time cron behavior, security extras, release docs), and harness coverage for debate internals, EDGAR parsing, position sizing, post-mortem tagging and the Python engine's `clients.py` (only the existing `check-*` scripts cover these).

## Results
| Suite | Result |
|---|---|
| build + `npm run validate` (validate-site, check-debate, check-postmortem, check-learning) | pass |
| API harness round 1 | 139/139 after updating 5 stale expectations (see F1) |
| API harness round 2 (extended) | 66/66 |
| **New** `qa/api-harness-new.mjs` (76 cases) | 76/76 |
| Python engine unittest | 11/11 |
| iOS XCTest ModelDecodingTests (iPhone 18 Pro simulator) | 9/9 |
| Remote D1 migrations | none pending (0000 to 0011 applied) |
| Live smoke (health, legal pages, track-record, access, HEAD / and /health, CSP and headers, anonymous briefing, anonymous learning and decide) | as expected |

New harness covers: briefing (no provider calls, shape, auth, method), paywall on new routes, learning admin gate (fail closed, mobile bearer refused, CSRF), learning state machine, learning proposals (pure noise proposes nothing, a real signal proposes only `PROPOSED`, never auto-activates, rerun idempotent, rejected not re-proposed, null features safe), alerts-seen isolation and id validation, dedupe index, account deletion across every `user_id` table with other users and shared tables intact, and the position monitor through the cron path (one alert per change, no duplicates, no alert on first read, stop never moves down, closed holdings ignored, bad row isolated).

## Findings
| ID | Sev | Finding | Action |
|---|---|---|---|
| F1 | Test debt | Round-1 harness cases HLD-23, 24, 25, 27, 32 were stale after intentional changes: US positions exit only on the daily Supertrend turning down (price under the stop or a 4H flip only WATCH, target reached stays HOLD), and holdings refresh is 15/30 minutes. Not code bugs. | Expectations updated in `qa/api-harness.mjs`. Worth a product check that you are happy a US position under its stop only shows WATCH until the daily close. |
| F2 | Low (hardening) | `evaluateHolding` defaults a missing daily trend to SHORT, so a snapshot lacking `daily_supertrend` (or `data_complete: false`) would raise an EXIT alert. Live data cannot hit this today, because `snapshotFromPayload` throws on thin history and the symbol never reaches the monitor. | Optional: skip evaluation when the daily trend is absent. |
| F3 | To verify | Live `/api/learning` reports `available:false` (no learning report stored yet). The refresh runs only on the US cron at minute 0 (13 to 21 UTC, weekdays); it was past 15:00 UTC when checked. Either the deploy of ac0878a landed after 15:00 UTC or the refresh is failing. | Re-check after the 17:00 UTC run; if still empty, tail logs for "Learning refresh failed". |
| F4 | Observation | `npm run validate` prints "scan refresh failed" lines (rate limit, S&P 500 list 404) because it makes live network calls. Harmless, but the check is not hermetic. | None needed. |

No Critical or Medium defects found in this run.

## Re-run
```
node scripts/build-site.mjs && npm run validate
node qa/api-harness.mjs && node qa/api-harness-extended.mjs && node qa/api-harness-new.mjs
(cd engine && python3 -m unittest discover -s tests)
```
