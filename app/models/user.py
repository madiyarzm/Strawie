"""
User model: identity from Google OAuth.

Role determines whether user can create groups/classrooms (teacher) or only
join groups and submit (student).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class User(Base):
    """User account; created or updated on first Google OAuth login."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    picture_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="student")
    # role_locked is False on a freshly-created account until the user picks
    # their role on first login. Once True, the role is immutable (admin
    # endpoint can still override as a break-glass tool).
    role_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    google_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cosmetics: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_banned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    ban_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    classrooms_taught = relationship("Classroom", back_populates="teacher", foreign_keys="Classroom.teacher_id")
    groups_owned = relationship("Group", back_populates="teacher", foreign_keys="Group.teacher_id")
    group_memberships = relationship("GroupMembership", back_populates="user")
    submissions = relationship("Submission", back_populates="user")
