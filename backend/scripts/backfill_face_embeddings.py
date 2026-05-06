"""Backfill face embeddings for existing employees.

Phase 4 introduces a per-employee 128-d face embedding stored in
``employees.face_embedding``. The Celery hook on photo upload only
fires for *future* changes — to enrol everyone whose photo predates
the migration, run this script once.

Usage (inside the api container):
    docker compose exec api python -m scripts.backfill_face_embeddings

Idempotent: skips employees whose ``face_enrolled_at`` is already set
unless ``--force`` is given. Prints a one-line summary at the end.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.employee import Employee


async def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill face embeddings.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Recompute even if face_enrolled_at is already set.",
    )
    parser.add_argument(
        "--company-id",
        help="Limit to a single company (UUID).",
    )
    args = parser.parse_args()

    # The actual compute happens via the Celery task so it runs on the
    # worker (where face_recognition is loaded once per worker, not per
    # employee). We just enumerate the rows that need work and dispatch.
    from app.tasks.face_tasks import compute_employee_embedding

    async with AsyncSessionLocal() as db:
        stmt = select(Employee.id, Employee.face_enrolled_at).where(
            Employee.is_active.is_(True),
            Employee.photo_url.isnot(None),
        )
        if not args.force:
            stmt = stmt.where(Employee.face_enrolled_at.is_(None))
        if args.company_id:
            stmt = stmt.where(Employee.company_id == args.company_id)
        stmt = stmt.execution_options(skip_tenant_filter=True)
        rows = (await db.execute(stmt)).all()

    if not rows:
        print("[backfill] no employees need enrollment")
        return 0

    dispatched = 0
    for r in rows:
        try:
            compute_employee_embedding.delay(str(r.id))
            dispatched += 1
        except Exception as e:  # noqa: BLE001
            print(f"[backfill] dispatch failed emp={r.id}: {e}", file=sys.stderr)

    print(f"[backfill] dispatched {dispatched}/{len(rows)} employees to face.compute_employee_embedding")
    print("[backfill] watch the celery_worker logs for completion")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
