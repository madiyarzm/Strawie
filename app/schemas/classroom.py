"""
Pydantic schemas for Classroom entities.

Classrooms now belong to a group; enrollment is handled at the group level.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ClassroomBase(BaseModel):
    """Shared fields for classroom creation and updates."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class ClassroomCreate(ClassroomBase):
    """Payload for creating a new classroom within a group."""

    group_id: UUID


class ClassroomRead(ClassroomBase):
    """Classroom representation returned to clients."""

    id: UUID
    group_id: UUID
    teacher_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
