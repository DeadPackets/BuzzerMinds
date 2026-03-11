from __future__ import annotations

from datetime import datetime

from sqlmodel import Column, DateTime, Field, SQLModel
from sqlalchemy.dialects.postgresql import JSONB


class GameSummaryRecord(SQLModel, table=True):
    __tablename__ = "game_summaries"

    summary_id: str = Field(primary_key=True, max_length=128)
    room_code: str = Field(index=True, max_length=16)
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    finished_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    payload: dict = Field(sa_column=Column(JSONB, nullable=False))
