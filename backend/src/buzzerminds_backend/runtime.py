from __future__ import annotations

import asyncio
import contextlib
import logging

from .metrics import ACTIVE_ROOMS, ACTIVE_WEBSOCKETS, CONNECTED_PLAYERS
from .room_manager import RoomManager
from .realtime import RealtimeHub

logger = logging.getLogger(__name__)


class RoomRuntime:
    def __init__(self, room_manager: RoomManager, realtime_hub: RealtimeHub) -> None:
        self.room_manager = room_manager
        self.realtime_hub = realtime_hub
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run())
        logger.info("Room runtime started")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        logger.info("Room runtime stopped")

    async def _run(self) -> None:
        while True:
            room_codes = list(self.room_manager.rooms.keys())

            # Update Prometheus gauges
            ACTIVE_ROOMS.set(len(room_codes))
            ACTIVE_WEBSOCKETS.set(self.realtime_hub.total_connections)
            total_players = sum(
                len([p for p in room.players.values() if p.connected])
                for room in self.room_manager.rooms.values()
            )
            CONNECTED_PLAYERS.set(total_players)

            for room_code in room_codes:
                try:
                    room_state = await self.room_manager.tick_room(room_code)
                    await self.realtime_hub.broadcast_room_state(room_code, room_state)
                except Exception:
                    continue
            await asyncio.sleep(self.room_manager.app_config.runtime.room_tick_interval_ms / 1000)
