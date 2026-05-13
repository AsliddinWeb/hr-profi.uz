"""Company.employee_code_prefix + next_employee_seq + rename existing codes

Revision ID: f1a2c3b4d5e6
Revises: e7f3a9b1d2c4
Create Date: 2026-05-08 10:00:00.000000

Adds a per-company counter for ``employee_code`` so we don't reuse
numbers freed by terminated employees, and a per-company prefix so
codes are visually unique across tenants (E-001 in every fresh
company was confusing the operators).

Backfill pass:
  1. For each company, derive ``employee_code_prefix`` from the first
     segment of the slug (truncated to 16 chars).
  2. For each company's existing employees (oldest first), rename
     ``employee_code`` to ``{prefix}-{N:04d}`` where N is 1..count.
  3. Set ``next_employee_seq = count + 1`` so brand-new employees
     pick up after the renamed range.

Done as a single transaction. If the rename collides — shouldn't,
since the new codes are unique-by-construction within each company —
we'd see a UniqueViolation and the migration rolls back, leaving the
legacy ``E-NNN`` codes intact.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2c3b4d5e6"
down_revision: Union[str, None] = "e7f3a9b1d2c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _slug_prefix(slug: str) -> str:
    """First segment of the slug (everything up to the first dash) is
    usually the recognisable company shorthand. Capped at 16 chars to
    leave room for "{prefix}-{seq:04d}" inside the 64-char code column.
    Falls back to "emp" if the slug is empty / weird."""
    if not slug:
        return "emp"
    first = slug.split("-", 1)[0] or slug
    first = first[:16] or "emp"
    return first


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("employee_code_prefix", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "companies",
        sa.Column(
            "next_employee_seq",
            sa.BigInteger(),
            nullable=False,
            server_default="1",
        ),
    )

    bind = op.get_bind()

    companies = bind.execute(
        sa.text("SELECT id, slug FROM companies ORDER BY created_at NULLS FIRST")
    ).fetchall()

    for row in companies:
        company_id = row[0]
        slug = row[1] or ""
        prefix = _slug_prefix(slug)

        # 1) Stamp the prefix.
        bind.execute(
            sa.text(
                "UPDATE companies SET employee_code_prefix = :p WHERE id = :id"
            ),
            {"p": prefix, "id": company_id},
        )

        # 2) Re-number employees oldest-first. We move them through a
        # temporary code first (``__migrating_{i}``) to dodge the
        # unique constraint when an existing code already matches the
        # destination format (e.g. on a re-run of the migration).
        employees = bind.execute(
            sa.text(
                "SELECT id, employee_code FROM employees "
                "WHERE company_id = :cid "
                "ORDER BY created_at ASC NULLS FIRST, employee_code ASC"
            ),
            {"cid": company_id},
        ).fetchall()

        # Phase 2a: shuffle to temp codes so the unique constraint
        # doesn't trip while we cross over.
        for idx, emp in enumerate(employees, start=1):
            bind.execute(
                sa.text(
                    "UPDATE employees SET employee_code = :tmp WHERE id = :id"
                ),
                {"tmp": f"__migrating_{company_id}_{idx}", "id": emp[0]},
            )

        # Phase 2b: assign the final codes.
        for idx, emp in enumerate(employees, start=1):
            new_code = f"{prefix}-{idx:04d}"
            bind.execute(
                sa.text(
                    "UPDATE employees SET employee_code = :c WHERE id = :id"
                ),
                {"c": new_code, "id": emp[0]},
            )

        # 3) Seed the counter just past the last assigned number.
        bind.execute(
            sa.text(
                "UPDATE companies SET next_employee_seq = :n WHERE id = :id"
            ),
            {"n": len(employees) + 1, "id": company_id},
        )


def downgrade() -> None:
    # Codes can't be safely reverted to the old "E-NNN" scheme without
    # losing the renumber order; leave them as-is. Just drop the
    # columns.
    op.drop_column("companies", "next_employee_seq")
    op.drop_column("companies", "employee_code_prefix")
