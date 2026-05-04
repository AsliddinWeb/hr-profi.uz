# Repo guidance for AI agents

Hr-Profi is a multi-tenant SaaS HR/attendance system. This file is the canonical
context for any AI agent working in this repo.

## Hard rules

1. **Multi-tenant safety is non-negotiable.** Every model that holds tenant data inherits
   `TenantMixin` (has `company_id`). Queries go through `TenantSession`, which uses an
   SQLAlchemy event listener to inject `WHERE company_id = :current_company_id` on every
   `SELECT`/`UPDATE`/`DELETE`. The only role exempt from this filter is `OWNER` — and only
   when an explicit `?company_id=X` is passed.
   - Never bypass the listener with raw SQL unless you also assert tenant scope manually.
   - Cross-tenant data leak is the #1 risk. Add a tenant-isolation test for every new
     endpoint that returns tenant data.

2. **Auth is username/email + password only.** No SMS OTP. JWT access (15 min) + refresh
   (30 days, rotating, device-bound, max 2 devices per employee).

3. **No payment integration.** `Company.subscription_until` is set manually by Owner.

4. **3 languages** — `uz` (default), `ru`, `en`. Backend uses `Accept-Language`; user-facing
   strings live in `backend/app/locales/{uz,ru,en}.json`. Frontends use i18next/i18n-js.

5. **Files** — stored in MinIO under `/{company_id}/{module}/{filename}`. Never store paths
   without `company_id` prefix.

## Layout

```
backend/        FastAPI + Celery + Alembic   (poetry, Python 3.12)
admin-web/      Owner + Company admin        (React 18 + Vite + TS)
mobile/         Employee app                 (Expo SDK 51, expo-router, TS)
client-web/     PWA fallback                 (Next.js 14)
infra/          Traefik, nginx, postgres init
```

## Backend conventions

- **Models** in `app/models/` — one file per aggregate. Inherit `Base, TenantMixin` for
  tenant-scoped tables; just `Base` for global tables (`User` only when role=OWNER, etc.).
- **Schemas** in `app/schemas/` — Pydantic v2, separate `Create`/`Update`/`Read`/`InDB`.
- **Routers** in `app/api/v1/` — one file per resource. Inject deps from `app/core/deps.py`.
- **Services** in `app/services/` — business logic; routers stay thin.
- **Celery tasks** in `app/tasks/` — registered via `celery_app.autodiscover_tasks(...)`.
- **Permissions** — declared in `app/core/permissions.py` as `ROLE_PERMISSIONS` dict.
  Use `require_permission("employee.create")` dependency, not raw role checks.

## Don't

- Don't create migrations by hand. Use `make makemigration msg="..."`.
- Don't commit `.env`. Only `.env.example` is tracked.
- Don't add new top-level folders without updating this file and the structure section
  in `README.md`.
- Don't introduce a payment provider. Subscription is manual.
- Don't import old data — migration scripts from a previous system are out of scope.

## Roles

`OWNER` (system-wide), `COMPANY_ADMIN`, `HR_MANAGER`, `BRANCH_MANAGER`, `EMPLOYEE`,
`DEVICE` (service account for Face ID hardware).

## Phases

Currently **Phase 1**: multi-tenant arch, auth, Owner panel, Company/Branch CRUD, DevOps.
Employee/shift/attendance/salary/KPI models will be added in Phase 2–3 — don't pre-build
endpoints for them unless explicitly asked.
