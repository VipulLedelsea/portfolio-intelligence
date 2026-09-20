from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import Settings
from .engine import PortfolioEngine
from .memory import MemoryStore


def print_json(value: object) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="portfolio-intel", description="Governed multi-agent investment research engine")
    parser.add_argument("--db", default="portfolio_memory.db", help="Path to the SQLite memory database")
    parser.add_argument("--config", help="Path to a JSON configuration file")
    sub = parser.add_subparsers(dest="command", required=True)
    analyze = sub.add_parser("analyze", help="Run the complete research and governance pipeline")
    analyze.add_argument("symbol")
    discover = sub.add_parser("discover", help="Rank a liquid stock universe for further research")
    discover.add_argument("--limit", type=int, default=8)
    discover.add_argument("--universe", help="Comma-separated ticker symbols; defaults to a diversified large-cap universe")
    grade = sub.add_parser("grade", help="Grade a saved recommendation against the latest market price")
    grade.add_argument("decision_id", type=int)
    history = sub.add_parser("history", help="Show saved recommendations and grades")
    history.add_argument("--limit", type=int, default=20)
    position = sub.add_parser("position", help="Add or update a position used by portfolio review")
    position.add_argument("symbol")
    position.add_argument("shares", type=float)
    position.add_argument("average_cost", type=float)
    position.add_argument("--sector", default="Unknown")
    serve = sub.add_parser("serve", help="Run the local dashboard and JSON API")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8787)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings.load(args.config)
    memory = MemoryStore(Path(args.db))
    if args.command == "position":
        memory.upsert_position(args.symbol, args.shares, args.average_cost, args.sector)
        print_json({"saved": True, "symbol": args.symbol.upper(), "read_only": True})
        return 0
    if args.command == "history":
        print_json(memory.history(args.limit))
        return 0
    if args.command == "serve":
        from .server import serve
        serve(args.host, args.port, settings=settings, memory=memory)
        return 0
    engine = PortfolioEngine(settings=settings, memory=memory)
    try:
        if args.command == "analyze":
            print_json(engine.analyze(args.symbol))
        elif args.command == "discover":
            universe = [item.strip() for item in args.universe.split(",")] if args.universe else None
            print_json(engine.discover(limit=args.limit, universe=universe))
        elif args.command == "grade":
            print_json(engine.grade(args.decision_id))
    except Exception as exc:
        print_json({"error": str(exc), "read_only": True})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
