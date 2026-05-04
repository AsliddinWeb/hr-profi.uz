"""Shift templates, daily schedule, and flexible-config.

A ``ShiftTemplate`` is a reusable named pattern (e.g. "9-18 standard"). A
``ShiftSchedule`` row pins one employee to one template (or custom hours) on
a given date. ``FlexibleConfig`` only applies to FLEXIBLE/HYBRID employees and
defines the constraints (min/max daily hours, weekly target, core hours).
"""
from __future__ import annotations

import uuid
from datetime import date, time
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    pass


class ShiftType(StrEnum):
    FIXED = "FIXED"
    FLEXIBLE = "FLEXIBLE"
    SPLIT = "SPLIT"


class ScheduleStatus(StrEnum):
    PLANNED = "PLANNED"
    SWAPPED = "SWAPPED"
    CANCELLED = "CANCELLED"
    ON_LEAVE = "ON_LEAVE"
    # REST_DAY = a planned day-off for this specific employee. Work performed
    # on a REST_DAY counts entirely as overtime in salary computation, and
    # not showing up does NOT trigger an absence/late penalty.
    REST_DAY = "REST_DAY"


class ShiftTemplate(Base, TenantMixin, TimestampMixin):
    __tablename__ = "shift_templates"
    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_shift_templates_company_name"),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[ShiftType] = mapped_column(
        String(16), default=ShiftType.FIXED.value, nullable=False
    )
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    break_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    expected_hours: Mapped[float | None] = mapped_column(Numeric(4, 2))
    allow_overtime: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ShiftSchedule(Base, TenantMixin, TimestampMixin):
    __tablename__ = "shift_schedules"
    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_shift_schedules_employee_date"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    shift_template_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("shift_templates.id", ondelete="SET NULL"),
        index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    custom_start: Mapped[time | None] = mapped_column(Time)
    custom_end: Mapped[time | None] = mapped_column(Time)
    status: Mapped[ScheduleStatus] = mapped_column(
        String(16), default=ScheduleStatus.PLANNED.value, nullable=False
    )


class FlexibleConfig(Base, TenantMixin, TimestampMixin):
    """One-to-one with Employee for FLEXIBLE/HYBRID employees."""

    __tablename__ = "flexible_configs"
    __table_args__ = (
        UniqueConstraint("employee_id", name="uq_flexible_configs_employee"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    min_daily_hours: Mapped[float] = mapped_column(Numeric(4, 2), default=4, nullable=False)
    max_daily_hours: Mapped[float] = mapped_column(Numeric(4, 2), default=12, nullable=False)
    required_weekly_hours: Mapped[float] = mapped_column(Numeric(4, 2), default=40, nullable=False)
    core_hours_start: Mapped[time | None] = mapped_column(Time)
    core_hours_end: Mapped[time | None] = mapped_column(Time)
