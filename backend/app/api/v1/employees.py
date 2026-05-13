"""Employee CRUD + bulk import + employee-self routes."""
from __future__ import annotations

import csv
import io
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from pydantic import BaseModel, Field
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


def _enqueue_face_embedding_compute(employee_id: UUID) -> None:
    """Fire-and-forget Celery dispatch for the face-recognition embedding
    compute. Lazy-imported so a broker outage / missing task module never
    breaks the user-facing employee-CRUD response."""
    try:
        from app.tasks.face_tasks import compute_employee_embedding

        compute_employee_embedding.delay(str(employee_id))
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).debug(
            "face embedding dispatch skipped for emp=%s", employee_id
        )


# --- /next-code — placed BEFORE /{id} so it doesn't get caught by the path
#     parameter route.

class NextEmployeeCode(BaseModel):
    code: str


def _employee_code_prefix(company) -> str:
    """Pick the prefix for ``employee_code`` generation. Falls back to
    the first segment of the slug if the column isn't set yet (e.g. a
    company created before the prefix migration). Kept as a free
    function so create_employee can call it without duplicating logic."""
    explicit = (getattr(company, "employee_code_prefix", None) or "").strip()
    if explicit:
        return explicit
    slug = (company.slug or "").strip()
    if not slug:
        return "emp"
    first = slug.split("-", 1)[0] or slug
    return first[:16] or "emp"


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
    """Suggest the next ``{prefix}-{seq:04d}`` for the current company.

    Reads ``companies.next_employee_seq`` and the per-company prefix
    so codes are visually unique across tenants (every fresh tenant
    used to start at E-001, which collided in operators' minds). The
    counter is monotonic — terminated rows do NOT free up codes, so
    audit trails over the lifetime of a tenant stay readable.
    """
    from app.models.company import Company

    company_id = _resolved_company_id(user, tenant)
    company = (
        await db.execute(
            select(Company)
            .where(Company.id == company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()
    prefix = _employee_code_prefix(company)
    return NextEmployeeCode(code=f"{prefix}-{int(company.next_employee_seq):04d}")


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

    # Server-side face recognition (Phase 4 / kiosk path): compute and
    # store the 128-d embedding for kiosk matching. Independent of the
    # device face_sync queue above — that targets Hikvision/ZKTeco
    # hardware; this populates ``Employee.face_embedding`` for the
    # ``/kiosks/me/recognize`` brute-force matcher.
    if employee.photo_url:
        _enqueue_face_embedding_compute(employee.id)
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
    old_full_name = emp.full_name

    diff = data.model_dump(exclude_unset=True)
    for field, value in diff.items():
        setattr(emp, field, value)

    # Mirror the renames onto the linked User row so the PWA's
    # /auth/me (which reads User.full_name, not Employee.full_name)
    # doesn't keep showing the stale name. Same for the active flag —
    # a terminated employee's user account should also flip inactive
    # so they can no longer log in.
    if emp.user_id is not None:
        from app.models.user import User as UserModel

        target_user = (
            await db.execute(
                select(UserModel)
                .where(UserModel.id == emp.user_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if target_user is not None:
            if "full_name" in diff and emp.full_name != old_full_name:
                target_user.full_name = emp.full_name
            if "is_active" in diff:
                target_user.is_active = bool(emp.is_active)

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

    # Server-side face recognition: refresh the kiosk-matching embedding
    # whenever the photo changes. The Celery task itself handles the
    # photo-cleared case (it nulls out face_embedding so a stale match
    # can't survive).
    if old_photo != emp.photo_url:
        _enqueue_face_embedding_compute(emp.id)
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


# ---------- Login (User) management ------------------------------------------


class EmployeeLoginRead(BaseModel):
    """Snapshot of the employee's auth-side User row, or absence thereof."""

    has_login: bool
    user_id: UUID | None = None
    username: str | None = None
    is_active: bool | None = None


class EmployeeLoginPatch(BaseModel):
    """Create-or-update an employee's auth login from the employee edit
    page. If the employee has no User row yet, ``username`` + ``password``
    are required and we provision a new one with role EMPLOYEE. If a row
    already exists, only the provided fields are applied — leaving
    ``password`` empty keeps the current credential."""

    username: str | None = Field(default=None, min_length=2, max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_active: bool | None = None


@router.get(
    "/{employee_id}/login",
    response_model=EmployeeLoginRead,
    dependencies=[Depends(require_permission("employee.read"))],
)
async def get_employee_login(
    employee_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> EmployeeLoginRead:
    _resolved_company_id(user, tenant)
    emp = await _get_employee(db, employee_id, user)
    if emp.user_id is None:
        return EmployeeLoginRead(has_login=False)
    from app.models.user import User as UserModel

    login = (
        await db.execute(
            select(UserModel)
            .where(UserModel.id == emp.user_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if login is None:
        return EmployeeLoginRead(has_login=False)
    return EmployeeLoginRead(
        has_login=True,
        user_id=login.id,
        username=login.username,
        is_active=login.is_active,
    )


@router.patch(
    "/{employee_id}/login",
    response_model=EmployeeLoginRead,
    dependencies=[Depends(require_permission("employee.update"))],
)
async def update_employee_login(
    employee_id: UUID,
    data: EmployeeLoginPatch,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> EmployeeLoginRead:
    """Create or update the linked User row.

    - First call (employee has no ``user_id``): requires both
      ``username`` + ``password``, provisions a new EMPLOYEE-role User
      and links it via ``employee.user_id``.
    - Subsequent calls: each provided field is applied. ``password``
      gets re-hashed; an empty / absent password leaves the credential
      alone so the admin can rename or deactivate without rotating.
    """
    from app.core.permissions import Role
    from app.core.security import hash_password
    from app.models.user import User as UserModel
    from app.models.user import UserStatus

    company_id = _resolved_company_id(user, tenant)
    emp = await _get_employee(db, employee_id, user)

    # --- Create branch ---
    if emp.user_id is None:
        if not data.username or not data.password:
            raise ValidationAppError("employee.login_credentials_required")
        # Uniqueness inside the tenant.
        clash = (
            await db.execute(
                select(UserModel.id)
                .where(
                    UserModel.company_id == company_id,
                    UserModel.username == data.username,
                )
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise ConflictError("user.duplicate")
        login_user = UserModel(
            company_id=company_id,
            username=data.username,
            email=emp.email,
            password_hash=hash_password(data.password),
            role=Role.EMPLOYEE,
            status=UserStatus.ACTIVE,
            full_name=emp.full_name,
            phone=emp.phone,
            is_active=data.is_active if data.is_active is not None else True,
            language="uz",
        )
        db.add(login_user)
        await db.flush()
        emp.user_id = login_user.id
        await db.commit()
        return EmployeeLoginRead(
            has_login=True,
            user_id=login_user.id,
            username=login_user.username,
            is_active=login_user.is_active,
        )

    # --- Update branch ---
    login = (
        await db.execute(
            select(UserModel)
            .where(UserModel.id == emp.user_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if login is None:
        raise NotFoundError("user.not_found")

    if data.username and data.username != login.username:
        clash = (
            await db.execute(
                select(UserModel.id)
                .where(
                    UserModel.company_id == company_id,
                    UserModel.username == data.username,
                    UserModel.id != login.id,
                )
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise ConflictError("user.duplicate")
        login.username = data.username

    if data.password:
        login.password_hash = hash_password(data.password)
    if data.is_active is not None:
        login.is_active = data.is_active

    await db.commit()
    await db.refresh(login)
    return EmployeeLoginRead(
        has_login=True,
        user_id=login.id,
        username=login.username,
        is_active=login.is_active,
    )
