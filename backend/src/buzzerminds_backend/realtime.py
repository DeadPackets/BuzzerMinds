from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass

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

    async def broadcast_room_state(self, room_code: str, room_state: RoomStateResponse) -> None:
        envelope = ApiEnvelope(type="room_state", payload=room_state).model_dump(mode="json")
        async with self._lock:
            subscribers = list(self._subscriptions.get(room_code, []))

        stale: list[WebSocket] = []
        for subscriber in subscribers:
            try:
                await subscriber.websocket.send_json(envelope)
            except Exception:
                stale.append(subscriber.websocket)

        for websocket in stale:
            await self.unregister(room_code, websocket)
