"""SQLAlchemy models — re-export for convenience and to ensure import side-effects."""
from app.models.attendance import (
    AttendanceMethod,
    AttendanceRecord,
    AttendanceStatus,
    CheckType,
)
from app.models.audit import AuditLog
from app.models.base import Base, TenantMixin, TimestampMixin
from app.models.bonus_deduction import (
    Bonus,
    BonusType,
    Deduction,
    DeductionType,
)
from app.models.branch import Branch
from app.models.company import Company, CompanyPlan
from app.models.department import Department
from app.models.device import (
    Device,
    DeviceLocationRole,
    DeviceLog,
    DeviceStatus,
    DeviceVendor,
)
from app.models.employee import Employee, SalaryType, WorkType
from app.models.face_sync import (
    FaceSyncAction,
    FaceSyncJob,
    FaceSyncStatus,
    MAX_ATTEMPTS as FACE_SYNC_MAX_ATTEMPTS,
)
from app.models.kpi import (
    KPIAssignment,
    KPIAssignmentStatus,
    KPICategory,
    KPIDataPoint,
    KPITemplate,
    MetricSource,
    RewardType,
)
from app.models.leave import LeaveAdjustment, LeaveRequest, LeaveStatus, LeaveType
from app.models.notification import Notification, NotificationCategory
from app.models.push_subscription import WebPushSubscription
from app.models.refresh_token import RefreshToken
from app.models.report import (
    ReportFormat,
    ReportJob,
    ReportStatus,
    ReportType,
)
from app.models.salary import (
    PeriodStatus,
    SalaryDailyAccrual,
    SalaryPeriod,
    SalaryTransaction,
    TransactionType,
)
from app.models.shift import (
    FlexibleConfig,
    ScheduleStatus,
    ShiftSchedule,
    ShiftTemplate,
    ShiftType,
)
from app.models.user import User, UserStatus

__all__ = [
    "AttendanceMethod",
    "AttendanceRecord",
    "AttendanceStatus",
    "AuditLog",
    "Base",
    "Bonus",
    "BonusType",
    "Branch",
    "CheckType",
    "Company",
    "CompanyPlan",
    "Deduction",
    "DeductionType",
    "Department",
    "Device",
    "DeviceLocationRole",
    "DeviceLog",
    "DeviceStatus",
    "DeviceVendor",
    "Employee",
    "FACE_SYNC_MAX_ATTEMPTS",
    "FaceSyncAction",
    "FaceSyncJob",
    "FaceSyncStatus",
    "FlexibleConfig",
    "KPIAssignment",
    "KPIAssignmentStatus",
    "KPICategory",
    "KPIDataPoint",
    "KPITemplate",
    "LeaveAdjustment",
    "LeaveRequest",
    "LeaveStatus",
    "LeaveType",
    "MetricSource",
    "Notification",
    "NotificationCategory",
    "PeriodStatus",
    "RefreshToken",
    "ReportFormat",
    "ReportJob",
    "ReportStatus",
    "ReportType",
    "RewardType",
    "SalaryDailyAccrual",
    "SalaryPeriod",
    "SalaryTransaction",
    "SalaryType",
    "ScheduleStatus",
    "ShiftSchedule",
    "ShiftTemplate",
    "ShiftType",
    "TenantMixin",
    "TimestampMixin",
    "TransactionType",
    "User",
    "UserStatus",
    "WebPushSubscription",
    "WorkType",
]
