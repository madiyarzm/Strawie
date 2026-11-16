"""
Demo room lifecycle: create, fetch (with lazy expiry), and sweep.

Expiry is enforced twice on purpose:
  * `get_active_room` treats a past `expires_at` as "gone" on every read, so
    a stale URL is dead the instant its TTL passes even if no sweep ran.
  * `delete_expired_rooms` actually removes the rows, so the table does not
    accumulate junk. Called from the app lifespan alongside the existing
    submission cleanup.

Neither function ever touches the users/classrooms graph. A demo room is an
island by design.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.demo_room import DemoRoom

logger = logging.getLogger(__name__)


def count_recent_rooms_for_ip(db: Session, *, ip: str, within_hours: int) -> int:
    """How many rooms this IP created in the last `within_hours` hours.

    Backs the per-IP creation limit. The in-process slowapi limiter resets
    whenever the container restarts, which on a free-tier host happens often
    enough to matter; this database-backed count is the durable ceiling.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=within_hours)
    stmt = (
        select(func.count())
        .select_from(DemoRoom)
        .where(DemoRoom.created_ip == ip, DemoRoom.created_at >= cutoff)
    )
    return int(db.execute(stmt).scalar_one())


def create_room(db: Session, *, ip: str, ttl_hours: int) -> DemoRoom:
    """Create one fresh demo room owned by nobody, expiring in `ttl_hours`."""
    now = datetime.now(timezone.utc)
    room = DemoRoom(
        id=uuid.uuid4(),
        created_ip=ip,
        # created_at has a server_default, but set it explicitly so the
        # per-IP count above sees the row immediately and consistently.
        created_at=now,
        expires_at=now + timedelta(hours=ttl_hours),
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


def get_active_room(db: Session, room_id: uuid.UUID) -> Optional[DemoRoom]:
    """Return the room only if it exists AND has not expired.

    Returns None for both "never existed" and "expired" so callers cannot
    accidentally leak which of the two it was.
    """
    room = db.get(DemoRoom, room_id)
    if room is None:
        return None

    # `expires_at` comes back timezone-aware from Postgres. Under SQLite (used
    # by some tests) it can be naive, so normalise before comparing rather
    # than risking a TypeError in an authorisation path.
    expires_at = room.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at <= datetime.now(timezone.utc):
        return None
    return room


def delete_expired_rooms(db: Session) -> int:
    """Delete every demo room past its TTL. Returns the number removed."""
    now = datetime.now(timezone.utc)
    result = db.execute(delete(DemoRoom).where(DemoRoom.expires_at <= now))
    db.commit()
    removed = result.rowcount or 0
    if removed:
        logger.info("Swept %d expired demo room(s)", removed)
    return removed
