"""Kiosk-side runtime endpoints, mounted under ``/kiosks/me/*``.

These are hit by the tablet PWA running on ``kiosk.<DOMAIN>``. The
caller authenticates with a kiosk JWT (``role = KIOSK``) issued by
``POST /kiosks/auth/login``.

Phase 3 scope: shell, identification by employee_id (manual selection
on the tablet), check-in / check-out via the shared attendance service.
The ``recognize`` endpoint is a placeholder — Phase 4 plugs in the
face-matching pipeline.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import asc, desc, func, or_, select

from app.core.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    ValidationAppError,
)
from app.core.deps import DbDep, client_ip
from app.core.kiosk_auth import CurrentKiosk
from app.core.permissions import Role, has_permission
from app.models.attendance import (
    AttendanceMethod,
    AttendanceRecord,
    CheckType,
)
from app.models.branch import Branch
from app.models.company import Company
from app.models.department import Department
from app.models.employee import Employee
from app.schemas.attendance import CheckInRequest
from app.schemas.kiosk import (
    KioskAttendanceRequest,
    KioskAttendanceResponse,
    KioskBranchInfo,
    KioskCompanyInfo,
    KioskEmployee,
    KioskEmployeeList,
    KioskMeResponse,
    KioskRead,
    KioskRecognizeMatch,
    KioskRecognizeRequest,
    KioskRecognizeResponse,
)
from app.services import attendance_service, face_service

router = APIRouter(prefix="/kiosks/me", tags=["kiosks"])


# ---------- Helpers ----------------------------------------------------------


def _ensure_kiosk_perm(perm: str) -> None:
    """The kiosk role's permissions are coarse-grained; this is more about
    catching mis-mounting than fine-grained authz."""
    if not has_permission(Role.KIOSK, perm):
        raise PermissionDeniedError()


async def _employee_in_kiosk_branch(
    db, kiosk_branch_id: UUID, kiosk_company_id: UUID, employee_id: UUID
) -> Employee:
    """Load an Employee and assert it belongs to the kiosk's branch.

    This is the per-write tenant + branch check. Without it, a
    compromised kiosk JWT could potentially write attendance for any
    employee in the company. The assertion is also what enforces the
    "kiosks only check in their own branch's people" rule promised in
    the kiosk model docstring.
    """
    emp = (
        await db.execute(
            select(Employee)
            .where(Employee.id == employee_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if emp is None or not emp.is_active:
        raise NotFoundError("employee.not_found")
    if emp.company_id != kiosk_company_id:
        # Hide existence — never confirm cross-tenant rows.
        raise NotFoundError("employee.not_found")
    if emp.branch_id is not None and emp.branch_id != kiosk_branch_id:
        raise ValidationAppError("kiosk.employee_other_branch")
    return emp


async def _last_record(db, employee_id: UUID) -> AttendanceRecord | None:
    return (
        await db.execute(
            select(AttendanceRecord)
            .where(AttendanceRecord.employee_id == employee_id)
            .order_by(desc(AttendanceRecord.timestamp))
            .limit(1)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()


def _to_kiosk_employee(
    emp: Employee, *, currently_in: bool, dept_name: str | None
) -> KioskEmployee:
    return KioskEmployee(
        id=emp.id,
        employee_code=emp.employee_code,
        full_name=emp.full_name,
        photo_url=emp.photo_url,
        department_name=dept_name,
        position=emp.position,
        is_currently_in=currently_in,
    )


# ---------- Boot / heartbeat -------------------------------------------------


@router.get("", response_model=KioskMeResponse)
async def me(kiosk: CurrentKiosk, db: DbDep) -> KioskMeResponse:
    branch = (
        await db.execute(
            select(Branch)
            .where(Branch.id == kiosk.branch_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if branch is None:
        raise NotFoundError("branch.not_found")

    company = (
        await db.execute(
            select(Company)
            .where(Company.id == kiosk.company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if company is None:
        raise NotFoundError("company.not_found")

    # Touch last_seen on every /me call — the admin panel reads it as
    # the kiosk's heartbeat. Cheaper than a dedicated heartbeat round-trip.
    kiosk.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(kiosk)

    return KioskMeResponse(
        kiosk=KioskRead.model_validate(kiosk),
        branch=KioskBranchInfo(
            id=branch.id, name=branch.name, address=branch.address
        ),
        company=KioskCompanyInfo(
            id=company.id,
            name=company.name,
            logo_url=company.logo_url,
            settings=company.settings or {},
        ),
    )


@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat(kiosk: CurrentKiosk, db: DbDep) -> None:
    """Lightweight ping — the tablet hits this every minute or so to
    keep ``last_seen_at`` fresh between full ``/me`` refreshes."""
    kiosk.last_seen_at = datetime.now(timezone.utc)
    await db.commit()


# ---------- Employee directory ----------------------------------------------


@router.get("/employees", response_model=KioskEmployeeList)
async def list_employees(
    kiosk: CurrentKiosk,
    db: DbDep,
    q: str | None = None,
    limit: int = Query(500, ge=1, le=1000),
) -> KioskEmployeeList:
    """List employees in the kiosk's branch.

    Used by the tablet's manual-selection UI in Phase 3 (search by name
    or employee code, tap to identify) and as a fallback in Phase 4 if
    face matching fails. Sorted alphabetically — operators scan the
    list visually, not by recency.
    """
    stmt = (
        select(Employee, Department.name)
        .outerjoin(Department, Department.id == Employee.department_id)
        .where(
            Employee.company_id == kiosk.company_id,
            Employee.branch_id == kiosk.branch_id,
            Employee.is_active.is_(True),
        )
        .execution_options(skip_tenant_filter=True)
    )
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Employee.full_name).like(like),
                func.lower(Employee.employee_code).like(like),
            )
        )
    rows = (
        await db.execute(stmt.order_by(asc(Employee.full_name)).limit(limit))
    ).all()

    items: list[KioskEmployee] = []
    for emp, dept_name in rows:
        last = await _last_record(db, emp.id)
        currently_in = bool(last and last.check_type == CheckType.CHECK_IN)
        items.append(
            _to_kiosk_employee(emp, currently_in=currently_in, dept_name=dept_name)
        )

    return KioskEmployeeList(items=items, total=len(items))


# ---------- Recognition stub (Phase 4 fills this in) ------------------------


@router.post("/recognize", response_model=KioskRecognizeResponse)
async def recognize(
    data: KioskRecognizeRequest,
    kiosk: CurrentKiosk,
    db: DbDep,
) -> KioskRecognizeResponse:
    """Server-side face matching.

    Steps:
      1. Decode the captured frame.
      2. Compute its 128-d embedding (None → no face / unreadable
         image, return ``no_face_detected``).
      3. Pull every active employee in the kiosk's branch that has a
         stored embedding.
      4. Brute-force nearest neighbour. Match if distance below the
         threshold; otherwise ``low_confidence``.
    """
    # Heavy lifting is CPU-bound (~80–150 ms); offload to a thread so
    # the event loop stays responsive for other concurrent kiosk
    # requests in the same worker.
    embedding = await asyncio.to_thread(face_service.compute_embedding, data.image_base64)
    if embedding is None:
        return KioskRecognizeResponse(matched=False, reason="no_face_detected")

    rows = (
        await db.execute(
            select(
                Employee.id,
                Employee.full_name,
                Employee.employee_code,
                Employee.photo_url,
                Employee.position,
                Employee.department_id,
                Employee.face_embedding,
            )
            .where(
                Employee.company_id == kiosk.company_id,
                Employee.branch_id == kiosk.branch_id,
                Employee.is_active.is_(True),
                Employee.face_embedding.isnot(None),
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).all()

    candidates: list[face_service.Candidate] = []
    by_id: dict = {}
    for r in rows:
        emb = face_service.decode_embedding(r.face_embedding)
        if emb is None:
            continue
        candidates.append(face_service.Candidate(employee_id=r.id, embedding=emb))
        by_id[r.id] = r

    if not candidates:
        return KioskRecognizeResponse(matched=False, reason="no_enrolled_faces")

    match = await asyncio.to_thread(face_service.find_match, embedding, candidates)
    if match is None:
        return KioskRecognizeResponse(matched=False, reason="low_confidence")

    row = by_id[match.employee_id]
    dept_name = None
    if row.department_id is not None:
        dept_name = (
            await db.execute(
                select(Department.name)
                .where(Department.id == row.department_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()

    last = await _last_record(db, row.id)
    currently_in = bool(last and last.check_type == CheckType.CHECK_IN)

    return KioskRecognizeResponse(
        matched=True,
        match=KioskRecognizeMatch(
            employee=KioskEmployee(
                id=row.id,
                employee_code=row.employee_code,
                full_name=row.full_name,
                photo_url=row.photo_url,
                department_name=dept_name,
                position=row.position,
                is_currently_in=currently_in,
            ),
            score=match.score,
        ),
    )


# ---------- Check-in / Check-out --------------------------------------------


@router.post("/checkin", response_model=KioskAttendanceResponse)
async def kiosk_check_in(
    data: KioskAttendanceRequest,
    kiosk: CurrentKiosk,
    db: DbDep,
    request: Request,
    ip: str | None = Depends(client_ip),
) -> KioskAttendanceResponse:
    _ensure_kiosk_perm("kiosk.checkin")
    emp = await _employee_in_kiosk_branch(
        db, kiosk.branch_id, kiosk.company_id, data.employee_id
    )

    payload = CheckInRequest(
        selfie_base64=data.image_base64,
        branch_id=kiosk.branch_id,
        notes=data.notes,
    )
    rec = await attendance_service.check_in_for_employee(
        db,
        emp,
        payload,
        method=AttendanceMethod.KIOSK_TABLET,
        ip_address=ip,
    )

    # Same employee shape the tablet uses elsewhere — already-in flag is
    # always true after a successful check-in.
    dept_name = (
        await db.execute(
            select(Department.name)
            .where(Department.id == emp.department_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none() if emp.department_id else None

    _ = request  # request is reserved for future audit logging
    return KioskAttendanceResponse(
        employee=_to_kiosk_employee(
            emp, currently_in=True, dept_name=dept_name
        ),
        check_type="CHECK_IN",
        timestamp=rec.timestamp,
        is_late=rec.is_late,
        late_minutes=rec.late_minutes,
        overtime_minutes=0,
    )


@router.post("/checkout", response_model=KioskAttendanceResponse)
async def kiosk_check_out(
    data: KioskAttendanceRequest,
    kiosk: CurrentKiosk,
    db: DbDep,
    request: Request,
    ip: str | None = Depends(client_ip),
) -> KioskAttendanceResponse:
    _ensure_kiosk_perm("kiosk.checkout")
    emp = await _employee_in_kiosk_branch(
        db, kiosk.branch_id, kiosk.company_id, data.employee_id
    )

    payload = CheckInRequest(
        selfie_base64=data.image_base64,
        branch_id=kiosk.branch_id,
        notes=data.notes,
    )
    rec = await attendance_service.check_out_for_employee(
        db,
        emp,
        payload,
        method=AttendanceMethod.KIOSK_TABLET,
        ip_address=ip,
    )

    dept_name = (
        await db.execute(
            select(Department.name)
            .where(Department.id == emp.department_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none() if emp.department_id else None

    _ = request
    return KioskAttendanceResponse(
        employee=_to_kiosk_employee(
            emp, currently_in=False, dept_name=dept_name
        ),
        check_type="CHECK_OUT",
        timestamp=rec.timestamp,
        is_late=False,
        late_minutes=0,
        overtime_minutes=rec.overtime_minutes,
    )


__all__ = ["router"]
