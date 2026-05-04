"""Custom exception types + a single FastAPI exception handler that returns
i18n-aware JSON error responses."""
from __future__ import annotations

from typing import Any

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.i18n import translate


class AppError(Exception):
    """Base for all app-level errors. Carries an i18n key and HTTP status."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "app.error"

    def __init__(self, code: str | None = None, *, status_code: int | None = None, **params: Any):
        super().__init__(code or self.code)
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.params = params


class AuthenticationError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "auth.invalid_credentials"


class TokenError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "auth.invalid_token"


class PermissionDeniedError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "auth.permission_denied"


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "common.not_found"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "common.conflict"


class ValidationAppError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "common.validation_failed"


class TenantMismatchError(AppError):
    """Raised when an action would touch data outside the caller's tenant."""

    status_code = status.HTTP_403_FORBIDDEN
    code = "tenant.cross_tenant_forbidden"


def _lang(request: Request) -> str:
    """Resolve the response language for an error response.

    Endpoints that inject ``LangDep`` get ``request.state.lang`` populated by
    the dependency; everything else falls back to parsing ``Accept-Language``
    on the spot so error messages are still localised.
    """
    cached = getattr(request.state, "lang", None)
    if cached:
        return cached
    from app.core.i18n import detect_lang

    return detect_lang(request)


def register_exception_handlers(app: Any) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": translate(exc.code, _lang(request), **exc.params),
                "params": exc.params,
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "common.http_error"
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": code,
                "message": exc.detail or translate(code, _lang(request)),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "code": "common.validation_failed",
                "message": translate("common.validation_failed", _lang(request)),
                "errors": exc.errors(),
            },
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
        # Don't leak SQL detail in production.
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "code": "common.conflict",
                "message": translate("common.conflict", _lang(request)),
            },
        )


__all__ = [
    "AppError",
    "AuthenticationError",
    "ConflictError",
    "NotFoundError",
    "PermissionDeniedError",
    "TenantMismatchError",
    "TokenError",
    "ValidationAppError",
    "register_exception_handlers",
]
