# QA Round 2: independent pass (2026-11-05, main @ 43e69df)

Run: `node scripts/build-site.mjs && node qa/api-harness-extended.mjs` (67 new cases, in-process, no network or production writes).

## Baseline re-verified
| Suite | Result |
|---|---|
| `validate-site` | pass |
| API harness (round 1) | 139/139 (B1-B4 fixes hold) |
| Python engine unit tests | 11/11 |
| Live smoke (GET /health, /privacy, /terms, /support, /api/access, /api/track-record, 404, wrong-universe analyze -> 400, CSP header) | all as expected |

## New test cases: 55/67 pass, 12 flagged
Passed: unknown methods/routes (PUT/DELETE/PATCH/GET/OPTIONS), oversize body with and without Content-Length, array/null/non-JSON bodies, NaN/Infinity/negative/zero/empty/null amounts, SQLi and unicode symbols, 16-char symbol, non-trackable market (FX), unknown or object ids on sell/close/increase/undo/edit, analyze validation and no input reflection (XSS), pairing abuse (numeric/null/huge codes, HTML device name), bad/empty/Basic bearer, cross-origin CSRF with cookie, desk-display `spark` data contract.

## Defects
| ID | Sev | Finding | Repro | Suggested fix |
|---|---|---|---|---|
| **R2-1** | Medium | Impossible calendar dates accepted and stored. The date check is regex plus string compare only. | `POST /api/holdings/add {"symbol":"AAPL","shares":1,"price":100,"bought_at":"2024-13-45"}` returns 200. History then serves `"at":"2024-13-45T00:00:00.000Z"`, an invalid ISO timestamp. Also `2024-02-31`. | Validate with `new Date(boughtAt+"T00:00:00Z")` and check `toISOString().slice(0,10) === boughtAt`. Apply to `addHolding` (runtime.js:2100) and the edit path. |
| **R2-2** | Low | Trailing junk silently truncated: `bought_at:"2024-01-01zzzzzz"` is sliced to 10 chars and accepted. | as above | Reject if `String(body.bought_at).length !== 10`. |
| **R2-3** | Low | Type coercion lets `shares:[5]` and `shares:true` through (`Number([5])=5`, `Number(true)=1`). | `POST /api/holdings/add` with those values returns 200 | Require `typeof` number or string. Same for price. |
| **R2-4** | Low | No lower bound: `shares:1e-12`, `price:1e-9` accepted. Money math and display round to 0. | add with those values returns 200 | Enforce minimums, for example shares >= 0.0001 and price >= 0.0001. |
| **R2-5** | Low | `HEAD /` and `HEAD /health` return 404 (confirmed live). Uptime monitors using HEAD will report the site down. Carried over from Round 1 observations. | `curl -I https://intelligent-portfolio.portfolio-intelligence-site.workers.dev/` | Treat HEAD like GET. |

Design notes (not bugs): `remove` on an unknown id returns 200 `removed:true` (idempotent). `/health/` with a trailing slash is 404. `/health` always reports `data_source: "Robinhood"` even though IN and FX use another provider (cosmetic). Anonymous `/api/discover` returns 200 live, which is correct while `PAYWALL_ENABLED` is off.

## Not executable here (needs device or credentials)
Desk display on iPhone (flip clock, AM/PM, market countdown, split layouts, Auto mode motion detection, Off/Auto/On setting), Google OAuth, Stripe, crons and rate-limit backoff, pick grading after 5 sessions, VoiceOver, load/soak.

## Fix status
R2-1 to R2-5 fixed in `worker/runtime.js` (`toAmount`, `validPastDay`, `MIN_AMOUNT` = 0.0001 applied to add/increase/edit; HEAD answered like GET without a body). Round 1 harness 139/139, extended harness 66/66, validate-site passes. Not yet deployed.
