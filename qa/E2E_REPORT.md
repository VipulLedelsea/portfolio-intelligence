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


# Phase 3 (live web, anonymous) findings, 2026-11-09

Checked on the live site in the built-in browser as an anonymous visitor. Signed-in flows (holdings, alerts, pairing, learning admin) were not exercised because they need a Google sign-in.

| ID | Sev | Finding | Status |
|---|---|---|---|
| **W1** | **Medium** | The Interactive trade desk signal chart is blank on every research run: price axis shows `$NaN` five times and the console logs about 185 SVG errors. Cause: `chart.levels` now includes the string field `exit_kind` (`"SUPERTREND_LINE"`), and `renderChart` maps every level through `Number()`, so the price scale becomes NaN. Verified with real AAPL data: scale was `NaN..NaN`, with the fix it is `327.99..370.87`. | **Fixed in source** (`dashboard.html`, `.filter(Number.isFinite)`), regression cases UI-01 and UI-02 added. **Not deployed.** |
| W2 | Low (copy) | Top ideas banner says "Ranked by an AI model" while every row says "not scored by the model". | Open: confirm which is true, then fix the copy. |
| W3 | Low | Every one of the 11 Top ideas shows "High confidence" although the dips show R:R 0.5 to target 1. Confidence appears driven by backtest, not the setup; may mislead. | Open: product call. |
| W4 | Low | Research desk shows "LONG · PASS" with "risk veto active" and heading "Why this is not currently a cleared idea". PASS reads as approval. | Open: wording. |
| W5 | Low | Scanner track record shows "WORST LOSS +31.29%" when there are no losses. | Open: show a dash when there are no losses. |
| W6 | Low (carried) | Anonymous load logs a 401 console error; "Refresh grades" shows while signed out. | Open, known. |

Passed: market switch US to India to Forex and back restores the US scan (B4 fix holds); invalid ticker shows "Enter a valid ticker symbol"; lowercase ticker accepted; CSP blocks `eval`; briefing card renders three markets with timestamps; learning panel shows the expected empty states.

## Update after deploy (16:14 UTC)
- W1 deployed (worker version affa1061) and verified live: axis labels `$378 to $321`, 46 candles, no NaN, annotations and levels drawn. The edge kept serving the old page for about 8 minutes after the deploy, so allow time before verifying a web deploy.
- F3 resolved: `/api/learning` now returns a stored report (0 graded picks so far, as expected). The hourly job works.

# Phase 3b: signed-in web checks (2026-11-09, live, Google sign-in)

Used the account's own session. Its 2 real open holdings (EBAY, CBOE) were snapshotted first and verified unchanged at the end. All test positions used a separate symbol (KO) and were removed.

Passed: signed-in UI state (sign-out, pair button, briefing with holdings summary); add (lowercase symbol normalised), list with decision, increase (weighted average 2@50 + 2@60 = 4@55), partial sell (realized P&L correct), oversell rejected, undo (non-latest entry refused, latest restored shares, voided entry kept in audit), edit latest buy, close (idempotent), remove, 6 invalid-input rejections (negative, zero, tiny, bad symbol, future date, impossible date); Log my buy prefills symbol, price, market and date and scrolls to the form; buy-range bar and "IN BUY RANGE" correct; position sizing verified by hand (10000 at 1% risk, stop distance 11.48: 8 shares, about $1701, about $92 at risk); sizing inputs persist in the browser; pairing dialog (8-character one-time-code input, 10 minute expiry text); learning panel reports `can_decide: true` for the signed-in admin and 403 for decide after sign-out; sign-out kills the server session (holdings 401) and Back shows a signed-out page.

| ID | Sev | Finding | Status |
|---|---|---|---|
| **S1** | Medium | **Removing a position leaves its partial-sell residue.** A partial sell moves the sold shares into a separate closed lot that shares the position's chain id. `removeHolding` deleted only trades whose `holding_id` matched, so the lot's SELL trade (and the closed lot row) stayed in history and in realized P&L after the user removed the position. Reproduced live (a voided KO sell stayed in history) and offline (RMV-02 to RMV-04). | **Fixed in source** (`removeHolding` clears the chain's lots and trades, same user only); RMV-01 to RMV-05 added. **Not deployed.** One ghost row from my own test (a voided KO sell) remains in your history until the fix is deployed; removing its old chain id afterwards clears it. |
| **S2** | Low (wrong label) | Holdings status line said "auto-updates about every 30 minutes (markets closed)" while the US market was open. The label threshold was still `>= 600` from when intervals were 5 and 10 minutes; the real intervals are now 900 and 1800 seconds, so it always read "markets closed". The iPhone app has the same stale check and also names the wrong intervals ("every 10 minutes", "every 5 minutes"). | **Fixed in source** on web and iOS; UI-03 and UI-04 added. Web needs a deploy; the iPhone needs an app reinstall. |
| S3 | Observation | Top ideas debates exist for ranks #2, #3 and #5 but not for #1 (CVX), re-checked a few minutes apart. Debates are generated in the background for the top N within a time budget, so this may be a lag after a re-rank, or a failed run. | Open: check the worker log for "Debate failed for" and see if #1 gets a debate on the next hourly run. |
| S4 | Observation | Adding the same symbol twice creates two separate positions instead of warning or merging. | Open: product call. |

Not exercised live: alert creation (needs a real change of read on a held stock; covered offline by MON-01 to MON-14), approving a learning rule (none proposed yet), completing a pairing (needs the app's code).

## Update after second deploy (worker version dcbbbc1c)
- S2 verified live (label now follows the 900/1800 s interval).
- S1 verified live on the real account: add KO 4 shares, partial sell 1 (history 2 rows, 1 closed lot, realized 232.07 over 3 trades), remove, and everything returned exactly to baseline (0 KO rows, 0 closed lots, realized 212.07 over 2 trades). EBAY 15 and CBOE 7 unchanged throughout.
- The earlier ghost row from the pre-fix test was already gone when checked, so no manual cleanup was needed; cause not determined.

# Phase 4: iPhone pass on the iOS simulator (2026-11-09, iPhone 18 Pro simulator, build from main @ ccd4c80)

Run by driving the simulator against the live site, paired to the real account. Not covered here (needs the physical phone): Keychain across reboot, real flaky networks, desk display motion detection, VoiceOver, revoke-while-open, offline.

Passed: unpaired Holdings shows a clear "Connect an account" prompt; pairing from the app (one-time code shown, approved on web, app connected on its own within seconds); a wrong code on the web is refused; Today briefing matches the web (same ideas, same holdings summary); Holdings label fix works on iOS (after the close it reads "auto-updates every 30 minutes, markets closed", matching the Market closed pill); Scanner shows ranking, buy-range bar and "In buy range" badge consistent with web; Memory tab renders the track record and learning text.

| ID | Sev | Finding | Status |
|---|---|---|---|
| I1 | Low | Scanner track record on iOS also shows "WORST LOSS +31.29%" with no losses (same as web W5, "AVG LOSS" already shows a dash). | Open, same fix as W5. |
| I2 | Low (wording) | A wrong pairing code on the web says "That pairing code expired", same text as a truly expired one. Probably deliberate (no code oracle) but misleading. | Open: product call. |
| I3 | Low (to confirm) | Right after first launch, unpaired, the Today tab showed "Loading today's briefing" for over a minute and did not change before pairing. The briefing is readable without an account, so unpaired users may see an endless spinner. Could also be slow simulator rendering (UI repaints took several seconds). | Open: retest on the physical phone. |
| I4 | Low | iOS Top ideas header says "Ranked by AI" while rows are "not scored by the model" (same as web W2). | Open with W2. |

Note: the account now has 5 open holdings (CBOE, EBAY, CME, NUE, CVX), so 3 were added after the earlier signed-in test. Not touched by the tests.

# Fix round (2026-11-09), not yet deployed
Harnesses after fixes: new 93/93, round 1 139/139, extended 66/66, `npm run validate` pass, iOS app builds.

| ID | Resolution |
|---|---|
| W5, I1 | Fixed. `worst_loss_pct` now counts only losing picks, so it is a dash when there are none (web and iOS both read this field). FIX-01. |
| W2, I4 | Fixed (web copy). When some ideas were not scored by the model, the Top ideas line now says those were ordered by rules. FIX-02. iOS chip text unchanged ("Ranked by AI" with per-row notes). |
| W4 | Fixed. Research desk shows "NOT A TRADE" instead of "PASS". FIX-06. |
| W6 | Fixed. Signed-out visitors no longer call `/api/memory` (no 401 console error) and no longer see the Refresh grades panel. FIX-05. |
| I2 | Fixed. Pairing error now reads "not valid or has expired". FIX-04. (The iOS copy of the expired message is unchanged.) |
| I3 | Fixed (cause confirmed in code: guests have no token, so the briefing never loaded). Today now shows a Connect an account prompt for guests. FIX-03. |
| F2 | Fixed. The monitor no longer raises EXIT when the daily trend is missing or the snapshot is flagged incomplete. MON-08 and MON-09 are now counted cases. |
| W3 | Not changed: "High confidence" comes from the AI ranking; whether to cap it by R:R is a product call. |
| S3 | Not changed: needs worker logs ("Debate failed for") to tell lag from failure. |
| S4 | Not changed: duplicate symbol adds are a product call (warn, merge, or allow). |
