"""JWT + password hashing unit tests."""
from __future__ import annotations

from uuid import uuid4

from app.core.security import (
    ACCESS_TOKEN_TYPE,
    REFRESH_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_round_trip() -> None:
    plain = "S3cret-Pa$$"
    hashed = hash_password(plain)
    assert hashed != plain
    assert verify_password(plain, hashed)
    assert not verify_password("wrong", hashed)


def test_access_token_round_trip() -> None:
    user_id = uuid4()
    company_id = uuid4()
    token = create_access_token(user_id, role="COMPANY_ADMIN", company_id=company_id)
    payload = decode_token(token)
    assert payload["sub"] == str(user_id)
    assert payload["type"] == ACCESS_TOKEN_TYPE
    assert payload["role"] == "COMPANY_ADMIN"
    assert payload["company_id"] == str(company_id)


def test_refresh_token_has_jti() -> None:
    token, jti, expires_at = create_refresh_token(uuid4())
    payload = decode_token(token)
    assert payload["type"] == REFRESH_TOKEN_TYPE
    assert payload["jti"] == jti
    assert expires_at is not None
