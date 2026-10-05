"""
DemoRoom model: an ephemeral, account-free workspace for the public demo.

Deliberately has NO foreign key to `users`. A demo visitor is never a User
row, so the public demo cannot create identity records, cannot collide with
a real account's unique email/google_id, and cannot be reached by any query
that walks the users -> groups -> classrooms graph.

Rows are short-lived: `expires_at` is enforced two ways, because either one
alone leaves a gap.
  * lazily, on every read (so an expired room is dead the moment its TTL
    passes, even if no sweep has run), and
  * by a sweep on application startup (so rows are actually deleted and the
    table does not grow without bound).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DemoRoom(Base):
    """One ephemeral demo workspace, keyed by the URL the visitor lands on."""

    __tablename__ = "demo_rooms"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Stored only so abuse can be investigated and so the per-IP creation
    # limit survives a process restart (the in-memory limiter does not).
    # Length 45 covers an IPv4-mapped IPv6 address.
    created_ip: Mapped[str] = mapped_column(String(45), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )


# Supports the per-IP creation-rate query (`created_ip` + recent `created_at`)
# without scanning the table.
Index("ix_demo_rooms_ip_created", DemoRoom.created_ip, DemoRoom.created_at)
