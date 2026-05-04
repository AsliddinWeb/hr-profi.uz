"""MinIO-backed object storage for tenant-scoped uploads.

Layout follows the rule from CLAUDE.md: every object is stored under
``{company_id}/{module}/{filename}`` so that a leak of a presigned URL or a
bucket misconfiguration never crosses tenants.
"""
from __future__ import annotations

import io
import json
import mimetypes
import uuid
from functools import lru_cache
from typing import BinaryIO
from urllib.parse import quote

from minio import Minio
from minio.error import S3Error

from app.config import settings

ALLOWED_IMAGE_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


@lru_cache
def _client() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_root_user,
        secret_key=settings.minio_root_password,
        secure=settings.minio_secure,
    )


def _public_read_policy(bucket: str) -> str:
    """Anonymous read access. Object names embed ``{company_id}/...`` so a leak
    of one URL does not expose the bucket listing or other tenants' files. We
    don't enable ListBucket for the same reason. Phase 4 will switch sensitive
    artifacts (selfies) to presigned URLs."""
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{bucket}/*"],
                }
            ],
        }
    )


def _ensure_bucket() -> None:
    cli = _client()
    if not cli.bucket_exists(settings.minio_bucket):
        cli.make_bucket(settings.minio_bucket)
    # Idempotent: setting the same policy twice is a no-op.
    try:
        cli.set_bucket_policy(settings.minio_bucket, _public_read_policy(settings.minio_bucket))
    except S3Error:  # pragma: no cover — perms vary across MinIO setups
        pass


def _public_url(object_name: str) -> str:
    base = settings.minio_public_endpoint.rstrip("/")
    return f"{base}/{settings.minio_bucket}/{quote(object_name)}"


def upload_image(
    *,
    company_id: uuid.UUID,
    module: str,
    file: BinaryIO,
    content_type: str,
    size: int,
) -> str:
    """Validate + upload an image. Returns the public URL.

    Raises ``ValueError`` for validation problems so the caller can translate to
    a 400; ``RuntimeError`` for storage failures (becomes 500).
    """
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError("storage.unsupported_type")
    if size <= 0 or size > MAX_IMAGE_BYTES:
        raise ValueError("storage.size_out_of_range")

    ext = ALLOWED_IMAGE_TYPES[content_type]
    object_name = f"{company_id}/{module}/{uuid.uuid4().hex}{ext}"

    _ensure_bucket()
    try:
        # `file` is the SpooledTemporaryFile from FastAPI's UploadFile; minio
        # needs a stream + length, which we already have.
        _client().put_object(
            settings.minio_bucket,
            object_name,
            data=file,
            length=size,
            content_type=content_type,
        )
    except S3Error as e:  # pragma: no cover — surfaces real storage outages
        raise RuntimeError(f"storage.upload_failed: {e}") from e

    return _public_url(object_name)


def upload_image_bytes(
    *,
    company_id: uuid.UUID,
    module: str,
    data: bytes,
    content_type: str,
) -> str:
    """Convenience wrapper for in-memory bytes (used by tests and seeds)."""
    return upload_image(
        company_id=company_id,
        module=module,
        file=io.BytesIO(data),
        content_type=content_type,
        size=len(data),
    )


def guess_content_type(filename: str) -> str | None:
    return mimetypes.guess_type(filename)[0]


__all__ = [
    "ALLOWED_IMAGE_TYPES",
    "MAX_IMAGE_BYTES",
    "guess_content_type",
    "upload_image",
    "upload_image_bytes",
]
