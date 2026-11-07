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

Track-record grading fixed (2026-11-05, not yet deployed): graded picks now exit at the first of the stop, 90% of the way to target 1, or the fifth completed daily close (a bar touching both counts as a stop), and the reported return is the exit return. Before, the return was always the fifth-close change, so stop-outs were uncapped and early target hits were not credited. PASS calls are still measured to the fifth close. The 90% near-target share is a single constant (`NEAR_TARGET_FRACTION`) and has not been tuned by backtest. Still to do: a near-target state in the holdings tracker, aligning the scanner's 4H-based targets with the holdings tracker's daily-based ones, and a replay of the real 4H-plus-daily scanner.

Market sentiment label fixed in code (2026-11-05, not yet deployed): the trend state now blends the index Supertrend with breadth. When the index reads down but 60% or more of stocks are in daily uptrends, it reads MIXED ("index trend down, most stocks still up"); when the index reads up but 40% or fewer are up, it also reads MIXED ("narrow rally"). The original index reading is kept as `index_state`, today's index change is added as `day_change_pct` and shown as a chip on the web and in the app, and forex no longer shows a "share of stocks up" figure, since pairs are not stocks. The 60/40 thresholds are judgment calls, not tuned. Still to do: use the market state as a "with market" tag on setups, near-target state for holdings, and aligning scanner and holdings targets.

Dip scan added as a second scanner mode (2026-11-06, not yet deployed): US only, long only. A stock qualifies when its last completed daily close is above the 200-day average and RSI(2) is under 10; sharper dips rank higher. Ideas show only while the market is under stress (SPY down 1.5% or more over 5 days, or 6% or more of scanned stocks in a dip). Levels: stop 2 daily ATRs, targets 1 and 2 ATRs, exit by the fifth close. Evidence and caveats: `research/pattern-backtest/README.md`. Every pick is logged under its own strategy (`SUPERTREND`, `DIP`, `DIP_WAIT` for dips seen while the gate was closed) and the track record reports each separately, so live results decide which scanner stays. Deploy order: run `npm run db:migrate` (adds `recommendations.strategy`, migration 0007) before `npm run deploy`. The daily history request grew from 6 months to 1 year to get a 200-day average, so watch Worker CPU time and scan payload size after deploy.

Levels and position monitor (2026-11-06, not yet deployed): every US stock level now uses one set of daily-ATR levels: stop 2 ATR below (changed from 4 ATR on 2026-11-06 because a stop four times farther than target 1 is too much risk per share to show), target 1 at +1 ATR (reached about half the time in 5 days), target 2 at +2 ATR (about one time in five). Tests showed the earlier 2R levels were reached 1% to 4% of the time, and farther targets pay slightly more but are rarely reached (`research/pattern-backtest/README.md`). US holdings are watched by a protective ratchet (migration 0008, `holdings.stop_level` and `holding_level_events`): once the price trades 1 ATR above the buy price the stop moves up to the buy price and the targets move out to +3 and +4 ATR; on any completed day SPY falls 1.5% or more the stop moves up to 1.5 ATR under that day's close. Levels only ever move in the safe direction, every change is logged with a reason and shown in the Holdings detail, and the cron job applies it every five minutes in market hours without the app open. Backtests say this lowers average losses at a cost of about 0.03% to 0.06% of average return per trade; it is protection, not extra profit. Forex and India holdings keep fixed levels.

Chart reference lines (2026-11-06, not yet deployed): the stop and targets stay ATR-based (`research/pattern-backtest/README.md`, ml_chart.py: swing-low stops and prior-high targets did worse). The chart context is shown beside them and sets no level: 20-day low, 10- and 20-day highs, 20-, 50- and 200-day averages. They are drawn on the Signal chart (when near the visible prices), listed under the analysis levels and in the Holdings detail, and each dip pick opens a daily chart with its entry, stop, targets and reference lines.

Time limit changed from 5 to 10 trading days (2026-11-06, not yet deployed): new scanner picks and dip picks are logged with a 10-day window, and a pick is now graded as soon as it touches its stop or target 1 instead of waiting for the window to close, so most settle in a few days (average about 3.5 days in tests). Picks already logged keep their 5-day window. Backtests (`research/pattern-backtest/README.md`, ml_horizon.py and ml_longhold.py): with the same levels a 10-day limit earns about +0.55% per trade against +0.44% at 5 days, at 71% against 65% wins and about the same return per day held, with larger average losers (-4.5% against -3.2%) because slow trades that drift down now run to the stop. Holdings are not time-limited.

Supertrend picks and US holdings now exit on the daily Supertrend line (2026-11-06, not yet deployed): the focus strategy is the Supertrend. Tests on Supertrend entries (`research/pattern-backtest/README.md`, ml_st_support.py and ml_st_exits.py) found the short-hold levels (2 ATR stop, 1 ATR target, 10 days) have no edge (-0.07% per trade), while holding until a day closes under the daily Supertrend line, with no target, earned about +1.6% to +1.8% per trade (about 34 days held, 45% wins, average winner +11% against average loser -6%), and every early-warning exit lowered that. Changes: Supertrend picks log the daily Supertrend line as their stop, the targets are optional profit zones only, and picks are graded when a daily bar closes under the line (filled at the next open) with a 120-day safety limit (picks with a window of 60 days or more use this rule; older picks keep their old rule); US holdings exit on the same daily break, show the 4-hour turn down, ADX under 20, price under the 20-day average and price under the line intraday as warnings, never signal take-profit, and the protective level follows the line upward and never down. This replaces the breakeven and market-tightening ratchet and the 2 ATR stop for US holdings. The dip scan is unchanged and secondary. Forex and India keep fixed levels.
