"""telegram_settings.event_filters

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-05-16 14:00:00.000000

Phase 3 of the Telegram bot integration. Adds an ``event_filters`` JSON
column to ``telegram_settings`` so the admin can choose, per-company,
which fine-grained events get forwarded to Telegram subscribers
independently of the in-app NotificationCategory mute. Missing key /
empty dict means "nothing extra" — keeps existing behaviour intact.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c0d1e2f3a4b5"
down_revision: Union[str, None] = "b9c0d1e2f3a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "telegram_settings",
        sa.Column(
            "event_filters",
            sa.JSON(),
            nullable=True,
            server_default=sa.text("'{}'::json"),
        ),
    )


def downgrade() -> None:
    op.drop_column("telegram_settings", "event_filters")
