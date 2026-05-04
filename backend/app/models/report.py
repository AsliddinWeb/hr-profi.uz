"""Report job rows — admin-requested cross-module exports.

A small report (a few hundred rows) renders inline as a streaming CSV
response and never touches this table. Anything bigger goes through the
queue: a row lands here in PENDING, the Celery worker picks it up, runs
the generator, uploads the file to MinIO under
``{company_id}/reports/{uuid}.csv`` and flips status to READY.

Failed jobs keep their ``last_error`` so the admin can re-run with the
same params from the report queue page without retyping the filters.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin


class ReportType(StrEnum):
    ATTENDANCE_DAILY = "ATTENDANCE_DAILY"
    ATTENDANCE_MONTHLY = "ATTENDANCE_MONTHLY"
    SALARY_REGISTER = "SALARY_REGISTER"
    EMPLOYEE_ROSTER = "EMPLOYEE_ROSTER"
    KPI_SUMMARY = "KPI_SUMMARY"
    LEAVE_BALANCE = "LEAVE_BALANCE"
    BONUS_DEDUCTION_REGISTER = "BONUS_DEDUCTION_REGISTER"
    LATE_ABSENCE_TREND = "LATE_ABSENCE_TREND"


class ReportFormat(StrEnum):
    CSV = "CSV"
    # PDF + XLSX land in Phase 2; the column is here from day one so we
    # don't migrate twice.
    PDF = "PDF"
    XLSX = "XLSX"


class ReportStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    READY = "READY"
    FAILED = "FAILED"


class ReportJob(Base, TenantMixin, TimestampMixin):
    __tablename__ = "report_jobs"

    type: Mapped[ReportType] = mapped_column(String(32), nullable=False, index=True)
    format: Mapped[ReportFormat] = mapped_column(
        String(8), default=ReportFormat.CSV.value, nullable=False
    )
    status: Mapped[ReportStatus] = mapped_column(
        String(16),
        default=ReportStatus.PENDING.value,
        nullable=False,
        index=True,
    )

    # Free-form parameters; each report type validates its own shape.
    # Typical keys: ``from``, ``to``, ``year``, ``month``, ``branch_id``,
    # ``department_id``.
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    requested_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )

    file_url: Mapped[str | None] = mapped_column(String(500))
    row_count: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(1000))
