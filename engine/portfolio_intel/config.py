from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    model: str = "gpt-5.6-luna"
    starting_equity: float = 100_000.0
    max_position_pct: float = 5.0
    max_sector_pct: float = 20.0
    risk_per_trade_pct: float = 0.5
    max_annualized_volatility_pct: float = 85.0
    minimum_confidence: float = 0.60
    minimum_research_score: float = 45.0
    recommendation_horizon_days: int = 30

    @classmethod
    def load(cls, path: str | Path | None = None) -> "Settings":
        values = asdict(cls())
        config_path = Path(path or os.environ.get("PORTFOLIO_INTEL_CONFIG", "config.json"))
        if config_path.exists():
            with config_path.open("r", encoding="utf-8") as handle:
                values.update(json.load(handle))
        if os.environ.get("OPENAI_MODEL"):
            values["model"] = os.environ["OPENAI_MODEL"]
        return cls(**values)

