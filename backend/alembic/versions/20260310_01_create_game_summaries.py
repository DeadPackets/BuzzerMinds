"""create game summaries

Revision ID: 20260310_01
Revises: None
Create Date: 2026-03-10 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260310_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "game_summaries",
        sa.Column("summary_id", sa.String(length=128), primary_key=True, nullable=False),
        sa.Column("room_code", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    )
    op.create_index("ix_game_summaries_room_code", "game_summaries", ["room_code"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_game_summaries_room_code", table_name="game_summaries")
    op.drop_table("game_summaries")
