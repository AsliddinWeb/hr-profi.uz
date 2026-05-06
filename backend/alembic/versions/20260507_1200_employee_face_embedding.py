"""employee.face_embedding — server-side face recognition for kiosks

Revision ID: e7f3a9b1d2c4
Revises: c5d8e1f2a4b3
Create Date: 2026-05-07 12:00:00.000000

Holds a 128-d face descriptor produced by face_recognition (dlib's
ResNet-based encoder) for each enrolled employee. Stored as raw
``bytes`` (numpy ``.tobytes()`` on a float64 array → 1024 B) since
PostgreSQL's ``bytea`` is the cheapest, no-extension way to keep
binary blobs and we don't need vector ops yet — kiosk matching is a
brute-force pass over branch employees, which is plenty fast at the
scale we expect (<5 000 employees per company).

A companion ``face_enrolled_at`` timestamp lets the admin UI show a
"face enrollment" badge without a second query, and lets the
``backfill`` script skip employees whose embedding is already current.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7f3a9b1d2c4"
down_revision: Union[str, None] = "c5d8e1f2a4b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column("face_embedding", sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("face_enrolled_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Partial index so the kiosk recognize endpoint can filter to only
    # enrolled employees without scanning the whole table.
    op.create_index(
        "ix_employees_face_enrolled",
        "employees",
        ["company_id", "branch_id"],
        postgresql_where=sa.text("face_embedding IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_employees_face_enrolled", table_name="employees")
    op.drop_column("employees", "face_enrolled_at")
    op.drop_column("employees", "face_embedding")
