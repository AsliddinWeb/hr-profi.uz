"""Report job runner — picks the right generator, streams CSV to MinIO."""
from __future__ import annotations

import csv
import io
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.report import ReportFormat, ReportJob, ReportStatus, ReportType
from app.models.user import User
from app.services.reports.attendance import attendance_daily, attendance_monthly
from app.services.reports.employees import employee_roster
from app.services.reports.extras import (
    bonus_deduction_register,
    kpi_summary,
    late_absence_trend,
    leave_balance,
)
from app.services.reports.i18n import add_row_numbers, localize_report
from app.services.reports.salary import salary_register

logger = logging.getLogger(__name__)


_GENERATORS = {
    ReportType.ATTENDANCE_DAILY.value: attendance_daily,
    ReportType.ATTENDANCE_MONTHLY.value: attendance_monthly,
    ReportType.SALARY_REGISTER.value: salary_register,
    ReportType.EMPLOYEE_ROSTER.value: employee_roster,
    ReportType.KPI_SUMMARY.value: kpi_summary,
    ReportType.LEAVE_BALANCE.value: leave_balance,
    ReportType.BONUS_DEDUCTION_REGISTER.value: bonus_deduction_register,
    ReportType.LATE_ABSENCE_TREND.value: late_absence_trend,
}


def _branch_filter_for(user: User) -> UUID | None:
    """Return ``user.branch_id`` for BRANCH_MANAGER, ``None`` for everyone
    else. Generators must respect this so a BM-triggered export stays
    scoped to their branch even if a stale ``params['branch_id']`` made
    it through."""
    from app.core.permissions import Role

    if user.role == Role.BRANCH_MANAGER:
        return user.branch_id
    return None


async def _collect_rows(
    db: AsyncSession,
    job: ReportJob,
    user: User,
) -> tuple[list[str], list[list[str]]]:
    """Run the generator and split the stream into ``(headers, rows)``.

    Both PDF and XLSX renderers want the structured shape (so they can
    style numeric columns, render a totals row etc.). The CSV path
    re-encodes from this same tuple so we don't run the generator twice.
    """
    gen_fn = _GENERATORS.get(
        job.type.value if hasattr(job.type, "value") else str(job.type)
    )
    if gen_fn is None:
        raise ValueError(f"unknown_report_type:{job.type}")

    branch_filter = _branch_filter_for(user)

    headers: list[str] = []
    rows: list[list[str]] = []
    is_header = True
    async for row in gen_fn(db, job.company_id, job.params or {}, branch_filter):
        if is_header:
            headers = list(row)
            is_header = False
        else:
            rows.append(list(row))
    return headers, rows


def _csv_bytes(headers: list[str], rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for r in rows:
        writer.writerow(r)
    return buf.getvalue().encode("utf-8")


_CONTENT_TYPE = {
    ReportFormat.CSV.value: "text/csv",
    ReportFormat.PDF.value: "application/pdf",
    ReportFormat.XLSX.value: (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),
}

_EXTENSION = {
    ReportFormat.CSV.value: "csv",
    ReportFormat.PDF.value: "pdf",
    ReportFormat.XLSX.value: "xlsx",
}


def _upload(
    *, company_id: UUID, content: bytes, filename: str, format_value: str
) -> str:
    """Drop the rendered file into MinIO and return its public URL."""
    from app.services import storage_service

    object_name = f"{company_id}/reports/{uuid.uuid4().hex}_{filename}"
    storage_service._ensure_bucket()  # noqa: SLF001  (private helper, fine here)
    storage_service._client().put_object(  # noqa: SLF001
        storage_service.settings.minio_bucket,
        object_name,
        data=io.BytesIO(content),
        length=len(content),
        content_type=_CONTENT_TYPE.get(format_value, "application/octet-stream"),
    )
    return storage_service._public_url(object_name)  # noqa: SLF001


async def _branch_name(db: AsyncSession, branch_id: UUID | None) -> str | None:
    if branch_id is None:
        return None
    from app.models.branch import Branch

    row = (
        await db.execute(
            select(Branch.name)
            .where(Branch.id == branch_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    return row


def _subtitle_for(report_type: str, params: dict) -> str:
    """One-liner under the brand bar — what the report's date range is."""
    if report_type in (
        "ATTENDANCE_MONTHLY",
        "SALARY_REGISTER",
        "KPI_SUMMARY",
    ):
        y = params.get("year")
        m = params.get("month")
        if y and m:
            return f"{y}-{int(m):02d}"
    if report_type == "LEAVE_BALANCE":
        y = params.get("year")
        if y:
            return str(y)
    if report_type in (
        "ATTENDANCE_DAILY",
        "BONUS_DEDUCTION_REGISTER",
        "LATE_ABSENCE_TREND",
    ):
        f = params.get("from")
        t = params.get("to")
        if f and t:
            return f"{f} → {t}"
    return ""


async def run_job(db: AsyncSession, job_id: UUID) -> ReportJob:
    """Generate the report file for a single ReportJob row and update its
    status. Caller commits."""
    job = (
        await db.execute(
            select(ReportJob)
            .where(ReportJob.id == job_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()

    user = (
        await db.execute(
            select(User)
            .where(User.id == job.requested_by)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if user is None:
        # Shouldn't happen — requested_by is set on creation. If it does,
        # we still run the report but with no branch scope (treat as CA).
        from types import SimpleNamespace

        user = SimpleNamespace(role="COMPANY_ADMIN", branch_id=None)

    job.status = ReportStatus.RUNNING.value
    job.started_at = datetime.now(timezone.utc)
    job.last_error = None
    await db.flush()

    try:
        headers, rows = await _collect_rows(db, job, user)

        # Translate English headers + categorical cells (status, direction,
        # salary type, lifecycle) to the requester's language. PDF/XLSX/CSV
        # all see the localized values from this point on. The PDF template
        # uses ``status_label_to_class_map`` to keep CSS class names stable.
        report_type_for_i18n = (
            job.type.value if hasattr(job.type, "value") else str(job.type)
        )
        locale = (getattr(user, "language", None) or "uz") or "uz"
        headers, rows = localize_report(
            report_type_for_i18n, headers, rows, locale=locale
        )
        # Prepend a "№" column with 1-based row numbers so the printed
        # spreadsheet/PDF gives every row an obvious sequential ID.
        headers, rows = add_row_numbers(headers, rows)

        from app.models.company import Company

        company = (
            await db.execute(
                select(Company)
                .where(Company.id == job.company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one()

        report_type_value = (
            job.type.value if hasattr(job.type, "value") else str(job.type)
        )
        format_value = (
            job.format.value if hasattr(job.format, "value") else str(job.format)
        )

        # The user could be SimpleNamespace fallback if the requester was
        # deleted; ``_branch_name`` only takes the ID off ``job.params`` /
        # the user's pin, so it's safe.
        branch_id = None
        if hasattr(user, "branch_id") and user.branch_id is not None:
            branch_id = user.branch_id
        elif job.params and job.params.get("branch_id"):
            try:
                branch_id = UUID(str(job.params["branch_id"]))
            except (ValueError, TypeError):
                branch_id = None
        branch_name = await _branch_name(db, branch_id)

        if format_value == ReportFormat.CSV.value:
            content = _csv_bytes(headers, rows)
        elif format_value == ReportFormat.PDF.value:
            from app.services.reports.renderers import render_pdf

            content = render_pdf(
                report_type=report_type_value,
                headers=headers,
                rows=rows,
                company=company,
                requested_by=user if isinstance(user, User) else None,
                subtitle=_subtitle_for(report_type_value, job.params or {}),
                branch_name=branch_name,
                locale=getattr(user, "language", "uz") or "uz",
            )
        elif format_value == ReportFormat.XLSX.value:
            from app.services.reports.renderers import render_xlsx

            content = render_xlsx(
                report_type=report_type_value,
                headers=headers,
                rows=rows,
                company=company,
            )
        else:
            raise ValueError(f"unsupported_format:{format_value}")

        filename_stub = report_type_value.lower()
        ext = _EXTENSION.get(format_value, "bin")
        url = _upload(
            company_id=job.company_id,
            content=content,
            filename=f"{filename_stub}.{ext}",
            format_value=format_value,
        )
        job.file_url = url
        job.row_count = len(rows)
        job.status = ReportStatus.READY.value
        job.finished_at = datetime.now(timezone.utc)
    except Exception as e:  # noqa: BLE001
        logger.exception("report job %s failed", job.id)
        job.status = ReportStatus.FAILED.value
        job.last_error = str(e)[:1000]
        job.finished_at = datetime.now(timezone.utc)
    return job


async def stream_inline(
    db: AsyncSession,
    company_id: UUID,
    user: User,
    report_type: ReportType,
    params: dict,
) -> AsyncIterator[bytes]:
    """Streaming variant for synchronous (small) exports.

    Yields CSV chunks suitable for ``StreamingResponse``. A BM's
    ``branch_id`` is injected via ``_branch_filter_for`` so the inline
    download honours the same scope the queue version does.
    """
    gen_fn = _GENERATORS.get(report_type.value)
    if gen_fn is None:
        raise ValueError(f"unknown_report_type:{report_type}")
    branch_filter = _branch_filter_for(user)

    # Buffer all rows so we can localise + prepend row IDs in one pass.
    # The inline path is intended for small exports (live download
    # button), so the trade-off is acceptable.
    headers: list[str] = []
    rows: list[list[str]] = []
    is_header = True
    async for row in gen_fn(db, company_id, params, branch_filter):
        if is_header:
            headers = list(row)
            is_header = False
        else:
            rows.append(list(row))

    locale = (getattr(user, "language", None) or "uz") or "uz"
    headers, rows = localize_report(report_type.value, headers, rows, locale=locale)
    headers, rows = add_row_numbers(headers, rows)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
        # Flush in 32KB chunks so the browser's download progress isn't
        # blocked on a giant single write.
        if buf.tell() > 32 * 1024:
            chunk = buf.getvalue().encode("utf-8")
            buf.seek(0)
            buf.truncate(0)
            yield chunk
    if buf.tell() > 0:
        yield buf.getvalue().encode("utf-8")


__all__ = ["run_job", "stream_inline"]
