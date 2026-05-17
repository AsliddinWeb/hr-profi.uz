"""Telegram Bot API helpers.

The product side exposes one bot per company. The admin pastes a token,
we call ``getMe`` to confirm it and stash the bot's username/first_name.
Outbound delivery is fire-and-forget via ``send_message``; the caller
(Celery task) decides what to do with failures.

We deliberately keep this module dependency-light — just ``httpx`` — so
it can be invoked from the request path (token validation) and from
worker tasks (notification fan-out) without dragging in DB or auth deps.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


TELEGRAM_API_BASE = "https://api.telegram.org"
DEFAULT_TIMEOUT_S = 10.0


class TelegramAPIError(RuntimeError):
    """Raised when Telegram's Bot API returns ``ok=false`` or an HTTP
    error. The admin UI surfaces ``.message`` verbatim so be readable."""


def _api_url(token: str, method: str) -> str:
    return f"{TELEGRAM_API_BASE}/bot{token}/{method}"


async def get_me(token: str) -> dict[str, Any]:
    """Call ``getMe`` to validate the token. Returns the ``result`` dict
    (``id``, ``username``, ``first_name``, ...). Raises ``TelegramAPIError``
    on any non-OK response so the caller can surface it to the admin."""
    if not token or not token.strip():
        raise TelegramAPIError("bot token is empty")

    url = _api_url(token.strip(), "getMe")
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        raise TelegramAPIError(f"network error: {exc}") from exc

    return _parse_response(resp, method="getMe")


async def send_message(
    token: str,
    chat_id: str,
    text: str,
    *,
    parse_mode: str | None = "HTML",
    disable_web_page_preview: bool = True,
) -> dict[str, Any]:
    """Send a single message. Returns the ``result`` dict on success;
    raises ``TelegramAPIError`` otherwise.

    Default parse mode is HTML — simpler to escape than MarkdownV2 and we
    only use ``<b>`` / ``<i>`` / ``<code>`` in our templates. Callers can
    pass ``parse_mode=None`` to send plain text verbatim.
    """
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": disable_web_page_preview,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode

    url = _api_url(token, "sendMessage")
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
            resp = await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise TelegramAPIError(f"network error: {exc}") from exc

    return _parse_response(resp, method="sendMessage")


def _parse_response(resp: httpx.Response, *, method: str) -> dict[str, Any]:
    """Translate a Telegram API response into either ``result`` or an
    error. ``ok=false`` rides with ``description`` + ``error_code`` —
    we lift ``description`` into the exception message because that's
    the human-friendly bit."""
    try:
        body = resp.json()
    except ValueError as exc:
        raise TelegramAPIError(
            f"{method}: non-JSON response (status={resp.status_code})"
        ) from exc

    if not body.get("ok"):
        desc = body.get("description") or "unknown error"
        code = body.get("error_code")
        raise TelegramAPIError(f"{method}: {desc} (code={code})")

    result = body.get("result")
    if not isinstance(result, dict):
        # ``sendMessage`` always returns a dict; ``getMe`` does too.
        # If we got something else (e.g. ``true`` for ``setWebhook``),
        # wrap it so callers don't crash.
        return {"raw": result}
    return result


def mask_token(token: str | None) -> str | None:
    """Return a token shape safe to expose to the admin UI.

    Telegram tokens look like ``123456789:AAH...xyz``. We keep the bot
    id prefix (handy for at-a-glance recognition) and the last 4 chars,
    masking the secret middle.
    """
    if not token:
        return None
    if ":" in token:
        prefix, secret = token.split(":", 1)
    else:
        prefix, secret = "", token
    tail = secret[-4:] if len(secret) > 4 else ""
    return f"{prefix}:••••{tail}" if prefix else f"••••{tail}"


__all__ = [
    "TelegramAPIError",
    "get_me",
    "mask_token",
    "send_message",
]
