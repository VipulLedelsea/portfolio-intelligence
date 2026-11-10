# Win-rate research: plan and status (paused 2026-11-10)

Goal from the owner: lift the Supertrend flip win rate (43%, +1.73% per trade, avg win +12.2%, avg loss -6.2%, ~38 days held, 510 trades) toward ~85% while keeping or raising profit per trade. Idea: combine many indicators, test permutations and combinations, and do outside research.

## Status (updated)
- DONE: backtest14 (baseline, single indicators, exit frontier), backtest15 (stop/target grid), backtest16 (672,641 combos, holdout), backtest17 (scale-out). Findings are in README.md under 'Win-rate research'. Conclusion: indicator combos overfit; win rate and profit trade off through the exit only. Open question for the owner: which trade-off to ship.

- Owner then required a SMALL stop too. backtest18 (tight-stop combo search): robust ceiling ~70-73% wins at +0.2% to +0.4% per trade via market-stress pullbacks (same as the existing dip scan); 85% not reachable with profit.

- Also tested and rejected: IBD sell rules (backtest19), stop 3-5% / target 10-15% (backtest20), pullback-to-rising-EMA20 with structural stop plus filtering (backtest21). The only robust high-win setup: market-stress pullback, ~70% wins, +0.2 to +0.4% per trade.

- backtest22: stress-dip book (SPY 5d <= -1.5% pullbacks) = 71-75% wins, +0.4-0.6%/trade, stable across halves. [RETRACTED: the earnings exclusion result was biased by using the actual exit day; see README correction, no gain.] Regime sizing no help. Candidate next step: the book itself (~71-75% wins, +0.4-0.6%/trade) as a second book, no earnings filter.

- backtest23: Supertrend + support/resistance (owner's hypothesis) - win rate just tracks target distance (50% at 1R, 75% at 0.25R), profit ~0. Not an edge; useful only for tight stop placement.

- backtest25 (volume x patterns x Supertrend, 5,971 flips): volume and patterns add nothing stable; combos indistinguishable from chance (13 survivors vs median 14 by chance). Only consistent factor: SPY below its 200d average at the flip (53% wins, +6.7% vs 38%, +0.7%), but episodic (2023, 2025). Next idea: regime-aware gating of the main book.

- backtest26 (regime gating): app-gated flips with SPY >=5% below its 252d high: 109 flips, 60% wins, +6.86% (train 65/+6.95, test 47/+6.64) vs 39%/+0.49% outside; with +8% target in the 200d regime 64% wins +2.3%. Few independent episodes (9-11 months). Candidate: give the ranking agent a market-regime tag, or prioritize/size flips in corrections.

- backtest27/27b (owner chose Supertrend + patterns as main): patterns in a Supertrend uptrend with own stop/measured target: win 33-60%, mostly no edge vs matched controls; bull flag edge is mostly the prior surge. Best cells: bull flag in fresh Supertrend (line exit 44% wins, +5.3%), flat base + ADX gate (60% wins vs 50% control, n=164).

## Original status
- `lib14.mjs` written (syntax-checked only, NOT yet run): point-in-time data, ~75 binary indicator conditions (trend, location, momentum, relative strength, volatility, volume, candle, market regime, breadth, sector), and an exit simulator (Supertrend line, target, hard stop, break-even lock, ATR trail, time stop).
- Nothing else built yet. No results from the combination search yet.

## Next steps
1. Stage A (`backtest14.mjs`): build rows = every 3rd stock-day with daily Supertrend up and the ADX gate; baseline stats; single-condition lift on win rate (train 2022-11..2024-11, test 2024-11..2026-11 and reversed); exit frontier (win rate vs average return) on the 510 flips and on the rows.
2. Stage B: pair/triple/quad search with bitsets; rank by train win-rate lower bound subject to expectancy at least baseline; judge ONLY on the holdout and against a random-combo null; check on the real 510 flips; report the count of combos tried.
3. Stage C: test the research-agent rules below, then report the win-rate / profit frontier honestly.

## Outside research (subagent web search, snippets only, partly unverified)
- Published evidence that entry filters raise a trend entry's hit rate is thin; most effects are on drawdown and Sharpe. Only consistent filter: close above the 200-day average, and that is for dip buying.
- Published 78-81% win systems (QS RSI pullbacks on SPY/QQQ) make about +0.7% to +1.1% per trade on short holds, are un-costed and small-sample, and accept losses 3 to 6 times the average win. Independent Connors RSI(2) check: 71% wins, avg win +1.22%, avg loss -2.10%.
- Math: at 85% wins, break-even needs avg loss / avg win = 5.67. Our profit comes from a small tail of big winners, so any exit that lifts wins to 60-70% cuts the average win sharply.
- Agent's realistic goal: 50-58% wins with +1.5% to +2% per trade, not 85%.
- Testable rules suggested: SPY above 200d gate (plus calm-vol variant); time stop (day 15 or 20 if gain under +3%); break-even ratchet after +1.5R; hard stop 1.5 ATR in first 10 days; overextension filter (skip if >1.5 ATR over the 20d EMA) or pullback entry; volatility contraction; relative strength over SPY; partial profit; chandelier exit; add the dip-buy sleeve.
- Anti-overfitting: count trials, require t > 3, holdout never used for design, year-by-year consistency, monotonic dose-response, 1-3 parameters. With 510 trades the win-rate standard error is about 2.2 points.
