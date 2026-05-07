"""Attendance records — produced by mobile, face-id device, QR, or manual entry."""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    pass


class CheckType(StrEnum):
    CHECK_IN = "CHECK_IN"
    CHECK_OUT = "CHECK_OUT"


class AttendanceMethod(StrEnum):
    MOBILE_APP = "MOBILE_APP"
    FACE_DEVICE = "FACE_DEVICE"
    # Tablet kiosk PWA — distinct from FACE_DEVICE (Hikvision/ZKTeco
    # hardware) so reports can split "kiosk-driven" attendance out
    # from dedicated terminals.
    KIOSK_TABLET = "KIOSK_TABLET"
    QR_CODE = "QR_CODE"
    MANUAL = "MANUAL"


class AttendanceStatus(StrEnum):
    VALID = "VALID"
    SUSPICIOUS = "SUSPICIOUS"
    REJECTED = "REJECTED"


class AttendanceRecord(Base, TenantMixin, TimestampMixin):
    __tablename__ = "attendance_records"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("branches.id", ondelete="SET NULL"),
        index=True,
    )

    check_type: Mapped[CheckType] = mapped_column(String(16), nullable=False)
    method: Mapped[AttendanceMethod] = mapped_column(String(16), nullable=False)

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    # GPS sample at the moment of check-in/out (mobile/QR only).
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float)

    selfie_url: Mapped[str | None] = mapped_column(String(500))
    face_match_score: Mapped[float | None] = mapped_column(Numeric(4, 3))

    device_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)

    is_late: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    late_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_early_leave: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    overtime_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    status: Mapped[AttendanceStatus] = mapped_column(
        String(16), default=AttendanceStatus.VALID.value, nullable=False, index=True
    )

    ip_address: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(String(500))

    def __repr__(self) -> str:
        return f"<Attendance {self.check_type} emp={self.employee_id} ts={self.timestamp}>"
