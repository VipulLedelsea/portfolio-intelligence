from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from .clients import ResearchClient


RESEARCH_MANDATES = {
    "fundamentals": """You are the fundamentals analyst on an institutional investment committee.
Use current primary sources where possible: company filings, earnings materials, and investor relations pages.
Assess revenue quality, margins, cash generation, balance sheet, capital allocation, valuation, and estimate direction.
Separate facts from inference. Cite URLs in sources. Score 0 as deeply unattractive and 100 as exceptionally attractive.
Set data_complete false if you cannot verify material claims with current sources.""",
    "news": """You are the breaking-news and catalysts analyst on an institutional investment committee.
Find material developments from the last 90 days and distinguish event date from publication date.
Assess earnings, guidance, regulation, management, litigation, supply chain, and competitive events.
Prefer company, regulator, and other primary sources. Cite URLs in sources. Score 0 as severely negative and 100 as strongly positive.
Set data_complete false when current material news cannot be verified.""",
    "sentiment": """You are the market narrative and sentiment analyst on an institutional investment committee.
Assess narrative direction, crowding, attention velocity, analyst revisions, and disagreement. Never treat social popularity as truth.
Use current public evidence and cite URLs. Call out manipulation risk and thin evidence. Score 0 as extremely negative and 100 as extremely positive.
Set data_complete false when sentiment evidence is too sparse or stale.""",
}


DEBATE_MANDATES = {
    "bull": """You are the bull advocate. Using only the supplied research packet, construct the strongest evidence-based case for owning the security.
Identify what must go right, the highest-quality evidence, upside drivers, and what evidence would strengthen the thesis.
Do not invent facts or sources. Your score is conviction in the bull case after considering the reported risks.""",
    "bear": """You are the bear advocate. Using only the supplied research packet, attack the proposed investment.
Surface hidden assumptions, permanent-loss paths, crowding, accounting or execution risks, and the fastest plausible thesis break.
Do not invent facts or sources. Your score is severity of downside risk, where 100 is most severe.""",
    "synthesis": """You chair the investment committee. Steelman both supplied debate positions before deciding.
Your score is the attractiveness of the market snapshot's proposed Supertrend direction, 0 to 100: LONG means owning the security and SHORT means expressing a bearish trade. Your confidence must reflect evidence quality and disagreement.
State a concise directional thesis and the decisive invalidation conditions. Use only supplied evidence and sources.""",
}


def technical_report(snapshot: dict[str, Any]) -> dict[str, Any]:
    price = float(snapshot["price"])
    sma20 = float(snapshot["sma_20"])
    sma50 = float(snapshot["sma_50"] or sma20)
    r20 = float(snapshot["return_20d_pct"])
    r60 = float(snapshot["return_60d_pct"])
    volume_ratio = float(snapshot["volume_ratio_5d_to_20d"])
    supertrend = snapshot.get("supertrend") or {}
    direction = str(supertrend.get("direction", "LONG")).upper()
    sign = 1 if direction == "LONG" else -1
    score = 50.0
    evidence: list[str] = [
        f"One-hour Supertrend is {direction} at ${float(supertrend.get('value', price)):.2f}."
    ]
    if (price - sma20) * sign > 0:
        score += 10
        evidence.append(f"Price versus the 20-day average supports the {direction.lower()} setup.")
    else:
        score -= 10
        evidence.append(f"Price versus the 20-day average conflicts with the {direction.lower()} setup.")
    if (sma20 - sma50) * sign > 0:
        score += 10
        evidence.append(f"The daily moving-average structure supports the {direction.lower()} setup.")
    else:
        score -= 10
        evidence.append(f"The daily moving-average structure conflicts with the {direction.lower()} setup.")
    score += max(-15, min(15, r20 * sign / 2))
    score += max(-10, min(10, r60 * sign / 4))
    if volume_ratio > 1.2:
        evidence.append(f"Recent volume is {volume_ratio:.2f}× the prior 20-day baseline.")
    risks = []
    if snapshot["annualized_volatility_pct"] > 60:
        risks.append(f"Annualized volatility is elevated at {snapshot['annualized_volatility_pct']:.1f}%.")
    if r20 * sign > 20:
        risks.append("The directional 20-day move is extended and vulnerable to mean reversion.")
    if not supertrend.get("is_confirmed", True):
        risks.append("The current one-hour Supertrend bar is provisional until it closes.")
    return {
        "role": "price_action",
        "symbol": snapshot["symbol"],
        "score": round(max(0, min(100, score)), 2),
        "confidence": 0.86,
        "thesis": f"The one-hour {direction.lower()} setup is technically supported." if score >= 60 else f"The one-hour {direction.lower()} setup has conflicting technical evidence.",
        "evidence": evidence,
        "risks": risks or ["Technical signals can reverse without changes in fundamentals."],
        "sources": ["Robinhood market data"],
        "as_of": snapshot["fetched_at"],
        "data_complete": bool(snapshot.get("data_complete")),
    }


def run_research_agents(
    client: ResearchClient,
    symbol: str,
    snapshot: dict[str, Any],
    lessons_by_role: dict[str, list[str]],
) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = [technical_report(snapshot)]
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="analyst") as pool:
        futures = {
            pool.submit(
                client.report,
                role=role,
                symbol=symbol,
                instructions=mandate,
                context={"market_snapshot": snapshot, "past_lessons": lessons_by_role.get(role, [])},
                use_web=True,
            ): role
            for role, mandate in RESEARCH_MANDATES.items()
        }
        for future in as_completed(futures):
            role = futures[future]
            try:
                reports.append(future.result())
            except Exception as exc:
                reports.append({
                    "role": role,
                    "symbol": symbol,
                    "score": 50,
                    "confidence": 0,
                    "thesis": f"{role.title()} agent failed safely.",
                    "evidence": [],
                    "risks": [str(exc)],
                    "sources": [],
                    "as_of": datetime.now(timezone.utc).isoformat(),
                    "data_complete": False,
                })
    return sorted(reports, key=lambda report: report["role"])


def run_debate(client: ResearchClient, symbol: str, reports: list[dict[str, Any]], lessons: list[str]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    packet = {"analyst_reports": reports, "past_lessons": lessons}
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="debate") as pool:
        bull_future = pool.submit(client.report, role="bull", symbol=symbol, instructions=DEBATE_MANDATES["bull"], context=packet, use_web=False)
        bear_future = pool.submit(client.report, role="bear", symbol=symbol, instructions=DEBATE_MANDATES["bear"], context=packet, use_web=False)
        bull = bull_future.result()
        bear = bear_future.result()
    synthesis = client.report(
        role="synthesis",
        symbol=symbol,
        instructions=DEBATE_MANDATES["synthesis"],
        context={"analyst_reports": reports, "bull_case": bull, "bear_case": bear, "past_lessons": lessons},
        use_web=False,
    )
    return bull, bear, synthesis


def fallback_debate(symbol: str, reports: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    avg_score = sum(float(report["score"]) for report in reports) / max(1, len(reports))
    complete = all(report.get("data_complete", False) for report in reports)
    now = datetime.now(timezone.utc).isoformat()
    bull = {
        "role": "bull", "symbol": symbol, "score": avg_score, "confidence": 0.2,
        "thesis": "The bullish case is limited to the available quantitative trend evidence.",
        "evidence": [item for report in reports for item in report.get("evidence", [])][:5],
        "risks": ["External research is incomplete."], "sources": [], "as_of": now, "data_complete": complete,
    }
    bear = {
        "role": "bear", "symbol": symbol, "score": 100 - avg_score, "confidence": 0.8,
        "thesis": "Incomplete research is itself a reason not to commit capital.",
        "evidence": ["One or more required research agents returned incomplete data."],
        "risks": [item for report in reports for item in report.get("risks", [])][:5],
        "sources": [], "as_of": now, "data_complete": complete,
    }
    synthesis = {
        "role": "synthesis", "symbol": symbol, "score": avg_score, "confidence": 0.2,
        "thesis": "No actionable recommendation until the evidence packet is complete.",
        "evidence": bull["evidence"], "risks": bear["risks"], "sources": [], "as_of": now, "data_complete": complete,
    }
    return bull, bear, synthesis
