# Portfolio Intelligence engine

This is the working system behind the concept: a governed, multi-agent research and paper-trading engine with persistent SQLite memory.

## What runs

1. Live daily price history is fetched for the requested ticker.
2. Fundamentals, news, and sentiment agents research in parallel.
3. A deterministic price-action analyst computes trend, volatility, ATR, and volume signals.
4. Bull and bear agents debate the same evidence packet.
5. A synthesis agent produces the investable thesis.
6. The trader creates an entry, stop, and volatility-aware position size.
7. Independent risk rules can veto the trade. No later agent can override that veto.
8. The portfolio manager checks existing positions before sign-off.
9. Every report and decision is stored in SQLite. The `grade` command compares a recommendation with the latest price and saves a reusable lesson.

The engine is intentionally paper-only. It contains no brokerage order endpoint.

## Start it

```bash
cd engine
cp config.example.json config.json
export OPENAI_API_KEY="your-key"
python3 -m portfolio_intel analyze AAPL
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

This project is research infrastructure, not investment advice. Before connecting any broker, add authentication, secrets management, human approval, idempotent orders, reconciliation, market-hours controls, regulatory review, and a kill switch.

