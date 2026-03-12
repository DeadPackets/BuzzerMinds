from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime


class JSONFormatter(logging.Formatter):
    """Structured JSON log formatter for production observability."""

    # Standard LogRecord attributes that should NOT be forwarded as extras.
    _BUILTIN_ATTRS = frozenset(
        {
            "args",
            "asctime",
            "created",
            "exc_info",
            "exc_text",
            "filename",
            "funcName",
            "levelname",
            "levelno",
            "lineno",
            "message",
            "module",
            "msecs",
            "msg",
            "name",
            "pathname",
            "process",
            "processName",
            "relativeCreated",
            "stack_info",
            "taskName",
            "thread",
            "threadName",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[1] is not None:
            entry["exception"] = self.formatException(record.exc_info)
        # Forward ALL extra fields generically.
        for key, value in record.__dict__.items():
            if key.startswith("_") or key in self._BUILTIN_ATTRS:
                continue
            if value is not None:
                entry[key] = value
        return json.dumps(entry, default=str)


def configure_logging(*, json_output: bool = True) -> None:
    """Configure application-wide logging.

    Args:
        json_output: If True, use structured JSON format. Otherwise use standard format.
    """
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    if json_output:
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

    root.handlers.clear()
    root.addHandler(handler)

    # Silence noisy loggers
    for logger_name in ("uvicorn.access", "httpx", "httpcore", "watchfiles"):
        logging.getLogger(logger_name).setLevel(logging.WARNING)
