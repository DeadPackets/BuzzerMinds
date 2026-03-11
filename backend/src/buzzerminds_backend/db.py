from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

from .config import AppConfig


class Database:
    def __init__(self, app_config: AppConfig) -> None:
        self.app_config = app_config
        self.engine: AsyncEngine | None = None
        self.session_factory: sessionmaker | None = None

    async def connect(self) -> None:
        if self.engine is not None:
            return
        database_url = os.getenv(self.app_config.persistence.postgres_url_env, "").strip()
        if not database_url:
            return
        async_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        self.engine = create_async_engine(async_url, future=True)
        self.session_factory = sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def dispose(self) -> None:
        if self.engine is None:
            return
        await self.engine.dispose()
        self.engine = None
        self.session_factory = None

    async def session(self) -> AsyncSession:
        if self.session_factory is None:
            raise RuntimeError("Database is not connected.")
        return self.session_factory()


__all__ = ["Database", "SQLModel"]
