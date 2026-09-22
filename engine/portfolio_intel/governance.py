from __future__ import annotations

from typing import Any

from .config import Settings


def plan_trade(snapshot: dict[str, Any], synthesis: dict[str, Any], settings: Settings) -> dict[str, Any]:
    price = float(snapshot["price"])
    atr = max(float(snapshot.get("signal_atr_14", snapshot["atr_14"])), price * 0.0025)
    stop_distance = max(2 * atr, price * 0.0125)
    direction = str(snapshot.get("supertrend", {}).get("direction", "LONG")).upper()
    if direction == "SHORT":
        stop = price + stop_distance
        target_1 = max(0.01, price - stop_distance * 2)
        target_2 = max(0.01, price - stop_distance * 3)
    else:
        direction = "LONG"
        stop = max(0.01, price - stop_distance)
        target_1 = price + stop_distance * 2
        target_2 = price + stop_distance * 3
    risk_budget = settings.starting_equity * settings.risk_per_trade_pct / 100
    notional = risk_budget / (stop_distance / price)
    size_pct = min(settings.max_position_pct, notional / settings.starting_equity * 100)
    confidence = float(synthesis["confidence"])
    score = float(synthesis["score"])
    if score >= 65 and confidence >= settings.minimum_confidence:
        action = "IDEA"
    elif score >= 50:
        action = "WATCH"
        size_pct = 0.0
    else:
        action = "PASS"
        size_pct = 0.0
    return {
        "action": action,
        "direction": direction,
        "entry_price": round(price, 4),
        "stop_price": round(stop, 4),
        "target_position_pct": round(size_pct, 3),
        "target_1": round(target_1, 4),
        "target_2": round(target_2, 4),
        "target_1_return_pct": round(((target_1 / price) - 1) * 100, 2),
        "target_2_return_pct": round(((target_2 / price) - 1) * 100, 2),
        "target_1_upside_pct": round(((target_1 / price) - 1) * 100, 2),
        "target_2_upside_pct": round(((target_2 / price) - 1) * 100, 2),
        "research_note": "Reference levels are for risk framing only; the application has no order capability.",
    }


def risk_review(
    snapshot: dict[str, Any],
    reports: list[dict[str, Any]],
    synthesis: dict[str, Any],
    plan: dict[str, Any],
    settings: Settings,
) -> dict[str, Any]:
    reasons: list[str] = []
    incomplete_roles = [report["role"] for report in reports if not report.get("data_complete", False)]
    if incomplete_roles:
        reasons.append("Incomplete required research: " + ", ".join(sorted(incomplete_roles)))
    low_scores = [report["role"] for report in reports if float(report["score"]) < settings.minimum_research_score]
    if low_scores:
        reasons.append("Research below minimum score: " + ", ".join(sorted(low_scores)))
    if float(synthesis["confidence"]) < settings.minimum_confidence:
        reasons.append(f"Confidence {synthesis['confidence']:.0%} is below the {settings.minimum_confidence:.0%} minimum")
    if float(snapshot["annualized_volatility_pct"]) > settings.max_annualized_volatility_pct:
        reasons.append(
            f"Annualized volatility {snapshot['annualized_volatility_pct']:.1f}% exceeds the "
            f"{settings.max_annualized_volatility_pct:.1f}% limit"
        )
    if float(plan["target_position_pct"]) > settings.max_position_pct:
        reasons.append("Proposed position exceeds the configured position cap")
    if plan["action"] != "IDEA":
        reasons.append(f"Research stance is {plan['action']}, not IDEA")
    return {
        "approved": not reasons,
        "veto_reasons": reasons,
        "reviewed_position_pct": min(float(plan["target_position_pct"]), settings.max_position_pct) if not reasons else 0.0,
        "authority": "Risk owns the final veto; no downstream agent may override it.",
    }


def portfolio_review(symbol: str, plan: dict[str, Any], risk: dict[str, Any], positions: list[dict[str, Any]], settings: Settings) -> dict[str, Any]:
    reasons: list[str] = []
    existing = next((position for position in positions if position["symbol"] == symbol), None)
    if existing and float(existing["shares"]) > 0:
        reasons.append("An existing position is recorded; addition requires explicit portfolio context")
    if not risk["approved"]:
        reasons.append("Risk veto is active")
    approved = not reasons and plan["action"] == "IDEA"
    return {
        "approved": approved,
        "reasons": reasons,
        "final_position_pct": risk["reviewed_position_pct"] if approved else 0.0,
        "portfolio_note": "Cleared as a research idea." if approved else "Not cleared as a research idea.",
    }
