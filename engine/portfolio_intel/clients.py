from __future__ import annotations

import csv
import io
import json
import math
import os
import ssl
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Protocol

try:
    import certifi
except ImportError:  # pragma: no cover - standard trust store is the fallback
    certifi = None


def trusted_ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context(cafile=certifi.where() if certifi else None)


REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "role": {"type": "string"},
        "symbol": {"type": "string"},
        "score": {"type": "number", "minimum": 0, "maximum": 100},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "thesis": {"type": "string"},
        "evidence": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "sources": {"type": "array", "items": {"type": "string"}},
        "as_of": {"type": "string"},
        "data_complete": {"type": "boolean"},
    },
    "required": [
        "role", "symbol", "score", "confidence", "thesis", "evidence",
        "risks", "sources", "as_of", "data_complete",
    ],
}


class ResearchClient(Protocol):
    def report(self, *, role: str, symbol: str, instructions: str, context: dict[str, Any], use_web: bool) -> dict[str, Any]: ...


class OpenAIResearchClient:
    """Small dependency-free Responses API client with strict structured output."""

    endpoint = "https://api.openai.com/v1/responses"

    def __init__(self, model: str, api_key: str | None = None, timeout: int = 90) -> None:
        self.model = model
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.timeout = timeout
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is not configured")

    def report(self, *, role: str, symbol: str, instructions: str, context: dict[str, Any], use_web: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "store": False,
            "instructions": instructions,
            "input": json.dumps({"symbol": symbol, "role": role, "context": context}),
            "reasoning": {"effort": "low"},
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "agent_report",
                    "strict": True,
                    "schema": REPORT_SCHEMA,
                }
            },
        }
        if use_web:
            payload["tools"] = [{"type": "web_search"}]
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout, context=trusted_ssl_context()) as response:
                    raw = json.load(response)
                text = self._output_text(raw)
                report = json.loads(text)
                report["role"] = role
                report["symbol"] = symbol
                return report
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"OpenAI research request failed after retries: {last_error}")

    @staticmethod
    def _output_text(response: dict[str, Any]) -> str:
        chunks: list[str] = []
        for item in response.get("output", []):
            if item.get("type") != "message":
                continue
            for content in item.get("content", []):
                if content.get("type") == "output_text" and content.get("text"):
                    chunks.append(content["text"])
        if not chunks:
            raise RuntimeError("Responses API returned no output text")
        return "".join(chunks)


class SafeFallbackResearchClient:
    """Keeps the pipeline runnable but marks research incomplete so risk can veto."""

    def report(self, *, role: str, symbol: str, instructions: str, context: dict[str, Any], use_web: bool) -> dict[str, Any]:
        return {
            "role": role,
            "symbol": symbol,
            "score": 50,
            "confidence": 0.20,
            "thesis": f"{role.title()} research is unavailable until OPENAI_API_KEY is configured.",
            "evidence": ["The orchestration path completed in safe fallback mode."],
            "risks": ["Required external research was not available."],
            "sources": [],
            "as_of": datetime.now(timezone.utc).isoformat(),
            "data_complete": False,
        }


class SP500UniverseClient:
    """Loads the current S&P 500 constituent set from a maintained CSV feed."""

    source_url = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"

    def __init__(self, timeout: int = 20, cache_seconds: int = 21_600) -> None:
        self.timeout = timeout
        self.cache_seconds = cache_seconds
        self._cached_at = 0.0
        self._cached: list[dict[str, str]] = []

    def constituents(self) -> list[dict[str, str]]:
        if self._cached and time.time() - self._cached_at < self.cache_seconds:
            return list(self._cached)
        request = urllib.request.Request(self.source_url, headers={"User-Agent": "PortfolioIntelligence/0.2"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout, context=trusted_ssl_context()) as response:
                text = response.read().decode("utf-8-sig")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            raise RuntimeError(f"Could not fetch the S&P 500 constituent list: {exc}") from exc
        records: list[dict[str, str]] = []
        for row in csv.DictReader(io.StringIO(text)):
            raw_symbol = (row.get("Symbol") or "").strip().upper()
            if not raw_symbol:
                continue
            records.append({
                "symbol": raw_symbol,
                "index_symbol": raw_symbol,
                "company": (row.get("Security") or raw_symbol).strip(),
                "sector": (row.get("GICS Sector") or "Unknown").strip(),
            })
        if len(records) < 450:
            raise RuntimeError(f"S&P 500 constituent feed returned only {len(records)} securities")
        self._cached = records
        self._cached_at = time.time()
        return list(records)


class MarketDataClient:
    """Fetches read-only quotes and daily OHLCV bars from Robinhood."""

    provider_name = "Robinhood"
    historicals_endpoint = "https://api.robinhood.com/quotes/historicals/"
    quotes_endpoint = "https://api.robinhood.com/quotes/"

    def __init__(self, timeout: int = 45) -> None:
        self.timeout = timeout

    def snapshot(self, symbol: str) -> dict[str, Any]:
        ticker = symbol.upper().strip()
        if not ticker or not all(ch.isalnum() or ch in ".-^" for ch in ticker):
            raise ValueError("Invalid ticker symbol")
        snapshots, errors = self._snapshot_batch([ticker])
        if ticker not in snapshots:
            reason = errors[0]["error"] if errors else "No market data returned"
            raise RuntimeError(f"Could not fetch Robinhood market data for {ticker}: {reason}")
        return snapshots[ticker]

    def snapshots(self, symbols: list[str], *, batch_size: int = 20) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]]]:
        """Fetch many symbols in a few requests for broad-universe discovery."""
        tickers = list(dict.fromkeys(symbol.upper().strip() for symbol in symbols if symbol.strip()))
        snapshots: dict[str, dict[str, Any]] = {}
        errors: list[dict[str, str]] = []
        batches = [tickers[start:start + batch_size] for start in range(0, len(tickers), batch_size)]
        with ThreadPoolExecutor(max_workers=min(6, len(batches) or 1), thread_name_prefix="market-batch") as pool:
            futures = {pool.submit(self._snapshot_batch, batch): batch for batch in batches}
            for future in as_completed(futures):
                batch_snapshots, batch_errors = future.result()
                snapshots.update(batch_snapshots)
                errors.extend(batch_errors)
        return snapshots, errors

    def _snapshot_batch(self, batch: list[str]) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]]]:
        snapshots: dict[str, dict[str, Any]] = {}
        errors: list[dict[str, str]] = []
        try:
            query = urllib.parse.urlencode({
                "symbols": ",".join(batch), "bounds": "regular", "interval": "day", "span": "6month",
            }, safe=",")
            payload = self._fetch_json(f"{self.historicals_endpoint}?{query}")
            quote_query = urllib.parse.urlencode({"symbols": ",".join(batch)}, safe=",")
            try:
                quote_payload = self._fetch_json(f"{self.quotes_endpoint}?{quote_query}")
            except RuntimeError:
                quote_payload = {"results": []}
            live_query = urllib.parse.urlencode({
                "symbols": ",".join(batch), "bounds": "regular", "interval": "5minute", "span": "day",
            }, safe=",")
            try:
                live_payload = self._fetch_json(f"{self.historicals_endpoint}?{live_query}")
            except RuntimeError:
                live_payload = {"results": []}
            quote_map = {
                str(item.get("symbol", "")).upper(): item
                for item in (quote_payload.get("results") or []) if item
            }
            live_map = {
                str(item.get("symbol", "")).upper(): item
                for item in (live_payload.get("results") or []) if item
            }
            results = payload.get("results") or []
            returned: set[str] = set()
            for item in results:
                ticker = str(item.get("symbol", "")).upper()
                if not ticker:
                    continue
                returned.add(ticker)
                try:
                    snapshots[ticker] = self._snapshot_from_robinhood(
                        ticker, item, quote_map.get(ticker), live_map.get(ticker),
                    )
                except Exception as exc:
                    errors.append({"symbol": ticker, "error": str(exc)})
            for ticker in batch:
                if ticker not in returned:
                    errors.append({"symbol": ticker, "error": "Robinhood returned no historical data"})
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, RuntimeError) as exc:
            errors.extend({"symbol": ticker, "error": f"Robinhood market-data request failed: {exc}"} for ticker in batch)
        return snapshots, errors

    def _fetch_json(self, url: str) -> dict[str, Any]:
        request = urllib.request.Request(url, headers={"User-Agent": "PortfolioIntelligence/0.3"})
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout, context=trusted_ssl_context()) as response:
                    value = json.load(response)
                if not isinstance(value, dict):
                    raise RuntimeError("Robinhood returned an unexpected response")
                return value
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt == 0:
                    time.sleep(0.5)
        raise RuntimeError(str(last_error))

    def _snapshot_from_robinhood(
        self,
        ticker: str,
        data: dict[str, Any],
        quote: dict[str, Any] | None,
        intraday: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        rows: list[dict[str, Any]] = []
        for bar in data.get("historicals") or []:
            if not bar or bar.get("interpolated"):
                continue
            close = float(bar["close_price"])
            rows.append({
                "date": str(bar["begins_at"])[:10],
                "open": round(float(bar.get("open_price") or close), 4),
                "close": round(close, 4),
                "high": round(float(bar.get("high_price") or close), 4),
                "low": round(float(bar.get("low_price") or close), 4),
                "volume": int(bar.get("volume") or 0),
            })
        closes = [row["close"] for row in rows]
        highs = [row["high"] for row in rows]
        lows = [row["low"] for row in rows]
        volumes = [float(row["volume"]) for row in rows]
        if len(closes) < 22:
            raise RuntimeError(f"Insufficient Robinhood price history for {ticker}")
        confirmed_supertrend = self._calculate_supertrend(rows, period=10, multiplier=3.0)
        confirmed_date = rows[-1]["date"]
        live_bar = self._aggregate_intraday_bar(intraday)
        if live_bar and live_bar["date"] > confirmed_date:
            live_rows = [dict(row) for row in rows] + [live_bar]
            supertrend = self._calculate_supertrend(live_rows, period=10, multiplier=3.0)
            rows = live_rows
            supertrend.update({
                "is_confirmed": False,
                "bar_status": "live_provisional",
                "as_of": live_bar["begins_at"],
                "confirmed_direction": confirmed_supertrend["direction"],
                "confirmed_value": confirmed_supertrend["value"],
                "confirmed_as_of": confirmed_date,
            })
        else:
            supertrend = confirmed_supertrend
            supertrend.update({
                "is_confirmed": True,
                "bar_status": "confirmed_close",
                "as_of": confirmed_date,
                "confirmed_direction": confirmed_supertrend["direction"],
                "confirmed_value": confirmed_supertrend["value"],
                "confirmed_as_of": confirmed_date,
            })
        quote = quote or {}
        current = float(quote.get("last_trade_price") or closes[-1])
        returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0]
        annual_vol = statistics.pstdev(returns[-60:]) * math.sqrt(252) * 100 if len(returns) >= 2 else 0.0
        true_ranges = [
            highs[index] - lows[index] if index == 0 else max(
                highs[index] - lows[index],
                abs(highs[index] - closes[index - 1]),
                abs(lows[index] - closes[index - 1]),
            )
            for index in range(min(len(highs), len(lows)))
        ]
        atr14 = statistics.fmean(true_ranges[-14:]) if true_ranges else current * 0.03
        volume_recent = statistics.fmean(volumes[-5:]) if len(volumes) >= 5 else 0.0
        volume_base = statistics.fmean(volumes[-25:-5]) if len(volumes) >= 25 else volume_recent or 1.0
        return {
            "symbol": ticker,
            "currency": "USD",
            "exchange": "US Market",
            "price": round(current, 4),
            "previous_close": round(float(quote.get("adjusted_previous_close") or closes[-2]), 4),
            "return_1d_pct": round(self._period_return(closes, 1), 3),
            "return_5d_pct": round(self._period_return(closes, 5), 3),
            "return_20d_pct": round(self._period_return(closes, 20), 3),
            "return_60d_pct": round(self._period_return(closes, 60), 3),
            "sma_20": round(statistics.fmean(closes[-20:]), 4),
            "sma_50": round(statistics.fmean(closes[-50:]), 4) if len(closes) >= 50 else None,
            "annualized_volatility_pct": round(annual_vol, 3),
            "atr_14": round(atr14, 4),
            "atr_14_pct": round((atr14 / current) * 100, 3),
            "volume_ratio_5d_to_20d": round(volume_recent / volume_base, 3) if volume_base else 1.0,
            "market_time": quote.get("venue_last_trade_time") or data.get("historicals", [{}])[-1].get("begins_at"),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "data_source": "Robinhood",
            "data_source_detail": "Completed daily bars plus an aggregated live regular-hours bar when available",
            "supertrend": supertrend,
            "data_complete": True,
            "history": rows[-90:],
        }

    @staticmethod
    def _aggregate_intraday_bar(intraday: dict[str, Any] | None) -> dict[str, Any] | None:
        bars = [
            bar for bar in ((intraday or {}).get("historicals") or [])
            if bar and not bar.get("interpolated") and bar.get("session") in (None, "reg")
        ]
        if not bars:
            return None
        latest_date = str(bars[-1].get("begins_at", ""))[:10]
        bars = [bar for bar in bars if str(bar.get("begins_at", ""))[:10] == latest_date]
        if not bars:
            return None
        first, last = bars[0], bars[-1]
        close = float(last["close_price"])
        return {
            "date": latest_date,
            "begins_at": str(last["begins_at"]),
            "open": round(float(first.get("open_price") or close), 4),
            "close": round(close, 4),
            "high": round(max(float(bar.get("high_price") or close) for bar in bars), 4),
            "low": round(min(float(bar.get("low_price") or close) for bar in bars), 4),
            "volume": sum(int(bar.get("volume") or 0) for bar in bars),
            "bar_status": "live_provisional",
        }

    @staticmethod
    def _calculate_supertrend(
        rows: list[dict[str, Any]], *, period: int = 10, multiplier: float = 3.0,
    ) -> dict[str, Any]:
        """Add TradingView-style ATR Supertrend values to OHLC rows."""
        true_ranges: list[float] = []
        atr_values: list[float | None] = [None] * len(rows)
        for index, row in enumerate(rows):
            high, low = float(row["high"]), float(row["low"])
            previous_close = float(rows[index - 1]["close"]) if index else None
            true_ranges.append(
                high - low if previous_close is None else max(
                    high - low, abs(high - previous_close), abs(low - previous_close),
                )
            )
            if index == period - 1:
                atr_values[index] = statistics.fmean(true_ranges[:period])
            elif index >= period and atr_values[index - 1] is not None:
                atr_values[index] = ((atr_values[index - 1] * (period - 1)) + true_ranges[index]) / period

        final_upper: list[float | None] = [None] * len(rows)
        final_lower: list[float | None] = [None] * len(rows)
        directions: list[str | None] = [None] * len(rows)
        values: list[float | None] = [None] * len(rows)
        for index, row in enumerate(rows):
            atr = atr_values[index]
            if atr is None:
                continue
            high, low, close = float(row["high"]), float(row["low"]), float(row["close"])
            midpoint = (high + low) / 2
            basic_upper = midpoint + multiplier * atr
            basic_lower = midpoint - multiplier * atr
            previous_upper = final_upper[index - 1] if index else None
            previous_lower = final_lower[index - 1] if index else None
            previous_close = float(rows[index - 1]["close"]) if index else close
            final_upper[index] = (
                basic_upper
                if previous_upper is None or basic_upper < previous_upper or previous_close > previous_upper
                else previous_upper
            )
            final_lower[index] = (
                basic_lower
                if previous_lower is None or basic_lower > previous_lower or previous_close < previous_lower
                else previous_lower
            )
            previous_direction = directions[index - 1] if index else None
            if previous_direction is None:
                # TradingView initializes Supertrend as down until ATR is available.
                direction = "SHORT"
            elif previous_direction == "SHORT" and close > float(final_upper[index]):
                direction = "LONG"
            elif previous_direction == "LONG" and close < float(final_lower[index]):
                direction = "SHORT"
            else:
                direction = previous_direction
            directions[index] = direction
            values[index] = final_lower[index] if direction == "LONG" else final_upper[index]
            row["supertrend"] = round(float(values[index]), 4)
            row["supertrend_direction"] = direction

        valid_indices = [index for index, direction in enumerate(directions) if direction]
        if not valid_indices:
            raise RuntimeError("Insufficient history to calculate Supertrend")
        last_index = valid_indices[-1]
        last_direction = str(directions[last_index])
        prior_direction = next(
            (str(directions[index]) for index in range(last_index - 1, -1, -1) if directions[index]),
            last_direction,
        )
        bars_since_flip = 0
        for index in range(last_index - 1, -1, -1):
            if directions[index] and directions[index] != last_direction:
                break
            if directions[index]:
                bars_since_flip += 1
        last_close = float(rows[last_index]["close"])
        last_value = float(values[last_index])
        return {
            "period": period,
            "multiplier": multiplier,
            "direction": last_direction,
            "value": round(last_value, 4),
            "distance_pct": round(((last_close / last_value) - 1) * 100, 3),
            "flipped_today": prior_direction != last_direction,
            "bars_since_flip": bars_since_flip,
        }

    @staticmethod
    def _period_return(closes: list[float], days: int) -> float:
        if len(closes) <= days:
            return 0.0
        return (closes[-1] / closes[-days - 1] - 1) * 100
