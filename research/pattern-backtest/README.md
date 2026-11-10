# Chart-pattern backtest (research only, not shipped)

Run from this folder: download the S&P 500 constituent list, then:

```bash
curl -s https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv -o sp500.csv
node fetch.mjs          # 5 years of daily bars from Robinhood -> bars.json
node backtest.mjs 20    # hold period in trading days (try 10, 20, 40)
```

Signals fire at the close; entry is the next open; 0.1% cost per side; one open trade per stock; rules are fixed up front, not tuned. Strategies: 52-week high (with and without volume), bull flag (12% and 20% poles), cup and handle, daily Supertrend flip with ADX. Controls: any stock-day, above the 200-day average, and any stock up 20%+ in 20 days.

## Results (2022-11 to 2026-10, 503 stocks, 2026-11-05)

- **Cup and handle:** no edge. Below the above-200-day baseline at every hold, and about zero in the later half.
- **Bull flag (20% pole):** looks strong (+1.5% at 20 days, +4.4% at 40 days over baseline) but the no-pattern control "up 20%+ in 20 days" did better (+3.1% and +7.0%). The flag adds nothing beyond having surged.
- **52-week high + volume:** +0.35% to +0.75% over baseline at 10 to 20 days, about +0.1% at 40 days, and beat the baseline in only about half of months.
- **Daily Supertrend flip + ADX:** strong in the first half, about zero in the second. Regime-dependent.
- **Major caveat, survivorship bias:** the universe is today's S&P 500, which includes stocks that were added because they rose. The surge control returning about 7% in 40 days (roughly 60% a year) is a symptom. Momentum and breakout results are inflated, so none of the positive results can be trusted without a point-in-time universe.

## Short-hold rerun with exits (backtest2.mjs, 2026-11-05)

`node backtest2.mjs 5 1.5` holds at most 5 trading days, with a 1.5 ATR stop and exits at 50%, 75%, 90% or 100% of target 1 (target 1 = 2R, R = max(2 ATR, 1.25%), as in the holdings tracker).

- No strategy shows a clear edge: means are about -0.4% to +0.15% per trade after 0.2% costs, against a baseline near 0%.
- Target 1 is reached in only 1 to 4% of 5-day trades; 50% of the way is reached about 17 to 21% of the time. A 2R target is too far for a one-week hold.
- Exit rules cannot create profit from random entries. Only entries with real predictive power can, and none of these showed any beyond the survivorship-biased "up 20%" control.

## Near-target fraction sweep (backtest3.mjs, 2026-11-05)

`node backtest3.mjs 5` uses scanner-like levels (R = max(2 x 4H ATR, 1.25%), stop at 1R, target 1 at 2R, with the 4H ATR approximated as 0.55 of a daily ATR) and exits at 50% to 100% of target 1.

- Differences between fractions are a few hundredths of a percent per trade, well inside noise. Lower fractions raise the win rate (about 51% at 50% vs 45% at 90%) but not the average return.
- 90% is at or near the best mean in every set tested and is reached in 17 to 20% of 5-day trades, so it is kept. It is not a source of edge: every entry set, including the daily Supertrend approximation, averaged about zero or below after costs.

## Weakness (outlook) exits (backtest4.mjs, 2026-11-05)

`node backtest4.mjs 5` adds an exit at the next open when the outlook turns bad during a 5-day hold, on top of the 1R stop and 90%-of-target exit. Rules tested: daily Supertrend turns down, close below the 5- or 10-day average, two down closes in a row, and a bearish close on heavy volume.

- None helped. Changes in average return were within about 0.05% either way, and on the uptrend baseline the 5-day-average rule cut the average from -0.06% to -0.12% and the win rate from 43% to 37%, while exiting 58% of trades.
- Over one week, stock moves tend to partly reverse, so selling on short-term weakness mostly sells dips.
- Not tested: the holdings tracker's 4H Supertrend exit, because long 4H history is not available from the data source.

## Point-in-time rerun (backtest5.mjs, 2026-11-05)

Membership dates come from `fja05680/sp500` (`sp500_ticker_start_end.csv`, saved as `members.csv`). Signals only count on dates when the stock was actually in the index, and 54 former members that still trade were added (`fetch2.mjs`, `fetch3.mjs`). 56 former members (acquired, merged or delisted) have no data in the source, so some bias remains.

- Bias was real: every result fell. At 20 days, the "up 20%" control went from +1.25% to +0.64% and the 20% bull flag from +1.26% to +0.20%; at 5 days the control fell from +0.32% to +0.05%.
- At a 5-day hold with the near-target exit, no pattern or entry set averaged better than +0.02% per trade (baseline -0.06% to -0.12%). Cup and handle, both flags and 52-week highs without volume were negative.
- The only positive reading was the 20% flag at a 20-day hold with the near-target exit (+0.34%, 152 trades, first half -0.06%, second half +0.75%), which is outside the one-week goal and unstable.
- Decision: chart patterns are not added as trade signals. Revisit only through live track-record data.

## Round two: the FOREX.com patterns (round2.mjs, 2026-11-05)

`node round2.mjs stocks` (point-in-time S&P 500) and `node round2.mjs forex` (13 pairs, `fetch_fx.mjs`). Pivot-based detectors for double top and bottom, head and shoulders and its inverse, ascending, descending and symmetrical triangles, rising and falling wedges, bull flag, and cup and handle in both the after-uptrend and after-downtrend versions. Exits use the pattern's own stop (where it fails) and measured-move target, with holds up to 5 and 20 days, an optional 2-session confirmation, and a scanner-like ATR exit. Every trade is compared with 25 random entries that have the same direction and the same stop and target distances in ATR units.

- **Stocks:** pooled across all patterns, results were worse than matched random entries on a 5-day hold (-0.15% per trade, t -4.4) and no better at 20 days. Long patterns trailed random entries; short patterns were about even. Individual positives at a 20-day hold (confirmed ascending triangle, double bottom, bull flag, t about 2) are within what 50 comparisons produce by chance.
- **Bull flag** was the one consistent positive against random days, in every configuration and both halves. Against a control of stocks that had just surged 20%, it shrank to +0.1 to +0.35% per trade (t 0.3 to 1.1), so it is the surge, not the flag.
- **Forex:** 181 pattern trades over 5 years, pooled -0.15% per trade, worse than matched random entries. Nothing works there, though samples are tiny.
- **Not tested:** support and resistance bounce trades, and intraday patterns.

## Edge search: pullbacks, momentum and wider exits (backtest6.mjs, 2026-11-06)

`node backtest6.mjs` runs five entry sets through six fixed exits, with and without a "SPY above its 200-day average" filter, on the point-in-time S&P 500 (557 symbols, 2022-11 to 2026-11, 0.2% round-trip cost). Every entry set is compared with any stock-day run through the same exit and filter. 60 configurations, so a few look good by chance; read the pattern across configurations, not the single best row.

- **Current entry (daily Supertrend flip + ADX):** about 500 trades, no edge on any exit. At 5 days it averages -0.24%; the second half is worse than the first on every exit of 10 days or longer.
- **Stop width:** the 1.5 ATR stop is hit by about 28% of 5-day trades and hurts the baseline itself (-0.04% with the stop, +0.01% without). A 3 ATR stop on a 10-day hold is hit by about 15%.
- **Buy-the-dip (RSI2 < 10 above the 200-day average, and the sharper RSI2 < 5 and -5% in 3 days version):** the only entry that beat the baseline on all 12 exit and filter combinations, with the edge positive in both halves. Sharper dip, 5-day hold, no stop: +0.43% per trade, 53% wins, PF 1.26, n = 2,175, t 3.7. With a 21-day hold and 3 ATR stop: +1.08% per trade, PF 1.33.
- **52-week high:** negative on every exit.
- **Momentum top decile (12-1 month, monthly):** positive at 10 days (+0.43 to +0.71%) but flat or negative at 21 days and with a trailing stop, and the first half is about zero. Unstable.
- **Caveats:** the 56 former members with no price data (mostly acquired, a few bankrupt) are missing, which flatters dip-buying. The window is mostly a rising market. Trades overlap in time, so t-values are optimistic. No portfolio-level drawdown or position sizing is modelled.

### Robustness check of the dip entry (backtest7.mjs, 2026-11-06)

Main case: RSI2 < 5, close below its 5-day average, down 5% in 3 days, above the 200-day average, 5-day hold, no stop (n = 2,175, +0.43% per trade against +0.01% for any stock-day).

- **By year the edge is uneven:** 2023 was negative (-0.25% vs baseline), 2022 had only 40 trades, and 2024 to 2026 carried it (+0.34% to +0.70%).
- **Overlap removed (weekly buckets):** mean weekly edge +0.35%, t = 2.0 (not 3.7), positive in 59% of 191 weeks.
- **Costs:** the edge over baseline holds, but the absolute mean falls to +0.23% at 0.2% per side and to about zero at 0.3% per side. Fine for liquid large caps, thin if fills are poor.
- **Thresholds:** every one of nine nearby settings beat baseline (+0.14% to +1.04%); deeper dips did better (-8% in 3 days: +1.05%, n = 666).
- **Tail:** trimmed mean +0.37%, median +0.34%, 5th percentile -7.8%, worst trade -24%. The missing delisted names would need to lose an extra 9% on 5% of trades to erase the edge.
- **Portfolio view (10 slots of 10%, 5-day holds):** 1.32x over 3.9 years (7.4% a year), max realized drawdown 16.8%. SPY buy and hold did 1.85x (16.9% a year) with a 19.0% drawdown. The dip strategy did not beat simply holding SPY in this window.
- **10-day hold with 3 ATR stop:** +0.66% per trade (baseline +0.19%), 13% stopped, 5th percentile -10%, worst -27%.

### Lower take-profit and wider stop grid (backtest8.mjs, 2026-11-06)

Target 0.5 to 2 daily ATR, stop 1.5 to 5 daily ATR, holds of 5 and 10 days, on the current entry, two dip entries and any stock-day (typical ATR is 2.6% to 3.4% of price).

- **Win rate responds, expectancy barely does.** On the current entry at a 5-day hold, moving from a 2 ATR target and 1.5 ATR stop to a 0.5 ATR target and 4 ATR stop lifts wins from 47% to 73%, but the average per trade only moves from -0.18% to -0.09%, because the average loss stays near -3.5% against small wins. The best cell (1 ATR target, 4 ATR stop) is -0.04%, and it is +0.18% in the first half and -0.24% in the second.
- **Stops beyond about 3 ATR add nothing.** The 4 and 5 ATR rows match or barely beat 3 ATR in every table.
- **A very low target costs money on entries that have an edge.** On the dip entries, a 0.5 ATR target gives 74% to 77% wins but only +0.05% to +0.21% per trade; a 1 ATR target with a 3 to 5 ATR stop gives +0.41% to +0.46% at 62% to 63% wins; at 10 days a 2 ATR target does best (+0.49% to +0.59%).
- **Exits cannot rescue an entry with no edge.** Any stock-day, run through the same grid, ranges from -0.14% to -0.05% at 5 days.

## Machine learning test (ml_experiment.py, 2026-11-06)

Needs a Python environment with numpy, pandas, scikit-learn and scipy. Walk-forward on the point-in-time S&P 500 (540 symbols, 477,596 stock-days, 39 price, volume, market and cross-sectional-rank features). Each 3-month test block is predicted by a model trained only on data at least 6 days earlier; the target is the 5-day net return minus that day's universe average. 12 folds, out of sample from 2023-11 to 2026-10.

- **No stock-picking edge from price and volume features.** Rank information coefficient: gradient boosting -0.002 (t -1.0 on non-overlapping dates), ridge +0.008 (t 0.4), shuffled-label control -0.006. Decile returns are flat (top minus bottom decile -0.03%).
- **Top-N weekly portfolios are noise.** The shuffled-label control's top 10 (+0.41% per trade) beat the real gradient-boosting top 10 (+0.13%) and matched SPY, which shows how little short portfolio numbers say without the IC.
- **Meta-labeling the dip rule** (can a model pick the better dips?): 19,622 out-of-sample signals, top-third minus bottom-third +0.13% for gradient boosting, -0.13% for ridge, -0.03% for a random score. Rank correlation with outcomes between -0.03 and +0.02. Nothing usable.
- **Most useful features** were long-horizon momentum rank and market trend, with tiny importance.
- **Caveats:** four years, large caps, daily bars only, the 56 missing delisted names, no intraday or fundamental data.

### Volatility and loss-risk model (ml_risk.py, 2026-11-06)

Same walk-forward setup as above, forecasting the next 5-day high-low range relative to each stock's own ATR, then using the forecast for stops, sizing and filtering. 357,319 out-of-sample stock-days; 19,650 dip entries (RSI2 < 10 above the 200-day average).

- **Risk is only modestly forecastable beyond ATR.** R-squared gain over ATR alone: +0.066 for a linear model, +0.062 for gradient boosting. Rank correlation with the actual range 0.541 (ATR) to 0.559.
- **A flat 3 ATR stop is uneven:** it is hit 3% of the time on the calmest predicted-risk decile and 9% on the wildest (6.2% overall).
- **ML-scaled stops add almost nothing** at the same stop-out rate: mean +0.076% for both, worst-5% average -8.87% vs -9.00%. A 3 ATR stop is mostly a disaster stop: it moves the worst-5% average from -10.07% (no stop) to -9.00% and the mean by 0.02%.
- **Inverse-risk sizing** on dip entries cut weekly volatility (2.13% to 1.95%) and the worst week (-7.6% to -5.9%), with inverse ATR doing as well as the ML forecast.
- **Skipping the riskiest 20% of dips (by ML predicted range) raised the mean from +0.196% to +0.271%** (+0.074% per trade, date-clustered 95% interval +0.019% to +0.131%), positive in each of 2023 to 2026. The riskiest 20% averaged -0.10%. Filtering on ATR% alone did not work (-0.089%), and random removal did nothing. The 80% cut was chosen after looking at several, so treat it as a lead, not a result.
- **Dip profits concentrate in market-wide selloffs:** days with 40+ dip signals averaged +0.34% per trade, other days +0.03%. Equal-weight weekly portfolios of dip trades were negative (-0.16% a week).

### Adaptive stops and targets, and market-regime gating (ml_adaptive.py, 2026-11-06)

Path-aware 5-day simulation (stop checked first, gaps handled) on out-of-sample dip entries, 2023-11 to 2026-10. Policies are re-fit on data before each 3-month block.

- **Adaptive exits do not beat a fixed pair.** Today's 3 ATR stop / 1 ATR target: +0.093% per trade (60% wins) on RSI2<10 dips and +0.456% (63%) on sharp dips. Re-fitting the best fixed pair each fold: +0.064% better (95% interval -0.010 to +0.134) on regular dips and -0.020% on sharp dips. Per-regime bucket (market trend x market volatility x stock volatility): +0.005% and +0.005%. ML quantile stop and target: -0.036% and -0.137%, worse.
- **The best pair does shift a little by regime** (stop 4 ATR, target 2 ATR beat 3 and 1 in every market regime, by +0.08% to +0.15%), but it is the same pair everywhere, so a single widening is enough; no adaptive scheme is needed.
- **The market regime matters for whether to trade, not how.** Dip trades with today's exits: ungated +0.09% (regular) and +0.46% (sharp). Taking them only when SPY fell 1.5%+ over 5 days: +0.66% (69% wins, 95% interval +0.31 to +1.00, 4,754 trades on 100 days) and +1.14% (72% wins, 95% interval +0.60 to +1.67, 1,010 trades on 91 days). Market-wide washout (top third of days by share of stocks in a dip state): +0.21% and +0.82%. The skipped trades averaged about zero or negative (-0.09% and +0.01% for the 5-day-drop gate). Calm-market dips lost money (-0.22%). Positive in every year with enough trades.
- **How solid:** the gated trades are clustered in 46 to 110 distinct weeks, so the independent evidence is smaller than the trade counts suggest. Without the three busiest weeks the means are +0.51% and +1.05% (5-day-drop gate). The gates were chosen after seeing that dips cluster in selloffs, so treat this as a strong lead to be confirmed on live picks, not proof.

### Dynamic stop and target rules (ml_monitor.py, 2026-11-06)

Fixed rules, no fitting. Path-aware 5-day long trades, levels move only after a close and the stop only ever moves up. 13 policies on three entry sets: dips while SPY was down 1.5% in 5 days (7,270 trades), all dips (25,492), and any stock-day (161,643, like a holding bought at random). Base case is a static 4 ATR stop and 2 ATR target.

- **No rule that moves levels raised the average return.** Every policy was at or below the static base on all three sets, by -0.004% to -0.082% per trade; many 95% intervals (date-clustered) sit below zero.
- **They trade return for a smaller loss tail.** Breakeven stop after +1 ATR: average loss -2.30% vs -2.97% and 5th-percentile trade about the same, but the win rate falls from 58% to 50% and the mean by 0.06%. A 2 ATR trailing stop cuts the 5th-percentile trade from -9.27% to -7.74% and costs 0.08% per trade.
- **Closest to free:** tighten the stop when SPY falls 2% in a day (-0.005% to -0.004%, about 5% of trades touched) and from day 3 pull the stop to 2 ATR under the close (-0.004% on random stock-days, -0.026% on stressed dips).
- **Today's levels lose to 4 and 2.** The 3 ATR stop / 1 ATR target now in the app averaged 0.06% to 0.07% less per trade than 4 / 2 on all three sets (interval below zero on two of them), although it wins more often (59% to 66% vs 51% to 58%).

### Target distance (ml_monitor.py targets, 2026-11-06)

Stop 4 ATR with a target at 0.75 / 1 / 1.5 / 2 / 3 ATR, on stressed dips, all dips and random stock-days: the target is reached 59% to 67% / 48% to 55% / 30% to 35% / 18% to 21% / 6% to 7% of the time, and the win rate is 65% to 72% / 59% to 66% / 53% to 60% / 51% to 58% / 50% to 57%. Average return rises with distance up to about 2 ATR (for example +0.52% at 1 ATR and +0.56% at 2 ATR on stressed dips) and is flat beyond. A 4 ATR stop beats a 3 ATR stop at every target by 0.02% to 0.03% per trade, with 2% instead of 5% of trades stopped out. The app now uses target 1 at 1 ATR and target 2 at 2 ATR.

### Conservative stops (ml_monitor.py conservative, 2026-11-06)

Stop 1.5 to 4 ATR against targets 1, 1.5 and 2 ATR. Tighter stops cost little return and shrink the tail: on stressed dips, stop 2 ATR / target 1.5 ATR averaged +0.49% against +0.56% for 4 / 1.5, with 13.6% of trades stopped out instead of 2.1% and the worst 5% of trades averaging -8.0% instead of -9.2%. Stop 1.5 ATR was stopped out on 21% to 28% of trades and gave up more. The app now uses stop 2 ATR, target 1 at 1 ATR and target 2 at 2 ATR, which puts reward equal to risk at target 2. The protective ratchet was tested at a 4 ATR starting stop and has not been re-tested at 2.

### Chart-based levels (ml_chart.py, 2026-11-06)

Stops under the 3-, 5-, 10- and 20-day low (minus 0.25 ATR, kept between 1 and 3 ATR), targets at the 5-, 10- and 20-day high or the 5-, 10- and 20-day average (kept between 0.5 and 3 ATR), against ATR levels, on stressed dips, all dips and random stock-days (5-day holds, same entries and costs as above).

- **Stops under swing lows lost on every set.** On stressed dips every chart stop averaged 0.07% to 0.25% less per trade than a 2 ATR stop. A dip puts the stock at or near a fresh low, so a swing-low stop sits only about 1 ATR (2.5% to 3% of price) below the entry and was hit by 30% to 39% of trades, against 14% for 2 ATR. The 20-day low was the least bad, and still lost 0.07%.
- **Targets at prior highs are far and rarely reached.** Reached 10% to 16% of the time at 2.4 to 3 ATR, with no gain in return. Targets at moving averages were close (about 1 ATR) and reached about half the time, but returned less.
- **Hybrids that use the chart only to pull levels in did not help either.** A stop at the closer of 2 ATR and the 20-day low cost 0.02% to 0.1% per trade; a 2 ATR target capped just under the 10- or 20-day high changed the return by under 0.02% on dips (the prior high is almost never closer than 2 ATR after a dip), and about +0.01% on random stock-days.
- **A more balanced fixed pair:** 2 ATR stop / 2 ATR target (reward equals risk) beat 2 / 1 on all three sets (+0.034%, +0.043% and +0.001% per trade), with the target reached about 21% of the time instead of 54%.

### Which dips are better? (ml_select.py, 2026-11-06)

Quintile analysis of 5-day net returns among dip entries (RSI2 < 10 above the 200-day average): 7,270 trades while SPY was down 1.5% in 5 days, and 25,492 in any market. 12 characteristics on 2 sets is 24 comparisons, so about one 95% result is expected by chance; read the pattern, not single cells.

- **Leaders that pull back do better.** The best fifth by 63-day return before the dip beat the worst fifth by +0.94% per trade under stress (95% interval +0.34 to +1.69) and +0.35% in any market (+0.03 to +0.70). Strong 12-1 month momentum (+0.78% and +0.46%) and a wider cushion above the 200-day average (+0.70% and +0.34%, intervals above zero) point the same way. After removing each day's average dip the effects shrink to about half for momentum and the 200-day cushion and to about zero for 63-day return (+0.10%): part of it is which days the signals fire.
- **Deeper dips and more volatile stocks bounced more.** Deepest fifth by 3-day drop: +0.6% to +0.7% over the shallowest in both sets (interval excludes zero in any market). Highest fifth by ATR% of price: +0.57% in any market (interval above zero), +0.72% under stress (interval spans zero).
- **No separation from:** volume surge, gap on the signal day, the day's range, RSI(2) level, and whether the drop was the stock's own or its sector's or market's.
- **Consistency by year is mixed** for every characteristic (several flip sign in 2024 or 2025). Treat these as leads to confirm on live picks, not rules.

### Stock-selection factors for any entry (ml_factors.py, 2026-11-06)

Daily cross-sectional rank IC of 21 stock-level factors (momentum, reversal, trend, volatility, size proxy, volume, ADX, RSI, sector momentum, stock vs sector, a gap-on-volume earnings-style event proxy) against the next 5, 10 and 21 trading days of net returns; 540 point-in-time S&P 500 stocks, 2022-11 to 2026-11, all stock-days, not just dips.

- **No factor shows reliable skill.** Every IC is within +-0.034 and every t-statistic (non-overlapping dates) is under 1.7. The largest: ATR % of price (+0.034 at 21 days), distance above the 52-week low (+0.029), dollar-volume size proxy (+0.027), 12-1 month momentum (+0.023). All are the high-beta, large-cap tilt of a rising market rather than stock-picking skill, and each is positive in only 3 or 4 of 5 years.
- **Short-term reversal, trend and earnings-style gaps carried nothing:** 1-, 5- and 21-day returns, distance above the 50- and 200-day averages, sector momentum, and the gap-on-volume event proxy all had |IC| under 0.012 (except momentum above).
- **The sample is too short to find a small edge.** A true IC of 0.02 would give about t = 1.4 at a 21-day horizon over four years (about 50 non-overlapping periods). Longer history (10 to 20 years across several market regimes) and fundamental or earnings data are needed to test stock-selection factors properly.

### IBD / CAN SLIM checklist, price-based parts (ibd_test.py, 2026-11-06)

Point-in-time S&P 500, 2022-11 to 2026-11, next-open entries, 0.1% cost per side, one position per stock. Tested: L (IBD-style relative-strength rating 80+, weighted 12-month performance ranked 1 to 99 among the universe), N (stage-2 uptrend: close above the 50-, 150- and 200-day averages in order and within 15% of the 52-week high), S and a base breakout (close over the 20-day high, within 5% of it, volume 1.4x the 50-day average, 25-day base no deeper than 20%) and M (SPY above its 50- and 200-day averages with the 50-day rising). Not testable here: C and A (earnings growth) and I (institutional sponsorship), which need fundamentals data. IBD sell rules: stop 7.5% under the buy, take profit at +20%, sell on a close under the 50-day average, 60-day limit.

- **Leaders did better than random stocks, over weeks, with the exits that let winners run.** Stop 7.5%, sell under the 50-day, no profit target: any stock-day +0.12% per trade (6.6 days held); RS 80+ +0.57% (12.4 days; 95% interval of the gain +0.08 to +0.83); stage-2 leaders near their highs +0.85% (20.8 days; +0.05 to +1.56). Win rates of 29% to 40%, average winner +12.8% against average loser -4.1%. Positive in 2023, 2024, 2025 and 2026; 2022 was negative on 122 trades.
- **With IBD's +20% profit target the edge shrinks** (stage-2 leaders +0.46%, interval +0.00 to +0.77): the target cuts the winners that carry the result.
- **The classic base breakout on volume added nothing** over the leader filter (+0.37%, interval -0.66 to +1.23, 739 trades, negative in 2025 and 2026).
- **The market-direction filter (M) did not help in this sample:** it lowered the average (stage-2 leaders +0.60% with it, +0.85% without) and the interval spans zero.
- **As a 5 to 20 day swing it fails:** with a 20-day limit, stop 7.5% and +10% target, leaders (+0.41%) and stage-2 leaders (+0.21%) did no better than any stock (+0.44%).
- **Size of the gain:** about +0.04% per day held for stage-2 leaders against +0.02% for any stock, in a period when the S&P 500 returned roughly 17% a year. It is a modest tilt toward leaders, not a stand-alone edge.

### How long to hold (ml_horizon.py, 2026-11-06)

Stop 2 ATR, target 1 ATR, time exit at the close of day N, N from 1 to 10, same entries and costs as above. Stressed dips (7,270 trades): max hold 1 day -0.06% per trade; 2 days +0.20% (1.9 days held on average); 3 days +0.30% (2.5); 4 days +0.41% (3.1); 5 days +0.46% (3.5); 7 days +0.52% (4.1); 10 days +0.55% (4.6). Return per day held peaks at 4 to 5 days (+0.135% per day) and falls at 2 to 3 days (+0.11%) and at 10 days (+0.12%). A one-day hold loses on every set, because the 0.2% round-trip cost and the noise swamp the move. Across all dips and random stock-days the same shape holds at lower levels. A 5-day limit already ends trades early on average, because the 1 ATR target is reached about half the time, usually in 2 or 3 days (3.5 days held on average).

### Longer holds: 10 to 60 days (ml_longhold.py, 2026-11-06)

Stops and targets in daily ATRs, time exit at the close of day N, 5 to 60 days, on stressed dips (7,678 trades), all dips (24,484) and any stock-day (94,911, every 5th day). Overlapping signals in one stock are kept. Over the same period the S&P 500 returned about +0.036% per day (about 9% a year, including the 2022 decline).

- **The same 2 ATR / 1 ATR levels with a longer limit earn more per trade at about the same return per day.** Stressed dips: 5 days +0.44% per trade (65% wins, 3.4 days held, +0.127% per day); 10 days +0.55% (71% wins, 4.6 days, +0.119% per day); 20 days +0.60% (75% wins, 5.1 days, +0.119% per day); beyond 20 days nothing changes. Cost: the share stopped out rises from 13% to 20% (10 days) and 24% (20 days), and the average loser grows from -3.2% to -4.5% and -5.5%, because slow trades that drift down now run to the stop instead of being closed small at day 5.
- **Holds of 40 to 60 days earn the most per trade but mostly from market drift.** Stop 3 ATR with no target: stressed dips +0.83% at 10 days, +1.40% at 20, +2.14% at 40, +2.52% at 60 (44% wins, average loser -7.6%); any stock-day with the same exit +0.21%, +0.58%, +1.12%, +1.48%. The dip advantage over any stock shrinks from +0.55% (2 / 1 ATR, 20 days) to about +1.0% over 40 more days, and return per day held falls from +0.12% to +0.06%.
- **A trailing stop gives most of the gain with smaller losers.** Trail 3 ATR, no target: stressed dips +1.36% at 20 days, +1.59% at 40 (44% wins, average loser -5.1%, 78% of trades ending on the trail); trail 2 ATR +1.13% at 20 days with a -3.7% average loser, but a 44% win rate.
- **Consistency by year:** the stressed-dip results with 2 / 1 ATR levels are positive in each of 2022 to 2026 (+0.1% to +1.4% at 20 days). The long no-target holds are volatile (2022 and 2023 near zero or negative in places, 2024 and 2026 strong) and depend on a rising market.

### Support-based stops (ml_support.py, 2026-11-06)

Support found from the chart at the signal close: the nearest confirmed swing low (lowest of 3 bars each side, within 120 days) at least 1 ATR below the close; a touch cluster (two or more swing lows within half an ATR of each other); the 50- and 200-day averages when 1 ATR or more below. Stop = support - 0.25 ATR, never closer than 1 ATR. Three ways to act on it: a touch (intraday) stop, a close breakdown (the day CLOSES under the level and the exit is the next open), and a skip filter (no trade when the support is more than 3 ATR below the entry). 1 ATR target, 10-day limit, next-open entries, 0.2% costs. Stressed dips 7,791 trades, all dips 26,125, any stock-day 99,986 (every 5th day). Controls: ATR stops with the same close-breakdown exit, and a placebo that hands the stops' distances to the wrong trades.

- **The location of the stop does not matter; the exit rule and the trade filter do.** Placing the stop at the chart's support instead of at a distance chosen without reference to the chart (placebo, same distances shuffled across trades) changed the average by only +0.00% to +0.02% per trade in the always-trade versions on every set. Stops at swing lows lost nothing and gained nothing against a 2 ATR stop on a touch basis (+0.013% stressed dips).
- **Acting on a CLOSE under the level helps, with any stop.** A 2 ATR stop on a close basis (exit at the next open) beat the same stop on a touch basis by +0.06% (stressed dips), +0.06% (all dips) and +0.04% (any stock-day), and cut stop-outs from 20.5% to 14.8% on stressed dips. The cost is a worse tail: the average of the worst 5% trades goes from -9.0% to -10.6%, because the exit fills at the next open after the breakdown.
- **The skip filter is the real chart signal.** Taking a trade only when a support cluster sits within 3 ATR below it, with the close-breakdown exit, averaged +0.67% on stressed dips (3,800 trades, 49% of signals) against +0.52% for the current 2 ATR touch stop and +0.60% for the placebo; +0.18% on all dips (12,350) against +0.08% and +0.12%; +0.09% on any stock-day (62,213) against -0.00% and +0.01%. The gain over the placebo is +0.07%, +0.06% and +0.08% per trade, the same sign on every set. A swing-low version showed the same direction but smaller (+0.08%, +0.02%, +0.03% over placebo).
- **What the filter does:** the average stop sits 1.9 to 2.0 ATR below the entry (4.5% to 4.8% of the price), the win rate is 66% to 73%, 15% to 20% of trades stop out, and the average loser is -4.5% to -4.9%.
- **Earlier result explained:** the N-day-low stops in ml_chart.py lost because a dip leaves the stock at a fresh low, so the lowest low is the dip itself and sat about 1 ATR below the entry. Real swing-low and cluster supports at least 1 ATR below, and a skip rule for supports that are too far, avoid that.

### Supertrend entries: which exit works? (ml_st_support.py, 2026-11-06)

Daily Supertrend(10,3) with the app's ADX gate (ADX 14 at least 20 and rising over 5 days), point-in-time S&P 500, next-open entry, 0.2% round-trip cost. FLIP = the Supertrend turns up that day (530 signals); FRESH3 = turned up within 3 days (4,248); UPTREND = Supertrend up with the ADX gate, any day, every 5th day (17,097, a control that shows what an exit rule does without a fresh signal). The 4H Supertrend the app uses to time the entry has too little history to test.

- **The short-hold levels the app uses today have no edge on Supertrend entries.** FLIP with a 2 ATR stop, 1 ATR target and 10-day limit: -0.07% per trade (65% wins, 4.8 days), negative in 2024, 2025 and 2026. A support stop on a close breakdown, with or without the skip filter, did not change that (-0.08% and +0.04%).
- **Supertrend is a trend-following entry: it only pays when it is allowed to run until the trend breaks.** Exit when a day closes under the Supertrend line (fill at the next open), no target, 60-day limit: FLIP +1.61% per trade (503 trades, 45% wins, average winner +11.3% against average loser -6.2%, 33.8 days held, +0.048% per day). By year: 2023 +3.5%, 2024 +0.7%, 2025 +1.7%, 2026 +0.5%. With a 20-day limit it is +0.54%; with 10 days or less it is negative.
- **A fresh Supertrend flip beat an ordinary Supertrend uptrend day on the same exit.** Supertrend-line exit, 60 days: FLIP +1.61% against +0.37% for UPTREND days (+1.24%); FRESH3 +0.62%. A 3 ATR stop with no target for 60 days: FLIP +1.96%, FRESH3 +0.98%, UPTREND +0.89%; random stock-days earn about +1.5% from market drift at 60 days, so that exit's edge over a random stock is small. A chandelier trail (3 ATR below the highest close) gave +1.51% for FLIP.
- **A support filter does not help Supertrend.** Supertrend-line exit plus "skip if no support cluster within 3 ATR": FLIP +1.43% on 265 trades against +1.61% on 503 without it.
- **Caveats:** about 500 FLIP trades over four years, with a standard error near 0.5% per trade, mostly in a rising market (the S&P 500 returned about 9% a year over the whole period including 2022). Return per day held (+0.048%) is higher than the market's (+0.036%) but not by much.

### Early-warning exits on Supertrend entries (ml_st_exits.py, 2026-11-06)

Daily Supertrend flip with the ADX gate (FLIP, 525 signals) and a flip within 3 days (FRESH3, 4,223), no time cap, exit when a day closes under the Supertrend line at the next open, plus one extra "the trend may turn down" exit at a time.

- **Every early-warning exit lowered the average return; the Supertrend line alone was best.** FLIP: line only +1.76% per trade (44% wins, 37.5 days held, average winner +12.0%, average loser -6.3%); plus close under the 50-day average +0.66%; under the 20-day average -0.03%; two closes under the 10-day average +0.02%; ADX falling under 20 +0.56%; ADX down 25% from its peak +0.41%; close 3 ATR under the highest close +1.46%; 2 ATR under the highest close +0.63%; SPY closing under its 50-day average +0.05%; giving back half the peak gain +0.91% (the only one that raised the win rate, to 62%). FRESH3 ranks the same way (line only +0.88%, the others -0.24% to +0.54%).
- **Why:** the early exits shrink the average loser (-4% instead of -6%) and the give-back from the peak, but they cut the winners by more, and re-entering after a false alarm is not modelled.
- **Use in the app:** exit on a completed daily close under the Supertrend line; show the other signs (4-hour turn down, ADX under 20, price under the 20-day average) as warnings only.

### Does an older setup still work if price is near its buy point? (ml_st_age.py, 2026-11-06)

27,179 days on which the daily Supertrend was up with the ADX gate, up to 30 days after the flip (every second day), entered at the next open, exit when a day closes under the line, no time cap. The distance is from the original buy point (the open after the flip), in daily ATRs.

- **Closeness to the buy point mattered more than age.** By distance: within 0.5 ATR over the buy point +1.25% per trade (1,901 days); pulled back under it +0.93% to +1.29%; 0.5 to 2 ATR over +0.63%; 2+ ATR over +0.71%. By age: day of the flip +2.44% (248), 1 to 3 days +0.72%, 4 to 10 days +1.04%, 11 to 30 days +0.60%.
- **Older but still near is almost as good as a fresh flip.** Within 0.5 ATR over the buy point: flip day +1.78%, 1 to 3 days +0.97%, 4 to 10 days +1.50% (907), 11 to 30 days +0.90% (465). One to ten days old and near versus the flip day, by year: 2023 +2.45% vs +5.70%, 2024 +0.12% vs +1.15%, 2025 +0.99% vs +2.23%, 2026 +2.21% vs +1.21%: positive every year, usually lower than a fresh flip.
- **Not perfectly monotonic:** setups 4 to 10 days old that were already 2+ ATR over still earned +1.30% (2,527), so "extended" is a weaker warning than it looks; and the day-of-flip bucket has only 248 days.
- **Rule now in the app:** a setup stays on the main list while its price is near the buy point and the daily trend and ADX gates hold. It moves to Recent setups when the price runs more than 0.5 4-hour ATR past the signal, falls 0.75 ATR back below it, or the daily trend or strength fails. The old rule removed any setup after about a day (1 completed 4-hour bar) whatever the price did; the age limit is now 40 4-hour bars (about 20 trading days) and only stops very old signals from being listed.

### Candlestick patterns with context (backtest9.mjs, 2026-11-07)

`node backtest9.mjs`. Point-in-time S&P 500 (same data and 0.1% per side cost as above), signal at the close, entry at the next open, one open trade per stock per rule. Long: bullish engulfing, hammer, morning star, three white soldiers. Short: bearish engulfing, shooting star, evening star, three black crows. Each is tested anywhere (ALONE), in a breakout/breakdown setting (BRK: close beyond the prior 20-day high or low, volume 1.4x the 50-day average, on the right side of the 200-day average) and in a pullback/bounce setting (PB: right side of the 200-day average and a 5-day move of 4% against it). Each pattern is compared with the same setting with no pattern (CONTEXT-ONLY) using a paired weekly t-statistic, and with any stock-day. Three exits: 5-day hold with no levels, 5-day with 2 ATR stop / 1 ATR target (the dip levels), 10-day with 2 ATR stop / 2 ATR target.

- **No bullish pattern beat its control.** Anywhere: edge over any stock-day within +-0.06% per trade on every exit (t under 0.5; about 14,600 trades for the combined set). In a breakout the pattern did worse than breakouts without one (-0.18% to -0.45%, t -0.6 to -1.6). After a pullback, bullish engulfing, hammer and morning star trailed the plain "pullback above the 200-day average" control (hammer -0.56% to -0.69%, t about -2). The plain pullback is simply the dip idea again: it averaged +0.15% to +0.25% with no candle at all.
- **Bearish patterns did not work as shorts.** Anywhere, they were worse than a random short (bearish engulfing -0.15% to -0.27%, t -1.8 to -3.2): stocks tend to keep rising after the "reversal" candle. After a rally in a downtrend the bearish engulfing was the worst cell (-0.95% to -1.43%, t about -2.9).
- **The one positive cluster is bearish patterns in a breakdown** (close under the 20-day low on volume, under the 200-day average): +0.6% to +0.9% over breakdowns without a pattern (t 2.0 to 2.7), mostly in the first half of the sample (second half negative on four of six rows). Absolute returns are still negative (-0.54% to -0.70% per short trade, against -0.69% to -0.81% for the control), because shorting any stock-day lost money in this rising market. Evening star (9 trades) and three black crows (22) show the biggest numbers on tiny samples.
- **Multiple comparisons:** about 100 cells were read, so a few at |t| of 2 to 2.7 are expected by chance. The only cells that repeat across exits are negative ones.
- **Decision:** no candlestick scanner. Neither side makes money, and the long side (all the app trades with this kind of signal) is at or below the control everywhere. Not tested: weekly or intraday candles, patterns at 52-week lows, or gating by market stress as the dip scan does.

### Swing setups from web write-ups (backtest10.mjs, 2026-11-07)

`node backtest10.mjs`. Long only, point-in-time S&P 500, same costs and one-open-trade-per-stock rule as above. Setups taken from published swing-trading guides: pullback to the 20 EMA in an uptrend (PB20), a tight 5-bar base near the 52-week high with a quiet-volume day, relative strength over SPY and a close over the base high (CONTRACT), a 10/20 EMA cross over a rising 50 EMA (EMAX), a bounce at the 38.2% retracement of a 15%+ rally (FIB382), and a false breakdown that closes back over the prior 10-day low (SPRING). Each is compared with its own context without the trigger, with a general uptrend control and with any stock-day, by a paired weekly t-statistic. Exits: A 5-day, 2 ATR stop, 1 ATR target; B 10-day, 2 ATR stop, 2 ATR target; C a structural stop at the setup's low (1 to 4 ATR away, otherwise the trade is skipped) with a 3R target and a 20-day limit; D a 3 ATR stop plus 3 ATR trail from the highest close, no target, 60-day limit.

- **Nothing beat its control with any exit.** Largest edges over the context control were +0.08% to +0.10% per trade (PB20, FIB382 on exits A and B; t under 1.1). Several were clearly worse: CONTRACT -0.27% to -0.41% (t -2.3 to -3.6) and EMAX -0.41% to -0.65% (t -2.4 to -4.2) on exits A, B and D. Buying the breakout of a tight base near highs, or the moving-average cross, did worse than buying any such stock on any day.
- **Trend filters hurt in this sample.** The plain uptrend control (20 EMA over 50, close over 50 and 200) averaged less than any stock-day on every exit (exit D: +0.19% against +0.74%; exit B: -0.06% against +0.09%). The window includes the 2022 decline and rotation among leaders, and the 20 over 50 filter keeps stocks that already ran.
- **Only one positive reading:** FIB382 on exit D (+0.58%, +0.39% over the uptrend control, t 1.5, positive in both halves), still under the +0.74% of any stock-day and not significant. Seven positive-looking cells out of about 60 is what chance gives.
- **Stops and targets:** the structural stop (under the setup's low, 1 to 4 ATR) with a 3R target did no better than the ATR levels (exit C: +0.02% to +0.26% per trade, win rate 36% to 43%), and it skips 40% to 50% of signals because the setup's low is under 1 ATR or over 4 ATR away. The trailing exit (D) lifted every average by letting the market drift carry it, but the controls rose by as much. The 3R target was reached on about 1 trade in 6 (win rates of 36% to 43% against 57% to 60% for the 1 ATR target in exit A).
- **Decision:** none of these are added. Not tested: the earnings momentum swing, anchored VWAP (no earnings or intraday data), double tops and bottoms and triangles with measured-move targets (round 2), and shorts.

### Earnings inside the holding window (backtest11.mjs, 2026-11-08)
Does a report inside the hold hurt? Robinhood's earnings feed only holds about the last five quarters, and it starts at a different date for each stock (median 2025-04-30), so each stock is tested only from its own first listed report onward (fetch_earnings.mjs saves the dates; a first version that started every stock on 2025-03-12 counted some missing reports as "no earnings" and was corrected). A trade is flagged when the market reaction to a report (the report day for before-open reports, the next session for after-close ones) falls inside the 5- or 10-day hold. Entry at the next open, 0.1% per side cost, no overlapping trades per stock.

- **The average return did not reliably change.** Flagged minus clear ranged from -1.4% to +0.5% depending on the entry and hold, and every date-clustered 95% interval included zero. The control (any stock-day) showed +0.03% (5-day) and -0.09% (10-day), also not different from zero.
- **The risk clearly rose.** Flagged trades had a standard deviation 1.3 to 2.1 times as large, and the worst 5% of trades were deeper: dips -10.8% against -6.4% (5-day), sharp dips -19.8% against -8.1% (5-day) and -17.8% against -11.0% (10-day).
- **Share of trades flagged:** about 7% of 5-day dips and 14% of 10-day dips and sharp dips.
- **What it means:** an earnings flag is a tail-risk control, not an edge. It does not show that skipping those trades raises the average. Small samples (31 to 142 flagged trades in the sharp and gated rows), one rising-market window, overlapping trades.
- **Not tested:** Supertrend (about 34 days held, so most trades span a report) and the pattern scan.

### Swing Exhaustion Fade: learned odds and liquidity sweep (backtest12.mjs, 2026-11-10)

`node backtest12.mjs` (output in `backtest12.out`). Idea from a TradingView script: a causal 2.5 ATR zigzag; every bar of a live down-leg is filed by retracement depth (tenths of k) and swing size (ATR); once the leg is confirmed each bar is labelled "was the low already in". Odds = smoothed hit rate (neighbouring depth bins at half weight), reported also as a Wilson lower bound. Pooled across the point-in-time S&P 500, using only legs confirmed strictly before the signal date (no lookahead); predictions start 2022-11-18 after 3,000 labels. Sweep flag = the leg's low went under the previous confirmed swing low (within 120 bars) and the close is back above it. Long only, next-open entry, 0.1% per side.

- **The odds are honest.** Predicted vs actual "low already in" by quintile: 35/35, 42/43, 45/43, 52/51, 62/61 percent (n = 12,725 setup bars).
- **They do not predict returns.** Setup bars (35-80% retrace, swing >= 2 ATR) averaged -0.06% over 5 days vs -0.02% for any stock-day. Top-third odds: -0.00% to +0.07%; bottom third: -0.05% to -0.14%; every edge over the unfiltered setup had |t| under 1. Wilson >= 0.60 (9.7% of setups) was -0.19% on the 5-day hold.
- **Overlay on the current dip entry:** no help. Above-median odds left only 66 of 1,617 dip trades and did not beat the rest (+0.17% vs +0.34%); the sweep flag (175 trades) was flat to worse (-0.51% vs +0.46% on the 10-day exit, t about 0).
- **Why:** "the low is probably in" is mostly a statement about the swing's shape, and the dip entry (RSI2 < 5, -5% in 3 days) already picks the washed-out moment; odds high enough to clear 60% are rare and mostly outside it.
- **Decision:** not added to ranking. Not tested: per-stock odds tables (too few swings per stock in four years), shorts, intraday swings.

### Swing odds as a filter on the app's own ideas (backtest13.mjs, 2026-11-10)

`node backtest13.mjs` (output in `backtest13.out`). Same learned-odds table as backtest12 but learned for both legs (down-leg: odds the low is in; up-leg: odds the high is in, flipped so high = good for a long). Applied to the three long ideas the ranking feeds the agent: Supertrend flip + ADX (n = 307), DIP (RSI2 < 10, n = 9,379) and DIP_SHARP (n = 1,422), on a 5-day hold and on 10 days with a 2 ATR stop and target. Question: does the swing score, or the sweep flag, tell the agent which ideas will lose?

- **No separation.** AUC for ranking winners above losers is 0.46 to 0.51 for the swing score and 0.49 to 0.51 for the sweep flag (0.50 = nothing). The existing features (RSI2, extension below the 20-day average) are no better, 0.49 to 0.56.
- **Rejecting the worst-scoring third** removes 27% to 35% of the worst-20% trades, which is what random removal gives (33%). The average return of kept trades moved from -0.07% to +0.13% (Supertrend, 5d) and fell from 0.42% to 0.25% (DIP_SHARP, 10d); all within noise, with the removed group's sign flipping between halves.
- **Wrong direction where it is significant.** On Supertrend flips (10d), ideas in an exhausted up-leg did better than fresh ones (+0.41% vs -0.05%, weekly t -2.7): momentum continued. DIP_SHARP with a sweep did worse (-0.44% vs +0.52%, n = 144, t -0.3).
- **Decision:** not given to the ranking agent. Caveat: this tests whether the number separates outcomes, not the model's wording; a feature with AUC near 0.50 gives the agent nothing to act on.

### Win-rate research: indicator combinations and the win-rate / profit trade-off (backtest14 to 17, 2026-11-10)

Rows = every up-trend day (daily Supertrend up, ADX >= 20 and rising; every 3rd day, plus every fresh flip), 25,947 rows and 475 fresh flips, point-in-time S&P 500, entry next open, 0.1% per side. 67 indicator conditions (trend, location, momentum, relative strength, volatility, volume, candle, SPY regime, breadth, sector). Train = before 2024-11-05, test = after. Scripts: `lib14.mjs`, `backtest14.mjs` to `backtest17.mjs`, outputs `backtest14.out` to `backtest17.out`.

- **Baselines:** fresh flips 44.6% wins, +2.14% per trade (train 50.6% / +2.85%, test 38.1% / +1.36%). All up-trend rows 36.4% wins, +0.59%. The flips' own win rate fell in the second half.
- **Single indicators:** none lifts the win rate by a stable amount. The best ones (extended 3+ ATR above the 20-day average, RSI2 > 80, RSI14 > 60) add 1 to 5 points in both halves; most flip sign between halves.
- **Exhaustive search (backtest16):** 672,641 pair / triple / quad combinations. Picked on train, the top 200 had +11.3 points of win-rate lift (current exit), +8.4 (stop 15% / target 5%) and +12.8 (stop 12% / target 10%); on the holdout the same combos averaged +1.6, -4.1 and -3.2 points. Only 3% to 4% of them stayed above baseline on the two stop/target exits. That is selection bias, not signal: no combination of these indicators reliably raises the win rate.
- **What does move win rate is the exit, and it moves profit the other way (backtest14, 15, 17).** Fresh flips, all rows:

| Exit | Win rate | Avg per trade | Note |
|---|---|---|---|
| Supertrend line only (current) | 44.6% (36.4%) | +2.14% (+0.59%) | big winners, small losers |
| Hard stop -12%, target +10% | 62.7% | +1.64% | wins up 18 pts for -0.5 pts of profit (backtest14, flips only; half-split not shown) |
| Stop -20%, target +12% | 65.9% (64.3%) | +1.85% (+1.88%) | all rows positive in both halves; flips test half -1.21% |
| Stop -20%, target +5% | 81.3% (80.9%) | +0.85% (+1.04%) | wins 74% / avg negative in the flips' test half |
| Stop -20%, target +3% or +4% | 85% to 88% | +0.42% to +0.69% (all rows +0.6% to +0.85%) | 85% is reachable, with 20% stops and tiny wins; flips test half -0.9% to -1.1% |
| Sell half at +4%, rest to the line, break-even | 67.8% (61.1%) | +0.63% (+0.30%) | flips test half -0.76% |
| Sell half at +3%, rest to break-even | 74.5% (67.5%) | +0.38% (+0.24%) | flips test half -0.85% |

- **Reading:** 85% wins is reachable only by letting losses grow (stop 15% to 20%) and capping wins at +3% to +4%; expectancy falls to under +1% per trade and turns negative in the 2024-11 to 2026-11 flips. A 60% to 65% win rate keeps roughly +1.6% to +1.9% per trade (stop 12% to 20%, target 10% to 12%) but the wide stops are a risk-sizing decision, and the flips' recent half is weaker for every variant. Break-even locks and ATR trails lowered win rate or profit; time stops lifted wins to 54% to 56% but cut profit to +0.2% to +0.55%.
- **Caveats:** exits were chosen on the same flips (in-sample for the flip numbers; the all-rows numbers are the larger check); overlapping rows; one mostly rising market; 475 flips give a win-rate standard error of about 2.3 points.

### Tight stops: high win rate with a small stop (backtest18.mjs, 2026-11-10)

Owner constraint: keep the stop small too. 117,846 member stock-days (every 4th day, any trend state), 10-day hold, stop 1 to 2 ATR (average ATR is 2.6% of price, so 2 ATR is about 5.2%), target 0.5 to 1 ATR, entry next open, 0.1% per side. 79 conditions (67 trend / momentum / volume / regime ones plus dip and market-stress ones), all singles, pairs and triples (82,239 combos); chosen on train (< 2024-11-05), judged on test.

- **Baseline by geometry alone:** stop 2 ATR / target 0.5 ATR wins 79% to 81% but averages 0.00% (train) and -0.06% (test). The win rate comes from the tiny target, not from the entry, and costs eat the profit.
- **Picked combos fall back on the holdout:** the top 400 by train win rate went from 84.2% to 78.8% (stop 2 / target 0.5), 71.3% to 65.8% (2 / 1), 73.4% to 68.0% (1.5 / 0.75). Selection bias again.
- **One family survived:** a pullback inside an up-trend while SPY is down 1.5% or more over 5 days (e.g. ROC5 < 0 + Supertrend up + SPY 5d <= -1.5%). Stop 2 ATR / target 1 ATR: train 74.0% / +0.72%, test 70.5% / +0.36% (n 2,234); stop 1.5 / target 0.75: test 72.7% / +0.22%. This is the market-stress dip scan the app already runs.
- **Result:** with a stop near 5%, about 70% to 73% wins at +0.2% to +0.4% per trade is the robust ceiling here. 78% to 80% is reachable but earns about zero. 85% with profit was not found, and nothing here reaches the +1.7% per trade of the Supertrend book.

### IBD-style sell rules (backtest19.mjs, 2026-11-10)

The investors.com "taking profits" page could not be opened from here (fetch and the in-app browser both blocked), so the rules tested come from background knowledge of IBD's method: cut losses at 7% to 8%, sell at +20% to +25%, and the 8-week rule (a +20% gain within 3 weeks of the buy point means hold at least 8 weeks). Fresh flips (475) and all up-trend rows; entry next open, 0.1% per side.

- **Win rate did not move:** 38.5% to 44.6% on the flips (current exit 44.6%). A 7% to 8% stop with no line exit costs wins at -7% and ties at -8%.
- **Profit:** +2.21% to +2.80% per trade full-sample (current +2.14%), but the 2024-11 to 2026-11 half fell to -0.5% to +0.3% (first half +4.0% to +5.8%). Stop -8% with the Supertrend line instead of the +20% to +25% target: +1.89%, test half +1.09%.
- **8-week rule:** adds +0.0 to +0.12 points to the average and changes no win rate; not distinguishable from noise.
- **Decision:** no change. The numbers above are from the rules as I understand them; if the page's exact rules differ, paste its text and re-test.

### Owner's levels: stop 3% to 5%, target +10% to +15% (backtest20.mjs, 2026-11-10)

Pure stop and target (no Supertrend-line exit), 60 or 120 day cap, fresh flips (475) and all up-trend rows (25.9k), 0.1% per side.

- **Win rate falls, not rises:** flips 22.9% to 41.5% (stop 3% to 5%), against 44.6% today. Break-even win rate for these levels is 17% to 33%, so they are profitable on paper, but only by +0.5% to +1.25% per trade (today +2.14%), and the 2024-11 to 2026-11 half is negative on every cell (-0.1% to -0.8%).
- **Why:** the average daily range is about 2.6% of price, so a 3% to 5% stop is hit by ordinary noise before a +10% move happens. Wider stops did better on every cell (5% beat 4% beat 3%).
- **Decision:** this payoff shape does not give a high win rate or more profit with these entries.

### Pullback to rising support with a structural stop, plus filtering (backtest21.mjs, 2026-11-10)

Entry: close above the 50-day average with the 50 above the 200, a rising 20-day EMA, price dipped to the EMA (low within 0.5% of it) and closed back above it. Stop: just under the lowest low of the last 5 days (average 2.5% below entry, capped at 5%). Targets 1R, 1.5R, 2R, +3%, +5%; 15-day cap; 12,364 triggers; 0.1% per side. Then the owner's filtering idea: all single, pair and triple conditions (59,711 combos), picked on train (< 2024-11-05) and judged on test.

- **Unfiltered the entry has no edge:** 1R target wins 51.8% (train) and 49.7% (test) with -0.08% and -0.17% per trade; other targets win 34% to 45% and average -0.2% on test. A close structural stop is hit too often.
- **Filtering lifts win rate a little on the holdout but not profit.** Top-300 combos by train win rate: +3% target test win 51.9% vs 44.3% baseline, 1R 50.2% vs 49.7%; their test average return stays negative (-0.15% to -0.31%). The best individual combos (e.g. RSI2 > 80 + close within 3 ATR of the Supertrend line + ROC20 > 0) win 52% on test at -0.18% per trade.
- **Decision:** not a usable entry. Across every search in this series the only profitable high-win setup remains the market-stress pullback (about 70% wins at +0.2% to +0.4%, tight stop).

### The stress-dip book: earnings flag and regime sizing (backtest22.mjs, 2026-11-10)

Three market-stress pullback definitions, each with SPY down 1.5% or more over 5 days: B1 5-day pullback + Supertrend up, B2 RSI2 < 10 above the 200-day average, B3 5-day pullback above the 50-day. 10-day hold, point-in-time S&P 500, one position per stock, 0.1% per side. Exits: stop 2 ATR (avg 5.2% of price) / target 1 ATR, and stop 1.5 ATR (avg 3.9%) / target 0.75 ATR.

- **The book is stable across halves:** 71% to 75% wins, +0.37% to +0.56% per trade (about 7,000 trades for B1/B3, 4,100 for B2). Test half is as good as train (B1: 71.9% / +0.52% vs 71.1% / +0.43%). Typical loss -4.0% to -4.7%, typical win +1.9% to +2.6%.
- **[RETRACTED, see the correction below] Earnings in the hold looked like the one filter that worked:** with a report inside the hold the trade wins 51% to 56% and averages -0.8% to -1.7% (n 52 to 156); without one it wins 74% to 81% and averages +0.4% to +1.3%. Best case, B2 without earnings: 78.1% wins / +1.27% (stop 2 ATR, target 1 ATR), 80.5% / +0.90% (stop 1.5 ATR, about 4% of price, target 0.75 ATR).
- **Caveat on the earnings result:** Robinhood's earnings history covers only about the last five quarters, so this is 2025 to 2026 (about 1,100 to 2,400 covered trades per variant, 52 to 156 flagged) in one mostly rising market. Direction is the same in every variant; the size is uncertain.
- **Regime sizing did not help:** the drop depth is not monotonic (SPY 5d below -4% wins less: 64% to 71% vs 71% to 76%), SPY below its 200-day average helps B1 and B3 (77% vs 71%) but not B2, and weighting trades 1x / 1.5x / 2x by drop depth moved the average by 0.00 to 0.02 points. Sizing cannot change win rate anyway.
- **Clustering risk:** only 142 signal days in four years with 30 to 50 trades each, all falling with the market. Equal-weight baskets averaged +0.20% to +0.44% per signal day and were positive on 55% to 64% of days, so a trade-level 75% win rate is not 75% of days.
- **Decision (revised below):** the earnings exclusion does not hold up; the book itself (71% to 75% wins) is unchanged; no regime sizing.

### Supertrend + support/resistance (backtest23.mjs, 2026-11-10)

Owner's hypothesis: Supertrend direction plus support and resistance can reach ~85% wins. Setup: Supertrend up; price within 0.5 or 1 ATR above a support, which is either a clustered pivot-low level (3-bar fractals, known 3 bars later, 1 to 3 touches, 120-bar look-back) or the Supertrend line itself; optional bounce candle (green close, low within 0.3 ATR of the support); optional fresh Supertrend (age <= 10 days). Stop 0.25 ATR under the support (average risk 1.7% to 2.5% of price, capped at 5%). Targets: next pivot-high resistance (at least 0.5 ATR away, optionally 1 or 1.5R away), or 0.25R, 0.5R, 0.75R, 1R, 1.5R, 2R. 98,415 candidate setups, 278 configurations with at least 200 trades, 15-day cap, one trade per stock per week, 0.1% per side.

- **Win rate follows the target distance, not the setup.** 1R target about 50% to 53%; 0.75R about 60%; 0.5R about 65% to 69%; 0.25R about 71% to 75%. That is roughly stop / (stop + target), what a random walk gives.
- **Profit is about zero everywhere:** the best 1R to 2R cells average +0.0% to +0.21% (win 37% to 53%), the 0.25R and 0.5R cells -0.27% to +0.01%. Gross of the 0.2% round-trip cost the 0.25R cells are about -0.03%: no edge before costs either.
- **Resistance as the target did not help:** 40% to 52% wins at +0.0% to +0.1%.
- **The 85% level is not on the table:** the highest win rate in any cell was 74.6% (target 0.25R, average -0.23% per trade, both halves negative).
- **What the idea is good for:** placing a stop close (2% to 2.5%) under a Supertrend line or support, not for lifting the win rate.

### Correction: the earnings flag in backtest22 was biased; earnings proximity tests (backtest22b.mjs, backtest24.mjs, 2026-11-10)

backtest22 flagged a trade when a report fell between entry and the ACTUAL exit day. Trades that win fast (target hit on day 1 to 3) exit early and so rarely span a report, while slow or stopped trades do, so the "report inside the hold" group was filled with slower trades and its low win rate was partly an artefact. The tradable test uses only what is known at entry: a report inside the maximum hold window (10 days for the dip book).

- **Dip book, corrected (backtest22b.mjs):** report inside the 10-day window vs none: B1 75.4% vs 72.0% wins (+0.58% vs +0.55%), B3 74.7% vs 73.2%, B2 75.1% vs 76.7% (+0.47% vs +1.19%); at the 1.5 ATR stop 77.7% to 80.3% vs 74.8% to 79.0%. No consistent win-rate gain from excluding them; flagged trades have somewhat deeper average losses (-5.3% to -8.6% vs -4.6% to -5.1%). The "74% to 81% wins when earnings are excluded" claim is withdrawn.
- **Supertrend ideas (backtest24.mjs):** by trading days from entry to the next report (5 buckets, 7,559 covered Supertrend-up days and 149 fresh flips, 2025-04 to 2026-05 only), win rate is 37% to 40% in every bucket and the average return 1.3% to 2.3% with no pattern; skipping entries with a report within 5 to 20 days changes win rate by under 1 point. The raw "report inside the hold" split on Supertrend (58% vs 19% wins) is the same artefact in the opposite direction: long holds are the winners and long holds span reports.
- **Decision:** no earnings filter for either book. Backtest11 (fixed 5 and 10 day horizon, no exit-day dependence) is unaffected: earnings remain a tail-risk flag only.

### Volume x patterns x Supertrend (backtest25.mjs, 2026-11-10)

Base: every daily Supertrend flip up with no ADX gate (5,971 flips; train 3,316, test 2,655; current exit: 40% wins, +1.34%; train 43.5% / +1.72%, test 35.1% / +0.87%). 30 features: 12 volume (flip-day relative volume 1.5x and 2x, 3-day surge, rising or dried-up participation, up/down volume ratio, OBV, dollar volume, volume high, power bar, accumulation), 14 pattern (tight base, 20 and 50 day breakouts, bull flag, engulfing, hammer, inside day, NR7, cup-like, double bottom, higher low, near 52-week high, gap up) and 5 Supertrend context (ADX, 200-day average, SPY regime, relative strength). Each alone, then all singles, pairs and triples (3,345 qualifying combos) picked on train and judged on test, with a permutation null (outcomes shuffled among the same trades, 30 repeats).

- **Volume does not carry over.** Flip-day volume >= 2x average: train 54% wins (+10 pts), test 30% (-5 pts). Same shape for 1.5x, the 3-day surge, power bars and volume highs: they look good in 2022 to 2024 and fail in 2024 to 2026. OBV, accumulation and up/down volume ratio: within 1 to 3 points of baseline either way.
- **Patterns:** tight base, bull flag, near-52-week-high and double bottom are at or below baseline; breakout of 50 days (+1 to +2 pts), engulfing, hammer, inside day, NR7 within noise. Cup-like (15% to 35% dip, back within 8%: 779 flips) and gap-up flip days lift AVERAGE return in both halves (cup-like +4.05% vs +0.94%; gap-up +2.70% vs +0.75%) with +3 to +5 points of win rate; these are profit lifts from a few big winners, not win-rate fixes, and were not tested against a null.
- **Combinations:** the top 50 combos by train win rate average 66.7% on train and 27.1% on test (baseline 35.1%). The same search on shuffled outcomes reaches 52.9% on train (47% to 59%), so the real in-sample structure is larger than chance, but it reverses out of sample: a regime effect, not a stable edge. Combos gaining >= 8 points on both halves: 13 real vs a median of 14 under the null (range 1 to 56). No combination is distinguishable from chance.
- **The one consistent factor is the market regime:** flips when SPY is below its 200-day average: 630 flips, 53% wins, +6.69% (train 47% / +3.1%, test 57% / +9.5%); flips with SPY above it: 38% / +0.71% (train 43% / +1.6%, test 32% / -0.46%). By year (SPY below): 2023 n 244 +3.7%, 2025 n 318 +8.5%, 2026 n 38 +18%, 2022 n 30 -1.7%. Caveat: these cluster in two or three market episodes (2023 and the 2025 tariff selloff and rebound), so the effective sample is a handful of independent events. It is consistent with the stress-dip result: the best entries come out of market weakness.
- **Reading:** in a rising market since 2024-11 the Supertrend flip earns about nothing (32% wins, -0.46%); the book's profit comes from flips that start in or just after corrections. Volume and patterns add no stable win rate on top.

### Regime-aware gating of the main book (backtest26.mjs, 2026-11-10)

Fresh daily Supertrend flips split by SPY's state at the signal (current exit). App-gated flips (ADX >= 20 and rising): 470, baseline 44% wins / +1.97% (train 51% / +2.85%, test 37% / +0.98%). All daily flips: 5,971, baseline 40% / +1.34%.

- **Best simple regime: SPY at least 5% below its 252-day high.** App-gated: 109 flips, 60% wins, +6.86% per trade (train 65% / +6.95%, test 47% / +6.64%), against 39% / +0.49% outside. All flips: 1,410, 45% / +3.35% vs 38% / +0.72%. SPY below its 200-day average: gated 47 flips, 55% / +9.05% vs 43% / +1.18%; all flips 630, 53% / +6.69% vs 38% / +0.71%. SPY 5-day return <= -1.5%: gated 52 flips, 52% / +7.64%.
- **Adding a +8% target inside the 200-day regime:** gated 64% wins / +2.34% (n 47), all flips 65% / +3.02%; outside the regime the same target gives 50% / +0.71% (gated) and 47% / +0.24% (all).
- **How solid it is:** the weak-market flips come from 9 (gated) or 11 (all) distinct months, dominated by 2025-04 (tariff selloff), 2023-01 and 2023-11. Month-clustered bootstrap of in-regime minus out-of-regime: all flips avg +0.84 to +10.55 pts (excludes zero), win +1 to +28 pts; app-gated flips avg -1.18 to +14.50 (includes zero) because of the small sample. Dropping the two heaviest months keeps it positive (all flips 58% / +7.6%; gated 61% / +10.2% on 23 flips). Some definitions (SPY 20-day return <= -3%, recovery zone) are not stable across halves.
- **Reading:** flips are the best trades when they start in or just after a market correction (about 23% of app-gated flips), reaching about 60% wins and +6.9% per trade; with the market near its highs they earn +0.5% at 39% wins. 60% to 65% wins is the ceiling found with this lever; 85% is not.

### Supertrend + chart patterns as the main strategy (backtest27.mjs, backtest27b.mjs, 2026-11-10)

Owner's direction: use Supertrend and patterns together as the main strategy. Causal detectors for bull flag (20%+ pole, tight flag), flat base breakout (25-bar range <= 12%, volume >= 1.3x), cup and handle, ascending triangle and double bottom; breakout close while the daily Supertrend is up (optionally with the ADX gate, or a fresh Supertrend <= 10 days old); entry next open, pattern stop (under the flag / base / handle / pivot lows, risk 1% to 8%), exit either the measured-move target (30-day cap) or the Supertrend line (120-day cap). Every trade is compared with 8 random controls: Supertrend-up days in the same month with the same stop and target distance in ATR units. 0.1% per side.

- **Win rates stay at 33% to 60%.** Target exit: flat base 54% to 60%, double bottom 53% to 55%, cup 49% to 53%, bull flag 40% to 46%, triangle 46% to 52%. Line exit: 33% to 44%. Nothing near 85%.
- **Most patterns add nothing over the matched control** (edge within about +/-3 pts of win rate and +/-0.7% of average): double bottom (-1.6 to +0.7 pts), ascending triangle, cup and handle on the plain Supertrend filter.
- **The best cells:** bull flag in a fresh Supertrend (n 769): line exit 44% wins, +5.33% per trade (train 34% / +2.37%, test 50% / +7.26%); target exit 46%, +2.64%. Flat base breakout with the ADX gate (n 164): 60% wins vs 50% for the control (+9.8 pts), +0.65% per trade. Cup and handle with the ADX gate, line exit (n 910): 42% wins, +1.65%, +4.8 pts and +0.64% over control.
- **The bull flag edge is mostly the prior surge (backtest27b):** against fresh-Supertrend days that also followed a 20%+ run-up, the flag's edge falls to +2 pts of win rate and +0.3% per trade (target exit) and +5 pts / +1.0% (line exit), against +4 to +5 pts / +1.3% to +1.4% over any fresh-Supertrend day. Same finding as the first pattern rounds.
- **Reading:** patterns on top of Supertrend change profit a little (the flag and cup raise the size of winners) but not the win rate; the strategy stays a 40% to 45% win, large-winner system. No pattern lifts it toward 85%.

### Which stocks do not produce wins? (backtest28.mjs, 2026-11-10)

All daily Supertrend flips (current exit), 527 stocks, 5,971 flips (about 11 per stock), 39.8% wins, +1.34% per trade. Live track record read from the production database on 2026-11-10 (24 settled picks only, all from the last week): Supertrend 15 settled, 11 wins, +6.85% average; losers WST -4.73%, ORLY -3.29%, EL -2.66%, ACN -1.95%; dips 9 of 9 wins, +3.87%.

- **Weakest stocks by their own history (8+ flips):** ENPH 9% wins, FMC 0%, ETSY 13%, TECH 19%, MOS 25%, CZR 27%, EG 0%, LKQ 23%, GPC 13%, OMC 8%, UPS 10%, PFE 23%. Strongest: WDC, STX, NVDA, AMD, FTNT, GLW, RCL, MU (50% to 73% wins).
- **A stock's own past win rate does not predict its future one:** 458 stocks with 4+ flips before 2024-11-05, split by earlier win rate: weakest third (25% earlier) won 33.8% later (avg -0.01%); middle (44%) 36.4% (+0.86%); strongest (66%) 35.0% (+1.32%). Average return shows slight persistence, win rate none. Do not blacklist stocks by name.
- **What is consistent is the type of stock.** Volatility (daily ATR % of price): most volatile third 44% wins, +3.57% (train 49% / +3.38%, test 41% / +3.74%); calmest third 37%, +0.10% (test 32%, -1.23%). Sector: Information Technology 45% / +5.40% (test +8.86%), Industrials 44% / +2.26%; Health Care, Consumer Staples, Real Estate, Materials, Utilities 35% to 38% with about 0% to +0.4% (test half negative for most). The "?" group (former index members with no sector in the current list) is the worst: 31%, -2.75%.
- **Reading:** the Supertrend flip works on volatile growth names (tech, industrials, high ATR) and does not produce wins on calm defensive names; individual stocks are not stable enough to exclude by name.

### Why do some flips lose and others win? (backtest30.mjs, 2026-11-10)

All 5,971 daily Supertrend flips (2,374 winners averaging +12.5%, 3,597 losers averaging -6.0%) and the 470 app-gated ones, compared on 18 things known at entry (volatility, ADX, trendiness, prior flips, stop distance, momentum, relative strength, volume, gap, liquidity, SPY state). AUC of each feature for winner vs loser, early and late half (0.50 = no information).

- **Almost nothing at entry separates winners from losers.** Every AUC is between 0.46 and 0.59. The only differences that kept the same direction in both halves: stock volatility (ATR 2.6% winners vs 2.4% losers; top third 44% wins / +3.58% vs 37% / +0.1%), a wider stop distance (the same thing), a lower prior 60-day return (low third 43% wins vs 38%), and, on app-gated flips, the market being further below its high (top third 55% wins / +4.62% vs 38% to 39%) and a higher 40-day efficiency ratio (trendier stock: 49% wins / +4.02% vs 41%).
- **Anatomy of the 3,597 losers:** held 22 days on average (winners 59); average worst dip -7.8%. 35% first reached +5% above entry and 8% reached +10% before turning down; 32% never rose 2%; 21% were out inside 10 days. Winners: 17% first dipped more than 5% below entry; best run averaged +23.5%.
- **Stocks with no wins and 3+ flips (8):** FMC, VFC, WHR, SEDG, AAP (former index members, long-term decliners), EG, COIN, WDAY. They average higher volatility (ATR 3.5% vs 2.5%) and more flips in the prior year (4.2 vs 3.3). Per-stock win rate correlates -0.31 with flips per year, but at trade level the prior flip count has AUC 0.50, so choppiness is not a usable entry signal.
- **Reading:** losing flips are mostly trends that failed or reversed after a start, not something visible at entry; a third give back a 5%+ gain first. The strongest context is the market (corrections) and the stock's trendiness and volatility; structural decliners (stocks later removed from the index) lose repeatedly.

### Which indicators showed a flip was a loser? (backtest31.mjs, 2026-11-10)

All 5,971 daily flips (60% end as losses). 36 warning flags (RSI, MACD, stochastic, CCI, MFI, CMF, OBV, Aroon, Bollinger, ADX / DI, moving averages, distance from the Supertrend line, down closes, down-day volume, lagging SPY) checked at entry and after 3, 5 and 10 sessions in the trade, among trades still open. For each flag: the share that ended as a loss, and the "sell-now gain" (selling at that close instead of holding to the Supertrend line exit).

- **At entry nothing warns:** the best flags (stochastic %K > 80, Bollinger %B > 0.95, ADX < 20) move the loss rate from about 56% to 61%; none points the same way in both halves.
- **After entry the losers show themselves, strongly.** Share ending as a loss when flagged vs not. Day 3: close within 1 ATR of the Supertrend line 87% vs 59% (4% of trades), close under the 10-day average 79% vs 57%, RSI14 < 50 77% vs 58%, MACD histogram falling 72% vs 55%. Day 5: RSI14 < 40 94% vs 59% (2% of trades), close under the 20-day EMA 80% vs 55%, close under the flip-day low 78% vs 53%. Day 10: close within 1 ATR of the line 84% vs 50%, RSI14 < 50 83% vs 47%, Bollinger %B < 0.5 84% vs 48%, -DI above +DI 80% vs 47%.
- **But selling when they fire does not pay:** the sell-now gain is negative for every flag at every checkpoint (about -0.5% to -1.2% per flagged trade; 0 of about 104 flags positive in both halves). Flagged trades that finish as losses lose about the same as selling would, and the minority that recover into large winners (the +12% average win) more than pay for the rest. This is why every weakness exit tested earlier lowered profit.
- **Reading:** the indicators describe a trade that is already failing; they are not a reason to leave it, and none predicts a loser before the trade starts.

### What if every exit became a 5% to 10% profit point? (backtest32.mjs, 2026-11-10)

Current exits against profit points of +5%, +7.5%, +10% and scale-outs, for the Supertrend flips (app-gated 470 trades; all 5,971) and the stress-dip scan (RSI2 < 10 above the 200-day average with SPY down 1.5% over 5 days: 4,115 trades; sharp dips 666). Stops unchanged (Supertrend line, or 2 ATR for dips); next-open entry, 0.1% per side. Early / late = before / after 2024-11-05.

- **Supertrend, app-gated flips (current: 44.0% wins, +1.97% per trade, 39 days):** sell all at +5%: 63.0% wins, +0.50% (late half -0.51%); at +7.5%: 51.9%, +0.73%; at +10%: 46.6%, +0.83%; half at +5% and the rest at +10%: 57.4%, +0.67%; half at +5% and the rest on the line: 56.6%, +1.23% (late +0.23%); half at +10%, rest on the line: 46.4%, +1.40%. All 5,971 flips (current 39.8%, +1.34%): the same ordering, every sell-all variant lower than the current average and negative in the late half for +5%, +7.5% and +10%.
- **Stress dips (current stop 2 ATR, target 1 ATR, 10 days: 71.4% wins, +0.57%; sharp dips 72.7%, +0.92%):** sell all at +5%: 57.6%, +0.58% (sharp 62.2%, +0.85%); at +10%: 53.3%, +0.69% (sharp 56.3%, +1.18%). With a 20-day cap: +10% averages +1.11% (sharp +1.62%) against +0.61% (sharp +0.88%) now, at 50% to 54% wins instead of 75%.
- **Reading:** converting everything to 5% to 10% lifts the win rate on Supertrend (to 47% to 63%) but cuts its profit by 58% to 75%, and makes the recent half negative; on dips it does the opposite, lowering the win rate 14 to 20 points and raising profit per trade when the hold is 20 days. The best compromise for Supertrend is half at +5% and the rest on the line (56.6% wins, +1.23%).

### After entry: can chart and volume warn of a downturn? (backtest33.mjs, 2026-11-10)

193,277 open-trade days (Supertrend still up, day 3 onward) from 5,823 daily Supertrend flips. 25 chart, volume, momentum and trend warning flags known at each close (closes under the 10 and 20-day EMA, distance to the Supertrend line, 5-day low and swing-low breaks, giving back half the gain, gap downs, wide down days, engulfing and shooting-star candles, RSI / MACD / ADX / DI turns, distribution days, high-volume down days, breakdowns on volume, OBV and RSI divergence at highs, climax volume, money flow). Targets: (a) a fall of 6% or more from that close within the next 10 sessions (base rate 22.0%; early 18.5%, late 26.2%), (b) the Supertrend exit firing within 5 sessions (base 14.6%). Train before 2024-11-05, test after.

- **Single flags barely lift the chance of a 6% drop.** Best: gap down 1% or more 31.0% (vs 21.3% without it; 13,068 days), gave back half the gain after +5% 28.0%, high-volume down day (1.5x, -1.5%) 26.0%, climax volume 24.8%, within 1 ATR of the line 24.3%, RSI14 crossing under 50 24.2%. Most others are within a point of the base rate (distribution days 21.4%, OBV divergence 20.6%, bearish engulfing 21.8%, MACD histogram cross 21.4%, 5-day low break 21.9%); two (shooting star, extended-plus-reversal candle) are below it.
- **A model of all flags and context numbers predicts a 6% drop poorly:** AUC 0.60 train, 0.571 test (distance to the line alone 0.509). On the test half the top 10% of scores had a 40.7% chance of a 6% drop (base 26.3%), the top 5% 48.4%, the top 1% 64.0%.
- **It predicts the system's own exit well, but that is just proximity to the line:** exit within 5 sessions, AUC 0.755 test, identical to distance-to-line alone (0.755). Top 10% of scores 51.6% (base 15.3%).
- **First-alert rules fire often and add nothing for a 6% drop:** volume warning (49% of trades) 23.2% after the alert (base 22.0%); swing-low or 5-day-low break (90%) 22.2%; giveback (49%) 23.1%; reversal candle (74%) 21.6%; RSI + MACD + -DI (49%) 21.8%; any two of four (81%) 22.9%. Train / test of the volume rule: 19% / 28%.
- **They do come early:** median 9 to 14 sessions before the Supertrend exit (reversal candles 23), and the price at the eventual exit is lower than the alert close in 63% to 72% of alerts, but on average it is 0.5% to 1.1% HIGHER, because the trades that keep running pay for the rest.
- **Reading:** chart and volume do not tell reliably, from a held trade, that a 6% decline is starting; what is predictable is that the trade is nearing the Supertrend exit. An exit alert can honestly say "X% of the time this setup fell 6% or more within 10 sessions, against 22% normally", but the best single signals raise that to 26% to 31%.

### Does a weakness alert help "continue or exit at the current profit"? (backtest34.mjs, backtest35.mjs, backtest36.mjs, 2026-11-10)

5,823 daily Supertrend flips, each day of each trade scored with the backtest33 warning flags. At the first day a warning rule fires while the trade is up P%, the choices are: hold to the Supertrend line (current), exit all, exit half and run the rest to the line, or keep the trade with a protective stop moved up. Net of 0.1% per side; causal (only what was known at that close).

- **Exit-on-alert loses money on average.** Trade-level average (hold 1.45%, 40.3% wins): warning (gap down / giveback / high-volume down day) while up 5%, exit all: +0.84%, 45.7% wins; exit half: +1.14%; up 3%, exit all +0.69%, 51.0% wins. Other rules (near the line, 2+ of 5 warnings) cost 0.0 to 0.2 points but also add under 2 points of win rate. In 61% to 75% of alerts exiting at that close would have beaten holding (median advantage +1.2% to +2.8%), yet the average still favours holding because of the large winners; same trade-off as every earlier exit test.
- **The alert adds nothing to a plain profit lock.** Moving the stop to breakeven only after an alert: 41% to 44% wins, +1.40% to +1.45% (about the same as holding). (backtest34.mjs also prints a "same policy on a RANDOM day" column; that control is not causal because it picks days using the whole trade, so ignore it.)
- **What does help is a rule with no alert at all: lock in a profit once the trade is up.** Stop raised to entry +1% once a close is up 3%: 61.8% wins (vs 38.7%), losses worse than -0.5% fall from 57.6% to 35.6%, average +1.17% (vs +1.45%), early / late halves +1.47% / +0.78% (wins 63% / 61%). Up 5% -> +1%: 52.4% wins, +1.29%; up 4% -> +1%: 56.3%, +1.23%; up 7% -> +1%: 45.5%, +1.36%. A stop only 0.3% to 0.5% over the entry is not useful: it ends 21% to 37% of trades as scratches around zero (backtest14's break-even test failed for this reason). Raising the lock to +2% moves wins to 53.8% to 64.4% and the average by about -0.1 points. Every cell in the grid points the same way in both halves.
- **Cost of the lock:** about 0.16 to 0.28 points of average return (-11% to -19%) for 12 to 24 points of win rate; the late half loses the same amount.
- **Reading:** chart and volume warnings do not tell a held trade when to leave (they flag dips that tend to bounce). A profit lock does tell a held trade what to do once it is in profit: keep part of the gain at almost no cost to the average.
