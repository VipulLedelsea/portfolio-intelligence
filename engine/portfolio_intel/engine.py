from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from .agents import fallback_debate, run_debate, run_research_agents
from .clients import MarketDataClient, OpenAIResearchClient, ResearchClient, SafeFallbackResearchClient
from .config import Settings
from .governance import plan_trade, portfolio_review, risk_review
from .memory import MemoryStore


DEFAULT_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "JPM", "V", "MA",
    "LLY", "UNH", "XOM", "COST", "WMT", "HD", "CRM", "NFLX", "AMD", "ORCL",
]


class PortfolioEngine:
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        memory: MemoryStore | None = None,
        market: MarketDataClient | Any | None = None,
        research: ResearchClient | None = None,
    ) -> None:
        self.settings = settings or Settings.load()
        self.memory = memory or MemoryStore(os.environ.get("PORTFOLIO_INTEL_DB", "portfolio_memory.db"))
        self.market = market or MarketDataClient()
        if research is not None:
            self.research = research
            self.has_llm = not isinstance(research, SafeFallbackResearchClient)
        elif os.environ.get("OPENAI_API_KEY"):
            self.research = OpenAIResearchClient(self.settings.model)
            self.has_llm = True
        else:
            self.research = SafeFallbackResearchClient()
            self.has_llm = False

    def analyze(self, symbol: str) -> dict[str, Any]:
        ticker = symbol.upper().strip()
        run_id = self.memory.create_run(ticker)
        try:
            snapshot = self.market.snapshot(ticker)
            lessons = {role: self.memory.recent_lessons(role) for role in ("fundamentals", "news", "sentiment", "price_action")}
            reports = run_research_agents(self.research, ticker, snapshot, lessons)
            for report in reports:
                self.memory.save_report(run_id, report)
            if self.has_llm:
                bull, bear, synthesis = run_debate(self.research, ticker, reports, self.memory.recent_lessons("all"))
            else:
                bull, bear, synthesis = fallback_debate(ticker, reports)
            for report in (bull, bear, synthesis):
                self.memory.save_report(run_id, report)
            trade = plan_trade(snapshot, synthesis, self.settings)
            risk = risk_review(snapshot, reports, synthesis, trade, self.settings)
            portfolio = portfolio_review(ticker, trade, risk, self.memory.positions(), self.settings)
            approved = bool(risk["approved"] and portfolio["approved"])
            action = trade["action"] if approved else ("WATCH" if trade["action"] == "IDEA" else trade["action"])
            technical = next(report for report in reports if report["role"] == "price_action")
            chart_explanation = (
                technical.get("evidence", [])[:3] + synthesis.get("evidence", [])[:2]
                if approved
                else risk["veto_reasons"][:4]
            )
            decision = {
                "run_id": run_id,
                "symbol": ticker,
                "action": action,
                "approved": approved,
                "entry_price": trade["entry_price"],
                "stop_price": trade["stop_price"],
                "target_position_pct": portfolio["final_position_pct"],
                "confidence": synthesis["confidence"],
                "thesis": synthesis["thesis"],
                "veto_reasons": risk["veto_reasons"] + portfolio["reasons"],
                "market_snapshot": snapshot,
                "analyst_reports": reports,
                "debate": {"bull": bull, "bear": bear, "synthesis": synthesis},
                "trade_plan": trade,
                "risk_review": risk,
                "portfolio_review": portfolio,
                "chart": {
                    "series": snapshot.get("history", []),
                    "levels": {
                        "reference": trade["entry_price"],
                        "risk": trade["stop_price"],
                        "target_1": trade["target_1"],
                        "target_2": trade["target_2"],
                    },
                    "target_upside_pct": {
                        "target_1": trade["target_1_upside_pct"],
                        "target_2": trade["target_2_upside_pct"],
                    },
                    "stance": action,
                    "explanation": chart_explanation,
                    "method": "Risk level is two 14-day average ranges below the reference price; scenario targets are 2R and 3R above it.",
                },
                "read_only": True,
                "order_submission_supported": False,
            }
            decision_id = self.memory.save_decision(run_id, decision)
            decision["decision_id"] = decision_id
            self.memory.complete_run(run_id, snapshot)
            return decision
        except Exception as exc:
            self.memory.fail_run(run_id, str(exc))
            raise

    def discover(self, *, limit: int = 8, universe: list[str] | None = None) -> dict[str, Any]:
        """Rank a liquid stock universe for further research using current market data."""
        symbols = list(dict.fromkeys(symbol.upper().strip() for symbol in (universe or DEFAULT_UNIVERSE) if symbol.strip()))
        if not symbols:
            raise ValueError("The discovery universe is empty")
        if len(symbols) > 100:
            raise ValueError("Discovery is limited to 100 symbols per scan")
        candidates: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        with ThreadPoolExecutor(max_workers=min(8, len(symbols)), thread_name_prefix="market-scan") as pool:
            futures = {pool.submit(self.market.snapshot, symbol): symbol for symbol in symbols}
            for future in as_completed(futures):
                symbol = futures[future]
                try:
                    snapshot = future.result()
                    candidates.append(self._score_candidate(snapshot))
                except Exception as exc:
                    errors.append({"symbol": symbol, "error": str(exc)})
        candidates.sort(key=lambda candidate: candidate["score"], reverse=True)
        bounded_limit = max(1, min(int(limit), 25))
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "universe_size": len(symbols),
            "successful": len(candidates),
            "candidates": candidates[:bounded_limit],
            "errors": errors,
            "method": "Transparent technical pre-screen: trend, 20/60-day momentum, volume participation, and volatility penalty.",
            "next_step": "Run the full committee on a candidate before treating it as actionable.",
            "read_only": True,
            "order_submission_supported": False,
        }

    @staticmethod
    def _score_candidate(snapshot: dict[str, Any]) -> dict[str, Any]:
        price = float(snapshot["price"])
        sma20 = float(snapshot["sma_20"])
        sma50 = float(snapshot["sma_50"] or sma20)
        r20 = float(snapshot["return_20d_pct"])
        r60 = float(snapshot["return_60d_pct"])
        volume_ratio = float(snapshot["volume_ratio_5d_to_20d"])
        volatility = float(snapshot["annualized_volatility_pct"])
        score = 50.0
        reasons: list[str] = []
        cautions: list[str] = []
        if price > sma20:
            score += 10
            reasons.append("Trading above its 20-day average")
        else:
            score -= 10
            cautions.append("Trading below its 20-day average")
        if sma20 > sma50:
            score += 10
            reasons.append("20-day trend is above the 50-day trend")
        else:
            score -= 10
            cautions.append("Intermediate trend has not turned positive")
        score += max(-15, min(15, r20 / 1.5))
        score += max(-10, min(10, r60 / 3.0))
        score += max(-5, min(5, (volume_ratio - 1) * 10))
        volatility_penalty = max(0, min(20, (volatility - 35) * 0.25))
        score -= volatility_penalty
        if r20 > 0:
            reasons.append(f"Positive 20-day momentum of {r20:.1f}%")
        else:
            cautions.append(f"Negative 20-day momentum of {r20:.1f}%")
        if volume_ratio >= 1.15:
            reasons.append(f"Recent volume is {volume_ratio:.2f}× baseline")
        if volatility > 55:
            cautions.append(f"Elevated annualized volatility of {volatility:.1f}%")
        score = round(max(0, min(100, score)), 1)
        label = "Strong research candidate" if score >= 70 else "Research candidate" if score >= 60 else "Watch only"
        return {
            "symbol": snapshot["symbol"],
            "score": score,
            "label": label,
            "price": price,
            "return_1d_pct": snapshot["return_1d_pct"],
            "return_20d_pct": r20,
            "return_60d_pct": r60,
            "annualized_volatility_pct": volatility,
            "reasons": reasons[:4],
            "cautions": cautions[:3],
            "market_time": snapshot["market_time"],
        }

    def grade(self, decision_id: int) -> dict[str, Any]:
        decision = self.memory.get_decision(decision_id)
        if not decision:
            raise ValueError(f"Decision {decision_id} does not exist")
        snapshot = self.market.snapshot(decision["symbol"])
        observed = float(snapshot["price"])
        entry = float(decision["entry_price"])
        return_pct = (observed / entry - 1) * 100
        action = decision["action"]
        effective = return_pct if action == "IDEA" else -return_pct if action == "PASS" else -abs(return_pct) * 0.25
        if effective >= 15:
            grade = "A"
        elif effective >= 7:
            grade = "B"
        elif effective >= -3:
            grade = "C"
        elif effective >= -10:
            grade = "D"
        else:
            grade = "F"
        if grade in ("A", "B"):
            lesson = f"{action} on {decision['symbol']} was directionally sound; preserve the evidence chain that supported it."
            weight = 1.0
        else:
            lesson = f"{action} on {decision['symbol']} underperformed; re-check confidence calibration, invalidation, and crowding before similar calls."
            weight = 1.5
        evaluation = {
            "decision_id": decision_id,
            "symbol": decision["symbol"],
            "action": action,
            "entry_price": entry,
            "observed_price": observed,
            "return_pct": round(return_pct, 3),
            "grade": grade,
            "lesson": lesson,
            "lesson_weight": weight,
            "market_snapshot": snapshot,
        }
        self.memory.save_evaluation(decision_id, evaluation)
        return evaluation
