import tempfile
import unittest
from pathlib import Path

from portfolio_intel.config import Settings
from portfolio_intel.engine import PortfolioEngine
from portfolio_intel.memory import MemoryStore


class FakeMarket:
    def snapshot(self, symbol):
        return {
            "symbol": symbol, "currency": "USD", "exchange": "TEST", "price": 100.0,
            "previous_close": 99.0, "return_1d_pct": 1.0, "return_5d_pct": 4.0,
            "return_20d_pct": 8.0, "return_60d_pct": 14.0, "sma_20": 95.0,
            "sma_50": 90.0, "annualized_volatility_pct": 35.0, "atr_14": 3.0,
            "atr_14_pct": 3.0, "volume_ratio_5d_to_20d": 1.3,
            "market_time": "2026-09-20T12:00:00+00:00", "fetched_at": "2026-09-20T12:01:00+00:00",
            "data_complete": True,
        }


class RankedFakeMarket(FakeMarket):
    def snapshot(self, symbol):
        value = super().snapshot(symbol)
        adjustments = {
            "LEAD": {"return_20d_pct": 18.0, "return_60d_pct": 28.0, "volume_ratio_5d_to_20d": 1.5},
            "LAG": {"price": 80.0, "return_20d_pct": -12.0, "return_60d_pct": -18.0, "annualized_volatility_pct": 70.0},
        }
        value.update(adjustments.get(symbol, {}))
        value["symbol"] = symbol
        return value


class FakeResearch:
    def __init__(self, score=75, confidence=0.8, complete=True):
        self.score = score
        self.confidence = confidence
        self.complete = complete

    def report(self, *, role, symbol, instructions, context, use_web):
        score = 72 if role == "bear" else self.score
        return {
            "role": role, "symbol": symbol, "score": score, "confidence": self.confidence,
            "thesis": f"Evidence-backed {role} thesis", "evidence": ["Verified evidence"],
            "risks": ["Known risk"], "sources": ["https://example.com/source"],
            "as_of": "2026-09-20T12:00:00+00:00", "data_complete": self.complete,
        }


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db = Path(self.tempdir.name) / "memory.db"

    def tearDown(self):
        self.tempdir.cleanup()

    def test_complete_evidence_can_pass_governance(self):
        engine = PortfolioEngine(memory=MemoryStore(self.db), market=FakeMarket(), research=FakeResearch())
        decision = engine.analyze("TEST")
        self.assertTrue(decision["approved"])
        self.assertEqual(decision["action"], "BUY")
        self.assertGreater(decision["target_position_pct"], 0)
        self.assertEqual(len(engine.memory.history()), 1)

    def test_incomplete_research_is_vetoed(self):
        engine = PortfolioEngine(memory=MemoryStore(self.db), market=FakeMarket(), research=FakeResearch(complete=False))
        decision = engine.analyze("TEST")
        self.assertFalse(decision["approved"])
        self.assertEqual(decision["target_position_pct"], 0)
        self.assertTrue(any("Incomplete required research" in reason for reason in decision["veto_reasons"]))

    def test_grading_creates_memory_lesson(self):
        engine = PortfolioEngine(memory=MemoryStore(self.db), market=FakeMarket(), research=FakeResearch())
        decision = engine.analyze("TEST")
        grade = engine.grade(decision["decision_id"])
        self.assertEqual(grade["grade"], "C")
        self.assertEqual(len(engine.memory.recent_lessons("all")), 1)

    def test_discovery_ranks_stronger_candidate_first(self):
        engine = PortfolioEngine(memory=MemoryStore(self.db), market=RankedFakeMarket(), research=FakeResearch())
        result = engine.discover(limit=2, universe=["LAG", "LEAD"])
        self.assertEqual(result["candidates"][0]["symbol"], "LEAD")
        self.assertGreater(result["candidates"][0]["score"], result["candidates"][1]["score"])
        self.assertTrue(result["paper_only"])


if __name__ == "__main__":
    unittest.main()
