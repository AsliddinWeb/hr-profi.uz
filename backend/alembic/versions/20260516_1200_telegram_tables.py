"""telegram_settings + telegram_subscribers

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-05-16 12:00:00.000000

Phase 1 of the Telegram bot integration.

Two new tenant-scoped tables:
  * ``telegram_settings`` — one row per company holding the bot token
    and getMe-derived metadata.
  * ``telegram_subscribers`` — one row per (company, employee) chat
    binding; ``enabled_categories`` is a JSON list of
    ``NotificationCategory`` strings the subscriber wants to receive.

Both inherit ``TenantMixin`` (``company_id``) + ``TimestampMixin``
(``created_at`` / ``updated_at``). Unique constraints keep the data
sane: one settings row per company, one subscriber per employee.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b9c0d1e2f3a4"
down_revision: Union[str, None] = "a8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "telegram_settings",
        sa.Column(
            "id",
            sa.UUID(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("bot_token", sa.String(length=255), nullable=True),
        sa.Column("bot_username", sa.String(length=100), nullable=True),
        sa.Column("bot_first_name", sa.String(length=100), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "last_verified_at",
            sa.DateTime(timezone=True),
            nullable=True,
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
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("company_id", name="uq_telegram_settings_company"),
    )
    op.create_index(
        "ix_telegram_settings_company_id",
        "telegram_settings",
        ["company_id"],
    )

    op.create_table(
        "telegram_subscribers",
        sa.Column(
            "id",
            sa.UUID(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("employee_id", sa.UUID(), nullable=False),
        sa.Column("chat_id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column(
            "enabled_categories",
            sa.JSON(),
            nullable=True,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "last_sent_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("last_error", sa.String(length=500), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "company_id",
            "employee_id",
            name="uq_telegram_subscriber_employee",
        ),
    )
    op.create_index(
        "ix_telegram_subscribers_company_id",
        "telegram_subscribers",
        ["company_id"],
    )
    op.create_index(
        "ix_telegram_subscribers_employee_id",
        "telegram_subscribers",
        ["employee_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_telegram_subscribers_employee_id",
        table_name="telegram_subscribers",
    )
    op.drop_index(
        "ix_telegram_subscribers_company_id",
        table_name="telegram_subscribers",
    )
    op.drop_table("telegram_subscribers")
    op.drop_index(
        "ix_telegram_settings_company_id",
        table_name="telegram_settings",
    )
    op.drop_table("telegram_settings")
