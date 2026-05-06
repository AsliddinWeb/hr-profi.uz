"""shift_templates.working_days — per-template weekly work pattern

Revision ID: a4b9c1d2e3f5
Revises: f9b3c8d2e6a7
Create Date: 2026-05-06 15:00:00.000000

Adds a ``working_days`` JSON column listing the ISO weekdays (1=Mon … 7=Sun)
the template is "in service" on. Used by the schedule generator to know
which dates to mark PLANNED vs REST_DAY when a template is attached to
an employee.

Default ``[1, 2, 3, 4, 5, 6]`` (Mon-Sat) matches the common 6-day Uzbek
factory schedule. Companies on Mon-Fri can flip Saturday off later.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4b9c1d2e3f5"
down_revision: Union[str, None] = "f9b3c8d2e6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "shift_templates",
        sa.Column(
            "working_days",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[1, 2, 3, 4, 5, 6]'::json"),
        ),
    )


def downgrade() -> None:
    op.drop_column("shift_templates", "working_days")
