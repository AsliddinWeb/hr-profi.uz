"""Generic response schemas."""
from __future__ import annotations

from typing import Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class IdResponse(BaseModel):
    id: UUID


class MessageResponse(BaseModel):
    message: str


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int = Field(ge=1)
    size: int = Field(ge=1, le=200)

    @property
    def pages(self) -> int:
        return (self.total + self.size - 1) // self.size if self.total else 0


__all__ = ["IdResponse", "MessageResponse", "ORMBase", "Page"]
