# End-to-end test plan: find the remaining issues

Builds on `qa/TEST_PLAN_AND_REPORT.md` (round 1) and `qa/ROUND2_QA_REPORT.md` (round 2). Those cover API validation, auth, pairing and holdings CRUD well. This plan targets what they did **not** reach, plus everything added since: holdings alerts, SEC EDGAR filings, Robinhood earnings dates, Top ideas, dip strategy, position monitor, crons, **morning briefing, bull-vs-bear debate, post-mortem tags, position sizing, buy-range bar and Log my buy, and the continuous-learning loop with its approval gate** (main @ ac0878a, migrations 0000 to 0011, routes `/api/briefing`, `/api/learning`, `/api/learning/decide`).

## Feature coverage matrix (every feature has an owner phase)
| Feature | Surface | Phases |
|---|---|---|
| Scanner / ranked ideas, US, BSE, FX | web, iOS | 1.3, 1.5, 2.1, 3, 4 |
| Top ideas on web dashboard | web | 3, 6 |
| Buy-range bar on each idea | web, iOS | 1.8, 2.5, 3, 4 |
| Log my buy (prefills a holding) | web, iOS | 1.8, 3, 4 |
| Analyze / research desk, charts | web, iOS | 2.5, 3, 4 |
| Bull vs bear debate, verdicts, code-checked claims, lease | worker, web, iOS | 1.9, 2.8, 3, 4 |
| Track record incl. debate verdicts | web, iOS | 1.9, 5.3 |
| Post-mortem tags | worker, web, iOS | 1.10, 5.3 |
| Position sizing | worker, web, iOS | 1.11, 2.4 |
| Holdings CRUD, undo, edit, stats | web, iOS | 0, 1.2, 2.4, 3, 4 |
| Holdings alerts (read change, raised stop, earnings, filing) | web, iOS | 1.1, 1.2, 3, 4 |
| SEC EDGAR filing check and cache | worker | 1.1, 2.3 |
| Earnings dates (Robinhood) | worker | 2.2 |
| Morning briefing (`/api/briefing`, web card, iOS Today tab) | web, iOS | 1.12, 3, 4 |
| Continuous learning, rule proposals, approval gate | worker, web, iOS Memory | 1.13, 3, 4, 6 |
| Memory tab | iOS, web | 3, 4 |
| Market trend card and strip | web, iOS | 3, 4 |
| Auth: Google, dev sign-in, sessions, CSRF | web | 3, 6 |
| iPhone pairing, Keychain, revoke | iOS | 4, 6 |
| Account deletion (all tables incl. learning and debate data) | web, iOS | 1.14, 4, 5.5 |
| Paywall, Stripe checkout and portal | worker | 6 |
| Desk display | iOS | 4 |
| Crons, rate limits, Workers AI fallback | worker | 1.3, 1.5, 5 |
| Legal pages, health, headers | worker | 0, 3, 6, 7 |
| Python engine and CLI/server | engine | 1.7 |

Ground rules (from your setup): test against the **live** worker and the **iPhone**, no local wrangler server, no `npm run deploy` without your go-ahead. Offline suites (harness, unittest, XCTest) are safe and need no deploy. Production writes use a dedicated test account only, and are cleaned up afterwards.

## Phase 0: Baseline gate (15 min, fully automatic)
Must be green before anything else. Anything red here is a regression since round 2.

| # | Command | Pass |
|---|---|---|
| 0.1 | `node scripts/build-site.mjs && npm run validate` (runs validate-site plus `check-debate`, `check-postmortem`, `check-learning`) | all four pass |
| 0.2 | `node qa/api-harness.mjs` | 139/139 |
| 0.3 | `node qa/api-harness-extended.mjs` | 66/66 |
| 0.4 | `cd engine && python3 -m unittest discover -s tests` | 11/11 |
| 0.5 | `xcodebuild test ... ModelDecodingTests` | pass (add alert, briefing, debate, learning models, see 1.4) |
| 0.7 | Confirm `main` equals `origin/main`, and `wrangler d1 migrations list DB --remote` shows 0000 to 0011 applied (read-only) | in sync |
| 0.8 | Confirm live is running current `main` (compare a new route such as `/api/briefing` returning 401, not 404) | current |
| 0.6 | `git status` and `git diff main --stat` | only the two local signing files uncommitted |

## Phase 1: Close the coverage gaps in the automated harness (highest yield)
The new code since round 2 has **no harness cases**. Write them in `qa/api-harness-alerts.mjs`, using the same in-process D1 shim.

1.1 **Alerts lifecycle** (`monitorHoldings`, `monitorLevels`, `monitorStatements`, `/api/holdings/alerts/seen`):
- Change of read (HOLD to WATCH to EXIT) creates exactly one alert; a second monitor run with the same state creates none (no duplicates).
- Raised stop alert fires only when the stop rises, never when it falls.
- Earnings alert fires once per earnings date, only within the warning window, and not for a closed position.
- Serious filing alert fires once per filing (dedupe by accession id).
- `alerts/seen` clears only the caller's alerts; another user's are untouched; bad or foreign ids return a clean 4xx.
- Closed, sold or removed holding stops generating alerts. Undo of a sell restores monitoring.

1.2 **Monitor under bad data**: snapshot missing, price 0 or NaN, stale price, market closed, symbol delisted, provider 429 or 5xx. Expect: no crash, no false EXIT alert, no alert storm, other holdings still processed (one bad row must not abort the batch).

1.3 **Request budget**: the free plan allows 50 outgoing requests per cron run. Assert each scheduled path (`refreshScan` US, BSE, FX; `refreshSharedHoldings`; EDGAR; earnings) stays under 50 with a full 20-position, multi-user load. This is the most likely place for a silent production failure.

1.4 **Contract tests web vs iOS**: feed real JSON from `/api/holdings`, `/api/discover`, `/api/holdings/stats` (including alerts, null earnings date, missing fields, new enum values) through `Models.swift` decoding. Add cases to `ModelDecodingTests` so a server-side field change cannot silently blank the app.

1.5 **Cron dispatch**: `scheduled()` with each of the 4 cron strings maps to the right market and honors `refreshInterval` (weekends, holidays, DST edge, outside trading hours).

1.6 **Migrations**: apply `drizzle/0000` through `0011` (0010 adds debate and post-mortem columns, 0011 adds `learning_rules` and `features`) in order on an empty DB, then on a DB with seeded round-2 data. Check no data loss, indexes exist, `0009` is idempotent. Confirm the live DB has all 12 applied (`wrangler d1 migrations list DB --remote`, read-only).

1.7 **Engine (Python)**: add tests for `clients.py` (536 lines, the largest, least tested), `governance.py` and `memory.py` edge cases: empty responses, provider errors, timeouts, malformed JSON, rate limits.

1.8 **Buy-range bar and Log my buy**: range math for edge cases (price below range, above range, equal to the bounds, missing levels, FX precision, BSE). Log my buy prefill carries symbol, market, price and date correctly, and the add still goes through normal validation.

1.9 **Debate** (`runDebate`, `verifyDebateClaims`, `ensureDebate`, `mergeDebate`, `logDebateVerdict`): claims citing facts not in the evidence are dropped (max 3 kept); judge output malformed or empty falls back cleanly; AI call fails or times out, so the ranking still renders without a debate; concurrent requests hit the lease once (no double AI spend, lease expires after a crash); stored debate merges onto the right item after a re-rank; verdict and `debate_leaning` logged once and shown in the track record; no input reflection or prompt injection from symbol names or filing text into the debate.

1.10 **Post-mortem tags** (`tagPostMortems`): each graded outcome gets exactly one sensible tag, rerun is idempotent, ungraded picks untouched, tags render on web and iOS, unknown tag from the DB does not crash the iOS decode.

1.11 **Position sizing**: sizes respect the 20-position cap, stop distance and any risk-per-trade rule; zero or negative stop distance, tiny or huge price, FX and BSE units; the number shown on web and iOS is identical for the same inputs.

1.12 **Briefing** (`/api/briefing`): reads stored scans only (no new provider calls, per the review-fixes commit); account with no holdings, one holding, 20 holdings; stale or missing scan; each market; anonymous gets 401 (or 402 when paywalled); response shape matches iOS `Models.swift`; AI failure falls back to a deterministic briefing; consistent with alerts and holdings shown elsewhere.

1.13 **Continuous learning** (`refreshLearning`, `evaluateLearningRule`, `learningReport`, `decideLearningRule`, `scripts/check-learning.mjs`):
- Too little data produces no proposal; a rule is proposed only when it passes the strict test (check for look-ahead bias and multiple-comparison luck with a random-noise dataset: expect zero proposals).
- Approval gate: only emails in `LEARNING_ADMIN_EMAILS` can approve or reject; no auth, a normal user, a mobile bearer, a forged email and an empty allow-list (must fail closed) all return 401 or 403.
- Decide twice, invalid `rule_key`, unknown key, already-decided rule: clean 4xx, no state corruption, `decided_by` and `decided_at` set correctly.
- Only APPROVED rules affect scoring (`loadActiveLearnedRules`); PROPOSED and REJECTED rules never do; penalty bounds respected; an approved rule can be reverted and the score returns exactly.
- Score and filter calibration does not change results for non-affected picks; `features` stored on new recommendations; old rows with null `features` do not break reports.

1.14 **Data deletion completeness**: account delete removes holdings, history, undo entries, alerts, sessions, pairing codes, and any per-user debate, briefing or learning data. Shared market data and shared learning rules stay intact. Check every table in `db/schema.ts` against the delete code so no new table (e.g. `learning_rules`, new columns) was missed.

## Phase 2: Data and logic correctness (manual review plus scripts)
Wrong numbers are worse than crashes in a finance app.

2.1 **Cross-source spot check**: for 10 US, 5 BSE and 3 FX symbols, compare price, stop and target shown by the app to an independent source (Yahoo or Google Finance). Flag deviations over 1% or stale beyond the declared interval.
2.2 **Earnings dates**: compare 10 upcoming dates from Robinhood against company IR pages. Check timezone and "after close" off-by-one-day handling.
2.3 **SEC EDGAR**: pick known 8-K, 10-K, 10-Q, NT 10-K, and a non-reporting ticker (ETF, foreign filer, newly IPO'd). Verify classification (serious vs routine), no false red-flag skips in the ranking, and graceful behavior when EDGAR is down or rate-limits (User-Agent header present).
2.4 **Hold/Watch/Exit and P&L math**: property test with randomized buy, increase, partial sell sequences. Invariants: shares never negative; weighted average cost matches an independent calculation; realized plus unrealized equals total; undo then redo restores state exactly.
2.5 **Multi-market**: BSE in INR and FX precision in every surface (web tiles B3 fix, iOS cards, alert text, stats totals). Never sum across currencies.
2.6 **Time**: market open/close and countdown in IST, ET, UTC. Check the DST transition weeks and US holidays (a closed market must not generate "stale price" exits).
2.8 **Debate and sizing sanity**: read 20 real debates end to end. Every cited number must exist in the stock's data; the judge's leaning must follow from the evidence; the verdict history in the track record must match what was shown at the time. Spot check 10 position sizes by hand.
2.7 **Backtest claims**: re-run `research/pattern-backtest/backtest11.mjs` and confirm the numbers quoted in any UI copy or docs match. Look for lookahead bias and survivorship bias in the earnings-in-hold analysis.

## Phase 3: Live web UI pass (built-in browser, ~45 min)
Use a fresh test account. Walk each, with console and network tabs open; every uncaught console error or non-2xx is a finding.
- First load anonymous: no 401 console error (known observation), dashboard and Top ideas render, market strip updates per market (known gap).
- Market switch US to India to Forex to US: cached or auto-load state (B4 fix), no flicker or stale scan.
- Sign-in (Google), refresh, sign-out, then back button must not show cached private data.
- New surfaces: morning briefing card, buy-range bar and Log my buy (opens a prefilled add form), debate panel on ranked ideas, track record with debate verdicts and post-mortem tags, position sizing, learning panel (approved admin sees approve and reject; a normal user sees none, and cannot call the endpoint directly).
- Holdings: add, increase, partial sell, close, undo, edit, remove; alerts banner appears, mark-seen persists after reload; empty, 1, 20 and 21st position states.
- Research form: valid, invalid, lowercase, whitespace, wrong-universe symbols; double-click submit (no duplicate request); slow network (throttle) and offline.
- Responsive: 320, 375, 768, 1440 px; dark mode; keyboard-only navigation; zoom 200%; basic accessibility (labels, contrast, focus order).
- Security spot check on live: CSP and headers, cookie flags, `HEAD /` returns 200 (R2-5 is fixed in code but **not yet deployed**: verify after deploy).

## Phase 4: iPhone pass (on device, ~60 min)
Cannot be automated here; follow this checklist and log device, iOS version, build.
- Install and launch: fresh install, disclaimer, pairing with web approval (happy path, expired code, wrong code, rate limit).
- Keychain: token survives app relaunch and reboot; deletion on revoke; behavior after reinstall.
- Each tab: **Today (briefing)**, Scanner (buy-range bar, Log my buy, debate, sizing), Holdings, Analysis, Memory (learned rules, admin approve gate), Account (debate verdicts, post-mortems), Market trend card and strip, TradingView chart (loads, handles offline, no crash on rotate).
- Alerts on iPhone match web for the same account at the same moment.
- Lifecycle: background and foreground refresh, airplane mode, flaky network, token revoked from web while app is open (must return to pairing, not spin), server 5xx and 402 handling.
- Desk display: flip clock, AM/PM, countdown, split layouts, Auto motion detection, Off/Auto/On (listed "not executable" in round 2).
- Account deletion from the app wipes server data; the web session for the same user is also dead.
- Accessibility: VoiceOver on holdings and alerts, Dynamic Type largest size, Dark Mode, small iPhone SE size in the simulator.
- Note: free-team install expires in 7 days; confirm the date before relying on it.

## Phase 5: Production behavior over time (needs real clock)
5.1 **Cron health**: over one full trading day (US) and one IST day, check D1 `scan` and `monitor` timestamps: every expected run happened, none overlapped, none exceeded limits. Look for gaps at :05 and :10 and the */15 windows.
5.2 **Failure drills (read the logs, don't break prod)**: `wrangler tail` during a cron run. Check for unhandled errors, 429 backoff, and Workers AI failure (does ranking fall back or serve stale, and is staleness shown to the user?).
5.3 **Pick grading and post-mortems** after 5 closes (round 2: not executed); also confirm one full learning cycle on real graded data and that the debate verdict history accrues. Seed a test account, close 5, confirm grading and the track-record page.
5.4 **Soak and load**: 50 to 100 concurrent anonymous `GET /api/discover` and `/api/holdings` with a test token, via a small script against live at low rate. Watch for 1015/429 from Cloudflare and D1 latency. Keep it short and polite since it is the live site.
5.5 **Account and data**: create test user, add data, delete account, then verify rows are gone in all tables, including alerts, sessions, undo entries, history.

## Phase 6: Security and abuse (extends round 2)
- Authorization matrix: every authed route called with no auth, web cookie, mobile bearer, revoked bearer, other user's ids; table of expected status.
- IDOR on alerts, undo, edit, and history ids (new endpoints since round 2).
- Alert text and symbol injection: stored XSS via symbol, device name and filing titles from EDGAR rendered in web and iOS.
- Secrets: grep git history and `dist/` for keys. Confirm no secrets in the app bundle, `PrivacyInfo.xcprivacy` matches actual data use.
- Dependency check: `npm audit`, pinned versions.
- Learning admin gate: see 1.13; also confirm the live deployment has `LEARNING_ADMIN_EMAILS` set to the intended emails only.
- Prompt injection: attacker-controlled text (symbol, EDGAR title, device name) reaching the debate, briefing or ranking AI prompts must not alter verdicts or leak other users' data.
- Paywall flag: with `PAYWALL_ENABLED=true` (harness only) re-run the gate tests, since every gated route including new ones (`alerts/seen`, `discover` Top ideas, `briefing`, `learning`, `learning/decide`) must be covered.
- Stripe flows: test mode only, with test keys, in a staging worker if you want to do this (see `docs/PAYWALL_SETUP.md`).

## Phase 7: Docs and release readiness
- `README`, `docs/*` match reality (cron schedule comment in `wrangler.toml`, TestFlight steps, Cloudflare setup).
- App Store checklist: privacy policy and terms pages live, disclaimer wording ("not investment advice"), no order submission claim (`/health` says read-only).
- Version and build numbers bumped; `project.yml` and `.pbxproj` in sync (and the local team ID kept out of commits).

## Reporting
Log every finding in `qa/E2E_REPORT.md`: ID, severity (Critical wrong money or data loss or auth hole, Medium wrong display or silent failure, Low cosmetic), repro, expected, fix location. Fix, add a regression case to the harness, re-run Phase 0.

## Suggested order and effort
1. Phase 0 and Phase 1 (about a day, mostly me, no deploy needed). Highest expected bug yield: alerts, monitor, request budget.
2. Phase 2 (half a day, mostly me).
3. Phases 3 and 4 (half a day, partly you on the phone).
4. Phases 5 to 7 (over a trading day and a day of review).
