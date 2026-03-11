from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from .config import AppConfig
from .db import Database
from .db_models import GameSummaryRecord
from .schemas import GameSummaryResponse


@dataclass(slots=True)
class PersistenceStatus:
    backend: str
    durable: bool


class PersistenceAdapter:
    def __init__(self, app_config: AppConfig) -> None:
        self.app_config = app_config
        self.db = Database(app_config)

    def status(self) -> PersistenceStatus:
        durable = self.app_config.persistence.backend == "postgres"
        return PersistenceStatus(backend=self.app_config.persistence.backend, durable=durable)

    async def connect(self) -> None:
        if self.app_config.persistence.backend != "postgres":
            return
        await self.db.connect()

    async def save_game_history(self, room_code: str, payload: dict[str, object]) -> None:
        if self.db.session_factory is None:
            return
        async with await self.db.session() as session:
            summary_id = str(payload["summary_id"])
            existing = await session.get(GameSummaryRecord, summary_id)
            record = existing or GameSummaryRecord(
                summary_id=summary_id,
                room_code=room_code,
                created_at=datetime.now(UTC),
                finished_at=self._parse_dt(payload["finished_at"]),
                payload=payload,
            )
            record.room_code = room_code
            record.finished_at = self._parse_dt(payload["finished_at"])
            record.payload = payload
            session.add(record)
            await session.commit()

    async def get_game_summary(self, summary_id: str) -> GameSummaryResponse | None:
        if self.db.session_factory is None:
            return None
        async with await self.db.session() as session:
            record = await session.get(GameSummaryRecord, summary_id)
            if record is None:
                return None
            return GameSummaryResponse.model_validate(record.payload)

    def _parse_dt(self, value: object) -> datetime:
        if isinstance(value, datetime):
            return value
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
