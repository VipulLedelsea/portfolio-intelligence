# Prior art and adaptive risk: research notes (2026-11-06)

Summary of a quick web and GitHub survey plus our own backtests. The survey was a fast pass: most summaries came from secondary sources and star counts were read on 2026-11-06. Anything marked unverified was not checked against a primary source.

## What other open-source systems offer
| Project | Use for us | Note |
|---|---|---|
| Microsoft Qlib (github.com/microsoft/qlib, ~50k stars, MIT) | Template for rank-IC evaluation, which our ML test follows | Its README results are a China-market demo with no stated period; not evidence |
| freqtrade (~57k) | Its `lookahead-analysis` and `recursive-analysis` commands catch look-ahead bias | Crypto only; hyperopt invites overfitting |
| vectorbt (~9.7k, Apache-2.0 + Commons Clause) | Fast parameter sweeps and walk-forward | Commons Clause limits commercial resale; README example is cherry-picked in-sample |
| QuantConnect LEAN (~22k, Apache-2.0) | Realistic fills, point-in-time data | Data is licensed separately |
| zipline-reloaded (~2k), backtrader (~24k, GPL, looks dormant) | Backtesting engines | Low value for us |
| TradingAgents (~121k), ai-hedge-fund (~64k), FinRL (~17k) | LLM-agent and RL demos | Their own READMEs disclaim replicable returns; stars reflect hype |
| mlfinlab, mlfinpy, finmlkit | Triple-barrier labels and meta-labeling | mlfinlab is no longer open source |

No open-source project was found with a rigorous, cost-adjusted, point-in-time track record on US large caps.

## What the research says about adaptive risk
- Volatility-scaled barriers (triple-barrier method) and meta-labeling (a second model decides whether to take a trade) are the standard ideas. Our tests agree: a model is useful as a filter, not as a stop-setter.
- Stops help momentum entries but hurt mean-reverting ones (Kaminski and Lo; Connors and Alvarez, secondary sources). Our dip entries do better with a wide stop and a 5-day time exit.
- Volatility-managed sizing (Moreira and Muir, NBER w22208) reports Sharpe gains for the market; out-of-sample support for single stocks is unverified. Our own test found inverse-ATR sizing cut weekly swings about as much as an ML forecast.
- Short-term reversal returns are largely compensation for liquidity and are larger in turmoil (Nagel, NBER w17653). That matches our finding that dips pay in market-wide selloffs.
- Regime handling in practice: SPY versus its 200-day average and a volatility percentile. No evidence was found that HMM regime models improve out-of-sample results.

## Compliance and data notes (unverified, check with counsel)
- Backtested results are "hypothetical performance" for SEC marketing-rule purposes; the SEC brought enforcement actions in September 2023. Label backtests as hypothetical and publish the live record unedited, including losers.
- Robinhood's customer agreement reportedly limits market data to individual use, and no official terms for commercial use of its public API were found. Plan a licensed data feed before a commercial release.

## LLM trading-agent projects (2026-11-06, second pass)
A research agent read each page through summaries, not the source code, so details are unverified where marked.

| Project | What it is | Evidence | Verdict |
|---|---|---|---|
| TradingAgents (github.com/TauricResearch/TradingAgents, Apache-2.0, ~121k stars) | LangGraph multi-agent firm: four analysts, bull/bear debate, trader, risk team, portfolio manager, outcome-settled memory log | Paper (arxiv.org/abs/2412.20138): 3 months of 2024, 3 tickers, no costs, Sharpe 5.6 to 8.2, models likely saw that period in training | Not credible as evidence of edge. Open issues include temporal leakage (#805), a 329k-token request (#1625) and zero prompt-cache hits (#750). About 10 to 15 LLM calls per ticker |
| qrak/LLM_trader (MIT, ~141 stars) | Crypto paper bot: chart plus 79 indicators plus vector memory sent to an LLM; rules override the model's claims; ATR stops | 42 days, 12 trades, +0.16% vs -4.64% buy and hold; its own README says costs would erase the gain and 12 trades are not evidence | Honest but tiny. Useful design idea: deterministic guards over LLM output. About $0.01 per decision on DeepSeek |
| Open-Finance-Lab/AgenticTrading (~888 stars, 124 open issues) | Dashboard, SDK and live leaderboard comparing LLMs on simulated fills | None verified; live feed paused | Skip as a source of signals |
| LLMQuant/awesome-trading-agents (CC0, ~984 stars) and the LLMQuant org | A curated link list and knowledge bases | None | Reading list only. It notes no listed project addresses training-data leakage |

Most relevant extra reading it found (not read in depth): FINSABER (arxiv.org/html/2505.07078v3, LLM strategies shrink over 20 years and 100+ symbols), DeepFund (arxiv.org/abs/2505.11065, live leakage-free benchmark where even strong models lost money), a paper arguing look-ahead lives in model weights (arxiv.org/html/2605.24564), and the sec-edgar-mcp server for filings.

### What it means for us
1. The one well-motivated use is a **veto on dip candidates**: dips caused by fraud, guidance cuts, going-concern or deal-break news are the failure case of mean reversion. Claude would label the cause (market-driven, sector, transient, structural) from the last 5 days of news and any new 8-K or 10-Q filings, and flag earnings inside the 5-day hold. It may only remove a pick or add a flag, never create picks or size positions.
2. **Test it forward only.** Backtesting an LLM on past dates is contaminated because the model may remember outcomes, and prompting it to ignore the future does not fix that. Run in shadow mode: log the label, the sources, the prompt and the model id on every pick, still publish all picks, and after 60 to 100 dip picks compare vetoed against kept picks with a bootstrap interval and a random-veto placebo. Go live only if the interval excludes zero.
3. Use a cheap model (claude-haiku-5-5) to screen and claude-sonnet-5-5 with web search only for flagged names, on dip candidates only (about 0 to 5 a day, and only in stress), which keeps cost small. Check current pricing and tool names in the API docs before building.
4. Do not expect an LLM to add stock-picking skill from prices, or to fix the Supertrend scanner. Our own ML test (rank IC about 0) agrees with the FINSABER result.
5. Do not copy any headline performance numbers from these projects.
