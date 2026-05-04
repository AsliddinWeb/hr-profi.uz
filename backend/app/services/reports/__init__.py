"""Cross-module report generators.

Each generator is a coroutine that takes ``(db, company_id, params,
branch_filter)`` and yields rows. The runner in ``report_service.py``
collects rows, writes a CSV, uploads to MinIO, updates the ReportJob
row's ``file_url``/``status``.

A ``branch_filter`` of ``None`` means "company-wide" (CA/HR); when set
(BRANCH_MANAGER), every generator restricts queries by it. We do this
inside each generator instead of adding a global filter so an
unintended SELECT in a future generator can't leak across branches.
"""
from __future__ import annotations

from typing import AsyncIterator, Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

# A row is just a sequence of strings (rendered for CSV). Generators are
# expected to yield the header row first, then one row per record.
RowGenerator = Callable[
    [AsyncSession, UUID, dict, "UUID | None"],
    AsyncIterator[list[str]],
]
