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
