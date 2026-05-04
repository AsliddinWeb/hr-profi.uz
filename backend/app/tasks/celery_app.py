"""Celery application factory + beat schedule."""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery(
    "worktimepro",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.salary_tasks",
        "app.tasks.kpi_tasks",
        "app.tasks.device_tasks",
        "app.tasks.report_tasks",
    ],
)

celery_app.conf.update(
    timezone=settings.tz,
    enable_utc=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=3600,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
)

celery_app.conf.beat_schedule = {
    # Daily roll-up at 23:59 — guarantees every active employee has a row
    # for today even if no attendance was recorded.
    "salary-daily-summary": {
        "task": "salary.daily_summary",
        "schedule": crontab(hour=23, minute=59),
    },
    # KPI compute runs at 00:30 — after daily summary, before mobile users
    # check their morning dashboard. Recomputes every active KPI assignment
    # for the current month so attendance/leave changes flow into scores.
    "kpi-compute-scores": {
        "task": "kpi.compute_scores",
        "schedule": crontab(hour=0, minute=30),
    },
    # Month-end at 23:30 (day 28-31): freeze ACTIVE assignments → COMPUTED so
    # the approval workflow has stable inputs. Cron uses day_of_month range
    # to fire on the last few days; the task itself uses date.today() and
    # only finalizes for the current month, so duplicate fires are safe.
    "kpi-month-end-finalize": {
        "task": "kpi.month_end_finalize",
        "schedule": crontab(hour=23, minute=30, day_of_month="28-31"),
    },
    # Salary month-end close — last day of month at 23:50, after KPI freeze
    # so KPI bonuses are baked into salary totals before approval.
    # Recomputes every employee's full month, then auto-approves every
    # DRAFT/FINALIZED period. Payment stays as an explicit admin click.
    "salary-month-end-close": {
        "task": "salary.month_end_close",
        "schedule": crontab(hour=23, minute=50, day_of_month="28-31"),
    },
    # Device offline sweeper: every minute. Cheap because it's a single
    # range query against ``last_seen_at``.
    "device-sweep-offline": {
        "task": "device.sweep_offline",
        "schedule": 60.0,
    },
    # Face-template sync queue drain: every 30 seconds. The task itself
    # caps at 50 rows per run to keep latency for a single broken device
    # bounded; backed-up queues catch up in the next tick.
    "device-face-sync": {
        "task": "device.process_face_sync",
        "schedule": 30.0,
    },
}


@celery_app.task(name="health.ping")
def ping() -> str:
    """Sanity-check task. Used by docker-compose healthcheck."""
    return "pong"


__all__ = ["celery_app"]
