# Differentiation plan (draft)

Goal: beat Zacks, Seeking Alpha Quant, Danelfin and similar apps on trust and usefulness, while staying cheaper. Current price is $14.99/month (see `PAYWALL_SETUP.md`).

Competitor pricing figures come from third-party aggregators and are unverified. Check each vendor's own page before using them in marketing.

## What competitors decide on (and what we copy)

| Source | Core signal | What we take |
|---|---|---|
| Zacks Rank | Analyst earnings-estimate revisions (agreement, magnitude, upside, surprise) | Revisions factor |
| Seeking Alpha Quant | Value, Growth, Profitability, Momentum, EPS Revisions, graded against sector peers | Sector-relative percentile scoring |
| Danelfin | ML over technical, fundamental and sentiment features, with subscores and explanations | Subscores and "why" breakdown |
| Morningstar | Fair value, moat, uncertainty | Uncertainty haircut |

## Workstream 1: Public, graded track record (build first)

Why first: the data already exists. The `recommendations` table in `db/schema.ts` stores entry, stop, targets, status, grade, `rawReturnPct`, `strategyReturnPct`, `targetHit` and `stopHit`, per user.

Steps:
1. Add an aggregate endpoint in `worker/runtime.js`, for example `/api/track-record`. It computes, over settled recommendations: count, hit rate, average return, average win vs. average loss, stop-hit rate, and the worst drawdown. It exposes no per-user data.
2. Include open and failed calls in every number. No cherry-picking, no deleting.
3. Add a "Track record" screen in iOS (new view next to `AnalysisView.swift`) with a plain disclosure: past results do not predict future results.
4. Optional: a public web page built by `scripts/build-site.mjs`.

Done when: the screen shows live aggregates and a test confirms counts match the table, including losses.

Risks: small sample sizes early on. Show the sample size next to every percentage.

## Workstream 2: Deterministic factor layer

Why: today's fundamentals and sentiment scores come from LLM prompts (`engine/portfolio_intel/agents.py`) and are unvalidated. Competitors lead with quantified, repeatable factors.

Licensing findings (from third-party sources, unverified; confirm with each vendor):
- FMP, Finnhub, Massive (formerly Polygon) and EODHD restrict their standard or personal plans to non-commercial use. Showing data to paying app users needs a commercial or redistribution license, usually by quote.
- Alpha Vantage has no consensus estimates per one comparison site.
- Commercial pricing is unknown and probably high relative to $14.99/month revenue at small scale.
- Our current market data comes from Robinhood. Its licensing for a commercial app is unresearched and needs checking before App Store launch.

Phasing by data source:
- Phase A (no new license): momentum and relative strength from price history we already fetch.
- Phase B (likely free, confirm EDGAR fair-access rules): quality and value factors (ROIC, margins, FCF yield) from SEC EDGAR filings.
- Phase C (deferred): estimate revisions, once subscriber revenue justifies a commercial license. Get written quotes first for "display to paying mobile subscribers", including storage, caching and attribution limits.

Steps:
1. Get vendor quotes for Phase C and decide later. Do not block Phases A and B on it.
2. Add a `FactorClient` in `engine/portfolio_intel/clients.py` that computes 6 to 12 month relative strength (Phase A) and later ROIC, margins and FCF yield (Phase B), with estimate revisions added only in Phase C.
3. Compute each metric as a percentile within the stock's sector. The scanner already carries sector labels from the S&P 500 constituent feed.
4. Produce subscores: Technical (existing Supertrend/ADX), Fundamental, Revisions, Risk. Add an uncertainty haircut for volatile or thin-data names.
5. Feed the scores into `_score_candidate` in `engine/portfolio_intel/engine.py` and the scanner rows, and keep Supertrend as the mandatory entry trigger.
6. Backtest before labeling anything "predictive". Compare factor-ranked picks against the S&P 500 and the current scanner over past data. If it does not help, ship it only as context, not as a score.
7. Show the "why" in the app: which factors raised or lowered each rating.

Done when: unit tests in `engine/tests/test_engine.py` cover the percentile math with fixed data, and a backtest report is saved.

Risks: data licensing and cost, and revisions may already be priced in, so keep expectations modest.

## Workstream 3: Holdings-aware guidance

Why: few retail apps tie ideas to what you already own. We already have `holdings` and `holding_trades`, and the engine's portfolio review step.

Steps:
1. Compute sector and single-name concentration from open holdings.
2. Flag scanner ideas that overlap heavily with existing exposure.
3. Add per-holding status (stop breached, setup flipped, target reached), shown in `HoldingsView.swift`.
4. Optional: push alerts when a held name's status changes.

Done when: a holding that crosses its stop or flips direction shows an alert, covered by a test.

Risks: push notifications need an APNs setup and a privacy review.

## Pricing and growth (small, decide separately)

- Add a free tier with a few delayed scanner results.
- Add an annual plan in the $120 to $149 range.
- Keep the "research, not advice" disclaimer on every screen with a rating, and avoid "beats the market" claims.

## Suggested order

1. Workstream 1 (days, no new data cost).
2. Workstream 2 provider decision, then the build and backtest.
3. Workstream 3.
4. Pricing changes once the track record is live.

## Open issues (noted 2026-11-05)

1. **Forex shows no viable setups.** Live check: the FX scan was last generated 2026-11-04 09:11 UTC, over a day stale although the cron runs hourly, so refreshes are probably failing silently (`refreshScan` errors are swallowed and trigger a 15-minute back-off). Separately, all 13 pairs were filtered out: 3 by daily conflict, 7 by weak ADX, 3 late. Diagnosed 2026-11-05 with `wrangler tail`: the refresh dies with "Worker exceeded CPU time limit" (about 2.0 s CPU). Forex hourly bars run 24 hours a day, so six months of history is far more bars than India's, and the Supertrend/ADX math is too heavy. Local CPU for the forex scan: about 1.3 s at 6 months, 0.77 s at 3 months, 0.54 s at 2 months (India's, which succeeds in production, is about 1.0 s at 6 months). A 3-month lookback was deployed but the live refresh still hit the limit, so lookback was not the cause. A CPU profile found the real hotspot: `localDate` built a new `Intl.DateTimeFormat` for every hourly bar and took about 80% of the compute. Caching one formatter per time zone cut local CPU from 0.77 s to 0.31 s for forex and 0.73 s to 0.25 s for India, with identical output on 4,167 sample timestamps. Fix committed, not yet deployed. After deploying, confirm the live forex scan refreshes, then re-check the ADX gate.
2. **Market sentiment reads "down".** The trend label is the Supertrend of one index (SPY for US) on daily and 4H. It lags: on 2026-11-05 SPY read DOWN on both timeframes while 71% of S&P 500 stocks were in daily uptrends. The label does not use the day's price change. India read UP and forex MIXED, so not every market was down. Fix by combining the index with breadth, and show the day's change next to the label.
3. **Trade only with the market direction?** Recommendation: use it as a soft gate (a "with market" or "against market" tag plus a score adjustment), not a hard filter, and only after the market-state measure in item 2 is fixed. Record the market state on each logged pick so the track record can show whether alignment actually helps.

### Forex filter review (2026-11-05)

Replayed 62 days of hourly data for the 13 forex pairs (159 signal events). Each event is graded over the next 5 days. One window, correlated pairs and small samples, so treat as directional only.

| Gate | Events per week | Win rate | Avg return |
|---|---|---|---|
| Current (aligned, ADX >= 20 and rising, fresh) | 0.8 (7 events) | 71% | +0.28% |
| ADX >= 20, not required to be rising | 3.5 | 42% | -0.29% |
| No ADX gate | 5.9 | 51% | -0.10% |
| Current but without daily alignment | 4.2 | 72% | +0.40% |

- Few forex entries is expected, about one a week.
- The rising-ADX requirement helps; relaxing it made results worse.
- The forex risk floor is wrong: stops sit at the stock floor of 1.25% (median) while the median 5-day move is 0.78%, so target 1 is reached only 3% of the time. Forex needs its own, lower floor.
- Open question: whether the daily-alignment rule helps forex, which needs a longer history to judge.

Forex risk floor fixed in code (2026-11-05, not yet deployed): the minimum stop distance is now 0.25% of price for forex and stays 1.25% for stocks. Replaying the same events: median stop distance 1.25% -> 0.46%, first target reached 3% -> 32% of the time, and the current-gate setups went 0 of 7 to 6 of 9 reaching target 1 (3 hit the stop). Still a small, single-window sample.
