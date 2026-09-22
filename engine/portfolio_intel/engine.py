from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from .agents import fallback_debate, run_debate, run_research_agents
from .clients import MarketDataClient, OpenAIResearchClient, ResearchClient, SafeFallbackResearchClient, SP500UniverseClient
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
        universe_client: SP500UniverseClient | Any | None = None,
    ) -> None:
        self.settings = settings or Settings.load()
        self.memory = memory or MemoryStore(os.environ.get("PORTFOLIO_INTEL_DB", "portfolio_memory.db"))
        self.market = market or MarketDataClient()
        self.universe_client = universe_client or SP500UniverseClient()
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
            supertrend = snapshot.get("supertrend", {})
            chart_explanation.insert(
                0,
                f"Supertrend ({supertrend.get('period', 10)}, {supertrend.get('multiplier', 3)}) is "
                f"{trade['direction']} at ${float(supertrend.get('value', snapshot['price'])):.2f}.",
            )
            if not supertrend.get("is_confirmed", True):
                if supertrend.get("direction") != supertrend.get("confirmed_direction"):
                    chart_explanation.insert(
                        1,
                        f"Today's live daily bar has provisionally flipped from "
                        f"{supertrend.get('confirmed_direction')} to {supertrend.get('direction')}; confirm at the close.",
                    )
                else:
                    chart_explanation.insert(1, "Today's live daily bar agrees with the last confirmed signal.")
            decision = {
                "run_id": run_id,
                "symbol": ticker,
                "action": action,
                "direction": trade["direction"],
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
                    "source": snapshot.get("data_source", "Market data"),
                    "source_detail": snapshot.get("data_source_detail", "Daily OHLCV bars"),
                    "supertrend": supertrend,
                    "levels": {
                        "reference": trade["entry_price"],
                        "risk": trade["stop_price"],
                        "target_1": trade["target_1"],
                        "target_2": trade["target_2"],
                    },
                    "target_return_pct": {
                        "target_1": trade["target_1_return_pct"],
                        "target_2": trade["target_2_return_pct"],
                    },
                    "direction": trade["direction"],
                    "stance": action,
                    "explanation": chart_explanation,
                    "method": (
                        f"{trade['direction']} scenario: risk is two 14-day average ranges against the setup; "
                        "targets are 2R and 3R in the signal direction."
                    ),
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

    def discover(self, *, limit: int = 20, universe: list[str] | None = None) -> dict[str, Any]:
        """Rank the S&P 500 or an explicit universe using current market data."""
        if universe is None:
            constituent_records = self.universe_client.constituents()
            universe_name = "S&P 500"
            universe_source = getattr(self.universe_client, "source_url", None)
        else:
            constituent_records = [
                {"symbol": symbol.upper().strip(), "index_symbol": symbol.upper().strip(), "company": symbol.upper().strip(), "sector": "Unknown"}
                for symbol in universe if symbol.strip()
            ]
            universe_name = "Custom universe"
            universe_source = None
        symbols = list(dict.fromkeys(record["symbol"] for record in constituent_records if record["symbol"]))
        metadata = {record["symbol"]: record for record in constituent_records}
        if not symbols:
            raise ValueError("The discovery universe is empty")
        if len(symbols) > 600:
            raise ValueError("Discovery is limited to 600 symbols per scan")
        candidates: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        if hasattr(self.market, "snapshots"):
            snapshots, errors = self.market.snapshots(symbols)
            for symbol, snapshot in snapshots.items():
                candidates.append(self._score_candidate(snapshot, metadata.get(symbol)))
        else:
            with ThreadPoolExecutor(max_workers=min(16, len(symbols)), thread_name_prefix="market-scan") as pool:
                futures = {pool.submit(self.market.snapshot, symbol): symbol for symbol in symbols}
                for future in as_completed(futures):
                    symbol = futures[future]
                    try:
                        snapshot = future.result()
                        candidates.append(self._score_candidate(snapshot, metadata.get(symbol)))
                    except Exception as exc:
                        errors.append({"symbol": symbol, "error": str(exc)})
        candidates.sort(key=lambda candidate: (-candidate["score"], candidate["symbol"]))
        bounded_limit = max(1, min(int(limit), 50))
        long_candidates = sorted(
            (candidate for candidate in candidates if candidate["direction"] == "LONG"),
            key=lambda candidate: (-candidate["long_score"], candidate["symbol"]),
        )
        short_candidates = sorted(
            (candidate for candidate in candidates if candidate["direction"] == "SHORT"),
            key=lambda candidate: (-candidate["short_score"], candidate["symbol"]),
        )
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "universe_name": universe_name,
            "universe_source": universe_source,
            "market_data_source": getattr(self.market, "provider_name", "Market data"),
            "universe_size": len(symbols),
            "successful": len(candidates),
            "candidates": candidates[:bounded_limit],
            "long_candidates": long_candidates[:bounded_limit],
            "short_candidates": short_candidates[:bounded_limit],
            "direction_counts": {"LONG": len(long_candidates), "SHORT": len(short_candidates)},
            "errors": errors,
            "method": "Directional pre-screen: daily Supertrend (10, 3), trend, 20/60-day momentum, volume participation, and volatility. Live-bar flips remain provisional until the close.",
            "next_step": "Run the full committee on a candidate before treating it as actionable.",
            "read_only": True,
            "order_submission_supported": False,
        }

    @staticmethod
    def _score_candidate(snapshot: dict[str, Any], metadata: dict[str, str] | None = None) -> dict[str, Any]:
        price = float(snapshot["price"])
        sma20 = float(snapshot["sma_20"])
        sma50 = float(snapshot["sma_50"] or sma20)
        r20 = float(snapshot["return_20d_pct"])
        r60 = float(snapshot["return_60d_pct"])
        volume_ratio = float(snapshot["volume_ratio_5d_to_20d"])
        volatility = float(snapshot["annualized_volatility_pct"])
        supertrend = snapshot.get("supertrend") or {}
        supertrend_direction = str(supertrend.get("direction") or ("LONG" if price >= sma20 else "SHORT")).upper()
        long_score = 50.0
        short_score = 50.0
        reasons: list[str] = []
        cautions: list[str] = []
        if price > sma20:
            long_score += 8
            short_score -= 8
        else:
            long_score -= 8
            short_score += 8
        if sma20 > sma50:
            long_score += 8
            short_score -= 8
        else:
            long_score -= 8
            short_score += 8
        long_score += max(-10, min(10, r20 / 3.0))
        long_score += max(-8, min(8, r60 / 6.0))
        short_score += max(-10, min(10, -r20 / 3.0))
        short_score += max(-8, min(8, -r60 / 6.0))
        participation = max(-3, min(3, (volume_ratio - 1) * 6))
        long_score += participation
        short_score += participation
        if supertrend_direction == "LONG":
            long_score += 12
            short_score -= 12
        else:
            long_score -= 12
            short_score += 12
        volatility_penalty = max(0, min(20, (volatility - 35) * 0.25))
        long_score -= volatility_penalty
        short_score -= volatility_penalty
        long_score = round(max(0, min(100, long_score)), 1)
        short_score = round(max(0, min(100, short_score)), 1)
        direction = supertrend_direction if supertrend_direction in ("LONG", "SHORT") else (
            "LONG" if long_score >= short_score else "SHORT"
        )
        score = long_score if direction == "LONG" else short_score
        line_value = float(supertrend.get("value") or price)
        signal_age = int(supertrend.get("bars_since_flip") or 0)
        is_confirmed = bool(supertrend.get("is_confirmed", True))
        confirmed_direction = str(supertrend.get("confirmed_direction") or supertrend_direction).upper()
        if not is_confirmed and supertrend_direction != confirmed_direction:
            reasons.append(
                f"Live Supertrend is provisionally {supertrend_direction} at ${line_value:.2f}"
            )
            cautions.append(
                f"Latest confirmed daily signal is {confirmed_direction}; wait for the close to confirm the flip"
            )
            long_score -= 8
            short_score -= 8
            score = long_score if direction == "LONG" else short_score
        elif not is_confirmed:
            reasons.append(f"Live Supertrend remains {supertrend_direction} at ${line_value:.2f}")
        else:
            reasons.append(f"Confirmed Supertrend (10, 3) is {supertrend_direction} at ${line_value:.2f}")
        if bool(supertrend.get("flipped_today")):
            reasons.append(f"Fresh {supertrend_direction.lower()} signal on the latest daily bar")
        else:
            reasons.append(f"Signal has held for {signal_age + 1} daily bars")
        if direction == "LONG":
            (reasons if price > sma20 else cautions).append("Price is above its 20-day average" if price > sma20 else "Price is below its 20-day average")
            (reasons if sma20 > sma50 else cautions).append("20-day trend is above the 50-day trend" if sma20 > sma50 else "20-day trend is below the 50-day trend")
            (reasons if r20 > 0 else cautions).append(f"20-day momentum is {r20:+.1f}%")
        else:
            (reasons if price < sma20 else cautions).append("Price is below its 20-day average" if price < sma20 else "Price remains above its 20-day average")
            (reasons if sma20 < sma50 else cautions).append("20-day trend is below the 50-day trend" if sma20 < sma50 else "20-day trend remains above the 50-day trend")
            (reasons if r20 < 0 else cautions).append(f"20-day momentum is {r20:+.1f}%")
        if volume_ratio >= 1.15:
            reasons.append(f"Recent volume is {volume_ratio:.2f}× baseline")
        if volatility > 55:
            cautions.append(f"Elevated annualized volatility of {volatility:.1f}%")
        score = round(max(0, min(100, score)), 1)
        long_score = round(max(0, min(100, long_score)), 1)
        short_score = round(max(0, min(100, short_score)), 1)
        strength = "Strong" if score >= 70 else "Developing" if score >= 60 else "Weak"
        label = (
            f"Provisional {direction.lower()} flip"
            if not is_confirmed and supertrend_direction != confirmed_direction
            else f"{strength} {direction.lower()} setup"
        )
        return {
            "symbol": snapshot["symbol"],
            "company": (metadata or {}).get("company", snapshot["symbol"]),
            "sector": (metadata or {}).get("sector", "Unknown"),
            "score": score,
            "long_score": long_score,
            "short_score": short_score,
            "direction": direction,
            "label": label,
            "price": price,
            "return_1d_pct": snapshot["return_1d_pct"],
            "return_20d_pct": r20,
            "return_60d_pct": r60,
            "annualized_volatility_pct": volatility,
            "supertrend_value": line_value,
            "supertrend_direction": supertrend_direction,
            "supertrend_confirmed_direction": confirmed_direction,
            "supertrend_is_confirmed": is_confirmed,
            "supertrend_flipped_today": bool(supertrend.get("flipped_today")),
            "signal_age_bars": signal_age,
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
        direction = str(decision.get("direction", "LONG"))
        directional_return = -return_pct if direction == "SHORT" else return_pct
        effective = directional_return if action == "IDEA" else -directional_return if action == "PASS" else -abs(directional_return) * 0.25
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
            "direction": direction,
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
