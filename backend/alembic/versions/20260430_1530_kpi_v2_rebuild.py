"""kpi v2 rebuild — additive columns + audit log table.

Revision ID: 7c2a91d3f5e8
Revises: ffe729b1a2f1
Create Date: 2026-04-30 15:30:00.000000

Additive only — no destructive changes to existing rows. Existing assignments
with status ACTIVE/COMPLETED keep working. The new status workflow values
(DRAFT/COMPUTED/APPROVED/PAID/REJECTED) come into play on next recompute.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "7c2a91d3f5e8"
down_revision: Union[str, None] = "ffe729b1a2f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ----- kpi_templates additions -----
    op.add_column(
        "kpi_templates",
        sa.Column(
            "period_kind",
            sa.String(length=16),
            nullable=False,
            server_default="MONTHLY",
        ),
    )
    op.add_column(
        "kpi_templates",
        sa.Column(
            "min_threshold_pct",
            sa.Numeric(6, 2),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "kpi_templates",
        sa.Column("max_score_cap_pct", sa.Numeric(6, 2), nullable=True),
    )
    op.add_column(
        "kpi_templates",
        sa.Column("tiers_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "kpi_templates",
        sa.Column(
            "requires_manager_review",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Widen formula and category to fit new categories + longer formulas.
    op.alter_column(
        "kpi_templates",
        "formula",
        existing_type=sa.String(length=500),
        type_=sa.String(length=1000),
        existing_nullable=False,
    )
    op.alter_column(
        "kpi_templates",
        "category",
        existing_type=sa.String(length=16),
        type_=sa.String(length=24),
        existing_nullable=False,
    )

    # ----- kpi_assignments additions -----
    op.add_column(
        "kpi_assignments",
        sa.Column(
            "weight_at_assignment",
            sa.Numeric(5, 2),
            nullable=False,
            server_default="1",
        ),
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("inputs_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("last_compute_error", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "kpi_assignments",
        sa.Column(
            "is_penalty",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("manager_rating", sa.Numeric(3, 2), nullable=True),
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("manager_comment", sa.Text(), nullable=True),
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("employee_response", sa.Text(), nullable=True),
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("approved_by", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_kpi_assignments_approved_by_users",
        "kpi_assignments",
        "users",
        ["approved_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("paid_via_bonus_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_kpi_assignments_paid_via_bonus",
        "kpi_assignments",
        "bonuses",
        ["paid_via_bonus_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("paid_via_deduction_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_kpi_assignments_paid_via_deduction",
        "kpi_assignments",
        "deductions",
        ["paid_via_deduction_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "kpi_assignments",
        sa.Column("notes", sa.Text(), nullable=True),
    )
    # Indexes on year/month for dashboard queries.
    op.create_index(
        "ix_kpi_assignments_year", "kpi_assignments", ["year"]
    )
    op.create_index(
        "ix_kpi_assignments_month", "kpi_assignments", ["month"]
    )
    op.create_index(
        "ix_kpi_assignments_status", "kpi_assignments", ["status"]
    )
    # Widen score (was Numeric(6,2) → up to 9999.99).
    op.alter_column(
        "kpi_assignments",
        "score",
        existing_type=sa.Numeric(6, 2),
        type_=sa.Numeric(8, 2),
        existing_nullable=False,
    )

    # ----- kpi_data_points additions -----
    op.add_column(
        "kpi_data_points",
        sa.Column("recorded_date", sa.Date(), nullable=True),
    )
    op.create_index(
        "ix_kpi_data_points_recorded_date",
        "kpi_data_points",
        ["recorded_date"],
    )
    op.add_column(
        "kpi_data_points",
        sa.Column("note", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "kpi_data_points",
        sa.Column("submitted_by", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_kpi_data_points_submitted_by_users",
        "kpi_data_points",
        "users",
        ["submitted_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "kpi_data_points",
        sa.Column(
            "is_void",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # ----- kpi_audit_logs (new) -----
    op.create_table(
        "kpi_audit_logs",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", sa.UUID(), nullable=False, index=True),
        sa.Column("assignment_id", sa.UUID(), nullable=True),
        sa.Column("template_id", sa.UUID(), nullable=True),
        sa.Column("event", sa.String(length=24), nullable=False),
        sa.Column("actor_id", sa.UUID(), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
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
            ["assignment_id"], ["kpi_assignments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["template_id"], ["kpi_templates.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_kpi_audit_logs_assignment_id",
        "kpi_audit_logs",
        ["assignment_id"],
    )
    op.create_index(
        "ix_kpi_audit_logs_template_id",
        "kpi_audit_logs",
        ["template_id"],
    )
    op.create_index("ix_kpi_audit_logs_event", "kpi_audit_logs", ["event"])


def downgrade() -> None:
    op.drop_index("ix_kpi_audit_logs_event", table_name="kpi_audit_logs")
    op.drop_index("ix_kpi_audit_logs_template_id", table_name="kpi_audit_logs")
    op.drop_index("ix_kpi_audit_logs_assignment_id", table_name="kpi_audit_logs")
    op.drop_table("kpi_audit_logs")

    op.drop_column("kpi_data_points", "is_void")
    op.drop_constraint(
        "fk_kpi_data_points_submitted_by_users",
        "kpi_data_points",
        type_="foreignkey",
    )
    op.drop_column("kpi_data_points", "submitted_by")
    op.drop_column("kpi_data_points", "note")
    op.drop_index("ix_kpi_data_points_recorded_date", table_name="kpi_data_points")
    op.drop_column("kpi_data_points", "recorded_date")

    op.alter_column(
        "kpi_assignments",
        "score",
        existing_type=sa.Numeric(8, 2),
        type_=sa.Numeric(6, 2),
        existing_nullable=False,
    )
    op.drop_index("ix_kpi_assignments_status", table_name="kpi_assignments")
    op.drop_index("ix_kpi_assignments_month", table_name="kpi_assignments")
    op.drop_index("ix_kpi_assignments_year", table_name="kpi_assignments")
    op.drop_column("kpi_assignments", "notes")
    op.drop_constraint(
        "fk_kpi_assignments_paid_via_deduction",
        "kpi_assignments",
        type_="foreignkey",
    )
    op.drop_column("kpi_assignments", "paid_via_deduction_id")
    op.drop_constraint(
        "fk_kpi_assignments_paid_via_bonus",
        "kpi_assignments",
        type_="foreignkey",
    )
    op.drop_column("kpi_assignments", "paid_via_bonus_id")
    op.drop_column("kpi_assignments", "approved_at")
    op.drop_constraint(
        "fk_kpi_assignments_approved_by_users",
        "kpi_assignments",
        type_="foreignkey",
    )
    op.drop_column("kpi_assignments", "approved_by")
    op.drop_column("kpi_assignments", "employee_response")
    op.drop_column("kpi_assignments", "manager_comment")
    op.drop_column("kpi_assignments", "manager_rating")
    op.drop_column("kpi_assignments", "is_penalty")
    op.drop_column("kpi_assignments", "last_compute_error")
    op.drop_column("kpi_assignments", "inputs_snapshot")
    op.drop_column("kpi_assignments", "weight_at_assignment")

    op.alter_column(
        "kpi_templates",
        "category",
        existing_type=sa.String(length=24),
        type_=sa.String(length=16),
        existing_nullable=False,
    )
    op.alter_column(
        "kpi_templates",
        "formula",
        existing_type=sa.String(length=1000),
        type_=sa.String(length=500),
        existing_nullable=False,
    )
    op.drop_column("kpi_templates", "requires_manager_review")
    op.drop_column("kpi_templates", "tiers_json")
    op.drop_column("kpi_templates", "max_score_cap_pct")
    op.drop_column("kpi_templates", "min_threshold_pct")
    op.drop_column("kpi_templates", "period_kind")
