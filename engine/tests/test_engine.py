import tempfile
import unittest
from pathlib import Path

from portfolio_intel.config import Settings
from portfolio_intel.clients import MarketDataClient
from portfolio_intel.engine import PortfolioEngine
from portfolio_intel.memory import MemoryStore


class FakeMarket:
    provider_name = "Test market data"

    def snapshot(self, symbol):
        return {
            "symbol": symbol, "currency": "USD", "exchange": "TEST", "price": 100.0,
            "previous_close": 99.0, "return_1d_pct": 1.0, "return_5d_pct": 4.0,
            "return_20d_pct": 8.0, "return_60d_pct": 14.0, "sma_20": 95.0,
            "sma_50": 90.0, "annualized_volatility_pct": 35.0, "atr_14": 3.0,
            "atr_14_pct": 3.0, "volume_ratio_5d_to_20d": 1.3,
            "market_time": "2026-09-20T12:00:00+00:00", "fetched_at": "2026-09-20T12:01:00+00:00",
            "data_complete": True,
            "data_source": "Test market data",
            "data_source_detail": "Fixed daily OHLCV bars",
            "supertrend": {"period": 10, "multiplier": 3.0, "direction": "LONG", "value": 92.0, "distance_pct": 8.7, "flipped_today": False, "bars_since_flip": 8, "is_confirmed": True, "confirmed_direction": "LONG"},
            "history": [
                {"date": f"2026-08-{day:02d}", "open": 89.5 + day / 3, "close": 90.0 + day / 3, "high": 91.0 + day / 3, "low": 89.0 + day / 3, "volume": 1_000_000, "supertrend": 87.0 + day / 3, "supertrend_direction": "LONG"}
                for day in range(1, 29)
            ],
        }


class RankedFakeMarket(FakeMarket):
    def snapshot(self, symbol):
        value = super().snapshot(symbol)
        adjustments = {
            "LEAD": {"return_20d_pct": 18.0, "return_60d_pct": 28.0, "volume_ratio_5d_to_20d": 1.5},
            "LAG": {"price": 80.0, "sma_20": 88.0, "sma_50": 94.0, "return_20d_pct": -12.0, "return_60d_pct": -18.0, "annualized_volatility_pct": 45.0, "supertrend": {"period": 10, "multiplier": 3.0, "direction": "SHORT", "value": 89.0, "distance_pct": -10.1, "flipped_today": False, "bars_since_flip": 5}},
            "SHORT": {"price": 80.0, "sma_20": 88.0, "sma_50": 94.0, "return_20d_pct": -12.0, "return_60d_pct": -18.0, "supertrend": {"period": 10, "multiplier": 3.0, "direction": "SHORT", "value": 89.0, "distance_pct": -10.1, "flipped_today": True, "bars_since_flip": 0}},
        }
        value.update(adjustments.get(symbol, {}))
        value["symbol"] = symbol
        return value


class FakeUniverse:
    source_url = "https://example.com/sp500.csv"

    def constituents(self):
        return [
            {"symbol": f"S{index:03d}", "index_symbol": f"S{index:03d}", "company": f"Company {index}", "sector": "Test sector"}
            for index in range(25)
        ]


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
        self.assertEqual(decision["action"], "IDEA")
        self.assertGreater(decision["target_position_pct"], 0)
        self.assertTrue(decision["read_only"])
        self.assertFalse(decision["order_submission_supported"])
        self.assertEqual(decision["chart"]["stance"], "IDEA")
        self.assertEqual(decision["direction"], "LONG")
        self.assertEqual(decision["chart"]["supertrend"]["direction"], "LONG")
        self.assertGreater(decision["chart"]["levels"]["target_1"], decision["entry_price"])
        self.assertGreater(decision["chart"]["levels"]["target_2"], decision["chart"]["levels"]["target_1"])
        self.assertEqual(len(engine.memory.history()), 1)

    def test_short_supertrend_reverses_risk_and_target_levels(self):
        engine = PortfolioEngine(memory=MemoryStore(self.db), market=RankedFakeMarket(), research=FakeResearch())
        decision = engine.analyze("SHORT")
        self.assertEqual(decision["direction"], "SHORT")
        self.assertGreater(decision["stop_price"], decision["entry_price"])
        self.assertLess(decision["chart"]["levels"]["target_1"], decision["entry_price"])
        self.assertLess(decision["chart"]["levels"]["target_2"], decision["chart"]["levels"]["target_1"])

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
        self.assertEqual(result["long_candidates"][0]["direction"], "LONG")
        self.assertEqual(result["short_candidates"][0]["direction"], "SHORT")
        self.assertTrue(result["read_only"])
        self.assertFalse(result["order_submission_supported"])

    def test_default_discovery_scans_full_index_and_returns_top_20(self):
        engine = PortfolioEngine(
            memory=MemoryStore(self.db), market=FakeMarket(), research=FakeResearch(), universe_client=FakeUniverse()
        )
        result = engine.discover()
        self.assertEqual(result["universe_name"], "S&P 500")
        self.assertEqual(result["universe_size"], 25)
        self.assertEqual(result["successful"], 25)
        self.assertEqual(len(result["candidates"]), 20)
        self.assertEqual(result["market_data_source"], "Test market data")
        self.assertEqual(result["candidates"][0]["sector"], "Test sector")

    def test_supertrend_calculation_marks_falling_market_short(self):
        closes = [100 + index for index in range(25)] + [124 - index * 2 for index in range(1, 26)]
        rows = [
            {"date": f"D{index}", "open": close + 0.5, "high": close + 1.0, "low": close - 1.0, "close": close, "volume": 1_000_000}
            for index, close in enumerate(closes)
        ]
        signal = MarketDataClient._calculate_supertrend(rows, period=10, multiplier=3.0)
        self.assertEqual(signal["direction"], "SHORT")
        self.assertGreater(signal["value"], rows[-1]["close"])
        self.assertEqual(rows[-1]["supertrend_direction"], "SHORT")

    def test_supertrend_uses_tradingview_downtrend_initialization(self):
        rows = [
            {"date": f"D{index}", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1000}
            for index in range(15)
        ]
        MarketDataClient._calculate_supertrend(rows, period=10, multiplier=3.0)
        self.assertEqual(rows[9]["supertrend_direction"], "SHORT")

    def test_supertrend_direction_owns_long_or_short_classification(self):
        snapshot = FakeMarket().snapshot("CONFLICT")
        snapshot["supertrend"] = {
            "direction": "SHORT", "value": 105.0, "is_confirmed": False,
            "confirmed_direction": "LONG", "flipped_today": True, "bars_since_flip": 0,
        }
        candidate = PortfolioEngine._score_candidate(snapshot)
        self.assertEqual(candidate["direction"], "SHORT")
        self.assertEqual(candidate["label"], "Provisional short flip")
        self.assertTrue(any("wait for the close" in caution for caution in candidate["cautions"]))

    def test_intraday_bars_aggregate_into_one_provisional_daily_candle(self):
        intraday = {"historicals": [
            {"begins_at": "2026-09-22T13:30:00Z", "open_price": "100", "close_price": "101", "high_price": "102", "low_price": "99", "volume": 100, "session": "reg", "interpolated": False},
            {"begins_at": "2026-09-22T13:35:00Z", "open_price": "101", "close_price": "103", "high_price": "104", "low_price": "100", "volume": 150, "session": "reg", "interpolated": False},
        ]}
        bar = MarketDataClient._aggregate_intraday_bar(intraday)
        self.assertEqual(bar["open"], 100.0)
        self.assertEqual(bar["close"], 103.0)
        self.assertEqual(bar["high"], 104.0)
        self.assertEqual(bar["low"], 99.0)
        self.assertEqual(bar["volume"], 250)
        self.assertEqual(bar["bar_status"], "live_provisional")


if __name__ == "__main__":
    unittest.main()
