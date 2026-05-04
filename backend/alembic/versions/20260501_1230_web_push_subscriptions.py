"""web push subscriptions — browser endpoints for VAPID push

Revision ID: 7c9e2b4a1d33
Revises: 5b8d4c7e2a91
Create Date: 2026-05-01 12:30:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7c9e2b4a1d33"
down_revision: Union[str, None] = "5b8d4c7e2a91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "web_push_subscriptions",
        sa.Column(
            "id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=True),
        sa.Column("endpoint", sa.String(length=2048), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
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
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("endpoint", name="uq_web_push_endpoint"),
    )
    op.create_index(
        "ix_web_push_subscriptions_user_id",
        "web_push_subscriptions",
        ["user_id"],
    )
    op.create_index(
        "ix_web_push_subscriptions_company_id",
        "web_push_subscriptions",
        ["company_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_web_push_subscriptions_company_id",
        table_name="web_push_subscriptions",
    )
    op.drop_index(
        "ix_web_push_subscriptions_user_id",
        table_name="web_push_subscriptions",
    )
    op.drop_table("web_push_subscriptions")
