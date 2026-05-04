"""notification preferences — per-user × per-category opt-out

Revision ID: 5b8d4c7e2a91
Revises: 9a4f2e0c8b71
Create Date: 2026-05-01 09:30:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "5b8d4c7e2a91"
down_revision: Union[str, None] = "9a4f2e0c8b71"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_preferences",
        sa.Column(
            "id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "user_id", "category", name="uq_notification_preferences_user_category"
        ),
    )
    op.create_index(
        "ix_notification_preferences_user_id",
        "notification_preferences",
        ["user_id"],
    )
    op.create_index(
        "ix_notification_preferences_category",
        "notification_preferences",
        ["category"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_notification_preferences_category",
        table_name="notification_preferences",
    )
    op.drop_index(
        "ix_notification_preferences_user_id",
        table_name="notification_preferences",
    )
    op.drop_table("notification_preferences")
