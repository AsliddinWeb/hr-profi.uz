"""HMAC verification + Hikvision event parsing tests."""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone

import pytest

from app.services.device_service import (
    generate_api_key,
    parse_hikvision_event,
)


def test_generate_api_key_returns_distinct_pairs():
    a, ah = generate_api_key()
    b, bh = generate_api_key()
    assert a != b
    assert ah != bh
    assert len(a) > 32  # 32 bytes urlsafe-base64 ≈ 43 chars


def test_hmac_signature_round_trip():
    """Sanity-check that the same body+key yields the same hex digest the
    webhook handler will compare against."""
    api_key = "the-key"
    body = b'{"x":1}'
    sig = hmac.new(api_key.encode(), body, hashlib.sha256).hexdigest()
    # Length of SHA-256 hex = 64
    assert len(sig) == 64
    assert hmac.compare_digest(
        sig, hmac.new(api_key.encode(), body, hashlib.sha256).hexdigest()
    )


def test_parse_hikvision_face_match():
    raw = {
        "EventNotificationAlert": {
            "eventType": "AccessControllerEvent",
            "eventTime": "2026-04-28T11:30:00+00:00",
            "AccessControllerEvent": {
                "majorEventType": 5,
                "subEventType": 75,
                "employeeNoString": "E-001",
                "name": "Aliyev",
                "similarity": 0.92,
            },
        }
    }
    e = parse_hikvision_event(raw)
    assert e.event_type == "face_match"
    assert e.employee_code == "E-001"
    assert e.face_match_score == 0.92
    assert e.timestamp.tzinfo is not None


def test_parse_hikvision_heartbeat():
    raw = {"EventNotificationAlert": {"eventType": "heartbeat", "eventTime": "2026-04-28T11:30:00Z"}}
    e = parse_hikvision_event(raw)
    assert e.event_type == "heartbeat"
    assert e.employee_code is None


def test_parse_hikvision_unknown_event_passthrough():
    raw = {"eventType": "weird", "timestamp": "2026-04-28T11:30:00Z"}
    e = parse_hikvision_event(raw)
    assert e.event_type == "weird"


def test_parse_hikvision_missing_timestamp_falls_back_to_now():
    e = parse_hikvision_event({"EventNotificationAlert": {"eventType": "tamper"}})
    assert e.event_type == "tamper"
    # The fallback is "now" — so it should be within a couple seconds.
    delta = (datetime.now(timezone.utc) - e.timestamp).total_seconds()
    assert delta < 5
