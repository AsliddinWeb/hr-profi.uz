"""Application settings — loaded from env via pydantic-settings."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # General
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = True
    project_name: str = "HrProfi"
    domain: str = "hr-profi.uz"
    tz: str = "Asia/Tashkent"

    # API
    api_v1_prefix: str = "/api/v1"
    secret_key: str = Field(min_length=32)
    jwt_access_ttl_minutes: int = 15
    jwt_refresh_ttl_days: int = 30
    algorithm: str = "HS256"
    bcrypt_rounds: int = 12

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # i18n
    default_language: Literal["uz", "ru", "en"] = "uz"

    # Postgres
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "worktimepro"
    postgres_user: str = "worktimepro"
    postgres_password: str
    database_url: str | None = None

    # Redis
    redis_host: str = "redis"
    redis_port: int = 6379
    redis_db: int = 0
    redis_url: str | None = None

    # Celery
    celery_broker_url: str = "redis://redis:6379/1"
    celery_result_backend: str = "redis://redis:6379/2"

    # MinIO
    minio_root_user: str = "minioadmin"
    minio_root_password: str = "minioadmin"
    minio_endpoint: str = "minio:9000"
    minio_public_endpoint: str = "http://localhost:9000"
    minio_bucket: str = "worktimepro"
    minio_secure: bool = False

    # Initial owner
    initial_owner_username: str = "owner"
    initial_owner_email: str = "owner@hr-profi.uz"
    initial_owner_password: str = "ChangeMeOwner123!"

    # Sentry
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1

    # SMTP
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "noreply@hr-profi.uz"
    smtp_tls: bool = True

    # FCM
    fcm_server_key: str | None = None

    # Face template sync. ``dry_run`` short-circuits all device HTTP calls
    # — useful in dev/CI where no real hardware is reachable. ``http_timeout``
    # caps each adapter call so a wedged device can't stall the whole queue.
    face_sync_dry_run: bool = True
    face_sync_http_timeout_seconds: float = 15.0

    # Web Push (VAPID). Generate once per environment with
    # ``python -m app.utils.vapid_keys`` (or ``web-push generate-vapid-keys``)
    # and paste the values here. Public key is URL-safe base64 (no padding) of
    # the raw 65-byte EC point; the private key is the URL-safe base64 of the
    # 32-byte scalar.
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str = "mailto:noreply@hr-profi.uz"

    @computed_field  # type: ignore[misc]
    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @computed_field  # type: ignore[misc]
    @property
    def database_url_async(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @computed_field  # type: ignore[misc]
    @property
    def database_url_sync(self) -> str:
        """Used by alembic offline mode."""
        return (
            f"postgresql+psycopg2://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @computed_field  # type: ignore[misc]
    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
