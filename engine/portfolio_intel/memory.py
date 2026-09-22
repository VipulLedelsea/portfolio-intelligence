from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  market_snapshot_json TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  score REAL NOT NULL,
  confidence REAL NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  approved INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  stop_price REAL NOT NULL,
  target_position_pct REAL NOT NULL,
  confidence REAL NOT NULL,
  thesis TEXT NOT NULL,
  veto_reasons_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL UNIQUE REFERENCES decisions(id) ON DELETE CASCADE,
  evaluated_at TEXT NOT NULL,
  observed_price REAL NOT NULL,
  return_pct REAL NOT NULL,
  grade TEXT NOT NULL,
  lesson TEXT NOT NULL,
  evaluation_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  symbol TEXT PRIMARY KEY,
  shares REAL NOT NULL,
  average_cost REAL NOT NULL,
  sector TEXT NOT NULL DEFAULT 'Unknown',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  symbol TEXT NOT NULL,
  lesson TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_run_id ON reports(run_id);
CREATE INDEX IF NOT EXISTS idx_decisions_symbol ON decisions(symbol);
CREATE INDEX IF NOT EXISTS idx_lessons_role ON lessons(role, created_at DESC);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class MemoryStore:
    def __init__(self, path: str | Path = "portfolio_memory.db") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    def create_run(self, symbol: str) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO runs(symbol, started_at, status) VALUES (?, ?, 'running')",
                (symbol.upper(), utc_now()),
            )
            return int(cursor.lastrowid)

    def complete_run(self, run_id: int, snapshot: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE runs SET completed_at=?, status='completed', market_snapshot_json=? WHERE id=?",
                (utc_now(), json.dumps(snapshot, separators=(",", ":")), run_id),
            )

    def fail_run(self, run_id: int, error: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE runs SET completed_at=?, status='failed', error=? WHERE id=?",
                (utc_now(), error[:2000], run_id),
            )

    def save_report(self, run_id: int, report: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO reports(run_id, role, score, confidence, report_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    report["role"],
                    float(report["score"]),
                    float(report["confidence"]),
                    json.dumps(report, separators=(",", ":")),
                    utc_now(),
                ),
            )

    def save_decision(self, run_id: int, decision: dict[str, Any]) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                """INSERT INTO decisions(
                     run_id, symbol, action, approved, entry_price, stop_price,
                     target_position_pct, confidence, thesis, veto_reasons_json,
                     decision_json, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    decision["symbol"],
                    decision["action"],
                    int(decision["approved"]),
                    decision["entry_price"],
                    decision["stop_price"],
                    decision["target_position_pct"],
                    decision["confidence"],
                    decision["thesis"],
                    json.dumps(decision["veto_reasons"]),
                    json.dumps(decision, separators=(",", ":")),
                    utc_now(),
                ),
            )
            return int(cursor.lastrowid)

    def recent_lessons(self, role: str, limit: int = 5) -> list[str]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT lesson FROM lessons WHERE role IN (?, 'all') ORDER BY created_at DESC LIMIT ?",
                (role, limit),
            ).fetchall()
        return [str(row["lesson"]) for row in rows]

    def positions(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM positions ORDER BY symbol").fetchall()
        return [dict(row) for row in rows]

    def upsert_position(self, symbol: str, shares: float, average_cost: float, sector: str = "Unknown") -> None:
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO positions(symbol, shares, average_cost, sector, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(symbol) DO UPDATE SET shares=excluded.shares,
                   average_cost=excluded.average_cost, sector=excluded.sector,
                   updated_at=excluded.updated_at""",
                (symbol.upper(), shares, average_cost, sector, utc_now()),
            )

    def get_decision(self, decision_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM decisions WHERE id=?", (decision_id,)).fetchone()
        if not row:
            return None
        stored = dict(row)
        try:
            payload = json.loads(stored.get("decision_json") or "{}")
        except json.JSONDecodeError:
            payload = {}
        return {**stored, **payload}

    def save_evaluation(self, decision_id: int, evaluation: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO evaluations(decision_id, evaluated_at, observed_price, return_pct,
                   grade, lesson, evaluation_json) VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(decision_id) DO UPDATE SET evaluated_at=excluded.evaluated_at,
                   observed_price=excluded.observed_price, return_pct=excluded.return_pct,
                   grade=excluded.grade, lesson=excluded.lesson, evaluation_json=excluded.evaluation_json""",
                (
                    decision_id,
                    utc_now(),
                    evaluation["observed_price"],
                    evaluation["return_pct"],
                    evaluation["grade"],
                    evaluation["lesson"],
                    json.dumps(evaluation, separators=(",", ":")),
                ),
            )
            connection.execute(
                "INSERT INTO lessons(role, symbol, lesson, weight, created_at) VALUES ('all', ?, ?, ?, ?)",
                (evaluation["symbol"], evaluation["lesson"], evaluation["lesson_weight"], utc_now()),
            )

    def history(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT d.id, d.symbol, d.action, d.approved, d.entry_price,
                   d.target_position_pct, d.confidence, d.created_at,
                   e.observed_price, e.return_pct, e.grade, e.lesson
                   FROM decisions d LEFT JOIN evaluations e ON e.decision_id=d.id
                   ORDER BY d.id DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]
