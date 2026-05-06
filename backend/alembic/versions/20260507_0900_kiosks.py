"""kiosks — tablet kiosk attendance terminals

Revision ID: c5d8e1f2a4b3
Revises: a4b9c1d2e3f5
Create Date: 2026-05-07 09:00:00.000000

A tablet running our PWA in fullscreen acts like a Hikvision face
terminal but talks plain HTTPS to ``kiosk.hr-profi.uz``. The row holds:

  - ``slug`` — appears in the kiosk login URL.
  - ``password_hash`` — bcrypt of the operator-set password (rotated by
    the admin via /admin/kiosks/{id}/reset-password).
  - ``branch_id`` — pinned at registration; a kiosk physically placed at
    one site can only ever record attendance for that site.
  - ``last_seen_at`` — updated by /kiosk/auth/heartbeat so the admin
    sees Online/Offline.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c5d8e1f2a4b3"
down_revision: Union[str, None] = "a4b9c1d2e3f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kiosks",
        sa.Column(
            "id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("branch_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("api_key_hash", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["branch_id"], ["branches.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("company_id", "slug", name="uq_kiosks_company_slug"),
        sa.UniqueConstraint("company_id", "name", name="uq_kiosks_company_name"),
    )
    op.create_index("ix_kiosks_company_id", "kiosks", ["company_id"])
    op.create_index("ix_kiosks_branch_id", "kiosks", ["branch_id"])
    op.create_index("ix_kiosks_slug", "kiosks", ["slug"])


def downgrade() -> None:
    op.drop_index("ix_kiosks_slug", table_name="kiosks")
    op.drop_index("ix_kiosks_branch_id", table_name="kiosks")
    op.drop_index("ix_kiosks_company_id", table_name="kiosks")
    op.drop_table("kiosks")
