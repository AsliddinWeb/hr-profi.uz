"""Report job schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.report import ReportFormat, ReportStatus, ReportType


class ReportJobCreate(BaseModel):
    """Admin-supplied request for a new report.

    ``params`` is intentionally untyped at the API edge — each generator
    validates the shape it expects (date range vs year/month etc.). The
    validator below pre-screens the obvious mistakes (date_from > date_to,
    invalid year/month) so a typo never reaches Celery.
    """

    type: ReportType
    format: ReportFormat = ReportFormat.CSV
    params: dict[str, Any] = Field(default_factory=dict)


class ReportJobRead(BaseModel):
    id: UUID
    company_id: UUID
    type: ReportType
    format: ReportFormat
    status: ReportStatus
    params: dict[str, Any]
    requested_by: UUID | None
    file_url: str | None
    row_count: int | None
    started_at: datetime | None
    finished_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


__all__ = ["ReportJobCreate", "ReportJobRead"]
