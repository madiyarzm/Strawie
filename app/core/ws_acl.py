"""
Access control for collaborative WebSocket rooms.

A `room_id` encodes which classroom and assignment the room belongs to. The
relay (`app/api/ws_collab.py`) accepted any room_id from any authenticated
client, so any logged-in user could subscribe to or write into any room.
This module parses the room_id and verifies the user has membership.

Recognised room_id formats:

  "<classroom_uuid>:<assignment_uuid>:<file_id>"   — collaborative editor
  "drawing:<classroom_uuid>:<assignment_uuid>"     — collaborative drawing
  "demo:<demo_room_uuid>[:<file_id>]"              — public demo room

Anything else is rejected. If you add a new room shape, extend `_parse_room_id`.

Demo rooms are deliberately kept on a separate code path (`parse_demo_room_id`
/ `guest_can_join_demo_room`) rather than folded into `user_can_join_room`:

  * `_parse_room_id` returns None for a "demo:" room, so a logged-in user can
    never join a visitor's demo room, and
  * `guest_can_join_demo_room` only ever accepts a room whose UUID matches the
    one bound into the guest's own token, so one visitor can never join,
    read, or write another visitor's room.

The two populations cannot reach each other's rooms in either direction.
"""

import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.models.assignment import Assignment
from app.models.classroom import Classroom
from app.models.group_membership import GroupMembership
from app.models.user import User


@dataclass(frozen=True)
class RoomKey:
    classroom_id: uuid.UUID
    assignment_id: uuid.UUID


def _parse_uuid(s: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(s)
    except (ValueError, AttributeError):
        return None


def _parse_room_id(room_id: str) -> Optional[RoomKey]:
    if not room_id:
        return None
    parts = room_id.split(":")
    # editor form: <classroom>:<assignment>:<file>
    if len(parts) >= 3 and parts[0] != "drawing":
        c = _parse_uuid(parts[0])
        a = _parse_uuid(parts[1])
        if c and a:
            return RoomKey(c, a)
    # drawing form: drawing:<classroom>:<assignment>
    if len(parts) == 3 and parts[0] == "drawing":
        c = _parse_uuid(parts[1])
        a = _parse_uuid(parts[2])
        if c and a:
            return RoomKey(c, a)
    return None


def user_can_join_room(db: Session, user_id: str, room_id: str) -> bool:
    """Return True if the user is allowed in this room.

    Allowed when:
      - user is admin, OR
      - user is the classroom's teacher, OR
      - user is a member of the group that owns the classroom.

    Also verifies the assignment actually belongs to the named classroom so a
    valid (classroom, assignment) pair can't be spoofed.
    """
    uid = _parse_uuid(user_id)
    key = _parse_room_id(room_id)
    if not uid or not key:
        return False

    user = db.get(User, uid)
    if not user:
        return False
    if user.role == "admin":
        return True

    classroom = db.get(Classroom, key.classroom_id)
    if not classroom:
        return False

    assignment = db.get(Assignment, key.assignment_id)
    if not assignment or assignment.classroom_id != classroom.id:
        return False

    if classroom.teacher_id == user.id:
        return True

    membership = (
        db.query(GroupMembership)
        .filter(
            GroupMembership.group_id == classroom.group_id,
            GroupMembership.user_id == user.id,
        )
        .first()
    )
    return membership is not None


# ---------------------------------------------------------------------------
# Public demo rooms
# ---------------------------------------------------------------------------

# Room ids look like "demo:<uuid>" or "demo:<uuid>:<file_id>".
_DEMO_PREFIX = "demo"

# The file segment only selects which relay bucket a client joins, but it
# arrives from the network, so keep it short and boring. The seeded file ids
# are "hello" and "interactive"; a visitor adding a tab generates a similar
# slug client-side.
_MAX_FILE_SEGMENT_LEN = 64


def demo_collab_room_id(demo_room_id: uuid.UUID) -> str:
    """Return the base Yjs room id for a demo room.

    The server owns this format so the client cannot invent a room shape the
    ACL would then have to guess at.
    """
    return f"{_DEMO_PREFIX}:{demo_room_id}"


def parse_demo_room_id(room_id: str) -> Optional[uuid.UUID]:
    """Return the demo room UUID encoded in `room_id`, or None if it is not one.

    Accepts "demo:<uuid>" and "demo:<uuid>:<file_id>" and nothing else.
    """
    if not room_id:
        return None

    parts = room_id.split(":")
    # Only the two documented shapes; anything longer or shorter is rejected
    # rather than leniently parsed.
    if len(parts) not in (2, 3):
        return None
    if parts[0] != _DEMO_PREFIX:
        return None

    demo_room_uuid = _parse_uuid(parts[1])
    if demo_room_uuid is None:
        return None

    if len(parts) == 3:
        file_segment = parts[2]
        if not file_segment or len(file_segment) > _MAX_FILE_SEGMENT_LEN:
            return None
        # Conservative allowlist: identifier characters plus the dot and dash
        # used in filenames like "hello.py" or "my-notes.py".
        for character in file_segment:
            if not (character.isalnum() or character in "._-"):
                return None

    return demo_room_uuid


def guest_can_join_demo_room(
    db: Session, *, token_room_id: uuid.UUID, room_id: str
) -> bool:
    """Return True if this guest may join this demo room.

    Requires all three, so a guest is confined to exactly one live room:
      1. `room_id` is a well-formed demo room id,
      2. it names the same room the guest's own token is bound to, and
      3. that room still exists and has not expired.
    """
    requested_room_id = parse_demo_room_id(room_id)
    if requested_room_id is None:
        return False

    # The decisive check: a guest can only reach the room in their own token.
    if requested_room_id != token_room_id:
        return False

    # Import here rather than at module scope to avoid a circular import
    # (demo_service -> models -> ... -> ws_acl).
    from app.services.demo_service import get_active_room

    return get_active_room(db, requested_room_id) is not None
