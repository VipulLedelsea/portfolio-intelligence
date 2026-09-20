from __future__ import annotations

import os
from typing import Any

from .agents import fallback_debate, run_debate, run_research_agents
from .clients import MarketDataClient, OpenAIResearchClient, ResearchClient, SafeFallbackResearchClient
from .config import Settings
from .governance import plan_trade, portfolio_review, risk_review
from .memory import MemoryStore


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
            action = trade["action"] if approved else ("WATCH" if trade["action"] == "BUY" else trade["action"])
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
                "paper_only": True,
            }
            decision_id = self.memory.save_decision(run_id, decision)
            decision["decision_id"] = decision_id
            self.memory.complete_run(run_id, snapshot)
            return decision
        except Exception as exc:
            self.memory.fail_run(run_id, str(exc))
            raise

    def grade(self, decision_id: int) -> dict[str, Any]:
        decision = self.memory.get_decision(decision_id)
        if not decision:
            raise ValueError(f"Decision {decision_id} does not exist")
        snapshot = self.market.snapshot(decision["symbol"])
        observed = float(snapshot["price"])
        entry = float(decision["entry_price"])
        return_pct = (observed / entry - 1) * 100
        action = decision["action"]
        effective = return_pct if action == "BUY" else -return_pct if action == "PASS" else -abs(return_pct) * 0.25
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

