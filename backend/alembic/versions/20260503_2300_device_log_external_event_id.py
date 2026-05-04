"""device_logs.external_event_id — vendor event idempotency key

Revision ID: c4d8b9e2f0a1
Revises: a1f5c4b7e3d2
Create Date: 2026-05-03 23:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4d8b9e2f0a1"
down_revision: Union[str, None] = "a1f5c4b7e3d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "device_logs",
        sa.Column("external_event_id", sa.String(length=128), nullable=True),
    )
    # Composite index — typical lookup is "have we seen this event from
    # this device before?" so device_id + external_event_id together gives
    # the cheapest dedup query.
    op.create_index(
        "ix_device_logs_device_external",
        "device_logs",
        ["device_id", "external_event_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_device_logs_device_external", table_name="device_logs")
    op.drop_column("device_logs", "external_event_id")
