"""report_jobs — admin-requested cross-module exports

Revision ID: f9b3c8d2e6a7
Revises: e7a2b3c1d8f4
Create Date: 2026-05-04 09:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f9b3c8d2e6a7"
down_revision: Union[str, None] = "e7a2b3c1d8f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "report_jobs",
        sa.Column(
            "id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("format", sa.String(length=8), nullable=False, server_default="CSV"),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="PENDING"
        ),
        sa.Column(
            "params", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")
        ),
        sa.Column("requested_by", sa.UUID(), nullable=True),
        sa.Column("file_url", sa.String(length=500), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
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
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_report_jobs_company_id", "report_jobs", ["company_id"])
    op.create_index("ix_report_jobs_type", "report_jobs", ["type"])
    op.create_index("ix_report_jobs_status", "report_jobs", ["status"])
    op.create_index("ix_report_jobs_requested_by", "report_jobs", ["requested_by"])


def downgrade() -> None:
    op.drop_index("ix_report_jobs_requested_by", table_name="report_jobs")
    op.drop_index("ix_report_jobs_status", table_name="report_jobs")
    op.drop_index("ix_report_jobs_type", table_name="report_jobs")
    op.drop_index("ix_report_jobs_company_id", table_name="report_jobs")
    op.drop_table("report_jobs")
