"""face_sync_jobs: partial unique index for active jobs only

Revision ID: a8b9c0d1e2f3
Revises: f1a2c3b4d5e6
Create Date: 2026-05-07 19:00:00.000000

The original constraint ``uq_face_sync_active`` was a full
``UniqueConstraint(device_id, employee_id, action, status)``. The
intent (documented in the model docstring) was "one active job per
(device, employee, action) at a time" — terminal rows
(SUCCESS / FAILED / CANCELLED) were supposed to be exempt so a new
job could be queued for the same target once the previous one
finished. The bug fires when an UPDATE job moves from
PENDING → SUCCESS while a *previous* SUCCESS row for the same
(device, employee, UPDATE, SUCCESS) tuple already exists from an
earlier enrollment — the unique check trips and the celery worker
loops on the same failure forever.

Fix: drop the full constraint and replace it with a partial unique
index limited to active statuses. Active = PENDING / IN_PROGRESS /
RETRY. Existing terminal rows stay; the worker can now happily
write a fresh SUCCESS without bumping into the historical one.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "a8b9c0d1e2f3"
down_revision: Union[str, None] = "f1a2c3b4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the old full unique constraint.
    op.drop_constraint(
        "uq_face_sync_active", "face_sync_jobs", type_="unique"
    )
    # Replace with a partial unique index keyed only on the active
    # statuses. Re-uses the same name so the application-side index
    # registration stays in sync.
    op.execute(
        "CREATE UNIQUE INDEX uq_face_sync_active "
        "ON face_sync_jobs (device_id, employee_id, action) "
        "WHERE status IN ('PENDING', 'IN_PROGRESS', 'RETRY')"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_face_sync_active")
    op.create_unique_constraint(
        "uq_face_sync_active",
        "face_sync_jobs",
        ["device_id", "employee_id", "action", "status"],
    )
