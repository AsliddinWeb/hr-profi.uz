"""face_sync_jobs — per-(device, employee, action) template sync queue

Revision ID: e7a2b3c1d8f4
Revises: c4d8b9e2f0a1
Create Date: 2026-05-03 23:30:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7a2b3c1d8f4"
down_revision: Union[str, None] = "c4d8b9e2f0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "face_sync_jobs",
        sa.Column(
            "id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("device_id", sa.UUID(), nullable=False),
        sa.Column("employee_id", sa.UUID(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("photo_url_at_enqueue", sa.String(length=500), nullable=True),
        sa.Column("vendor_template_id", sa.String(length=128), nullable=True),
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
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "device_id", "employee_id", "action", "status",
            name="uq_face_sync_active",
        ),
    )
    op.create_index(
        "ix_face_sync_jobs_company_id", "face_sync_jobs", ["company_id"]
    )
    op.create_index(
        "ix_face_sync_jobs_device_id", "face_sync_jobs", ["device_id"]
    )
    op.create_index(
        "ix_face_sync_jobs_employee_id", "face_sync_jobs", ["employee_id"]
    )
    op.create_index("ix_face_sync_jobs_status", "face_sync_jobs", ["status"])
    op.create_index(
        "ix_face_sync_jobs_next_retry_at", "face_sync_jobs", ["next_retry_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_face_sync_jobs_next_retry_at", table_name="face_sync_jobs")
    op.drop_index("ix_face_sync_jobs_status", table_name="face_sync_jobs")
    op.drop_index("ix_face_sync_jobs_employee_id", table_name="face_sync_jobs")
    op.drop_index("ix_face_sync_jobs_device_id", table_name="face_sync_jobs")
    op.drop_index("ix_face_sync_jobs_company_id", table_name="face_sync_jobs")
    op.drop_table("face_sync_jobs")
