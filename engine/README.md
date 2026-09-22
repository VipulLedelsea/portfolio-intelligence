# Portfolio Intelligence engine

This is the working system behind the concept: a governed, read-only multi-agent stock-research engine with persistent SQLite memory.

## What runs

1. Read-only Robinhood quotes, daily context, and one-hour OHLCV history are fetched for the requested ticker. During market hours, five-minute bars are aggregated into a clearly labeled provisional one-hour candle.
2. Fundamentals, news, and sentiment agents research in parallel.
3. A deterministic price-action analyst computes trend, volatility, ATR, volume, and Supertrend (10, 3) signals.
4. Bull and bear agents debate the same evidence packet.
5. A synthesis agent produces the investable thesis.
6. The trader creates an entry, stop, and volatility-aware position size.
7. Independent risk rules can veto the trade. No later agent can override that veto.
8. The portfolio manager checks existing positions before sign-off.
9. Every report and decision is stored in SQLite. The `grade` command compares a recommendation with the latest price and saves a reusable lesson.
10. Each full review includes 120 one-hour Robinhood candlesticks with a 20-hour moving average, a green/red Supertrend line, the current reference price, an hourly ATR-based risk level, and two clearly labeled scenario targets.

The first and second targets are short-hold planning scenarios at roughly two and three times the defined one-hour risk distance. Long setups put invalidation below the reference and targets above it; short setups reverse that geometry. They are not price promises. If the evidence is incomplete or governance rejects the setup, the chart says `WATCH` or `PASS` and explains the reasons instead of presenting it as an investment idea.

The `discover` command loads the current S&P 500 constituent set and returns overall, long, and short top-20 lists for trades intended to last a few days. One-hour TradingView-compatible Supertrend direction drives LONG versus SHORT; six months of daily trend, 20/60-day momentum, volume participation, and volatility remain supporting context. The dashboard opens the same ticker on TradingView's 60-minute interval for confirmation. Company and sector labels come from the constituent feed. A high discovery score is a prompt for deeper research, not a buy or short signal.

The scanner treats one-hour Supertrend as the source of truth for LONG versus SHORT. A live hourly flip is labeled `PROVISIONAL`, includes the prior confirmed direction, and receives a score penalty until that one-hour candle closes. Data-vendor differences can still produce small line-value differences.

The engine is intentionally read-only. It has no authenticated broker adapter, order preview, order submission, or cancellation endpoint. The locally running service does not inherit access to a connected brokerage account.

Robinhood is used only as the market-data source for quotes and historical OHLCV bars. The service does not store Robinhood credentials, account data, positions, or order permissions.

## Start it

```bash
cd engine
cp config.example.json config.json
export OPENAI_API_KEY="your-key"
python3 -m portfolio_intel analyze AAPL
python3 -m portfolio_intel discover --limit 20
```

The default model is `gpt-5.6-luna`; change `OPENAI_MODEL` or `config.json` to use another Responses API model.

Run the local dashboard:

```bash
python3 -m portfolio_intel serve
```

Then open `http://127.0.0.1:8787`.

## Memory and grading

```bash
python3 -m portfolio_intel history
python3 -m portfolio_intel grade 1
python3 -m portfolio_intel position MSFT 10 425.00 --sector Technology
```

`portfolio_memory.db` holds the audit trail. Set `PORTFOLIO_INTEL_DB` or pass `--db` to keep it elsewhere.

Without `OPENAI_API_KEY`, the system still runs its market-data and governance path, but the missing external research is marked incomplete and the risk agent vetoes the trade. This is deliberate fail-safe behavior.

## Test it

```bash
python3 -m unittest discover -s tests -v
```

The tests use fixed market data and a fake research client, so they do not need network access or an API key.

## Safety boundary

This project is research infrastructure, not investment advice. It uses market data to surface ideas and deliberately cannot place trades.
