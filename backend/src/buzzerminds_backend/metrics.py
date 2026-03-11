from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from threading import Thread

from fastapi import FastAPI, Request, Response
from prometheus_client import Counter, Gauge, Histogram, start_http_server

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Metric definitions
# ---------------------------------------------------------------------------

REQUEST_COUNT = Counter(
    "buzzerminds_http_requests_total",
    "Total HTTP requests",
    ["method", "path_template", "status_code"],
)

REQUEST_DURATION = Histogram(
    "buzzerminds_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path_template"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

ACTIVE_ROOMS = Gauge(
    "buzzerminds_active_rooms",
    "Number of active rooms in memory",
)

ACTIVE_WEBSOCKETS = Gauge(
    "buzzerminds_active_websockets",
    "Number of active WebSocket connections",
)

CONNECTED_PLAYERS = Gauge(
    "buzzerminds_connected_players",
    "Number of connected players across all rooms",
)

GAMES_FINISHED = Counter(
    "buzzerminds_games_finished_total",
    "Total games finished",
    ["reason"],
)


# ---------------------------------------------------------------------------
# Path template normalization
# ---------------------------------------------------------------------------


def _normalize_path(path: str) -> str:
    """Collapse path parameters into templates for low-cardinality labels."""
    parts = path.rstrip("/").split("/")
    normalized: list[str] = []
    for i, part in enumerate(parts):
        if not part:
            continue
        prev = normalized[-1] if normalized else ""
        if prev in ("rooms", "players", "summaries", "vip") and part not in (
            "join",
            "ready",
            "start",
            "kick",
            "settings",
            "reset",
            "topic-votes",
            "topic-voting",
            "buzz",
            "answer",
            "adjudication",
            "tick",
            "display",
        ):
            normalized.append("{id}")
        else:
            normalized.append(part)
    return "/" + "/".join(normalized)


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


def add_metrics_middleware(app: FastAPI) -> None:
    """Add Prometheus metrics collection middleware to a FastAPI app."""

    @app.middleware("http")
    async def metrics_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        path_template = _normalize_path(request.url.path)
        method = request.method

        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start

        REQUEST_COUNT.labels(
            method=method,
            path_template=path_template,
            status_code=response.status_code,
        ).inc()
        REQUEST_DURATION.labels(
            method=method,
            path_template=path_template,
        ).observe(duration)

        return response


# ---------------------------------------------------------------------------
# Metrics server
# ---------------------------------------------------------------------------


def start_metrics_server(port: int = 9090) -> None:
    """Start the Prometheus metrics HTTP server on a background thread.

    Binds to 0.0.0.0 inside the container so Prometheus can scrape it.
    The docker-compose maps the host port to 127.0.0.1 to prevent external access.
    """

    def _serve() -> None:
        start_http_server(port, addr="0.0.0.0")

    thread = Thread(target=_serve, daemon=True, name="prometheus-metrics")
    thread.start()
    logger.info("Prometheus metrics server started on 0.0.0.0:%d", port)
