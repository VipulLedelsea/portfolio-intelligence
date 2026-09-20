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
                "symbol": raw_symbol.replace(".", "-"),
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
    """Fetches daily OHLCV data from Yahoo's public chart endpoint."""

    def __init__(self, timeout: int = 20) -> None:
        self.timeout = timeout

    def snapshot(self, symbol: str) -> dict[str, Any]:
        ticker = symbol.upper().strip()
        if not ticker or not all(ch.isalnum() or ch in ".-^" for ch in ticker):
            raise ValueError("Invalid ticker symbol")
        encoded = urllib.parse.quote(ticker, safe="")
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=6mo&interval=1d&events=div%2Csplits"
        request = urllib.request.Request(url, headers={"User-Agent": "PortfolioIntelligence/0.1"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout, context=trusted_ssl_context()) as response:
                payload = json.load(response)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            raise RuntimeError(f"Could not fetch market data for {ticker}: {exc}") from exc
        result = payload.get("chart", {}).get("result") or []
        if not result:
            error = payload.get("chart", {}).get("error")
            raise RuntimeError(f"No market data for {ticker}: {error}")
        return self._snapshot_from_data(ticker, result[0])

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
        query = urllib.parse.urlencode({"symbols": ",".join(batch), "range": "6mo", "interval": "1d"})
        url = f"https://query1.finance.yahoo.com/v7/finance/spark?{query}"
        request = urllib.request.Request(url, headers={"User-Agent": "PortfolioIntelligence/0.2"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout, context=trusted_ssl_context()) as response:
                payload = json.load(response)
            results = payload.get("spark", {}).get("result") or []
            returned: set[str] = set()
            for item in results:
                ticker = str(item.get("symbol", "")).upper()
                response_items = item.get("response") or []
                if not ticker or not response_items:
                    continue
                returned.add(ticker)
                try:
                    snapshots[ticker] = self._snapshot_from_data(ticker, response_items[0])
                except Exception as exc:
                    errors.append({"symbol": ticker, "error": str(exc)})
            for ticker in batch:
                if ticker not in returned:
                    errors.append({"symbol": ticker, "error": "No market data returned"})
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            errors.extend({"symbol": ticker, "error": f"Batch market-data request failed: {exc}"} for ticker in batch)
        return snapshots, errors

    def _snapshot_from_data(self, ticker: str, data: dict[str, Any]) -> dict[str, Any]:
        quotes = (data.get("indicators", {}).get("quote") or [{}])[0]
        timestamps = data.get("timestamp", [])
        raw_closes = quotes.get("close", [])
        raw_highs = quotes.get("high", [])
        raw_lows = quotes.get("low", [])
        raw_volumes = quotes.get("volume", [])
        rows: list[dict[str, Any]] = []
        for index, timestamp in enumerate(timestamps):
            close = raw_closes[index] if index < len(raw_closes) else None
            if close is None:
                continue
            high = raw_highs[index] if index < len(raw_highs) else None
            low = raw_lows[index] if index < len(raw_lows) else None
            volume = raw_volumes[index] if index < len(raw_volumes) else None
            rows.append({
                "date": datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat(),
                "close": round(float(close), 4),
                "high": round(float(high if high is not None else close), 4),
                "low": round(float(low if low is not None else close), 4),
                "volume": int(volume or 0),
            })
        closes = [row["close"] for row in rows]
        highs = [row["high"] for row in rows]
        lows = [row["low"] for row in rows]
        volumes = [float(row["volume"]) for row in rows]
        if len(closes) < 22:
            raise RuntimeError(f"Insufficient price history for {ticker}")
        meta = data.get("meta", {})
        current = float(meta.get("regularMarketPrice") or closes[-1])
        returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0]
        annual_vol = statistics.pstdev(returns[-60:]) * math.sqrt(252) * 100 if len(returns) >= 2 else 0.0
        true_ranges = [highs[i] - lows[i] for i in range(min(len(highs), len(lows)))]
        atr14 = statistics.fmean(true_ranges[-14:]) if true_ranges else current * 0.03
        volume_recent = statistics.fmean(volumes[-5:]) if len(volumes) >= 5 else 0.0
        volume_base = statistics.fmean(volumes[-25:-5]) if len(volumes) >= 25 else volume_recent or 1.0
        return {
            "symbol": ticker,
            "currency": meta.get("currency", "USD"),
            "exchange": meta.get("exchangeName") or meta.get("fullExchangeName") or "Unknown",
            "price": round(current, 4),
            "previous_close": round(float(meta.get("chartPreviousClose") or closes[-2]), 4),
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
            "market_time": datetime.fromtimestamp(meta.get("regularMarketTime", time.time()), timezone.utc).isoformat(),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "data_complete": True,
            "history": rows[-90:],
        }

    @staticmethod
    def _period_return(closes: list[float], days: int) -> float:
        if len(closes) <= days:
            return 0.0
        return (closes[-1] / closes[-days - 1] - 1) * 100
