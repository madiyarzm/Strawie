"""
CollabDocument: the saved state of one live-editing room (Yjs document).

The live-sync server keeps each open room's document in memory and writes
its full state here shortly after every change, and when the last person
leaves. Anyone who joins later gets this saved state first, so code no
longer disappears when everyone closes the tab or the server restarts.

`state` is an opaque Yjs update (binary). The server merges updates with
pycrdt but never executes anything in them.

Foreign keys cascade, so deleting a classroom or assignment also deletes its
saved documents. Demo rooms are never stored here (anonymous visitors must
not be able to write to the database).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CollabDocument(Base):
    """Saved state of one collaborative room."""

    __tablename__ = "collab_documents"

    room_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    # Exactly one owner: an (older) classroom assignment, or a lesson.
    classroom_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=True, index=True
    )
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assignments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="CASCADE"), nullable=True, index=True
    )
    state: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
