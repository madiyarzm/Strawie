"""
Persistence and seeding rules for live-editing rooms.

Decides, per room id, whether the room's document is saved to the database
and what a brand-new room starts with. Seeding happens here, on the server,
so two people opening an empty file at the same moment can no longer both
insert the starter code (or race each other into duplicates).

Rules:
  * Editor rooms  "<classroom>:<assignment>:<file>"  saved; the assignment's
    main file starts with its starter code, other files start empty.
  * Drawing rooms "drawing:<classroom>:<assignment>" saved; start empty.
  * Demo rooms    "demo:<uuid>:<file>"                memory only; start with the
    demo's seeded file. Anonymous visitors never write to the database.

Access control is NOT decided here; ws_acl.py has already authorised the
user before any of this runs.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Callable, Optional

from pycrdt import Doc, Text
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.ws_acl import _parse_room_id, parse_demo_room_id
from app.models.assignment import Assignment
from app.models.collab_document import CollabDocument

logger = logging.getLogger(__name__)

# Hard limits. Generous for classroom code, small enough that one user can't
# fill the database or the server's memory.
MAX_ROOM_ID_LEN = 200
MAX_DOC_BYTES = 1_000_000
MAX_MESSAGE_BYTES = 512 * 1024
MAX_ROOMS_PER_ASSIGNMENT = 200

# Same starter text the editor shows for an assignment without starter code.
DEFAULT_STARTER = "# Write your code here\n\n"

TEXT_KEY = "code"  # the Y.Text name the editor binds to (doc.getText("code"))


@dataclass(frozen=True)
class RoomPolicy:
    persist: bool
    classroom_id: Optional[uuid.UUID] = None
    assignment_id: Optional[uuid.UUID] = None
    # Fills a brand-new, empty document. None = start empty.
    seed: Optional[Callable[[Doc], None]] = None


def _text_seed(text: str) -> Callable[[Doc], None]:
    def seed(doc: Doc) -> None:
        if text:
            doc.get(TEXT_KEY, type=Text).insert(0, text)

    return seed


def policy_for_room(db: Session, room_id: str) -> Optional[RoomPolicy]:
    """Return the rules for `room_id`, or None if the room shape is unknown."""
    if not room_id or len(room_id) > MAX_ROOM_ID_LEN:
        return None

    if parse_demo_room_id(room_id) is not None:
        parts = room_id.split(":")
        file_id = parts[2] if len(parts) == 3 else ""
        from app.services.demo_seed import seed_files

        content = next((f["content"] for f in seed_files() if f["id"] == file_id), "")
        return RoomPolicy(persist=False, seed=_text_seed(content))

    key = _parse_room_id(room_id)
    if key is None:
        return None

    if room_id.startswith("drawing:"):
        return RoomPolicy(persist=True, classroom_id=key.classroom_id, assignment_id=key.assignment_id)

    file_id = room_id.split(":", 2)[2]
    seed = None
    if file_id == str(key.assignment_id):
        assignment = db.get(Assignment, key.assignment_id)
        starter = (assignment.template_code if assignment else None) or DEFAULT_STARTER
        seed = _text_seed(starter)
    return RoomPolicy(
        persist=True, classroom_id=key.classroom_id, assignment_id=key.assignment_id, seed=seed
    )


def load_state(db: Session, room_id: str) -> Optional[bytes]:
    row = db.get(CollabDocument, room_id)
    return bytes(row.state) if row else None


def can_create_room(db: Session, policy: RoomPolicy) -> bool:
    """Cap how many saved rooms one assignment can accumulate."""
    if not policy.persist or policy.assignment_id is None:
        return True
    count = db.scalar(
        select(func.count()).select_from(CollabDocument).where(
            CollabDocument.assignment_id == policy.assignment_id
        )
    )
    return (count or 0) < MAX_ROOMS_PER_ASSIGNMENT


def save_state(db: Session, room_id: str, policy: RoomPolicy, state: bytes) -> None:
    if not policy.persist or policy.classroom_id is None or policy.assignment_id is None:
        return
    row = db.get(CollabDocument, room_id)
    if row is None:
        row = CollabDocument(
            room_id=room_id,
            classroom_id=policy.classroom_id,
            assignment_id=policy.assignment_id,
            state=state,
        )
        db.add(row)
    else:
        row.state = state
    db.commit()
