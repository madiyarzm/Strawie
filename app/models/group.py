"""
Group model: container for classrooms and memberships.

A Group represents a course or cohort (e.g. "Python Basics — Spring 2026").
Students join a group once and automatically gain access to all classrooms
within it.
"""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Group(Base):
    """Group (course/cohort) created by a teacher; has many classrooms and members."""

    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    invite_code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, index=True)
    # Weekly class times: {"days": [1, 3], "time": "17:00", "tz": "Asia/Almaty"}.
    # days: 0 = Monday ... 6 = Sunday. Null = no fixed schedule.
    schedule: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    teacher = relationship("User", back_populates="groups_owned", foreign_keys=[teacher_id])
    memberships = relationship("GroupMembership", back_populates="group", cascade="all, delete-orphan")
    classrooms = relationship("Classroom", back_populates="group", cascade="all, delete-orphan")
