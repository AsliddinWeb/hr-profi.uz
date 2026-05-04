"""salary approval workflow — APPROVED/PARTIALLY_PAID statuses + audit fields

Revision ID: 9a4f2e0c8b71
Revises: 7c2a91d3f5e8
Create Date: 2026-04-30 16:10:00.000000

Additive only. Existing rows with status=DRAFT/FINALIZED/PAID keep working.
The service layer treats FINALIZED as a legacy alias for APPROVED on read.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9a4f2e0c8b71"
down_revision: Union[str, None] = "7c2a91d3f5e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "salary_periods",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "salary_periods",
        sa.Column("approved_by", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_salary_periods_approved_by_users",
        "salary_periods",
        "users",
        ["approved_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "salary_periods",
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "salary_periods",
        sa.Column("notes", sa.String(length=500), nullable=True),
    )
    op.create_index(
        "ix_salary_periods_status", "salary_periods", ["status"]
    )

    # Migrate any existing FINALIZED rows: stamp approved_at = finalized_at.
    op.execute(
        """
        UPDATE salary_periods
        SET approved_at = finalized_at
        WHERE status = 'FINALIZED' AND approved_at IS NULL;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_salary_periods_status", table_name="salary_periods")
    op.drop_column("salary_periods", "notes")
    op.drop_column("salary_periods", "paid_at")
    op.drop_constraint(
        "fk_salary_periods_approved_by_users",
        "salary_periods",
        type_="foreignkey",
    )
    op.drop_column("salary_periods", "approved_by")
    op.drop_column("salary_periods", "approved_at")
