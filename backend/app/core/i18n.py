"""Tiny i18n helper backed by JSON files in app/locales/."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Request

from app.config import settings

SUPPORTED = ("uz", "ru", "en")
LOCALES_DIR = Path(__file__).parent.parent / "locales"


@lru_cache(maxsize=8)
def _load(lang: str) -> dict[str, Any]:
    path = LOCALES_DIR / f"{lang}.json"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _resolve(d: dict[str, Any], key: str) -> str | None:
    cur: Any = d
    for part in key.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur if isinstance(cur, str) else None


def translate(key: str, lang: str | None = None, **params: Any) -> str:
    lang = lang if lang in SUPPORTED else settings.default_language
    msg = _resolve(_load(lang), key)
    if msg is None and lang != settings.default_language:
        msg = _resolve(_load(settings.default_language), key)
    if msg is None:
        return key
    try:
        return msg.format(**params) if params else msg
    except (KeyError, IndexError):
        return msg


def detect_lang(request: Request) -> str:
    """Pick a language from Accept-Language. Falls back to default."""
    header = request.headers.get("accept-language", "")
    for token in header.split(","):
        code = token.split(";")[0].strip().lower()[:2]
        if code in SUPPORTED:
            return code
    return settings.default_language


__all__ = ["SUPPORTED", "detect_lang", "translate"]
