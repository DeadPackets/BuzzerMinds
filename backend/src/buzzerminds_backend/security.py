from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, status


@dataclass(slots=True)
class RateLimitWindow:
    limit: int
    window_seconds: int = 60


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def check(self, bucket: str, limit: int, window_seconds: int = 60) -> None:
        now = time.time()
        queue = self._events[bucket]
        while queue and now - queue[0] > window_seconds:
            queue.popleft()
        if len(queue) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please slow down.",
            )
        queue.append(now)


def client_ip_from_headers(headers: dict[str, str], fallback: str = "unknown") -> str:
    cf_ip = headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    forwarded = headers.get("x-forwarded-for") or headers.get("x-real-ip")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return fallback
