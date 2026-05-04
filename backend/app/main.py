"""FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from sentry_sdk.integrations.fastapi import FastApiIntegration
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api.v1.router import api_router
from app.api.ws import admin as ws_admin
from app.api.ws import employee as ws_employee
from app.api.ws.connection import ws_manager
from app.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.tenant import install_tenant_listener

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    install_tenant_listener()
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            traces_sample_rate=settings.sentry_traces_sample_rate,
            environment=settings.environment,
            integrations=[FastApiIntegration()],
        )
    await ws_manager.start_subscriber()
    logger.info("Application startup complete (env=%s)", settings.environment)
    yield
    await ws_manager.stop_subscriber()
    logger.info("Application shutdown")


limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.project_name,
        version="0.1.0",
        debug=settings.debug,
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    @app.get("/health", tags=["meta"])
    async def health() -> dict:
        return {"status": "ok", "service": settings.project_name, "env": settings.environment}

    @app.get(f"{settings.api_v1_prefix}/server-time", tags=["meta"])
    async def server_time() -> dict:
        """Return the server's wall clock + configured timezone.

        Lives at ``/api/v1/server-time`` (not under ``/health``) so it
        passes through both the admin nginx and the Next.js PWA rewrite
        without extra config — both proxies route ``/api/*`` to the
        backend. We send the UTC ISO8601 (drives the JS Date) plus the
        configured tz + offset so the dashboard clock can render in
        Tashkent regardless of the browser's local zone.
        """
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo

        try:
            tz = ZoneInfo(settings.tz)
        except Exception:  # noqa: BLE001
            tz = timezone.utc
        now = datetime.now(tz)
        return {
            "iso": datetime.now(timezone.utc).isoformat(),
            "tz": settings.tz,
            "local": now.strftime("%Y-%m-%d %H:%M:%S"),
            "offset_minutes": int(now.utcoffset().total_seconds() // 60) if now.utcoffset() else 0,
        }

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    app.include_router(ws_employee.router)
    app.include_router(ws_admin.router)

    return app


app = create_app()
