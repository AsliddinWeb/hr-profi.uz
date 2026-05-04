"""Web Push subscription schemas."""
from __future__ import annotations

from pydantic import BaseModel, Field


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscriptionIn(BaseModel):
    """Raw browser PushSubscription JSON.

    Mirrors the shape produced by ``subscription.toJSON()`` in the SW client
    code so the frontend can post it through verbatim.
    """

    endpoint: str = Field(min_length=1, max_length=2048)
    keys: PushSubscriptionKeys
    user_agent: str | None = Field(default=None, max_length=500)


class PushPublicKey(BaseModel):
    public_key: str


__all__ = ["PushPublicKey", "PushSubscriptionIn", "PushSubscriptionKeys"]
