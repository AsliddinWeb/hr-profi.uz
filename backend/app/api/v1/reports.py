"""Cross-module report exports.

Two flavours:

- ``GET /reports/inline?type=...&...`` returns a streaming CSV directly.
  Used for small ad-hoc exports (employee roster, single-day attendance)
  where waiting on a queue feels silly.

- ``POST /reports`` enqueues a ReportJob (Celery worker generates and
  uploads to MinIO). The admin polls / WebSocket-listens for status,
  then ``GET /reports/{id}/download`` redirects to the file URL.
"""
from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import desc, func, select

from app.core.deps import (
    CurrentUser,
    DbDep,
    TenantId,
    require_permission,
)
from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationAppError
from app.core.permissions import Role
from app.models.report import ReportJob, ReportStatus, ReportType
from app.schemas.common import MessageResponse, Page
from app.schemas.report import ReportJobCreate, ReportJobRead
from app.services import audit_service, report_service

router = APIRouter(prefix="/reports", tags=["reports"])
logger = logging.getLogger(__name__)


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


@router.get(
    "",
    response_model=Page[ReportJobRead],
    dependencies=[Depends(require_permission("report.read"))],
)
async def list_jobs(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    type_filter: ReportType | None = Query(None, alias="type"),
    status_filter: ReportStatus | None = Query(None, alias="status"),
) -> Page[ReportJobRead]:
    """List report jobs, newest first.

    BRANCH_MANAGER sees only their own jobs (the `requested_by` filter)
    so a BM can't peek at another branch's exports — even though the
    underlying generators already scope by branch, the request log is
    additional information they shouldn't have."""
    _company_id(user, tenant)
    stmt = select(ReportJob).order_by(desc(ReportJob.created_at))
    count_stmt = select(func.count(ReportJob.id))
    if user.role == Role.BRANCH_MANAGER:
        stmt = stmt.where(ReportJob.requested_by == user.id)
        count_stmt = count_stmt.where(ReportJob.requested_by == user.id)
    if type_filter is not None:
        stmt = stmt.where(ReportJob.type == type_filter.value)
        count_stmt = count_stmt.where(ReportJob.type == type_filter.value)
    if status_filter is not None:
        stmt = stmt.where(ReportJob.status == status_filter.value)
        count_stmt = count_stmt.where(ReportJob.status == status_filter.value)
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(stmt.offset((page - 1) * size).limit(size))
    ).scalars().all()
    return Page[ReportJobRead](
        items=[ReportJobRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=ReportJobRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("report.create"))],
)
async def create_job(
    data: ReportJobCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> ReportJobRead:
    """Enqueue a report job. CSV in Phase 1; PDF/XLSX raise 400.

    The Celery worker picks this up; meanwhile the response is the row
    in PENDING state so the UI can start polling /reports/{id}.
    """
    company_id = _company_id(user, tenant)

    job = ReportJob(
        company_id=company_id,
        type=data.type.value,
        format=data.format.value,
        status=ReportStatus.PENDING.value,
        params=data.params or {},
        requested_by=user.id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    await audit_service.record(
        db,
        action="report.create",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="report_job",
        resource_id=job.id,
        payload={"type": data.type.value, "format": data.format.value},
        commit=True,
    )

    # Kick the worker eagerly so the admin doesn't wait for the next beat
    # tick. Lazy import keeps this module importable without Celery.
    try:
        from app.tasks.report_tasks import run_report_job

        run_report_job.delay(str(job.id))
    except Exception:  # noqa: BLE001
        logger.exception("failed to dispatch report job %s", job.id)

    return ReportJobRead.model_validate(job)


@router.get(
    "/inline",
    dependencies=[Depends(require_permission("report.create"))],
)
async def inline_export(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    type_param: ReportType = Query(..., alias="type"),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    branch_id: UUID | None = None,
    department_id: UUID | None = None,
    include_inactive: bool | None = None,
) -> StreamingResponse:
    """Stream a CSV directly. Skips the queue — useful for small reports."""
    company_id = _company_id(user, tenant)
    params: dict = {}
    if date_from:
        params["from"] = date_from
    if date_to:
        params["to"] = date_to
    if year is not None:
        params["year"] = year
    if month is not None:
        params["month"] = month
    if branch_id is not None:
        params["branch_id"] = str(branch_id)
    if department_id is not None:
        params["department_id"] = str(department_id)
    if include_inactive is not None:
        params["include_inactive"] = include_inactive

    filename = f"{type_param.value.lower()}_{datetime.utcnow().date().isoformat()}.csv"
    return StreamingResponse(
        report_service.stream_inline(db, company_id, user, type_param, params),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get(
    "/{job_id}",
    response_model=ReportJobRead,
    dependencies=[Depends(require_permission("report.read"))],
)
async def get_job(
    job_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> ReportJobRead:
    _company_id(user, tenant)
    job = (
        await db.execute(select(ReportJob).where(ReportJob.id == job_id))
    ).scalar_one_or_none()
    if not job:
        raise NotFoundError("report.not_found")
    if user.role == Role.BRANCH_MANAGER and job.requested_by != user.id:
        raise NotFoundError("report.not_found")  # hide existence
    return ReportJobRead.model_validate(job)


@router.get(
    "/{job_id}/download",
    dependencies=[Depends(require_permission("report.read"))],
)
async def download_job(
    job_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> RedirectResponse:
    """Redirect to the MinIO file URL once the job is READY."""
    _company_id(user, tenant)
    job = (
        await db.execute(select(ReportJob).where(ReportJob.id == job_id))
    ).scalar_one_or_none()
    if not job:
        raise NotFoundError("report.not_found")
    if user.role == Role.BRANCH_MANAGER and job.requested_by != user.id:
        raise NotFoundError("report.not_found")
    if job.status != ReportStatus.READY.value or not job.file_url:
        raise ValidationAppError("report.not_ready")
    return RedirectResponse(job.file_url, status_code=302)


@router.get("/me/monthly")
async def my_monthly_pdf(
    user: CurrentUser,
    db: DbDep,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
) -> StreamingResponse:
    """Self-service: an EMPLOYEE downloads a personalised monthly PDF.

    Lives outside the ``report.read`` permission tree because EMPLOYEEs
    aren't supposed to touch the company-wide reports queue. Their
    portion is tightly scoped: ``render_personal_pdf`` only reads the
    caller's own employee row, daily accruals and attendance records.
    """
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    from app.services.reports.me import render_personal_pdf

    pdf_bytes = await render_personal_pdf(
        db, user, year=year, month=month, locale=user.language or "uz"
    )

    def gen():
        yield pdf_bytes

    return StreamingResponse(
        gen(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="monthly_{year}-{month:02d}.pdf"'
            ),
        },
    )


@router.post(
    "/{job_id}/retry",
    response_model=ReportJobRead,
    dependencies=[Depends(require_permission("report.create"))],
)
async def retry_job(
    job_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> ReportJobRead:
    """Re-run a FAILED (or already-READY) job with the same params."""
    _company_id(user, tenant)
    job = (
        await db.execute(select(ReportJob).where(ReportJob.id == job_id))
    ).scalar_one_or_none()
    if not job:
        raise NotFoundError("report.not_found")
    if user.role == Role.BRANCH_MANAGER and job.requested_by != user.id:
        raise NotFoundError("report.not_found")
    job.status = ReportStatus.PENDING.value
    job.last_error = None
    job.file_url = None
    job.row_count = None
    job.started_at = None
    job.finished_at = None
    await db.commit()
    await db.refresh(job)
    try:
        from app.tasks.report_tasks import run_report_job

        run_report_job.delay(str(job.id))
    except Exception:  # noqa: BLE001
        logger.exception("failed to dispatch report job %s on retry", job.id)
    return ReportJobRead.model_validate(job)
