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
