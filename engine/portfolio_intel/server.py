from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .config import Settings
from .engine import PortfolioEngine
from .memory import MemoryStore


class PortfolioHandler(BaseHTTPRequestHandler):
    engine: PortfolioEngine
    dashboard = Path(__file__).with_name("dashboard.html")

    def log_message(self, format: str, *args: object) -> None:
        print(f"[portfolio-intel] {self.address_string()} {format % args}")

    def _json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            raise ValueError("Request body is too large")
        raw = self.rfile.read(length) if length else b"{}"
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("JSON body must be an object")
        return value

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            body = self.dashboard.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/health":
            self._json(HTTPStatus.OK, {"status": "ok", "paper_only": True})
            return
        if path == "/api/history":
            self._json(HTTPStatus.OK, self.engine.memory.history())
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:
        try:
            payload = self._read_json()
            path = urlparse(self.path).path
            if path == "/api/analyze":
                symbol = str(payload.get("symbol", "")).strip()
                if not symbol:
                    raise ValueError("symbol is required")
                self._json(HTTPStatus.OK, self.engine.analyze(symbol))
                return
            if path == "/api/grade":
                self._json(HTTPStatus.OK, self.engine.grade(int(payload["decision_id"])))
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})


def serve(host: str, port: int, *, settings: Settings, memory: MemoryStore) -> None:
    PortfolioHandler.engine = PortfolioEngine(settings=settings, memory=memory)
    server = ThreadingHTTPServer((host, port), PortfolioHandler)
    print(f"Portfolio Intelligence running at http://{host}:{port}")
    print("Paper mode is enforced. Press Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

