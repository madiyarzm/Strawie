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
  * Demo rooms    "demo:<uuid>:<page>"                memory only; start with the
    demo lesson (app/services/demo_seed.py). Anonymous visitors never write
    to the database.
  * Lesson rooms  "lesson:<lesson>:..."               saved; see lesson_rooms.py.
    Personal copies (solo, homework) are built from their source room the
    first time they are opened.

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

from app.core import lesson_rooms
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
MAX_ROOMS_PER_LESSON = 200

# Same starter text the editor shows for an assignment without starter code.
DEFAULT_STARTER = "# Write your code here\n\n"

TEXT_KEY = "code"  # the Y.Text name the editor binds to (doc.getText("code"))


@dataclass(frozen=True)
class RoomPolicy:
    persist: bool
    classroom_id: Optional[uuid.UUID] = None
    assignment_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    user_id: Optional[uuid.UUID] = None  # personal workspace owner
    # Fills a brand-new, empty document. None = start empty.
    seed: Optional[Callable[[Doc], None]] = None
    # Or: build a brand-new document from another room's current content.
    seed_from: Optional[str] = None
    transform: Optional[Callable[[Doc, Doc], None]] = None


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
        from app.services.demo_seed import seed_for

        seed = seed_for(parts[2]) if len(parts) == 3 else None
        if seed is None:
            return None
        return RoomPolicy(persist=False, seed=seed)

    lesson_room = lesson_rooms.parse_lesson_room(room_id)
    if lesson_room is not None:
        return _lesson_policy(db, lesson_room)

    from app.core.workspace_rooms import parse_workspace_room

    workspace = parse_workspace_room(room_id)
    if workspace is not None:
        seed = lesson_rooms.seed_board if workspace.kind == "page" else None
        return RoomPolicy(persist=True, user_id=workspace.owner_id, seed=seed)

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


def _lesson_policy(db: Session, room: "lesson_rooms.LessonRoom") -> Optional[RoomPolicy]:
    if not lesson_rooms.owner_is_group_student(db, room):
        return None
    lid = room.lesson_id
    if room.kind == "board":
        return RoomPolicy(persist=True, lesson_id=lid, seed=lesson_rooms.seed_board)
    if room.kind == "draw":
        return RoomPolicy(persist=True, lesson_id=lid)
    if room.kind == "solo":
        return RoomPolicy(
            persist=True, lesson_id=lid,
            seed_from=lesson_rooms.room_name(lid, "board"), transform=lesson_rooms.copy_board,
        )
    if room.is_master:
        return RoomPolicy(persist=True, lesson_id=lid, seed=lesson_rooms.seed_homework_master)
    return RoomPolicy(
        persist=True, lesson_id=lid,
        seed_from=lesson_rooms.room_name(lid, "hw"), transform=lesson_rooms.copy_homework_for_student,
    )


def load_source_doc(db: Session, room_id: str) -> Doc:
    """The saved content of `room_id`, or what it would start with if new."""
    doc = Doc()
    state = load_state(db, room_id)
    if state is not None:
        doc.apply_update(state)
        return doc
    policy = policy_for_room(db, room_id)
    if policy is not None and policy.seed is not None:
        policy.seed(doc)
    return doc


def load_state(db: Session, room_id: str) -> Optional[bytes]:
    row = db.get(CollabDocument, room_id)
    return bytes(row.state) if row else None


def can_create_room(db: Session, policy: RoomPolicy) -> bool:
    """Cap how many saved rooms one assignment or lesson can accumulate."""
    if not policy.persist:
        return True
    if policy.lesson_id is not None:
        column, value, cap = CollabDocument.lesson_id, policy.lesson_id, MAX_ROOMS_PER_LESSON
    elif policy.assignment_id is not None:
        column, value, cap = CollabDocument.assignment_id, policy.assignment_id, MAX_ROOMS_PER_ASSIGNMENT
    else:
        return True
    count = db.scalar(select(func.count()).select_from(CollabDocument).where(column == value))
    return (count or 0) < cap


def save_state(db: Session, room_id: str, policy: RoomPolicy, state: bytes) -> None:
    if not policy.persist:
        return
    has_owner = policy.lesson_id is not None or policy.user_id is not None or (
        policy.classroom_id is not None and policy.assignment_id is not None
    )
    if not has_owner:
        return
    row = db.get(CollabDocument, room_id)
    if row is None:
        row = CollabDocument(
            room_id=room_id,
            classroom_id=policy.classroom_id,
            assignment_id=policy.assignment_id,
            lesson_id=policy.lesson_id,
            user_id=policy.user_id,
            state=state,
        )
        db.add(row)
    else:
        row.state = state
    db.commit()
