"""user.branch_id — pin BRANCH_MANAGER users to a single branch

Revision ID: a1f5c4b7e3d2
Revises: 7c9e2b4a1d33
Create Date: 2026-05-03 22:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1f5c4b7e3d2"
down_revision: Union[str, None] = "7c9e2b4a1d33"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("branch_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_branch_id_branches",
        "users",
        "branches",
        ["branch_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_users_branch_id",
        "users",
        ["branch_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_users_branch_id", table_name="users")
    op.drop_constraint("fk_users_branch_id_branches", "users", type_="foreignkey")
    op.drop_column("users", "branch_id")
