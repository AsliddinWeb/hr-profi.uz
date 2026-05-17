"""telegram_subscribers: employee_id -> user_id

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-05-17 12:00:00.000000

Phase 1/2 originally tied a subscriber to an ``Employee`` row, but the
product reality is: a Telegram subscriber is a *boss/manager* (HR,
COMPANY_ADMIN, BRANCH_MANAGER) who wants Telegram visibility into the
business — not a regular employee receiving their own notifications.
The admin UI was picking from the employees list, which surfaced
warehouse staff / drivers / cashiers when the admin wanted to pick a
boss.

Switch the FK target to ``users``. Existing rows are dropped (the
table shipped today; any pre-existing rows are test data).

Schema change:
  * DELETE FROM telegram_subscribers
  * DROP unique (company_id, employee_id) + index + FK + column
  * ADD user_id UUID NOT NULL + FK users(id) ON DELETE CASCADE + index
  * ADD unique (company_id, user_id)
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c0d1e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No real production data — the table was created on 2026-05-16 and
    # only contains operator test rows. A clean swap is safe.
    op.execute("DELETE FROM telegram_subscribers")

    op.drop_constraint(
        "uq_telegram_subscriber_employee",
        "telegram_subscribers",
        type_="unique",
    )
    op.drop_index(
        "ix_telegram_subscribers_employee_id",
        table_name="telegram_subscribers",
    )
    op.drop_column("telegram_subscribers", "employee_id")

    op.add_column(
        "telegram_subscribers",
        sa.Column("user_id", sa.UUID(), nullable=False),
    )
    op.create_foreign_key(
        "fk_telegram_subscribers_user_id",
        "telegram_subscribers",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_telegram_subscribers_user_id",
        "telegram_subscribers",
        ["user_id"],
    )
    op.create_unique_constraint(
        "uq_telegram_subscriber_user",
        "telegram_subscribers",
        ["company_id", "user_id"],
    )


def downgrade() -> None:
    op.execute("DELETE FROM telegram_subscribers")
    op.drop_constraint(
        "uq_telegram_subscriber_user",
        "telegram_subscribers",
        type_="unique",
    )
    op.drop_index(
        "ix_telegram_subscribers_user_id",
        table_name="telegram_subscribers",
    )
    op.drop_constraint(
        "fk_telegram_subscribers_user_id",
        "telegram_subscribers",
        type_="foreignkey",
    )
    op.drop_column("telegram_subscribers", "user_id")

    op.add_column(
        "telegram_subscribers",
        sa.Column("employee_id", sa.UUID(), nullable=False),
    )
    op.create_foreign_key(
        "fk_telegram_subscribers_employee_id",
        "telegram_subscribers",
        "employees",
        ["employee_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_telegram_subscribers_employee_id",
        "telegram_subscribers",
        ["employee_id"],
    )
    op.create_unique_constraint(
        "uq_telegram_subscriber_employee",
        "telegram_subscribers",
        ["company_id", "employee_id"],
    )
