# QA Test Plan & Execution Report: IntelligentPortfolio

Date: 2026-11-05 · Build under test: `main` @ 772f61f (worker rebuilt from source) · Live: `intelligent-portfolio.portfolio-intelligence-site.workers.dev`

## 1. Scope & approach
Features covered: public/system endpoints, security headers, paywall gate, web auth/sessions, iPhone pairing, holdings (add/increase/sell/close/undo/edit/remove/stats, hold-watch-exit logic, per-user isolation, 20-position cap, US+BSE), scanner/analyze/memory validation, account deletion, dashboard UI (markets, research form), iOS model decoding, Python engine.

Method: (a) **API harness** `qa/api-harness.mjs` runs the built Worker in-process on an in-memory SQLite D1 shim with seeded market data (no network, no dev server, no production writes); (b) **live smoke** (read-only GETs, one public `discover` read, one anonymous `analyze`-style call per case); (c) **browser UI checks** on the live site; (d) existing suites (Python unittest, `validate-site`, iOS XCTest).

## 2. Results summary
| Suite | Result |
|---|---|
| API harness (139 cases) | **136 pass / 3 fail** (all 3 = real bugs below) |
| Python engine unit tests | 11/11 pass |
| `npm run validate` (static/ESM/gate checks) | pass |
| iOS XCTest (ModelDecodingTests, iPhone 18 Pro sim) | 6/6 pass |
| Live smoke (health, legal pages, headers, access, track-record, discover, 404, anon 401, forged headers, /auth/dev) | all as expected, except bug B2 |
| Live UI | market switching, invalid ticker, research run: works; bugs B3, B4 |

## 3. Test cases (ID → expectation). ✔ pass · ✘ fail (bug) · ○ not executed
**System/public:** SYS-01 health read-only ✔ · SYS-02 dashboard served ✔ · SYS-03/04 security headers & CSP ✔ · SYS-05 privacy/terms/support ✔ · SYS-06..08 unknown routes/methods 404 ✔ · SYS-09 `/api/grade` disabled ✔ · SYS-10 track-record ✔ · SYS-11/12 access shape, no customer_id leak ✔ · SYS-13 access?session_id unauth → 401 ✘ (B1)
**Paywall:** PAY-01 gated endpoints 402 when anonymous ✔ · PAY-02 no Stripe key state ✔ · PAY-03 checkout disabled ✔ · PAY-04 checkout needs sign-in ✔
**Auth:** AUTH-01 `/auth/dev` off outside dev ✔ (also live 404) · 02 cookie flags HttpOnly/SameSite ✔ · 03 session recognised ✔ · 04/05 forged/malformed cookie rejected ✔ · 06 CSRF cross-origin 403 ✔ · 07 same-origin ok ✔ · 08 forged `oai-*` headers ignored ✔ (also live) · 09 Google not configured → clean error ✔ · 10 bad callback → `/?signin=failed` ✔ · 11/12 logout invalidates ✔
**Mobile pairing:** MOB-01..22 code format, name sanitising, hashed storage, pending/approve/claim lifecycle, wrong secret, malformed code, lowercase code, double-claim 409, expired 410, rate-limit 429, bearer auth, revoke, delete-requires-mobile ✔ (22/22)
**Holdings:** HLD-01..70 auth, input validation (symbol, shares, price, date, market, body size, bad JSON), decision engine (HOLD / WATCH×2 / EXIT×2 / TAKE_PROFIT), level ordering, P&L math, totals, weighted-average increase, partial/full sell, close idempotency, stats/history ordering, undo/edit chain rules, audit trail, remove, **user isolation**, mobile==web data, 20-open cap, BSE ₹ and per-market totals ✔ (70/70)
**Scanner/analyze/memory:** SCN-01..03, 06..09 ✔ · SCN-04/05 analyze symbol outside BSE/forex universe should be 400 ✘ (B2)
**Account deletion:** DEL-01..03 wipes only caller's data, token dead ✔
**UI (live):** market dropdown US/IN/FX loads correct scan & copy ✔ · invalid ticker shows "Enter a valid ticker symbol" ✔ · research run renders decision/chart tiles ✔ · tile currency/precision ✘ (B3) · return-to-US behaviour ✘ (B4, low)
**Not executed (needs credentials/device/time):** Google OAuth round-trip · Stripe checkout/portal/webhook-free subscription check with real keys · iOS UI flows on device (pairing screen, holdings, scanner, Keychain) · cron triggers & rate-limit backoff · pick grading after 5 closes · TradingView embed · Python engine with a live OpenAI key · accessibility/VoiceOver · load/soak.

## 4. Bugs found (all four fixed and re-verified: harness 139/139, validate-site passes)
| ID | Sev | Summary | Repro | Expected |
|---|---|---|---|---|
| **B3** | **Medium** | Analysis desk Entry/Current/Stop tiles hardcode `$` and 2 decimals. Forex EURUSD shows `$1.12 / $1.12 / $1.11` while price is `1.12400`; TCS shows `$2493.00` while header shows `₹2493.00`. Key trade levels lose currency and (for forex) the precision that makes them meaningful. | Live site → Forex → EURUSD → Run full research (also India → TCS) | Use `fmtP()` like the header: market symbol and decimals. Source: `dashboard.html` submit handler (`'$'+Number(d.entry_price).toFixed(2)`). Check the target/scenario boxes too. |
| **B2** | Low | `/api/analyze` returns **502** for "Choose one of the … symbols" (wrong-universe symbol). Client error reported as server error; breaks monitoring/retry logic. Confirmed live. | `POST /api/analyze {"symbol":"AAPL","market":"IN"}` | 400. `runtime.js:2522` throws without `status: 400` (holdings add at :2078 does it right). |
| **B1** | Low | `/api/access?session_id=…` catch block ignores `error.status`: unauthenticated → 502 (should be 401), also masks 402/403/400 from checkout verification. | `GET /api/access?session_id=bad` | Preserve `error.status` (`runtime.js:2451-2459`). |
| **B4** | Low (UX) | Inconsistent US behaviour: on first load US results auto-show, but switching India→Forex→US leaves an empty page ("Ready to scan…") until "Scan" is clicked. | Change market dropdown away and back to US | Restore last US scan (cached) or auto-load, consistent with first load. |

Observations (not filed as bugs): anonymous page load logs a 401 console error (a gated call fires before sign-in); market-trend strip stays on S&P 500 when India/Forex is selected; `HEAD /` returns 404 (only GET handled), which may upset uptime monitors using HEAD.

## 5. Re-run
```
node scripts/build-site.mjs && node qa/api-harness.mjs   # 139 API cases (3 currently fail = B1, B2)
cd engine && python3 -m unittest discover -s tests
cd ios && xcodebuild test -project IntelligentPortfolio.xcodeproj -scheme IntelligentPortfolio -destination 'id=<simulator UDID>'
```
