from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket

from .schemas import ApiEnvelope, RoomStateResponse

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class Subscription:
    room_code: str
    websocket: WebSocket


class RealtimeHub:
    def __init__(self) -> None:
        self._subscriptions: dict[str, list[Subscription]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def shutdown(self) -> None:
        """Gracefully close all WebSocket connections during server shutdown."""
        async with self._lock:
            all_subs = [sub for subs in self._subscriptions.values() for sub in subs]
        logger.info("Shutting down %d WebSocket connections", len(all_subs))
        for sub in all_subs:
            try:
                await sub.websocket.close(code=1001, reason="Server shutting down")
            except Exception:
                pass
        async with self._lock:
            self._subscriptions.clear()

    @property
    def total_connections(self) -> int:
        """Return the total number of active WebSocket subscriptions."""
        return sum(len(subs) for subs in self._subscriptions.values())

    async def register(self, room_code: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._subscriptions[room_code].append(
                Subscription(room_code=room_code, websocket=websocket)
            )

    async def unregister(self, room_code: str, websocket: WebSocket) -> None:
        async with self._lock:
            current = self._subscriptions.get(room_code, [])
            self._subscriptions[room_code] = [
                item for item in current if item.websocket is not websocket
            ]
            if not self._subscriptions[room_code]:
                self._subscriptions.pop(room_code, None)

    async def _safe_send_text(self, sub: Subscription, text: str) -> Subscription | None:
        """Send pre-serialized text to a subscriber. Returns the sub on failure (stale)."""
        try:
            await sub.websocket.send_text(text)
            return None
        except Exception:
            return sub

    async def broadcast_room_state(self, room_code: str, room_state: RoomStateResponse) -> None:
        envelope = ApiEnvelope(type="room_state", payload=room_state).model_dump(mode="json")
        # Pre-serialize JSON once instead of per-client
        json_text = json.dumps(envelope)

        async with self._lock:
            subscribers = list(self._subscriptions.get(room_code, []))
        if not subscribers:
            return

        # Send to all subscribers concurrently
        results = await asyncio.gather(
            *(self._safe_send_text(sub, json_text) for sub in subscribers),
            return_exceptions=True,
        )

        # Clean up stale connections
        for result in results:
            if isinstance(result, Subscription) and result is not None:
                await self.unregister(room_code, result.websocket)
            elif isinstance(result, BaseException):
                # gather with return_exceptions=True shouldn't reach here,
                # but handle defensively
                logger.warning("Unexpected error in broadcast gather: %s", result)

    async def send_to_websocket(self, websocket: WebSocket, message: dict[str, Any]) -> None:
        """Send a message to a single WebSocket (e.g. buzz_error to the caller)."""
        try:
            await websocket.send_json(message)
        except Exception:
            pass
