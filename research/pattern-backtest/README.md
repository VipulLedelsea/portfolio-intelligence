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
