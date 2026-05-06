"""Employee CRUD + bulk import + employee-self routes."""
from __future__ import annotations

import csv
import io
import re
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from app.core.deps import (
    CurrentUser,
    DbDep,
    TenantId,
    apply_branch_scope,
    require_permission,
)
from app.core.exceptions import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationAppError,
)
from app.core.permissions import Role
from app.models.employee import Employee
from app.models.user import User
from app.schemas.common import MessageResponse, Page
from app.schemas.employee import (
    EmployeeBulkImportResult,
    EmployeeCreate,
    EmployeeRead,
    EmployeeUpdate,
)
from app.services import audit_service, employee_service

router = APIRouter(prefix="/employees", tags=["employees"])


def _resolved_company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


# --- /next-code — placed BEFORE /{id} so it doesn't get caught by the path
#     parameter route.

class NextEmployeeCode(BaseModel):
    code: str


_CODE_PATTERN = re.compile(r"^E-(\d+)$")


@router.get(
    "/next-code",
    response_model=NextEmployeeCode,
    dependencies=[Depends(require_permission("employee.read"))],
)
async def next_employee_code(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> NextEmployeeCode:
    """Suggest the next ``E-NNN`` for the current company.

    Scans existing employees (incl. terminated/inactive) for codes matching
    ``E-<digits>`` and returns the smallest unused integer with 3-digit
    zero padding. Gaps from terminations are kept — we always return
    ``max + 1`` so codes stay monotonically increasing for audit trails.
    """
    company_id = _resolved_company_id(user, tenant)

    rows = (
        await db.execute(
            select(Employee.employee_code).where(Employee.company_id == company_id)
        )
    ).scalars().all()

    max_n = 0
    for c in rows:
        m = _CODE_PATTERN.match(c or "")
        if not m:
            continue
        n = int(m.group(1))
        if n > max_n:
            max_n = n

    return NextEmployeeCode(code=f"E-{max_n + 1:03d}")


# --- /me (employee self-read) — placed BEFORE /{id} so it doesn't get caught
#     by the path parameter route.

@router.get("/me", response_model=EmployeeRead)
async def my_employee_record(
    user: CurrentUser,
    db: DbDep,
) -> EmployeeRead:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    stmt = select(Employee).where(Employee.user_id == user.id)
    emp = (await db.execute(stmt)).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    return EmployeeRead.model_validate(emp)


# --- Admin CRUD ----------------------------------------------------------------


@router.get(
    "",
    response_model=Page[EmployeeRead],
    dependencies=[Depends(require_permission("employee.read"))],
)
async def list_employees(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    branch_id: UUID | None = None,
    department_id: UUID | None = None,
    q: str | None = None,
    is_active: bool | None = None,
) -> Page[EmployeeRead]:
    _resolved_company_id(user, tenant)

    # BRANCH_MANAGER is silently scoped to their own branch via apply_branch_scope.
    # An explicit ``?branch_id=`` filter is still allowed for Owner/CA/HR.
    stmt = apply_branch_scope(select(Employee), user, Employee.branch_id)
    count_stmt = apply_branch_scope(
        select(func.count(Employee.id)), user, Employee.branch_id
    )
    if branch_id is not None:
        stmt = stmt.where(Employee.branch_id == branch_id)
        count_stmt = count_stmt.where(Employee.branch_id == branch_id)
    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)
        count_stmt = count_stmt.where(Employee.department_id == department_id)
    if q:
        like = f"%{q.lower()}%"
        cond = or_(
            func.lower(Employee.full_name).like(like),
            func.lower(Employee.employee_code).like(like),
            func.lower(Employee.phone).like(like),
        )
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if is_active is not None:
        stmt = stmt.where(Employee.is_active.is_(is_active))
        count_stmt = count_stmt.where(Employee.is_active.is_(is_active))

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(
            stmt.order_by(Employee.created_at.desc()).offset((page - 1) * size).limit(size)
        )
    ).scalars().all()
    return Page[EmployeeRead](
        items=[EmployeeRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=EmployeeRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("employee.create"))],
)
async def create_employee(
    data: EmployeeCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> EmployeeRead:
    company_id = _resolved_company_id(user, tenant)
    employee = await employee_service.create_employee(db, company_id, data)
    await db.commit()
    await db.refresh(employee)
    await audit_service.record(
        db,
        action="employee.create",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="employee",
        resource_id=employee.id,
        commit=True,
    )
    # Fan out face-template enrollment to every active device in the
    # employee's branch. Best-effort: a missing photo_url just means the
    # job will fail and surface in the admin's queue UI for follow-up.
    if employee.photo_url and employee.branch_id is not None:
        try:
            from app.models.face_sync import FaceSyncAction
            from app.services import face_sync_service

            await face_sync_service.enqueue_for_employee(
                db, employee, FaceSyncAction.ENROLL
            )
            await db.commit()
        except Exception:  # noqa: BLE001
            import logging

            logging.getLogger(__name__).exception(
                "face_sync enqueue (create) failed for emp=%s", employee.id
            )
    return EmployeeRead.model_validate(employee)


@router.post(
    "/bulk-import",
    response_model=EmployeeBulkImportResult,
    dependencies=[Depends(require_permission("employee.create"))],
)
async def bulk_import_employees(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    file: UploadFile = File(..., description="CSV: employee_code,full_name,phone,email,position"),
) -> EmployeeBulkImportResult:
    """Minimal CSV import.

    Required header columns: ``employee_code, full_name``. Optional:
    ``phone, email, position, hire_date (YYYY-MM-DD)``. One employee per row,
    no auth-user provisioning (admin can flip ``create_login`` per row later
    via PATCH/dedicated endpoint).
    """
    company_id = _resolved_company_id(user, tenant)
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))

    required = {"employee_code", "full_name"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValidationAppError("employee.import_missing_columns")

    created = 0
    skipped = 0
    errors: list[dict] = []

    for line_no, row in enumerate(reader, start=2):  # row 1 = header
        try:
            payload = EmployeeCreate(
                employee_code=row["employee_code"].strip(),
                full_name=row["full_name"].strip(),
                phone=(row.get("phone") or "").strip() or None,
                email=(row.get("email") or "").strip() or None,
                position=(row.get("position") or "").strip() or None,
                hire_date=row.get("hire_date") or None,
            )
            await employee_service.create_employee(db, company_id, payload)
            created += 1
        except ConflictError:
            skipped += 1
        except Exception as e:  # noqa: BLE001 - we surface every parse error
            errors.append({"line": line_no, "error": str(e)})

    if created:
        await db.commit()
    await audit_service.record(
        db,
        action="employee.bulk_import",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        payload={"created": created, "skipped": skipped, "errors": len(errors)},
        commit=True,
    )
    return EmployeeBulkImportResult(created=created, skipped=skipped, errors=errors)


async def _get_employee(
    db, employee_id: UUID, user: "User | None" = None
) -> Employee:
    emp = (
        await db.execute(select(Employee).where(Employee.id == employee_id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    # Branch isolation: a BRANCH_MANAGER must not be able to read or mutate an
    # employee outside their assigned branch. Treat foreign-branch hits the
    # same as "not found" so we don't leak existence.
    if (
        user is not None
        and user.role == Role.BRANCH_MANAGER
        and user.branch_id is not None
        and emp.branch_id != user.branch_id
    ):
        raise NotFoundError("employee.not_found")
    return emp


@router.get(
    "/{employee_id}",
    response_model=EmployeeRead,
    dependencies=[Depends(require_permission("employee.read"))],
)
async def get_employee(
    employee_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> EmployeeRead:
    _resolved_company_id(user, tenant)
    return EmployeeRead.model_validate(await _get_employee(db, employee_id, user))


@router.patch(
    "/{employee_id}",
    response_model=EmployeeRead,
    dependencies=[Depends(require_permission("employee.update"))],
)
async def update_employee(
    employee_id: UUID,
    data: EmployeeUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> EmployeeRead:
    _resolved_company_id(user, tenant)
    emp = await _get_employee(db, employee_id, user)

    # Snapshot the fields the face-sync queue cares about so we can detect
    # transitions after the in-memory mutation. Branch changes need a
    # DELETE on the old branch's devices + ENROLL on the new branch's.
    old_photo = emp.photo_url
    old_branch = emp.branch_id
    old_active = emp.is_active
    old_template = emp.shift_template_id

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(emp, field, value)
    await db.commit()
    await db.refresh(emp)

    # Schedule regen — fired when the template assignment changes so the
    # calendar reflects the new weekly pattern immediately.
    if emp.shift_template_id != old_template:
        from app.services.shift_service import regenerate_employee_schedule

        try:
            await regenerate_employee_schedule(db, employee_id=emp.id)
            await db.commit()
        except Exception:  # pragma: no cover — defensive
            await db.rollback()

    # Decide what (if anything) to enqueue.
    try:
        from app.models.device import Device
        from app.models.face_sync import FaceSyncAction
        from app.services import face_sync_service
        from sqlalchemy import select as _select

        if not emp.is_active and old_active:
            # Termination via PATCH is_active=False — wipe templates
            # everywhere the employee currently lives.
            await face_sync_service.enqueue_for_employee(
                db, emp, FaceSyncAction.DELETE,
            )
            await db.commit()
        elif emp.is_active:
            if old_branch != emp.branch_id:
                # Re-targeted to a different branch: remove from old
                # branch's devices, enroll on the new ones.
                if old_branch is not None:
                    old_devs = (
                        await db.execute(
                            _select(Device)
                            .where(
                                Device.branch_id == old_branch,
                                Device.is_active.is_(True),
                            )
                            .execution_options(skip_tenant_filter=True)
                        )
                    ).scalars().all()
                    if old_devs:
                        await face_sync_service.enqueue_for_employee(
                            db, emp, FaceSyncAction.DELETE, devices=list(old_devs)
                        )
                if emp.branch_id is not None and emp.photo_url:
                    await face_sync_service.enqueue_for_employee(
                        db, emp, FaceSyncAction.ENROLL,
                    )
                await db.commit()
            elif old_photo != emp.photo_url and emp.photo_url:
                # Photo changed — push the new one to every device.
                await face_sync_service.enqueue_for_employee(
                    db, emp, FaceSyncAction.UPDATE,
                )
                await db.commit()
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).exception(
            "face_sync enqueue (update) failed for emp=%s", emp.id
        )
    return EmployeeRead.model_validate(emp)


@router.delete(
    "/{employee_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("employee.delete"))],
)
async def terminate_employee(
    employee_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    from datetime import datetime, timezone

    _resolved_company_id(user, tenant)
    emp = await _get_employee(db, employee_id, user)
    emp.is_active = False
    emp.terminated_at = datetime.now(timezone.utc)
    await db.commit()
    try:
        from app.models.face_sync import FaceSyncAction
        from app.services import face_sync_service

        await face_sync_service.enqueue_for_employee(
            db, emp, FaceSyncAction.DELETE,
        )
        await db.commit()
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).exception(
            "face_sync enqueue (terminate) failed for emp=%s", emp.id
        )
    return MessageResponse(message="terminated")
