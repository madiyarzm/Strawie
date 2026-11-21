"""
Lesson: one scheduled class of a group, with its pages and optional homework.

A group has a weekly schedule (days + time). Each class meeting is a Lesson
row, created when the teacher prepares or starts it. A lesson's content
lives in live-editing rooms (Yjs documents), not in these columns:

  lesson:<id>:board        the class page everyone works on together
  lesson:<id>:draw         the whiteboard
  lesson:<id>:solo:<user>  a student's own copy during solo time
  lesson:<id>:hw           the homework master (teacher only: solutions, tests)
  lesson:<id>:hw:<user>    a student's homework, copied from the master
                           without the teacher's solutions

See app/core/lesson_rooms.py for who may open which room.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Lesson(Base):
    __tablename__ = "lessons"
    __table_args__ = (Index("ix_lessons_group_starts", "group_id", "starts_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Optional tag ("Lists"); groups the lesson list and student progress.
    topic: Mapped[str | None] = mapped_column(String(60), nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # "together": everyone on the class page; "solo": each student on their own copy.
    room_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="together")
    # Set while the class is live (teacher pressed Start), cleared on End.
    live_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when the teacher ends the class (cleared if it's started again). An
    # ended lesson stays open to everyone in the group, to look back at.
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    homework_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    homework_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
